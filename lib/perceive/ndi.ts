// Perceiver "ndi": Nace Document Intelligence. One of only two files that talk to Nace (the other is lib/decide/drex.ts).
//
// 1. Upload:  POST /v1/documents/upload-grants {path, ttl_seconds, total_size_bytes} -> {workspace_id, upload_url, token, ...}
//             POST <upload_url>  X-Upload-Token, multipart: file + metadata (text field, JSON {"path": ...}) -> job, result.file
//             (URL sources skip the upload and use {"type": "url", "url", "file_name"}.)
// 2. Parse:   POST /v1/documents/parse?wait_seconds=N {source: workspace_file, output: {formats: [text, markdown, blocks]}}
//             -> job; result.document {text, markdown, page_count, blocks[] with location {kind: page_region, page}}
// 3. Ground:  POST /v1/documents/ground?wait_seconds=N {source: {type: parse_result, job_id}, targets: [{id, text, semantic: true}],
//             options: {max_matches: 1}}, 1-30 targets per request -> result.targets[] {id, status, matches[]}
// 4. Profile (optional extras, run beside ground):
//    Classify: POST /v1/documents/classify {source: parse_result, classes, output} -> result.units[0].labels[] {class_id, label, rank, reason, confidence}
//    Extract:  POST /v1/documents/extract  {source: parse_result, schema} -> result.data + result.fields[] {path, value, status, confidence, citations[] {location, source_text}}
// Jobs not final yet are polled at GET /v1/documents/jobs/{id}: 1 s backing off to 10 s, giving up after 240 s.
//
// Fallbacks keep the demo alive: if NDI can't parse a source, the built-in reader takes over (with a warning);
// a target that fails gets a built-in receipt (with a warning). If ground fails completely, the pipeline falls back too.

import type { Claim, DocumentType, GroundResult, KeyFact, Perceiver, ProfileResult, Receipt, SourceDocument, SourceInput, SourcePage, Usage } from "../types";
import { getConfig, type Config } from "../config";
import { ProviderError } from "../errors";
import { requestJson } from "../http";
import { lexicalReceipts, notFoundReceipt, parseLocal } from "./local";
import { sectionFor } from "../text/section";
import { contentWords, withoutNumbers } from "../text/similarity";

const PROVIDER = "NDI";
export const GROUND_BATCH = 30;

/** Tunable for tests. */
export const ndiSettings = { pollStartMs: 1000, pollMaxMs: 10_000, pollCapMs: 240_000 };

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
interface NdiJob<R = unknown> {
  job_id: string;
  kind?: string;
  status: JobStatus;
  result?: R | null;
  error?: { code?: string; message?: string } | string | null;
  cost?: number | { usd?: number; amount?: number; total?: number; total_usd?: string | number } | null;
  credits?: unknown;
}
interface Location { kind?: string; page?: number; char_start?: number; char_end?: number; [k: string]: unknown }
interface Block { type?: string; text?: string; markdown?: string; content?: string; location?: Location }
interface ParseResult { result_type?: string; file_name?: string; lane?: string; document?: { text?: string | null; markdown?: string | null; page_count?: number; blocks?: Block[] } }
interface GroundTarget { id: string; status: "found" | "not_found" | "failed"; error?: unknown; matches?: Array<{ rank?: number; matched_text?: string; match_method?: string; confidence?: number | null; location?: Location; cropped_image_url?: string | null }> }
interface GroundResultBody { result_type?: string; targets?: GroundTarget[] }

interface ClassifyBody { units?: Array<{ unknown?: boolean; labels?: Array<{ class_id?: string; label?: string; rank?: number; reason?: string | null; confidence?: number | null }> }> }
interface ExtractField { path?: string; value?: unknown; status?: string; confidence?: number | null; citations?: Array<{ location?: Location; source_text?: string | null }> }
interface ExtractBody { data?: Record<string, unknown>; fields?: ExtractField[]; warnings?: unknown[] }

