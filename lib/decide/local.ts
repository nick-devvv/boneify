// Decider "local": simple rules, offline. No key, no cost. A baseline row on the scoreboard and the engine the tests use.
//
// 1. Index the source as sentences (or key: value lines for JSON) with BM25.
// 2. Word coverage of each claim against the top 2 source sentences and against the whole document.
// 3. A number in the claim that is missing from the source means contradicted if the best match has a different number, else not_in_source.
// 4. Names missing from the source push toward not_in_source; a negation mismatch pushes toward contradicted.
// 5. A sigmoid on coverage gives P(supported); the rest is split between the other two by those signals.

import type { Claim, DecideResult, Decider, Probabilities, SourceDocument } from "../types";
import { BM25, contentWords, coverage, extractNames, extractNumbers, hasNegation, numberMentions, sourceUnits, withoutNumbers } from "../text/similarity";
import { normalise, toDecision } from "./probabilities";

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface LocalSignals {
  coverageTop: number;
  coverageDoc: number;
  missingNumbers: string[];
  conflictingNumbers: boolean;
  missingNames: string[];
  negationMismatch: boolean;
}

export function scoreClaim(claim: string, index: BM25, docWords: Set<string>, docNumbers: Set<string>, docNames: Set<string>, docLower: string): { probabilities: Probabilities; signals: LocalSignals } {
  const query = withoutNumbers(claim).trim() || claim; // find the clause by its words, not by the numbers that may be wrong
  const top = index.search(query, 2);
  const near = index.search(query, 3); // the clauses this sentence is about
  const coverageTop = Math.max(0, ...top.map((t) => coverage(claim, t.unit.text)));
  const coverageDoc = coverage(claim, docWords);
  const best = top[0]?.unit.text ?? "";

  const nearNumbers = extractNumbers(near.map((t) => t.unit.text).join(" "));
  // Each number is checked against the clause its own words point to ("runs for five years" -> the term clause),
  // so a wrong number is caught even if the same number appears somewhere unrelated in the document.
  const missingNumbers: string[] = [];
  let conflictingNumbers = false;
  for (const m of numberMentions(claim)) {
    const before = claim.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-5).join(" ");
    const after = claim.slice(m.index + m.length).split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    const around = withoutNumbers(`${before} ${after}`).trim() || query;
    const clauses = index.search(around, 2).map((h) => h.unit.text).join(" ");
    const clauseNumbers = extractNumbers(clauses);
    if ([...m.values].some((v) => clauseNumbers.has(v))) continue;
    if ([...m.values].some((v) => nearNumbers.has(v)) && clauseNumbers.size === 0) continue;
    missingNumbers.push([...m.values][0]);
    if (clauseNumbers.size > 0) conflictingNumbers = true;
  }
  const absentFromDoc = missingNumbers.filter((n) => !docNumbers.has(n));

  const missingNames = [...extractNames(claim)].filter((n) => !docNames.has(n) && !docLower.includes(n));
  const negationMismatch = top.length > 0 && coverage(claim, best) >= 0.7 && hasNegation(claim) !== hasNegation(best);

  const cov = 0.6 * coverageTop + 0.4 * coverageDoc;
  let pSupported = sigmoid(10 * (cov - 0.5));
  if (absentFromDoc.length) pSupported *= 0.12;
  else if (missingNumbers.length) pSupported *= 0.3;
  if (missingNames.length) pSupported *= 0.35;
  if (negationMismatch) pSupported *= 0.3;
  if (contentWords(claim).length === 0) pSupported = 0.5;

  let wContra = 1 + (conflictingNumbers ? 4 : 0) + (negationMismatch ? 3 : 0) + (cov >= 0.5 ? 0.5 : 0);
  let wBaseless = 1 + (missingNumbers.length && !conflictingNumbers ? 4 : 0) + (missingNames.length ? 2 : 0) + 2 * (1 - cov);
  const rest = 1 - pSupported;
  const sum = wContra + wBaseless;
  const probabilities = normalise({
    supported: pSupported,
    contradicted: (rest * wContra) / sum,
    not_in_source: (rest * wBaseless) / sum,
  });
  return { probabilities, signals: { coverageTop, coverageDoc, missingNumbers, conflictingNumbers, missingNames, negationMismatch } };
}

export const localDecider: Decider = {
  id: "local",
  label: "Simple rules (offline)",
  model: "rules-v1",
  async decide(doc: SourceDocument, claims: Claim[]): Promise<DecideResult> {
    const t0 = performance.now();
    const index = new BM25(sourceUnits(doc.text, doc.format));
    const docWords = new Set(contentWords(doc.text));
    const docNumbers = extractNumbers(doc.text);
    const docNames = extractNames(doc.text);
    const docLower = doc.text.toLowerCase();
    const decisions = claims.map((c) => toDecision(c.id, scoreClaim(c.text, index, docWords, docNumbers, docNames, docLower).probabilities));
    return {
      decisions,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: Math.round(performance.now() - t0),
      model: "rules-v1",
    };
  },
};
