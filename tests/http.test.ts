import { beforeAll, describe, expect, it } from "vitest";
import { httpSettings, request } from "../lib/http";
import { ProviderError } from "../lib/errors";

beforeAll(() => {
  httpSettings.baseDelayMs = 1;
});

function fakeFetch(responses: Array<() => Response | Promise<Response>>) {
  let i = 0;
  const calls: number[] = [];
  const f = (async () => {
    calls.push(i);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return r();
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("request()", () => {
  it("retries 429/529 and returns the first success", async () => {
    const { f, calls } = fakeFetch([
      () => new Response("busy", { status: 529 }),
      () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      () => new Response('{"ok":true}', { status: 200 }),
    ]);
    const res = await request("https://x.test/v1", { method: "POST" }, { provider: "Drex", timeoutMs: 1000, fetchImpl: f });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("does not retry a 401 and explains it in plain words", async () => {
    const { f, calls } = fakeFetch([() => new Response('{"error":{"message":"bad key nace_sk_abc123"}}', { status: 401 })]);
    const err = await request("https://x.test", {}, { provider: "Drex", timeoutMs: 1000, fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("Drex: the API key is missing or wrong");
    expect(err.message).not.toContain("abc123"); // keys never echo back
    expect(calls).toHaveLength(1);
  });

  it("gives up after 3 retries", async () => {
    const { f, calls } = fakeFetch([() => new Response("down", { status: 503 })]);
    await expect(request("https://x.test", {}, { provider: "NDI", timeoutMs: 1000, fetchImpl: f })).rejects.toThrow(/NDI: the provider is temporarily unavailable/);
    expect(calls).toHaveLength(4);
  });

  it("turns a timeout into a readable error", async () => {
    const hang = ((_: unknown, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    await expect(request("https://x.test", {}, { provider: "LLM", timeoutMs: 20, retries: 0, fetchImpl: hang })).rejects.toThrow(/LLM: no response after 0 s \(timed out\)/);
  });
});
