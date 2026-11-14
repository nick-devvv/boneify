"use client";

// The Track 1 proof: Drex vs a big AI model (GPT-6.1 Sol today) on the RAGTruth test set: faster, cheaper, more accurate. Every number comes from GET /api/benchmark
// (and /api/benchmark/:run for details); anything the API hasn't returned shows as a dash.

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { getBenchmark, getRun, pickRuns, type BenchmarkList, type Dataset, type RagTask, type RunDetail, type RunRow } from "../_ui/api";
import { Header } from "../_ui/Header";
import { REX, REX_HAPPY, walking } from "../_ui/pixel";
import { Rex, Sauro, Trilo } from "../_ui/Sprites";
import { fmtInt, fmtMs, fmtUsd, pct } from "../_ui/verdict";

type TaskId = "all" | RagTask;
const TASKS: Array<{ id: TaskId; label: string }> = [
  { id: "all", label: "All" }, { id: "QA", label: "Answers" }, { id: "Summary", label: "Summaries" }, { id: "Data2txt", label: "Data reports" },
];
const BLOCKS: Array<{ id: RagTask; label: string }> = [
  { id: "QA", label: "Answers to questions" }, { id: "Summary", label: "News summaries" }, { id: "Data2txt", label: "Business data reports" },
];
const COLS = 77, CELL = 7;
const RACE_MS = 3200;
const PREVIEW_PACE = { drex: 0.24, baseline: 1 };
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

