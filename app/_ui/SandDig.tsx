"use client";

// Just for fun: brush the sand away (drag to dig faster) and find the five fossils hidden under it.

import { useCallback, useEffect, useRef, useState } from "react";
import { BONE, pix } from "./pixel";

const AMMO = ["..ddddd..", ".daaaaad.", "dadddddad", "dadaaadad", "dadadbdad", "dadaddad.", "dadaaaad.", ".daddddd.", "..dd....."];
const TRILO = ["..ddddd..", ".daaaaad.", "dadaaadad", ".daaaaad.", "dadaaadad", ".daaaaad.", "dadaaadad", ".daaaaad.", "..ddddd.."];
const SKULL = ["..dddddddd..", ".daaaaaaaad.", "daaddaaaaaad", "daaddaaaaaad", "daaaaaaaaadd", "dadadadadad.", ".daaaaaaad..", "..ddddddd..."];
const TOOTH = ["ddddd", "daaad", "daaad", "daaad", ".dad.", ".dad.", "..d.."];
const RECEIPT = ["dddddddd", "daaaaaad", "dakkkkad", "daaaaaad", "dakkkaad", "daaaaaad", "dakkkkad", "daaaaaad", "dabbbaad", "daaaaaad", "dd.dd.dd"];
const BRUSH = ["......dd", ".....dwd", "....dwd.", "...dwd..", ".ddd....", "dbbd....", "dbbd....", ".dd....."];

export const SAND_TOP = 176;
const W = 1440, H = 244, CELL = 6;
const FOSSILS = [
  { id: "ammo", art: AMMO, s: 4, x: 470, y: 252, rot: -8, fill: "#CDB894", label: "an ammonite!" },
  { id: "trilo", art: TRILO, s: 4, x: 770, y: 318, rot: 12, fill: "#A88E66", label: "a trilobite!" },
  { id: "skull", art: SKULL, s: 5, x: 1010, y: 238, rot: -6, fill: "#EADBC0", label: "a Rex skull!" },
  { id: "tooth", art: TOOTH, s: 5, x: 300, y: 330, rot: 18, fill: "#FFFAF2", label: "a Rex tooth!" },
  { id: "receipt", art: RECEIPT, s: 4, x: 1240, y: 296, rot: 8, fill: "#FFFAF2", label: "a receipt!" },
].map((f) => ({ ...f, w: f.art[0].length * f.s, h: f.art.length * f.s, p: pix(f.art) }));
const BRUSH_P = pix(BRUSH);
const BONE_P = pix(BONE);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function paintSand(ctx: CanvasRenderingContext2D) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#E1D1B6"; ctx.fillRect(0, 0, W, 46);
  ctx.fillStyle = "#D8C6A6"; ctx.fillRect(0, 46, W, H - 46);
  ctx.fillStyle = "rgba(34,23,15,.13)";
  for (let y = 4; y < 46; y += 10) for (let x = 4; x < W; x += 10) ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = "rgba(34,23,15,.15)";
  for (let y = 48; y < H; y += 7) for (let x = 2; x < W; x += 7) ctx.fillRect(x, y, 2, 2);
}

