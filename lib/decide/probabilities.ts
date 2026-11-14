import type { Decision, Probabilities, Verdict } from "../types";
import { VERDICTS } from "../types";

export const UNIFORM: Probabilities = { supported: 1 / 3, contradicted: 1 / 3, not_in_source: 1 / 3 };

/** Clamp to >= 0 and rescale so the three verdicts add up to 1. All-zero or invalid input becomes uniform. */
export function normalise(p: Partial<Record<Verdict, unknown>>): Probabilities {
  const raw = VERDICTS.map((v) => {
    const n = Number(p[v]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...UNIFORM };
  const out = {} as Probabilities;
  VERDICTS.forEach((v, i) => (out[v] = Math.round((raw[i] / sum) * 1e6) / 1e6));
  return out;
}

/** The verdict is the highest probability; confidence is that probability. Ties go supported > contradicted > not_in_source. */
export function toDecision(claimId: string, probabilities: Probabilities): Decision {
  let verdict: Verdict = "supported";
  for (const v of VERDICTS) if (probabilities[v] > probabilities[verdict]) verdict = v;
  return { claimId, verdict, probabilities, confidence: probabilities[verdict] };
}
