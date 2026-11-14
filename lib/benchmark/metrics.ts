// Scoring against the RAGTruth answer key (docs/MVP_SPEC.md, "Scoring").
// "Positive" = the sentence (or answer) contains something wrong or made up. F1 is the headline: only ~9% of sentences are positive.

import type { Probabilities, Usage, Verdict } from "../types";
import type { RagTask } from "./dataset";

export interface ClaimResult { id: string; text: string; gold: Verdict; pred: Verdict; confidence: number; probabilities: Probabilities }
export interface ExampleResult {
  id: string;
  task: RagTask;
  writerModel: string;
  goldHallucinated: boolean;
  latencyMs: number;
  usage: Usage;
  claims: ClaimResult[];
  error?: string;
}

export interface Confusion { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; accuracy: number }
export interface SentenceScores extends Confusion { threeWayAccuracy: number }
export interface Metrics {
  examples: number;
  failedExamples: number;
  sentences: number;
  wrongSentencesInKey: number;
  sentence: SentenceScores;
  response: Confusion;
  latency: { meanMs: number; p50Ms: number; p95Ms: number; totalMs: number };
  cost: { totalUsd: number; perThousandSentencesUsd: number; requests: number; inputTokens: number; outputTokens: number };
  byTask: Partial<Record<RagTask, { examples: number; sentences: number; sentence: SentenceScores; response: Confusion; latency: Metrics["latency"]; cost: Metrics["cost"] }>>;
  abstain: Array<{ threshold: number; coverage: number; accuracy: number }>;
}

export const ABSTAIN_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function confusion(pairs: Array<{ gold: boolean; pred: boolean }>): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of pairs) {
    if (p.gold && p.pred) tp++;
    else if (!p.gold && p.pred) fp++;
    else if (p.gold && !p.pred) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const n = tp + fp + fn + tn;
  return { tp, fp, fn, tn, precision: r4(precision), recall: r4(recall), f1: r4(f1), accuracy: r4(n ? (tp + tn) / n : 0) };
}

export function sentenceScores(claims: ClaimResult[]): SentenceScores {
  const c = confusion(claims.map((x) => ({ gold: x.gold !== "supported", pred: x.pred !== "supported" })));
  const exact = claims.filter((x) => x.gold === x.pred).length;
  return { ...c, threeWayAccuracy: r4(claims.length ? exact / claims.length : 0) };
}

export function responseScores(examples: ExampleResult[]): Confusion {
  return confusion(examples.map((e) => ({ gold: e.goldHallucinated, pred: e.claims.some((c) => c.pred !== "supported") })));
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** At each threshold: the share of sentences auto-decided (confidence >= t) and the three-way accuracy on those. */
export function abstainCurve(claims: ClaimResult[], thresholds = ABSTAIN_THRESHOLDS) {
  return thresholds.map((t) => {
    const kept = claims.filter((c) => c.confidence >= t);
    return {
      threshold: t,
      coverage: r4(claims.length ? kept.length / claims.length : 0),
      accuracy: r4(kept.length ? kept.filter((c) => c.gold === c.pred).length / kept.length : 0),
    };
  });
}

function latencyOf(ok: ExampleResult[]): Metrics["latency"] {
  const lat = ok.map((e) => e.latencyMs);
  return {
    meanMs: Math.round(lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length)),
    p50Ms: Math.round(percentile(lat, 50)),
    p95Ms: Math.round(percentile(lat, 95)),
    totalMs: Math.round(lat.reduce((a, b) => a + b, 0)),
  };
}

function costOf(ok: ExampleResult[], sentences: number): Metrics["cost"] {
  const u = ok.reduce(
    (a, e) => ({ requests: a.requests + e.usage.requests, inputTokens: a.inputTokens + e.usage.inputTokens, outputTokens: a.outputTokens + e.usage.outputTokens, costUsd: a.costUsd + e.usage.costUsd }),
    { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
  return {
    totalUsd: Math.round(u.costUsd * 1e6) / 1e6,
    perThousandSentencesUsd: sentences ? Math.round((u.costUsd / sentences) * 1000 * 1e6) / 1e6 : 0,
    requests: u.requests,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
  };
}

export function computeMetrics(results: ExampleResult[]): Metrics {
  const ok = results.filter((e) => !e.error);
  const claims = ok.flatMap((e) => e.claims);
  const byTask: Metrics["byTask"] = {};
  for (const task of ["QA", "Summary", "Data2txt"] as RagTask[]) {
    const ex = ok.filter((e) => e.task === task);
    if (!ex.length) continue;
    const tc = ex.flatMap((e) => e.claims);
    byTask[task] = { examples: ex.length, sentences: tc.length, sentence: sentenceScores(tc), response: responseScores(ex), latency: latencyOf(ex), cost: costOf(ex, tc.length) };
  }
  return {
    examples: ok.length,
    failedExamples: results.length - ok.length,
    sentences: claims.length,
    wrongSentencesInKey: claims.filter((c) => c.gold !== "supported").length,
    sentence: sentenceScores(claims),
    response: responseScores(ok),
    latency: latencyOf(ok),
    cost: costOf(ok, claims.length),
    byTask,
    abstain: abstainCurve(claims),
  };
}
