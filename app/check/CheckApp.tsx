"use client";

// Try it: 1 add the original, 2 paste what the AI wrote, 3 press Check.
// The dig plays while POST /api/check runs, then cracks open one rock layer per sentence with the real verdicts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckResult, CheckedClaim } from "../../lib/types";
import { ApiFailure, check, fix, friendlyError, getHealth, getSample, getSamples, split, type CheckInput, type FixResult, type Health, type SampleFull, type SampleInfo } from "../_ui/api";
import { Header } from "../_ui/Header";
import { Key } from "../_ui/Key";
import { REX, REX_HAPPY, REX_SIDE } from "../_ui/pixel";
import { RECORDED } from "../_ui/recorded";
import { SourceView, type Mark } from "../_ui/SourceView";
import { BoneIcon, PageIcon, Pick, Rex, Sauro } from "../_ui/Sprites";
import { AdobeViewer, ADOBE_CLIENT_ID } from "../_ui/AdobeViewer";
import { ContractPage, blockFor, marksFor, parseContract } from "../_ui/Contract";
import { SandDig } from "../_ui/SandDig";
import { RING, TEXT_COLOR, UPPER, WASH, deciderName, fmtMs, fmtUsd, locate, where } from "../_ui/verdict";

type Stage = "input" | "digging" | "results";
const TEXT_TYPES = /\.(txt|md|markdown|csv|json|html?)$/i;
const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.csv,.json,.html,.htm,.xlsx,.xls,.pptx,.eml,.png,.jpg,.jpeg";
const EARTH = ["#3B2C20", "#34261B", "#3F2F22", "#2F2318", "#392A1E", "#33251A", "#3D2E21"];
const CRACK_MS = 430;

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => { setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  return reduce;
}

function crackPath(seed: number, width = 1000): string {
  let d = "M0 31";
  for (let x = 40; x <= width; x += 40) d += `H${x}V${22 + ((seed * 7 + x * 3) % 19)}`;
  return d;
}

