// Reads a check request (JSON or multipart) into a CheckInput. Shared by POST /api/check and POST /api/fix.

import { z } from "zod";
import { ApiError } from "./errors";
import { LIMITS, type CheckInput } from "./pipeline";
import { getSample, getSamplePdf } from "./samples";
import type { DecideContext, SourceInput } from "./types";

const optStr = z.string().trim().max(200).optional();

const JsonBody = z.object({
  sourceText: z.string().optional(),
  sourceName: z.string().max(300).optional(),
  sourceUrl: z.string().optional(),
  sampleId: z.string().max(100).optional(),
  aiText: z.string().optional(),
  context: z.object({ task: z.string().max(2000).optional(), question: z.string().max(4000).optional() }).partial().optional(),
  task: z.string().max(2000).optional(),
  question: z.string().max(4000).optional(),
  decider: optStr,
  perceiver: optStr,
  compare: optStr,
  reviewThreshold: z.coerce.number().min(0).max(1).optional(),
});

function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function oneSource(found: string[]): void {
  if (found.length === 0) throw new ApiError(400, "missing_source", "Send one source: a file, sourceText, sourceUrl or sampleId.");
  if (found.length > 1) throw new ApiError(400, "two_sources", `Send exactly one source, not ${found.join(" and ")}.`);
}

function checkUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ApiError(400, "missing_source", "sourceUrl is not a valid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ApiError(400, "missing_source", "sourceUrl must be an http(s) URL.");
  return u.toString();
}

async function fromJson(req: Request): Promise<CheckInput> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "The request body is not valid JSON.");
  }
  const parsed = JsonBody.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, "invalid_request", `Invalid field "${first?.path.join(".") || "body"}": ${first?.message ?? "bad value"}.`);
  }
  const b = parsed.data;
  oneSource(["sourceText", "sourceUrl", "sampleId"].filter((k) => present(b[k as keyof typeof b])));

  let source: SourceInput;
  let pdfBytes: Uint8Array | undefined;
  let aiText = b.aiText;
  let context: DecideContext | undefined = b.context ?? (b.task || b.question ? { task: b.task, question: b.question } : undefined);
  if (present(b.sampleId)) {
    const s = await getSample(b.sampleId!.trim());
    source = { kind: "text", text: s.sourceText, name: s.sourceName };
    if (!present(aiText)) aiText = s.aiText;
    context = context ?? s.context;
    if (s.pdfFile) pdfBytes = await getSamplePdf(s);
  } else if (present(b.sourceUrl)) {
    source = { kind: "url", url: checkUrl(b.sourceUrl!), name: b.sourceName };
  } else {
    if (b.sourceText!.length > LIMITS.sourceChars) throw new ApiError(413, "too_large", `sourceText is over ${LIMITS.sourceChars.toLocaleString("en-US")} characters.`);
    source = { kind: "text", text: b.sourceText!, name: b.sourceName || "source.txt" };
  }
  return { source, aiText: aiText ?? "", context, decider: b.decider, perceiver: b.perceiver, compare: b.compare || undefined, reviewThreshold: b.reviewThreshold, pdfBytes };
}

async function fromForm(req: Request): Promise<CheckInput> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "invalid_request", "The multipart form could not be read.");
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  const file = form.get("file");
  const hasFile = file !== null && typeof file !== "string";
  oneSource([hasFile ? "file" : "", str("sourceText") ? "sourceText" : "", str("sourceUrl") ? "sourceUrl" : "", str("sampleId") ? "sampleId" : ""].filter(Boolean));

  const thresholdRaw = str("reviewThreshold");
  let reviewThreshold: number | undefined;
  if (thresholdRaw !== undefined) {
    reviewThreshold = Number(thresholdRaw);
    if (!Number.isFinite(reviewThreshold) || reviewThreshold < 0 || reviewThreshold > 1) throw new ApiError(400, "invalid_request", "reviewThreshold must be a number from 0 to 1.");
  }
  let context: DecideContext | undefined = str("task") || str("question") ? { task: str("task"), question: str("question") } : undefined;
  let aiText = str("aiText");
  let source: SourceInput;
  let pdfBytes: Uint8Array | undefined;

  if (hasFile) {
    const f = file as File;
    if (f.size > LIMITS.fileBytes) throw new ApiError(413, "too_large", "The file is over 4 MB.");
    if (f.size === 0) throw new ApiError(422, "empty_source", "The uploaded file is empty.");
    source = { kind: "file", bytes: new Uint8Array(await f.arrayBuffer()), name: f.name || "upload", mimeType: f.type || undefined };
  } else if (str("sampleId")) {
    const s = await getSample(str("sampleId")!.trim());
    source = { kind: "text", text: s.sourceText, name: s.sourceName };
    aiText = aiText ?? s.aiText;
    context = context ?? s.context;
    if (s.pdfFile) pdfBytes = await getSamplePdf(s);
  } else if (str("sourceUrl")) {
    source = { kind: "url", url: checkUrl(str("sourceUrl")!), name: str("sourceName") };
  } else {
    source = { kind: "text", text: str("sourceText")!, name: str("sourceName") || "source.txt" };
  }
  return { source, aiText: aiText ?? "", context, decider: str("decider"), perceiver: str("perceiver"), compare: str("compare"), reviewThreshold, pdfBytes };
}

/** The body of POST /api/check (or /api/fix), JSON or multipart, as a CheckInput. */
export async function readCheckInput(req: Request): Promise<CheckInput> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  return type.includes("multipart/form-data") ? fromForm(req) : fromJson(req);
}
