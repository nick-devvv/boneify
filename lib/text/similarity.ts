// Text helpers for the offline engines: tokens, BM25 search, numbers, names, negation.

import { splitSentences } from "./sentences";

export const STOPWORDS = new Set(
  ("a an and are as at be been being but by can could did do does for from had has have he her his i if in into is it its " +
    "may might more most must of on or our over she should so than that the their them then there these they this those to " +
    "under up was we were what when where which while who will with within would you your also any all each per about after " +
    "before between both during such only other same some very via upon")
    .split(" "),
);

const NEGATIONS = new Set(["not", "no", "never", "none", "neither", "nor", "without", "cannot", "isn't", "aren't", "wasn't", "weren't",
  "doesn't", "don't", "didn't", "won't", "wouldn't", "shouldn't", "can't", "couldn't", "hasn't", "haven't", "hadn't", "nothing", "nobody"]);

function stem(w: string): string {
  let s = w.replace(/['’]s$/, "");
  if (/^\d/.test(s)) return s;
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us")) s = s.slice(0, -1);
  // light suffix stripping so "effective"/"effect", "payable"/"pay", "renewed"/"renew" meet
  for (const suf of ["ively", "ive", "ing", "able", "ed", "ly"]) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

/** Lower-case word tokens (letters/digits), lightly stemmed. */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map(stem);
}

/** Tokens without stopwords: the words that carry meaning. */
export function contentWords(text: string): string[] {
  return tokens(text).filter((t) => !STOPWORDS.has(t) && !NEGATIONS.has(t));
}

export function hasNegation(text: string): boolean {
  const t = text.toLowerCase().replace(/\bno\.\s*\d/g, " ").replace(/\bnos?\.(?=\s)/g, " "); // "No. 1" is a number label
  return (t.match(/[a-z'’]+/g) ?? []).some((w) => NEGATIONS.has(w) || /n['’]t$/.test(w));
}

/** The text with numbers and number words removed: used to find the clause a sentence is about, whatever its numbers say. */
export function withoutNumbers(text: string): string {
  return text
    .replace(/[$€£]?\d[\d,.]*\s*(?:%|k|m|bn|b|million|billion|thousand)?/gi, " ")
    .replace(/[a-z]+/gi, (w) => (w.toLowerCase() in WORD_NUMBERS ? " " : w));
}

// ---------------------------------------------------------------- numbers

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6,
  single: 1, twice: 2, double: 2, triple: 3, half: 0.5, dozen: 12,
};
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };

function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** Every number mentioned in the text, normalised ("$48.2M" -> "48200000", "three (3)" -> "3", "41.2%" -> "41.2"). */
export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const re = /(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)\s*(k|mm|mn|m|bn|b|t|thousand|million|billion|trillion)?\b/gi;
  for (const m of text.matchAll(re)) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const scale = m[2] ? SCALE[m[2].toLowerCase()] : 1;
    // "1.5m" could be metres; scale only when the word or a currency sign suggests money/amounts
    const prev = text.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0);
    const scaled = m[2] && (m[2].length > 1 || prev === "$" || prev === "€" || prev === "£") ? base * scale : base;
    out.add(fmt(scaled));
    if (scaled !== base) out.add(fmt(base)); // "$48.2M" also matches "48.2 million" written as "48.2"
  }
  for (const w of text.toLowerCase().match(/[a-z]+(?:-[a-z]+)?/g) ?? []) {
    const parts = w.split("-");
    if (parts.length === 2 && parts[0] in WORD_NUMBERS && parts[1] in WORD_NUMBERS && WORD_NUMBERS[parts[0]] >= 20 && WORD_NUMBERS[parts[1]] < 10) {
      out.add(fmt(WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]])); // forty-five
      continue;
    }
    for (const p of parts) {
      if (p in WORD_NUMBERS && !["single", "double", "half", "hundred", "thousand", "million"].includes(p)) out.add(fmt(WORD_NUMBERS[p]));
    }
  }
  return out;
}