export function CheckApp() {
  const reduce = useReducedMotion();
  const [samples, setSamples] = useState<SampleInfo[] | null>(null);
  const [sampleCache, setSampleCache] = useState<Record<string, SampleFull>>({});
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [aiText, setAiText] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const [stage, setStage] = useState<Stage>("input");
  const [flood, setFlood] = useState(false);
  const [dropped, setDropped] = useState(false);
  const [dug, setDug] = useState(0);
  const [slam, setSlam] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [offline, setOffline] = useState(false);
  const [runError, setRunError] = useState<{ text: string; code: string } | null>(null);
  const [pendingClaims, setPendingClaims] = useState<string[]>([]);
  const timers = useRef<number[]>([]);

  const [sel, setSel] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixRes, setFixRes] = useState<FixResult | null>(null);
  const [fixErr, setFixErr] = useState<string | null>(null);
  const lastInput = useRef<CheckInput | null>(null);

  // samples and engine status on load
  useEffect(() => {
    getSamples().then((s) => {
      setSamples(s);
      const first = s.find((x) => x.id === "msa-summary") ?? s[0];
      if (first) pickSample(first.id);
    }).catch(() => setSamples([]));
    getHealth().then(setHealth).catch(() => setHealth(null));
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  async function pickSample(id: string) {
    setSampleId(id);
    setFile(null);
    setFileText(null);
    setInputError(null);
    const cached = sampleCache[id];
    const s = cached ?? (await getSample(id).catch(() => null));
    if (s) {
      setSampleCache((c) => ({ ...c, [id]: s }));
      setAiText(s.aiText);
    }
  }

  async function pickFile(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setSampleId(null);
    setInputError(null);
    setFileText(TEXT_TYPES.test(f.name) ? await f.text().catch(() => null) : null);
  }

  // live sentence count (the same splitter the check uses)
  useEffect(() => {
    if (!aiText.trim()) { setCount(0); return; }
    const t = window.setTimeout(() => {
      split(aiText).then((r) => { setCount(r.count); setPendingClaims(r.claims.map((c) => c.text)); }).catch(() => setCount(null));
    }, 350);
    return () => window.clearTimeout(t);
  }, [aiText]);

  const sample = sampleId ? sampleCache[sampleId] ?? null : null;
  const hasSource = Boolean(sample || file);
  // Only the untouched contract sample has a recorded real check to fall back on.
  const canRecord = !file && sample?.id === "msa-summary" && aiText === sample.aiText;
  const llmReady = health?.deciders.find((d) => d.id === "llm")?.ready ?? false;
  const mainDecider = health?.defaults.decider;
  const compare = llmReady && mainDecider !== "llm" ? "llm" : undefined;

  const run = useCallback(async () => {
    if (!hasSource || !aiText.trim()) {
      setInputError(!hasSource ? "Add the original first." : "Paste what the AI wrote.");
      setShakeKey((k) => k + 1);
      return;
    }
    clearTimers();
    setInputError(null);
    setResult(null);
    setOffline(false);
    setRunError(null);
    setDug(0);
    setSlam(false);
    setFlood(false);
    setDropped(false);
    setFixRes(null);
    setFixErr(null);
    setStage("digging");
    window.scrollTo({ top: 0 });
    at(30, () => setFlood(true));
    at(reduce ? 30 : 450, () => setDropped(true));
    const started = performance.now();

    let res: CheckResult | null = null;
    let usedOffline = false;
    try {
      const input: CheckInput | null = file ? { kind: "file", file, aiText, compare } : sample ? { kind: "sample", sampleId: sample.id, aiText: aiText === sample.aiText ? undefined : aiText, compare } : null;
      lastInput.current = input;
      if (input) res = await check(input);
    } catch (e) {
      const f = e as ApiFailure;
      // The venue Wi-Fi fallback: the recorded contract check, clearly labelled.
      if (f.network && canRecord) { res = RECORDED; usedOffline = true; }
      else { setRunError(friendlyError(f)); return; }
    }
    if (!res) return;
    reveal(res, usedOffline, Math.max(0, (reduce ? 0 : 1100) - (performance.now() - started)));
  }, [hasSource, aiText, file, sample, compare, reduce, canRecord]);

  // Play the dig for a finished check: each sentence cracks open, then the results.
  function reveal(r: CheckResult, usedOffline: boolean, wait: number) {
    at(wait, () => {
      setResult(r);
      setOffline(usedOffline);
      setSel(r.claims.find((c) => c.verdict !== "supported")?.id ?? r.claims[0]?.id ?? null);
      const n = r.claims.length;
      if (reduce) { setDug(n); setSlam(true); at(1200, () => setStage("results")); return; }
      for (let i = 1; i <= n; i++) at(i * CRACK_MS, () => setDug(i));
      at(n * CRACK_MS + 450, () => setSlam(true));
      at(n * CRACK_MS + 2200, () => setStage("results"));
    });
  }
  const showRecorded = () => { setRunError(null); reveal(RECORDED, true, 0); };

  const skip = useCallback(() => { if (result) { clearTimers(); setDug(result.claims.length); setSlam(true); setStage("results"); } }, [result]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stage === "digging") skip(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, skip]);

  const restart = () => { clearTimers(); setStage("input"); setResult(null); setRunError(null); setFixRes(null); setFixErr(null); };
  const runFix = () => {
    if (!lastInput.current || fixing) return;
    setFixing(true);
    setFixErr(null);
    fix(lastInput.current).then(setFixRes).catch((e: ApiFailure) => setFixErr(friendlyError(e).text)).finally(() => setFixing(false));
  };

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <Header current={2} next={{ href: "/scoreboard", label: "Next: Scoreboard" }} />
      {stage === "input" ? (
        <InputView
          samples={samples} sampleId={sampleId} sample={sample} file={file} aiText={aiText} count={count} error={inputError} shakeKey={shakeKey}
          onSample={pickSample} onFile={pickFile} onClearFile={() => { setFile(null); setFileText(null); }} onText={setAiText} onCheck={run}
        />
      ) : null}
      {stage === "results" && result ? (
        <ResultsView
          result={result} offline={offline} originalText={sample?.sourceText ?? fileText} sel={sel} onSel={setSel} onRestart={restart}
          internReady={Boolean(health?.intern?.ready)} fixing={fixing} fixRes={fixRes} fixErr={fixErr} onFix={runFix}
          pdf={sample?.pdfUrl ? { url: sample.pdfUrl } : file && /\.pdf$/i.test(file.name) ? { file } : null}
        />
      ) : null}
      {stage === "digging" ? (
        <DigOverlay
          flood={flood} dropped={dropped} dug={dug} slam={slam} result={result} error={runError} onRecorded={canRecord ? showRecorded : undefined} sourceName={file?.name ?? sample?.sourceName ?? ""} reader={health?.defaults.perceiver === "ndi" ? "NDI" : "The reader"}
          placeholders={pendingClaims.length ? pendingClaims : Array.from({ length: count || 7 }, () => "")} onSkip={skip} onBack={restart}
        />
      ) : null}
    </div>
  );
}

/* ---------- 1 · input: the dig site ---------- */

