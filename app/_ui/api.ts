// Browser-side calls to the Boneify API (docs/MVP_SPEC.md, "API contract").
// NEXT_PUBLIC_API_BASE lets the front end call an API hosted elsewhere; empty means same origin.

import type { CheckResult } from "../../lib/types";
import type { FixResult } from "../../lib/fix/fix";

export type { FixResult };

const BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");

export type RagTask = "QA" | "Summary" | "Data2txt";

export interface SampleInfo { id: string; title: string; description: string; sourceName: string; hasPdf: boolean }
export interface SampleFull extends SampleInfo { sourceText: string; aiText: string; pdfUrl?: string }
export interface Health {
  ok: boolean;
  defaults: { decider: string; perceiver: string; reviewThreshold: number };
  deciders: Array<{ id: string; label: string; model?: string; ready: boolean }>;
  perceivers: Array<{ id: string; label: string; ready: boolean }>;
  intern?: { label: string; system1?: string; system2?: string; ready: boolean; note?: string };
}
export interface Headline {
  sentenceF1: number | null; sentencePrecision: number | null; sentenceRecall: number | null; responseF1: number | null;
  threeWayAccuracy: number | null; p50LatencyMs: number | null; meanLatencyMs: number | null;
  costPerThousandSentencesUsd: number | null; totalCostUsd: number | null;
}
export interface RunRow { run: string; label: string; decider: string; model: string; createdAt: string; dataset: { examples: number; sentences: number }; headline: Headline }
export interface Dataset {
  name: string; split: string; seed: number; examples: number; sentences: number;
  wrong: { total: number; contradicted: number; notInSource: number }; writerModels: number;
  byTask: Record<RagTask, { examples: number; sentences: number; wrong: number }>;
}
export interface Improvement { drex: string; baseline: string; speedup: number | null; costRatio: number | null; f1Delta: number | null; precisionDelta: number | null; recallDelta: number | null }
export interface BenchmarkList { dataset: Dataset | null; runs: RunRow[]; improvement: Improvement | null }
export interface Confusion { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number }
export interface RunDetail {
  run: string; label: string;
  metrics: {
    sentence: Confusion; latency: { p50Ms: number };
    byTask: Partial<Record<RagTask, { sentence: Confusion }>>;
    abstain: Array<{ threshold: number; coverage: number; accuracy: number }>;
  };
}

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public network = false) { super(message); }
}

// What people see when something fails. Written here, never copied from the
// server, so a provider's raw error (or anything secret inside it) can't reach the page.
const PLAIN: Record<string, string> = {
  network: "Can’t reach Boneify right now. Check your connection and try again.",
  provider_error: "Drex or NDI didn’t answer. Try again in a minute.",
  provider_timeout: "Drex or NDI took too long. Try again in a minute.",
  internal_error: "Something broke on our side. Try again in a minute.",
  too_large: "That file is too big. Try one under 20 MB.",
  unsupported_file_type: "That file type isn’t supported. Try a PDF, Word file, image or text.",
  unreadable_file: "We couldn’t read that file. Try a different copy of it.",
  empty_source: "The original looks empty. Try a different file.",
  missing_source: "Add the original first.",
  two_sources: "Pick one original: a sample or your file.",
  missing_ai_text: "Paste what the AI wrote.",
  no_sentences: "We couldn’t find any sentences in what the AI wrote.",
  sample_not_found: "That sample is gone. Pick another one.",
  intern_unavailable: "Fix with Intern only runs where the Intern app is installed.",
  intern_failed: "Intern couldn’t fix it this time.",
};

export function friendlyError(e: unknown): { text: string; code: string } {
  const f = e instanceof ApiFailure ? e : null;
  const code = f?.code || "error";
  return { text: PLAIN[code] ?? "Something went wrong. Try again.", code };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiFailure(0, "network", "Can’t reach the Boneify API.", true);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiFailure(res.status, e?.code || "error", e?.message || `The API answered ${res.status}.`);
  }
  return body as T;
}

export const getHealth = () => call<Health>("/api/health");
export const getSamples = () => call<{ samples: SampleInfo[] }>("/api/samples").then((r) => r.samples);
export const getSample = (id: string) => call<SampleFull>(`/api/samples/${encodeURIComponent(id)}`);
export const split = (text: string) =>
  call<{ count: number; claims: Array<{ id: string; text: string }> }>("/api/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
export const getBenchmark = (task?: RagTask) => call<BenchmarkList>(`/api/benchmark${task ? `?task=${task}` : ""}`);
export const getRun = (run: string) => call<RunDetail>(`/api/benchmark/${encodeURIComponent(run)}?limit=1`);

export type CheckInput =
  | { kind: "sample"; sampleId: string; aiText?: string; compare?: string }
  | { kind: "text"; sourceText: string; sourceName: string; aiText: string; compare?: string }
  | { kind: "file"; file: File; aiText: string; compare?: string };

function post<T>(path: string, input: CheckInput): Promise<T> {
  if (input.kind === "file") {
    const form = new FormData();
    form.append("file", input.file);
    form.append("aiText", input.aiText);
    if (input.compare) form.append("compare", input.compare);
    return call<T>(path, { method: "POST", body: form });
  }
  const body = input.kind === "sample"
    ? { sampleId: input.sampleId, ...(input.aiText ? { aiText: input.aiText } : {}), ...(input.compare ? { compare: input.compare } : {}) }
    : { sourceText: input.sourceText, sourceName: input.sourceName, aiText: input.aiText, ...(input.compare ? { compare: input.compare } : {}) };
  return call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export const check = (input: CheckInput) => post<CheckResult>("/api/check", input);
/** Fix with Intern: check, Intern rewrites the flagged sentences from their receipts, check again (about 30–40 s). */
export const fix = (input: CheckInput) => post<FixResult>("/api/fix", { ...input, compare: undefined });

/** Pick the Drex run and the big-AI baseline from the scoreboard rows, matching how the API's `improvement` picks them. */
export function pickRuns(list: BenchmarkList | null): { drex: RunRow | null; baseline: RunRow | null; rules: RunRow | null } {
  const runs = list?.runs ?? [];
  const drexId = list?.improvement?.drex;
  const baseId = list?.improvement?.baseline;
  const drex = runs.find((r) => r.run === drexId) ?? runs.find((r) => r.decider === "drex") ?? null;
  const baseline = runs.find((r) => r.run === baseId) ?? runs.find((r) => r.decider === "llm") ?? null;
  const rules = runs.find((r) => r.decider === "local") ?? null;
  return { drex, baseline, rules };
}
