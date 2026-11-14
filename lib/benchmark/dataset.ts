// RAGTruth -> per-sentence labels (docs/MVP_SPEC.md, "Turning marked spans into sentence labels").

import { readFile } from "node:fs/promises";
import type { Claim, DecideContext, Verdict } from "../types";
import { extractClaims } from "../claims";

export type RagTask = "QA" | "Summary" | "Data2txt";
export const TASKS: RagTask[] = ["QA", "Summary", "Data2txt"];

export interface RagSpan {
  start: number;
  end: number;
  type: "conflict" | "baseless";
  labelType: string;       // "Evident Conflict" | "Subtle Conflict" | "Evident Baseless Info" | "Subtle Baseless Info"
  implicitTrue: boolean;
  dueToNull: boolean;
  note: string;
}

export interface RagExample {
  id: string;
  sourceId: string;
  task: RagTask;
  writerModel: string;
  question: string | null;
  source: string;          // passages (QA), article (Summary) or pretty-printed JSON (Data2txt)
  response: string;        // the AI-written answer
  spans: RagSpan[];
}

export interface LabelledClaim extends Claim { gold: Verdict }

/** How each RAGTruth task's answer was produced, given to every decider as context. */
export const TASK_CONTEXT: Record<RagTask, string> = {
  QA: "Answer the question using only the passages in the source",
  Summary: "Summarize the news article in the source",
  Data2txt: "Write an objective overview of the local business described by the structured data in the source",
};

export function contextFor(ex: RagExample): DecideContext {
  return ex.task === "QA" && ex.question ? { task: TASK_CONTEXT.QA, question: ex.question } : { task: TASK_CONTEXT[ex.task] };
}

/**
 * Sentence labels: a sentence overlapping a conflict span is contradicted; one overlapping only baseless spans is not_in_source;
 * otherwise supported. Every span type counts, implicitTrue included (the RAGTruth authors' own convention).
 */
export function labelClaims(response: string, spans: RagSpan[]): LabelledClaim[] {
  return extractClaims(response).map((c) => {
    const hits = spans.filter((s) => s.start < c.end && c.start < s.end);
    const gold: Verdict = hits.some((s) => s.type === "conflict") ? "contradicted" : hits.length ? "not_in_source" : "supported";
    return { ...c, gold };
  });
}

/** An answer counts as wrong when it has any marked span at all. */
export const answerIsWrong = (ex: RagExample) => ex.spans.length > 0;

export async function loadExamples(file: string): Promise<RagExample[]> {
  const text = await readFile(file, "utf8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RagExample);
}

// ---------------------------------------------------------------- conversion from the raw RAGTruth files

export interface RawResponse {
  id: string; source_id: string; model: string; split: string; quality: string; response: string;
  labels: Array<{ start: number; end: number; text: string; meta: string | null; label_type: string; implicit_true: boolean; due_to_null: boolean }>;
}
export interface RawSource { source_id: string; task_type: string; source_info: unknown }

export function toExample(r: RawResponse, s: RawSource): RagExample {
  const task = s.task_type as RagTask;
  let source: string;
  let question: string | null = null;
  if (task === "QA") {
    const info = s.source_info as { question?: string; passages?: string };
    question = info.question ?? null;
    source = String(info.passages ?? "");
  } else if (task === "Data2txt") {
    source = JSON.stringify(s.source_info, null, 2);
  } else {
    source = String(s.source_info);
  }
  return {
    id: r.id,
    sourceId: r.source_id,
    task,
    writerModel: r.model,
    question,
    source,
    response: r.response,
    spans: r.labels.map((l) => ({
      start: l.start,
      end: l.end,
      type: /conflict/i.test(l.label_type) ? "conflict" : "baseless",
      labelType: l.label_type,
      implicitTrue: Boolean(l.implicit_true),
      dueToNull: Boolean(l.due_to_null),
      note: (l.meta ?? "").split("\n").slice(1).join(" ").trim(),
    })),
  };
}

/** Deterministic PRNG (mulberry32) so every run picks the same sample. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
