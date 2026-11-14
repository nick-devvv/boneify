// Shared types. The shapes here are the API contract (docs/MVP_SPEC.md, "Data shapes"): do not rename fields.

export type Verdict = "supported" | "contradicted" | "not_in_source";
export const VERDICTS: readonly Verdict[] = ["supported", "contradicted", "not_in_source"] as const;
export type Probabilities = Record<Verdict, number>; // sums to 1

// One sentence of the AI-written text. Offsets point into that text.
export interface Claim { id: string; index: number; text: string; start: number; end: number } // id: "s1", "s2", ...

// The source document after reading. Page offsets point into `text`.
export interface SourcePage { page: number; start: number; end: number } // page is 1-based
export interface SourceDocument {
  name: string;
  format: string;            // "pdf" | "text" | "json" | "markdown" | "html" | NDI lane
  text: string;
  pages: SourcePage[];
  parsedBy: string;          // "local" | "ndi"
  ndi?: { parseJobId?: string; workspaceId?: string; fileId?: string }; // lets ground reuse the parse
}

export type SourceInput =
  | { kind: "text"; text: string; name?: string }
  | { kind: "file"; bytes: Uint8Array; name: string; mimeType?: string }
  | { kind: "url"; url: string; name?: string };

// Where the evidence for a claim lives.
export interface Receipt {
  status: "found" | "not_found";
  page: number | null;
  quote: string | null;      // the matching source text
  charStart: number | null;  // offsets into SourceDocument.text, when known
  charEnd: number | null;
  method: string;            // "lexical" | "exact" | "normalized" | "semantic"
  score: number | null;      // 0..1 when known
  section: string | null;    // clause number at the start of the matched paragraph ("2.1", "§3.2", "Article 4"), or null
  highlight?: Highlight | null; // where the quote sits on the PDF page, for Adobe PDF Embed highlights; null when no PDF or not found
  region?: unknown;          // raw NDI location (page polygons etc.)
}

// PDF points, origin bottom-left (Adobe's annotation coordinates). quadPoints: per line, upper-left, upper-right, lower-left, lower-right.
export interface Highlight { page: number; pageWidth: number; pageHeight: number; quadPoints: number[]; boundingBox: [number, number, number, number] }

export interface DecideContext { task?: string; question?: string } // how the AI text was produced
export interface Decision { claimId: string; verdict: Verdict; probabilities: Probabilities; confidence: number }
export interface Usage { requests: number; inputTokens: number; outputTokens: number; costUsd: number }
export interface DecideResult { decisions: Decision[]; usage: Usage; latencyMs: number; model: string }
export interface GroundResult { receipts: Record<string, Receipt>; latencyMs: number; usage?: Usage; warnings?: string[] }

// Swap point 1: who makes the call ("local" | "llm" | "drex")
export interface Decider {
  id: string; label: string; model: string;
  decide(doc: SourceDocument, claims: Claim[], ctx?: DecideContext): Promise<DecideResult>;
}

// Swap point 2: who reads the file and finds receipts ("local" | "ndi")
export interface Perceiver {
  id: string; label: string;
  parse(input: SourceInput): Promise<SourceDocument>;
  ground(doc: SourceDocument, claims: Claim[]): Promise<GroundResult>;
  profile?(doc: SourceDocument): Promise<ProfileResult>; // optional: what kind of document this is, and its key facts with citations
}

// What the document is (NDI classify) and the facts it states (NDI extract). Both optional extras: they never fail a check.
export interface DocumentType {
  id: string;                // "contract" | "financial_report" | "invoice" | "policy" | "article" | "other"
  label: string;             // "Contract"
  confidence: number | null; // 0..1
  reason: string | null;     // NDI's one-line reason
}
export interface KeyFact {
  field: string;             // JSON Pointer from NDI: "/parties", "/key_figures/0"
  label: string;             // "Parties", "Monthly service fee"
  value: string | null;      // as written in the document: "$12,500", "three (3) years"
  status: "found" | "not_found" | "ambiguous";
  page: number | null;
  quote: string | null;      // the source text NDI read it from
  section: string | null;    // clause number, when the quote starts one ("3.1")
  confidence: number | null;
  charStart: number | null;  // offsets into the parsed text, when the quote was found there
  charEnd: number | null;
  highlight?: Highlight | null; // where the quote sits on the PDF page (same shape as Receipt.highlight)
}
export interface ProfileResult { documentType: DocumentType | null; keyFacts: KeyFact[]; latencyMs: number; usage?: Usage; warnings: string[] }

// What POST /api/check returns.
export interface CheckedClaim extends Claim {
  verdict: Verdict; probabilities: Probabilities; confidence: number;
  needsReview: boolean;      // confidence below REVIEW_THRESHOLD
  receipt: Receipt;
}
export interface CheckResult {
  id: string; createdAt: string;
  engines: { decider: string; deciderModel: string; perceiver: string };
  source: { name: string; format: string; pages: number; characters: number };
  claims: CheckedClaim[];
  summary: { total: number; supported: number; contradicted: number; not_in_source: number;
             needsReview: number; trustScore: number }; // trustScore = % of sentences supported, 0..100
  timings: { parseMs: number; decideMs: number; groundMs: number; totalMs: number };
  usage: { decide: Usage; ground?: Usage; profile?: Usage };
  warnings: string[];        // e.g. "NDI could not locate 2 sentences; used the built-in matcher"
  comparison?: Comparison | null; // only when the request sent `compare`; null if that decider failed
  adobeDocId: string | null;        // pass as metaData.id to the Adobe PDF Embed API's previewFile; null when the source isn't a PDF
  adobeAnnotations: unknown[];      // ready-made Adobe highlight annotations, one per receipt with a box, coloured by verdict
  documentType: DocumentType | null; // NDI classify; null with the built-in reader or if classify failed
  keyFacts: KeyFact[];               // NDI extract, each with its citation; [] with the built-in reader or if extract failed
}

// A second decider raced on the same parsed document and claims (POST /api/check with "compare").
export interface Comparison {
  decider: string; model: string;
  decideMs: number; costUsd: number;
  agreement: { same: number; total: number };
  verdicts: Record<string, Verdict>;
}

export const EMPTY_USAGE: Usage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
