// checkDocument(): read the source once, split the AI text, decide + ground in parallel, combine into a CheckResult.

import { randomUUID } from "node:crypto";
import type { CheckResult, CheckedClaim, Comparison, DecideContext, ProfileResult, Receipt, SourceDocument, SourceInput, Usage } from "./types";
import { getConfig, type Config } from "./config";
import { ApiError, redact } from "./errors";
import { extractClaims } from "./claims";
import { getDecider } from "./decide";
import { getPerceiver } from "./perceive";
import { detectKind, lexicalReceipts, notFoundReceipt, parseLocal } from "./perceive/local";
import { adobeAnnotations, adobeDocId, highlightFor, pdfLayout } from "./pdf/highlight";

export const LIMITS = {
  fileBytes: 4 * 1024 * 1024,
  sourceChars: 400_000,
  aiTextChars: 20_000,
  sentences: 200,
};

export interface CheckInput {
  source: SourceInput;
  aiText: string;
  context?: DecideContext;
  decider?: string;
  perceiver?: string;
  reviewThreshold?: number;
  compare?: string;          // race a second decider on the same document and claims
  pdfBytes?: Uint8Array;     // the PDF to place highlights on, when the source text came from a PDF (e.g. a sample)
  parsedDoc?: SourceDocument; // skip reading: reuse a document already read by the same perceiver (the fix loop's re-check)
  onDocument?: (doc: SourceDocument) => void; // receives the document once read
  skipProfile?: boolean;     // leave out NDI classify + extract (the fix loop's re-check copies them from the first check)
}

const ms = (t0: number) => Math.round(performance.now() - t0);

/** Time budgets that keep a check inside Vercel's 120 s limit even when a provider is slow (worst case about 35 + 75 s). */
export const BUDGET = {
  parseMs: 35_000,         // then the built-in reader takes over
  groundMs: 40_000,        // then the built-in matcher takes over
  decideMs: 75_000,        // then the check fails with a clear error (there are no verdicts without the decider)
  profileMs: 15_000,       // key facts (classify + extract, about 5 s) get this long from their start...
  profileGraceMs: 1_000,   // ...and at least this long after everything else; then they are left out
};

class Overtime extends Error {}
/** Resolves like `p`, or rejects with Overtime after `limit` ms. `p` keeps running; its late result is ignored. */
function within<T>(p: Promise<T>, limit: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Overtime()), limit); })]).finally(() => clearTimeout(timer));
}

