#!/usr/bin/env node
// A stand-in for the Intern CLI in tests: fixes the msa-summary's two wrong numbers and drops the made-up clause,
// writing fixed.txt in --cwd and printing Intern-style JSON events.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const cwd = args[args.indexOf("--cwd") + 1];
const ev = (e) => process.stdout.write(JSON.stringify({ timestamp: Date.now(), ...e }) + "\n");
ev({ type: "run_start", model: args[args.indexOf("--system2") + 1], cwd, tools: ["read", "write"] });
ev({ type: "tool_call_start", name: "read", arguments: { path: "issues.md" } });
ev({ type: "decision", purpose: "supervise", backend: "decisions-api:drex-latest", answers: { mode: { choice: "advancing" } }, duration_ms: 300 });
const draft = readFileSync(join(cwd, "draft.txt"), "utf8");
const fixed = draft.replace("five years", "three (3) years").replace("$18,500", "$12,500").replace(/Either party may terminate for convenience[^.]*\.\s*/, "");
ev({ type: "tool_call_start", name: "write", arguments: { path: "fixed.txt" } });
writeFileSync(join(cwd, "fixed.txt"), fixed);
ev({ type: "decision", purpose: "wrap_up", backend: "decisions-api:drex-latest", answers: { wrap: { choice: "done_polishing" } }, duration_ms: 250 });
ev({ type: "run_end", reason: "completed", turns: 2, final_text: "Fixed 3 sentences.", usage: { input_tokens: 100, output_tokens: 20, cost_usd: 0.001 }, system1: { asks: 2, input_tokens: 50, output_tokens: 10, cost_usd: 0.0001 }, duration_ms: 1234 });
