import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { answerIsWrong, labelClaims, loadExamples, seededShuffle, type RagSpan } from "../lib/benchmark/dataset";

const span = (start: number, end: number, type: RagSpan["type"]): RagSpan => ({ start, end, type, labelType: type === "conflict" ? "Evident Conflict" : "Evident Baseless Info", implicitTrue: false, dueToNull: false, note: "" });

describe("labelClaims (span -> sentence label)", () => {
  const response = "The fee is $12,500 per month. The term is five years long. The CEO will step down soon.";
  // s1: 0-29, s2: 30-58, s3: 59-87

  it("no overlap means supported", () => {
    expect(labelClaims(response, []).map((c) => c.gold)).toEqual(["supported", "supported", "supported"]);
  });

  it("a conflict span makes the sentence contradicted, a baseless-only span makes it not_in_source", () => {
    const labels = labelClaims(response, [span(42, 46, "conflict"), span(63, 67, "baseless")]);
    expect(labels.map((c) => c.gold)).toEqual(["supported", "contradicted", "not_in_source"]);
  });

  it("conflict beats baseless when both overlap one sentence", () => {
    const labels = labelClaims(response, [span(31, 35, "baseless"), span(42, 46, "conflict")]);
    expect(labels[1].gold).toBe("contradicted");
  });

  it("a span crossing a sentence boundary labels both sentences", () => {
    const labels = labelClaims(response, [span(20, 40, "baseless")]);
    expect(labels.map((c) => c.gold)).toEqual(["not_in_source", "not_in_source", "supported"]);
  });

  it("an answer is wrong when it has any span", () => {
    expect(answerIsWrong({ spans: [] } as never)).toBe(false);
    expect(answerIsWrong({ spans: [span(0, 1, "baseless")] } as never)).toBe(true);
  });

  it("the seeded shuffle is deterministic", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(seededShuffle(xs, 2026)).toEqual(seededShuffle(xs, 2026));
    expect(seededShuffle(xs, 2026)).not.toEqual(xs);
  });
});

describe("committed sample", () => {
  it.runIf(existsSync("data/ragtruth/sample.jsonl"))("has 150 answers per task and 266 wrong sentences", async () => {
    const ex = await loadExamples("data/ragtruth/sample.jsonl");
    expect(ex).toHaveLength(450);
    for (const t of ["QA", "Summary", "Data2txt"]) expect(ex.filter((e) => e.task === t)).toHaveLength(150);
    const wrong = ex.flatMap((e) => labelClaims(e.response, e.spans)).filter((c) => c.gold !== "supported");
    expect(wrong).toHaveLength(266);
    expect(ex.filter(answerIsWrong)).toHaveLength(171);
  });
});
