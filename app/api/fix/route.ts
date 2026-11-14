// POST /api/fix: check, let Intern rewrite the flagged sentences from their receipts, check again. Same body as /api/check.
// Needs the Intern CLI where the server runs (a laptop running `npm run dev`); elsewhere it answers 501 intern_unavailable.

import { errorJson, errorResponse, json, options } from "../../../lib/api";
import { readCheckInput } from "../../../lib/check-input";
import { fixDocument } from "../../../lib/fix/fix";
import { LIMITS } from "../../../lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // only enforced on Vercel, where the route answers 501 at once; local runs take ~30-40 s

export async function POST(req: Request): Promise<Response> {
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > LIMITS.fileBytes + 512 * 1024) return errorJson(413, "too_large", "The request is over 4 MB.");
    return json(await fixDocument(await readCheckInput(req)));
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
