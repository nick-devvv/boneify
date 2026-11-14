// The only file that reads environment variables (docs/MVP_SPEC.md, "Settings").
// Read on every call, so tests and scripts can change process.env between calls.

export interface Config {
  decider: string;
  perceiver: string;
  reviewThreshold: number;

  naceApiKey: string;
  naceBaseUrl: string;
  drexModel: string;
  drexPricePerMtok: number;
  drexBatchSize: number;
  ndiWaitSeconds: number;

  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmLabel: string;
  llmPriceInputPerMtok: number;
  llmPriceOutputPerMtok: number;
  llmTemperature: number | null; // null = leave it out of the request
  llmJsonMode: boolean;

  drexRun: string;
  baselineRun: string; // "" = the first llm-* run

  allowedOrigin: string;
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function num(env: Env, key: string, fallback: number, min?: number, max?: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let out = n;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

export function getConfig(env: Env = process.env): Config {
  const temp = str(env, "LLM_TEMPERATURE", "0");
  return {
    decider: str(env, "DECIDER", "local").toLowerCase(),
    perceiver: str(env, "PERCEIVER", "local").toLowerCase(),
    reviewThreshold: num(env, "REVIEW_THRESHOLD", 0.6, 0, 1),

    naceApiKey: str(env, "NACE_API_KEY", ""),
    naceBaseUrl: str(env, "NACE_BASE_URL", "https://console.nace.ai").replace(/\/+$/, "").replace(/\/v1$/, ""),
    drexModel: str(env, "DREX_MODEL", "drex-latest"),
    drexPricePerMtok: num(env, "DREX_PRICE_PER_MTOK", 0.06, 0),
    drexBatchSize: Math.round(num(env, "DREX_BATCH_SIZE", 256, 1, 512)),
    ndiWaitSeconds: Math.round(num(env, "NDI_WAIT_SECONDS", 60, 1, 100)),

    llmApiKey: str(env, "LLM_API_KEY", str(env, "OPENAI_API_KEY", "")),
    llmBaseUrl: str(env, "LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, ""),
    llmModel: str(env, "LLM_MODEL", "gpt-4o-mini"),
    llmLabel: str(env, "LLM_LABEL", "Frontier LLM"),
    llmPriceInputPerMtok: num(env, "LLM_PRICE_INPUT_PER_MTOK", 0, 0),
    llmPriceOutputPerMtok: num(env, "LLM_PRICE_OUTPUT_PER_MTOK", 0, 0),
    llmTemperature: temp.toLowerCase() === "none" ? null : num(env, "LLM_TEMPERATURE", 0, 0, 2),
    llmJsonMode: str(env, "LLM_JSON_MODE", "on").toLowerCase() !== "off",

    drexRun: str(env, "DREX_RUN", "drex"),
    baselineRun: str(env, "BASELINE_RUN", ""),

    allowedOrigin: str(env, "ALLOWED_ORIGIN", "*"),
  };
}

/** True when the Nace host is a local mock server (results from it never reach the scoreboard). */
export function isMockNace(cfg: Config = getConfig()): boolean {
  try {
    const host = new URL(cfg.naceBaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

export const VERSION = "0.1.0";
