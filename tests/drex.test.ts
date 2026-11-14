import { beforeAll, describe, expect, it } from "vitest";
import { buildDrexRequest, createDrexDecider, readDrexAnswer } from "../lib/decide/drex";
import { CRITERIA } from "../lib/decide/instructions";
import { getConfig } from "../lib/config";
import { httpSettings } from "../lib/http";
import { ProviderError } from "../lib/errors";
import type { Claim, SourceDocument } from "../lib/types";

beforeAll(() => { httpSettings.baseDelayMs = 1; });

const doc: SourceDocument = { name: "msa.txt", format: "text", text: "The initial term is three (3) years.", pages: [{ page: 1, start: 0, end: 36 }], parsedBy: "local" };
const claims = (n: number): Claim[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, index: i, text: `Sentence ${i + 1} is here.`, start: 0, end: 1 }));
const cfg = (extra: Record<string, string> = {}) => getConfig({ NACE_API_KEY: "nace_sk_test_1234567890", NACE_BASE_URL: "https://nace.test", ...extra });

function drexFetch(answerFor: (id: string) => unknown = () => ({ type: "choice", choice: "supported", confidence: 0.9, probabilities: { supported: 0.9, contradicted: 0.06, not_in_source: 0.04 } })) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, answerFor(id)]));
    return new Response(JSON.stringify({ model: "drex-max-v1.1", answers, usage: { input_tokens: 1000, output_tokens: 7 }, evaluation_time_ms: 140, request_id: "req_x" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Drex request body", () => {
  it("matches the spec: questions keyed by claim id, type choice, the three criteria, state with source and context", () => {
    const body = buildDrexRequest("drex-latest", doc, [{ id: "s1", index: 0, text: "The agreement runs for five years.", start: 0, end: 34 }], { task: "Summarize the contract for a partner" });
    expect(body).toEqual({
      model: "drex-latest",
      state: { source_document: doc.text, context: "Writing task: Summarize the contract for a partner." },
      questions: {
        s1: {
          type: "choice",
          instructions: 'Check this sentence from an AI-written text against the source document in the state. Judge only by the source; outside knowledge does not count as support. Sentence: "The agreement runs for five years."',
          criteria: {
            supported: "The source states or clearly implies everything in this sentence.",
            contradicted: "The sentence conflicts with the source: a wrong number, date, name, place, amount, or fact.",
            not_in_source: "The source does not mention some of this information; it was added, assumed, or made up.",
          },
        },
      },
    });
    expect(Object.keys(body.questions.s1.criteria)).toEqual(Object.keys(CRITERIA));
  });

  it("leaves context out when there is none", () => {
    expect(buildDrexRequest("drex-latest", doc, claims(1)).state).toEqual({ source_document: doc.text });
  });
});

describe("Drex decider", () => {
  it("POSTs to {NACE_BASE_URL}/v1/systemone with the Bearer key and reads probabilities", async () => {
    const { f, calls } = drexFetch((id) => (id === "s2"
      ? { type: "choice", choice: "contradicted", confidence: 0.91, probabilities: { supported: 0.03, contradicted: 0.91, not_in_source: 0.06 } }
      : { type: "choice", choice: "supported", confidence: 0.9, probabilities: { supported: 0.9, contradicted: 0.06, not_in_source: 0.04 } }));
    const res = await createDrexDecider(cfg({ DREX_PRICE_PER_MTOK: "0.06" }), f).decide(doc, claims(2));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://nace.test/v1/systemone");
    expect(calls[0].headers.Authorization).toBe("Bearer nace_sk_test_1234567890");
    expect(Object.keys(calls[0].body.questions)).toEqual(["s1", "s2"]);
    expect(res.decisions[1]).toEqual({ claimId: "s2", verdict: "contradicted", probabilities: { supported: 0.03, contradicted: 0.91, not_in_source: 0.06 }, confidence: 0.91 });
    expect(res.model).toBe("drex-max-v1.1");
    expect(res.usage).toEqual({ requests: 1, inputTokens: 1000, outputTokens: 7, costUsd: 0.00006 }); // input tokens only
  });

  it("batches at DREX_BATCH_SIZE", async () => {
    const { f, calls } = drexFetch();
    const res = await createDrexDecider(cfg({ DREX_BATCH_SIZE: "100" }), f).decide(doc, claims(250));
    expect(calls.map((c) => Object.keys(c.body.questions).length)).toEqual([100, 100, 50]);
    expect(res.decisions).toHaveLength(250);
    expect(res.usage.requests).toBe(3);
  });

  it("reads answers defensively: choice + confidence, noul, or missing", () => {
    expect(readDrexAnswer({ choice: "not_in_source", confidence: 0.8 })).toEqual({ supported: 0.1, contradicted: 0.1, not_in_source: 0.8 });
    expect(readDrexAnswer({ type: "noul", noul: 0.7, confidence: 0.7 })).toEqual({ supported: 0.7, contradicted: 0, not_in_source: 0.3 });
    expect(readDrexAnswer(undefined)).toBeNull();
    expect(readDrexAnswer({ probabilities: { supported: 2, contradicted: 1, not_in_source: 1 } })).toEqual({ supported: 0.5, contradicted: 0.25, not_in_source: 0.25 });
  });

  it("turns a 401 into a readable ProviderError without retrying", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response('{"error":{"type":"authentication_error","message":"Invalid API key"}}', { status: 401 }); }) as unknown as typeof fetch;
    const err = await createDrexDecider(cfg(), f).decide(doc, claims(1)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe("Drex: the API key is missing or wrong (HTTP 401: Invalid API key)");
    expect(n).toBe(1);
  });

  it("explains 402 and retries 529", async () => {
    const f402 = (async () => new Response('{"error":{"message":"no credit"}}', { status: 402 })) as unknown as typeof fetch;
    await expect(createDrexDecider(cfg(), f402).decide(doc, claims(1))).rejects.toThrow("Drex: out of credit");
    let n = 0;
    const ok = drexFetch().f;
    const f529 = (async (u: string, i: RequestInit) => (++n < 3 ? new Response("busy", { status: 529 }) : ok(u, i))) as unknown as typeof fetch;
    const res = await createDrexDecider(cfg(), f529).decide(doc, claims(1));
    expect(n).toBe(3);
    expect(res.decisions[0].verdict).toBe("supported");
  });

  it("refuses to call without a key", async () => {
    await expect(createDrexDecider(getConfig({}), drexFetch().f).decide(doc, claims(1))).rejects.toThrow("Drex: the API key is missing or wrong (set NACE_API_KEY)");
  });
});
