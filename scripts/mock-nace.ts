// Mock Nace server: same paths, auth rule, limits and response shapes as the real Drex + NDI API (docs/MVP_SPEC.md, "Plug-in design").
// Its answers come from the offline engines, so it proves the plumbing, not the accuracy. Never benchmark against it.
//
//   npm run mock-nace                     # http://localhost:4010
//   MOCK_FAIL=529 npm run mock-nace       # every call fails that way (401, 402, 422, 429, 529)
//   MOCK_LATENCY_MS=3000 npm run mock-nace
//   header X-Mock-Fail: 529               # fail one call
//
// Endpoints:
//   POST /v1/systemone                     Drex
//   POST /v1/documents/upload-grants       NDI upload grant
//   POST /v1/workspaces/:ws/files          upload (X-Upload-Token + multipart file + metadata)
//   POST /v1/documents/parse               parse job
//   POST /v1/documents/ground              ground job
//   POST /v1/documents/classify            classify job (document granularity: picks the class whose words the text uses most)
//   POST /v1/documents/extract             extract job (string fields: first sentence naming the field; arrays: sentences with numbers)
//   GET  /v1/documents/jobs/:id            job status: "running" on the first poll, "succeeded" on the next

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { detectKind, readBytes } from "../lib/perceive/local";
import { BM25, contentWords, coverage, extractNames, extractNumbers, sourceUnits } from "../lib/text/similarity";
import { scoreClaim } from "../lib/decide/local";
import type { SourcePage } from "../lib/types";

export interface MockOptions { port?: number; fail?: number | null; latencyMs?: number; log?: boolean }

interface StoredFile { workspaceId: string; fileId: string; path: string; name: string; bytes: Uint8Array; mimeType: string }
interface ParsedDoc { text: string; pages: SourcePage[]; lane: string; fileName: string }
interface Job { job_id: string; kind: string; result: unknown; polls: number; createdAt: string; parsed?: ParsedDoc; workspaceId: string | null }

