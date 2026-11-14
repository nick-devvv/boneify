import { beforeAll, describe, expect, it } from "vitest";
import { createLlmDecider, parseLlmAnswer } from "../lib/decide/llm";
import { getConfig } from "../lib/config";
import { httpSettings } from "../lib/http";
import type { Claim, SourceDocument } from "../lib/types";

beforeAll(() => { httpSettings.baseDelayMs = 1; });

const doc: SourceDocument = { name: "s.txt", format: "text", text: "The initial term is three (3) years.", pages: [{ page: 1, start: 0, end: 36 }], parsedBy: "local" };
const claims = (n: number): Claim[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, index: i, text: `Sentence number ${i + 1} here.`, start: 0, end: 1 }));

function chatFetch(answer: (ids: string[]) => string, usage: Record<string, number> = { prompt_tokens: 100, completion_tokens: 20 }) {
  const bodies: any[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const ids = [...String(body.messages[1].content).matchAll(/^(s\d+):/gm)].map((m) => m[1]);
    return new Response(JSON.stringify({ model: "gpt-x", choices: [{ message: { content: answer(ids) } }], usage }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, bodies };
}

describe("parseLlmAnswer", () => {
  it("parses fenced JSON and normalises to 1", () => {
    const { probs, missing } = parseLlmAnswer('```json\n{"s1": {"supported": 2, "contradicted": 1, "not_in_source": 1}}\n```', ["s1"]);
    expect(missing).toEqual([]);
    expect(probs.s1).toEqual({ supported: 0.5, contradicted: 0.25, not_in_source: 0.25 });
  });

  it("parses nested shapes: verdicts{} and results[]", () => {
    expect(parseLlmAnswer('{"verdicts": {"s1": {"supported": 0.9, "contradicted": 0.05, "not_in_source": 0.05}}}', ["s1"]).probs.s1.supported).toBe(0.9);
    const r = parseLlmAnswer('Here you go: {"results": [{"id": "s2", "probabilities": {"supported": 0.1, "contradicted": 0.8, "not in source": 0.1}}]} hope it helps', ["s2"]);
    expect(r.probs.s2.contradicted).toBe(0.8);
  });

  it("gives missing or garbled ids a uniform 1/3", () => {
    const { probs, missing } = parseLlmAnswer('{"s1": {"supported": 1, "contradicted": 0, "not_in_source": 0}}', ["s1", "s2"]);
    expect(missing).toEqual(["s2"]);
    expect(probs.s2.supported).toBeCloseTo(1 / 3, 5);
    expect(parseLlmAnswer("not json at all", ["s1"]).missing).toEqual(["s1"]);
  });
});

describe("LLM decider", () => {
  const cfg = getConfig({ LLM_API_KEY: "sk-test", LLM_MODEL: "gpt-x", LLM_PRICE_INPUT_PER_MTOK: "2", LLM_PRICE_OUTPUT_PER_MTOK: "8" });

  it("lists every sentence id, sends the source, temperature 0 and JSON mode", async () => {
    const { f, bodies } = chatFetch((ids) => JSON.stringify(Object.fromEntries(ids.map((id) => [id, { supported: 0.7, contradicted: 0.2, not_in_source: 0.1 }]))));
    const res = await createLlmDecider(cfg, f).decide(doc, claims(3), { task: "Summarize the contract" });
    expect(bodies).toHaveLength(1);
    const user = bodies[0].messages[1].content as string;
    for (const id of ["s1", "s2", "s3"]) expect(user).toContain(`${id}: Sentence number`);
    expect(user).toContain("SOURCE DOCUMENT: <<<\nThe initial term is three (3) years.\n>>>");
    expect(user).toContain("CONTEXT:\nTask: Summarize the contract");
    expect(bodies[0].temperature).toBe(0);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[0].messages[0].content).toContain("supported: The source states or clearly implies everything in this sentence.");
    expect(res.decisions.map((d) => d.verdict)).toEqual(["supported", "supported", "supported"]);
    expect(res.usage).toEqual({ requests: 1, inputTokens: 100, outputTokens: 20, costUsd: (100 * 2 + 20 * 8) / 1e6 });
    expect(res.model).toBe("gpt-x");
  });

  it("batches 40 sentences per call, sends the source in every call, and fills missing ids uniformly", async () => {
    const { f, bodies } = chatFetch((ids) => JSON.stringify(Object.fromEntries(ids.slice(1).map((id) => [id, { supported: 0.1, contradicted: 0.8, not_in_source: 0.1 }]))));
    const res = await createLlmDecider(cfg, f).decide(doc, claims(85));
    expect(bodies).toHaveLength(3);
    for (const b of bodies) expect(b.messages[1].content).toContain("SOURCE DOCUMENT");
    expect(res.decisions).toHaveLength(85);
    const s1 = res.decisions.find((d) => d.claimId === "s1")!;
    expect(s1.confidence).toBeCloseTo(1 / 3, 5); // missing -> low confidence
    expect(res.decisions.find((d) => d.claimId === "s2")!.verdict).toBe("contradicted");
  });

  it("uses usage.cost when the host reports it, and can leave out temperature and JSON mode", async () => {
    const c2 = getConfig({ LLM_API_KEY: "sk-test", LLM_TEMPERATURE: "none", LLM_JSON_MODE: "off" });
    const { f, bodies } = chatFetch(() => '{"s1":{"supported":1,"contradicted":0,"not_in_source":0}}', { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 });
    const res = await createLlmDecider(c2, f).decide(doc, claims(1));
    expect(bodies[0]).not.toHaveProperty("temperature");
    expect(bodies[0]).not.toHaveProperty("response_format");
    expect(res.usage.costUsd).toBe(0.0042);
  });

  it("counts hidden thinking tokens (total - prompt) as output", async () => {
    const { f } = chatFetch(() => '{"s1":{"supported":1,"contradicted":0,"not_in_source":0}}', { prompt_tokens: 100, completion_tokens: 4, total_tokens: 284 });
    const res = await createLlmDecider(cfg, f).decide(doc, claims(1));
    expect(res.usage.outputTokens).toBe(184);
    expect(res.usage.costUsd).toBe((100 * 2 + 184 * 8) / 1e6);
  });

  it("fails readably without a key or on a 401", async () => {
    await expect(createLlmDecider(getConfig({})).decide(doc, claims(1))).rejects.toThrow("LLM: the API key is missing or wrong");
    const f = (async () => new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 })) as unknown as typeof fetch;
    await expect(createLlmDecider(cfg, f).decide(doc, claims(1))).rejects.toThrow(/LLM: the API key is missing or wrong \(HTTP 401: Incorrect API key\)/);
  });
});
