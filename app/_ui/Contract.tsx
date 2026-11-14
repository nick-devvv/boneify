// The original document drawn as a real page: title, numbered clauses, page footer, signatures.
// Used by the demo and as the fallback when the Adobe PDF viewer can't load. The words are the source text as-is.

import type { CheckedClaim } from "../../lib/types";

export type MarkKind = "ok" | "okSel" | "wrongSoft" | "wrong" | "noneSoft" | "none";
type Block =
  | { t: "title"; text: string }
  | { t: "head"; text: string }
  | { t: "clause"; key: string; lead: string; text: string }
  | { t: "para"; key: string; text: string };
export interface ContractDoc { pages: Block[][]; title: string | null }

const HEAD = /^(\d+)\.\s+([A-Z][A-Z0-9 ,&'’/-]+)$/;
const CLAUSE = /^(\d+\.\d+)\s+(.*)$/;
const PAGE_BUDGET = 760; // characters per page, breaking only at a heading (matches the 3-page sample PDF)

/** Split plain contract text into blocks and pages. Works for any text; numbered clauses become their own blocks. */
export function parseContract(text: string): ContractDoc {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const blocks: Block[] = [];
  let title: string | null = null;
  let para = 0;
  lines.forEach((line, i) => {
    if (!line) return;
    if (i === 0 && line === line.toUpperCase() && /[A-Z]/.test(line) && line.length < 80) { title = line; blocks.push({ t: "title", text: line }); return; }
    const h = HEAD.exec(line);
    if (h) { blocks.push({ t: "head", text: line }); return; }
    const c = CLAUSE.exec(line);
    if (c) {
      const rest = c[2];
      const dot = rest.indexOf(". ");
      const lead = dot > 0 && dot < 32 && /^[A-Z]/.test(rest) ? rest.slice(0, dot + 1) : "";
      blocks.push({ t: "clause", key: c[1], lead: `${c[1]}${lead ? ` ${lead}` : ""}`, text: lead ? rest.slice(dot + 2) : rest });
      return;
    }
    blocks.push({ t: "para", key: `p${para++}`, text: line });
  });
  const pages: Block[][] = [[]];
  let used = 0;
  blocks.forEach((b) => {
    const size = b.t === "title" ? 0 : b.t === "clause" ? b.lead.length + b.text.length : b.text.length;
    if (b.t === "head" && used > PAGE_BUDGET) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(b);
    used += size;
  });
  return { pages, title };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Which block a claim's receipt points at: its clause number first, else the block its quote comes from. */
export function blockFor(doc: ContractDoc, claim: CheckedClaim): { page: number; key: string } | null {
  const r = claim.receipt;
  if (!r || r.status !== "found") return null;
  const sec = r.section?.replace(/^§/, "") ?? null;
  for (let p = 0; p < doc.pages.length; p++) {
    for (const b of doc.pages[p]) if (b.t === "clause" && sec && b.key === sec) return { page: p + 1, key: b.key };
  }
  const q = r.quote ? norm(r.quote) : "";
  if (!q) return null;
  let best: { page: number; key: string; score: number } | null = null;
  doc.pages.forEach((blocks, p) => blocks.forEach((b) => {
    if (b.t !== "clause" && b.t !== "para") return;
    const body = norm(b.t === "clause" ? `${b.lead} ${b.text}` : b.text);
    const probe = body.slice(0, 40);
    const score = q.includes(probe) ? probe.length : body.includes(q.slice(0, 40)) ? 40 : 0;
    if (score && (!best || score > best.score)) best = { page: p + 1, key: b.key, score };
  }));
  return best ? { page: (best as { page: number }).page, key: (best as { key: string }).key } : null;
}

const STYLE: Record<MarkKind, { bg: string; ring: string; bar: string; strong: boolean }> = {
  ok: { bg: "transparent", ring: "inset 0 -2px 0 #F0A202", bar: "transparent", strong: false },
  okSel: { bg: "#FCEFC9", ring: "inset 0 -2px 0 #F0A202", bar: "#F0A202", strong: true },
  wrongSoft: { bg: "transparent", ring: "inset 0 -2px 0 #C4321F", bar: "transparent", strong: false },
  wrong: { bg: "#FBE3DC", ring: "inset 0 -2px 0 #C4321F", bar: "#C4321F", strong: true },
  noneSoft: { bg: "transparent", ring: "inset 0 -1px 0 #A6978A", bar: "transparent", strong: false },
  none: { bg: "#EFE7DA", ring: "inset 0 -2px 0 #A6978A", bar: "#A6978A", strong: true },
};

/** One page of the contract, with clauses marked by verdict. Stays white in dark mode, like a real PDF page. */
export function ContractPage({ doc, page, marks = {}, dim = false, scanning = false, height = 640, footer }: {
  doc: ContractDoc; page: number; marks?: Record<string, MarkKind>; dim?: boolean; scanning?: boolean; height?: number | string; footer?: string;
}) {
  const p = Math.max(1, Math.min(doc.pages.length, page));
  const blocks = doc.pages[p - 1] ?? [];
  const total = doc.pages.length;
  const isLast = p === total && /signed by/i.test(doc.pages[total - 1]?.map((b) => ("text" in b ? b.text : "")).join(" ") ?? "");
  return (
    <div className="keep" style={{ position: "relative", width: "100%", height, background: "#FFFFFF", color: "#2A2420", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 11.5, lineHeight: 1.5, padding: "34px 46px 52px 46px", overflow: "hidden", borderRadius: 2, boxShadow: "0 1px 2px rgba(34,23,15,.14), 0 10px 26px -14px rgba(34,23,15,.35)" }}>
      {blocks.map((b, i) => {
        if (b.t === "title") return (
          <div key={i} style={{ textAlign: "center", margin: "0 0 12px 0" }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, letterSpacing: ".16em" }}>{b.text}</p>
          </div>
        );
        if (b.t === "head") return <p key={i} style={{ margin: "13px 0 3px 0", fontWeight: 700, letterSpacing: ".07em", color: dim ? "#B3A89D" : "#2A2420", transition: "color 260ms" }}>{b.text}</p>;
        const m = marks[b.key];
        const s = m ? STYLE[m] : null;
        const faded = dim && !(s && s.strong);
        const signed = isLast && b.t === "para" && /^signed by/i.test(b.text);
        if (signed) return <Signatures key={i} text={b.text} />;
        return (
          <p key={i} data-key={b.key} style={{ margin: "4px 0 0 0", position: "relative", textAlign: "justify", hyphens: "auto", color: faded ? "#B3A89D" : "#2A2420", transition: "color 260ms" }}>
            <span aria-hidden="true" style={{ position: "absolute", left: -20, top: 3, bottom: 3, width: 3, borderRadius: 2, background: s?.bar ?? "transparent", transition: "background-color 260ms" }} />
            <span style={{ background: s?.bg ?? "transparent", boxShadow: s?.ring ?? "none", borderRadius: 2, WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone", transition: "background-color 260ms, box-shadow 260ms" }}>
              {b.t === "clause" ? <><span style={{ fontWeight: 600 }}>{b.lead}</span> {b.text}</> : b.text}
            </span>
          </p>
        );
      })}
      {scanning ? <div className="pdfscan" aria-hidden="true" /> : null}
      <div style={{ position: "absolute", left: 46, right: 46, bottom: 20, display: "flex", alignItems: "flex-end", gap: 12, fontSize: 9, color: "#8A7E74" }}>
        <span>{footer ?? doc.title ?? ""}{footer || doc.title ? " · Confidential" : ""}</span>
        {p < total ? <span style={{ marginLeft: "auto" }}>Initials ______ ______</span> : null}
        <span style={{ marginLeft: p < total ? 18 : "auto" }}>Page {p} of {total}</span>
      </div>
    </div>
  );
}

/** "Signed by A, Title, Company, and B, Title, Company." drawn as a signature block. */
function Signatures({ text }: { text: string }) {
  const body = text.replace(/^signed by\s+/i, "").replace(/\.$/, "");
  const people = body.split(/,\s*and\s+/i).map((p) => {
    const parts = p.split(",").map((x) => x.trim());
    return { name: parts[0] ?? "", title: parts[1] ?? "", org: parts.slice(2).join(", ") };
  });
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ margin: 0, fontStyle: "italic", color: "#4A4039" }}>IN WITNESS WHEREOF, the parties have signed this Agreement as of the Effective Date.</p>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 28, fontSize: 10.5 }}>
        {people.map((p, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 700, letterSpacing: ".06em" }}>{p.org.toUpperCase()}</span>
            <span className="serif" style={{ marginTop: 6, fontStyle: "italic", fontSize: 24, lineHeight: 1, color: "#2B3A67" }}>{p.name}</span>
            <span style={{ height: 1, background: "#2A2420" }} />
            <span>Name: {p.name}</span>
            <span>Title: {p.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The marks for one check: every verdict softly, the selected (or focused) ones strongly. */
export function marksFor(doc: ContractDoc, claims: CheckedClaim[], strongIds: string[]): Record<string, MarkKind> {
  const out: Record<string, MarkKind> = {};
  claims.forEach((c) => {
    const at = blockFor(doc, c);
    if (!at) return;
    const strong = strongIds.includes(c.id);
    if (c.verdict === "supported") out[at.key] = strong ? "okSel" : out[at.key] ?? "ok";
    else if (c.verdict === "contradicted") out[at.key] = strong ? "wrong" : "wrongSoft";
    else if (strong) out[at.key] = "none";
  });
  return out;
}
