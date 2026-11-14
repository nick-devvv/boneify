// Runs Intern (github.com/nace-ai/intern), Nace's agent harness, headless: `intern -p --json`, one JSON event per line.
// System 2 (DeepInfra by default) writes and calls tools; System 1 (Drex) answers Intern's own small decisions while it works
// (is the task finished? is the agent off plan?). Each of those shows up as a `decision` event; `run_end` sums them in `system1`.
//
// Intern has a shell tool, so it always runs in a fresh temp folder with a minimal environment (no LLM or other keys),
// a turn budget and a hard timeout.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Config } from "../config";
import { ApiError } from "../errors";

export interface InternDecision { purpose: string; choice: string | null; ms: number }
export interface InternRun {
  ok: boolean;
  reason: string;              // run_end.reason: "completed" | "max_turns" | "aborted" | "error" | "timeout" ...
  finalText: string;
  turns: number;
  durationMs: number;
  system2: string;
  system1: string;
  system1Asks: number;         // how many decisions Drex made for Intern
  decisions: InternDecision[]; // each one, in order
  toolCalls: string[];         // tool names in order (read, write, edit, bash, ...)
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/** The intern executable, or null when it isn't installed here (e.g. on Vercel). */
export function findIntern(cfg: Config): string | null {
  if (cfg.internBin) return existsSync(cfg.internBin) ? cfg.internBin : null;
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local", "bin")];
  for (const d of dirs) {
    if (!d) continue;
    const p = join(d, process.platform === "win32" ? "intern.exe" : "intern");
    if (existsSync(p)) return p;
  }
  return null;
}

/** Why Intern can't run here, or null when it can. */
export function internProblem(cfg: Config): string | null {
  if (!findIntern(cfg)) return "Intern is not installed where this server runs (uv tool install \"intern-agent @ git+https://github.com/nace-ai/intern\").";
  if (!cfg.naceApiKey) return "Set NACE_API_KEY: Intern asks Drex for its decisions.";
  if (cfg.internSystem2.startsWith("deepinfra/") && !cfg.deepinfraApiKey) return "Set DEEPINFRA_API_KEY for Intern's writing model.";
  return null;
}

/** Parse Intern's JSON-lines output (exported for tests). */
export function readEvents(lines: string, cfg: Pick<Config, "internSystem1" | "internSystem2">, durationMs: number): InternRun {
  const run: InternRun = {
    ok: false, reason: "no_run_end", finalText: "", turns: 0, durationMs,
    system2: cfg.internSystem2, system1: cfg.internSystem1, system1Asks: 0, decisions: [], toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
  let lastText = "";
  for (const line of lines.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "run_start" && typeof e.model === "string") run.system2 = e.model;
    else if (e.type === "decision") {
      const first = e.answers && typeof e.answers === "object" ? Object.values(e.answers)[0] as { choice?: unknown } | undefined : undefined;
      run.decisions.push({ purpose: String(e.purpose ?? ""), choice: first?.choice != null ? String(first.choice) : null, ms: Number(e.duration_ms ?? 0) });
    } else if (e.type === "tool_call_start" && e.name) run.toolCalls.push(String(e.name));
    else if (e.type === "message" && e.message?.role === "assistant" && e.message.text) lastText = String(e.message.text);
    else if (e.type === "run_end") {
      run.reason = String(e.reason ?? "unknown");
      run.ok = run.reason === "completed";
      run.turns = Number(e.turns ?? 0);
      run.finalText = String(e.final_text ?? lastText ?? "");
      run.system1Asks = Number(e.system1?.asks ?? run.decisions.length);
      const u = e.usage ?? {};
      const s1 = e.system1 ?? {};
      run.usage = {
        inputTokens: Number(u.input_tokens ?? 0) + Number(s1.input_tokens ?? 0),
        outputTokens: Number(u.output_tokens ?? 0) + Number(s1.output_tokens ?? 0),
        costUsd: Number(u.cost_usd ?? 0) + Number(s1.cost_usd ?? 0),
      };
      if (e.duration_ms) run.durationMs = Number(e.duration_ms);
    }
  }
  if (!run.finalText) run.finalText = lastText;
  if (!run.system1Asks) run.system1Asks = run.decisions.length;
  return run;
}

/** Intern's environment: PATH, HOME, the Nace and DeepInfra keys, and network plumbing. Never other keys. */
export function internEnv(cfg: Config): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? homedir(),
    NACE_API_KEY: cfg.naceApiKey,
    ...(cfg.deepinfraApiKey ? { DEEPINFRA_API_KEY: cfg.deepinfraApiKey } : {}),
    // network plumbing only (proxies, CA bundles, locale); never other keys
    ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v && /^(LANG|LC_ALL|https?_proxy|no_proxy|HTTPS?_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|UV_[A-Z_]+|XDG_[A-Z_]+)$/.test(k))),
  } as unknown as NodeJS.ProcessEnv;
}

export async function runIntern(prompt: string, cwd: string, cfg: Config): Promise<InternRun> {
  const bin = findIntern(cfg);
  const problem = internProblem(cfg);
  if (!bin || problem) throw new ApiError(501, "intern_unavailable", problem ?? "Intern is not installed here.");
  const args = ["-p", "--json", "--no-session", "--no-memory", "--max-turns", String(cfg.internMaxTurns), "--system1", cfg.internSystem1, "--system2", cfg.internSystem2, "--cwd", cwd, "--", prompt];
  const env = internEnv(cfg);
  const t0 = Date.now();
  return new Promise<InternRun>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, cfg.internTimeoutMs);
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { err = (err + d.toString("utf8")).slice(-2000); });
    child.on("error", (e) => { clearTimeout(timer); reject(new ApiError(501, "intern_unavailable", `Intern could not start: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const run = readEvents(out, cfg, Date.now() - t0);
      if (timedOut) { run.ok = false; run.reason = "timeout"; }
      if (run.reason === "no_run_end") {
        const why = err.trim().split("\n").filter(Boolean).pop() ?? `exit code ${code}`;
        return reject(new ApiError(502, "intern_failed", `Intern stopped without finishing: ${why.slice(0, 300)}`));
      }
      resolve(run);
    });
  });
}
