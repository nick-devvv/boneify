import { describe, expect, it } from "vitest";
import { localPerceiver, detectKind, htmlToText } from "../lib/perceive/local";
import { extractClaims } from "../lib/claims";
import { textToPdf } from "../lib/text/pdf-writer";
import { ApiError } from "../lib/errors";

const enc = (s: string) => new TextEncoder().encode(s);

describe("local perceiver: parse", () => {
  it("reads a multi-page PDF and keeps page offsets", async () => {
    const bytes = await textToPdf([
      "MASTER SERVICES AGREEMENT\nThe initial term is three (3) years.",
      "The monthly fee is $12,500, payable within 30 days.",
    ]);
    const doc = await localPerceiver.parse({ kind: "file", bytes, name: "msa.pdf" });
    expect(doc.format).toBe("pdf");
    expect(doc.parsedBy).toBe("local");
    expect(doc.pages).toHaveLength(2);
    const p2 = doc.text.slice(doc.pages[1].start, doc.pages[1].end);
    expect(p2).toContain("$12,500");
    expect(doc.text.slice(doc.pages[0].start, doc.pages[0].end)).toContain("three (3) years");
  });

  it("reads text, JSON and HTML", async () => {
    const t = await localPerceiver.parse({ kind: "text", text: "  Hello world.  ", name: "a.txt" });
    expect(t).toMatchObject({ text: "Hello world.", format: "text", pages: [{ page: 1, start: 0, end: 12 }] });

    const j = await localPerceiver.parse({ kind: "file", bytes: enc('{"name":"Cafe Uno","stars":4.5}'), name: "biz.json" });
    expect(j.format).toBe("json");
    expect(j.text).toContain('"stars": 4.5');

    const h = await localPerceiver.parse({ kind: "file", bytes: enc("<html><head><title>x</title></head><body><p>Revenue &amp; profit rose.</p><script>evil()</script></body></html>"), name: "p.html" });
    expect(h.text).toBe("Revenue & profit rose.");
  });

  it("rejects unsupported and empty files with the contract's codes", async () => {
    await expect(localPerceiver.parse({ kind: "file", bytes: enc("x"), name: "deck.pptx" })).rejects.toMatchObject({ status: 422, code: "unsupported_file_type" });
    await expect(localPerceiver.parse({ kind: "file", bytes: enc("   "), name: "a.txt" })).rejects.toBeInstanceOf(ApiError);
    await expect(localPerceiver.parse({ kind: "file", bytes: enc("{oops"), name: "a.json" })).rejects.toMatchObject({ code: "unreadable_file" });
    const blankPdf = await textToPdf([""]);
    await expect(localPerceiver.parse({ kind: "file", bytes: blankPdf, name: "scan.pdf" })).rejects.toMatchObject({ code: "empty_source" });
  });

  it("detects types by extension, then by MIME type", () => {
    expect(detectKind("a.PDF")).toBe("pdf");
    expect(detectKind("noext", "application/json")).toBe("json");
    expect(detectKind("noext", "text/plain")).toBe("text");
    expect(detectKind("a.docx")).toBeNull();
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("- One\n\n- Two");
  });
});

describe("local perceiver: ground", () => {
  it("finds the best source sentence with page and offsets, or not_found", async () => {
    const bytes = await textToPdf([
      "MASTER SERVICES AGREEMENT\nThe initial term of this Agreement is three (3) years.",
      "Customer shall pay a monthly fee of $12,500. Invoices are due within 30 days.",
    ]);
    const doc = await localPerceiver.parse({ kind: "file", bytes, name: "msa.pdf" });
    const claims = extractClaims("The monthly fee is $18,500. The agreement runs for five years. The vendor ships free cupcakes on Fridays.");
    const { receipts } = await localPerceiver.ground(doc, claims);

    const fee = receipts.s1;
    expect(fee.status).toBe("found");
    expect(fee.page).toBe(2);
    expect(fee.method).toBe("lexical");
    expect(doc.text.slice(fee.charStart!, fee.charEnd!)).toBe(fee.quote);
    expect(fee.quote).toContain("monthly fee");

    expect(receipts.s2).toMatchObject({ status: "found", page: 1 });
    expect(receipts.s3).toMatchObject({ status: "not_found", page: null, quote: null, charStart: null, charEnd: null, score: null });
  });
});
