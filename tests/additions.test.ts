// The four "front-end numbers" additions (docs/MVP_SPEC.md): benchmark dataset/improvement/?task, check compare, receipt.section, /api/split.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as check from "../app/api/check/route";
import * as split from "../app/api/split/route";
import * as bench from "../app/api/benchmark/route";
import { sectionFor } from "../lib/text/section";
import { checkDocument } from "../lib/pipeline";
import { getConfig } from "../lib/config";
import { improvement, type RunFile } from "../lib/benchmark/results";
import { getSample } from "../lib/samples";
import { startMockNace } from "../scripts/mock-nace";
import { httpSettings } from "../lib/http";
import { ndiSettings } from "../lib/perceive/ndi";

const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, body: unknown) =>
  route.POST(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("receipt.section", () => {
  it("finds the most specific clause number on the receipt's lines", () => {
    const text = "2. TERM\n2.1 Initial Term. The initial term is three (3) years.\n§3.2 Fees apply.\nArticle 4 Venue is Delaware.\nPlain sentence here.";
    const at = (q: string) => { const s = text.indexOf(q); return sectionFor(text, s, s + q.length, q); };
    expect(at("The initial term is three (3) years.")).toBe("2.1");
    expect(at("Fees apply.")).toBe("§3.2");
    expect(at("Venue is Delaware.")).toBe("Article 4");
    expect(at("Plain sentence here.")).toBeNull();
    expect(sectionFor(text, null, null, null)).toBeNull();
  });

  it("is set on the msa-summary sample's receipts", async () => {
    const r = await (await post(check, "/api/check", { sampleId: "msa-summary" })).json();
    const fee = r.claims.find((c: { text: string }) => c.text.includes("monthly service fee"));
    expect(fee.receipt.section).toBe("3.1");
    for (const c of r.claims) expect(c.receipt).toHaveProperty("section");
    expect(r.claims.filter((c: { receipt: { section: string | null } }) => c.receipt.section).length).toBeGreaterThanOrEqual(8);
  });
});

describe("POST /api/split", () => {
  it("returns the same claims the check uses", async () => {
    const s = await getSample("earnings-memo");
    const res = await (await post(split, "/api/split", { text: s.aiText })).json();
    const checked = await (await post(check, "/api/check", { sampleId: "earnings-memo" })).json();
    expect(res.count).toBe(checked.claims.length);
    expect(res.claims[0]).toEqual({ id: "s1", text: checked.claims[0].text, start: checked.claims[0].start, end: checked.claims[0].end });
  });

  it("errors use the contract's codes", async () => {
    expect((await post(split, "/api/split", {})).status).toBe(400);
    expect((await (await post(split, "/api/split", {})).json()).error.code).toBe("missing_ai_text");
    expect((await post(split, "/api/split", { text: "x".repeat(20_001) })).status).toBe(413);
    expect(await (await post(split, "/api/split", { text: "Fine." })).json()).toEqual({ count: 0, claims: [] });
  });
});

describe("POST /api/check with compare", () => {
  it("races a second decider offline: same claims, agreement and verdicts", async () => {
    const r = await (await post(check, "/api/check", { sampleId: "msa-summary", compare: "local" })).json();
    expect(r.comparison).toMatchObject({ decider: "local", model: "rules-v1", costUsd: 0, agreement: { same: 10, total: 10 } });
    expect(Object.keys(r.comparison.verdicts)).toEqual(r.claims.map((c: { id: string }) => c.id));
    expect(typeof r.comparison.decideMs).toBe("number");
  });

  it("is absent when not asked for, and null with a warning when the comparison decider fails", async () => {
    const plain = await (await post(check, "/api/check", { sampleId: "msa-summary" })).json();
    expect(plain).not.toHaveProperty("comparison");
    const failed = await post(check, "/api/check", { sampleId: "msa-summary", compare: "llm" }); // no LLM key in tests
    expect(failed.status).toBe(200);
    const body = await failed.json();
    expect(body.comparison).toBeNull();
    expect(body.warnings.join(" ")).toMatch(/comparison decider .*failed: LLM: the API key is missing/);
  });

  it("works with DECIDER=drex against the mock, comparing with the offline rules", async () => {
    httpSettings.baseDelayMs = 1;
    ndiSettings.pollStartMs = 5;
    ndiSettings.pollMaxMs = 10;
    const mock = await startMockNace({ port: 0 });
    try {
      const cfg = getConfig({ DECIDER: "drex", PERCEIVER: "local", NACE_BASE_URL: mock.url, NACE_API_KEY: "nace_sk_mock_000000000000000000000000000000000000000" });
      const s = await getSample("earnings-memo");
      const r = await checkDocument({ source: { kind: "text", text: s.sourceText }, aiText: s.aiText, compare: "local" }, cfg);
      expect(r.engines.decider).toBe("drex");
      expect(r.comparison).toMatchObject({ decider: "local", agreement: { total: r.claims.length } });
    } finally {
      await mock.close();
    }
  });

  it("an unknown compare engine is a 400", async () => {
    const res = await post(check, "/api/check", { sampleId: "msa-summary", compare: "gpt9" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unknown_engine");
  });
});

describe("GET /api/benchmark: dataset, improvement, ?task=", () => {
  const get = async (q = "") => (await bench.GET(new Request(`http://localhost/api/benchmark${q}`))).json();

  it("dataset facts come from the committed sample with the same labels the benchmark uses", async () => {
    const { dataset, runs } = await get();
    expect(dataset).toEqual({
      name: "RAGTruth", split: "test", seed: 2026, examples: 450,
      sentences: 3041,
      wrong: { total: 266, contradicted: 123, notInSource: 143 },
      writerModels: 6,
      byTask: { QA: { examples: 150, sentences: 926, wrong: 44 }, Summary: { examples: 150, sentences: 812, wrong: 46 }, Data2txt: { examples: 150, sentences: 1303, wrong: 176 } },
    });
    const local = runs.find((r: { run: string }) => r.run === "local");
    expect(local.dataset.sentences).toBe(dataset.sentences); // facts always match the runs
  });

  it("improvement compares the drex run with the first llm-* run once both exist", async () => {
    const { improvement, runs } = await get();
    const names = runs.map((r: { run: string }) => r.run);
    if (!names.includes("drex") || !names.some((n: string) => n.startsWith("llm-"))) return expect(improvement).toBeNull();
    expect(improvement).toMatchObject({ drex: "drex", baseline: expect.stringMatching(/^llm-/) });
    for (const k of ["speedup", "costRatio", "f1Delta", "precisionDelta", "recallDelta"]) expect(typeof improvement[k]).toBe("number");
  });

  it("?task= gives each row that task's numbers, and rejects unknown tasks", async () => {
    const qa = await get("?task=QA");
    const local = qa.runs.find((r: { run: string }) => r.run === "local");
    expect(local.dataset).toMatchObject({ examples: 150, sentences: 926 });
    expect(local.headline.p50LatencyMs).not.toBeNull();
    expect(typeof local.headline.sentenceF1).toBe("number");
    const bad = await bench.GET(new Request("http://localhost/api/benchmark?task=Poetry"));
    expect(bad.status).toBe(400);
  });
});

describe("improvement()", () => {
  const run = (name: string, f1: number, p: number, r: number, p50: number, perK: number): RunFile => ({
    run: name, label: name, decider: name.split("-")[0], model: "m", createdAt: "",
    dataset: { name: "RAGTruth", split: "test", examples: 1, seed: 2026 }, settings: { concurrency: 1, batchSize: null }, examples: [],
    metrics: {
      examples: 1, failedExamples: 0, sentences: 10, wrongSentencesInKey: 1,
      sentence: { tp: 0, fp: 0, fn: 0, tn: 0, precision: p, recall: r, f1, accuracy: 0, threeWayAccuracy: 0 },
      response: { tp: 0, fp: 0, fn: 0, tn: 0, precision: 0, recall: 0, f1: 0, accuracy: 0 },
      latency: { meanMs: p50, p50Ms: p50, p95Ms: p50, totalMs: p50 },
      cost: { totalUsd: 0, perThousandSentencesUsd: perK, requests: 0, inputTokens: 0, outputTokens: 0 },
      byTask: {}, abstain: [],
    },
  });

  it("fills speedup, costRatio and deltas from the two runs, and is null until both exist", () => {
    const runs = [run("drex", 0.6, 0.55, 0.66, 200, 0.03), run("llm-b", 0.5, 0.4, 0.7, 3000, 1.2), run("llm-a", 0.55, 0.5, 0.6, 2000, 0.6), run("local", 0.25, 0.15, 0.85, 2, 0)];
    expect(improvement(runs, { drexRun: "drex", baselineRun: "" })).toEqual({
      drex: "drex", baseline: "llm-a", speedup: 10, costRatio: 0.05, f1Delta: 0.05, precisionDelta: 0.05, recallDelta: 0.06,
    });
    expect(improvement(runs, { drexRun: "drex", baselineRun: "llm-b" })!.speedup).toBe(15);
    expect(improvement(runs.slice(1), { drexRun: "drex", baselineRun: "" })).toBeNull();
    expect(improvement([runs[0], runs[3]], { drexRun: "drex", baselineRun: "" })).toBeNull();
  });
});
