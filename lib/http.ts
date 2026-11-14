// fetch with a timeout, retries and readable errors (docs/MVP_SPEC.md, "Timeouts and retries").
// Retries 408, 409, 425, 429, 500, 502, 503, 504, 529 and network errors up to 3 times (0.5 s, 1 s, 2 s + jitter), honouring Retry-After.

import { ProviderError } from "./errors";

export const RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/** Tunable for tests: base wait before the first retry (doubles each time). */
export const httpSettings = { baseDelayMs: 500, maxRetryAfterMs: 30_000 };

export interface RequestOptions {
  provider: string;            // "Drex" | "NDI" | "LLM" | ...
  timeoutMs: number;
  retries?: number;            // default 3
  fetchImpl?: typeof fetch;
}

const PLAIN: Record<number, string> = {
  400: "the request was rejected as invalid",
  401: "the API key is missing or wrong",
  402: "out of credit",
  403: "the API key is not allowed to do this",
  404: "the endpoint was not found (check the base URL setting)",
  408: "the request timed out on the provider's side",
  409: "the request conflicted with an earlier one",
  413: "the request is too large",
  422: "the request was invalid or too large",
  425: "the provider asked us to retry later",
  429: "too many requests (rate limited)",
  500: "the provider had an internal error",
  502: "the provider's gateway failed",
  503: "the provider is temporarily unavailable",
  504: "the provider's gateway timed out",
  529: "the provider is overloaded or the request took too long",
};

export function describeStatus(status: number): string {
  return PLAIN[status] ?? (status >= 500 ? "the provider had an error" : `the request failed with status ${status}`);
}

/** Pull a short, key-free explanation out of an error body. */
export function errorDetail(body: string): string {
  let msg = body;
  try {
    const j = JSON.parse(body);
    const e = j?.error ?? j?.detail ?? j?.message ?? j;
    msg = typeof e === "string" ? e : e?.message ?? e?.detail ?? (Array.isArray(e) ? e.map((x) => x?.msg ?? x?.message ?? JSON.stringify(x)).join("; ") : JSON.stringify(e));
  } catch {
    /* not JSON */
  }
  msg = String(msg).replace(/(nace_sk_|sk-|sk-or-|Bearer\s+)[A-Za-z0-9_\-.]+/g, "$1***").replace(/\s+/g, " ").trim();
  return msg.length > 240 ? msg.slice(0, 237) + "..." : msg;
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, httpSettings.maxRetryAfterMs);
  const date = Date.parse(h);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), httpSettings.maxRetryAfterMs);
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch that returns only a 2xx Response; anything else becomes a ProviderError after retries. */
export async function request(url: string, init: RequestInit, opts: RequestOptions): Promise<Response> {
  const retries = opts.retries ?? 3;
  const f = opts.fetchImpl ?? fetch;
  let lastErr: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const base = httpSettings.baseDelayMs * 2 ** (attempt - 1);
      await sleep(base + Math.random() * Math.min(250, base / 2));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await f(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const timedOut = ctrl.signal.aborted;
      let host = url;
      try { host = new URL(url).host; } catch { /* keep url */ }
      lastErr = new ProviderError(
        opts.provider,
        null,
        timedOut ? `no response after ${Math.round(opts.timeoutMs / 1000)} s (timed out)` : `could not reach ${host} (${(err as Error)?.message ?? "network error"})`,
        true,
      );
      continue;
    }
    clearTimeout(timer);
    if (res.ok) return res;

    const body = await res.text().catch(() => "");
    const detail = errorDetail(body);
    const retryable = RETRY_STATUSES.has(res.status);
    lastErr = new ProviderError(opts.provider, res.status, `${describeStatus(res.status)} (HTTP ${res.status}${detail ? `: ${detail}` : ""})`, retryable);
    if (!retryable) throw lastErr;
    const wait = retryAfterMs(res);
    if (wait !== null && attempt < retries) await sleep(wait);
  }
  throw lastErr ?? new ProviderError(opts.provider, null, "the request failed");
}

/** request() + JSON parse with a readable error when the body is not JSON. */
export async function requestJson<T = unknown>(url: string, init: RequestInit, opts: RequestOptions): Promise<T> {
  const res = await request(url, init, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(opts.provider, res.status, `the response was not JSON (${errorDetail(text) || "empty body"})`);
  }
}
