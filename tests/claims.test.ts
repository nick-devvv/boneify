import { describe, expect, it } from "vitest";
import { extractClaims } from "../lib/claims";

describe("extractClaims", () => {
  it("numbers claims s1, s2, ... and keeps offsets into the AI text", () => {
    const ai = "The agreement runs for five years. Either party may cancel with 30 days' notice.";
    const claims = extractClaims(ai);
    expect(claims.map((c) => c.id)).toEqual(["s1", "s2"]);
    expect(claims.map((c) => c.index)).toEqual([0, 1]);
    expect(claims[0]).toMatchObject({ start: 0, end: 34, text: "The agreement runs for five years." });
    expect(claims[1]).toMatchObject({ start: 35, end: 80 });
    for (const c of claims) expect(ai.slice(c.start, c.end)).toBe(c.text);
  });

  it("skips fragments under 3 words without leaving gaps in the ids", () => {
    const claims = extractClaims("Overall. The fee is $12,500 per month. Good deal! Notice must be in writing.");
    expect(claims.map((c) => c.text)).toEqual(["The fee is $12,500 per month.", "Notice must be in writing."]);
    expect(claims.map((c) => c.id)).toEqual(["s1", "s2"]);
  });
});
