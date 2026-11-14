// Sentence splitter that keeps exact character offsets: for every result, text.slice(start, end) === sentence.text.
// Handles abbreviations (Inc., Dr., U.S., e.g.), decimals ($3.5M), list items and paragraph breaks.

export interface Sentence { text: string; start: number; end: number }

// Lower-case words that end with a period but do not end a sentence.
const ABBREVIATIONS = new Set([
  // titles
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "gen", "sen", "rep", "gov", "lt", "col", "capt", "sgt", "rev", "hon", "pres", "mt",
  // companies
  "inc", "corp", "co", "ltd", "llc", "plc", "bros", "assn", "dept", "univ",
  // months
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  // misc
  "no", "nos", "fig", "figs", "vs", "v", "approx", "est", "al", "e.g", "i.e", "cf", "ca", "vol", "pp", "sec", "art", "para", "ch", "ave", "blvd", "rd",
]);

const LIST_MARKER = /^[ \t]*(?:[-*•▪◦‣–—]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)](?=\s))[ \t]+/;
const CLOSERS = "\"'”’)]»";

function isAllCapsHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && !/[.!?]\s*$/.test(line.trim());
}

/** Split the text into blocks (paragraphs, list items, headings) with offsets. */
function blocks(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const lines: Array<{ start: number; end: number }> = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    lines.push({ start: pos, end: pos + raw.length });
    pos += raw.length + 1;
  }

  let cur: { start: number; end: number } | null = null;
  let prevLine = "";
  for (const ln of lines) {
    const line = text.slice(ln.start, ln.end);
    const blank = line.trim() === "";
    if (blank) {
      if (cur) out.push(cur);
      cur = null;
      prevLine = "";
      continue;
    }
    const startsNew = cur === null || LIST_MARKER.test(line) || isAllCapsHeading(prevLine) || isAllCapsHeading(line);
    if (startsNew) {
      if (cur) out.push(cur);
      cur = { start: ln.start, end: ln.end };
    } else if (cur) {
      cur.end = ln.end;
    }
    prevLine = line;
  }
  if (cur) out.push(cur);
  return out;
}

function isSentenceEnd(text: string, i: number, blockEnd: number): number {
  // i is the index of '.', '!' or '?'. Returns the end offset of the sentence (exclusive) or -1.
  let j = i;
  while (j + 1 < blockEnd && /[.!?]/.test(text[j + 1])) j++; // "?!", "..."
  while (j + 1 < blockEnd && CLOSERS.includes(text[j + 1])) j++;
  const end = j + 1;
  if (end >= blockEnd) return end;
  if (!/\s/.test(text[end])) return -1; // "3.5", "U.S.-based", "example.com"
  let k = end;
  while (k < blockEnd && /\s/.test(text[k])) k++;
  if (k >= blockEnd) return end;
  const next = text[k];
  if (/[a-z]/.test(next)) return -1; // "Acme Inc. reported ..."

  if (text[i] === ".") {
    // the word in front of the period
    let w = i;
    while (w > 0 && /[A-Za-z.]/.test(text[w - 1])) w--;
    const word = text.slice(w, i);
    const lower = word.toLowerCase();
    if (ABBREVIATIONS.has(lower)) return -1;
    if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)) return -1; // U.S, e.g, U.K
    if (/^[A-Z]$/.test(word)) return -1; // initials: "J. Smith"
  }
  return end;
}

/** Split text into sentences with exact character offsets. Whitespace and list markers are trimmed off. */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
  };

  for (const b of blocks(text)) {
    let start = b.start;
    const marker = LIST_MARKER.exec(text.slice(b.start, b.end));
    if (marker) start += marker[0].length;
    let sentStart = start;
    for (let i = start; i < b.end; i++) {
      const ch = text[i];
      if (ch !== "." && ch !== "!" && ch !== "?") continue;
      const end = isSentenceEnd(text, i, b.end);
      if (end < 0) continue;
      push(sentStart, end);
      sentStart = end;
      i = end - 1;
    }
    push(sentStart, b.end);
  }
  return out;
}

/** Number of word-like tokens (letters or digits). */
export function wordCount(s: string): number {
  return (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%$-]*/gu) ?? []).length;
}
