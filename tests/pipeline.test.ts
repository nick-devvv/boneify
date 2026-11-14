import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { checkDocument } from "../lib/pipeline";
import { getSample, getSamplePdf, listSamples } from "../lib/samples";
import { getConfig } from "../lib/config";

const offline = getConfig({ DECIDER: "local", PERCEIVER: "local" });

describe("checkDocument (offline engines)", () => {
  it("gives every msa-summary claim a verdict and a receipt, and the summary adds up", async () => {
    const s = await getSample("msa-summary");
    const r = await checkDocument({ source: { kind: "text", text: s.sourceText, name: s.sourceName }, aiText: s.aiText, context: s.context }, offline);

    expect(r.engines).toEqual({ decider: "local", deciderModel: "rules-v1", perceiver: "local" });
    expect(r.claims).toHaveLength(10);
    for (const c of r.claims) {
      expect(["supported", "contradicted", "not_in_source"]).toContain(c.verdict);
      expect(c.confidence).toBe(c.probabilities[c.verdict]);
      expect(c.needsReview).toBe(c.confidence < 0.6);
      expect(["found", "not_found"]).toContain(c.receipt.status);
      expect(s.aiText.slice(c.start, c.end)).toBe(c.text);
      if (c.receipt.status === "found") expect(r.source.characters).toBeGreaterThanOrEqual(c.receipt.charEnd!);
    }
    const { total, supported, contradicted, not_in_source, trustScore } = r.summary;
    expect(supported + contradicted + not_in_source).toBe(total);
    expect(trustScore).toBe(Math.round((supported / total) * 100));
    expect(r.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(r.warnings).toEqual([]);
  });

  it("reads the committed PDF with page numbers and points receipts at the right page", async () => {
    const s = await getSample("msa-summary");
    const bytes = await getSamplePdf(s);
    const r = await checkDocument({ source: { kind: "file", bytes, name: "msa.pdf" }, aiText: s.aiText }, offline);
    expect(r.source).toMatchObject({ name: "msa.pdf", format: "pdf", pages: 3 });
    const fee = r.claims.find((c) => c.text.includes("$18,500"))!;
    expect(fee.verdict).not.toBe("supported");
    expect(fee.receipt).toMatchObject({ status: "found", page: 2 });
  });

  it("falls back to the built-in matcher when grounding fails, with a warning", async () => {
    const { localPerceiver } = await import("../lib/perceive/local");
    const perceiver = await import("../lib/perceive");
    const orig = localPerceiver.ground;
    localPerceiver.ground = async () => { throw new Error("NDI: overloaded"); };
    try {
      const r = await checkDocument({ source: { kind: "text", text: "The fee is $12,500 per month." }, aiText: "The fee is $12,500 per month." }, offline);
      expect(r.claims[0].receipt.status).toBe("found");
      expect(r.warnings[0]).toMatch(/could not find receipts .*used the built-in matcher/);
    } finally {
      localPerceiver.ground = orig;
    }
    expect(perceiver.getPerceiver("local", offline)).toBe(localPerceiver);
  });
});

describe("demo samples", () => {
  it("every planted number error comes back as not supported from the local decider", async () => {
    for (const s of await listSamples()) {
      if (s.id === "ragtruth-real") continue; // real human labels; the rules engine is not expected to catch them
      const r = await checkDocument({ source: { kind: "text", text: s.sourceText }, aiText: s.aiText }, offline);
      for (const e of s.plantedErrors) {
        const c = r.claims.find((x) => x.text === e.sentence);
        expect(c, `${s.id}: "${e.sentence}" should be a claim`).toBeDefined();
        expect(c!.verdict, `${s.id}: ${e.sentence}`).not.toBe("supported");
      }
    }
  });

  it("PDF and JSON text say the same thing", async () => {
    for (const s of await listSamples()) {
      if (!s.pdfFile) continue;
      const r = await checkDocument({ source: { kind: "file", bytes: new Uint8Array(await readFile(`data/samples/${s.pdfFile}`)), name: s.pdfFile }, aiText: "Placeholder sentence to check here." }, offline);
      const squash = (t: string) => t.replace(/\s+/g, " ").trim();
      expect(r.source.characters).toBeGreaterThan(500);
      const { parseLocal } = await import("../lib/perceive/local");
      const doc = await parseLocal({ kind: "file", bytes: new Uint8Array(await readFile(`data/samples/${s.pdfFile}`)), name: s.pdfFile });
      expect(squash(doc.text)).toBe(squash(s.sourceText));
    }
  });
});
