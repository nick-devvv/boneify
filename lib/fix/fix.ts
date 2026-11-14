// The fix loop (POST /api/fix): boneify checks the AI text, Intern rewrites the sentences it flagged using their receipts,
// then boneify checks the rewrite against the same document (read once, reused).
//
//   check (Drex decides, NDI finds receipts)  ->  Intern (DeepInfra writes, Drex makes Intern's decisions)  ->  re-check

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult, CheckedClaim, SourceDocument } from "../types";
import { getConfig, type Config } from "../config";
import { ApiError } from "../errors";
import { extractClaims } from "../claims";
import { checkDocument, LIMITS, type CheckInput } from "../pipeline";
import { contentWords } from "../text/similarity";
import { internProblem, runIntern, type InternRun } from "./intern";

export interface FixChange {
  claimId: string;             // the flagged sentence in `before`
  verdict: CheckedClaim["verdict"];
  before: string;
  after: string | null;        // the closest sentence in the fixed text, or null when Intern removed it
  evidence: string | null;     // the receipt Intern was given
}
export interface FixResult {
  fixedText: string;
  changes: FixChange[];
  before: CheckResult;
  after: CheckResult;
  intern: Omit<InternRun, "finalText"> & { reply: string };
  timings: { checkMs: number; internMs: number; recheckMs: number; totalMs: number };
}

export const FIX_PROMPT = [
  "Fix an AI-written summary so it only states what its source document says.",
  "Files in this folder: source.txt is the source document. draft.txt is the summary. issues.md lists the sentences a checker flagged, each with the source text it matched.",
  "Write fixed.txt: a copy of draft.txt where each sentence listed in issues.md is corrected using source.txt.",
  "- A sentence that contradicts the source: change the wrong number, name or fact to what the source says.",
  "- A sentence the source does not support: rewrite it to what the source actually says, or delete it if the source says nothing about it.",
  "Keep every other sentence exactly as written. Do not add new claims. Plain text only, no notes or markdown.",
  "After writing fixed.txt, reply with one short line per change.",
].join("\n");

const VERDICT_TEXT = { contradicted: "contradicts the source", not_in_source: "is not in the source", supported: "" } as const;

/** issues.md: one entry per flagged sentence, with the evidence boneify found (exported for tests). */
export function issuesMarkdown(flagged: CheckedClaim[]): string {
  return flagged.map((c, i) => {
    const r = c.receipt;
    const where = [r.section ? `§${r.section}` : null, r.page ? `p.${r.page}` : null].filter(Boolean).join(", ");
    const evidence = r.status === "found" && r.quote ? `   Source${where ? ` (${where})` : ""}: "${r.quote.replace(/\s+/g, " ").trim()}"` : "   Source: no matching text found.";
    return `${i + 1}. Sentence: "${c.text.trim()}"\n   Problem: it ${VERDICT_TEXT[c.verdict]} (confidence ${Math.round(c.confidence * 100)}%).\n${evidence}`;
  }).join("\n\n") + "\n";
}

/** Pair each flagged sentence with its closest sentence in the fixed text (exported for tests). */
export function pairChanges(flagged: CheckedClaim[], fixedText: string): FixChange[] {
  const fixed = extractClaims(fixedText);
  const draft = new Set(flagged.map((c) => c.text.trim()));
  const sim = (a: string, b: string) => {
    const A = new Set(contentWords(a));
    const B = new Set(contentWords(b));
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const w of A) if (B.has(w)) n++;
    return n / Math.min(A.size, B.size);
  };
  return flagged.map((c) => {
    let best: { text: string; s: number } | null = null;
    for (const f of fixed) {
      const s = sim(c.text, f.text);
      if (!best || s > best.s) best = { text: f.text.trim(), s };
    }
    const after = best && best.s >= 0.5 && !(draft.has(best.text) && best.text !== c.text.trim()) ? best.text : null;
    return { claimId: c.id, verdict: c.verdict, before: c.text.trim(), after, evidence: c.receipt.status === "found" ? c.receipt.quote : null };
  });
}

export async function fixDocument(input: CheckInput, cfg: Config = getConfig()): Promise<FixResult> {
  const t0 = performance.now();
  const problem = internProblem(cfg);
  if (problem) throw new ApiError(501, "intern_unavailable", problem);

  // 1. Check.
  let doc: SourceDocument | undefined;
  const before = await checkDocument({ ...input, onDocument: (d) => { doc = d; } }, cfg);
  const checkMs = Math.round(performance.now() - t0);
  const flagged = before.claims.filter((c) => c.verdict !== "supported");
  if (!flagged.length || !doc) {
    return {
      fixedText: input.aiText, changes: [], before, after: before,
      intern: { ok: true, reason: "nothing_to_fix", reply: "", turns: 0, durationMs: 0, system2: cfg.internSystem2, system1: cfg.internSystem1, system1Asks: 0, decisions: [], toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
      timings: { checkMs, internMs: 0, recheckMs: 0, totalMs: checkMs },
    };
  }

  // 2. Intern rewrites the flagged sentences, in a throwaway folder.
  const dir = await mkdtemp(join(tmpdir(), "boneify-fix-"));
  let run: InternRun;
  let fixedText: string;
  const tIntern = performance.now();
  try {
    await writeFile(join(dir, "source.txt"), doc.text);
    await writeFile(join(dir, "draft.txt"), input.aiText);
    await writeFile(join(dir, "issues.md"), issuesMarkdown(flagged));
    run = await runIntern(FIX_PROMPT, dir, cfg);
    fixedText = (await readFile(join(dir, "fixed.txt"), "utf8").catch(() => "")).trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  const internMs = Math.round(performance.now() - tIntern);
  if (!fixedText) throw new ApiError(502, "intern_failed", `Intern did not write the fixed text (it ended with "${run.reason}" after ${run.turns} turns).`);
  if (fixedText.length > LIMITS.aiTextChars) throw new ApiError(502, "intern_failed", "Intern's fixed text is too long to check.");

  // 3. Re-check the rewrite against the same document, without reading it again.
  const tRe = performance.now();
  const after = await checkDocument({ ...input, aiText: fixedText, parsedDoc: doc, skipProfile: true, compare: undefined }, cfg);
  after.documentType = before.documentType;
  after.keyFacts = before.keyFacts;
  const recheckMs = Math.round(performance.now() - tRe);

  const { finalText, ...rest } = run;
  return {
    fixedText,
    changes: pairChanges(flagged, fixedText),
    before,
    after,
    intern: { ...rest, reply: finalText.trim().slice(0, 2000) },
    timings: { checkMs, internMs, recheckMs, totalMs: Math.round(performance.now() - t0) },
  };
}
