import { describe, expect, it } from "vitest";
import { localDecider } from "../lib/decide/local";
import { extractClaims } from "../lib/claims";
import type { SourceDocument } from "../lib/types";
import { VERDICTS } from "../lib/types";

const SOURCE = `MASTER SERVICES AGREEMENT
This Master Services Agreement is entered into by Harbor Analytics LLC and Juniper Freight Co.
2.1 Term. The initial term of this Agreement is three (3) years from the Effective Date.
4.1 Fees. Customer shall pay a monthly service fee of $12,500. Invoices are payable within thirty (30) days.
9.2 Termination for Cause. Either party may terminate this Agreement if the other party materially breaches it and does not cure the breach within 30 days.
Northwind Robotics reported quarterly revenue of $42.8 million.`;

const doc: SourceDocument = { name: "msa.txt", format: "text", text: SOURCE, pages: [{ page: 1, start: 0, end: SOURCE.length }], parsedBy: "local" };

async function verdicts(aiText: string) {
  const claims = extractClaims(aiText);
  const res = await localDecider.decide(doc, claims);
  return res.decisions;
}

describe("local decider", () => {
  it("returns probabilities over all three verdicts that add up to 1", async () => {
    const [d] = await verdicts("The initial term of this Agreement is three years.");
    for (const v of VERDICTS) expect(d.probabilities[v]).toBeGreaterThanOrEqual(0);
    expect(VERDICTS.reduce((a, v) => a + d.probabilities[v], 0)).toBeCloseTo(1, 5);
    expect(d.confidence).toBe(d.probabilities[d.verdict]);
  });

  it("supports a faithful sentence", async () => {
    const [d] = await verdicts("Customer pays a monthly service fee of $12,500.");
    expect(d.verdict).toBe("supported");
  });

  it("never supports a sentence with a wrong number", async () => {
    const ds = await verdicts(
      "The agreement runs for five years. Customer pays a monthly service fee of $18,500. Northwind reported quarterly revenue of $48.2 million.",
    );
    for (const d of ds) {
      expect(d.verdict).not.toBe("supported");
      expect(d.verdict).toBe("contradicted");
    }
  });

  it("flags made-up information as not supported", async () => {
    const [d] = await verdicts("Either party may terminate for convenience on 30 days' notice to Globex Partners.");
    expect(d.verdict).not.toBe("supported");
  });

  it("reports zero cost and no requests", async () => {
    const res = await localDecider.decide(doc, extractClaims("The fee is $12,500 per month."));
    expect(res.usage).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(res.model).toBe("rules-v1");
  });
});
