// One tiny live call to prove a key works:  npm run smoke -- llm | drex | ndi
// drex and llm send one small question and print model, latency and answer.
// ndi uploads data/samples/msa.pdf, parses it, grounds one sentence and prints the page it found.

import "./_env";
import { readFile } from "node:fs/promises";
import { getConfig, isMockNace } from "../lib/config";
import { getDecider } from "../lib/decide";
import { getPerceiver } from "../lib/perceive";
import { extractClaims } from "../lib/claims";
import type { SourceDocument } from "../lib/types";

const SOURCE = "MASTER SERVICES AGREEMENT. The initial term of this Agreement is three (3) years. Customer shall pay a monthly service fee of $12,500.";
const doc: SourceDocument = { name: "smoke.txt", format: "text", text: SOURCE, pages: [{ page: 1, start: 0, end: SOURCE.length }], parsedBy: "local" };

async function smokeDecider(id: "llm" | "drex") {
  const cfg = getConfig();
  const decider = getDecider(id, cfg);
  const claims = extractClaims("The agreement runs for five years.");
  const t0 = performance.now();
  const res = await decider.decide(doc, claims, { task: "Summarize the contract for a partner" });
  const d = res.decisions[0];
  console.log(`${decider.label} OK`);
  console.log(`  model:     ${res.model}`);
  console.log(`  latency:   ${Math.round(performance.now() - t0)} ms`);
  console.log(`  sentence:  "${claims[0].text}"`);
  console.log(`  verdict:   ${d.verdict} (confidence ${d.confidence.toFixed(3)})`);
  console.log(`  probs:     ${JSON.stringify(d.probabilities)}`);
  console.log(`  usage:     ${JSON.stringify(res.usage)}`);
}

async function smokeNdi() {
  const cfg = getConfig();
  const perceiver = getPerceiver("ndi", cfg);
  const bytes = new Uint8Array(await readFile("data/samples/msa.pdf"));
  const t0 = performance.now();
  const parsed = await perceiver.parse({ kind: "file", bytes, name: "msa.pdf", mimeType: "application/pdf" });
  const parseMs = Math.round(performance.now() - t0);
  const claims = extractClaims("Customer pays a monthly service fee of $12,500.");
  const t1 = performance.now();
  const g = await perceiver.ground(parsed, claims);
  const r = g.receipts[claims[0].id];
  console.log("NDI OK");
  console.log(`  parsed by:  ${parsed.parsedBy} (${parsed.format}), ${parsed.pages.length} pages, ${parsed.text.length} characters, ${parseMs} ms`);
  console.log(`  parse job:  ${parsed.ndi?.parseJobId ?? "-"}`);
  console.log(`  ground:     ${r?.status} on page ${r?.page ?? "-"} via ${r?.method}, score ${r?.score ?? "-"}, ${Math.round(performance.now() - t1)} ms`);
  console.log(`  quote:      ${r?.quote ?? "-"}`);
  const warnings = [...(perceiver.warnings ?? []), ...(g.warnings ?? [])];
  if (warnings.length) console.log(`  warnings:   ${warnings.join(" | ")}`);
}

async function main() {
  const which = (process.argv[2] ?? "").toLowerCase();
  const cfg = getConfig();
  if ((which === "drex" || which === "ndi") && isMockNace(cfg)) console.log(`(NACE_BASE_URL is ${cfg.naceBaseUrl}: this is the mock server, not the real API)`);
  if (which === "llm" || which === "drex") return smokeDecider(which);
  if (which === "ndi") return smokeNdi();
  console.error("Usage: npm run smoke -- llm | drex | ndi");
  process.exit(2);
}

main().catch((e) => {
  console.error(`SMOKE FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
