import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { getConfig } from "../lib/config";
import { fixDocument, issuesMarkdown, pairChanges } from "../lib/fix/fix";
import { internProblem, readEvents } from "../lib/fix/intern";
import { getSample } from "../lib/samples";
import type { CheckedClaim } from "../lib/types";

const FAKE = fileURLToPath(new URL("./bin/fake-intern.mjs", import.meta.url));
const cfg = (extra: Record<string, string> = {}) =>
  getConfig({ DECIDER: "local", PERCEIVER: "local", NACE_API_KEY: "nace_sk_test_1234567890", DEEPINFRA_API_KEY: "di_test", INTERN_BIN: FAKE, ...extra });

const claim = (id: string, text: string, verdict: CheckedClaim["verdict"], quote: string | null): CheckedClaim => ({
  id, index: 0, text, start: 0, end: text.length, verdict, probabilities: { supported: 0, contradicted: 0, not_in_source: 0, [verdict]: 0.9 } as never, confidence: 0.9, needsReview: false,
  receipt: { status: quote ? "found" : "not_found", page: quote ? 2 : null, quote, charStart: null, charEnd: null, method: "semantic", score: null, section: quote ? "3.1" : null },
});

describe("Intern events", () => {
  it("reads run_end, Drex decisions and tool calls", () => {
    const lines = [
      { type: "run_start", model: "deepinfra/Qwen/Qwen3.8-27B" },
      { type: "decision", purpose: "supervise", answers: { mode: { choice: "advancing", probabilities: {} } }, duration_ms: 295 },
      { type: "tool_call_start", name: "write" },
      { type: "message", message: { role: "assistant", text: "done" } },
      { type: "run_end", reason: "completed", turns: 2, final_text: "done", usage: { input_tokens: 10, output_tokens: 2, cost_usd: 0 }, system1: { asks: 3, input_tokens: 5, output_tokens: 1, cost_usd: 0 }, duration_ms: 5550 },
    ].map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n";
    const r = readEvents(lines, { internSystem1: "drex-latest", internSystem2: "x" }, 1);
    expect(r).toMatchObject({ ok: true, reason: "completed", turns: 2, finalText: "done", system2: "deepinfra/Qwen/Qwen3.8-27B", system1Asks: 3, toolCalls: ["write"], durationMs: 5550 });
    expect(r.decisions).toEqual([{ purpose: "supervise", choice: "advancing", ms: 295 }]);
    expect(r.usage).toEqual({ inputTokens: 15, outputTokens: 3, costUsd: 0 });
  });

  it("says why Intern can't run", () => {
    expect(internProblem(cfg({ INTERN_BIN: "/nope/intern" }))).toMatch(/not installed/);
    expect(internProblem(cfg({ NACE_API_KEY: "" }))).toMatch(/NACE_API_KEY/);
    expect(internProblem(cfg({ DEEPINFRA_API_KEY: "" }))).toMatch(/DEEPINFRA_API_KEY/);
    expect(internProblem(cfg())).toBeNull();
  });
});

describe("fix helpers", () => {
  const flagged = [claim("s4", "The agreement runs for five years.", "contradicted", "2.1 Initial Term. The initial term is three (3) years."), claim("s8", "Either party may terminate for convenience.", "not_in_source", null)];
  it("issues.md carries each sentence, its problem and its evidence", () => {
    const md = issuesMarkdown(flagged);
    expect(md).toContain('1. Sentence: "The agreement runs for five years."');
    expect(md).toContain("contradicts the source");
    expect(md).toContain('Source (§3.1, p.2): "2.1 Initial Term. The initial term is three (3) years."');
    expect(md).toContain("2. Sentence:");
    expect(md).toContain("Source: no matching text found.");
  });
  it("pairs each flagged sentence with its rewrite, or null when removed", () => {
    const changes = pairChanges(flagged, "The agreement runs for three (3) years. Fees are due monthly.");
    expect(changes[0]).toMatchObject({ claimId: "s4", after: "The agreement runs for three (3) years." });
    expect(changes[1]).toMatchObject({ claimId: "s8", after: null, evidence: null });
  });
});

describe("fixDocument (offline engines + a fake Intern)", () => {
  it("checks, lets Intern fix the flagged sentences, and checks again", async () => {
    const s = await getSample("msa-summary");
    const r = await fixDocument({ source: { kind: "text", text: s.sourceText, name: s.sourceName }, aiText: s.aiText, context: s.context }, cfg());
    expect(r.before.summary.trustScore).toBeLessThan(100);
    expect(r.fixedText).toContain("$12,500");
    expect(r.fixedText).not.toContain("$18,500");
    expect(r.after.summary.contradicted).toBeLessThan(r.before.summary.contradicted);
    expect(r.after.summary.trustScore).toBeGreaterThan(r.before.summary.trustScore);
    expect(r.after.source).toEqual(r.before.source); // same document, read once
    expect(r.intern).toMatchObject({ ok: true, reason: "completed", system1Asks: 2, toolCalls: ["read", "write"], reply: "Fixed 3 sentences." });
    expect(r.intern.decisions.map((d) => d.choice)).toEqual(["advancing", "done_polishing"]);
    expect(r.changes.length).toBe(r.before.claims.filter((c) => c.verdict !== "supported").length);
    expect(r.changes.find((c) => c.before.includes("$18,500"))?.after).toContain("$12,500");
  });

  it("is 501 intern_unavailable where Intern isn't installed", async () => {
    await expect(fixDocument({ source: { kind: "text", text: "a b c d." }, aiText: "a b c d." }, cfg({ INTERN_BIN: "/nope/intern" }))).rejects.toMatchObject({ status: 501, code: "intern_unavailable" });
  });

  it("is 502 intern_failed when Intern writes nothing", async () => {
    const s = await getSample("msa-summary");
    const stuck = cfg({ INTERN_BIN: fileURLToPath(new URL("./bin/fake-intern-stuck.mjs", import.meta.url)) });
    await expect(fixDocument({ source: { kind: "text", text: s.sourceText }, aiText: s.aiText }, stuck)).rejects.toMatchObject({ status: 502, code: "intern_failed" });
  });

  it("gives Intern only the Nace and DeepInfra keys, never the LLM key", async () => {
    const { internEnv } = await import("../lib/fix/intern");
    process.env.LLM_API_KEY = "sk-should-not-leak";
    process.env.OPENAI_API_KEY = "sk-should-not-leak";
    try {
      const env = internEnv(cfg());
      expect(env.NACE_API_KEY).toBe("nace_sk_test_1234567890");
      expect(env.DEEPINFRA_API_KEY).toBe("di_test");
      expect(Object.values(env)).not.toContain("sk-should-not-leak");
      expect(env.PATH).toBeTruthy();
    } finally {
      delete process.env.LLM_API_KEY;
      delete process.env.OPENAI_API_KEY;
    }
  });
});
