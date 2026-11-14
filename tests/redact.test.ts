import { describe, expect, it } from "vitest";
import { redact, ProviderError } from "../lib/errors";

describe("redact", () => {
  it("removes API keys, bearer tokens and NAME=secret pairs", () => {
    const leaked = 'Headers.append: "Bearer nace_sk_ABCDEFGHIJKLMNOP\nLLM_API_KEY=sk-proj-abcdefghijklmnop" is an invalid header value.';
    const out = redact(leaked);
    expect(out).not.toMatch(/nace_sk_ABC/);
    expect(out).not.toMatch(/sk-proj-abc/);
    expect(out).toContain("[redacted");
  });
  it("leaves ordinary messages alone", () => {
    expect(redact("could not reach console.nace.ai (timed out)")).toBe("could not reach console.nace.ai (timed out)");
  });
  it("is applied to provider errors", () => {
    const e = new ProviderError("Drex", null, "could not reach x (Bearer nace_sk_SECRETSECRET)");
    expect(e.message).not.toContain("SECRETSECRET");
  });
});
