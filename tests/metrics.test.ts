import { describe, expect, it } from "vitest";
import { abstainCurve, computeMetrics, confusion, percentile, type ClaimResult, type ExampleResult } from "../lib/benchmark/metrics";
import type { Verdict } from "../lib/types";

const claim = (gold: Verdict, pred: Verdict, confidence = 0.9): ClaimResult => ({
  id: "s", text: "x", gold, pred, confidence, probabilities: { supported: 0, contradicted: 0, not_in_source: 0, [pred]: confidence } as never,
});

describe("confusion", () => {
  it("matches hand-worked precision, recall and F1", () => {
    // tp 3, fp 1, fn 2, tn 4  ->  P 0.75, R 0.6, F1 = 2*0.45/1.35 = 0.6667, acc 0.7
    const pairs = [
      ...Array(3).fill({ gold: true, pred: true }),
      { gold: false, pred: true },
      ...Array(2).fill({ gold: true, pred: false }),
      ...Array(4).fill({ gold: false, pred: false }),
    ];
    expect(confusion(pairs)).toEqual({ tp: 3, fp: 1, fn: 2, tn: 4, precision: 0.75, recall: 0.6, f1: 0.6667, accuracy: 0.7 });
  });

  it("is 0 rather than NaN when nothing is flagged", () => {
    expect(confusion([{ gold: true, pred: false }])).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });
});

describe("abstain curve", () => {
  it("reports coverage and accuracy above each threshold", () => {
    const claims = [
      claim("supported", "supported", 0.95), // right
      claim("contradicted", "contradicted", 0.85), // right
      claim("supported", "not_in_source", 0.65), // wrong
      claim("not_in_source", "supported", 0.55), // wrong
    ];
    const curve = abstainCurve(claims, [0.5, 0.6, 0.8, 0.9, 0.99]);
    expect(curve).toEqual([
      { threshold: 0.5, coverage: 1, accuracy: 0.5 },
      { threshold: 0.6, coverage: 0.75, accuracy: 0.6667 },
      { threshold: 0.8, coverage: 0.5, accuracy: 1 },
      { threshold: 0.9, coverage: 0.25, accuracy: 1 },
      { threshold: 0.99, coverage: 0, accuracy: 0 },
    ]);
  });
});

describe("computeMetrics", () => {
  const ex = (id: string, task: "QA" | "Summary", goldHallucinated: boolean, claims: ClaimResult[], latencyMs: number, error?: string): ExampleResult => ({
    id, task, writerModel: "m", goldHallucinated, latencyMs, usage: { requests: 1, inputTokens: 100, outputTokens: 10, costUsd: 0.001 }, claims, ...(error ? { error } : {}),
  });

  it("scores sentences, answers, three-way accuracy, latency, cost and tasks; skips failed answers", () => {
    const m = computeMetrics([
      ex("1", "QA", true, [claim("contradicted", "not_in_source"), claim("supported", "supported")], 100),
      ex("2", "Summary", false, [claim("supported", "contradicted"), claim("supported", "supported")], 300),
      ex("3", "Summary", true, [claim("not_in_source", "not_in_source")], 200),
      ex("4", "QA", false, [], 0, "LLM: too many requests"),
    ]);
    expect(m.examples).toBe(3);
    expect(m.failedExamples).toBe(1);
    expect(m.sentences).toBe(5);
    expect(m.wrongSentencesInKey).toBe(2);
    // sentences: tp 2 (s1 of ex1, ex3), fp 1, fn 0, tn 2
    expect(m.sentence).toMatchObject({ tp: 2, fp: 1, fn: 0, tn: 2, precision: 0.6667, recall: 1, f1: 0.8, threeWayAccuracy: 0.6 });
    // answers: ex1 gold+pred, ex2 pred only, ex3 gold+pred
    expect(m.response).toMatchObject({ tp: 2, fp: 1, fn: 0, tn: 0 });
    expect(m.latency).toEqual({ meanMs: 200, p50Ms: 200, p95Ms: 290, totalMs: 600 });
    expect(m.cost).toEqual({ totalUsd: 0.003, perThousandSentencesUsd: 0.6, requests: 3, inputTokens: 300, outputTokens: 30 });
    expect(m.byTask.QA!.examples).toBe(1);
    expect(m.byTask.Summary!.sentence.fp).toBe(1);
  });

  it("percentile interpolates", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([], 50)).toBe(0);
  });
});
