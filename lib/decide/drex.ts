// Decider "drex": Nace's decision model. One of only two files that talk to Nace (the other is lib/perceive/ndi.ts).
//
// POST {NACE_BASE_URL}/v1/systemone   Authorization: Bearer {NACE_API_KEY}
//   body:     { model, state: { source_document, context }, questions: { s1: { type: "choice", instructions, criteria } } }
//   response: { model, answers: { s1: { type, choice, confidence, probabilities } }, usage: { input_tokens, output_tokens },
//               evaluation_time_ms, request_id }
// Limits: 1-512 questions, 4 MiB body, text-only state. 401 bad key, 402 no credit, 422 invalid, 429/529 retry with backoff.
// Only a 200 is billed, and only input tokens count.

import type { Claim, DecideContext, DecideResult, Decider, Probabilities, SourceDocument, Usage, Verdict } from "../types";
import { VERDICTS } from "../types";
import { getConfig, type Config } from "../config";
import { ProviderError } from "../errors";
import { requestJson } from "../http";
import { contextLine, CRITERIA, sentenceInstruction } from "./instructions";
import { normalise, toDecision, UNIFORM } from "./probabilities";

const PROVIDER = "Drex";
const DREX_TIMEOUT_MS = 90_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface DrexQuestion { type: "choice"; instructions: string; criteria: Record<Verdict, string> }
export interface DrexRequest { model: string; state: { source_document: string; context?: string }; questions: Record<string, DrexQuestion> }

interface DrexAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
}
interface DrexResponse {
  model?: string;
  answers?: Record<string, DrexAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  evaluation_time_ms?: number;
  request_id?: string;
}

/** The exact request body for one batch of claims. */
export function buildDrexRequest(model: string, doc: SourceDocument, claims: Claim[], ctx?: DecideContext): DrexRequest {
  const context = contextLine(ctx);
  const questions: Record<string, DrexQuestion> = {};
  for (const c of claims) questions[c.id] = { type: "choice", instructions: sentenceInstruction(c.text), criteria: { ...CRITERIA } };
  return { model, state: { source_document: doc.text, ...(context ? { context } : {}) }, questions };
}

/** Read one answer defensively: probabilities when present, else choice + confidence, else a yes/no noul answer. */
export function readDrexAnswer(a: DrexAnswer | undefined): Probabilities | null {
  if (!a || typeof a !== "object") return null;
  if (a.probabilities && typeof a.probabilities === "object" && VERDICTS.some((v) => typeof a.probabilities![v] === "number")) {
    return normalise(a.probabilities as Partial<Record<Verdict, number>>);
  }
  if (typeof a.choice === "string" && (VERDICTS as readonly string[]).includes(a.choice)) {
    const conf = Math.min(1, Math.max(0, Number(a.confidence ?? 1)));
    const rest = (1 - conf) / 2;
    const p = { supported: rest, contradicted: rest, not_in_source: rest };
    p[a.choice as Verdict] = conf;
    return normalise(p);
  }
  if (typeof a.noul === "number") {
    const yes = Math.min(1, Math.max(0, a.noul));
    return normalise({ supported: yes, contradicted: 0, not_in_source: 1 - yes });
  }
  return null;
}

export function createDrexDecider(cfg: Config = getConfig(), fetchImpl?: typeof fetch): Decider {
  return {
    id: "drex",
    label: "Drex",
    model: cfg.drexModel,
    async decide(doc: SourceDocument, claims: Claim[], ctx?: DecideContext): Promise<DecideResult> {
      if (!cfg.naceApiKey) throw new ProviderError(PROVIDER, 401, "the API key is missing or wrong (set NACE_API_KEY)");
      const t0 = performance.now();
      const usage: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      let model = cfg.drexModel;
      const size = Math.min(512, Math.max(1, cfg.drexBatchSize));
      const batches: Claim[][] = [];
      for (let i = 0; i < claims.length; i += size) batches.push(claims.slice(i, i + size));

      const answers = await Promise.all(
        batches.map(async (batch) => {
          const body = JSON.stringify(buildDrexRequest(cfg.drexModel, doc, batch, ctx));
          if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
            throw new ProviderError(PROVIDER, 413, "the request is over Drex's 4 MiB limit (the source document is too long)");
          }
          const res = await requestJson<DrexResponse>(
            `${cfg.naceBaseUrl}/v1/systemone`,
            { method: "POST", headers: { Authorization: `Bearer ${cfg.naceApiKey}`, "Content-Type": "application/json" }, body },
            { provider: PROVIDER, timeoutMs: DREX_TIMEOUT_MS, fetchImpl },
          );
          if (!res || typeof res.answers !== "object" || res.answers === null) {
            throw new ProviderError(PROVIDER, 200, `the response had no answers${res?.request_id ? ` (request ${res.request_id})` : ""}`);
          }
          const input = Number(res.usage?.input_tokens ?? 0) || 0;
          usage.requests += 1;
          usage.inputTokens += input;
          usage.outputTokens += Number(res.usage?.output_tokens ?? 0) || 0;
          usage.costUsd += (input * cfg.drexPricePerMtok) / 1_000_000; // only input tokens are billed
          if (res.model) model = res.model;
          return res.answers;
        }),
      );

      const merged: Record<string, DrexAnswer> = Object.assign({}, ...answers);
      usage.costUsd = Math.round(usage.costUsd * 1e8) / 1e8;
      return {
        decisions: claims.map((c) => toDecision(c.id, readDrexAnswer(merged[c.id]) ?? { ...UNIFORM })),
        usage,
        latencyMs: Math.round(performance.now() - t0),
        model,
      };
    },
  };
}