const VERDICT_LABELS = ["supported", "contradicted", "not_in_source"];
const MODEL_ALIASES: Record<string, string> = { "drex-latest": "drex-max-v1.1", "nacedm-latest": "drex-max-v1.1", "drex-max": "drex-max-v1.1", "drex-v1.0": "drex-max-v1.1", "drex-v1.1": "drex-max-v1.1", "drex-v1.5": "drex-max-v1.1" };
const MODELS = new Set(["drex-v2.0", "drex-max-v1.1", "drex-max-finance"]);
const FAIL_MESSAGES: Record<number, [string, string]> = {
  401: ["authentication_error", "Invalid or missing API key."],
  402: ["insufficient_credit", "Your account is out of credit."],
  422: ["invalid_request", "The request was invalid (mock drill)."],
  429: ["rate_limited", "Too many requests (mock drill)."],
  529: ["overloaded", "The service is overloaded (mock drill)."],
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
function err(res: ServerResponse, status: number, type: string, message: string, extra: Record<string, unknown> = {}) {
  send(res, status, { error: { type, message, ...extra } }, status === 429 || status === 529 ? { "retry-after": "0" } : {});
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function authed(req: IncomingMessage): boolean {
  const h = req.headers.authorization ?? "";
  return /^Bearer nace_sk_[A-Za-z0-9_]{8,}$/.test(h.trim());
}

const tokens = (s: string) => Math.ceil(s.length / 4);

/** Blocks: paragraphs per page, each with a page_region location. */
function toBlocks(doc: ParsedDoc) {
  const blocks: unknown[] = [];
  for (const p of doc.pages) {
    const pageText = doc.text.slice(p.start, p.end);
    for (const para of pageText.split(/\n{2,}/)) {
      const t = para.trim();
      if (!t) continue;
      blocks.push({ type: "text", text: t, location: { kind: "page_region", page: p.page, polygons: [[[0.08, 0.1], [0.92, 0.1], [0.92, 0.14], [0.08, 0.14]]] } });
    }
  }
  return blocks;
}

function pageOf(pages: SourcePage[], offset: number): number {
  return pages.find((p) => offset >= p.start && offset <= p.end)?.page ?? 1;
}

export async function startMockNace(opts: MockOptions = {}): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const files = new Map<string, StoredFile>();
  const grants = new Map<string, { workspaceId: string; path: string | null; used: boolean; totalSize: number | null }>();
  const jobs = new Map<string, Job>();
  const workspaceId = "ws_mock_receipts";
  const log = (...a: unknown[]) => { if (opts.log) console.log(...a); };

  function makeJob(kind: string, result: unknown, extra: Partial<Job> = {}): Job {
    const job: Job = { job_id: `job_${randomBytes(8).toString("hex")}`, kind, result, polls: 0, createdAt: new Date().toISOString(), workspaceId: null, ...extra };
    jobs.set(job.job_id, job);
    return job;
  }
  function envelope(job: Job, status: string) {
    const final = status === "succeeded";
    return {
      job_id: job.job_id, kind: job.kind, status, workspace_id: job.workspaceId,
      result: final ? job.result : null, error: null,
      cost: final ? 0 : null, credits: final ? { units: 1 } : null,
      created_at: job.createdAt, completed_at: final ? new Date().toISOString() : null,
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname.replace(/\/+$/, "");
    log(`${req.method} ${p}`);

    const failHeader = Number(req.headers["x-mock-fail"] ?? NaN);
    const fail = Number.isFinite(failHeader) ? failHeader : opts.fail ?? null;
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    if (fail && FAIL_MESSAGES[fail]) return err(res, fail, ...FAIL_MESSAGES[fail]);

    // ---------------------------------------------------------- upload (token auth, not Bearer)
    const up = p.match(/^\/v1\/workspaces\/([^/]+)\/files$/);
    if (req.method === "POST" && up) {
      const token = String(req.headers["x-upload-token"] ?? "");
      const grant = grants.get(token);
      if (!token || !grant) return err(res, 401, "authentication_error", "Missing or unknown X-Upload-Token.");
      if (grant.used) return err(res, 401, "authentication_error", "This upload grant was already used.");
      const raw = await readBody(req);
      let form: FormData;
      try {
        form = await new Request("http://mock/upload", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body: new Uint8Array(raw) }).formData();
      } catch {
        return err(res, 422, "invalid_request", "Expected multipart/form-data with file and metadata parts.");
      }
      const file = form.get("file");
      const metadata = form.get("metadata");
      if (!file || typeof file === "string") return err(res, 422, "invalid_request", "Missing file part.");
      if (typeof metadata !== "string") return err(res, 422, "invalid_request", "The metadata part must be a text field holding JSON, not a file part.");
      let meta: { path?: string };
      try { meta = JSON.parse(metadata); } catch { return err(res, 422, "invalid_request", "metadata is not valid JSON."); }
      if (!meta.path || meta.path.startsWith("/")) return err(res, 422, "invalid_request", "metadata.path is required and must be relative.", { path: ["metadata", "path"] });
      if (grant.path && grant.path !== meta.path) return err(res, 422, "invalid_request", "metadata.path does not match the grant's path.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (grant.totalSize !== null && grant.totalSize !== bytes.byteLength) return err(res, 422, "invalid_request", "File size does not match total_size_bytes.");
      const existing = [...files.values()].find((f) => f.path === meta.path);
      if (existing && Buffer.compare(Buffer.from(existing.bytes), Buffer.from(bytes)) !== 0) return err(res, 409, "conflict", "A different file is already stored at this path (on_conflict: reject).");
      grant.used = true;
      const stored: StoredFile = existing ?? { workspaceId: up[1], fileId: `file_${randomBytes(8).toString("hex")}`, path: meta.path, name: file.name || meta.path.split("/").pop()!, bytes, mimeType: file.type || "application/octet-stream" };
      files.set(stored.fileId, stored);
      const job = makeJob("upload", { file: { workspace_id: stored.workspaceId, file_id: stored.fileId, path: stored.path, size_bytes: bytes.byteLength }, deduplicated: Boolean(existing) }, { workspaceId: stored.workspaceId });
      return send(res, 200, envelope(job, "succeeded"));
    }

    if (!authed(req)) return err(res, 401, "authentication_error", "Invalid or missing API key. Keys start with nace_sk_.");

    // ---------------------------------------------------------- Drex
    if (req.method === "POST" && p === "/v1/systemone") {
      const t0 = performance.now();
      const raw = await readBody(req);
      if (raw.byteLength > 4 * 1024 * 1024) return err(res, 413, "request_too_large", "The request body is over 4 MiB.");
      let body: any;
      try { body = JSON.parse(raw.toString("utf8")); } catch { return err(res, 422, "invalid_request", "Body is not valid JSON."); }
      const requested = body.model ?? "drex-latest";
      if (typeof requested !== "string" || !/^(?:drex|nacedm)-[A-Za-z0-9.-]+$/.test(requested) || !(MODELS.has(requested) || MODEL_ALIASES[requested])) {
        return err(res, 422, "invalid_request", `Unknown model "${requested}".`, { issues: [{ path: ["model"], message: "unknown model" }] });
      }
      const model = MODEL_ALIASES[requested] ?? requested;
      if (body.state === undefined || body.state === null) return err(res, 422, "invalid_request", "state is required.", { issues: [{ path: ["state"], message: "required" }] });
      const qs = body.questions;
      if (!qs || typeof qs !== "object" || Array.isArray(qs)) return err(res, 422, "invalid_request", "questions must be an object keyed by question id.", { issues: [{ path: ["questions"], message: "required" }] });
      const ids = Object.keys(qs);
      if (ids.length < 1 || ids.length > 512) return err(res, 422, "invalid_request", "questions must have 1 to 512 entries.", { issues: [{ path: ["questions"], message: "1 <= properties <= 512" }] });
      for (const id of ids) {
        const q = qs[id];
        if (!q || !["choice", "score", "noul"].includes(q.type)) return err(res, 422, "invalid_request", `questions.${id}.type must be choice, score or noul.`, { issues: [{ path: ["questions", id, "type"], message: "invalid" }] });
        if (q.type === "choice" && (!q.criteria || typeof q.criteria !== "object" || Array.isArray(q.criteria) || !Object.keys(q.criteria).length)) {
          return err(res, 422, "invalid_request", `questions.${id}.criteria is required for a choice question.`, { issues: [{ path: ["questions", id, "criteria"], message: "required" }] });
        }
      }
      const stateText = typeof body.state === "string" ? body.state : String(body.state.source_document ?? JSON.stringify(body.state));
      const index = new BM25(sourceUnits(stateText));
      const docWords = new Set(contentWords(stateText));
      const docNumbers = extractNumbers(stateText);
      const docNames = extractNames(stateText);
      const lower = stateText.toLowerCase();
      const answers: Record<string, unknown> = {};
      let promptChars = JSON.stringify(body.state).length;
      for (const id of ids) {
        const q = qs[id];
        promptChars += JSON.stringify(q).length;
        const sentence = String(q.instructions ?? "").match(/Sentence: "([\s\S]*)"\s*$/)?.[1] ?? String(q.instructions ?? "");
        const scored = scoreClaim(sentence, index, docWords, docNumbers, docNames, lower).probabilities;
        if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          let probs: Record<string, number>;
          if (VERDICT_LABELS.every((l) => labels.includes(l))) {
            probs = Object.fromEntries(labels.map((l) => [l, (scored as Record<string, number>)[l] ?? 0]));
          } else {
            probs = Object.fromEntries(labels.map((l, i) => [l, i === 0 ? scored.supported : (1 - scored.supported) / Math.max(1, labels.length - 1)]));
          }
          const sum = Object.values(probs).reduce((a, b) => a + b, 0) || 1;
          for (const k of Object.keys(probs)) probs[k] = Math.round((probs[k] / sum) * 10000) / 10000;
          const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
          answers[id] = { type: "choice", choice, confidence: probs[choice], probabilities: probs };
        } else if (q.type === "noul") {
          answers[id] = { type: "noul", noul: Math.round(scored.supported * 10000) / 10000, confidence: Math.round(Math.max(scored.supported, 1 - scored.supported) * 10000) / 10000 };
        } else {
          const levels = Array.isArray(q.criteria) ? q.criteria.length : 4;
          answers[id] = { type: "score", score: (levels - 1) * scored.supported, legend: q.criteria ?? [], probabilities: {}, confidence: 0.5 };
        }
      }
      return send(res, 200, { model, answers, usage: { input_tokens: tokens(" ".repeat(promptChars)), output_tokens: ids.length * 3 }, evaluation_time_ms: Math.round((performance.now() - t0) * 10) / 10, request_id: `req_${randomBytes(16).toString("hex")}` });
    }

    // ---------------------------------------------------------- NDI
    if (req.method === "POST" && p === "/v1/documents/upload-grants") {
      let body: any = {};
      try { body = JSON.parse((await readBody(req)).toString("utf8") || "{}"); } catch { return err(res, 422, "invalid_request", "Body is not valid JSON."); }
      const token = `upl_${randomBytes(16).toString("hex")}`;
      const ttl = Math.min(3600, Number(body.ttl_seconds ?? 3600));
      grants.set(token, { workspaceId, path: body.path ?? null, used: false, totalSize: typeof body.total_size_bytes === "number" ? body.total_size_bytes : null });
      const host = req.headers.host ?? "localhost:4010";
      return send(res, 200, { workspace_id: workspaceId, upload_url: `http://${host}/v1/workspaces/${workspaceId}/files`, token, expires_at: new Date(Date.now() + ttl * 1000).toISOString(), max_bytes: null });
    }

    if (req.method === "POST" && ["/v1/documents/parse", "/v1/documents/ground", "/v1/documents/classify", "/v1/documents/extract"].includes(p)) {
      const wait = url.searchParams.get("wait_seconds");
      if (wait !== null && (!/^\d+$/.test(wait) || Number(wait) < 1 || Number(wait) > 100)) return err(res, 422, "invalid_request", "wait_seconds must be 1 to 100.");
      let body: any;
      try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { return err(res, 422, "invalid_request", "Body is not valid JSON."); }
      const src = body?.source ?? {};

      let parsed: ParsedDoc | undefined;
      let jobWorkspace: string | null = null;
      if (src.type === "workspace_file") {
        const f = files.get(src.file_id);
        if (!f || f.workspaceId !== src.workspace_id) return err(res, 404, "not_found", "No such workspace file.");
        jobWorkspace = f.workspaceId;
        const kind = detectKind(f.name, f.mimeType) ?? "text";
        try {
          const r = await readBytes(f.bytes, kind);
          parsed = { text: r.text, pages: r.pages, lane: kind === "pdf" ? "pdf" : kind === "html" ? "html" : "text", fileName: f.name };
        } catch (e) {
          return err(res, 422, "unreadable_file", (e as Error).message);
        }
      } else if (src.type === "parse_result") {
        if (p === "/v1/documents/parse") return err(res, 422, "invalid_request", "parse_result is not a valid source for parse.");
        const j = jobs.get(src.job_id);
        if (!j || j.kind !== "parse" || !j.parsed) return err(res, 422, "invalid_request", "source.job_id is not a finished parse job.", { issues: [{ path: ["source", "job_id"], message: "unknown parse job" }] });
        parsed = j.parsed;
      } else if (src.type === "url") {
        try {
          const r0 = await fetch(String(src.url));
          const bytes = new Uint8Array(await r0.arrayBuffer());
          const name = String(src.file_name ?? new URL(String(src.url)).pathname.split("/").pop() ?? "document");
          const kind = detectKind(name, r0.headers.get("content-type") ?? undefined) ?? "html";
          const r = await readBytes(bytes, kind);
          parsed = { text: r.text, pages: r.pages, lane: kind === "pdf" ? "pdf" : "text", fileName: name };
        } catch (e) {
          return err(res, 422, "unreadable_file", `Could not fetch the URL: ${(e as Error).message}`);
        }
      } else {
        return err(res, 422, "invalid_request", "source.type must be workspace_file, parse_result or url.", { issues: [{ path: ["source", "type"], message: "invalid" }] });
      }

      if (p === "/v1/documents/parse") {
        const formats: string[] = body?.output?.formats ?? ["markdown", "blocks"];
        const document: Record<string, unknown> = { page_count: parsed.pages.length, chunks: [] };
        document.text = formats.includes("text") ? parsed.text : null;
        document.markdown = formats.includes("markdown") ? parsed.text : null;
        document.blocks = formats.includes("blocks") ? toBlocks(parsed) : [];
        const job = makeJob("parse", { result_type: "parse", file_name: parsed.fileName, lane: parsed.lane, document, ocr_applied: false, units: parsed.pages.length, disclosures: [] }, { parsed, workspaceId: jobWorkspace });
        return send(res, 202, envelope(job, "running"));
      }

      if (p === "/v1/documents/classify") {
        const classes = body?.classes;
        if (!Array.isArray(classes) || !classes.length) return err(res, 422, "invalid_request", "classes must have at least 1 entry.");
        if (classes.some((c: any) => !c?.id || !c?.label || ["other", "blank_page", "unreadable_content", "__ndi_unclassified"].includes(c.id))) return err(res, 422, "invalid_request", "Each class needs an id and a label, and some ids are reserved.");
        const words = parsed.text.toLowerCase();
        const scored = classes.map((c: any) => {
          const terms = `${c.label} ${c.description ?? ""}`.toLowerCase().match(/[a-z]{4,}/g) ?? [];
          return { c, n: terms.reduce((sum, t) => sum + (words.split(t).length - 1), 0) };
        }).sort((a: any, b: any) => b.n - a.n);
        const total = scored.reduce((sum: number, x: any) => sum + x.n, 0) || 1;
        const max = Math.max(1, Math.min(10, Number(body?.output?.max_alternatives ?? 3)));
        const labels = scored.slice(0, max).map((x: any, i: number) => ({ class_id: x.c.id, subclass_id: null, label: x.c.label, rank: i + 1, reason: "Mock: shares the most words with this class.", confidence: Math.round((x.n / total) * 1000) / 1000 }));
        const unit = { granularity: "document", page_range: { start: 1, end: parsed.pages.length }, unknown: scored[0].n === 0, labels };
        const job = makeJob("classify", { result_type: "classify", units: [unit], unknown_units: unit.unknown ? 1 : 0, pages_read_fraction: 1, disclosures: [] }, { workspaceId: jobWorkspace });
        return send(res, 202, envelope(job, "running"));
      }

      if (p === "/v1/documents/extract") {
        const schema = body?.schema;
        if (!schema || schema.type !== "object" || !schema.properties || !Object.keys(schema.properties).length) return err(res, 422, "invalid_schema", "The schema root must be an object with properties.");
        const units = sourceUnits(parsed.text);
        const cite = (u: { text: string; start: number }) => [{ location: { kind: "page_region", page: pageOf(parsed!.pages, u.start), polygons: [] }, source_text: u.text }];
        const data: Record<string, unknown> = {};
        const fields: unknown[] = [];
        for (const [key, prop] of Object.entries<any>(schema.properties)) {
          if (prop?.type === "array") {
            const hits = units.filter((u) => /\d/.test(u.text)).slice(0, Number(prop.maxItems ?? 5));
            data[key] = hits.map((u) => ({ what: u.text.split(/\s+/).slice(0, 4).join(" "), value: u.text.match(/[$€£]?\d[\d,.]*%?/)?.[0] ?? "" }));
            fields.push({ path: `/${key}`, value: null, status: hits.length ? "found" : "not_found", confidence: null, citations: [] });
            hits.forEach((u, i) => fields.push({ path: `/${key}/${i}`, value: JSON.stringify((data[key] as unknown[])[i]), status: "found", confidence: 0.8, citations: cite(u) }));
            continue;
          }
          const terms = key.split("_").filter((t) => t.length >= 4);
          const u = units.find((x) => terms.some((t) => x.text.toLowerCase().includes(t)));
          data[key] = u ? u.text : null;
          fields.push(u ? { path: `/${key}`, value: u.text, status: "found", confidence: 0.8, citations: cite(u) } : { path: `/${key}`, value: null, status: "not_found", confidence: null, citations: [] });
        }
        const job = makeJob("extract", { result_type: "extract", data, fields, schema_id: null, schema_version: null, units: 1, warnings: [] }, { workspaceId: jobWorkspace });
        return send(res, 202, envelope(job, "running"));
      }

      // ground
      const targets = body?.targets;
      if (!Array.isArray(targets) || targets.length < 1 || targets.length > 30) return err(res, 422, "invalid_request", "targets must have 1 to 30 entries.", { issues: [{ path: ["targets"], message: "1 to 30 items" }] });
      const maxMatches = Math.max(1, Number(body?.options?.max_matches ?? 3));
      const units = sourceUnits(parsed.text);
      const index = new BM25(units);
      const pdf = parsed.lane === "pdf";
      const out = targets.map((t: any) => {
        if (!t?.id || typeof t.text !== "string" || !t.text.trim()) return { id: t?.id ?? null, status: "failed", error: "invalid_target", matches: [] };
        const hits = index.search(t.text, 3).map((h) => ({ h, cov: coverage(t.text, h.unit.text, { ignoreNumbers: true }) })).filter((x) => x.cov >= 0.3).sort((a, b) => b.cov - a.cov).slice(0, maxMatches);
        if (!hits.length) return { id: t.id, status: "not_found", matches: [] };
        return {
          id: t.id,
          status: "found",
          matches: hits.map((x, i) => ({
            rank: i + 1,
            matched_text: x.h.unit.text,
            match_method: t.semantic ? "semantic" : "exact",
            confidence: Math.round(x.cov * 1000) / 1000,
            location: pdf
              ? { kind: "page_region", page: pageOf(parsed!.pages, x.h.unit.start), polygons: [[[0.08, 0.2], [0.92, 0.2], [0.92, 0.24], [0.08, 0.24]]] }
              : { kind: "text_span", page: pageOf(parsed!.pages, x.h.unit.start), char_start: x.h.unit.start, char_end: x.h.unit.end },
            cropped_image_url: null,
          })),
        };
      });
      const job = makeJob("ground", { result_type: "ground", targets: out, units: targets.length }, { workspaceId: jobWorkspace });
      return send(res, 202, envelope(job, "running"));
    }

    const jobMatch = p.match(/^\/v1\/documents\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return err(res, 404, "not_found", "No such job.");
      job.polls++;
      return send(res, 200, envelope(job, job.polls >= 2 ? "succeeded" : "running"));
    }

    if (req.method === "GET" && p === "/v1/models") {
      return send(res, 200, { data: [...MODELS].map((id) => ({ id })).concat(Object.entries(MODEL_ALIASES).map(([id, alias_for]) => ({ id, alias_for } as never))) });
    }

    return err(res, 404, "not_found", `No route for ${req.method} ${p} on the mock Nace server.`);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error("[mock-nace] error:", e);
      if (!res.headersSent) err(res, 500, "internal_error", "Mock server error.");
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 4010, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port ?? 4010;
  return { server, url: `http://localhost:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const fail = process.env.MOCK_FAIL ? Number(process.env.MOCK_FAIL) : null;
  const latencyMs = Number(process.env.MOCK_LATENCY_MS ?? 0);
  const port = Number(process.env.MOCK_PORT ?? 4010);
  startMockNace({ port, fail, latencyMs, log: true }).then(({ url }) => {
    console.log(`Mock Nace server on ${url}  (accepts any nace_sk_ key)${fail ? `  MOCK_FAIL=${fail}` : ""}${latencyMs ? `  MOCK_LATENCY_MS=${latencyMs}` : ""}`);
    console.log("Answers come from the offline engines: plumbing only, never accuracy. Mock numbers never go on the scoreboard.");
  });
}