/** The kinds of document boneify tells apart. Ids avoid NDI's reserved ones (other, blank_page, unreadable_content). */
export const DOC_CLASSES = [
  { id: "contract", label: "Contract", description: "An agreement between parties: terms, obligations, fees, renewal and termination" },
  { id: "financial_report", label: "Financial report", description: "Earnings, results, revenue, margins, guidance or other financial figures for a period" },
  { id: "invoice", label: "Invoice", description: "A bill listing items, amounts and a total due" },
  { id: "policy", label: "Policy or handbook", description: "Rules, procedures or guidance for an organisation or its staff" },
  { id: "article", label: "Article or research", description: "A paper, article, report or news story" },
];

/** One schema for every kind of document: who and when, plus the numbers a summary most often gets wrong. */
export const KEY_FACTS_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The document's title or name" },
    parties: { type: "string", description: "The parties, companies or organisations the document is about, comma-separated" },
    effective_date: { type: "string", description: "The main date the document takes effect or covers, as written" },
    key_figures: {
      type: "array",
      maxItems: 8,
      description: "The most important numbers stated in the document: amounts, fees, percentages, durations, deadlines and counts",
      items: {
        type: "object",
        properties: {
          what: { type: "string", description: "What the number is, in 2 to 6 words" },
          value: { type: "string", description: "The number exactly as written, with its unit" },
        },
      },
    },
  },
} as const;
const FIELD_LABELS: Record<string, string> = { title: "Title", parties: "Parties", effective_date: "Effective date" };

const FINAL: JobStatus[] = ["succeeded", "failed", "cancelled"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jobCostUsd(job: NdiJob): number {
  const c = job.cost;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (c && typeof c === "object") {
    const v = c.usd ?? c.amount ?? c.total ?? c.total_usd; // the live API sends {total_usd: "0.0081", lines: [...]}
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return 0;
}

function jobError(job: NdiJob): string {
  const e = job.error;
  if (!e) return `the ${job.kind ?? "document"} job ended as ${job.status}`;
  if (typeof e === "string") return `the ${job.kind ?? "document"} job ${job.status}: ${e}`;
  return `the ${job.kind ?? "document"} job ${job.status}: ${e.message ?? e.code ?? "unknown error"}`;
}

function safeName(name: string): string {
  return (name.split(/[\\/]/).pop() || "document").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "document";
}

/** Page offsets from blocks: block text grouped by page, pages joined by a blank line. */
export function documentFromParse(result: ParseResult, name: string): { text: string; pages: SourcePage[]; format: string } {
  const doc = result.document ?? {};
  const format = result.lane || "ndi";
  const blocks = (doc.blocks ?? []).filter((b) => b && (b.text ?? b.markdown ?? b.content));
  const paged = blocks.filter((b) => typeof b.location?.page === "number");
  if (paged.length) {
    const byPage = new Map<number, string[]>();
    for (const b of paged) {
      const t = String(b.text ?? b.markdown ?? b.content ?? "").trim();
      if (!t) continue;
      const page = b.location!.page as number;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page)!.push(t);
    }
    let text = "";
    const pages: SourcePage[] = [];
    for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
      if (text) text += "\n\n";
      const start = text.length;
      text += byPage.get(page)!.join("\n\n");
      pages.push({ page, start, end: text.length });
    }
    if (text.trim()) return { text, pages, format };
  }
  const text = String(doc.text ?? doc.markdown ?? blocks.map((b) => b.text ?? b.markdown ?? b.content).join("\n\n") ?? "").trim();
  return { text, pages: [{ page: 1, start: 0, end: text.length }], format };
}

