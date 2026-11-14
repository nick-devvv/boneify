// Errors that map straight onto the API's error shape: { error: { code, message } }.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** A Drex, NDI or LLM call that failed. The message names the provider and says why in plain words. Routes return it as 502 provider_error. */
export class ProviderError extends Error {
  constructor(public provider: string, public status: number | null, message: string, public retryable = false) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}
