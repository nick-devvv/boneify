// Receipt highlights for the Adobe PDF Embed API: find a receipt's quote in the PDF's own text layer and return
// its position in PDF points (origin bottom-left), as quadPoints + boundingBox, plus ready-made Adobe annotations.
// Works from the PDF bytes, so it lines up whichever perceiver (local or NDI) found the receipt.

import { createHash } from "node:crypto";
import type { CheckedClaim, Highlight, Verdict } from "../types";

interface Item { str: string; x: number; y: number; w: number; h: number }

// Helvetica advance widths (1/1000 em) for ASCII 32..126: positions inside a line follow real letter widths, not equal slots.
const WIDTHS: number[] = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const charWidth = (ch: string) => { const c = ch.charCodeAt(0); return c >= 32 && c < 127 ? WIDTHS[c - 32] : 556; };
/** Fraction of the line's width taken up by its first k characters. */
function frac(str: string, k: number): number {
  let total = 0, upto = 0;
  for (let i = 0; i < str.length; i++) { const cw = charWidth(str[i]); total += cw; if (i < k) upto += cw; }
  return total ? upto / total : k / Math.max(1, str.length);
}
interface PageLayout { page: number; width: number; height: number; items: Item[]; text: string; map: Array<{ item: number; char: number }> }

const norm = (c: string) => (/\s/.test(c) ? " " : c.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-"));

/** Text layer of every page, with a map from each character of the joined page text back to its line item. */
export async function pdfLayout(bytes: Uint8Array): Promise<PageLayout[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: PageLayout[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [x0, y0, x1, y1] = page.getViewport({ scale: 1 }).viewBox as number[];
    const tc = await page.getTextContent();
    const items: Item[] = [];
    let text = "";
    const map: PageLayout["map"] = [];
    for (const raw of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
      if (!raw.str || !raw.transform) continue;
      const it: Item = { str: raw.str, x: raw.transform[4], y: raw.transform[5], w: raw.width ?? 0, h: raw.height || Math.abs(raw.transform[3]) || 10 };
      const idx = items.push(it) - 1;
      if (text.length) { text += " "; map.push({ item: idx, char: -1 }); }
      for (let c = 0; c < it.str.length; c++) { text += it.str[c]; map.push({ item: idx, char: c }); }
    }
    pages.push({ page: n, width: x1 - x0, height: y1 - y0, items, text, map });
  }
  return pages;
}

/** Collapse whitespace and case so a quote matches the PDF text however lines were joined. Returns the normalised text and an index back. */
function squash(s: string): { text: string; back: number[] } {
  let text = "";
  const back: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = norm(s[i]);
    if (c === " " && (text.endsWith(" ") || text.length === 0)) continue;
    text += c;
    back.push(i);
  }
  return { text, back };
}

function locate(p: PageLayout, quote: string, minLen: number): { start: number; end: number } | null {
  const hay = squash(p.text);
  const q = squash(quote).text.trim();
  if (q.length < minLen) return null;
  let at = hay.text.indexOf(q);
  let len = q.length;
  if (at < 0) {
    // fall back to the first ~10 words: a partial highlight beats none
    const head = q.split(" ").slice(0, 10).join(" ");
    if (head.length < 15) return null;
    at = hay.text.indexOf(head);
    len = head.length;
  }
  if (at < 0) return null;
  return { start: hay.back[at], end: hay.back[at + len - 1] + 1 };
}

/**
 * The quote's position on its page, in PDF points. Tries the receipt's page first, then every page.
 * `context` (the source line around the quote) pins down short quotes like "$12,500": find the line, then the quote inside it.
 */
