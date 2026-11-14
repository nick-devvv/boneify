// Runs one decider over the RAGTruth sample and writes data/results/<name>.json.
//
//   npm run bench -- --decider llm  --name llm-gpt --label "GPT (frontier)"
//   npm run bench -- --decider local --name local
//   npm run bench -- --decider drex --name drex
//   optional: --limit 50  --task QA  --concurrency 4  --resume  --full  --allow-mock
//
// Saves progress every 25 answers (data/results/.<name>.partial.json), so --resume continues after a crash or rate limit.
// One answer failing (after retries) is recorded with its error and skipped; the run never dies on a single bad call.
// A Drex run against a localhost Nace server is refused unless --allow-mock, and is then saved as <name>-mock.json,
// which the API never shows. Mock numbers never reach the scoreboard.

import "./_env";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig, isMockNace } from "../lib/config";
import { getDecider } from "../lib/decide";
import { LLM_BATCH_SIZE } from "../lib/decide/llm";
import { ProviderError } from "../lib/errors";
import { answerIsWrong, contextFor, labelClaims, loadExamples, TASKS, type RagExample, type RagTask } from "../lib/benchmark/dataset";
import { computeMetrics, type ExampleResult } from "../lib/benchmark/metrics";
import { resultsDir, type RunFile } from "../lib/benchmark/results";
import type { SourceDocument } from "../lib/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const cfg = getConfig();
  const deciderId = (arg("decider") ?? cfg.decider).toLowerCase();
  const decider = getDecider(deciderId, cfg);
  let name = arg("name") ?? (deciderId === "llm" ? `llm-${cfg.llmModel.split("/").pop()!.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase()}` : deciderId);
  const label = arg("label") ?? decider.label;
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const task = arg("task") as RagTask | undefined;
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 4));
  if (task && !TASKS.includes(task)) throw new Error(`--task must be one of ${TASKS.join(", ")}`);

  if (deciderId === "drex" && isMockNace(cfg)) {
    if (!flag("allow-mock")) {
      console.error(`Refusing to save a Drex run: NACE_BASE_URL (${cfg.naceBaseUrl}) is the mock server. Mock numbers never go on the scoreboard.`);
      console.error("Point NACE_BASE_URL at https://console.nace.ai, or pass --allow-mock to save it as a hidden *-mock.json file.");
      process.exit(2);
    }
    if (!name.endsWith("-mock")) name = `${name}-mock`;
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(name)) throw new Error(`--name "${name}" may only use letters, digits, dot, dash and underscore`);

  const dataFile = path.join(process.cwd(), "data", "ragtruth", flag("full") ? "full.jsonl" : "sample.jsonl");
  if (!existsSync(dataFile)) throw new Error(`${path.relative(process.cwd(), dataFile)} is missing. Run: npm run prepare-data`);
  let examples: RagExample[] = await loadExamples(dataFile);
  if (task) examples = examples.filter((e) => e.task === task);
  if (limit) examples = examples.slice(0, limit);

  await mkdir(resultsDir(), { recursive: true });
  const outFile = path.join(resultsDir(), `${name}.json`);
  const partialFile = path.join(resultsDir(), `.${name}.partial.json`);
  const done = new Map<string, ExampleResult>();
  if (flag("resume") && existsSync(partialFile)) {
    for (const r of JSON.parse(await readFile(partialFile, "utf8")) as ExampleResult[]) if (!r.error) done.set(r.id, r);
    console.log(`resuming: ${done.size} answers already done`);
  }

  const batchSize = deciderId === "llm" ? LLM_BATCH_SIZE : deciderId === "drex" ? cfg.drexBatchSize : null;
  console.log(`benchmark ${name}: ${decider.label} (${decider.model}) on ${examples.length} RAGTruth answers, concurrency ${concurrency}`);

  const todo = examples.filter((e) => !done.has(e.id));
  let finished = 0;
  let sinceSave = 0;
  let fatal: Error | null = null;
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    // serialised: workers finishing together must not write the same temp file at once
    saving = saving.then(async () => {
      const tmp = partialFile + ".tmp";
      await writeFile(tmp, JSON.stringify([...done.values()]));
      await rename(tmp, partialFile);
    });
    return saving;
  };

  async function runOne(ex: RagExample) {
    const labels = labelClaims(ex.response, ex.spans);
    const doc: SourceDocument = { name: `ragtruth-${ex.sourceId}`, format: ex.task === "Data2txt" ? "json" : "text", text: ex.source, pages: [{ page: 1, start: 0, end: ex.source.length }], parsedBy: "local" };
    const base = { id: ex.id, task: ex.task, writerModel: ex.writerModel, goldHallucinated: answerIsWrong(ex) };
    if (!labels.length) {
      done.set(ex.id, { ...base, latencyMs: 0, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, claims: [] });
      return;
    }
    try {
      const t0 = performance.now();
      const res = await decider.decide(doc, labels, contextFor(ex));
      const latencyMs = Math.round(performance.now() - t0);
      const byId = new Map(res.decisions.map((d) => [d.claimId, d]));
      done.set(ex.id, {
        ...base,
        latencyMs,
        usage: res.usage,
        claims: labels.map((c) => {
          const d = byId.get(c.id)!;
          return { id: c.id, text: c.text, gold: c.gold, pred: d.verdict, confidence: d.confidence, probabilities: d.probabilities };
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      done.set(ex.id, { ...base, latencyMs: 0, usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, claims: [], error: msg });
      console.warn(`  answer ${ex.id} failed: ${msg}`);
      // A wrong key or no credit fails every call: stop instead of burning through the sample.
      if (err instanceof ProviderError && (err.status === 401 || err.status === 402 || err.status === 403)) fatal = err;
    }
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (next < todo.length && !fatal) {
        const ex = todo[next++];
        await runOne(ex);
        finished++;
        sinceSave++;
        if (sinceSave >= 25) {
          sinceSave = 0;
          await save();
          console.log(`  ${done.size}/${examples.length} answers`);
        }
      }
    }),
  );
  await save();
  if (fatal) {
    console.error(`Stopped: ${(fatal as Error).message}. Progress saved; fix the problem and rerun with --resume.`);
    process.exit(1);
  }

  const results = examples.map((e) => done.get(e.id)).filter((r): r is ExampleResult => Boolean(r));
  const metrics = computeMetrics(results);
  const file: RunFile = {
    run: name,
    label,
    decider: deciderId,
    model: decider.model,
    createdAt: new Date().toISOString(),
    dataset: { name: "RAGTruth", split: "test", examples: results.length, seed: 2026 },
    settings: { concurrency, batchSize },
    metrics,
    examples: results,
  };
  await writeFile(outFile, JSON.stringify(file, null, 1) + "\n");
  await rm(partialFile, { force: true });

  console.log(`saved ${path.relative(process.cwd(), outFile)}${finished ? "" : " (nothing new to run)"}`);
  console.log(
    `${name}: sentence F1 ${metrics.sentence.f1.toFixed(3)} (P ${metrics.sentence.precision.toFixed(3)}, R ${metrics.sentence.recall.toFixed(3)}), ` +
      `p50 latency ${metrics.latency.p50Ms} ms, cost per 1,000 sentences $${metrics.cost.perThousandSentencesUsd.toFixed(4)}, ` +
      `${metrics.examples} answers / ${metrics.sentences} sentences, ${metrics.failedExamples} failed`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
