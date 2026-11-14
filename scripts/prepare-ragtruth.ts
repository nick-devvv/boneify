// Builds data/ragtruth/sample.jsonl: 150 RAGTruth test answers per task (QA, Summary, Data2txt), seeded shuffle (seed 2026).
// Also writes data/ragtruth/full.jsonl (all 2,675 good test answers, not committed) for `npm run bench -- --full`.
//
//   npm run prepare-data                      # downloads response.jsonl + source_info.jsonl from GitHub
//   npm run prepare-data -- --dir ./ragtruth  # or reads them from a local folder

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { labelClaims, seededShuffle, TASKS, toExample, type RagExample, type RawResponse, type RawSource } from "../lib/benchmark/dataset";

const RAW = "https://raw.githubusercontent.com/ParticleMedia/RAGTruth/main/dataset";
const SEED = 2026;
const PER_TASK = 150;
const OUT_DIR = path.join(process.cwd(), "data", "ragtruth");

async function load(dir: string | undefined, file: string): Promise<string> {
  if (dir) return readFile(path.join(dir, file), "utf8");
  console.log(`downloading ${file} ...`);
  const res = await fetch(`${RAW}/${file}`);
  if (!res.ok) throw new Error(`Could not download ${file}: HTTP ${res.status}`);
  return res.text();
}

const jsonl = <T>(text: string): T[] => text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

async function main() {
  const i = process.argv.indexOf("--dir");
  const dir = i > 0 ? process.argv[i + 1] : undefined;
  const responses = jsonl<RawResponse>(await load(dir, "response.jsonl"));
  const sources = new Map(jsonl<RawSource>(await load(dir, "source_info.jsonl")).map((s) => [s.source_id, s]));

  const all: RagExample[] = responses
    .filter((r) => r.split === "test" && r.quality === "good")
    .map((r) => toExample(r, sources.get(r.source_id)!))
    .sort((a, b) => Number(a.id) - Number(b.id));

  const sample: RagExample[] = [];
  for (const task of TASKS) sample.push(...seededShuffle(all.filter((e) => e.task === task), SEED).slice(0, PER_TASK));

  await mkdir(OUT_DIR, { recursive: true });
  const write = (file: string, rows: RagExample[]) => writeFile(path.join(OUT_DIR, file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await write("sample.jsonl", sample);
  await write("full.jsonl", all);

  // Print the real counts (sentences as split by extractClaims, the same splitter the product uses).
  const rows: string[] = [];
  let tot = { answers: 0, sentences: 0, wrong: 0, contra: 0, baseless: 0, withSpan: 0, chars: 0, maxChars: 0 };
  for (const task of TASKS) {
    const ex = sample.filter((e) => e.task === task);
    let sentences = 0, wrong = 0, contra = 0, baseless = 0, chars = 0;
    for (const e of ex) {
      const labels = labelClaims(e.response, e.spans);
      sentences += labels.length;
      contra += labels.filter((l) => l.gold === "contradicted").length;
      baseless += labels.filter((l) => l.gold === "not_in_source").length;
      chars += e.source.length;
      tot.maxChars = Math.max(tot.maxChars, e.source.length);
    }
    wrong = contra + baseless;
    const withSpan = ex.filter((e) => e.spans.length).length;
    rows.push(`${task.padEnd(9)} answers ${ex.length}  sentences ${sentences}  marked wrong ${wrong} (${contra} contradicted, ${baseless} not in source)  answers with a span ${withSpan}  avg source ${Math.round(chars / ex.length)} chars`);
    tot = { ...tot, answers: tot.answers + ex.length, sentences: tot.sentences + sentences, wrong: tot.wrong + wrong, contra: tot.contra + contra, baseless: tot.baseless + baseless, withSpan: tot.withSpan + withSpan, chars: tot.chars + chars };
  }
  console.log(`wrote data/ragtruth/sample.jsonl (${sample.length} answers) and full.jsonl (${all.length} answers)`);
  for (const r of rows) console.log("  " + r);
  console.log(`  All       answers ${tot.answers}  sentences ${tot.sentences}  marked wrong ${tot.wrong} (${tot.contra} contradicted, ${tot.baseless} not in source)  answers with a span ${tot.withSpan}  avg source ${Math.round(tot.chars / tot.answers)} chars, max ${tot.maxChars}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