export function SandDig({ onFind }: { onFind: (label: string, found: number, total: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const brush = useRef<SVGSVGElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const dpr = useRef(1);
  const down = useRef(false);
  const last = useRef(0);
  const [found, setFound] = useState<Record<string, boolean>>({});
  const [started, setStarted] = useState(false);
  const [lastFind, setLastFind] = useState<string | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    dpr.current = Math.min(2, window.devicePixelRatio || 1);
    el.width = W * dpr.current; el.height = H * dpr.current;
    const ctx = el.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.setTransform(dpr.current, 0, 0, dpr.current, 0, 0);
    ctxRef.current = ctx;
    paintSand(ctx);
  }, []);

  const clearAt = (x: number, y: number, rad: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (let gx = Math.floor((x - rad) / CELL); gx <= Math.floor((x + rad) / CELL); gx++) {
      for (let gy = Math.floor((y - rad) / CELL); gy <= Math.floor((y + rad) / CELL); gy++) {
        const cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
        const d = Math.hypot(cx - x, cy - y);
        if (d > rad) continue;
        if (d > rad - CELL && (gx * 7 + gy * 13) % 3 === 0) continue; // crumbly edge
        ctx.clearRect(gx * CELL, gy * CELL, CELL, CELL);
      }
    }
  };

  const dig = useCallback((e: React.PointerEvent<HTMLCanvasElement>, big: boolean) => {
    const el = canvas.current, ctx = ctxRef.current;
    if (!el || !ctx) return;
    const r = el.getBoundingClientRect();
    const k = W / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    if (brush.current) { brush.current.style.opacity = "1"; brush.current.style.transform = `translate(${Math.round(x - 4)}px, ${Math.round(SAND_TOP + y - 26)}px)`; }
    const now = performance.now();
    if (now - last.current < 16) return;
    last.current = now;
    const rad = big ? 28 : 16;
    clearAt(x, y, rad);
    if (!started) setStarted(true);
    // a fossil counts as found once about 40% of it shows
    for (const f of FOSSILS) {
      if (found[f.id]) continue;
      const fx = f.x, fy = f.y - SAND_TOP;
      const nx = clamp(x, fx, fx + f.w), ny = clamp(y, fy, fy + f.h);
      if ((nx - x) ** 2 + (ny - y) ** 2 > rad * rad) continue;
      const d = ctx.getImageData(Math.round(fx * dpr.current), Math.round(fy * dpr.current), Math.round(f.w * dpr.current), Math.round(f.h * dpr.current)).data;
      let clear = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 40) clear++;
      if (clear / (d.length / 4) > 0.4) {
        const next = { ...found, [f.id]: true };
        setFound(next);
        setLastFind(f.id);
        onFind(f.label, Object.keys(next).length, FOSSILS.length);
        break;
      }
    }
  }, [found, started, onFind]);

  const n = Object.keys(found).length;
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: 0, width: W, height: SAND_TOP + H, marginLeft: -W / 2, userSelect: "none", WebkitUserSelect: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: SAND_TOP, height: H, backgroundColor: "#B9A27A", backgroundImage: "radial-gradient(circle, rgba(34,23,15,.20) 1px, transparent 1.6px)", backgroundSize: "6px 6px", boxShadow: "inset 0 6px 10px -6px rgba(34,23,15,.45)" }} />
      {FOSSILS.map((f) => (
        <div key={f.id} style={{ position: "absolute", left: f.x, top: f.y, transform: `rotate(${f.rot}deg)` }}>
          <svg className={found[f.id] && lastFind === f.id ? "fossilhop" : undefined} width={f.w} height={f.h} viewBox={`0 0 ${f.art[0].length} ${f.art.length}`} shapeRendering="crispEdges" style={{ display: "block" }}>
            <path d={f.p.d} fill="#22170F" /><path d={f.p.a} fill={f.fill} /><path d={f.p.k} fill="#A6978A" /><path d={f.p.b} fill="#F0A202" />
          </svg>
        </div>
      ))}
      <canvas ref={canvas}
        onPointerMove={(e) => dig(e, down.current)}
        onPointerDown={(e) => { down.current = true; dig(e, true); }}
        onPointerUp={() => { down.current = false; }}
        onPointerLeave={() => { down.current = false; if (brush.current) brush.current.style.opacity = "0"; }}
        style={{ position: "absolute", left: 0, top: SAND_TOP, width: W, height: H, touchAction: "none", cursor: "none" }} />
      <svg width={78} height={30} viewBox="0 0 13 5" shapeRendering="crispEdges" style={{ position: "absolute", left: 60, top: 230, transform: "rotate(-14deg)", pointerEvents: "none" }}>
        <path d={BONE_P.d} fill="#22170F" /><path d={BONE_P.a} fill="#F0A202" />
      </svg>
      <span className="mono" style={{ position: "absolute", left: 152, top: 236, pointerEvents: "none", fontSize: 12, letterSpacing: ".06em", color: "#5E5045" }}>
        {started ? `FOSSILS ${n} / ${FOSSILS.length}` : "psst… dig in the sand"}
      </span>
      {FOSSILS.filter((f) => found[f.id]).map((f) => (
        <span key={f.id} className="found mono" style={{ position: "absolute", left: Math.round(f.x + f.w / 2), top: f.y - 30, pointerEvents: "none", background: "var(--ink)", color: "var(--paper)", fontSize: 12, padding: "5px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{f.label}</span>
      ))}
      <svg ref={brush} width={30} height={30} viewBox="0 0 8 8" shapeRendering="crispEdges" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", opacity: 0, transition: "opacity 150ms" }}>
        <path d={BRUSH_P.d} fill="#22170F" /><path d={BRUSH_P.w} fill="#C9A26A" /><path d={BRUSH_P.b} fill="#76665A" />
      </svg>
    </div>
  );
}
