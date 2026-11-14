// Checks a document from the terminal, using the same checkDocument() as POST /api/check.
//
//   npm run check -- --source contract.pdf --text summary.txt
//   npm run check -- --sample msa-summary
//   npm run check -- --source-url https://example.com/report.html --ai-text "The report says ..."
//   options: --decider local|llm|drex  --perceiver local|ndi  --task "..."  --question "..."  --json

import "./_env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkDocument } from "../lib/pipeline";
import { getSample } from "../lib/samples";
import { ApiError, ProviderError } from "../lib/errors";
import type { DecideContext, SourceInput } from "../lib/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const COLOR = { supported: "\x1b[32m", contradicted: "\x1b[31m", not_in_source: "\x1b[33m", reset: "\x1b[0m", dim: "\x1b[2m" };
const DOT = { supported: "🟢", contradicted: "🔴", not_in_source: "🟡" };

async function main() {
  let source: SourceInput;
  let aiText = arg("ai-text");
  let context: DecideContext | undefined = arg("task") || arg("question") ? { task: arg("task"), question: arg("question") } : undefined;

  if (arg("sample")) {
    const s = await getSample(arg("sample")!);
    source = { kind: "text", text: s.sourceText, name: s.sourceName };
    aiText = aiText ?? s.aiText;
    context = context ?? s.context;
  } else if (arg("source")) {
    const file = arg("source")!;
    source = { kind: "file", bytes: new Uint8Array(await readFile(file)), name: path.basename(file) };
  } else if (arg("source-url")) {
    source = { kind: "url", url: arg("source-url")! };
  } else {
    console.error("Usage: npm run check -- --source <file> --text <ai-text file>   (or --sample <id>, --source-url <url>, --ai-text \"...\")");
    process.exit(2);
  }
  if (arg("text")) aiText = await readFile(arg("text")!, "utf8");

  const r = await checkDocument({ source, aiText: aiText ?? "", context, decider: arg("decider"), perceiver: arg("perceiver") });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log(`${r.source.name} (${r.source.format}, ${r.source.pages} page${r.source.pages === 1 ? "" : "s"}) checked by ${r.engines.decider} (${r.engines.deciderModel}) + ${r.engines.perceiver}\n`);
  for (const c of r.claims) {
    const rec = c.receipt.status === "found" ? `${COLOR.dim}receipt p.${c.receipt.page ?? "?"}: "${(c.receipt.quote ?? "").replace(/\s+/g, " ").slice(0, 90)}"${COLOR.reset}` : `${COLOR.dim}no receipt found${COLOR.reset}`;
    console.log(`${DOT[c.verdict]} ${COLOR[c.verdict]}${c.verdict.padEnd(13)}${COLOR.reset} ${c.confidence.toFixed(2)}${c.needsReview ? " review" : "       "}  ${c.text}`);
    console.log(`   ${rec}`);
  }
  const s = r.summary;
  console.log(`\nTrust score ${s.trustScore}%  ·  ${s.supported} supported, ${s.contradicted} contradicted, ${s.not_in_source} not in source, ${s.needsReview} to review`);
  console.log(`${r.timings.totalMs} ms (parse ${r.timings.parseMs}, decide ${r.timings.decideMs}, ground ${r.timings.groundMs})  ·  $${r.usage.decide.costUsd.toFixed(5)}`);
  for (const w of r.warnings) console.log(`⚠ ${w}`);
}

main().catch((e) => {
  if (e instanceof ApiError || e instanceof ProviderError) console.error(`Error: ${e.message}`);
  else console.error(e);
  process.exit(1);
});
