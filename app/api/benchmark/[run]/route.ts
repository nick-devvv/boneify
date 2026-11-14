import { errorResponse, json, options } from "../../../../lib/api";
import { ApiError } from "../../../../lib/errors";
import { getRun } from "../../../../lib/benchmark/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS = ["QA", "Summary", "Data2txt"];

function intParam(raw: string | null, name: string, def: number, min: number, max: number): number {
  if (raw === null || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new ApiError(400, "invalid_request", `${name} must be a whole number of at least ${min}.`);
  return Math.min(n, max);
}

export async function GET(req: Request, { params }: { params: Promise<{ run: string }> }): Promise<Response> {
  try {
    const { run } = await params;
    const r = await getRun(run);
    const q = new URL(req.url).searchParams;
    const task = q.get("task");
    if (task && !TASKS.includes(task)) throw new ApiError(400, "invalid_request", `task must be one of ${TASKS.join(", ")}.`);
    const onlyMistakes = q.get("onlyMistakes") === "true";
    const offset = intParam(q.get("offset"), "offset", 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(q.get("limit"), "limit", 25, 1, 100);

    let examples = r.examples.filter((e) => !e.error);
    if (task) examples = examples.filter((e) => e.task === task);
    let view = examples.map((e) => ({
      id: e.id,
      task: e.task,
      writerModel: e.writerModel,
      latencyMs: e.latencyMs,
      claims: e.claims.map((c) => ({ id: c.id, text: c.text, gold: c.gold, pred: c.pred, confidence: c.confidence, probabilities: c.probabilities })),
    }));
    if (onlyMistakes) view = view.map((e) => ({ ...e, claims: e.claims.filter((c) => c.gold !== c.pred) })).filter((e) => e.claims.length > 0);

    return json({ run: r.run, label: r.label, metrics: r.metrics, total: view.length, offset, limit, examples: view.slice(offset, offset + limit) });
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
