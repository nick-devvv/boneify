// Saves the four API fixtures in data/fixtures/ from the real route handlers, with the offline engines.
//   npx tsx scripts/save-fixtures.ts
// The fixture-shape test (tests/api.test.ts) compares each fixture's keys with a live response,
// so a change to the API shape fails the tests instead of breaking whatever calls the API.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Offline engines, no keys: what a fresh clone returns.
for (const k of Object.keys(process.env)) if (/^(DECIDER|PERCEIVER|NACE_|LLM_|OPENAI_|DREX_|NDI_|REVIEW_THRESHOLD|ALLOWED_ORIGIN)/.test(k)) delete process.env[k];

const OUT = path.join(process.cwd(), "data", "fixtures");

async function save(name: string, res: Response) {
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`);
  await writeFile(path.join(OUT, name), JSON.stringify(await res.json(), null, 2) + "\n");
  console.log(`saved data/fixtures/${name}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const health = await import("../app/api/health/route");
  const check = await import("../app/api/check/route");
  const bench = await import("../app/api/benchmark/route");
  const run = await import("../app/api/benchmark/[run]/route");

  await save("health.json", health.GET());
  await save("check-response.json", await check.POST(new Request("http://localhost/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sampleId: "msa-summary" }) })));
  await save("benchmark-list.json", await bench.GET());
  await save("benchmark-run.json", await run.GET(new Request("http://localhost/api/benchmark/local?limit=5"), { params: Promise.resolve({ run: "local" }) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
