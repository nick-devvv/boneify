// Contract tests against whatever NACE_BASE_URL points at: the mock tonight, the real API tomorrow.
//   npm run test:live
// They check the response shapes the code relies on, so a difference from the docs shows up in a minute, not on stage.
// Reads NACE_BASE_URL / NACE_API_KEY from the shell or .env.local. Costs a few cents on the real API.

import "../../scripts/_env";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { getConfig, isMockNace } from "../../lib/config";
import { createDrexDecider } from "../../lib/decide/drex";
import { createNdiPerceiver } from "../../lib/perceive/ndi";
import { extractClaims } from "../../lib/claims";
import type { SourceDocument } from "../../lib/types";

const cfg = getConfig();
const where = isMockNace(cfg) ? `mock server ${cfg.naceBaseUrl}` : cfg.naceBaseUrl;

describe.runIf(Boolean(cfg.naceApiKey))(`Nace contract (${where})`, () => {
  it("Drex /v1/systemone answers a choice question with probabilities over our three labels", async () => {
    const text = "MASTER SERVICES AGREEMENT. The initial term of this Agreement is three (3) years.";
    const doc: SourceDocument = { name: "t.txt", format: "text", text, pages: [{ page: 1, start: 0, end: text.length }], parsedBy: "local" };
    const raw = await fetch(`${cfg.naceBaseUrl}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.naceApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.drexModel,
        state: { source_document: text },
        questions: { s1: { type: "choice", instructions: 'Check this sentence. Sentence: "The agreement runs for five years."', criteria: { supported: "a", contradicted: "b", not_in_source: "c" } } },
      }),
    });
    expect(raw.status).toBe(200);
    const body = await raw.json();
    expect(typeof body.model).toBe("string");
    expect(body.answers.s1).toMatchObject({ choice: expect.any(String), confidence: expect.any(Number) });
    expect(Object.keys(body.answers.s1.probabilities).sort()).toEqual(["contradicted", "not_in_source", "supported"]);
    expect(typeof body.usage.input_tokens).toBe("number");
    console.log(`  Drex model ${body.model}, request ${body.request_id}, ${body.evaluation_time_ms} ms, answer ${body.answers.s1.choice} (${body.answers.s1.confidence})`);

    const res = await createDrexDecider(cfg).decide(doc, extractClaims("The agreement runs for five years."));
    expect(res.decisions[0].confidence).toBeGreaterThan(0);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
  });

  it("Drex rejects a bad key with 401", async () => {
    const r = await fetch(`${cfg.naceBaseUrl}/v1/systemone`, { method: "POST", headers: { Authorization: "Bearer sk-not-a-nace-key", "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });

  it("NDI upload -> parse -> ground on the sample PDF, through the real code", async () => {
    const ndi = createNdiPerceiver(cfg);
    const bytes = new Uint8Array(await readFile("data/samples/msa.pdf"));
    const doc = await ndi.parse({ kind: "file", bytes, name: "msa.pdf", mimeType: "application/pdf" });
    expect(ndi.warnings).toEqual([]); // no fallback: NDI itself read the file
    expect(doc.parsedBy).toBe("ndi");
    expect(doc.ndi?.parseJobId).toBeTruthy();
    expect(doc.pages.length).toBe(3);
    expect(doc.text).toContain("12,500");

    const claims = extractClaims("Customer pays a monthly service fee of $12,500.");
    const g = await ndi.ground(doc, claims);
    expect(g.warnings).toEqual([]);
    expect(g.receipts[claims[0].id]).toMatchObject({ status: "found", page: 2 });
    console.log(`  NDI parse job ${doc.ndi?.parseJobId}, receipt on page ${g.receipts[claims[0].id].page}: ${g.receipts[claims[0].id].quote?.slice(0, 60)}`);
  });
});

describe.runIf(!cfg.naceApiKey)("Nace contract", () => {
  it("needs NACE_API_KEY (and NACE_BASE_URL) in .env.local", () => {
    expect.fail("Set NACE_API_KEY in .env.local (any nace_sk_ value works against the mock).");
  });
});
