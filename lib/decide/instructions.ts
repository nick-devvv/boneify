// Label wording shared by the LLM and Drex, so the benchmark is a fair fight (docs/MVP_SPEC.md, "Shared label wording").

import type { DecideContext, Verdict } from "../types";

export const CRITERIA: Record<Verdict, string> = {
  supported: "The source states or clearly implies everything in this sentence.",
  contradicted: "The sentence conflicts with the source: a wrong number, date, name, place, amount, or fact.",
  not_in_source: "The source does not mention some of this information; it was added, assumed, or made up.",
};

/** The per-sentence instruction (Drex question `instructions`). */
export function sentenceInstruction(sentence: string): string {
  return `Check this sentence from an AI-written text against the source document in the state. Judge only by the source; outside knowledge does not count as support. Sentence: "${sentence}"`;
}

/** One line describing how the AI text was produced, or "" when nothing is known. */
export function contextLine(ctx?: DecideContext): string {
  const parts: string[] = [];
  if (ctx?.task?.trim()) parts.push(`Writing task: ${ctx.task.trim().replace(/\.?$/, ".")}`);
  if (ctx?.question?.trim()) parts.push(`Question: ${ctx.question.trim()}`);
  return parts.join(" ");
}

export const LLM_SYSTEM_PROMPT = [
  "You check sentences from an AI-written text against a source document.",
  "For each sentence, give the probability of each of these three labels:",
  `- supported: ${CRITERIA.supported}`,
  `- contradicted: ${CRITERIA.contradicted}`,
  `- not_in_source: ${CRITERIA.not_in_source}`,
  "Judge only by the source; outside knowledge does not count as support.",
  'Respond with JSON only, in exactly this shape: {"s1": {"supported": 0.0, "contradicted": 0.0, "not_in_source": 0.0}, ...}. Each sentence\'s three numbers must add up to 1. Include every sentence id you were given.',
].join("\n");

export function llmUserPrompt(source: string, sentences: Array<{ id: string; text: string }>, ctx?: DecideContext): string {
  const lines = [`SOURCE DOCUMENT: <<<\n${source}\n>>>`];
  const c = [ctx?.task?.trim() && `Task: ${ctx.task.trim()}`, ctx?.question?.trim() && `Question: ${ctx.question.trim()}`].filter(Boolean);
  if (c.length) lines.push(`CONTEXT:\n${c.join("\n")}`);
  lines.push(`SENTENCES TO CHECK:\n${sentences.map((s) => `${s.id}: ${s.text.replace(/\s+/g, " ")}`).join("\n")}`);
  return lines.join("\n\n");
}
