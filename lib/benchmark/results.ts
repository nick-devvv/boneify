// Benchmark results files in data/results/<run>.json. Mock runs (*-mock.json) and partial-progress dot files never reach the API.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../errors";
import type { Config } from "../config";
import type { ExampleResult, Metrics } from "./metrics";
import { labelClaims, loadExamples, TASKS, type RagTask } from "./dataset";

export interface RunFile {
  run: string;
  label: string;
  decider: string;
  model: string;
  createdAt: string;
  dataset: { name: string; split: string; examples: number; seed: number };
  settings: { concurrency: number; batchSize: number | null };
  metrics: Metrics;
  examples: ExampleResult[];
}

export const resultsDir = () => path.join(process.cwd(), "data", "results");
export const SAFE_RUN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
export const isMockRun = (name: string) => /-mock$/i.test(name.replace(/\.json$/i, ""));

export async function listRuns(): Promise<RunFile[]> {
  let files: string[] = [];
  try {
    files = await readdir(resultsDir());
  } catch {
    return [];
  }
  const runs: RunFile[] = [];
  for (const f of files.sort()) {
    if (!f.endsWith(".json") || f.startsWith(".") || isMockRun(f)) continue;
    try {
      runs.push(JSON.parse(await readFile(path.join(resultsDir(), f), "utf8")) as RunFile);
    } catch {
      /* skip unreadable files */
    }
  }
  return runs;
}

export async function getRun(name: string): Promise<RunFile> {
  if (!SAFE_RUN.test(name) || isMockRun(name)) throw new ApiError(404, "run_not_found", `No benchmark run called "${name}".`);
  try {
    return JSON.parse(await readFile(path.join(resultsDir(), `${name}.json`), "utf8")) as RunFile;
  } catch {
    throw new ApiError(404, "run_not_found", `No benchmark run called "${name}".`);
  }
}

type Headline = {
  sentenceF1: number | null; sentencePrecision: number | null; sentenceRecall: number | null; responseF1: number | null;
  threeWayAccuracy: number | null; p50LatencyMs: number | null; meanLatencyMs: number | null;
  costPerThousandSentencesUsd: number | null; totalCostUsd: number | null;
};

/** A run's headline numbers, overall or for one task (from metrics.byTask). Missing numbers are null, never guessed. */
export function headline(r: RunFile, task?: RagTask): Headline & { examples: number; sentences: number } {
  const m = r.metrics;
  const t = task ? m.byTask?.[task] : undefined;
  if (task && !t) {
    return { examples: 0, sentences: 0, sentenceF1: null, sentencePrecision: null, sentenceRecall: null, responseF1: null, threeWayAccuracy: null, p50LatencyMs: null, meanLatencyMs: null, costPerThousandSentencesUsd: null, totalCostUsd: null };
  }
  const src = t ?? m;
  const sentences = t ? (t.sentences ?? null) : m.sentences;
  return {
    examples: t ? t.examples : m.examples,
    sentences: sentences ?? 0,
    sentenceF1: src.sentence.f1,
    sentencePrecision: src.sentence.precision,
    sentenceRecall: src.sentence.recall,
    responseF1: src.response.f1,
    threeWayAccuracy: src.sentence.threeWayAccuracy,
    p50LatencyMs: src.latency?.p50Ms ?? null,
    meanLatencyMs: src.latency?.meanMs ?? null,
    costPerThousandSentencesUsd: src.cost?.perThousandSentencesUsd ?? null,
    totalCostUsd: src.cost?.totalUsd ?? null,
  };
}

export function summarise(r: RunFile, task?: RagTask) {
  const { examples, sentences, ...h } = headline(r, task);
  return {
    run: r.run,
    label: r.label,
    decider: r.decider,
    model: r.model,
    createdAt: r.createdAt,
    dataset: { name: r.dataset.name, split: r.dataset.split, examples, sentences },
    headline: h,
  };
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/**
 * Drex (DREX_RUN, default "drex") vs the baseline (BASELINE_RUN, default the first llm-* run).
 * speedup = baseline p50 / Drex p50; costRatio = Drex $/1k / baseline $/1k; deltas = Drex - baseline. null until both runs exist.
 */
export function improvement(runs: RunFile[], cfg: Pick<Config, "drexRun" | "baselineRun">, task?: RagTask) {
  const drex = runs.find((r) => r.run === cfg.drexRun);
  const base = cfg.baselineRun ? runs.find((r) => r.run === cfg.baselineRun) : runs.filter((r) => r.run.startsWith("llm-")).sort((a, b) => a.run.localeCompare(b.run))[0];
  if (!drex || !base) return null;
  const d = headline(drex, task);
  const b = headline(base, task);
  const div = (x: number | null, y: number | null) => (x !== null && y !== null && y > 0 ? r4(x / y) : null);
  const sub = (x: number | null, y: number | null) => (x !== null && y !== null ? r4(x - y) : null);
  return {
    drex: drex.run,
    baseline: base.run,
    speedup: div(b.p50LatencyMs, d.p50LatencyMs),
    costRatio: div(d.costPerThousandSentencesUsd, b.costPerThousandSentencesUsd),
    f1Delta: sub(d.sentenceF1, b.sentenceF1),
    precisionDelta: sub(d.sentencePrecision, b.sentencePrecision),
    recallDelta: sub(d.sentenceRecall, b.sentenceRecall),
  };
}

// ---------------------------------------------------------------- the test set's facts, from the same labels the benchmark uses

export interface DatasetFacts {
  name: string; split: string; seed: number; examples: number; sentences: number;
  wrong: { total: number; contradicted: number; notInSource: number };
  writerModels: number;
  byTask: Record<string, { examples: number; sentences: number; wrong: number }>;
}

let factsCache: { mtimeMs: number; facts: DatasetFacts } | null = null;

export async function datasetFacts(): Promise<DatasetFacts | null> {
  const file = path.join(process.cwd(), "data", "ragtruth", "sample.jsonl");
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
  if (factsCache && factsCache.mtimeMs === mtimeMs) return factsCache.facts;
  const ex = await loadExamples(file);
  const facts: DatasetFacts = { name: "RAGTruth", split: "test", seed: 2026, examples: ex.length, sentences: 0, wrong: { total: 0, contradicted: 0, notInSource: 0 }, writerModels: new Set(ex.map((e) => e.writerModel)).size, byTask: {} };
  for (const t of TASKS) facts.byTask[t] = { examples: 0, sentences: 0, wrong: 0 };
  for (const e of ex) {
    const labels = labelClaims(e.response, e.spans);
    const contra = labels.filter((l) => l.gold === "contradicted").length;
    const baseless = labels.filter((l) => l.gold === "not_in_source").length;
    facts.sentences += labels.length;
    facts.wrong.contradicted += contra;
    facts.wrong.notInSource += baseless;
    const bt = facts.byTask[e.task];
    bt.examples += 1;
    bt.sentences += labels.length;
    bt.wrong += contra + baseless;
  }
  facts.wrong.total = facts.wrong.contradicted + facts.wrong.notInSource;
  factsCache = { mtimeMs, facts };
  return facts;
}
