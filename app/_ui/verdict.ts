// Plain words and formatting shared by every page. The UI only formats what the API returns; it never invents a number.

import type { Receipt, Verdict } from "../../lib/types";

export type VerdictOrPending = Verdict | "pending";

export const WORD: Record<Verdict, string> = { supported: "Correct", contradicted: "Wrong", not_in_source: "Made up" };
export const UPPER: Record<Verdict, string> = { supported: "CORRECT", contradicted: "WRONG", not_in_source: "MADE UP" };
export const TEXT_COLOR: Record<Verdict, string> = { supported: "#9A6A00", contradicted: "#C4321F", not_in_source: "#76665A" };
export const WASH: Record<Verdict, string> = { supported: "#FCEFC9", contradicted: "#FBE3DC", not_in_source: "#EFE7DA" };
export const RING: Record<Verdict, string> = { supported: "#F0A202", contradicted: "#C4321F", not_in_source: "#A6978A" };

export const isProblem = (v: Verdict) => v !== "supported";

/** "§2.1" when the API found a clause number, else "page 1", else "". */
export function where(r: Receipt | null | undefined): string {
  if (!r || r.status !== "found") return "";
  if (r.section) return `§${r.section.replace(/^§/, "")}`;
  if (r.page) return `page ${r.page}`;
  return "";
}

/** The label under a sentence: what it is and where the proof lives. */
export function verdictLabel(v: Verdict, r: Receipt | null | undefined, doc = "the original"): string {
  const w = where(r);
  if (v === "supported") return w ? `CORRECT · found ${w.startsWith("page") ? "on" : "in"} ${w}` : "CORRECT";
  if (v === "contradicted") return w ? `WRONG · see ${w}` : "WRONG";
  return `MADE UP · not in ${doc}`;
}

export function deciderName(id: string | undefined | null): string {
  if (id === "drex") return "Drex";
  if (id === "llm") return "Big AI model";
  if (id === "local") return "Simple rules";
  return id || "";
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms < 1) return "< 1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toPrecision(2)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return Math.round(n).toLocaleString("en-US");
}

export function times(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x) || x <= 0) return "×–";
  return `×${x >= 10 ? Math.round(x) : x.toFixed(1)}`;
}

export function signed(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "±–";
  return `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;
}

/** Where a receipt's quote sits in `text`: the API's offsets when they point at the quote, else the quote found by search. */
export function locate(text: string, r: Receipt | null | undefined): [number, number] | null {
  if (!r || r.status !== "found" || !r.quote) return null;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  if (r.charStart !== null && r.charEnd !== null && norm(text.slice(r.charStart, r.charEnd)) === norm(r.quote)) return [r.charStart, r.charEnd];
  const q = r.quote.trim();
  let at = text.indexOf(q);
  if (at >= 0) return [at, at + q.length];
  const head = q.slice(0, 60);
  at = head.length >= 20 ? text.indexOf(head) : -1;
  return at >= 0 ? [at, Math.min(text.length, at + q.length)] : null;
}

export const pct = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${Math.round(x * 100)}%`);
