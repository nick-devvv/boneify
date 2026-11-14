"use client";

// The demo: exactly what Try it does, played once in five steps with arrows and captions.
// 1 the AI's summary → 2 split, NDI reads the PDF, Drex checks every sentence → 3 the wrong ones, each with its clause
// lit on its page → 4 the made-up one → 5 who did what, and the race against the big AI model.
// It replays the recorded check (data/demo/recorded-check.json): a real Drex + NDI run, saved. The demo never calls the
// backend, so opening it costs nothing; only "Try it" (/check) runs live checks.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckResult, CheckedClaim } from "../../lib/types";
import { ContractPage, blockFor, marksFor, parseContract } from "../_ui/Contract";
import { Header } from "../_ui/Header";
import { Key } from "../_ui/Key";
import { REX, REX_HAPPY, REX_SIDE } from "../_ui/pixel";
import { RECORDED, RECORDED_SOURCE } from "../_ui/recorded";
import { Arrow, BoneIcon, Chevron, PageIcon, Rex } from "../_ui/Sprites";
import { RING, TEXT_COLOR, deciderName, fmtMs, fmtUsd, where } from "../_ui/verdict";

type Step = { caps: string[]; rex: string[] };
const POKES = ["RAWR.", "Receipts, please.", "Hey!", "Press the arrow!"];
const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NUM = ["no", "One", "Two", "Three", "Four", "Five"];

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => { setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  return reduce;
}

