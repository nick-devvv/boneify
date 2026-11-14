// The whole API with DECIDER=drex and PERCEIVER=ndi against the mock Nace server (in-process, localhost only, no keys).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockNace } from "../scripts/mock-nace";
import { checkDocument } from "../lib/pipeline";
import { getConfig, isMockNace } from "../lib/config";
import { httpSettings } from "../lib/http";
import { ndiSettings } from "../lib/perceive/ndi";
import { getSample, getSamplePdf } from "../lib/samples";

let mock: Awaited<ReturnType<typeof startMockNace>>;
let failing: Awaited<ReturnType<typeof startMockNace>>[] = [];

beforeAll(async () => {
  httpSettings.baseDelayMs = 1;
  ndiSettings.pollStartMs = 5;
  ndiSettings.pollMaxMs = 10;
  mock = await startMockNace({ port: 0 });
});
afterAll(async () => {
  await mock.close();
  for (const m of failing) await m.close();
});

const cfgFor = (url: string, extra: Record<string, string> = {}) =>
  getConfig({ DECIDER: "drex", PERCEIVER: "ndi", NACE_BASE_URL: url, NACE_API_KEY: "nace_sk_mock_000000000000000000000000000000000000000", ...extra });

describe("mock Nace server: the real Drex + NDI code end to end", () => {
  it("checks a PDF upload with Drex deciding and NDI reading + grounding", async () => {
    const s = await getSample("msa-summary");
    const cfg = cfgFor(mock.url);
    expect(isMockNace(cfg)).toBe(true);
    const r = await checkDocument({ source: { kind: "file", bytes: await getSamplePdf(s), name: "msa.pdf", mimeType: "application/pdf" }, aiText: s.aiText, context: s.context }, cfg);

    expect(r.engines).toEqual({ decider: "drex", deciderModel: "drex-max-v1.1", perceiver: "ndi" });
    expect(r.source).toMatchObject({ name: "msa.pdf", format: "pdf", pages: 3 });
    expect(r.warnings).toEqual([]);
    expect(r.usage.decide.requests).toBe(1);
    expect(r.usage.ground?.requests).toBe(1);
    expect(r.claims).toHaveLength(10);
    for (const c of r.claims) expect(c.receipt.method).toBe("semantic");
    const fee = r.claims.find((c) => c.text.includes("$18,500"))!;
    expect(fee.verdict).not.toBe("supported");
    expect(fee.receipt).toMatchObject({ status: "found", page: 2 });
    // NDI classify + extract ride along
    expect(r.documentType?.id).toBe("contract");
    expect(r.usage.profile?.requests).toBe(2);
    const facts = r.keyFacts.filter((k) => k.status === "found");
    expect(facts.length).toBeGreaterThan(0);
    for (const k of facts) expect(k.quote && k.page).toBeTruthy();
    expect(facts.some((k) => k.highlight)).toBe(true);
  });

  it("checks a text source (NDI upload as .txt) with text_span receipts", async () => {
    const s = await getSample("earnings-memo");
    const r = await checkDocument({ source: { kind: "text", text: s.sourceText, name: s.sourceName }, aiText: s.aiText }, cfgFor(mock.url));
    expect(r.warnings).toEqual([]);
    expect(r.source.format).toBe("text");
    const found = r.claims.filter((c) => c.receipt.status === "found");
    expect(found.length).toBeGreaterThan(0);
    for (const c of found) expect(c.receipt.charStart).not.toBeNull();
  });

  it("validates like the real API: 422 for a choice question without criteria, 401 without a nace_sk_ key", async () => {
    const res = await fetch(`${mock.url}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: "Bearer nace_sk_mock_000000000000000000000000000000000000000", "Content-Type": "application/json" },
      body: JSON.stringify({ state: "x", questions: { q: { type: "choice", instructions: "?" } } }),
    });
    expect(res.status).toBe(422);
    const noState = await fetch(`${mock.url}/v1/systemone`, { method: "POST", headers: { Authorization: "Bearer nace_sk_mock_000000000000000000000000000000000000000" }, body: JSON.stringify({ questions: {} }) });
    expect(noState.status).toBe(422);
    const bad = await fetch(`${mock.url}/v1/systemone`, { method: "POST", headers: { Authorization: "Bearer sk-wrong" }, body: "{}" });
    expect(bad.status).toBe(401);
  });

  it.each([
    [401, "Drex: the API key is missing or wrong"],
    [402, "Drex: out of credit"],
    [429, "Drex: too many requests (rate limited)"],
    [529, "Drex: the provider is overloaded or the request took too long"],
  ])("failure drill MOCK_FAIL=%i: Drex errors are readable and never hidden", async (code, message) => {
    const m = await startMockNace({ port: 0, fail: code });
    failing.push(m);
    const err = await checkDocument({ source: { kind: "text", text: "The fee is $12,500 per month." }, aiText: "The fee is $12,500 per month." }, cfgFor(m.url)).catch((e) => e);
    expect(err.name).toBe("ProviderError");
    expect(err.message).toContain(message);
  });

  it("NDI failure alone falls back to the built-in reader and matcher, with warnings", async () => {
    const m = await startMockNace({ port: 0, fail: 529 });
    failing.push(m);
    // Drex on the healthy mock, NDI on the failing one is not possible with one base URL,
    // so use the offline decider and only NDI on the failing server.
    const r = await checkDocument({ source: { kind: "text", text: "The fee is $12,500 per month." }, aiText: "The fee is $12,500 per month." }, cfgFor(m.url, { DECIDER: "local" }));
    expect(r.engines.perceiver).toBe("ndi");
    expect(r.claims[0].receipt.status).toBe("found");
    expect(r.warnings.join(" ")).toMatch(/NDI could not read this source .*used the built-in reader/);
  });

  it("one-call failure via the X-Mock-Fail header", async () => {
    const res = await fetch(`${mock.url}/v1/systemone`, { method: "POST", headers: { Authorization: "Bearer nace_sk_mock_000000000000000000000000000000000000000", "X-Mock-Fail": "529" }, body: "{}" });
    expect(res.status).toBe(529);
    expect(res.headers.get("retry-after")).toBe("0");
  });
});