function InputView(props: {
  samples: SampleInfo[] | null; sampleId: string | null; sample: SampleFull | null; file: File | null; aiText: string; count: number | null; error: string | null; shakeKey: number;
  onSample: (id: string) => void; onFile: (f: File | null | undefined) => void; onClearFile: () => void; onText: (t: string) => void; onCheck: () => void;
}) {
  const { samples, sampleId, sample, file, aiText, count, error, shakeKey } = props;
  const [over, setOver] = useState(false);
  const [fossil, setFossil] = useState<string | null>(null);
  const hasSource = Boolean(sample || file);
  const name = file?.name ?? sample?.sourceName ?? "";
  const meta = file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : sample ? sample.title : "";
  const rexLine = error ? error.toLowerCase() : !hasSource ? "add the original first." : fossil ? fossil : count ? `${count} sentences. ready!` : count === 0 ? "paste the AI’s text." : "ready when you are.";
  const label = { fontSize: 19, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 } as const;

  return (
    <div>
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "8px 40px 0 40px" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 72, lineHeight: 1 }}>Check a document. <span style={{ color: "var(--faint)" }}>Is the AI’s summary true?</span></h1>
        <div style={{ display: "flex", gap: 28, marginTop: 28 }}>
          <div style={{ flex: "0 0 400px", display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={label}><span className="num">1</span>Add the original document</span>
            <label
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); props.onFile(e.dataTransfer.files?.[0]); }}
              style={{
                position: "relative", height: 236, borderRadius: 18, cursor: "pointer", padding: 22, display: "flex", flexDirection: "column", justifyContent: "space-between",
                backgroundColor: hasSource ? "#EADFCB" : "var(--sheet)",
                backgroundImage: hasSource ? "radial-gradient(circle, rgba(34,23,15,.10) 1px, transparent 1.6px)" : "none", backgroundSize: "8px 8px",
                boxShadow: over ? "inset 0 0 0 3px var(--amber)" : hasSource ? "inset 0 0 0 2px var(--ink), inset 0 -8px 0 #D9CAB0" : "inset 0 0 0 2px var(--line-2)",
              }}
            >
              <input type="file" accept={ACCEPT} onChange={(e) => props.onFile(e.target.files?.[0])} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
              {hasSource ? (
                <>
                  <div style={{ position: "relative", height: 104 }}>
                    <PageIcon width={66} style={{ position: "absolute", left: 30, top: 14, transform: "rotate(-8deg)" }} />
                    <PageIcon width={66} style={{ position: "absolute", left: 60, top: 6, transform: "rotate(4deg)" }} />
                    <PageIcon width={66} style={{ position: "absolute", left: 92, top: 16, transform: "rotate(12deg)" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, fontSize: 19, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                      <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>{meta} · drop another to swap</span>
                    </span>
                    {file ? (
                      <button type="button" aria-label="Remove the file" className="press" onClick={(e) => { e.preventDefault(); props.onClearFile(); }} style={{ width: 42, height: 42, border: 0, borderRadius: 999, background: "var(--sheet)", boxShadow: "inset 0 0 0 1px var(--line-2)", cursor: "pointer" }}>✕</button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center" }}>
                  <PageIcon width={44} />
                  <span style={{ fontSize: 19, fontWeight: 600 }}>Drop the original here</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>PDF · Word · scan · sheet · email · or click</span>
                </div>
              )}
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>or try:</span>
              {(samples ?? []).map((s) => {
                const on = s.id === sampleId;
                return (
                  <button key={s.id} type="button" className="press" onClick={() => props.onSample(s.id)} aria-pressed={on}
                    style={{ border: 0, cursor: "pointer", borderRadius: 999, padding: "9px 14px", fontSize: 14, fontWeight: 500, color: on ? "var(--paper)" : "var(--ink)", background: on ? "var(--ink)" : "var(--sheet)", boxShadow: on ? "none" : "inset 0 0 0 1px var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
                    <BoneIcon verdict="supported" width={26} dark={on} />{s.title}
                  </button>
                );
              })}
              {samples === null ? <span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>loading samples…</span> : null}
            </div>
          </div>

          <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <label htmlFor="ai" style={label}><span className="num">2</span>Paste what the AI wrote about it</label>
            <div key={shakeKey} className={error && !aiText.trim() ? "shake" : undefined} style={{ borderRadius: 18, background: error && !aiText.trim() ? "#F9E1DA" : "var(--sheet)", boxShadow: error && !aiText.trim() ? "inset 0 0 0 2px var(--red)" : "inset 0 0 0 1px var(--line)", padding: "20px 24px", height: 282 }}>
              <textarea id="ai" value={aiText} onChange={(e) => props.onText(e.target.value)} placeholder="Paste the summary, memo or answer" aria-invalid={Boolean(error && !aiText.trim())}
                className="serif" style={{ width: "100%", height: "100%", border: 0, background: "transparent", resize: "none", padding: 0, color: "var(--ink)", fontSize: 24, lineHeight: 1.25 }} />
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{count ? `${count} sentences` : aiText.trim() ? "counting sentences…" : "sentences are counted as you type"}</span>
          </div>
        </div>
      </main>

      <section aria-label="Dig site" style={{ position: "relative", height: 420, marginTop: 10, overflowX: "clip", overflowY: "visible" }}>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 128, height: 2, backgroundImage: "repeating-linear-gradient(90deg, #76665A 0 2px, transparent 2px 6px)" }} />
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 130, height: 46, backgroundColor: "#E9DCC6", backgroundImage: "radial-gradient(circle, rgba(34,23,15,.12) 1px, transparent 1.6px)", backgroundSize: "8px 8px" }} />
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 176, height: 46, backgroundColor: "#E1D1B6", backgroundImage: "radial-gradient(circle, rgba(34,23,15,.12) 1px, transparent 1.6px)", backgroundSize: "10px 10px" }} />
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 222, bottom: 0, backgroundColor: "#D8C6A6", backgroundImage: "radial-gradient(circle, rgba(34,23,15,.14) 1px, transparent 1.6px)", backgroundSize: "7px 7px" }} />
        <SandDig onFind={(label, n, total) => setFossil(n === total ? `all ${n}! what a dig.` : `ooh, ${label}`)} />
        <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", height: "100%", padding: "0 40px", pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 80, top: 48, display: "flex", alignItems: "flex-end", gap: 0 }}>
            <Rex rows={error || !hasSource ? REX_SIDE : REX} width={88} />
            <Pick width={45} style={{ marginLeft: -8, marginBottom: 18, transform: "rotate(20deg)" }} />
          </div>
          <p role="status" className="mono" style={{ position: "absolute", left: 230, top: 40, margin: 0, background: "var(--ink)", color: "var(--paper)", fontSize: 13.5, padding: "9px 14px", borderRadius: "14px 14px 14px 4px", whiteSpace: "nowrap" }}>{rexLine}</p>
          <span style={{ position: "absolute", right: 230, top: 40, fontSize: 19, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}><span className="num">3</span>Press Check</span>
          <button key={`btn-${shakeKey}`} type="button" onClick={props.onCheck} aria-label="Check" className={`lift keep ${error ? "shake" : ""}`}
            style={{ pointerEvents: "auto", position: "absolute", right: 60, top: -18, width: 148, height: 148, border: 0, borderRadius: 999, background: "var(--amber)", color: "var(--ink)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, boxShadow: "0 6px 0 -2px #C98500" }}>
            <Pick width={46} head="#FFFAF2" style={{ transform: "rotate(-20deg)" }} />
            <span className="serif" style={{ fontSize: 34, lineHeight: 1 }}>Check</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------- 2 · the dig ---------- */

function DigOverlay({ flood, dropped, dug, slam, result, error, onRecorded, sourceName, reader, placeholders, onSkip, onBack }: {
  flood: boolean; dropped: boolean; dug: number; slam: boolean; result: CheckResult | null; error: { text: string; code: string } | null; onRecorded?: () => void; sourceName: string; reader: string; placeholders: string[]; onSkip: () => void; onBack: () => void;
}) {
  const claims: Array<Partial<CheckedClaim> & { text: string }> = result ? result.claims : placeholders.map((t) => ({ text: t }));
  const n = Math.max(1, claims.length);
  const layerH = Math.max(26, Math.min(62, Math.floor(500 / n) - 8));
  const digIdx = Math.min(dug, n - 1);
  const bad = result ? result.claims.slice(0, dug).filter((c) => c.verdict !== "supported").length : 0;
  const total = result?.summary.total ?? 0;
  const problems = result ? result.summary.contradicted + result.summary.not_in_source : 0;
  const lastV = result && dug > 0 ? result.claims[dug - 1].verdict : null;

  return (
    <div role="status" aria-label="Checking" style={{ position: "absolute", inset: 0, zIndex: 20, background: "var(--ink)", color: "var(--paper)", clipPath: flood ? "circle(160% at 86% 30%)" : "circle(0px at 86% 30%)", transition: "clip-path 800ms cubic-bezier(.32,.72,0,1)" }}>
      <div style={{ position: "relative", maxWidth: 1440, margin: "0 auto", height: "100%", minHeight: 900 }}>
        <div style={{ position: "absolute", left: 60, right: 60, top: 36, display: "flex", alignItems: "center", gap: 18 }}>
          <span className="mono" style={{ fontSize: 13, color: "var(--faint)" }}>{error ? `Check stopped · ${sourceName}` : !result ? `${reader} is reading ${sourceName}…` : slam ? `${sourceName} · ${total} sentences checked` : `${deciderName(result.engines.decider)} is checking ${total} sentences`}</span>
          {result && !error ? <button type="button" onClick={onSkip} className="press mono" style={{ marginLeft: "auto", border: 0, cursor: "pointer", background: "var(--ink-2)", color: "var(--paper)", fontSize: 12, padding: "8px 12px", borderRadius: 8 }}>Skip · Esc</button> : null}
        </div>
        <p className="mono" style={{ position: "absolute", left: 0, right: 0, top: 78, margin: 0, textAlign: "center", fontSize: 26, letterSpacing: ".04em" }}>
          {error ? null : result ? <>CHECKED {dug} / {total} <span style={{ color: "var(--red-light)" }}>· {bad} {bad === 1 ? "PROBLEM" : "PROBLEMS"}</span></> : "READING…"}
        </p>

        {error ? (
          <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
            <Rex rows={REX_SIDE} width={120} dark />
            <p className="serif" style={{ margin: 0, fontSize: 48 }}>That didn’t work.</p>
            <p style={{ margin: 0, fontSize: 20, color: "#D3C4AC", maxWidth: 560 }}>{error.text}</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button type="button" onClick={onBack} className="btn-next press">Go back</button>
              {onRecorded ? <button type="button" onClick={onRecorded} className="btn-dark press" style={{ boxShadow: "inset 0 0 0 1.5px #5A4A3C" }}>See a recorded check</button> : null}
            </div>
            <span className="mono" style={{ fontSize: 12, color: "#76665A" }}>{error.code}</span>
          </div>
        ) : (
          <>
            <div style={{ position: "absolute", left: 240, top: 140, width: 1000 }}>
              {claims.map((c, i) => {
                const open = Boolean(result) && i < dug;
                const v = c.verdict;
                const wrong = v === "contradicted";
                const none = v === "not_in_source";
                return (
                  <div key={i} className={`fade ${open && wrong ? "shake" : ""}`}
                    style={{
                      position: "relative", height: layerH, marginBottom: 8, borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", gap: 18, padding: "0 22px",
                      backgroundColor: !open ? EARTH[i % EARTH.length] : wrong ? "#5A2A1E" : none ? "#2A2019" : "#4A3826",
                      backgroundImage: "radial-gradient(circle, rgba(245,238,226,.10) 1px, transparent 1.6px)", backgroundSize: "8px 8px",
                      boxShadow: open ? `inset 0 0 0 2px ${wrong ? "#C4321F" : none ? "#5A4A3D" : "#F0A202"}` : "none",
                      opacity: dropped ? 1 : 0, transform: dropped ? "none" : "translateY(-40px)", transitionDelay: dropped && dug === 0 ? `${Math.min(i, 12) * 60}ms` : "0ms",
                    }}>
                    <svg width="1000" height={layerH} viewBox={`0 0 1000 62`} preserveAspectRatio="none" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, opacity: open ? 0.7 : 0, transition: "opacity 200ms" }}>
                      <path d={crackPath(i + 3)} fill="none" stroke="#0F0A06" strokeWidth={3} shapeRendering="crispEdges" />
                    </svg>
                    <span className="mono" style={{ position: "relative", width: 30, fontSize: 12, color: "var(--faint)" }}>S{i + 1}</span>
                    <span className="serif" style={{ position: "relative", flex: "0 0 520px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: Math.min(21, layerH * 0.45), color: !open ? "#7A6858" : wrong ? "#FFB3A6" : none ? "#76665A" : "#F5EEE2" }}>{c.text}</span>
                    {v ? <BoneIcon verdict={v} width={Math.min(65, layerH)} dark className="pop" style={{ position: "relative", opacity: open ? 1 : 0, transform: open ? "none" : "scale(.4)" }} /> : null}
                    {v ? (
                      <span className="mono pop" style={{ position: "relative", marginLeft: "auto", fontSize: 12.5, color: wrong ? "#FF7A66" : none ? "#A6978A" : "#F0A202", opacity: open ? 1 : 0 }}>
                        {UPPER[v]}{where(c.receipt) ? ` · ${where(c.receipt)}` : ""}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div style={{ position: "absolute", left: 110, top: 140 + digIdx * (layerH + 8) + layerH / 2 - 52, width: 130, height: 80, opacity: dropped ? 1 : 0, transition: "top 300ms cubic-bezier(.22,1,.36,1), opacity 420ms" }}>
              <Rex rows={slam ? REX_HAPPY : lastV && lastV !== "supported" ? REX_SIDE : REX} width={88} dark style={{ position: "absolute", left: 0, top: 0 }} />
              {!slam ? (
                <>
                  <Pick width={45} dark className="swing" style={{ position: "absolute", left: 80, top: 10 }} />
                  <span className="dirt1" aria-hidden="true" style={{ position: "absolute", left: 118, top: 52, width: 8, height: 8, background: "#C9A26A" }} />
                  <span className="dirt2" aria-hidden="true" style={{ position: "absolute", left: 124, top: 60, width: 6, height: 6, background: "#A6978A" }} />
                  <span className="dirt3" aria-hidden="true" style={{ position: "absolute", left: 114, top: 64, width: 8, height: 8, background: "#C9A26A" }} />
                </>
              ) : null}
            </div>

            {slam && result ? (
              <div style={{ position: "absolute", left: 0, right: 0, top: 690, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <p className="serif slam" style={{ margin: 0, fontSize: 96, lineHeight: 1 }}>
                  {problems ? <><span style={{ color: "var(--red-light)" }}>{problems} of {total}</span> have problems</> : <>All {total} check out</>}
                </p>
                <p className="mono slam" style={{ margin: 0, fontSize: 14, color: "var(--faint)", animationDelay: "240ms" }}>opening the proof…</p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- 3 · results with proof ---------- */

function ResultsView({ result, offline, originalText, pdf, sel, onSel, onRestart, internReady, fixing, fixRes, fixErr, onFix }: {
  result: CheckResult; offline: boolean; originalText: string | null; pdf: { url: string } | { file: File } | null; sel: string | null; onSel: (id: string) => void; onRestart: () => void;
  internReady: boolean; fixing: boolean; fixRes: FixResult | null; fixErr: string | null; onFix: () => void;
}) {
  const s = result.summary;
  const problems = s.contradicted + s.not_in_source;
  const mainName = deciderName(result.engines.decider);
  const readBy = result.engines.perceiver === "ndi" ? "NDI" : "The built-in reader";
  const cost = (result.usage.decide?.costUsd ?? 0) + (result.usage.ground?.costUsd ?? 0);
  const cmp = result.comparison ?? null;
  const cur = result.claims.find((c) => c.id === sel) ?? null;
  const [adobeFailed, setAdobeFailed] = useState(false);
  const useAdobe = Boolean(pdf && ADOBE_CLIENT_ID && result.adobeDocId && !adobeFailed && !offline);

  // the drawn contract page: the selected sentence's clause lit, every other verdict marked softly
  const doc = useMemo(() => (originalText ? parseContract(originalText) : null), [originalText]);
  const curAt = doc && cur ? blockFor(doc, cur) : null;
  const [page, setPage] = useState(1);
  useEffect(() => { if (curAt) setPage(curAt.page); }, [curAt?.page, curAt?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const marks = useMemo(() => (doc ? marksFor(doc, result.claims, sel ? [sel] : []) : {}), [doc, result, sel]);

  // plain-text uploads with no clause structure: highlight in the text itself
  const textMarks: Mark[] = useMemo(() => {
    if (!originalText) return [];
    return result.claims.flatMap((c) => {
      const span = locate(originalText, c.receipt);
      if (!span) return [];
      const on = c.id === sel;
      return [{ id: c.id, start: span[0], end: span[1], bg: on ? WASH[c.verdict] : "transparent", underline: on ? RING[c.verdict] : c.verdict === "supported" ? "#E8C77A" : RING[c.verdict] }];
    });
  }, [originalText, result, sel]);
  const looksLikeContract = Boolean(doc && doc.pages.flat().some((b) => b.t === "clause"));
  const facts = (result.keyFacts ?? []).filter((k) => k.status === "found" && k.value);
  const pageOfSection = (sec: string | null) => {
    if (!doc || !sec) return null;
    const i = doc.pages.findIndex((bl) => bl.some((b) => b.t === "clause" && b.key === sec.replace(/^§/, "")));
    return i >= 0 ? i + 1 : null;
  };
  const [copied, setCopied] = useState(false);

  function exportReceipt() {
    const lines = [
      "BONEIFY · RECEIPT",
      `Original: ${result.source.name}${result.source.pages ? ` (${result.source.pages} ${result.source.pages === 1 ? "page" : "pages"})` : ""}`,
      `Checked: ${new Date(result.createdAt).toLocaleString()} by ${mainName} (${result.engines.deciderModel}), read by ${readBy}`,
      `Time: ${fmtMs(result.timings.totalMs)} · Cost: ${fmtUsd(cost)}`,
      `Result: ${problems} of ${s.total} sentences have problems (${s.contradicted} wrong, ${s.not_in_source} made up)`,
      "",
      ...result.claims.flatMap((c) => [
        `${c.id.toUpperCase()}  ${UPPER[c.verdict]}  (${Math.round(c.confidence * 100)}% sure)${c.needsReview ? "  · needs review" : ""}`,
        `    AI wrote: ${c.text}`,
        c.receipt.status === "found" && c.receipt.quote ? `    Original${where(c.receipt) ? ` ${where(c.receipt)}` : ""}${c.receipt.page ? `, page ${c.receipt.page}` : ""}: ${c.receipt.quote.replace(/\s+/g, " ").trim()}` : "    Original: nothing found",
        "",
      ]),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `boneify-receipt-${result.source.name.replace(/\.[^.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="rise" style={{ maxWidth: 1280, margin: "0 auto", padding: "4px 40px 56px 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <h1 className="serif" style={{ margin: 0, display: "flex", alignItems: "flex-end", gap: 16, fontSize: 56, lineHeight: 1 }}>
            <Rex rows={problems ? REX_SIDE : REX_HAPPY} width={66} />
            {problems ? <span><span style={{ color: "var(--red)" }}>{problems} of {s.total}</span> sentences have problems.</span> : <span>All {s.total} sentences check out.</span>}
          </h1>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, color: "var(--muted)" }}>Click a sentence to see the proof.</span>
            <Key />
            {offline ? <span className="mono" style={{ fontSize: 12, background: "var(--grey-wash)", padding: "4px 8px", borderRadius: 6 }}>RECORDED · an earlier real check of this sample</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          <button type="button" className="btn-light press" onClick={exportReceipt}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
            Download receipt
          </button>
          {internReady && problems > 0 && !offline ? (
            <button type="button" className="btn-next press keep" onClick={onFix} disabled={fixing} style={{ opacity: fixing ? 0.7 : 1 }}>
              {fixing ? `Intern is fixing ${problems} ${problems === 1 ? "sentence" : "sentences"}…` : "Fix with Intern"}
            </button>
          ) : null}
          <button type="button" className="btn-dark press" onClick={onRestart}>Check another</button>
        </div>
      </div>
      {fixErr ? <p className="mono" style={{ margin: "10px 0 0 0", fontSize: 13, color: "var(--red)" }}>{fixErr}</p> : null}

      <div aria-label="Who did what" style={{ marginTop: 20, background: "var(--ink)", color: "var(--paper)", borderRadius: 18, padding: "14px 22px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 30, fontSize: 15 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageIcon width={20} />
          <span><b>{readBy}</b> read {result.source.pages} {result.source.pages === 1 ? "page" : "pages"}</span>
          <span className="mono" style={{ fontSize: 14 }}>{fmtMs(result.timings.parseMs + result.timings.groundMs)}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Rex width={30} dark />
          <span><b>{mainName}</b> checked {s.total} sentences</span>
          <span className="mono" style={{ fontSize: 14, color: "var(--amber)" }}>{fmtMs(result.timings.decideMs)} · {fmtUsd(result.usage.decide?.costUsd ?? 0)}</span>
        </span>
        {cmp ? (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <Sauro width={40} dark />
            <span>{cmp.model || deciderName(cmp.decider)}</span>
            <span className="mono" style={{ fontSize: 14, color: "var(--faint)" }}>{fmtMs(cmp.decideMs)} · {fmtUsd(cmp.costUsd)} · agreed on {cmp.agreement.same} of {cmp.agreement.total}</span>
          </span>
        ) : null}
      </div>

      {fixRes ? (
        <section aria-label="Fixed by Intern" className="rise" style={{ marginTop: 16, background: "var(--sheet)", borderRadius: 18, boxShadow: "inset 0 0 0 2px var(--amber)", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <span className="serif" style={{ fontSize: 34, lineHeight: 1 }}>Intern fixed it.</span>
            <span className="mono" style={{ fontSize: 14 }}>
              <span style={{ color: "var(--red)" }}>{fixRes.before.summary.supported} of {fixRes.before.summary.total} correct</span> → <span style={{ color: "var(--amber-text)", fontWeight: 600 }}>{fixRes.after.summary.supported} of {fixRes.after.summary.total} correct</span>
            </span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
              Intern · System 1 {fixRes.intern.system1 ?? "Drex"} ({fixRes.intern.system1Asks} decisions) · System 2 {fixRes.intern.system2} · {fmtMs(fixRes.timings.totalMs)}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {fixRes.changes.map((ch) => (
              <div key={ch.claimId} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 24px minmax(0, 1fr)", gap: 12, alignItems: "baseline" }}>
                <span className="serif" style={{ fontSize: 19, color: "var(--red)", textDecoration: "line-through", textDecorationThickness: 2 }}>{ch.before}</span>
                <span aria-hidden="true" style={{ color: "var(--muted)" }}>→</span>
                <span className="serif" style={{ fontSize: 19 }}>{ch.after ?? <span style={{ color: "var(--muted)" }}>removed: the original never says this</span>}{ch.evidence ? <span className="mono" style={{ marginLeft: 8, fontSize: 11.5, color: "var(--amber-text)" }}>from “{ch.evidence.length > 40 ? `${ch.evidence.slice(0, 39)}…` : ch.evidence}”</span> : null}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-light press" onClick={() => { navigator.clipboard?.writeText(fixRes.fixedText).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Copied" : "Copy the fixed text"}</button>
          </div>
        </section>
      ) : null}

      <div style={{ display: "flex", gap: 28, marginTop: 20, alignItems: "flex-start" }}>
        <section aria-label="The original" style={{ flex: "1 1 0", minWidth: 0, position: "sticky", top: 16, background: "#E7DECF", borderRadius: 18, padding: "12px 14px 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--muted)" }}>
            <span style={{ color: "var(--ink)" }}>{result.source.name}</span>
            <span>· proof highlighted on the page</span>
            {!useAdobe && doc && looksLikeContract ? (
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} style={{ border: 0, background: "none", cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" }}>‹</button>
                <span style={{ color: cur ? TEXT_COLOR[cur.verdict] : "var(--muted)" }}>Page {page} of {doc.pages.length}</span>
                <button type="button" aria-label="Next page" onClick={() => setPage((p) => Math.min(doc.pages.length, p + 1))} style={{ border: 0, background: "none", cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" }}>›</button>
              </span>
            ) : useAdobe ? <span style={{ marginLeft: "auto" }}>Adobe PDF viewer</span> : null}
          </div>
          {useAdobe && pdf ? (
            <AdobeViewer result={result} pdf={pdf} fileName={result.source.name} selected={sel} height={660} onFail={() => setAdobeFailed(true)} />
          ) : doc && looksLikeContract ? (
            <ContractPage doc={doc} page={page} marks={marks} dim={Boolean(cur)} height={660} />
          ) : originalText ? (
            <div style={{ background: "#fff", borderRadius: 6, height: 660 }}>
              <SourceView text={originalText} marks={textMarks} activeId={sel} fontSize={14.5} />
            </div>
          ) : (
            <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>{result.source.pages} {result.source.pages === 1 ? "page" : "pages"} · read by {readBy}</p>
          )}
        </section>

        <section aria-label="Sentences" style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {facts.length ? (
            <div aria-label="Key facts" style={{ marginBottom: 12, background: "var(--sheet)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--line)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{result.documentType?.label ? `${result.documentType.label.toUpperCase()} · ` : ""}KEY FACTS NDI FOUND, EACH WITH ITS SOURCE</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 18px" }}>
                {facts.slice(0, 8).map((k) => {
                  const pg = pageOfSection(k.section) ?? k.page;
                  return (
                    <button key={k.field} type="button" onClick={() => { if (pg) setPage(pg); }} title={k.quote ?? undefined}
                      style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: pg ? "pointer" : "default", color: "var(--ink)", display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{k.label}</span>
                      <span className="serif" style={{ fontSize: 18, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.value}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--amber-text)" }}>{[k.section ? `§${k.section.replace(/^§/, "")}` : null, k.page ? `page ${k.page}` : null].filter(Boolean).join(" · ") || "cited"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {result.claims.map((c, i) => {
            const open = c.id === sel;
            const label = c.verdict === "supported" ? `CORRECT${where(c.receipt) ? ` · ${where(c.receipt)}` : ""}` : c.verdict === "contradicted" ? `WRONG${where(c.receipt) ? ` · ${where(c.receipt)}` : ""}` : "MADE UP";
            return (
              <div key={c.id} className="ring rise layer" style={{ borderRadius: 14, background: open ? "var(--sheet)" : "transparent", boxShadow: open ? `inset 0 0 0 2px ${RING[c.verdict]}` : "none", animationDelay: `${Math.min(i, 12) * 50}ms` }}>
                <button type="button" onClick={() => onSel(c.id)} aria-expanded={open} style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", cursor: "pointer", color: "var(--ink)", padding: "9px 14px", display: "flex", gap: 12, alignItems: "center" }}>
                  <BoneIcon verdict={c.verdict} width={26} style={{ flex: "0 0 auto" }} />
                  <span className="serif" style={{ flex: "1 1 auto", minWidth: 0, fontSize: 20, lineHeight: 1.25, color: c.verdict === "contradicted" ? "var(--red)" : "var(--ink)", whiteSpace: open ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.text}</span>
                  <span className="mono" style={{ flex: "0 0 auto", fontSize: 11.5, color: TEXT_COLOR[c.verdict], whiteSpace: "nowrap" }}>{label}</span>
                </button>
                {open ? (
                  <div style={{ padding: "0 18px 14px 52px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ borderLeft: `3px solid ${RING[c.verdict]}`, paddingLeft: 14 }}>
                      <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                        {c.receipt.status !== "found" ? "Nothing in the original says this" : c.verdict === "not_in_source" ? "Not in the original · closest" : "The original says"}
                        {where(c.receipt) ? ` · ${where(c.receipt)}` : ""}{c.receipt.page && !where(c.receipt).startsWith("page") ? ` · page ${c.receipt.page}` : ""}
                      </span>
                      {c.receipt.quote ? <p style={{ margin: "4px 0 0 0", fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1.45 }}>{c.receipt.quote.replace(/\s+/g, " ").trim()}</p> : null}
                    </div>
                    <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)" }}>
                      <span>{mainName} {Math.round(c.confidence * 100)}% sure</span>
                      {c.needsReview ? <span style={{ background: "var(--ink)", color: "var(--paper)", borderRadius: 999, padding: "3px 9px", fontSize: 10.5, letterSpacing: ".05em" }}>NEEDS REVIEW</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
