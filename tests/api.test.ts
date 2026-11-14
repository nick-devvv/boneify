// Route handlers called directly: the API contract's error codes, CORS, and fixture keys == live response keys.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import * as health from "../app/api/health/route";
import * as check from "../app/api/check/route";
import * as samples from "../app/api/samples/route";
import * as sample from "../app/api/samples/[id]/route";
import * as bench from "../app/api/benchmark/route";
import * as run from "../app/api/benchmark/[run]/route";

const post = (body: unknown) => check.POST(new Request("http://localhost/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const form = (fields: Record<string, string | Blob>, filename?: string) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) typeof v === "string" ? fd.append(k, v) : fd.append(k, v, filename);
  return check.POST(new Request("http://localhost/api/check", { method: "POST", body: fd }));
};
async function expectError(res: Response | Promise<Response>, status: number, code: string) {
  const r = await res;
  expect(r.status).toBe(status);
  const body = await r.json();
  expect(body).toEqual({ error: { code, message: expect.any(String) } });
  expect(body.error.message.length).toBeGreaterThan(5);
}

/** Every key path in a JSON value; arrays contribute the union of their items' paths. */
function shape(v: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(v)) {
    for (const item of v) for (const p of shape(item, `${prefix}[]`)) out.add(p);
  } else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      out.add(`${prefix}.${k}`);
      for (const p of shape(val, `${prefix}.${k}`)) out.add(p);
    }
  }
  return out;
}
// Records keyed by data (per-task metrics, per-claim receipts) are compared by structure, not by which keys happen to exist.
const DATA_KEYED = /\.byTask\.(QA|Summary|Data2txt)/;
const norm = (s: Set<string>) => new Set([...s].map((p) => p.replace(DATA_KEYED, ".byTask.<task>")));
const fixture = async (name: string) => JSON.parse(await readFile(`data/fixtures/${name}`, "utf8"));

describe("fixtures match live responses (API shape is frozen)", () => {
  it("health.json", async () => {
    expect(norm(shape(await health.GET().json()))).toEqual(norm(shape(await fixture("health.json"))));
  });
  it("check-response.json", async () => {
    const live = await (await post({ sampleId: "msa-summary" })).json();
    expect(norm(shape(live))).toEqual(norm(shape(await fixture("check-response.json"))));
  });
  it("benchmark-list.json", async () => {
    const live = await (await bench.GET()).json();
    expect(live.runs.length).toBeGreaterThan(0);
    // compare one row's shape: runs can be added after the fixture was saved
    expect(norm(shape(live.runs[0]))).toEqual(norm(shape((await fixture("benchmark-list.json")).runs[0])));
  });
  it("benchmark-run.json", async () => {
    const live = await (await run.GET(new Request("http://localhost/api/benchmark/local?limit=5"), { params: Promise.resolve({ run: "local" }) })).json();
    expect(norm(shape(live))).toEqual(norm(shape(await fixture("benchmark-run.json"))));
  });
});

describe("POST /api/check errors", () => {
  it("400s", async () => {
    await expectError(post({ sourceText: "The fee is ten dollars." }), 400, "missing_ai_text");
    await expectError(post({ aiText: "The fee is ten dollars." }), 400, "missing_source");
    await expectError(post({ sourceText: "a b c", sourceUrl: "https://x.test/a", aiText: "The fee is ten." }), 400, "two_sources");
    await expectError(post({ sourceText: "The fee is ten.", aiText: "Fine." }), 400, "no_sentences");
    await expectError(post({ sourceText: "The fee is ten.", aiText: "The fee is ten.", decider: "gpt9" }), 400, "unknown_engine");
    await expectError(post({ sourceText: "The fee is ten.", aiText: "The fee is ten.", perceiver: "ocr" }), 400, "unknown_engine");
    await expectError(post("{not json"), 400, "invalid_request");
  });
  it("404 for an unknown sample", async () => {
    await expectError(post({ sampleId: "nope" }), 404, "sample_not_found");
  });
  it("413 for oversized AI text", async () => {
    await expectError(post({ sourceText: "x", aiText: "The fee is ten dollars. ".repeat(1000) }), 413, "too_large");
  });
  it("422s for files that can't be read", async () => {
    await expectError(form({ file: new Blob(["x"]), aiText: "The fee is ten dollars." }, "deck.pptx"), 422, "unsupported_file_type");
    await expectError(form({ file: new Blob(["{oops"]), aiText: "The fee is ten dollars." }, "a.json"), 422, "unreadable_file");
    await expectError(form({ file: new Blob(["  "]), aiText: "The fee is ten dollars." }, "a.txt"), 422, "empty_source");
  });
  it("502 provider_error when the chosen decider's key is missing", async () => {
    await expectError(post({ sourceText: "The fee is ten.", aiText: "The fee is ten dollars.", decider: "drex" }), 502, "provider_error");
  });
});

describe("other routes", () => {
  it("multipart upload works and CORS headers are on every response", async () => {
    const pdf = new Blob([new Uint8Array(await readFile("data/samples/msa.pdf"))], { type: "application/pdf" });
    const res = await form({ file: pdf, aiText: "The monthly service fee is $12,500." }, "msa.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.source).toMatchObject({ name: "msa.pdf", format: "pdf", pages: 3 });
    const opt = check.OPTIONS();
    expect(opt.status).toBe(204);
    expect(opt.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("samples list, one sample, its PDF, and 404s", async () => {
    const list = await (await samples.GET()).json();
    expect(list.samples.map((s: { id: string }) => s.id).sort()).toEqual(["earnings-memo", "msa-summary", "ragtruth-real"]);
    const one = await (await sample.GET(new Request("http://localhost/api/samples/msa-summary"), { params: Promise.resolve({ id: "msa-summary" }) })).json();
    expect(one).toMatchObject({ id: "msa-summary", pdfUrl: "/api/samples/msa-summary?format=pdf" });
    expect(one).not.toHaveProperty("pdfFile");
    const pdf = await sample.GET(new Request("http://localhost/api/samples/msa-summary?format=pdf"), { params: Promise.resolve({ id: "msa-summary" }) });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    await expectError(sample.GET(new Request("http://localhost/api/samples/x"), { params: Promise.resolve({ id: "../etc" }) }), 404, "sample_not_found");
  });

  it("benchmark run filters and 404s, and never serves mock runs", async () => {
    const r = await (await run.GET(new Request("http://localhost/api/benchmark/local?task=QA&onlyMistakes=true&limit=3&offset=1"), { params: Promise.resolve({ run: "local" }) })).json();
    expect(r).toMatchObject({ run: "local", offset: 1, limit: 3 });
    expect(r.examples.length).toBeLessThanOrEqual(3);
    for (const e of r.examples) {
      expect(e.task).toBe("QA");
      for (const c of e.claims) expect(c.gold).not.toBe(c.pred);
    }
    await expectError(run.GET(new Request("http://localhost/api/benchmark/x"), { params: Promise.resolve({ run: "nope" }) }), 404, "run_not_found");
    await expectError(run.GET(new Request("http://localhost/api/benchmark/x"), { params: Promise.resolve({ run: "drex-mock" }) }), 404, "run_not_found");
    const list = await (await bench.GET()).json();
    for (const row of list.runs) expect(row.run).not.toMatch(/-mock$/);
  });

  it("health never reveals keys", async () => {
    const text = JSON.stringify(await health.GET().json());
    expect(text).not.toMatch(/nace_sk_|sk-|AQ\./);
  });
});
