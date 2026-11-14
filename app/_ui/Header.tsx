import Link from "next/link";
import type { ReactNode } from "react";
import { Arrow, Rex } from "./Sprites";
import { ThemeToggle } from "./ThemeToggle";

const STEPS = [
  { n: 1, href: "/demo", label: "Demo" },
  { n: 2, href: "/check", label: "Try it" },
  { n: 3, href: "/scoreboard", label: "Scoreboard" },
];

/** Every page shows the same path (1 Demo → 2 Try it → 3 Scoreboard), the dark mode switch and one amber Next button. */
export function Header({ current, next, extra }: { current: 0 | 1 | 2 | 3; next: { href: string; label: string }; extra?: ReactNode }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 36, padding: "18px 40px", maxWidth: 1440, margin: "0 auto", width: "100%" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "var(--ink)" }}>
        <Rex width={26} />
        <span style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.055em" }}>boneify</span>
      </Link>
      <nav aria-label="Steps" className="steps">
        {STEPS.map((s, i) => (
          <span key={s.n} style={{ display: "contents" }}>
            {i > 0 ? <span className="join" aria-hidden="true" /> : null}
            <Link href={s.href} aria-current={current === s.n ? "page" : undefined}>
              <span className="n">{s.n}</span>
              {s.label}
            </Link>
          </span>
        ))}
      </nav>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <ThemeToggle />
        {extra}
        <Link href={next.href} className="btn-next press keep">
          {next.label}
          <Arrow />
        </Link>
      </div>
    </header>
  );
}
