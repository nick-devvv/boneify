import { describe, expect, it } from "vitest";
import { getConfig, isMockNace } from "../lib/config";

describe("getConfig", () => {
  it("uses the spec defaults when nothing is set", () => {
    const c = getConfig({});
    expect(c.decider).toBe("local");
    expect(c.perceiver).toBe("local");
    expect(c.reviewThreshold).toBe(0.6);
    expect(c.naceBaseUrl).toBe("https://console.nace.ai");
    expect(c.drexModel).toBe("drex-latest");
    expect(c.drexPricePerMtok).toBe(0.06);
    expect(c.drexBatchSize).toBe(256);
    expect(c.ndiWaitSeconds).toBe(60);
    expect(c.llmBaseUrl).toBe("https://api.openai.com/v1");
    expect(c.llmModel).toBe("gpt-4o-mini");
    expect(c.llmTemperature).toBe(0);
    expect(c.llmJsonMode).toBe(true);
    expect(c.allowedOrigin).toBe("*");
  });

  it("falls back to OPENAI_API_KEY and clamps limits", () => {
    const c = getConfig({ OPENAI_API_KEY: "sk-x", DREX_BATCH_SIZE: "9999", NDI_WAIT_SECONDS: "0", LLM_TEMPERATURE: "none" });
    expect(c.llmApiKey).toBe("sk-x");
    expect(c.drexBatchSize).toBe(512);
    expect(c.ndiWaitSeconds).toBe(1);
    expect(c.llmTemperature).toBeNull();
  });

  it("strips a trailing /v1 from NACE_BASE_URL and spots the mock host", () => {
    const c = getConfig({ NACE_BASE_URL: "http://localhost:4010/v1/" });
    expect(c.naceBaseUrl).toBe("http://localhost:4010");
    expect(isMockNace(c)).toBe(true);
    expect(isMockNace(getConfig({}))).toBe(false);
  });
});
