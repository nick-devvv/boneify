// Perceiver "local": built-in reader (PDF via unpdf, TXT, MD, CSV, TSV, JSON, HTML) + BM25 word matching for receipts.

import type { Claim, GroundResult, Perceiver, Receipt, SourceDocument, SourceInput, SourcePage } from "../types";
import { ApiError, ProviderError } from "../errors";
import { BM25, coverage, sourceUnits } from "../text/similarity";
import { request } from "../http";
import { sectionFor } from "../text/section";

export const FOUND_COVERAGE = 0.3;
const HINT = "Switch PERCEIVER=ndi to read this file.";

type Kind = "pdf" | "text" | "markdown" | "csv" | "tsv" | "json" | "html";

const EXT: Record<string, Kind> = {
  pdf: "pdf", txt: "text", text: "text", md: "markdown", markdown: "markdown", csv: "csv", tsv: "tsv",
  json: "json", html: "html", htm: "html",
};
const MIME: Array<[RegExp, Kind]> = [
  [/pdf/, "pdf"], [/json/, "json"], [/html/, "html"], [/markdown/, "markdown"], [/csv/, "csv"],
  [/tab-separated/, "tsv"], [/^text\//, "text"],
];

export function detectKind(name: string, mimeType?: string): Kind | null {
  const ext = name.toLowerCase().split("?")[0].match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && EXT[ext]) return EXT[ext];
  if (mimeType) for (const [re, k] of MIME) if (re.test(mimeType.toLowerCase())) return k;
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalise(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function singlePage(text: string): SourcePage[] {
  return [{ page: 1, start: 0, end: text.length }];
}

async function readPdf(bytes: Uint8Array): Promise<{ text: string; pages: SourcePage[] }> {
  let pageTexts: string[];
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const res = await extractText(pdf, { mergePages: false });
    pageTexts = Array.isArray(res.text) ? res.text : [String(res.text)];
  } catch (err) {
    throw new ApiError(422, "unreadable_file", `The PDF could not be read (${(err as Error)?.message ?? "unknown error"}). ${HINT}`);
  }
  const pages: SourcePage[] = [];
  let text = "";
  pageTexts.forEach((raw, i) => {
    const t = normalise(raw ?? "");
    if (text.length) text += "\n\n";
    const start = text.length;
    text += t;
    pages.push({ page: i + 1, start, end: text.length });
  });
  if (!text.replace(/\s/g, "").length) {
    throw new ApiError(422, "empty_source", `The PDF has no text layer (it looks like a scan). ${HINT}`);
  }
  return { text, pages };
}

/** Read bytes of a known kind into text + page offsets. */
export async function readBytes(bytes: Uint8Array, kind: Kind): Promise<{ text: string; pages: SourcePage[]; format: string }> {
  if (kind === "pdf") return { ...(await readPdf(bytes)), format: "pdf" };
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(422, "unreadable_file", `The file is not valid UTF-8 text. ${HINT}`);
  }
  raw = raw.replace(/^﻿/, "");
  let text: string;
  if (kind === "json") {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      throw new ApiError(422, "unreadable_file", "The JSON file could not be parsed.");
    }
  } else if (kind === "html") {
    text = htmlToText(raw);
  } else {
    text = normalise(raw);
  }
  if (!text.trim()) throw new ApiError(422, "empty_source", "The source document is empty.");
  return { text, pages: singlePage(text), format: kind };
}

function pageOf(pages: SourcePage[], offset: number): number | null {
  for (const p of pages) if (offset >= p.start && offset <= p.end) return p.page;
  return pages.length ? pages[pages.length - 1].page : null;
}

export function notFoundReceipt(method = "lexical"): Receipt {
  return { status: "not_found", page: null, quote: null, charStart: null, charEnd: null, method, score: null, section: null };
}

/** Best BM25 source sentence per claim; found when at least 30% of the claim's words appear in it. */
export function lexicalReceipts(doc: SourceDocument, claims: Claim[]): Record<string, Receipt> {
  const index = new BM25(sourceUnits(doc.text, doc.format));
  const out: Record<string, Receipt> = {};
  for (const c of claims) {
    const top = index.search(c.text, 3);
    let best: { start: number; end: number; text: string } | null = null;
    let bestCov = 0;
    for (const hit of top) {
      const cov = coverage(c.text, hit.unit.text, { ignoreNumbers: true }); // a wrong number should still point at the right clause
      if (cov > bestCov) { bestCov = cov; best = hit.unit; }
    }
    out[c.id] = best && bestCov >= FOUND_COVERAGE
      ? { status: "found", page: pageOf(doc.pages, best.start), quote: best.text, charStart: best.start, charEnd: best.end, method: "lexical", score: Math.round(bestCov * 1000) / 1000, section: sectionFor(doc.text, best.start, best.end, best.text) }
      : notFoundReceipt("lexical");
  }
  return out;
}

export async function parseLocal(input: SourceInput): Promise<SourceDocument> {
  if (input.kind === "text") {
    const text = normalise(input.text);
    if (!text) throw new ApiError(422, "empty_source", "The source document is empty.");
    return { name: input.name || "source.txt", format: "text", text, pages: singlePage(text), parsedBy: "local" };
  }

  if (input.kind === "file") {
    const kind = detectKind(input.name, input.mimeType);
    if (!kind) throw new ApiError(422, "unsupported_file_type", `"${input.name}" is not a supported file type (PDF, TXT, MD, CSV, TSV, JSON, HTML). ${HINT}`);
    const r = await readBytes(input.bytes, kind);
    return { name: input.name, format: r.format, text: r.text, pages: r.pages, parsedBy: "local" };
  }

  // URL source
  let res: Response;
  try {
    res = await request(input.url, { headers: { "User-Agent": "boneify/0.1 (+source reader)" } }, { provider: "Source URL", timeoutMs: 20_000, retries: 1 });
  } catch (err) {
    if (err instanceof ProviderError) throw new ApiError(422, "unreadable_file", `The source URL could not be fetched: ${err.message.replace(/^Source URL: /, "")}`);
    throw err;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) throw new ApiError(413, "too_large", "The document at the source URL is over 4 MB.");
  const urlName = input.name || decodeURIComponent(new URL(input.url).pathname.split("/").filter(Boolean).pop() || new URL(input.url).hostname);
  const kind = detectKind(urlName, res.headers.get("content-type") ?? undefined) ?? "html";
  const r = await readBytes(bytes, kind);
  return { name: urlName, format: r.format, text: r.text, pages: r.pages, parsedBy: "local" };
}

export const localPerceiver: Perceiver = {
  id: "local",
  label: "Built-in reader (offline)",
  parse: parseLocal,
  async ground(doc, claims): Promise<GroundResult> {
    const t0 = performance.now();
    const receipts = lexicalReceipts(doc, claims);
    return { receipts, latencyMs: Math.round(performance.now() - t0) };
  },
};