/** Where the receipt sits in our text: the text_span offsets when they line up, else the first occurrence of the quote. */
function locate(doc: SourceDocument, quote: string, loc?: Location): { start: number | null; end: number | null; page: number | null } {
  if (loc && typeof loc.char_start === "number" && typeof loc.char_end === "number" && doc.text.slice(loc.char_start, loc.char_end) === quote) {
    const page = typeof loc.page === "number" ? loc.page : doc.pages.find((p) => loc.char_start! >= p.start && loc.char_start! <= p.end)?.page ?? null;
    return { start: loc.char_start, end: loc.char_end, page };
  }
  let idx = quote ? doc.text.indexOf(quote) : -1;
  let len = quote.length;
  if (idx < 0 && quote) {
    // tolerate whitespace differences between NDI's text and ours
    const pattern = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const m = pattern ? new RegExp(pattern).exec(doc.text) : null;
    if (m) { idx = m.index; len = m[0].length; }
  }
  const pageFromLoc = typeof loc?.page === "number" ? loc.page : null;
  if (idx < 0) return { start: null, end: null, page: pageFromLoc };
  const page = pageFromLoc ?? doc.pages.find((p) => idx >= p.start && idx <= p.end)?.page ?? null;
  return { start: idx, end: idx + len, page };
}

export interface NdiPerceiver extends Perceiver { warnings: string[] }

