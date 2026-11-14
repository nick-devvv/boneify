// Errors that map straight onto the API's error shape: { error: { code, message } }.

/** Remove anything that looks like a secret (API keys, bearer tokens) from text that may reach a client or a log. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(nace_sk_|sk-proj-|sk-ant-|sk-)[A-Za-z0-9_\-]{6,}/g, "[redacted key]")
    .replace(/\b([A-Z][A-Z0-9_]*(KEY|TOKEN|SECRET))=\S+/g, "$1=[redacted]");
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(redact(message));
    this.name = "ApiError";
  }
}

/** A Drex, NDI or LLM call that failed. The message names the provider and says why in plain words. Routes return it as 502 provider_error. */
export class ProviderError extends Error {
  constructor(public provider: string, public status: number | null, message: string, public retryable = false) {
    super(redact(`${provider}: ${message}`));
    this.name = "ProviderError";
  }
}