function scramble(str: string, k: number) {
  const settled = Math.floor(k * str.length);
  let out = "";
  for (let i = 0; i < str.length; i++) out += i < settled || !/[0-9]/.test(str[i]) ? str[i] : String(Math.floor(Math.random() * 10));
  return out;
}
function nice(n: number) {
  if (n < 1000) return Math.round(n / 10) * 10;
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

/** One dot per real sentence. How many are red is real; where they sit is arranged (seeded shuffle). */
function buildField(ds: Dataset) {
  let start = 0, seed = 2026;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  return BLOCKS.map((b) => {
    const t = ds.byTask[b.id];
    const n = t?.sentences ?? 0, wrong = t?.wrong ?? 0;
    const idx = Array.from({ length: n }, (_, i) => start + i);
    for (let j = idx.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [idx[j], idx[k]] = [idx[k], idx[j]]; }
    const bad = new Set(idx.slice(0, wrong));
    let ok = "", red = "";
    for (let m = start; m < start + n; m++) {
      const cell = `M${(m % COLS) * CELL} ${Math.floor(m / COLS) * CELL}h5v5h-5z`;
      if (bad.has(m)) red += cell; else ok += cell;
    }
    const block = { ...b, n, wrong, ok, red, from: start, to: start + n };
    start += n;
    return block;
  });
}

export function Scoreboard() {
  const [task, setTask] = useState<TaskId>("all");
  const [list, setList] = useState<BenchmarkList | null>(null);
  const [failed, setFailed] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [flipK, setFlipK] = useState(1);
  const [hover, setHover] = useState<RagTask | null>(null);
  const [openRow, setOpenRow] = useState(0);
  const [details, setDetails] = useState<Record<string, RunDetail>>({});
  const [docsPos, setDocsPos] = useState(50);
  const [sureIdx, setSureIdx] = useState(3);
  const [raceT, setRaceT] = useState(0);
  const [started, setStarted] = useState(false);
  const raceTimer = useRef<number | null>(null);
  const [best, setBest] = useState<{ speed: number | null; cheaper: number | null }>({ speed: null, cheaper: null });

  // the best type of writing for each claim, for the "up to" lines
  useEffect(() => {
    Promise.all((["QA", "Summary", "Data2txt"] as RagTask[]).map((t) => getBenchmark(t).catch(() => null))).then((lists) => {
      const imps = lists.map((l) => l?.improvement).filter(Boolean) as NonNullable<BenchmarkList["improvement"]>[];
      const speeds = imps.map((i) => i.speedup).filter((x): x is number => x != null);
      const cheaps = imps.map((i) => (i.costRatio ? 1 / i.costRatio : null)).filter((x): x is number => x != null);
      setBest({ speed: speeds.length ? Math.max(...speeds) : null, cheaper: cheaps.length ? Math.max(...cheaps) : null });
    });
  }, []);

  useEffect(() => {
    let live = true;
    getBenchmark(task === "all" ? undefined : task)
      .then((r) => { if (!live) return; setList(r); setFailed(false); if (r.dataset) setDataset(r.dataset); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [task]);

  const pickTask = (id: TaskId) => {
    setTask(id);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    setFlipK(0);
    const tick = () => { const k = Math.min(1, (performance.now() - t0) / 650); setFlipK(k); if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };

  const { drex, baseline, rules } = pickRuns(list);
  // "GPT-6.1 Sol" → "GPT-6.1" for running text; the full label stays in the table
  const baseShort = baseline?.label ? baseline.label.split(" ").length > 1 ? baseline.label.split(" ").slice(0, -1).join(" ") : baseline.label : "a big AI model";
  const rows: Array<{ key: string; name: string; run: RunRow | null; art: ReactNode }> = [
    { key: "drex", name: drex?.label ?? "Drex", run: drex, art: <Rex width={33} dark /> },
    { key: "llm", name: baseline?.label ?? "Big AI model", run: baseline, art: <Sauro width={44} dark /> },
    { key: "local", name: "Simple rules", run: rules, art: <Trilo width={30} dark /> },
  ];

  // run details (caught / missed / false alarms, confidence curve), fetched once per run
  const need = [rows[openRow]?.run?.run, drex?.run, baseline?.run].filter(Boolean) as string[];
  useEffect(() => {
    need.forEach((id) => { if (!details[id]) getRun(id).then((d) => setDetails((x) => ({ ...x, [id]: d }))).catch(() => {}); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need.join("|")]);

  const field = useMemo(() => (dataset ? buildField(dataset) : []), [dataset]);
  const facts = task === "all" ? (dataset ? { sentences: dataset.sentences, wrong: dataset.wrong.total, examples: dataset.examples } : null)
    : dataset?.byTask[task] ? { sentences: dataset.byTask[task].sentences, wrong: dataset.byTask[task].wrong, examples: dataset.byTask[task].examples } : null;
  const hb = hover ? field.find((b) => b.id === hover) : null;

  // the race: each runner's pace is its p50 time relative to the slower one
  const dP50 = drex?.headline.p50LatencyMs ?? null, bP50 = baseline?.headline.p50LatencyMs ?? null;
  const real = dP50 !== null && bP50 !== null && dP50 > 0 && bP50 > 0;
  const pace = real ? { drex: dP50! / Math.max(dP50!, bP50!), baseline: bP50! / Math.max(dP50!, bP50!) } : PREVIEW_PACE;
  const dK = Math.min(1, raceT / pace.drex), bK = Math.min(1, raceT / pace.baseline);
  const drexDone = started && dK >= 1, baseDone = started && bK >= 1;
  const running = started && (!drexDone || !baseDone);
  const winner = !started ? null : drexDone && (!baseDone || pace.drex <= pace.baseline) ? "Drex" : baseDone ? baseShort : null;

  function race() {
    if (raceTimer.current) cancelAnimationFrame(raceTimer.current);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStarted(true); setRaceT(1); return; }
    setStarted(true);
    setRaceT(0);
    const t0 = performance.now();
    const tick = () => { const t = Math.min(1, (performance.now() - t0) / RACE_MS); setRaceT(t); if (t < 1) raceTimer.current = requestAnimationFrame(tick); };
    raceTimer.current = requestAnimationFrame(tick);
  }

  const imp = list?.improvement ?? null;
  const cheaper = imp?.costRatio ? 1 / imp.costRatio : null;

  const docs = nice(100 * Math.pow(500, docsPos / 100));
  const avg = facts && facts.examples ? facts.sentences / facts.examples : null;
  const perK = (r: RunRow | null) => r?.headline.costPerThousandSentencesUsd ?? null;
  const costWith = (r: RunRow | null) => (avg !== null && perK(r) !== null ? (docs * avg * perK(r)!) / 1000 : null);
  const hoursSaved = real ? (docs * (bP50! - dP50!)) / 3_600_000 : null;
  const curve = drex ? details[drex.run]?.metrics.abstain ?? null : null;
  const thresholds = curve?.map((p) => p.threshold) ?? THRESHOLDS;
  const point = curve?.[Math.min(sureIdx, curve.length - 1)] ?? null;

  const detailFor = (r: RunRow | null) => {
    if (!r) return null;
    const d = details[r.run];
    if (!d) return null;
    return task === "all" ? d.metrics.sentence : d.metrics.byTask[task]?.sentence ?? null;
  };

  // the proof, three ways (Track 1: faster, cheaper or more accurate). Bars start at zero.
  const dF1 = drex?.headline.sentenceF1 ?? null, bF1 = baseline?.headline.sentenceF1 ?? null;
  const dK1 = perK(drex), bK1 = perK(baseline);
  const dDet = detailFor(drex), bDet = detailFor(baseline);
  const fewerAlarms = dDet && bDet && bDet.fp > 0 ? Math.round((1 - dDet.fp / bDet.fp) * 100) : null;
  const relF1 = dF1 != null && bF1 ? Math.round((dF1 / bF1 - 1) * 100) : null;
  const bar = (x: number | null) => (x == null ? "0%" : `${Math.max(1.5, x * 100).toFixed(1)}%`);
  const proof = [
    { big: imp?.speedup != null ? `${imp.speedup.toFixed(1)}×` : "–×", word: "faster", dw: bar(real ? dP50! / bP50! : null), gw: real ? "100%" : "0%", dv: fmtMs(dP50), gv: fmtMs(bP50),
      note: `median time per answer${task === "all" && best.speed ? ` · up to ${best.speed.toFixed(1)}×` : ""}` },
    { big: cheaper != null ? `${Math.round(cheaper)}×` : "–×", word: "cheaper", dw: bar(dK1 != null && bK1 ? dK1 / bK1 : null), gw: bK1 ? "100%" : "0%", dv: dK1 != null ? `$${dK1.toFixed(3)}` : "–", gv: bK1 != null ? `$${bK1.toFixed(3)}` : "–",
      note: `per 1,000 sentences${task === "all" && best.cheaper ? ` · up to ${Math.round(best.cheaper)}×` : ""}` },
    { big: relF1 != null ? `${relF1 >= 0 ? "+" : "−"}${Math.abs(relF1)}%` : "–", word: relF1 != null && relF1 < 0 ? "less accurate" : "more accurate", dw: bar(dF1), gw: bar(bF1), dv: dF1 != null ? `F1 ${dF1.toFixed(2)}` : "–", gv: bF1 != null ? `F1 ${bF1.toFixed(2)}` : "–",
      note: fewerAlarms != null ? `${fewerAlarms}% fewer false alarms` : "accuracy = F1 on the wrong sentences" },
  ];

  const onFieldMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / CELL), row = Math.floor((e.clientY - r.top) / CELL);
    const i = row * COLS + col;
    const b = col >= 0 && col < COLS ? field.find((x) => i >= x.from && i < x.to) : undefined;
    setHover(b ? b.id : null);
  };

  const fieldRows = Math.ceil((field.at(-1)?.to ?? 0) / COLS);
  const finishX = 1144 - 30 - 8;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Header current={3} next={{ href: "/check", label: "Try it yourself" }} />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "4px 40px 64px 40px" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 64, lineHeight: 1 }}>Drex vs {baseShort}. <span style={{ color: "var(--faint)" }}>Faster, cheaper, more accurate.</span></h1>
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 24 }}>
          <p style={{ margin: 0, flex: "1 1 auto", fontSize: 18, color: "var(--muted)" }}>
            Both checked the same {dataset ? fmtInt(dataset.sentences) : "–"} real AI-written sentences that people had already fact-checked.
            {failed ? <span className="mono" style={{ marginLeft: 10, fontSize: 12, color: "var(--red)" }}>Can’t reach the API right now.</span> : null}
          </p>
          <div role="group" aria-label="Type of AI writing" style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            {TASKS.map((t) => {
              const on = t.id === task;
              return (
                <button key={t.id} type="button" className="press mono" aria-pressed={on} onClick={() => pickTask(t.id)}
                  style={{ border: 0, cursor: "pointer", fontSize: 14, padding: "9px 14px", borderRadius: 999, background: on ? "var(--ink)" : "var(--sheet)", color: on ? "var(--paper)" : "var(--ink)", boxShadow: on ? "none" : "inset 0 0 0 1px var(--line)" }}>{t.label}</button>
              );
            })}
          </div>
        </div>

        <section aria-label="The proof" style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
          {proof.map((p) => (
            <div key={p.word} style={{ background: "var(--sheet)", borderRadius: 22, boxShadow: "inset 0 0 0 1px var(--line)", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 12 }}><span className="serif" style={{ fontSize: 76, lineHeight: 0.9, color: "var(--amber-text)" }}>{p.big}</span><span style={{ fontSize: 20, fontWeight: 600 }}>{p.word}</span></span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[{ name: "Drex", w: p.dw, v: p.dv, fill: "var(--amber)", color: "var(--amber-text)", bold: true }, { name: baseShort, w: p.gw, v: p.gv, fill: "var(--faint)", color: "var(--muted)", bold: false }].map((b) => (
                  <span key={b.name} style={{ display: "grid", gridTemplateColumns: "70px minmax(0, 1fr) 76px", alignItems: "center", gap: 10, fontSize: 14 }}>
                    <span style={{ fontWeight: b.bold ? 700 : 400 }}>{b.name}</span>
                    <span style={{ height: 10, borderRadius: 5, background: "var(--grey-wash)", overflow: "hidden" }}><span className="grow" style={{ display: "block", height: "100%", width: b.w, background: b.fill }} /></span>
                    <span className="mono" style={{ fontSize: 13, textAlign: "right", color: b.color }}>{b.v}</span>
                  </span>
                ))}
              </div>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{p.note}</span>
            </div>
          ))}
        </section>

        <section aria-label="The race" style={{ marginTop: 16, background: "var(--sheet)", borderRadius: 22, boxShadow: "inset 0 0 0 1px var(--line)", padding: "22px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <button type="button" onClick={race} aria-label="Race" className="lift" style={{ width: 92, height: 92, border: 0, borderRadius: 999, background: "var(--amber)", color: "var(--ink)", cursor: "pointer", fontFamily: "var(--serif)", fontSize: 28, boxShadow: "0 5px 0 -2px #C98500" }}>
              {running ? "…" : started ? "Again" : "Race"}
            </button>
            <span className="serif" style={{ fontSize: 40, lineHeight: 1 }}>{!started ? "Who checks faster?" : winner ? `${winner} wins.` : "Go!"}</span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>real pace · median time per answer</span>
          </div>
          <div style={{ position: "relative", height: 210, marginTop: 16 }}>
            <span style={{ position: "absolute", left: 100, top: 0, bottom: 0, width: 2, background: "var(--ink)" }} />
            <span style={{ position: "absolute", right: 30, top: 0, bottom: 0, width: 8, backgroundImage: "repeating-linear-gradient(#22170F 0 8px, #FFFAF2 8px 16px), repeating-linear-gradient(#FFFAF2 0 8px, #22170F 8px 16px)", backgroundSize: "4px 100%", backgroundPosition: "0 0, 4px 0", backgroundRepeat: "repeat-y" }} />
            <Lane top={0} spriteW={88} name="Drex" done={drexDone} time={fmtMs(dP50)} place={drexDone && (!baseDone || pace.drex <= pace.baseline) ? "1st" : "2nd"}
              x={Math.round(110 + dK * (finishX - 88 - 110))}
              sprite={<Rex rows={drexDone ? REX_HAPPY : started && Math.floor(raceT * 80) % 2 ? walking(REX) : REX} width={88} className={drexDone ? "hop" : undefined} />} />
            <Lane top={108} spriteW={116} name={baseShort} done={baseDone} time={fmtMs(bP50)} place={baseDone && pace.baseline < pace.drex ? "1st" : "2nd"}
              x={Math.round(106 + bK * (finishX - 116 - 106))}
              sprite={<Sauro width={116} className={started && !baseDone ? "bob" : undefined} />} />
          </div>
          {!real ? <p className="mono" style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--muted)" }}>Preview pace. Real times show once both benchmark runs exist.</p> : null}
        </section>

        <div style={{ marginTop: 16, display: "flex", gap: 16, alignItems: "stretch" }}>
          <section aria-label="The test set" style={{ flex: "1 1 0", minWidth: 0, background: "var(--sheet)", borderRadius: 22, boxShadow: "inset 0 0 0 1px var(--line)", padding: "22px 24px" }}>
            <p className="serif" style={{ margin: 0, fontSize: 30, lineHeight: 1.1 }}>
              {facts ? scramble(fmtInt(facts.sentences), flipK) : "–"} real AI sentences.{" "}
              <span style={{ color: "var(--red)" }}>People marked {facts ? scramble(fmtInt(facts.wrong), flipK) : "–"} as wrong.</span>
            </p>
            <svg width={COLS * CELL} height={Math.max(1, fieldRows) * CELL} viewBox={`0 0 ${COLS * CELL} ${Math.max(1, fieldRows) * CELL}`} shapeRendering="crispEdges" role="img"
              aria-label={facts ? `One dot per sentence: ${fmtInt(facts.sentences)} sentences, ${fmtInt(facts.wrong)} marked wrong by people.` : "Loading the test set"}
              onMouseMove={onFieldMove} onMouseLeave={() => setHover(null)} onClick={() => hover && pickTask(hover === task ? "all" : hover)}
              style={{ display: "block", marginTop: 16, cursor: "pointer", maxWidth: "100%", height: "auto" }}>
              {field.map((b) => {
                const lit = hover ? hover === b.id : task === "all" || task === b.id;
                return (
                  <g key={b.id} className="fade" style={{ opacity: lit ? 1 : 0.18 }}>
                    <path d={b.ok} fill="#D3C4AC" />
                    <path d={b.red} fill="#C4321F" />
                  </g>
                );
              })}
            </svg>
            <p className="mono" style={{ margin: "12px 0 0 0", fontSize: 12.5, color: "var(--muted)" }}>
              {hb ? `${hb.label} · ${fmtInt(hb.n)} sentences · ${fmtInt(hb.wrong)} wrong · click to show only these`
                : `Each dot is one sentence · red = people marked it wrong${dataset ? ` · written by ${dataset.writerModels} different AI models` : ""}`}
            </p>
          </section>

          <section aria-label="Scores" style={{ flex: "1 1 0", minWidth: 0, background: "var(--ink)", color: "var(--paper)", borderRadius: 22, padding: "22px 22px 16px 22px" }}>
            <p className="serif" style={{ margin: "0 10px 16px 10px", fontSize: 30, lineHeight: 1.1 }}>Scores <span style={{ fontSize: 18, color: "var(--faint)" }}>· click a row for details</span></p>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 20px", gap: 10, fontSize: 12, color: "var(--faint)", padding: "0 10px 10px 10px" }}>
              <span>MODEL</span><span title="sentence F1: how well it catches wrong sentences">ACCURACY</span><span title="median time per answer">TIME</span><span title="cost per 1,000 sentences">COST / 1K</span><span />
            </div>
            {rows.map((r, i) => {
              const open = openRow === i;
              const d = detailFor(r.run);
              const h = r.run?.headline;
              return (
                <div key={r.key} style={{ borderTop: "1px solid var(--ink-2)" }}>
                  <button type="button" onClick={() => setOpenRow(open ? -1 : i)} aria-expanded={open}
                    style={{ width: "100%", border: 0, background: open ? "#2B1F16" : "transparent", color: "var(--paper)", cursor: "pointer", textAlign: "left", display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 20px", gap: 10, alignItems: "center", padding: "14px 10px", borderRadius: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}>{r.art}<span style={{ fontSize: 17, fontWeight: 600 }}>{r.name}</span></span>
                    <Flap text={h?.sentenceF1 != null ? h.sentenceF1.toFixed(2) : "–.––"} on={h?.sentenceF1 != null} />
                    <Flap text={fmtMs(h?.p50LatencyMs)} on={h?.p50LatencyMs != null} />
                    <Flap text={fmtUsd(h?.costPerThousandSentencesUsd)} on={h?.costPerThousandSentencesUsd != null} />
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A6978A" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms" }}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {open ? (
                    <div style={{ padding: "2px 10px 16px 54px", display: "flex", gap: 30, alignItems: "flex-end" }}>
                      <Detail value={d ? fmtInt(d.tp) : "–"} label="MISTAKES CAUGHT" color="var(--amber)" />
                      <Detail value={d ? fmtInt(d.fn) : "–"} label="MISTAKES MISSED" color="var(--red-light)" />
                      <Detail value={d ? fmtInt(d.fp) : "–"} label="FALSE ALARMS" color="#D3C4AC" />
                      {!r.run ? <span style={{ marginLeft: "auto", fontSize: 14, color: "#D3C4AC" }}>Waiting for this run.</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="mono" style={{ margin: "12px 10px 0 10px", fontSize: 11.5, color: "var(--faint)" }}>Accuracy = F1 on the wrong sentences · time = median per answer · cost per 1,000 sentences</p>
          </section>
        </div>

        <section aria-label="What it means for a firm" style={{ marginTop: 16, background: "var(--sheet)", borderRadius: 22, boxShadow: "inset 0 0 0 1px var(--line)", padding: "22px 28px", display: "flex", gap: 40 }}>
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <label htmlFor="docs" style={{ fontSize: 18 }}>If your firm checks <strong className="mono">{fmtInt(docs)}</strong> documents a month</label>
            <input id="docs" type="range" min={0} max={100} step={1} value={docsPos} onChange={(e) => setDocsPos(Number(e.target.value))} />
            <div style={{ display: "flex", gap: 28, marginTop: 6, alignItems: "flex-end" }}>
              <Big value={fmtUsd(costWith(drex))} label="cost with Drex" accent />
              <Big value={fmtUsd(costWith(baseline))} label={`cost with ${baseShort}`} />
              <Big value={hoursSaved !== null ? `${hoursSaved >= 10 ? Math.round(hoursSaved) : hoursSaved.toFixed(1)}h` : "–h"} label="hours of waiting saved" />
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>≈ {avg !== null ? fmtInt(docs * avg) : "–"} sentences</span>
            </div>
          </div>
          <div style={{ width: 1, background: "var(--line)" }} />
          <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <label htmlFor="sure" style={{ fontSize: 18 }}>Ask a person to review when Drex is under <strong className="mono">{Math.round(thresholds[Math.min(sureIdx, thresholds.length - 1)] * 100)}% sure</strong></label>
            <input id="sure" type="range" min={0} max={thresholds.length - 1} step={1} value={Math.min(sureIdx, thresholds.length - 1)} onChange={(e) => setSureIdx(Number(e.target.value))} />
            <div style={{ display: "flex", gap: 28, marginTop: 6 }}>
              <Big value={point ? pct(1 - point.coverage) : "–%"} label="of sentences go to a person" />
              <Big value={point ? pct(point.accuracy) : "–%"} label="right on the rest" accent />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Lane({ top, spriteW, name, x, sprite, done, time, place }: { top: number; spriteW: number; name: string; x: number; sprite: ReactNode; done: boolean; time: string; place: string }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, height: 100 }}>
      <span style={{ position: "absolute", left: 0, top: 42, fontSize: 16, fontWeight: 600 }}>{name}</span>
      <span style={{ position: "absolute", left: 100, right: 30, top: 92, height: 2, backgroundImage: "repeating-linear-gradient(90deg, #E4D8C5 0 2px, transparent 2px 8px)" }} />
      <span style={{ position: "absolute", left: x, top: 12 }}>{sprite}</span>
      <span className="fade" style={{ position: "absolute", right: 30 + 8 + spriteW + 14, top: 36, display: "flex", alignItems: "center", gap: 8, opacity: done ? 1 : 0, transform: done ? "none" : "translateY(8px)" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--muted)" }}>{time}</span>
        <span className="mono" style={{ background: place === "1st" ? "var(--amber)" : "var(--line)", color: "var(--ink)", fontSize: 13, fontWeight: 600, padding: "4px 9px", borderRadius: 6 }}>{place}</span>
      </span>
    </div>
  );
}

function Flap({ text, on }: { text: string; on: boolean }) {
  return (
    <span style={{ display: "flex", gap: 2 }}>
      {text.split("").map((ch, i) => (
        <span key={i} className="mono" style={{ width: 19, height: 28, background: "var(--ink-2)", borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: on ? "var(--amber)" : "#5A4A3D", boxShadow: "inset 0 -14px 0 -13px #22170F" }}>{ch === " " ? " " : ch}</span>
      ))}
    </span>
  );
}

function Detail({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="serif" style={{ fontSize: 34, lineHeight: 1, color }}>{value}</span>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--faint)" }}>{label}</span>
    </span>
  );
}

function Big({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <span style={{ display: "flex", flexDirection: "column" }}>
      <span className="serif" style={{ fontSize: 40, lineHeight: 1, color: accent ? "var(--amber-text)" : "var(--ink)" }}>{value}</span>
      <span style={{ fontSize: 14, color: "var(--muted)" }}>{label}</span>
    </span>
  );
}
