import type { CSSProperties } from "react";
import { BONE, CRACK, PAGE, PICK, REX, SAURO, TRILO, pix } from "./pixel";
import type { VerdictOrPending } from "./verdict";

type Base = { className?: string; style?: CSSProperties };

export function Rex({ rows = REX, width = 88, dark = false, className, style }: Base & { rows?: string[]; width?: number; dark?: boolean }) {
  const p = pix(rows);
  return (
    <svg className={className} style={style} width={width} height={(width * 20) / 22} viewBox="0 0 22 20" shapeRendering="crispEdges" aria-hidden="true">
      <path d={p.d} fill={dark ? "#F5EEE2" : "#22170F"} />
      <path d={p.g} fill="#5B8C3E" />
      <path d={p.l} fill="#D9E3A5" />
      <path d={p.w} fill="#FFFAF2" />
      <path d={p.p} fill="#FFFAF2" />
    </svg>
  );
}

export function Sauro({ width = 116, dark = false, className, style }: Base & { width?: number; dark?: boolean }) {
  const p = pix(SAURO);
  return (
    <svg className={className} style={style} width={width} height={(width * 11) / 16} viewBox="0 0 16 11" shapeRendering="crispEdges" aria-hidden="true">
      <path d={p.d} fill={dark ? "#F5EEE2" : "#22170F"} />
      <path d={p.s} fill="#8BA36A" />
    </svg>
  );
}

export function Trilo({ width = 44, dark = false, className, style }: Base & { width?: number; dark?: boolean }) {
  const p = pix(TRILO);
  return (
    <svg className={className} style={style} width={width} height={width} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <path d={p.d} fill={dark ? "#F5EEE2" : "#22170F"} />
      <path d={p.t} fill="#C9A26A" />
    </svg>
  );
}

const BONE_P = pix(BONE);
const CRACK_P = pix(CRACK);

/** The verdict icon: amber bone = correct, red cracked bone = wrong, faded outline = made up, faint outline = not checked yet. */
export function BoneIcon({ verdict, width = 28, dark = false, className, style }: Base & { verdict: VerdictOrPending; width?: number; dark?: boolean }) {
  const cracked = verdict === "contradicted";
  const p = cracked ? CRACK_P : BONE_P;
  const ink = dark ? "#F5EEE2" : "#22170F";
  const outline = verdict === "not_in_source" || verdict === "pending" ? "#A6978A" : ink;
  const fill = verdict === "supported" ? "#F0A202" : cracked ? "#EADBC0" : "transparent";
  return (
    <svg className={className} style={{ opacity: verdict === "pending" ? 0.35 : 1, ...style }} width={width} height={(width * 5) / 13} viewBox="0 0 13 5" shapeRendering="crispEdges" aria-hidden="true">
      <path d={p.d} fill={outline} />
      <path d={p.a} fill={fill} />
      {cracked ? <path d={p.r} fill={dark ? "#FF7A66" : "#C4321F"} /> : null}
    </svg>
  );
}

export function PageIcon({ width = 60, className, style }: Base & { width?: number }) {
  const p = pix(PAGE);
  return (
    <svg className={className} style={style} width={width} height={(width * 12) / 10} viewBox="0 0 10 12" shapeRendering="crispEdges" aria-hidden="true">
      <path d={p.d} fill="#22170F" />
      <path d={p.p} fill="#FFFAF2" />
      <path d={p.k} fill="#A6978A" />
    </svg>
  );
}

export function Pick({ width = 45, dark = false, head = "#A6978A", className, style }: Base & { width?: number; dark?: boolean; head?: string }) {
  const p = pix(PICK);
  return (
    <svg className={className} style={style} width={width} height={width} viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <path d={p.d} fill={dark ? "#F5EEE2" : "#22170F"} />
      <path d={p.k} fill={head} />
      <path d={p.w} fill="#C9A26A" />
    </svg>
  );
}

export function Arrow({ dir = "right", size = 16 }: { dir?: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "right" ? <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></> : <path d="M15 18l-6-6 6-6" />}
    </svg>
  );
}

export function Chevron({ dir = "right", size = 22 }: { dir?: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "right" ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
    </svg>
  );
}
