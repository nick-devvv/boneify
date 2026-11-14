import { errorJson, errorResponse, json, options } from "../../../lib/api";
import { readCheckInput } from "../../../lib/check-input";
import { checkDocument, LIMITS } from "../../../lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > LIMITS.fileBytes + 512 * 1024) return errorJson(413, "too_large", "The request is over 4 MB.");
    return json(await checkDocument(await readCheckInput(req)));
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