export function createNdiPerceiver(cfg: Config = getConfig(), fetchImpl?: typeof fetch): NdiPerceiver {
  const base = `${cfg.naceBaseUrl}/v1`;
  const wait = Math.min(100, Math.max(1, cfg.ndiWaitSeconds));
  const createTimeout = (wait + 30) * 1000;
  const auth = () => ({ Authorization: `Bearer ${cfg.naceApiKey}` });
  const usage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  function requireKey() {
    if (!cfg.naceApiKey) throw new ProviderError(PROVIDER, 401, "the API key is missing or wrong (set NACE_API_KEY)");
  }

  async function poll<R>(job: NdiJob<R>): Promise<NdiJob<R>> {
    let current = job;
    let delay = ndiSettings.pollStartMs;
    const deadline = Date.now() + ndiSettings.pollCapMs;
    while (!FINAL.includes(current.status)) {
      if (Date.now() + delay > deadline) throw new ProviderError(PROVIDER, null, `the ${job.kind ?? "document"} job was still ${current.status} after ${Math.round(ndiSettings.pollCapMs / 1000)} s`, true);
      await sleep(delay);
      delay = Math.min(ndiSettings.pollMaxMs, delay * 2);
      current = await requestJson<NdiJob<R>>(`${base}/documents/jobs/${encodeURIComponent(job.job_id)}`, { headers: auth() }, { provider: PROVIDER, timeoutMs: 30_000, fetchImpl });
    }
    if (current.status !== "succeeded") throw new ProviderError(PROVIDER, null, jobError(current));
    return current;
  }

  // `acc` counts this job toward one operation's usage: ground and profile run at the same time, so a before/after diff would mix them.
  async function createJob<R>(path: string, body: unknown, acc?: Usage): Promise<NdiJob<R>> {
    const job = await requestJson<NdiJob<R>>(
      `${base}${path}?wait_seconds=${wait}`,
      { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { provider: PROVIDER, timeoutMs: createTimeout, fetchImpl },
    );
    if (!job || typeof job !== "object" || !job.job_id || !job.status) throw new ProviderError(PROVIDER, 200, "the response was not a job");
    const done = FINAL.includes(job.status) ? job : await poll(job);
    if (done.status !== "succeeded") throw new ProviderError(PROVIDER, null, jobError(done));
    usage.requests += 1;
    usage.costUsd += jobCostUsd(done);
    if (acc) { acc.requests += 1; acc.costUsd += jobCostUsd(done); }
    return done;
  }

  async function upload(bytes: Uint8Array, name: string, mimeType: string): Promise<{ workspaceId: string; fileId: string }> {
    const path = `receipts/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName(name)}`;
    const grant = await requestJson<{ workspace_id?: string; upload_url?: string; token?: string }>(
      `${base}/documents/upload-grants`,
      { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ path, ttl_seconds: 600, total_size_bytes: bytes.byteLength }) },
      { provider: PROVIDER, timeoutMs: 30_000, fetchImpl },
    );
    if (!grant.upload_url || !grant.token) throw new ProviderError(PROVIDER, 200, "the upload grant had no upload_url or token");
    const uploadUrl = new URL(grant.upload_url, `${cfg.naceBaseUrl}/`).toString();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), safeName(name));
    form.append("metadata", JSON.stringify({ path })); // a text field holding JSON, not a file part
    // A grant works once, so the upload itself is not retried; a failure falls back to the built-in reader.
    let job = await requestJson<NdiJob<{ file?: { workspace_id?: string; file_id?: string } }>>(
      uploadUrl,
      { method: "POST", headers: { "X-Upload-Token": grant.token }, body: form },
      { provider: PROVIDER, timeoutMs: 120_000, retries: 0, fetchImpl },
    );
    if (job?.job_id && job.status && !FINAL.includes(job.status)) job = await poll(job);
    const file = job?.result?.file;
    if (!file?.file_id) throw new ProviderError(PROVIDER, 200, job?.status && job.status !== "succeeded" ? jobError(job) : "the upload response had no file_id");
    return { workspaceId: file.workspace_id ?? grant.workspace_id ?? "", fileId: file.file_id };
  }

  const perceiver: NdiPerceiver = {
    id: "ndi",
    label: "NDI",
    warnings: [],

    async parse(input: SourceInput): Promise<SourceDocument> {
      try {
        requireKey();
        let source: Record<string, string>;
        let name: string;
        let ids: { workspaceId?: string; fileId?: string } = {};
        if (input.kind === "url") {
          name = input.name || new URL(input.url).pathname.split("/").filter(Boolean).pop() || new URL(input.url).hostname;
          // NDI picks its reader from the file name's extension; a page URL often has none ("/wiki/Golden_Gate_Bridge").
          const fileName = /\.(pdf|html?|txt|md|json|csv|docx?|xlsx?|pptx?|rtf|xml|png|jpe?g)$/i.test(safeName(name)) ? safeName(name) : `${safeName(name)}.html`;
          source = { type: "url", url: input.url, file_name: fileName };
        } else {
          const bytes = input.kind === "text" ? new TextEncoder().encode(input.text) : input.bytes;
          name = input.kind === "text" ? input.name || "source.txt" : input.name;
          const mime = input.kind === "text" ? "text/plain" : input.mimeType || (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
          // text sources always upload as plain text, whatever their display name says (a sample's text is named "msa.pdf")
          const uploadName = input.kind === "text" && !/\.(txt|md|text)$/i.test(name) ? `${name.replace(/\.[a-z0-9]+$/i, "")}.txt` : name;
          ids = await upload(bytes, uploadName, mime);
          source = { type: "workspace_file", workspace_id: ids.workspaceId!, file_id: ids.fileId! };
        }
        const job = await createJob<ParseResult>("/documents/parse", { source, output: { formats: ["text", "markdown", "blocks"] } });
        const parsed = documentFromParse(job.result ?? {}, name);
        if (!parsed.text.trim()) throw new ProviderError(PROVIDER, 200, "the parse returned no text");
        return {
          name,
          format: parsed.format,
          text: parsed.text,
          pages: parsed.pages,
          parsedBy: "ndi",
          ndi: { parseJobId: job.job_id, workspaceId: ids.workspaceId, fileId: ids.fileId },
        };
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        const doc = await parseLocal(input); // throws the contract's 422s itself if the built-in reader can't read it either
        perceiver.warnings.push(`NDI could not read this source (${why}); used the built-in reader.`);
        return doc;
      }
    },

    async ground(doc: SourceDocument, claims: Claim[]): Promise<GroundResult> {
      const t0 = performance.now();
      const warnings: string[] = [];
      const used: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      if (!doc.ndi?.parseJobId && !doc.ndi?.fileId) {
        return {
          receipts: lexicalReceipts(doc, claims),
          latencyMs: Math.round(performance.now() - t0),
          warnings: ["NDI did not read this source, so receipts came from the built-in matcher."],
        };
      }
      requireKey();
      const receipts: Record<string, Receipt> = {};
      const failed: Claim[] = [];
      let useParseResult = Boolean(doc.ndi?.parseJobId);

      const groundBatch = async (batch: Array<{ claim: Claim; text: string }>, loose: boolean) => {
        const body = (src: Record<string, string>) => ({
          source: src,
          targets: batch.map((b) => ({ id: b.claim.id, text: b.text, semantic: true })),
          options: { max_matches: 1 },
        });
        let job: NdiJob<GroundResultBody>;
        try {
          job = await createJob<GroundResultBody>("/documents/ground", body(useParseResult ? { type: "parse_result", job_id: doc.ndi!.parseJobId! } : { type: "workspace_file", workspace_id: doc.ndi!.workspaceId!, file_id: doc.ndi!.fileId! }), used);
        } catch (err) {
          // Zero-retention accounts can't ground on a parse_result: retry once on the uploaded file itself.
          if (useParseResult && doc.ndi?.fileId && err instanceof ProviderError && err.status !== null && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 402) {
            useParseResult = false;
            job = await createJob<GroundResultBody>("/documents/ground", body({ type: "workspace_file", workspace_id: doc.ndi!.workspaceId!, file_id: doc.ndi!.fileId! }), used);
          } else {
            throw err;
          }
        }
        const targets = new Map((job.result?.targets ?? []).map((t) => [t.id, t]));
        const missing: Claim[] = [];
        for (const { claim: c } of batch) {
          const t = targets.get(c.id);
          if (!t || t.status === "failed") { if (!loose) failed.push(c); continue; }
          const m = (t.matches ?? []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
          if (t.status !== "found" || !m) { if (!loose) { receipts[c.id] = notFoundReceipt("semantic"); missing.push(c); } continue; }
          const quote = String(m.matched_text ?? "");
          const where = locate(doc, quote, m.location);
          receipts[c.id] = {
            status: "found",
            page: where.page,
            quote: quote || null,
            charStart: where.start,
            charEnd: where.end,
            method: loose ? "semantic-numbers-ignored" : m.match_method || "semantic",
            score: typeof m.confidence === "number" ? m.confidence : null,
            section: sectionFor(doc.text, where.start, where.end, quote || null),
            region: m.location ?? null,
          };
        }
        return missing;
      };

      // Pass 1: the sentences as written.
      const notFound: Claim[] = [];
      for (let i = 0; i < claims.length; i += GROUND_BATCH) {
        notFound.push(...(await groundBatch(claims.slice(i, i + GROUND_BATCH).map((c) => ({ claim: c, text: c.text })), false)));
      }
      // Pass 2: a sentence with a wrong number ("runs for five years") doesn't match its clause ("three (3) years").
      // Ask again with the numbers taken out, so a contradicted sentence still gets the clause it contradicts.
      const loose = notFound
        .map((c) => ({ claim: c, text: withoutNumbers(c.text).replace(/\s+/g, " ").trim() }))
        .filter((b) => b.text !== b.claim.text.replace(/\s+/g, " ").trim() && contentWords(b.text).length >= 3);
      for (let i = 0; i < loose.length; i += GROUND_BATCH) await groundBatch(loose.slice(i, i + GROUND_BATCH), true);

      if (failed.length) {
        Object.assign(receipts, lexicalReceipts(doc, failed));
        warnings.push(`NDI could not locate ${failed.length} sentence${failed.length === 1 ? "" : "s"}; used the built-in matcher.`);
      }
      return {
        receipts,
        latencyMs: Math.round(performance.now() - t0),
        usage: { ...used, costUsd: Math.round(used.costUsd * 1e8) / 1e8 },
        warnings,
      };
    },

    async profile(doc: SourceDocument): Promise<ProfileResult> {
      const t0 = performance.now();
      const used: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      if (!doc.ndi?.parseJobId && !doc.ndi?.fileId) return { documentType: null, keyFacts: [], latencyMs: 0, warnings: [] };
      requireKey();
      const warnings: string[] = [];
      const parseSrc = doc.ndi?.parseJobId ? { type: "parse_result", job_id: doc.ndi.parseJobId } : null;
      const fileSrc = doc.ndi?.fileId ? { type: "workspace_file", workspace_id: doc.ndi.workspaceId!, file_id: doc.ndi.fileId } : null;
      // Reuse the parse (no second parse to pay for); on a 4xx (e.g. zero-retention accounts) retry on the uploaded file.
      const run = async <R,>(path: string, rest: Record<string, unknown>) => {
        try {
          return await createJob<R>(path, { source: parseSrc ?? fileSrc, ...rest }, used);
        } catch (err) {
          if (parseSrc && fileSrc && err instanceof ProviderError && err.status !== null && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 402) {
            return createJob<R>(path, { source: fileSrc, ...rest }, used);
          }
          throw err;
        }
      };
      const [classified, extracted] = await Promise.allSettled([
        run<ClassifyBody>("/documents/classify", { classes: DOC_CLASSES, granularity: "document", output: { max_alternatives: 1, include_reason: true } }),
        run<ExtractBody>("/documents/extract", { schema: KEY_FACTS_SCHEMA, citations: { enabled: true, include_source_text: true } }),
      ]);

      let documentType: DocumentType | null = null;
      if (classified.status === "fulfilled") {
        const unit = classified.value.result?.units?.[0];
        const top = (unit?.labels ?? []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
        documentType = unit?.unknown || !top?.class_id
          ? { id: "other", label: "Other", confidence: null, reason: top?.reason ?? null }
          : { id: top.class_id, label: top.label || DOC_CLASSES.find((c) => c.id === top.class_id)?.label || top.class_id, confidence: typeof top.confidence === "number" ? top.confidence : null, reason: top.reason ?? null };
      } else {
        warnings.push(`NDI could not classify the document (${errText(classified.reason)}).`);
      }

      const keyFacts: KeyFact[] = [];
      if (extracted.status === "fulfilled") {
        const data = extracted.value.result?.data ?? {};
        for (const f of extracted.value.result?.fields ?? []) {
          const path = String(f.path ?? "");
          const m = path.match(/^\/([a-z_]+)(?:\/(\d+))?$/);
          if (!m) continue; // nested fields are covered by their array item
          const [, key, idx] = m;
          let label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
          let value: unknown = data[key];
          if (key === "key_figures") {
            if (idx === undefined) continue; // the array itself; its items come one by one
            const item = (Array.isArray(value) ? value[Number(idx)] : null) as { what?: string; value?: string } | null;
            if (!item?.value) continue;
            label = item.what || "Figure";
            value = item.value;
          }
          const status = f.status === "found" || f.status === "ambiguous" ? f.status : "not_found";
          const cite = (f.citations ?? []).find((c) => c.source_text) ?? f.citations?.[0];
          const quote = cite?.source_text ? String(cite.source_text) : null;
          const where = quote ? locate(doc, quote, cite?.location) : { start: null, end: null, page: typeof cite?.location?.page === "number" ? cite.location.page : null };
          keyFacts.push({
            field: path,
            label,
            value: value === null || value === undefined || value === "" ? null : String(value),
            status: value === null || value === undefined || value === "" ? "not_found" : status,
            page: where.page,
            quote,
            section: quote ? sectionFor(doc.text, where.start, where.end, quote) : null,
            confidence: typeof f.confidence === "number" ? f.confidence : null,
            charStart: where.start,
            charEnd: where.end,
          });
        }
      } else {
        warnings.push(`NDI could not extract the key facts (${errText(extracted.reason)}).`);
      }

      return {
        documentType,
        keyFacts,
        latencyMs: Math.round(performance.now() - t0),
        usage: { ...used, costUsd: Math.round(used.costUsd * 1e8) / 1e8 },
        warnings,
      };
    },
  };
  return perceiver;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
