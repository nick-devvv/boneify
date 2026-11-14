import { describe, expect, it } from "vitest";
import { splitSentences } from "../lib/text/sentences";

function texts(t: string) {
  const s = splitSentences(t);
  for (const x of s) expect(t.slice(x.start, x.end)).toBe(x.text); // offsets are exact
  return s.map((x) => x.text);
}

describe("splitSentences", () => {
  it("splits plain sentences", () => {
    expect(texts("The term is three years. Fees are due monthly! Is notice required?")).toEqual([
      "The term is three years.",
      "Fees are due monthly!",
      "Is notice required?",
    ]);
  });

  it("does not split on abbreviations", () => {
    expect(texts("Northwind Robotics Inc. reported revenue. Dr. Lee joined the board. The U.S. market grew. See e.g. Exhibit B.")).toEqual([
      "Northwind Robotics Inc. reported revenue.",
      "Dr. Lee joined the board.",
      "The U.S. market grew.",
      "See e.g. Exhibit B.",
    ]);
  });

  it("keeps decimals and amounts together", () => {
    expect(texts("Revenue was $3.5M, up 12.4% from 2025. Margin hit 41.2 percent.")).toEqual([
      "Revenue was $3.5M, up 12.4% from 2025.",
      "Margin hit 41.2 percent.",
    ]);
  });

  it("splits list items and strips their markers", () => {
    const t = "Key terms:\n- Term of three years\n- Fee of $12,500 per month\n1. Notice by email\n2) Venue in Delaware";
    expect(texts(t)).toEqual(["Key terms:", "Term of three years", "Fee of $12,500 per month", "Notice by email", "Venue in Delaware"]);
  });

  it("splits on paragraph breaks and joins wrapped lines", () => {
    const t = "The agreement starts on March 1\nand runs for three years\n\nPayment is due within 30 days";
    expect(texts(t)).toEqual(["The agreement starts on March 1\nand runs for three years", "Payment is due within 30 days"]);
  });

  it("treats all-caps headings as their own block", () => {
    expect(texts("MASTER SERVICES AGREEMENT\nThis agreement is made today.")).toEqual([
      "MASTER SERVICES AGREEMENT",
      "This agreement is made today.",
    ]);
  });

  it("handles closing quotes and leading whitespace", () => {
    const t = '  He said "it is final." Then he left.  ';
    expect(texts(t)).toEqual(['He said "it is final."', "Then he left."]);
  });

  it("returns nothing for empty text", () => {
    expect(splitSentences("   \n\n ")).toEqual([]);
  });
});
