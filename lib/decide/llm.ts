// Decider "llm": tonight's "Giant". Any OpenAI-compatible chat completions API (OpenAI, OpenRouter, Gemini's OpenAI endpoint, ...).

import type { Claim, DecideContext, DecideResult, Decider, Probabilities, SourceDocument, Usage, Verdict } from "../types";
import { VERDICTS } from "../types";
import { getConfig, type Config } from "../config";
import { ProviderError } from "../errors";
import { requestJson } from "../http";
import { LLM_SYSTEM_PROMPT, llmUserPrompt } from "./instructions";
import { normalise, toDecision, UNIFORM } from "./probabilities";

export const LLM_BATCH_SIZE = 40;
const LLM_TIMEOUT_MS = 180_000;
const PROVIDER = "LLM";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; total_cost?: number };
  model?: string;
}

const ALIASES: Record<string, Verdict> = {
  supported: "supported", support: "supported", supports: "supported", entailed: "supported",
  contradicted: "contradicted", contradiction: "contradicted", contradicts: "contradicted", conflict: "contradicted",
  not_in_source: "not_in_source", notinsource: "not_in_source", "not in source": "not_in_source", baseless: "not_in_source",
  unsupported: "not_in_source", not_mentioned: "not_in_source",
};

function readProbabilities(v: unknown): Probabilities | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const inner = obj.probabilities && typeof obj.probabilities === "object" ? (obj.probabilities as Record<string, unknown>) : obj;
  const p: Partial<Record<Verdict, unknown>> = {};
  for (const [k, val] of Object.entries(inner)) {
    const verdict = ALIASES[k.toLowerCase().replace(/[-\s]+/g, "_")] ?? ALIASES[k.toLowerCase()];
    if (verdict) p[verdict] = val;
  }
  if (VERDICTS.every((x) => p[x] === undefined)) {
    // {"label": "contradicted", "confidence": 0.8}
    const label = typeof obj.label === "string" ? ALIASES[obj.label.toLowerCase()] : typeof obj.verdict === "string" ? ALIASES[obj.verdict.toLowerCase()] : undefined;
    if (!label) return null;
    const conf = Math.min(1, Math.max(0, Number(obj.confidence ?? 1)));
    const rest = (1 - conf) / 2;
    return normalise({ ...{ supported: rest, contradicted: rest, not_in_source: rest }, [label]: conf });
  }
  return normalise(p);
}

/** Strip code fences and parse the model's JSON; accepts {"s1":...}, {"verdicts":...} and {"results":[{"id":...}]}. */
export function parseLlmAnswer(content: string, ids: string[]): { probs: Record<string, Probabilities>; missing: string[] } {
  let text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    text = start >= 0 && end > start ? text.slice(start, end + 1) : "";
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  let map: Record<string, unknown> = {};
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const nested = d.verdicts ?? d.results ?? d.sentences ?? d.answers;
    if (Array.isArray(nested)) {
      for (const item of nested) if (item && typeof item === "object" && "id" in item) map[String((item as { id: unknown }).id)] = item;
    } else if (nested && typeof nested === "object") {
      map = nested as Record<string, unknown>;
    } else if (Array.isArray(data)) {
      for (const item of data as unknown[]) if (item && typeof item === "object" && "id" in item) map[String((item as { id: unknown }).id)] = item;
    } else {
      map = d;
    }
  }
  const probs: Record<string, Probabilities> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const p = readProbabilities(map[id]);
    if (p) probs[id] = p;
    else { probs[id] = { ...UNIFORM }; missing.push(id); }
  }
  return { probs, missing };
}

function contentOf(res: ChatResponse): string {
  const c = res.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p.text ?? "").join("");
  return "";
}

export function createLlmDecider(cfg: Config = getConfig(), fetchImpl?: typeof fetch): Decider {
  return {
    id: "llm",
    label: cfg.llmLabel,
    model: cfg.llmModel,
    async decide(doc: SourceDocument, claims: Claim[], ctx?: DecideContext): Promise<DecideResult> {
      if (!cfg.llmApiKey) throw new ProviderError(PROVIDER, 401, "the API key is missing or wrong (set LLM_API_KEY)");
      const t0 = performance.now();
      const usage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      let model = cfg.llmModel;

      const batches: Claim[][] = [];
      for (let i = 0; i < claims.length; i += LLM_BATCH_SIZE) batches.push(claims.slice(i, i + LLM_BATCH_SIZE));

      const results = await Promise.all(
        batches.map(async (batch) => {
          const body: Record<string, unknown> = {
            model: cfg.llmModel,
            messages: [
              { role: "system", content: LLM_SYSTEM_PROMPT },
              { role: "user", content: llmUserPrompt(doc.text, batch.map((c) => ({ id: c.id, text: c.text })), ctx) },
            ],
          };
          if (cfg.llmTemperature !== null) body.temperature = cfg.llmTemperature;
          if (cfg.llmJsonMode) body.response_format = { type: "json_object" };

          const res = await requestJson<ChatResponse>(
            `${cfg.llmBaseUrl}/chat/completions`,
            { method: "POST", headers: { Authorization: `Bearer ${cfg.llmApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
            { provider: PROVIDER, timeoutMs: LLM_TIMEOUT_MS, fetchImpl },
          );
          const prompt = res.usage?.prompt_tokens ?? 0;
          // Some hosts (Gemini's OpenAI endpoint) leave hidden "thinking" tokens out of completion_tokens but bill them as output;
          // they show up in total_tokens, so output = max(completion, total - prompt).
          const completion = Math.max(
            res.usage?.completion_tokens ?? 0,
            (res.usage?.total_tokens ?? 0) - prompt,
          );
          const reported = typeof res.usage?.cost === "number" ? res.usage.cost : typeof res.usage?.total_cost === "number" ? res.usage.total_cost : null;
          usage.requests += 1;
          usage.inputTokens += prompt;
          usage.outputTokens += completion;
          usage.costUsd += reported ?? (prompt * cfg.llmPriceInputPerMtok + completion * cfg.llmPriceOutputPerMtok) / 1_000_000;
          if (res.model) model = res.model;
          const content = contentOf(res);
          if (!content.trim()) throw new ProviderError(PROVIDER, 200, "the model returned an empty answer");
          return parseLlmAnswer(content, batch.map((c) => c.id)).probs;
        }),
      );

      const merged: Record<string, Probabilities> = Object.assign({}, ...results);
      usage.costUsd = Math.round(usage.costUsd * 1e8) / 1e8;
      return {
        decisions: claims.map((c) => toDecision(c.id, merged[c.id] ?? { ...UNIFORM })),
        usage,
        latencyMs: Math.round(performance.now() - t0),
        model,
      };
    },
  };
}
