import { errorResponse, json, options } from "../../../lib/api";
import { ApiError } from "../../../lib/errors";
import { getConfig } from "../../../lib/config";
import { datasetFacts, improvement, listRuns, summarise } from "../../../lib/benchmark/results";
import { TASKS, type RagTask } from "../../../lib/benchmark/dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The scoreboard: test-set facts, one summary row per real run (mock runs never appear), and Drex's improvement over the baseline.
// ?task=QA|Summary|Data2txt computes each row's headline and the improvement from that task's numbers.
export async function GET(req?: Request): Promise<Response> {
  try {
    const task = req ? new URL(req.url).searchParams.get("task") : null;
    if (task && !TASKS.includes(task as RagTask)) throw new ApiError(400, "invalid_request", `task must be one of ${TASKS.join(", ")}.`);
    const t = (task ?? undefined) as RagTask | undefined;
    const runs = await listRuns();
    return json({ dataset: await datasetFacts(), runs: runs.map((r) => summarise(r, t)), improvement: improvement(runs, getConfig(), t) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
