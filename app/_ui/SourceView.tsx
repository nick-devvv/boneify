"use client";

import { useEffect, useRef } from "react";

export interface Mark { id: string; start: number; end: number; bg: string; underline: string; tag?: string; tagColor?: string }

/** The original document as plain text, with receipts highlighted in place. Scrolls itself to the active receipt. */
export function SourceView({ text, marks, activeId, dim = false, fontSize = 14 }: { text: string; marks: Mark[]; activeId?: string | null; dim?: boolean; fontSize?: number }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !activeId) return;
    const target = el.querySelector<HTMLElement>(`[data-mark="${activeId}"]`);
    if (!target) return;
    const top = target.offsetTop - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeId]);

  // Non-overlapping marks in text order; a later mark that overlaps an earlier one is skipped.
  const sorted = [...marks].filter((m) => m.end > m.start).sort((a, b) => a.start - b.start);
  const parts: Array<{ text: string; mark?: Mark }> = [];
  let at = 0;
  for (const m of sorted) {
    if (m.start < at) continue;
    if (m.start > at) parts.push({ text: text.slice(at, m.start) });
    parts.push({ text: text.slice(m.start, m.end), mark: m });
    at = m.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });

  return (
    <div ref={box} style={{ position: "relative", height: "100%", overflowY: "auto", whiteSpace: "pre-wrap", fontSize, lineHeight: 1.6, padding: "22px 26px" }}>
      {parts.map((p, i) =>
        p.mark ? (
          <span
            key={i}
            data-mark={p.mark.id}
            className="ring"
            style={{ background: p.mark.bg, boxShadow: `inset 0 -2px 0 ${p.mark.underline}`, borderRadius: 3, color: "var(--ink)" }}
          >
            {p.text}
            {p.mark.tag ? <span className="mono" style={{ fontSize: 11, color: p.mark.tagColor || "var(--muted)", marginLeft: 6, whiteSpace: "nowrap" }}>{p.mark.tag}</span> : null}
          </span>
        ) : (
          <span key={i} className="ring" style={{ color: dim ? "#A6978A" : "#4A3B30" }}>{p.text}</span>
        ),
      )}
    </div>
  );
}