export function highlightFor(layout: PageLayout[], quote: string | null, pageHint: number | null, context?: string | null): Highlight | null {
  if (!quote) return null;
  const order = [...layout].sort((a, b) => (a.page === pageHint ? -1 : b.page === pageHint ? 1 : a.page - b.page));
  const findIn = (p: PageLayout): { start: number; end: number } | null => {
    if (context && context.trim().length >= 15) {
      const line = locate(p, context, 15);
      if (line) {
        const sub = squash(p.text.slice(line.start, line.end));
        const q = squash(quote).text.trim();
        const at = q.length >= 2 ? sub.text.indexOf(q) : -1;
        if (at >= 0) return { start: line.start + sub.back[at], end: line.start + sub.back[at + q.length - 1] + 1 };
      }
    }
    const direct = locate(p, quote, 8);
    if (direct) return direct;
    // Short quotes alone are only trusted on the page the receipt named.
    return p.page === pageHint ? locate(p, quote, 3) : null;
  };
  for (const p of order) {
    const hit = findIn(p);
    if (!hit) continue;
    // per line item: the span of characters covered, as a fraction of the item's width
    const spans = new Map<number, { from: number; to: number }>();
    for (let i = hit.start; i < hit.end; i++) {
      const m = p.map[i];
      if (!m || m.char < 0) continue;
      const s = spans.get(m.item);
      if (!s) spans.set(m.item, { from: m.char, to: m.char + 1 });
      else { s.from = Math.min(s.from, m.char); s.to = Math.max(s.to, m.char + 1); }
    }
    // Skip ALL-CAPS heading lines ("FEES AND PAYMENT") when the quote also covers real clause lines.
    const isHeading = (str: string) => { const l = str.replace(/[^A-Za-z]/g, ""); return l.length >= 3 && l === l.toUpperCase() && !/[.!?]\s*$/.test(str.trim()); };
    if ([...spans.keys()].some((i) => !isHeading(p.items[i].str))) for (const i of [...spans.keys()]) if (isHeading(p.items[i].str)) spans.delete(i);
    const quadPoints: number[] = [];
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const [idx, s] of spans) {
      const it = p.items[idx];
      const xa = it.x + it.w * frac(it.str, s.from);
      const xb = it.x + it.w * frac(it.str, s.to);
      const yb = it.y - it.h * 0.22; // descenders
      const yt = it.y + it.h * 0.9; // cap height
      const r = (v: number) => Math.round(v * 100) / 100;
      // Adobe order: upper-left, upper-right, lower-left, lower-right
      quadPoints.push(r(xa), r(yt), r(xb), r(yt), r(xa), r(yb), r(xb), r(yb));
      xmin = Math.min(xmin, xa); xmax = Math.max(xmax, xb); ymin = Math.min(ymin, yb); ymax = Math.max(ymax, yt);
    }
    if (!quadPoints.length) continue;
    const r = (v: number) => Math.round(v * 100) / 100;
    return { page: p.page, pageWidth: r(p.width), pageHeight: r(p.height), quadPoints, boundingBox: [r(xmin), r(ymin), r(xmax), r(ymax)] };
  }
  return null;
}

// ---------------------------------------------------------------- Adobe PDF Embed API annotations

export const VERDICT_COLOR: Record<Verdict, string> = { supported: "#22C55E", contradicted: "#EF4444", not_in_source: "#EAB308" };
const VERDICT_LABEL: Record<Verdict, string> = { supported: "Correct", contradicted: "Wrong", not_in_source: "Made up" };

function uuidFrom(input: string): string {
  const h = createHash("sha1").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Stable id for a PDF: pass it as metaData.id to previewFile, so the annotations bind to the document. */
export const adobeDocId = (bytes: Uint8Array) => uuidFrom(createHash("sha1").update(bytes).digest("hex"));

/** One highlight annotation per claim that has a box, coloured by verdict, in Adobe's annotation schema. */
export function adobeAnnotations(docId: string, claims: CheckedClaim[], now = new Date().toISOString()): unknown[] {
  return claims
    .filter((c) => c.receipt.highlight)
    .map((c) => {
      const h = c.receipt.highlight!;
      return {
        "@context": ["https://www.w3.org/ns/anno.jsonld", "https://comments.acrobat.com/ns/anno.jsonld"],
        type: "Annotation",
        id: uuidFrom(`${docId}:${c.id}`),
        bodyValue: `${VERDICT_LABEL[c.verdict]} (${Math.round(c.confidence * 100)}%): ${c.text}`,
        motivation: "commenting",
        target: {
          source: docId,
          selector: {
            node: { index: h.page - 1 },
            opacity: 0.35,
            subtype: "highlight",
            boundingBox: h.boundingBox,
            quadPoints: h.quadPoints,
            strokeColor: VERDICT_COLOR[c.verdict],
            type: "AdobeAnnoSelector",
          },
        },
        creator: { type: "Person", name: "boneify" },
        created: now,
        modified: now,
      };
    });
}