/** Each number mentioned in the text with its position, and all the normalised forms it can match. */
export function numberMentions(text: string): Array<{ values: Set<string>; index: number; length: number }> {
  const out: Array<{ values: Set<string>; index: number; length: number }> = [];
  const re = /[$€£]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)\s*(?:%|k|mm|mn|m|bn|b|t|thousand|million|billion|trillion)?\b|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozen|twice|triple)\b/gi;
  for (const m of text.matchAll(re)) {
    const values = extractNumbers(m[0]);
    if (values.size) out.push({ values, index: m.index ?? 0, length: m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------- names

/** Capitalised words that are not the first word of a sentence and not common words: likely names, places, products. */
export function extractNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const s of splitSentences(text)) {
    const words = s.text.match(/[A-Za-z][A-Za-z'’&.-]*/g) ?? [];
    words.forEach((w, i) => {
      const clean = w.replace(/['’]s$/, "").replace(/[.'’]+$/, "");
      if (i === 0 || clean.length < 2) return;
      if (!/^[A-Z]/.test(clean)) return;
      if (clean === clean.toUpperCase() && clean.length > 5) return; // shouting headings
      const lower = clean.toLowerCase();
      if (STOPWORDS.has(lower) || lower in WORD_NUMBERS) return;
      out.add(lower);
    });
  }
  return out;
}

// ---------------------------------------------------------------- units and BM25

export interface Unit { text: string; start: number; end: number }

/** Split a source into searchable units: sentences, or one `key: value` line per unit for JSON sources. */
export function sourceUnits(text: string, format?: string): Unit[] {
  if (format === "json" || format === "csv" || format === "tsv") {
    const units: Unit[] = [];
    let pos = 0;
    for (const line of text.split("\n")) {
      const trimmedStart = line.length - line.trimStart().length;
      const t = line.trim().replace(/[,{}[\]]+$/g, "").trim();
      if (t && /[\p{L}\p{N}]/u.test(t)) {
        const start = pos + trimmedStart;
        units.push({ text: line.trim(), start, end: start + line.trim().length });
      }
      pos += line.length + 1;
    }
    return units;
  }
  // Headings and labels ("6.2 Effect of Termination.", "SERVICES") are merged into the clause that follows,
  // so a short heading never outranks the sentence that actually says something.
  const sentences = splitSentences(text);
  const units: Unit[] = [];
  let pending: Unit | null = null;
  for (const u of sentences) {
    const start = pending ? pending.start : u.start;
    const merged: Unit = { text: text.slice(start, u.end), start, end: u.end };
    if (contentWords(withoutNumbers(u.text)).length < 4) {
      pending = merged;
      continue;
    }
    units.push(merged);
    pending = null;
  }
  if (pending) units.push(pending);
  return units;
}

export class BM25 {
  private docs: string[][];
  private df = new Map<string, number>();
  private avgLen: number;
  constructor(public units: Unit[], private k1 = 1.2, private b = 0.75) {
    this.docs = units.map((u) => contentWords(u.text));
    for (const d of this.docs) for (const t of new Set(d)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((a, d) => a + d.length, 0) / Math.max(1, this.docs.length);
  }

  private idf(t: string): number {
    const n = this.docs.length;
    const df = this.df.get(t) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Top-k units for the query, best first. */
  search(query: string, k = 2): Array<{ unit: Unit; index: number; score: number }> {
    const q = [...new Set(contentWords(query))];
    const scored = this.docs.map((d, i) => {
      if (!d.length) return { i, s: 0 };
      const tf = new Map<string, number>();
      for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
      let s = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        s += this.idf(t) * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.length) / this.avgLen)));
      }
      return { i, s };
    });
    return scored
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => ({ unit: this.units[x.i], index: x.i, score: x.s }));
  }
}

/** Share of the claim's content words that appear in `other` (0..1). Claims with no content words count as 0. */
export function coverage(claim: string, other: string | Set<string>, opts: { ignoreNumbers?: boolean } = {}): number {
  let c = [...new Set(contentWords(claim))];
  if (opts.ignoreNumbers) {
    const words = c.filter((t) => !/^\d/.test(t) && !(t in WORD_NUMBERS));
    if (words.length) c = words;
  }
  if (!c.length) return 0;
  const o = typeof other === "string" ? new Set(contentWords(other)) : other;
  return c.filter((t) => o.has(t)).length / c.length;
}
