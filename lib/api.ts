// Shared route helpers: CORS on every response, OPTIONS, and the one error shape { error: { code, message } }.

import { getConfig } from "./config";
import { ApiError, ProviderError, redact } from "./errors";

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getConfig().allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(), ...extra },
  });
}

export function errorJson(status: number, code: string, message: string): Response {
  return json({ error: { code, message: redact(message) } }, status);
}

/** Map anything thrown into the contract's error shape. Never leaks keys or document text. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) return errorJson(err.status, err.code, err.message);
  if (err instanceof ProviderError) return errorJson(502, "provider_error", err.message);
  console.error("[boneify] unexpected error:", err instanceof Error ? `${err.name}: ${err.message}` : "non-error thrown");
  return errorJson(500, "internal_error", "Something went wrong on our side. Try again.");
}

export function options(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
