import { beforeAll, describe, expect, it } from "vitest";
import { createNdiPerceiver, documentFromParse, ndiSettings } from "../lib/perceive/ndi";
import { getConfig } from "../lib/config";
import { httpSettings } from "../lib/http";
import { extractClaims } from "../lib/claims";

beforeAll(() => {
  httpSettings.baseDelayMs = 1;
  ndiSettings.pollStartMs = 2;
  ndiSettings.pollMaxMs = 5;
});

const cfg = getConfig({ NACE_API_KEY: "nace_sk_test_1234567890", NACE_BASE_URL: "https://nace.test", NDI_WAIT_SECONDS: "60" });
const PAGE1 = "MASTER SERVICES AGREEMENT";
const PAGE2 = "Customer shall pay a monthly service fee of $12,500.";

interface Call { method: string; url: string; headers: Record<string, string>; body: any; form?: FormData }

/** A scripted NDI: records every call; jobs answer "running" once, then "succeeded" on the next poll. */
function fakeNdi(opts: { groundTargets?: (targets: any[]) => any[]; failGroundWith?: number; failExtractWith?: number } = {}) {
  const calls: Call[] = [];
  const jobs = new Map<string, { result: any; polls: number }>();
  const job = (id: string, result: any) => { jobs.set(id, { result, polls: 0 }); return { job_id: id, kind: id.split("_")[0], status: "running", result: null, error: null, cost: null }; };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  let grounds = 0;

  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init.method ?? "GET", url, headers, body: undefined };
    if (init.body instanceof FormData) call.form = init.body;
    else if (typeof init.body === "string") call.body = JSON.parse(init.body);
    calls.push(call);

    if (u.pathname === "/v1/documents/upload-grants") return json({ workspace_id: "ws_1", upload_url: "https://upload.nace.test/v1/workspaces/ws_1/files", token: "tok_1", expires_at: "x", max_bytes: null });
    if (u.host === "upload.nace.test") return json({ job_id: "upload_1", kind: "upload", status: "succeeded", result: { file: { workspace_id: "ws_1", file_id: "file_1" }, deduplicated: false } });
    if (u.pathname === "/v1/documents/parse") {
      return json(job("parse_1", { result_type: "parse", lane: "pdf", document: { page_count: 2, text: `${PAGE1}\n${PAGE2}`, markdown: "#", blocks: [
        { type: "title", text: PAGE1, location: { kind: "page_region", page: 1 } },
        { type: "text", text: PAGE2, location: { kind: "page_region", page: 2 } },
      ] } }), 202);
    }
    if (u.pathname === "/v1/documents/ground") {
      grounds++;
      if (opts.failGroundWith && grounds === 1) return json({ error: { message: "parse_result not allowed" } }, opts.failGroundWith);
      const targets = call.body.targets as any[];
      const out = opts.groundTargets ? opts.groundTargets(targets) : targets.map((t) => ({ id: t.id, status: "found", matches: [{ rank: 1, matched_text: PAGE2, match_method: "semantic", confidence: 0.88, location: { kind: "page_region", page: 2 } }] }));
      return json(job(`ground_${grounds}`, { result_type: "ground", targets: out }), 202);
    }
    if (u.pathname === "/v1/documents/classify") {
      return json(job("classify_1", { result_type: "classify", units: [{ granularity: "document", unknown: false, labels: [{ class_id: "contract", label: "Contract", rank: 1, reason: "Titled Master Services Agreement.", confidence: 0.99 }] }], unknown_units: 0 }), 202);
    }
    if (u.pathname === "/v1/documents/extract") {
      if (opts.failExtractWith) return json({ error: { message: "invalid_schema" } }, opts.failExtractWith);
      const cite = (page: number, text: string) => [{ location: { kind: "page_region", page, polygons: [] }, source_text: text }];
      return json(job("extract_1", { result_type: "extract",
        data: { title: PAGE1, parties: null, effective_date: null, key_figures: [{ what: "Monthly service fee", value: "$12,500" }] },
        fields: [
          { path: "/title", value: PAGE1, status: "found", confidence: 0.9, citations: cite(1, PAGE1) },
          { path: "/parties", value: null, status: "not_found", confidence: null, citations: [] },
          { path: "/effective_date", value: null, status: "not_found", confidence: null, citations: [] },
          { path: "/key_figures/0", value: '{"what": "Monthly service fee", "value": "$12,500"}', status: "found", confidence: 0.9, citations: cite(2, PAGE2) },
          { path: "/key_figures/0/value", value: "$12,500", status: "found", confidence: null, citations: [] },
        ] }), 202);
    }
    const m = u.pathname.match(/^\/v1\/documents\/jobs\/(.+)$/);
    if (m) {
      const j = jobs.get(m[1])!;
      j.polls++;
      return json({ job_id: m[1], kind: m[1].split("_")[0], status: j.polls >= 2 ? "succeeded" : "running", result: j.polls >= 2 ? j.result : null, error: null, cost: j.polls >= 2 ? 0.002 : null });
    }
    return json({ error: { message: "not found" } }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("NDI parse", () => {
  it("upload grant -> multipart with X-Upload-Token and a metadata text part -> parse with workspace_file, polling while running", async () => {
    const { f, calls } = fakeNdi();
    const ndi = createNdiPerceiver(cfg, f);
    const doc = await ndi.parse({ kind: "file", bytes: new Uint8Array([37, 80, 68, 70]), name: "msa.pdf", mimeType: "application/pdf" });

    const [grant, upload, parse, poll1, poll2] = calls;
    expect(grant.url).toBe("https://nace.test/v1/documents/upload-grants");
    expect(grant.headers.Authorization).toBe("Bearer nace_sk_test_1234567890");
    expect(grant.body).toMatchObject({ ttl_seconds: 600, total_size_bytes: 4 });
    expect(grant.body.path).toMatch(/^receipts\/\d+-[a-z0-9]+-msa\.pdf$/);

    expect(upload.url).toBe("https://upload.nace.test/v1/workspaces/ws_1/files");
    expect(upload.headers["X-Upload-Token"]).toBe("tok_1");
    expect(upload.form!.get("file")).toBeInstanceOf(Blob);
    expect(typeof upload.form!.get("metadata")).toBe("string"); // a text field, not a file part
    expect(JSON.parse(upload.form!.get("metadata") as string)).toEqual({ path: grant.body.path });

    expect(parse.url).toBe("https://nace.test/v1/documents/parse?wait_seconds=60");
    expect(parse.body).toEqual({ source: { type: "workspace_file", workspace_id: "ws_1", file_id: "file_1" }, output: { formats: ["text", "markdown", "blocks"] } });
    expect(poll1.url).toBe("https://nace.test/v1/documents/jobs/parse_1");
    expect(poll2.url).toBe("https://nace.test/v1/documents/jobs/parse_1");

    expect(doc).toMatchObject({ name: "msa.pdf", format: "pdf", parsedBy: "ndi", ndi: { parseJobId: "parse_1", workspaceId: "ws_1", fileId: "file_1" } });
    expect(doc.pages).toEqual([{ page: 1, start: 0, end: PAGE1.length }, { page: 2, start: PAGE1.length + 2, end: PAGE1.length + 2 + PAGE2.length }]);
    expect(doc.text.slice(doc.pages[1].start, doc.pages[1].end)).toBe(PAGE2);
    expect(ndi.warnings).toEqual([]);
  });

  it("uses a url source without uploading", async () => {
    const { f, calls } = fakeNdi();
    await createNdiPerceiver(cfg, f).parse({ kind: "url", url: "https://example.com/files/report.pdf" });
    expect(calls[0].url).toContain("/v1/documents/parse");
    expect(calls[0].body.source).toEqual({ type: "url", url: "https://example.com/files/report.pdf", file_name: "report.pdf" });
  });

  it("falls back to the built-in reader with a warning when NDI fails", async () => {
    const f = (async () => new Response('{"error":{"message":"down"}}', { status: 401 })) as unknown as typeof fetch;
    const ndi = createNdiPerceiver(cfg, f);
    const doc = await ndi.parse({ kind: "text", text: "The fee is $12,500.", name: "a.txt" });
    expect(doc.parsedBy).toBe("local");
    expect(ndi.warnings[0]).toMatch(/^NDI could not read this source \(NDI: the API key is missing or wrong.*\); used the built-in reader\.$/);
  });

  it("builds page offsets from block text, reading text, then markdown, then content", () => {
    const d = documentFromParse({ lane: "pdf", document: { blocks: [
      { markdown: "Page one", location: { kind: "page_region", page: 1 } },
      { content: "Page two", location: { kind: "page_region", page: 2 } },
    ] } }, "x.pdf");
    expect(d.text).toBe("Page one\n\nPage two");
    expect(d.pages).toEqual([{ page: 1, start: 0, end: 8 }, { page: 2, start: 10, end: 18 }]);
  });
});

describe("NDI ground", () => {
  async function parsed(f: typeof fetch) {
    const ndi = createNdiPerceiver(cfg, f);
    const doc = await ndi.parse({ kind: "file", bytes: new Uint8Array([1]), name: "msa.pdf", mimeType: "application/pdf" });
    return { ndi, doc };
  }

  it("grounds with the parse_result and semantic targets, in batches of 30", async () => {
    const { f, calls } = fakeNdi();
    const { ndi, doc } = await parsed(f);
    const aiText = Array.from({ length: 65 }, (_, i) => `Customer pays fee number ${i + 1}.`).join(" ");
    const claims = extractClaims(aiText);
    const g = await ndi.ground(doc, claims);

    const groundCalls = calls.filter((c) => c.url.includes("/v1/documents/ground"));
    expect(groundCalls.map((c) => c.body.targets.length)).toEqual([30, 30, 5]);
    expect(groundCalls[0].url).toBe("https://nace.test/v1/documents/ground?wait_seconds=60");
    expect(groundCalls[0].body.source).toEqual({ type: "parse_result", job_id: "parse_1" });
    expect(groundCalls[0].body.targets[0]).toEqual({ id: "s1", text: claims[0].text, semantic: true });
    expect(groundCalls[0].body.options).toEqual({ max_matches: 1 });

    const r = g.receipts.s1;
    expect(r).toMatchObject({ status: "found", page: 2, quote: PAGE2, method: "semantic", score: 0.88, region: { kind: "page_region", page: 2 } });
    expect(doc.text.slice(r.charStart!, r.charEnd!)).toBe(PAGE2);
    expect(Object.keys(g.receipts)).toHaveLength(65);
    expect(g.usage).toMatchObject({ requests: 3 });
    expect(g.warnings).toEqual([]);
  });

  it("maps not_found, and gives a failed target a built-in receipt with a warning", async () => {
    const { f } = fakeNdi({
      groundTargets: (ts) => ts.map((t, i) => (i === 0 ? { id: t.id, status: "not_found", matches: [] } : { id: t.id, status: "failed", error: "native_2_semantic_unavailable", matches: [] })),
    });
    const { ndi, doc } = await parsed(f);
    const g = await ndi.ground(doc, extractClaims("The vendor ships free cupcakes daily. Customer shall pay a monthly service fee."));
    expect(g.receipts.s1).toEqual({ status: "not_found", page: null, quote: null, charStart: null, charEnd: null, method: "semantic", score: null, section: null });
    expect(g.receipts.s2).toMatchObject({ status: "found", method: "lexical" });
    expect(g.warnings).toEqual(["NDI could not locate 1 sentence; used the built-in matcher."]);
  });

  it("retries on the uploaded file when parse_result is refused (zero-retention accounts)", async () => {
    const { f, calls } = fakeNdi({ failGroundWith: 422 });
    const { ndi, doc } = await parsed(f);
    const g = await ndi.ground(doc, extractClaims("Customer shall pay a monthly service fee."));
    const groundCalls = calls.filter((c) => c.url.includes("/v1/documents/ground"));
    expect(groundCalls.map((c) => c.body.source.type)).toEqual(["parse_result", "workspace_file"]);
    expect(g.receipts.s1.status).toBe("found");
  });

  it("asks again with numbers removed when a sentence isn't found (a wrong number shouldn't hide the clause it contradicts)", async () => {
    const { f, calls } = fakeNdi({
      groundTargets: (ts) => ts.map((t) => (/\d/.test(t.text)
        ? { id: t.id, status: "not_found", matches: [] }
        : { id: t.id, status: "found", matches: [{ rank: 1, matched_text: PAGE2, match_method: "semantic", confidence: 0.7, location: { kind: "page_region", page: 2 } }] })),
    });
    const { ndi, doc } = await parsed(f);
    const g = await ndi.ground(doc, extractClaims("Customer shall pay a monthly service fee of $18,500. The vendor ships free cupcakes."));
    const grounds = calls.filter((c) => c.url.includes("/v1/documents/ground"));
    expect(grounds).toHaveLength(2);
    expect(grounds[1].body.targets).toEqual([{ id: "s1", text: "Customer shall pay a monthly service fee of", semantic: true }]); // only the sentence that had numbers
    expect(g.receipts.s1).toMatchObject({ status: "found", page: 2, method: "semantic-numbers-ignored" });
    expect(g.receipts.s2.status).toBe("found"); // no digits: found on the first pass in this fake
  });

  it("uses the built-in matcher when NDI did not read the source", async () => {
    const ndi = createNdiPerceiver(cfg, fakeNdi().f);
    const doc = { name: "a.txt", format: "text", text: "Customer shall pay a monthly service fee.", pages: [{ page: 1, start: 0, end: 41 }], parsedBy: "local" };
    const g = await ndi.ground(doc, extractClaims("Customer shall pay a monthly service fee."));
    expect(g.receipts.s1.method).toBe("lexical");
    expect(g.warnings?.[0]).toMatch(/built-in matcher/);
  });
});

describe("NDI profile (classify + extract)", () => {
  const pdf = { kind: "file" as const, bytes: new Uint8Array([1, 2, 3]), name: "msa.pdf", mimeType: "application/pdf" };

  it("classifies and extracts on the parse result, with citations located in the text", async () => {
    const { f, calls } = fakeNdi();
    const ndi = createNdiPerceiver(cfg, f);
    const doc = await ndi.parse(pdf);
    const r = await ndi.profile!(doc);
    const classify = calls.find((c) => c.url.includes("/documents/classify"))!;
    const extract = calls.find((c) => c.url.includes("/documents/extract"))!;
    expect(classify.body.source).toEqual({ type: "parse_result", job_id: "parse_1" });
    expect(classify.body.classes.map((c: any) => c.id)).not.toContain("other");
    expect(extract.body.source).toEqual({ type: "parse_result", job_id: "parse_1" });
    expect(extract.body.schema.type).toBe("object");
    expect(r.documentType).toEqual({ id: "contract", label: "Contract", confidence: 0.99, reason: "Titled Master Services Agreement." });
    expect(r.keyFacts.map((k) => [k.field, k.label, k.value, k.status])).toEqual([
      ["/title", "Title", PAGE1, "found"],
      ["/parties", "Parties", null, "not_found"],
      ["/effective_date", "Effective date", null, "not_found"],
      ["/key_figures/0", "Monthly service fee", "$12,500", "found"],
    ]);
    const fee = r.keyFacts[3];
    expect(fee.page).toBe(2);
    expect(fee.quote).toBe(PAGE2);
    expect(doc.text.slice(fee.charStart!, fee.charEnd!)).toBe(PAGE2);
    expect(r.usage!.requests).toBe(2);
    expect(r.warnings).toEqual([]);
  });

  it("a failed extract keeps the document type and adds a warning", async () => {
    const { f } = fakeNdi({ failExtractWith: 500 });
    const ndi = createNdiPerceiver(cfg, f);
    const r = await ndi.profile!(await ndi.parse(pdf));
    expect(r.documentType?.id).toBe("contract");
    expect(r.keyFacts).toEqual([]);
    expect(r.warnings[0]).toMatch(/could not extract/);
  });

  it("skips NDI when the built-in reader read the source", async () => {
    const { f, calls } = fakeNdi();
    const ndi = createNdiPerceiver(cfg, f);
    const r = await ndi.profile!({ name: "x", format: "text", text: "hi", pages: [{ page: 1, start: 0, end: 2 }], parsedBy: "local" });
    expect(r).toMatchObject({ documentType: null, keyFacts: [] });
    expect(calls).toHaveLength(0);
  });
});
