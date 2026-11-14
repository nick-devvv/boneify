import { z } from "zod";
import { errorResponse, json, options } from "../../../lib/api";
import { ApiError } from "../../../lib/errors";
import { extractClaims } from "../../../lib/claims";
import { LIMITS } from "../../../lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().optional() });

// The sentence count before checking, from the same extractClaims() the check uses, so the two always agree.
export async function POST(req: Request): Promise<Response> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new ApiError(400, "invalid_request", "The request body is not valid JSON.");
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "invalid_request", "text must be a string.");
    const text = parsed.data.text ?? "";
    if (!text.trim()) throw new ApiError(400, "missing_ai_text", "Paste the AI-written text to split.");
    if (text.length > LIMITS.aiTextChars) throw new ApiError(413, "too_large", `The text is over ${LIMITS.aiTextChars.toLocaleString("en-US")} characters.`);
    const claims = extractClaims(text).map(({ id, text: t, start, end }) => ({ id, text: t, start, end }));
    return json({ count: claims.length, claims });
  } catch (err) {
    return errorResponse(err);
  }
}

export const OPTIONS = options;
