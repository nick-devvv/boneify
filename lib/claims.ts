import type { Claim } from "./types";
import { splitSentences, wordCount } from "./text/sentences";

export const MIN_CLAIM_WORDS = 3;

/** AI-written text -> the sentences to check, ids s1, s2, ... Offsets point into `aiText`. Fragments under 3 words are skipped. */
export function extractClaims(aiText: string): Claim[] {
  const claims: Claim[] = [];
  for (const s of splitSentences(aiText)) {
    if (wordCount(s.text) < MIN_CLAIM_WORDS) continue;
    const index = claims.length;
    claims.push({ id: `s${index + 1}`, index, text: s.text, start: s.start, end: s.end });
  }
  return claims;
}