export async function checkDocument(input: CheckInput, cfg: Config = getConfig()): Promise<CheckResult> {
  const tStart = performance.now();
  const aiText = input.aiText ?? "";
  if (!aiText.trim()) throw new ApiError(400, "missing_ai_text", "Paste the AI-written text to check.");
  if (aiText.length > LIMITS.aiTextChars) throw new ApiError(413, "too_large", `The AI text is over ${LIMITS.aiTextChars.toLocaleString("en-US")} characters.`);

  const claims = extractClaims(aiText);
  if (!claims.length) throw new ApiError(400, "no_sentences", "The AI text has no sentences of 3 words or more to check.");
  if (claims.length > LIMITS.sentences) throw new ApiError(413, "too_large", `The AI text has ${claims.length} sentences; the limit is ${LIMITS.sentences}.`);

  // Engines are resolved before any work, so a bad engine name fails fast.
  const decider = getDecider(input.decider, cfg);
  const perceiver = getPerceiver(input.perceiver, cfg);
  const rival = input.compare ? getDecider(input.compare, cfg) : null;
  const threshold = input.reviewThreshold ?? cfg.reviewThreshold;
  const warnings: string[] = [];

  // 1. Read the source once.
  const tParse = performance.now();
  let doc: SourceDocument;
  if (input.parsedDoc) doc = input.parsedDoc;
  else {
    try {
      doc = await within(perceiver.parse(input.source), BUDGET.parseMs);
    } catch (err) {
      if (!(err instanceof Overtime)) throw err;
      doc = await parseLocal(input.source);
      warnings.push(`${perceiver.label} took over ${BUDGET.parseMs / 1000} s to read the source; used the built-in reader.`);
    }
  }
  const parseMs = ms(tParse);
  input.onDocument?.(doc);
  if (perceiver.warnings?.length) warnings.push(...perceiver.warnings.splice(0));
  if (!doc.text.trim()) throw new ApiError(422, "empty_source", "The source document has no text.");
  if (doc.text.length > LIMITS.sourceChars) {
    throw new ApiError(413, "too_large", `The source has ${doc.text.length.toLocaleString("en-US")} characters after reading; the limit is ${LIMITS.sourceChars.toLocaleString("en-US")}.`);
  }

  // 2 + 3. Decide and ground at the same time. A decider failure is never hidden; a ground failure falls back to the built-in matcher.
  let decideMs = 0;
  let groundMs = 0;
  const decidePromise = (async () => {
    const t = performance.now();
    try {
      const r = await within(decider.decide(doc, claims, input.context), BUDGET.decideMs);
      decideMs = ms(t);
      return r;
    } catch (err) {
      if (err instanceof Overtime) throw new ApiError(504, "provider_timeout", `${decider.label} did not answer within ${BUDGET.decideMs / 1000} s. Try again.`);
      throw err;
    }
  })();
  const groundPromise = (async () => {
    const t = performance.now();
    try {
      const r = await within(perceiver.ground(doc, claims), BUDGET.groundMs);
      groundMs = ms(t);
      return r;
    } catch (err) {
      const why = err instanceof Overtime ? `no answer within ${BUDGET.groundMs / 1000} s` : err instanceof Error ? err.message : String(err);
      warnings.push(`${perceiver.label} could not find receipts (${why}); used the built-in matcher.`);
      const receipts = lexicalReceipts(doc, claims);
      groundMs = ms(t);
      return { receipts, latencyMs: groundMs, usage: undefined, warnings: [] as string[] };
    }
  })();
  // The comparison decider never fails the check: on error, comparison is null and a warning says why.
  const comparePromise = rival
    ? (async () => {
        const t = performance.now();
        try {
          const r = await within(rival.decide(doc, claims, input.context), BUDGET.decideMs);
          return { r, ms: ms(t) };
        } catch (err) {
          warnings.push(`The comparison decider (${rival.label}) failed: ${err instanceof Overtime ? `no answer within ${BUDGET.decideMs / 1000} s` : err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      })()
    : Promise.resolve(null);
  // What the document is and its key facts (NDI classify + extract). Optional: never fails the check.
  const profileStart = performance.now();
  const profilePromise: Promise<ProfileResult | null> = perceiver.profile && !input.skipProfile
    ? perceiver.profile(doc).catch((err) => {
        warnings.push(`${perceiver.label} could not profile the document (${err instanceof Error ? err.message : String(err)}).`);
        return null;
      })
    : Promise.resolve(null);
  const [decided, grounded, rivalRun] = await Promise.all([decidePromise, groundPromise, comparePromise]);
  // Key facts never hold the check up: they get a short grace period after everything else.
  const profileLeft = Math.max(BUDGET.profileGraceMs, BUDGET.profileMs - (performance.now() - profileStart));
  const profiled = await within(profilePromise, profileLeft).catch(() => {
    warnings.push(`${perceiver.label} key facts took too long and were left out.`);
    return null;
  });
  if (profiled?.warnings.length) warnings.push(...profiled.warnings);
  const keyFacts = profiled?.keyFacts ?? [];
  if (grounded.warnings?.length) warnings.push(...grounded.warnings);

  // 4. Combine.
  const byId = new Map(decided.decisions.map((d) => [d.claimId, d]));
  let missingReceipts = 0;
  const checked: CheckedClaim[] = claims.map((c) => {
    const d = byId.get(c.id);
    if (!d) throw new ApiError(500, "internal_error", `The decider returned no decision for ${c.id}.`);
    let receipt: Receipt | undefined = grounded.receipts[c.id];
    if (!receipt) {
      missingReceipts++;
      receipt = lexicalReceipts(doc, [c])[c.id] ?? notFoundReceipt();
    }
    return { ...c, verdict: d.verdict, probabilities: d.probabilities, confidence: d.confidence, needsReview: d.confidence < threshold, receipt };
  });
  // A sentence judged correct should always show its evidence: if the perceiver found none, use the built-in matcher.
  const bare = checked.filter((c) => c.verdict === "supported" && c.receipt.status === "not_found");
  if (bare.length) {
    const extra = lexicalReceipts(doc, bare);
    for (const c of bare) if (extra[c.id]?.status === "found") c.receipt = extra[c.id];
  }
  if (missingReceipts) warnings.push(`${perceiver.label} returned no receipt for ${missingReceipts} sentence${missingReceipts === 1 ? "" : "s"}; used the built-in matcher.`);

  // 5. Highlights on the PDF itself, for the Adobe viewer.
  const pdf = input.pdfBytes ?? (input.source.kind === "file" && detectKind(input.source.name, input.source.mimeType) === "pdf" ? input.source.bytes : undefined);
  let docId: string | null = null;
  let annotations: unknown[] = [];
  for (const c of checked) c.receipt = { ...c.receipt, highlight: null };
  for (const f of keyFacts) f.highlight = null;
  if (pdf) {
    try {
      const layout = await pdfLayout(pdf);
      const lineAround = (start: number | null, end: number | null) => {
        if (start === null) return null;
        const a = doc.text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        const nl = doc.text.indexOf("\n", end ?? start);
        return doc.text.slice(a, nl < 0 ? doc.text.length : nl);
      };
      for (const c of checked) {
        if (c.receipt.status !== "found") continue;
        c.receipt.highlight = highlightFor(layout, c.receipt.quote, c.receipt.page, lineAround(c.receipt.charStart, c.receipt.charEnd));
      }
      for (const f of keyFacts) {
        if (f.status === "not_found" || !f.quote) continue;
        f.highlight = highlightFor(layout, f.quote, f.page, lineAround(f.charStart, f.charEnd));
      }
      docId = adobeDocId(pdf);
      annotations = adobeAnnotations(docId, checked);
    } catch (err) {
      warnings.push(`Could not place highlights on the PDF (${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  let comparison: Comparison | null | undefined;
  if (rival) {
    if (!rivalRun) comparison = null;
    else {
      const verdicts: Comparison["verdicts"] = {};
      for (const d of rivalRun.r.decisions) verdicts[d.claimId] = d.verdict;
      comparison = {
        decider: rival.id,
        model: rivalRun.r.model || rival.model,
        decideMs: rivalRun.ms,
        costUsd: rivalRun.r.usage.costUsd,
        agreement: { same: checked.filter((c) => verdicts[c.id] === c.verdict).length, total: checked.length },
        verdicts,
      };
    }
  }

  const count = (v: string) => checked.filter((c) => c.verdict === v).length;
  const supported = count("supported");
  const usage: CheckResult["usage"] = { decide: decided.usage };
  if (grounded.usage) usage.ground = grounded.usage;
  if (profiled?.usage) usage.profile = profiled.usage;

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    engines: { decider: decider.id, deciderModel: decided.model || decider.model, perceiver: perceiver.id },
    source: { name: doc.name, format: doc.format, pages: Math.max(1, doc.pages.length), characters: doc.text.length },
    claims: checked,
    summary: {
      total: checked.length,
      supported,
      contradicted: count("contradicted"),
      not_in_source: count("not_in_source"),
      needsReview: checked.filter((c) => c.needsReview).length,
      trustScore: Math.round((supported / checked.length) * 100),
    },
    timings: { parseMs, decideMs, groundMs, totalMs: ms(tStart) },
    usage,
    warnings: warnings.map(redact),
    ...(comparison !== undefined ? { comparison } : {}),
    adobeDocId: docId,
    adobeAnnotations: annotations,
    documentType: profiled?.documentType ?? null,
    keyFacts,
  };
}