export function LiveDemo() {
  const reduce = useReducedMotion();
  const [data, setData] = useState<CheckResult>(RECORDED);
  const [live, setLive] = useState(false);
  const [step, setStep] = useState(1);
  const [sub, setSub] = useState(0);
  const [held, setHeld] = useState(0);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);
  const [pokes, setPokes] = useState(0);
  const rexRef = useRef<HTMLButtonElement>(null);
  const decidedRef = useRef(false);

  const doc = useMemo(() => parseContract(RECORDED_SOURCE.text), []);
  const claims = data.claims;
  const n = claims.length;
  const pages = data.source.pages > 1 ? data.source.pages : doc.pages.length;
  const wrongs = claims.filter((c) => c.verdict === "contradicted").slice(0, 3);
  const nones = claims.filter((c) => c.verdict === "not_in_source").slice(0, 2);
  const cmp = data.comparison ?? null;
  const baseShort = cmp ? (cmp.model || deciderName(cmp.decider)) : null;

  // the steps come from the check itself: one move per wrong sentence, one per made-up one
  const steps: Array<Step & { id: string }> = useMemo(() => {
    const s: Array<Step & { id: string }> = [
      { id: "intro", caps: [`An AI summarized this ${pages}-page contract.`, "Is every sentence true?"], rex: ["Hmm.", "Let’s check."] },
      { id: "check", caps: ["Boneify checks it.", `It splits the summary into ${n} sentences.`, "NDI reads the PDF.", `Drex checks all ${n} at once.`], rex: ["Ready…", `${n} bones.`, "NDI is reading…", "Done already!"] },
    ];
    if (wrongs.length) s.push({
      id: "wrong",
      caps: [`${NUM[wrongs.length] ?? wrongs.length} ${wrongs.length === 1 ? "sentence is" : "sentences are"} wrong.`, ...wrongs.map((c) => `“${short(c.text.replace(/\.$/, ""), 36)}”: wrong${where(c.receipt) ? `, see ${where(c.receipt)}` : ""}.`)],
      rex: ["Hmm…", ...wrongs.map((_, i) => (i ? "Nope again!" : "Nope!"))],
    });
    if (nones.length) s.push({
      id: "none",
      caps: [`${NUM[nones.length] ?? nones.length} ${nones.length === 1 ? "sentence is" : "sentences are"} made up.`, nones.some((c) => c.needsReview) ? "The contract never says it. Flagged for a person." : "The contract never says it."],
      rex: ["Sniff…", "Made up!"],
    });
    s.push(cmp
      ? { id: "who", caps: ["Every check shows who did what.", `Same summary, raced against ${baseShort}.`, `Drex is done. ${baseShort} is still going…`], rex: ["Teamwork.", "Ready…", "Done first!"] }
      : { id: "who", caps: ["Every check shows who did what.", `NDI read ${pages} pages. Drex checked ${n} sentences.`], rex: ["Teamwork.", "Receipts, please."] });
    return s;
  }, [pages, n, wrongs, nones, cmp, baseShort]);
  const SUBS = steps.map((s) => s.caps.length - 1);
  const last = steps.length;
  const cur = steps[Math.min(step, last) - 1];
  const at = done || reduce ? SUBS[step - 1] : sub;


  // every 1.1 s: the current step's next small move; autoplay holds two ticks, moves on, and stops after the last step
  useEffect(() => {
    if (reduce || done) return;
    const t = window.setInterval(() => {
      if (sub < SUBS[step - 1]) { setSub(sub + 1); hop(); return; }
      if (paused) return;
      if (held < 2) { setHeld(held + 1); return; }
      if (step === last) { setDone(true); setPaused(true); setPokes(0); hop(); return; }
      setStep(step + 1); setSub(0); setHeld(0); setPokes(0); hop();
    }, 1100);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, done, sub, step, held, paused, last]);

  const go = (k: number) => { setStep(k); setSub(reduce ? SUBS[k - 1] : 0); setHeld(0); setPaused(true); setDone(false); setPokes(0); hop(); };
  const next = () => {
    if (done) return;
    if (sub < SUBS[step - 1] && !reduce) { setSub(SUBS[step - 1]); setPaused(true); hop(); return; }
    if (step === last) { setDone(true); setPaused(true); setPokes(0); hop(); return; }
    go(step + 1);
  };
  const back = () => { if (done) { setDone(false); setStep(last); setSub(SUBS[last - 1]); setPaused(true); return; } go(step === 1 ? 1 : step - 1); };
  const replay = () => { setStep(1); setSub(0); setHeld(0); setPaused(false); setDone(false); setPokes(0); };
  function hop() {
    if (reduce || !rexRef.current?.animate) return;
    rexRef.current.animate([{ transform: "translateY(0)" }, { transform: "translateY(-16px)" }, { transform: "translateY(0)" }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" });
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || (e.key === " " && tag !== "BUTTON" && tag !== "A")) { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // what the screen shows at this moment
  const id = done ? "who" : cur.id;
  const isPara = id === "intro" || (id === "check" && at === 0);
  const reading = id === "check" && at === 2;
  const decided = !(id === "intro" || (id === "check" && at < 3));
  useEffect(() => { if (decided) decidedRef.current = true; }, [decided]);
  let focus: string[] = [];
  if (id === "wrong") focus = at === 0 ? wrongs.map((c) => c.id) : [wrongs[at - 1]?.id].filter(Boolean) as string[];
  if (id === "none") focus = nones.map((c) => c.id);
  const one: CheckedClaim | null = focus.length === 1 ? claims.find((c) => c.id === focus[0]) ?? null : null;
  const oneAt = one ? blockFor(doc, one) : null;
  const firstAt = id === "none" && nones[0] ? blockFor(doc, nones[0]) : id === "wrong" && wrongs[0] ? blockFor(doc, wrongs[0]) : null;
  const pageNo = oneAt?.page ?? firstAt?.page ?? 1;
  const marks = decided ? marksFor(doc, claims, focus) : {};
  const bad = decided ? claims.filter((c) => c.verdict !== "supported").length : 0;
  const raceOn = id === "who" && (done || at >= 2) && Boolean(cmp);
  const ratio = cmp && data.timings.decideMs > 0 ? cmp.decideMs / data.timings.decideMs : 12;
  const drexMs = 300, gptMs = Math.min(6000, Math.round(drexMs * Math.max(1, ratio)));

  let rexLine = done ? "Your turn!" : cur.rex[Math.min(at, cur.rex.length - 1)];
  if (pokes > 0) rexLine = POKES[(pokes - 1) % POKES.length];
  const mood = done ? REX_HAPPY : (id === "wrong" || id === "none") && at >= 1 ? REX_SIDE : id === "who" && at >= 2 ? REX_HAPPY : REX;
  const caption = done ? "That’s it. Now try your own." : cur.caps[Math.min(at, cur.caps.length - 1)];

  return (
    <div style={{ height: "100vh", minHeight: 760, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Header current={1} next={{ href: "/check", label: "Next: Try it" }}
        extra={
          <button type="button" className="icon-btn press" aria-label={done ? "Replay" : paused ? "Play" : "Pause"} onClick={() => (done ? replay() : (setPaused(!paused), setHeld(0)))}>
            {!paused && !done ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>}
          </button>
        } />

      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", gap: 24, padding: "4px 36px 0 36px", maxWidth: 1440, width: "100%", margin: "0 auto" }}>
        <section aria-label="The contract" style={{ flex: "0 0 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}><span className="num">1</span><span className="serif" style={{ fontSize: 28, lineHeight: 1 }}>The contract</span></p>
          <div style={{ flex: "1 1 auto", minHeight: 0, background: "#E7DECF", borderRadius: 14, padding: "10px 12px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)" }}>
              <PageIcon width={12} />
              <span style={{ color: "var(--ink)" }}>{RECORDED_SOURCE.name}</span>
              <span>· sample, fictional companies</span>
              <span style={{ marginLeft: "auto", color: reading ? "var(--amber-text)" : "var(--muted)" }}>{reading ? `NDI is reading ${pages} pages…` : `Page ${pageNo} of ${doc.pages.length}`}</span>
            </div>
            <div style={{ flex: "1 1 auto", minHeight: 0 }}>
              <ContractPage doc={doc} page={pageNo} marks={marks} dim={focus.length > 0} scanning={reading && !reduce} height="100%" />
            </div>
          </div>
        </section>

        <section aria-label="The AI summary" style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}><span className="num">2</span><span className="serif" style={{ fontSize: 28, lineHeight: 1 }}>An AI’s summary of it</span></p>
          <div style={{ flex: "1 1 auto", minHeight: 0, background: "var(--sheet)", borderRadius: 18, boxShadow: "inset 0 0 0 1px var(--line)", padding: "18px 24px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {isPara ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--ink)", color: "var(--paper)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>AI</span>
                  {RECORDED_SOURCE.task ? <span>Asked: “{RECORDED_SOURCE.task}.”</span> : null}
                </div>
                <p className="serif ring" style={{ margin: "0 -8px", padding: "4px 8px", borderRadius: 10, fontSize: 22, lineHeight: 1.38, boxShadow: id === "check" ? "inset 0 0 0 2px var(--amber)" : "none" }}>{RECORDED_SOURCE.aiText}</p>
                <span className="mono" style={{ marginTop: "auto", fontSize: 12, color: "var(--muted)" }}>{n} sentences · {RECORDED_SOURCE.aiText.length} characters</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {claims.map((c, i) => {
                  const open = one?.id === c.id;
                  const lit = focus.includes(c.id);
                  const dimmed = focus.length > 0 && !lit;
                  const label = c.verdict === "supported" ? `CORRECT${where(c.receipt) ? ` · ${where(c.receipt)}` : ""}` : c.verdict === "contradicted" ? `WRONG${where(c.receipt) ? ` · ${where(c.receipt)}` : ""}` : "MADE UP";
                  return (
                    <div key={c.id} className="ring rise" style={{ borderRadius: 12, padding: "7px 12px", margin: "0 -12px", background: lit ? (c.verdict === "contradicted" ? "var(--red-wash)" : "var(--grey-wash)") : "transparent", boxShadow: lit ? `inset 0 0 0 2px ${c.verdict === "contradicted" ? "var(--red)" : "var(--faint)"}` : "none", animationDelay: id === "check" && at === 1 ? `${i * 45}ms` : "0ms" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <BoneIcon verdict={decided ? c.verdict : "pending"} width={26} className="pop" style={{ flex: "0 0 auto", transitionDelay: id === "check" ? `${i * 40}ms` : "0ms" }} />
                        <span className="serif ring" style={{ flex: "1 1 auto", minWidth: 0, fontSize: 19, lineHeight: 1.25, color: dimmed ? "var(--faint)" : decided && c.verdict === "contradicted" ? "var(--red)" : "var(--ink)", whiteSpace: open ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.text}</span>
                        <span className="mono pop" style={{ flex: "0 0 auto", fontSize: 11, whiteSpace: "nowrap", color: dimmed ? "var(--faint)" : TEXT_COLOR[c.verdict], opacity: decided ? 1 : 0, transitionDelay: id === "check" ? `${i * 40}ms` : "0ms" }}>{label}</span>
                      </div>
                      {open ? (
                        <div style={{ padding: "8px 0 4px 38px", display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ borderLeft: `3px solid ${RING[c.verdict]}`, paddingLeft: 12 }}>
                            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{c.verdict === "not_in_source" ? `Not in the contract${where(c.receipt) ? ` · closest ${where(c.receipt)}` : ""}` : `The contract says${where(c.receipt) ? ` · ${where(c.receipt)}` : ""}`}</span>
                            {c.receipt.quote ? <p style={{ margin: "3px 0 0 0", fontFamily: "Georgia, serif", fontSize: 14, lineHeight: 1.45 }}>{short(c.receipt.quote.replace(/\s+/g, " ").trim(), 260)}</p> : null}
                          </div>
                          <div className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--muted)" }}>
                            <span>{deciderName(data.engines.decider)} {Math.round(c.confidence * 100)}% sure</span>
                            {c.needsReview ? <span style={{ background: "var(--ink)", color: "var(--paper)", borderRadius: 999, padding: "3px 9px", fontSize: 10.5, letterSpacing: ".05em" }}>NEEDS REVIEW</span> : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside aria-label="Boneify checks it" style={{ flex: "0 0 260px", display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}><span className="num">3</span><span className="serif" style={{ fontSize: 28, lineHeight: 1 }}>Boneify checks it</span></p>
          <Key />
          <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-start", gap: 10 }}>
            <p role="status" className="mono fade" style={{ margin: "0 0 0 40px", background: "var(--ink)", color: "var(--paper)", fontSize: 15, padding: "10px 16px", borderRadius: "14px 14px 14px 4px", whiteSpace: "nowrap" }}>{rexLine}</p>
            <button ref={rexRef} type="button" aria-label="Rex" onClick={() => { setPokes(pokes + 1); hop(); }} style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}>
              <Rex rows={mood} width={132} />
            </button>
            <div className="dashed-ground" style={{ width: "100%" }} />
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {claims.map((c, i) => <BoneIcon key={c.id} verdict={decided ? c.verdict : "pending"} width={21} className="pop" style={{ transform: decided ? "none" : "translateY(3px)", transitionDelay: `${i * 40}ms` }} />)}
            </div>
            <span style={{ fontSize: 17, fontWeight: 600, minHeight: 22, color: bad ? "var(--red)" : "var(--amber-text)" }}>{decided ? (bad ? `${bad} of ${n} sentences have problems` : `All ${n} check out`) : ""}</span>
          </div>

          <div className="fade" aria-label="Who did what" style={{ background: "var(--ink)", color: "var(--paper)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12, opacity: id === "who" ? 1 : 0, transform: id === "who" ? "none" : "translateY(10px)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "7px 12px", alignItems: "center", fontSize: 13.5 }}>
              <span><b>{data.engines.perceiver === "ndi" ? "NDI" : "Reader"}</b> read {data.source.pages > 1 ? `${pages} pages` : "the contract"}</span>
              <span className="mono" style={{ fontSize: 12 }}>{fmtMs(data.timings.parseMs + data.timings.groundMs)}</span>
              <span><b>{deciderName(data.engines.decider)}</b> checked {n}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--amber)" }}>{fmtMs(data.timings.decideMs)} · {fmtUsd(data.usage.decide?.costUsd ?? 0)}</span>
            </div>
            {cmp ? (
              <>
                <span className="dashed-ground" style={{ opacity: 0.4 }} />
                <span style={{ fontSize: 13, color: "#D3C4AC" }}>Same summary, {baseShort}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ display: "flex", fontSize: 13.5 }}><b>Drex</b><span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--amber)" }}>{fmtMs(data.timings.decideMs)}</span></span>
                  <span style={{ height: 7, borderRadius: 4, background: "var(--ink-2)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: raceOn ? "100%" : "0%", background: "var(--amber)", transition: `width ${drexMs}ms var(--smooth)` }} /></span>
                  <span style={{ display: "flex", fontSize: 13.5, marginTop: 4 }}><b>{baseShort}</b><span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>{fmtMs(cmp.decideMs)}</span></span>
                  <span style={{ height: 7, borderRadius: 4, background: "var(--ink-2)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: raceOn ? "100%" : "0%", background: "var(--faint)", transition: `width ${gptMs}ms linear` }} /></span>
                </div>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      <div style={{ flex: "0 0 auto", padding: "18px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="button" onClick={back} aria-label="Previous step" className="press" style={{ width: 56, height: 56, border: 0, borderRadius: 999, background: "var(--sheet)", boxShadow: "inset 0 0 0 1px var(--line)", color: "var(--ink)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Chevron dir="left" /></button>
          <p role="status" style={{ margin: 0, width: 620, background: "var(--ink)", color: "var(--paper)", padding: "16px 26px", borderRadius: 999, textAlign: "center", fontSize: 20 }}>{cap1(caption)}</p>
          {!done ? (
            <button type="button" onClick={next} aria-label="Next step" className="press" style={{ width: 56, height: 56, border: 0, borderRadius: 999, background: "var(--ink)", color: "var(--paper)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Chevron /></button>
          ) : (
            <Link href="/check" className="btn-next press keep" style={{ height: 56, padding: "0 22px", borderRadius: 999, fontSize: 16 }}>Try it<Arrow /></Link>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {steps.map((s, i) => {
            const on = !done && step === i + 1;
            return (
              <button key={s.id} type="button" onClick={() => go(i + 1)} aria-label={`Step ${i + 1}`} aria-current={on ? "step" : undefined} style={{ border: 0, padding: "6px 0", background: "none", cursor: "pointer" }}>
                <span className="dot" style={{ display: "block", height: 6, width: on ? 30 : 8, borderRadius: 3, background: on ? "var(--amber)" : done || i + 1 < step ? "var(--ink)" : "var(--line-2)" }} />
              </button>
            );
          })}
          <span className="mono" style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>{done ? last : step} / {last}</span>
          <span className="mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--faint)" }}>{live ? "· live check" : "· recorded check"}</span>
          {done ? <button type="button" onClick={replay} className="mono" style={{ marginLeft: 6, border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--ink)", textDecoration: "underline" }}>replay</button> : null}
        </div>
      </div>
    </div>
  );
}
