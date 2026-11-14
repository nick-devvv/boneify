"use client";

// The home page: one pinned stage, scroll is the clock (scrolling back plays it in reverse).
// Five chapters: check the summary (a bone per sentence) → catch a mistake → how it works → speed → try it.
// Verdicts and receipts come from the recorded check; the speed numbers from GET /api/benchmark.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getBenchmark, pickRuns, type BenchmarkList } from "./api";
import { boneGroups } from "./fossil";
import { Header } from "./Header";
import { Key } from "./Key";
import { REX, REX_HAPPY, REX_SIDE, walking } from "./pixel";
import { RECORDED } from "./recorded";
import { PageIcon, Rex, Sauro, Trilo } from "./Sprites";
import { RING, TEXT_COLOR, UPPER, WORD, fmtMs, where } from "./verdict";

const W = 1440, H = 880;
const CH: Array<[number, number]> = [[0, 0.3], [0.3, 0.46], [0.46, 0.7], [0.7, 0.88], [0.88, 1.0001]];
const HEADS = [
  { a: "Fossil or ", b: "fiction?", sub: "Boneify checks every sentence an AI writes against the original document, and shows the proof." },
  { a: "It catches ", b: "mistakes.", sub: "Here’s one it caught in this contract summary, with the contract’s own words as proof." },
  { a: "How it ", b: "works.", sub: "NDI reads it. Drex checks it. You get the receipt." },
  { a: "Faster than ", b: "a big AI.", sub: "Same check. Drex finishes first." },
  { a: "Check your AI’s ", b: "work.", sub: "Before your client does." },
];
const RAIL = ["Check", "Catch", "How", "Speed", "Try"];
const POKES = ["RAWR. receipts, please.", "I only eat made-up claims.", "dig faster!", "hey, that tickles."];
const GLYPHS = "ABCDEFGHKMNOPRSTUW#";
const FOSSIL_X = 432, FOSSIL_Y = 340, SCALE = 8;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const short = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function HomeStory() {
  const claims = RECORDED.claims;
  const n = claims.length;
  const { groups, ghost } = useMemo(() => boneGroups(n), [n]);
  const hero = useRef<HTMLElement>(null);
  const [p, setP] = useState(0);
  const [scale, setScale] = useState(1);
  const [hot, setHot] = useState<string | null>(null);
  const [pokes, setPokes] = useState({ n: 0, ch: -1 });
  const [bench, setBench] = useState<BenchmarkList | null>(null);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = hero.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      setP(total > 0 ? clamp01(-r.top / total) : 0);
      setScale(Math.min(window.innerWidth / W, window.innerHeight / H, 1.25));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    getBenchmark().then(setBench).catch(() => setBench(null));
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  let c = 0;
  CH.forEach(([a, b], i) => { if (p >= a && p < b) c = i; });
  const t = clamp01((p - CH[c][0]) / (CH[c][1] - CH[c][0]));
  const on = (i: number) => (c === i ? 1 : 0);

  // chapter 1: one bone per sentence
  const shown = c === 0 ? Math.min(n, Math.floor(t * (n + 1.4))) : n;
  const lastV = shown > 0 ? claims[shown - 1].verdict : "supported";
  const good = claims.slice(0, shown).filter((x) => x.verdict === "supported").length;

  // labels for the sentences that have problems, on the side nearest their bone, spread so they never overlap
  const labels = useMemo(() => {
    const items = claims
      .map((cl, i) => ({ cl, i, mx: FOSSIL_X + groups[i].cx * SCALE, my: FOSSIL_Y + groups[i].cy * SCALE }))
      .filter((x) => x.cl.verdict !== "supported")
      .map((x) => ({ ...x, side: x.mx < 700 ? ("left" as const) : ("right" as const), y: x.my - 22 }));
    for (const side of ["left", "right"] as const) {
      const col = items.filter((x) => x.side === side).sort((a, b) => a.y - b.y);
      let prev = 270;
      col.forEach((x) => { x.y = Math.max(x.y, prev); prev = x.y + 78; });
    }
    return items;
  }, [claims, groups]);

  // chapter 2: the first wrong sentence and what the contract says
  const caught = claims.find((x) => x.verdict === "contradicted") ?? claims.find((x) => x.verdict !== "supported") ?? null;
  const quote = caught?.receipt.quote ? short(caught.receipt.quote.replace(/\s+/g, " ").trim(), 150) : null;

  // chapter 3: read, check, proof
  const t3 = c === 2 ? t : c > 2 ? 1 : 0;
  const landed = clamp01((t3 - 0.25) / 0.4) * n;
  const printed = Math.floor(clamp01((t3 - 0.55) / 0.4) * (n + 0.99));

  // chapter 4: the race, paced by the real median times when both runs exist
  const { drex, baseline } = pickRuns(bench);
  const dP50 = drex?.headline.p50LatencyMs ?? null, bP50 = baseline?.headline.p50LatencyMs ?? null;
  const real = dP50 !== null && bP50 !== null && dP50 > 0 && bP50 > 0;
  const paceD = real ? dP50! / Math.max(dP50!, bP50!) : 0.45;
  const paceB = real ? bP50! / Math.max(dP50!, bP50!) : 1;
  const t4 = c === 3 ? t : c > 3 ? 1 : 0;
  const imp = bench?.improvement ?? null;
  const baseShort = baseline?.label ? (baseline.label.split(" ").length > 1 ? baseline.label.split(" ").slice(0, -1).join(" ") : baseline.label) : null;
  const dF1 = drex?.headline.sentenceF1 ?? null, bF1 = baseline?.headline.sentenceF1 ?? null;
  const relF1 = dF1 != null && bF1 ? Math.round((dF1 / bF1 - 1) * 100) : null;
  const speedTxt = imp?.speedup != null ? `${imp.speedup.toFixed(1)}×` : "–×";
  const cheapTxt = imp?.costRatio ? `${Math.round(1 / imp.costRatio)}×` : "–×";
  const accTxt = relF1 != null ? `${relF1 >= 0 ? "+" : "−"}${Math.abs(relF1)}%` : "–";
  const heads = HEADS.map((h, i) => (i === 3 && baseShort
    ? { a: "Faster than ", b: `${baseShort}.`, sub: imp?.speedup != null && imp.costRatio && relF1 != null ? `${Math.round(imp.speedup)}× faster, ${Math.round(1 / imp.costRatio)}× cheaper and ${relF1}% more accurate.` : "Same check. Drex finishes first." }
    : h));

  // Rex walks the whole story
  const rexX = Math.round(36 + p * (W - 36 - 220));
  let mood = c === 4 ? REX_HAPPY : c === 1 || (c === 0 && shown > 0 && lastV !== "supported") ? REX_SIDE : REX;
  if (p > 0 && p < 0.99 && Math.floor(p * 160) % 2 === 1) mood = walking(mood);
  let said = c === 0 ? (shown < 2 ? "let’s check." : lastV === "contradicted" ? "that one’s wrong!" : lastV === "not_in_source" ? "made up!" : "that one’s correct.")
    : c === 1 ? "caught it." : c === 2 ? `all ${n} at once.` : "RAWR. receipts, please.";
  if (pokes.n > 0 && pokes.ch === c) said = POKES[(pokes.n - 1) % POKES.length];
  let prints = "";
  for (let fx = 30; fx < rexX - 10; fx += 46) prints += `M${fx} ${726 + (Math.floor(fx / 46) % 2) * 6}h6v3h-6z`;

  const jump = (i: number) => {
    const el = hero.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + CH[i][0] * (el.offsetHeight - window.innerHeight) + 4, behavior: "smooth" });
  };

  return (
    <div style={{ overflowX: "clip" }}>
      <section ref={hero} aria-label="How Boneify works" style={{ position: "relative", height: 4600 }}>
        <div style={{ position: "sticky", top: 0, height: "100vh", overflow: "clip", display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ position: "relative", width: W, height: H, flex: "0 0 auto", transform: `scale(${scale})`, transformOrigin: "center center" }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 3 }}>
              <Header current={0} next={{ href: "/demo", label: "Start: watch the demo" }} />
            </div>

            {heads.map((h, i) => (
              <div key={i} className="fade" style={{ position: "absolute", left: 0, right: 0, top: 96, textAlign: "center", opacity: on(i), transform: c === i ? "none" : "translateY(14px)", pointerEvents: "none" }}>
                <h2 className="serif" style={{ margin: 0, fontSize: 96, lineHeight: 1 }}>{h.a}<span style={{ color: "var(--amber-text)" }}>{h.b}</span></h2>
                <p style={{ margin: "12px 0 0 0", fontSize: 19, color: "var(--muted)" }}>{h.sub}</p>
              </div>
            ))}

            <nav aria-label="Chapters" style={{ position: "absolute", right: 26, top: 300, display: "flex", flexDirection: "column", gap: 14, zIndex: 3 }}>
              {RAIL.map((label, i) => (
                <button key={label} type="button" onClick={() => jump(i)} aria-label={label} aria-current={c === i ? "step" : undefined}
                  className="mono" style={{ border: 0, background: "none", padding: "4px 0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, fontSize: 11, color: c === i ? "var(--ink)" : "var(--faint)" }}>
                  <span className="fade" style={{ opacity: c === i ? 1 : 0 }}>{label}</span>
                  <span className="dot" style={{ display: "block", height: 2, width: c === i ? 34 : 16, background: c === i ? "var(--amber)" : "var(--faint)" }} />
                </button>
              ))}
            </nav>

            <svg className="keep" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}>
              <defs>
                <pattern id="rock1" width="8" height="8" patternUnits="userSpaceOnUse"><rect x="3" y="3" width="2" height="2" fill="#22170F" fillOpacity="0.07" /></pattern>
                <pattern id="rock2" width="8" height="8" patternUnits="userSpaceOnUse"><rect x="3" y="3" width="2" height="2" fill="#22170F" fillOpacity="0.12" /><rect x="7" y="7" width="1" height="1" fill="#22170F" fillOpacity="0.08" /></pattern>
              </defs>
              <rect x="0" y="722" width={W} height="158" fill="url(#rock2)" />
              <line x1="0" y1="720" x2={W} y2="720" stroke="#A6978A" strokeWidth="2" strokeDasharray="2 4" />
              <path d={prints} fill="#22170F" fillOpacity="0.28" shapeRendering="crispEdges" />

              <g className="fade" style={{ opacity: c === 0 ? 1 : c === 1 ? 0.1 : 0 }}>
                <rect x="380" y="332" width="680" height="300" fill="url(#rock1)" />
                <g transform={`translate(${FOSSIL_X} ${FOSSIL_Y}) scale(${SCALE})`} shapeRendering="crispEdges">
                  <path d={ghost} fill="#22170F" fillOpacity="0.06" />
                  {groups.map((g, i) => {
                    const v = claims[i].verdict;
                    const visible = i < shown;
                    const dim = hot !== null && hot !== claims[i].id;
                    const base = v === "not_in_source" ? 0.16 : 1;
                    return <path key={i} className="fade" d={g.path} fill={v === "supported" ? "#F0A202" : v === "contradicted" ? "#C4321F" : "#22170F"} fillOpacity={!visible ? 0 : dim ? base * 0.2 : base} />;
                  })}
                </g>
              </g>

              <g className="fade" fill="none" strokeWidth="2" shapeRendering="crispEdges" style={{ opacity: on(0) }}>
                {labels.map((l) => {
                  const visible = l.i < shown;
                  const dim = hot !== null && hot !== l.cl.id;
                  const edge = l.side === "left" ? 340 : 1090;
                  const ly = l.y + 12;
                  return (
                    <g key={l.cl.id} className="fade" style={{ opacity: !visible ? 0 : dim ? 0.2 : 1 }}>
                      <path d={`M${l.mx} ${l.my}V${ly}H${edge}`} stroke={RING[l.cl.verdict]} strokeDasharray="2 3" />
                      <rect x={l.mx - 5} y={l.my - 5} width="10" height="10" stroke={RING[l.cl.verdict]} fill={l.i === shown - 1 && l.cl.verdict === "contradicted" ? "rgba(196,50,31,.35)" : "#F5EEE2"} />
                    </g>
                  );
                })}
              </g>

              <g className="fade" style={{ opacity: on(3) }}>
                <line x1="220" y1="470" x2="1240" y2="470" stroke="#D3C4AC" strokeWidth="2" strokeDasharray="2 6" />
                <line x1="220" y1="590" x2="1240" y2="590" stroke="#D3C4AC" strokeWidth="2" strokeDasharray="2 6" />
                <rect x="216" y="400" width="4" height="210" fill="#22170F" />
                <rect x="1236" y="400" width="8" height="210" fill="#22170F" fillOpacity="0.85" />
              </g>
            </svg>

            {/* chapter 1 labels: only the sentences with problems, the key explains the rest */}
            <div className="fade" style={{ opacity: on(0), pointerEvents: c === 0 ? "auto" : "none" }}>
              {labels.map((l) => {
                const visible = l.i < shown;
                const dim = hot !== null && hot !== l.cl.id;
                return (
                  <button key={l.cl.id} type="button" className="fade" onMouseEnter={() => setHot(l.cl.id)} onFocus={() => setHot(l.cl.id)} onMouseLeave={() => setHot(null)} onBlur={() => setHot(null)}
                    style={{ position: "absolute", left: l.side === "left" ? 90 : 1100, top: l.y, width: l.side === "left" ? 240 : 230, textAlign: l.side === "left" ? "right" : "left", background: "none", border: 0, padding: 0, cursor: "default", color: "var(--ink)", opacity: !visible ? 0 : dim ? 0.25 : 1, pointerEvents: visible ? "auto" : "none" }}>
                    <span style={{ display: "block", fontSize: 17, fontWeight: 600, color: TEXT_COLOR[l.cl.verdict] }}>
                      {WORD[l.cl.verdict]} <span className="mono" style={{ fontSize: 12, fontWeight: 400 }}>{l.cl.verdict === "not_in_source" ? "not in it" : where(l.cl.receipt)}</span>
                    </span>
                    <span style={{ display: "block", fontSize: 14, color: "var(--muted)", marginTop: 2 }}>“{short(l.cl.text, 52)}”</span>
                  </button>
                );
              })}
              <div style={{ position: "absolute", left: 40, top: 826, display: "flex", alignItems: "center", gap: 22 }}>
                <Key size={15} />
                <span className="mono" style={{ fontSize: 14, color: "var(--muted)" }}>{shown} of {n} sentences checked · {good} correct</span>
              </div>
              <div className="fade" style={{ position: "absolute", left: 0, right: 0, top: 780, display: "flex", justifyContent: "center", opacity: p < 0.02 ? 1 : 0 }}>
                <span className="mono" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
                  <svg width="12" height="12" viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true"><path d="M0 1h1v1h1v1h2v-1h1v-1h1v1h-1v1h-1v1h-2v-1h-1v-1h-1z" fill="#76665A" /></svg>
                  scroll down
                </span>
              </div>
            </div>

            {/* chapter 2: one mistake, with the contract's words as proof */}
            {caught ? (
              <div className="fade" style={{ opacity: on(1), pointerEvents: "none" }}>
                <div style={{ position: "absolute", left: 160, top: 290, width: 540 }}>
                  <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>WHAT THE AI WROTE</span>
                  <p className="serif" style={{ margin: "10px 0 0 0", fontSize: 40, lineHeight: 1.1 }}>
                    <span style={{ color: c === 1 && t > 0.2 ? "var(--red)" : "var(--ink)", textDecoration: c === 1 && t > 0.2 ? "line-through" : "none", textDecorationThickness: 3 }}>{short(caught.text, 120)}</span>
                  </p>
                </div>
                <div style={{ position: "absolute", left: 760, top: 290, width: 520 }}>
                  <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>WHAT THE CONTRACT SAYS{where(caught.receipt) ? ` · ${where(caught.receipt)}` : ""}</span>
                  <p className="serif" style={{ margin: "10px 0 0 0", fontSize: 32, lineHeight: 1.15 }}>
                    <span style={{ padding: "0 4px", backgroundImage: "linear-gradient(#F0A202, #F0A202)", backgroundRepeat: "no-repeat", backgroundSize: `${c === 1 ? Math.round(clamp01((t - 0.4) / 0.35) * 100) : 0}% 100%` }}>{quote ?? "Nothing in the contract says this."}</span>
                  </p>
                </div>
                <p className="fade" style={{ position: "absolute", left: 0, right: 0, top: 640, margin: 0, textAlign: "center", fontSize: 18, color: "var(--red)", opacity: c === 1 && t > 0.75 ? 1 : 0 }}>
                  {UPPER[caught.verdict].charAt(0) + UPPER[caught.verdict].slice(1).toLowerCase()}. Caught, with the contract’s own words as proof.
                </p>
              </div>
            ) : null}

            {/* chapter 3: read, check, proof */}
            <div className="fade" style={{ opacity: on(2), pointerEvents: "none" }}>
              <StepLabel x={140} w={300} title="1. NDI reads it" sub="any PDF, Word file or scan" />
              {[0, 1, 2].map((i) => {
                const k = clamp01(t3 * 2.4 - i * 0.35);
                return <PageIcon key={i} width={60} style={{ position: "absolute", left: 200 + i * 70, top: Math.round(330 + k * 170), opacity: k >= 1 ? 0 : 1, transition: "top 240ms var(--smooth), opacity 300ms" }} />;
              })}
              <div style={{ position: "absolute", left: 170, top: 520, width: 240, height: 10, background: "var(--ink)", borderRadius: 5 }} />

              <StepLabel x={520} w={400} title="2. Drex checks it" sub="every sentence, all at once" />
              <div style={{ position: "absolute", left: 560, top: 322, width: 320, background: "var(--ink)", color: "var(--paper)", borderRadius: 16, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
                {claims.map((cl, i) => {
                  const done = i < Math.floor(landed);
                  const flipping = !done && i === Math.floor(landed) && t3 > 0.25 && t3 < 0.66;
                  let txt = done ? UPPER[cl.verdict] : flipping ? "" : "---------";
                  if (flipping) for (let j = 0; j < 9; j++) txt += GLYPHS[(Math.floor(p * 900) + i * 7 + j * 3) % GLYPHS.length];
                  const color = flipping ? "#A6978A" : !done ? "#5A4A3D" : cl.verdict === "contradicted" ? "#FF7A66" : cl.verdict === "not_in_source" ? "#A6978A" : "#F0A202";
                  return (
                    <div key={cl.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="mono" style={{ width: 28, fontSize: 11, color: "var(--faint)" }}>S{i + 1}</span>
                      <span style={{ display: "flex", gap: 2 }}>
                        {(txt + "         ").slice(0, 9).split("").map((ch, j) => (
                          <span key={j} className="mono" style={{ width: 17, height: Math.max(16, Math.min(22, Math.floor(260 / n) - 4)), background: "var(--ink-2)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color }}>{ch === " " ? " " : ch}</span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>

              <StepLabel x={990} w={310} title="3. You get the receipt" sub="the page and clause for each one" />
              <div className="slide" style={{ position: "absolute", left: 1010, top: 322, width: 270, height: 56 + printed * Math.min(22, Math.floor(260 / n)), overflow: "hidden", background: "var(--sheet)", boxShadow: "inset 0 0 0 1px var(--line)", padding: "16px 20px 0 20px", fontSize: 12.5 }}>
                <div className="mono" style={{ textAlign: "center", fontWeight: 600 }}>RECEIPT · {RECORDED.source.name}</div>
                <div style={{ borderTop: "1px dashed var(--faint)", margin: "10px 0" }} />
                {claims.slice(0, printed).map((cl, i) => (
                  <div key={cl.id} className="mono" style={{ display: "flex", justifyContent: "space-between", color: TEXT_COLOR[cl.verdict], height: Math.min(22, Math.floor(260 / n)) }}>
                    <span>S{i + 1} {WORD[cl.verdict].toLowerCase()}</span><span>{cl.verdict === "not_in_source" ? "not in it" : where(cl.receipt) || "–"}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* chapter 4: the race */}
            <div className="fade" style={{ opacity: on(3), pointerEvents: "none" }}>
              <span className="mono" style={{ position: "absolute", left: 120, top: 446, fontSize: 13 }}>Drex</span>
              <span className="mono" style={{ position: "absolute", left: 96, top: 566, fontSize: 13 }}>{baseShort ?? "Big AI"}</span>
              <Rex rows={c === 3 && Math.floor(t * 40) % 2 ? walking(REX) : REX} width={88} style={{ position: "absolute", left: Math.round(160 + clamp01(t4 / paceD) * 1000), top: 392 }} />
              <Sauro width={128} style={{ position: "absolute", left: Math.round(140 + clamp01(t4 / paceB) * 960), top: 504 }} />
              <div style={{ position: "absolute", left: 0, right: 0, top: 636, display: "flex", justifyContent: "center", gap: 48 }}>
                <BigStat value={speedTxt} label="faster" />
                <BigStat value={cheapTxt} label="cheaper" />
                <BigStat value={accTxt} label={relF1 != null && relF1 < 0 ? "less accurate" : "more accurate"} />
              </div>
              <p className="mono" style={{ position: "absolute", left: 0, right: 0, top: 690, margin: 0, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                {real ? `time to check one answer: Drex ${fmtMs(dP50)} · ${baseShort ?? "big AI"} ${fmtMs(bP50)}` : "preview pace until the benchmark runs"}
              </p>
            </div>

            {/* chapter 5 */}
            <div className="fade" style={{ position: "absolute", left: 0, right: 0, top: 330, display: "flex", justifyContent: "center", gap: 12, opacity: on(4), pointerEvents: c === 4 ? "auto" : "none" }}>
              <Link href="/demo" className="btn-dark press" style={{ fontSize: 18, padding: "17px 26px", borderRadius: 14 }}>Watch the demo</Link>
              <Link href="/check" className="btn-next press keep" style={{ fontSize: 18, padding: "17px 26px", borderRadius: 14 }}>Try it with your document</Link>
            </div>

            <button type="button" className="slide" aria-label="Rex" onClick={() => setPokes((x) => ({ n: x.n + 1, ch: c }))}
              style={{ position: "absolute", left: rexX, top: 640, background: "none", border: 0, padding: 0, cursor: "pointer", zIndex: 2, opacity: c === 3 ? 0 : 1 }}>
              <Rex rows={mood} width={88} />
            </button>
            {p > 0.02 && c !== 3 ? (
              <p className="slide mono" style={{ position: "absolute", left: rexX < 1080 ? rexX + 96 : rexX - 250, top: 660, margin: 0, background: "var(--ink)", color: "var(--paper)", fontSize: 13, padding: "9px 14px", borderRadius: 999, whiteSpace: "nowrap", zIndex: 2 }}>{said}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-label="Who it’s for" style={{ maxWidth: 1280, margin: "0 auto", padding: "120px 40px 40px 40px" }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 64, lineHeight: 1, textAlign: "center" }}>For teams where one wrong line is expensive.</h2>
        <div style={{ position: "relative", height: 380, marginTop: 40 }}>
          <div className="dashed-ground" style={{ position: "absolute", left: 0, right: 0, top: 300 }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 302, height: 78, background: "rgba(34,23,15,.04)" }} />
          <Critter left="5%" title="Law firms" sub="AI contract summaries, checked against the contract" art={<Rex width={110} />} />
          <Critter left="37.5%" title="Audit and tax" sub="memos, checked against the ledgers they cite" art={<Trilo width={90} />} />
          <Critter left="70%" title="Finance" sub="research notes, checked against the filings" art={<Sauro width={160} />} />
        </div>
      </section>

      <footer style={{ maxWidth: 1280, margin: "0 auto", padding: "60px 40px 48px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: "var(--muted)" }}>
        <span>Built at Drexathon with Nace Drex, NDI, Intern, Adobe and DeepInfra. Sample companies are fictional.</span>
        <Link href="/scoreboard">Scoreboard</Link>
      </footer>
    </div>
  );
}

function StepLabel({ x, w, title, sub }: { x: number; w: number; title: string; sub: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: 262, width: w, textAlign: "center" }}>
      <span className="serif" style={{ display: "block", fontSize: 30, lineHeight: 1 }}>{title}</span>
      <span className="mono" style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{sub}</span>
    </div>
  );
}

function BigStat({ value, label }: { value: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <span className="mono" style={{ fontSize: 34, color: "var(--amber-text)" }}>{value}</span>
      <span style={{ fontSize: 16 }}>{label}</span>
    </span>
  );
}

function Critter({ left, title, sub, art }: { left: string; title: string; sub: string; art: ReactNode }) {
  return (
    <div className="lift" style={{ position: "absolute", left, top: 40, width: 300, height: 260, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <span style={{ fontSize: 22, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 15, color: "var(--muted)", marginTop: 4 }}>{sub}</span>
      <span style={{ marginTop: "auto", display: "flex", alignItems: "flex-end" }}>{art}</span>
    </div>
  );
}
