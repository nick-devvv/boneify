// Adobe PDF Embed highlights: receipt quotes located on the PDF page in PDF points, and ready-made annotations.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { adobeAnnotations, adobeDocId, highlightFor, pdfLayout, VERDICT_COLOR } from "../lib/pdf/highlight";
import * as check from "../app/api/check/route";

const msa = async () => new Uint8Array(await readFile("data/samples/msa.pdf"));
const post = (body: unknown) => check.POST(new Request("http://localhost/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("highlightFor", () => {
  it("boxes a whole clause line on the right page, in PDF points", async () => {
    const layout = await pdfLayout(await msa());
    const h = highlightFor(layout, "3.1 Fees. Customer shall pay Provider a monthly service fee of $12,500.", 2)!;
    expect(h).toMatchObject({ page: 2, pageWidth: 612, pageHeight: 792 });
    expect(h.quadPoints).toHaveLength(8); // one line
    const [x0, yTop, x1, , , yBottom] = h.quadPoints;
    expect(x0).toBeCloseTo(56, 0);
    expect(x1).toBeGreaterThan(380);
    expect(yTop).toBeGreaterThan(yBottom); // upper-left before lower-left
    expect(h.boundingBox).toEqual([x0, yBottom, x1, yTop]);
  });

  it("pins a short quote inside its line, even when the reader's page numbers differ", async () => {
    const layout = await pdfLayout(await msa());
    // "$12,500" alone, with the page hint wrong (text sources are one page) but the line as context
    const h = highlightFor(layout, "$12,500", 1, "3.1 Fees. Customer shall pay Provider a monthly service fee of $12,500.")!;
    expect(h.page).toBe(2);
    const [x0, , x1] = h.quadPoints;
    expect(x1 - x0).toBeLessThan(60); // just the amount, not the line
    expect(x0).toBeGreaterThan(300);
  });

  it("spans several lines with one quad per line, skips ALL-CAPS headings, and finds nothing for text that isn't there", async () => {
    const layout = await pdfLayout(await msa());
    const multi = highlightFor(layout, "FEES AND PAYMENT 3.1 Fees. Customer shall pay Provider a monthly service fee of $12,500.", 2)!;
    expect(multi.quadPoints).toHaveLength(8); // heading line dropped
    const two = highlightFor(layout, "6.1 Termination for Cause. Either party may terminate this Agreement if the other party materially breaches it and does not cure the breach", 3)!;
    expect(two.quadPoints).toHaveLength(16);
    expect(highlightFor(layout, "The vendor ships free cupcakes every Friday afternoon.", null)).toBeNull();
    expect(highlightFor(layout, null, 1)).toBeNull();
  });
});

describe("Adobe annotations", () => {
  it("one highlight per boxed claim, in Adobe's schema, coloured by verdict and bound to the document id", async () => {
    const bytes = await msa();
    const id = adobeDocId(bytes);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(adobeDocId(bytes)).toBe(id); // stable
    const h = { page: 2, pageWidth: 612, pageHeight: 792, quadPoints: [1, 2, 3, 2, 1, 0, 3, 0], boundingBox: [1, 0, 3, 2] as [number, number, number, number] };
    const claim = { id: "s1", index: 0, text: "The fee is $18,500.", start: 0, end: 19, verdict: "contradicted" as const, probabilities: { supported: 0, contradicted: 0.97, not_in_source: 0.03 }, confidence: 0.97, needsReview: false,
      receipt: { status: "found" as const, page: 2, quote: "$12,500", charStart: 0, charEnd: 7, method: "semantic", score: 1, section: "3.1", highlight: h } };
    const [a] = adobeAnnotations(id, [claim, { ...claim, id: "s2", receipt: { ...claim.receipt, highlight: null } }], "2026-11-14T00:00:00Z") as any[];
    expect(a).toMatchObject({
      "@context": ["https://www.w3.org/ns/anno.jsonld", "https://comments.acrobat.com/ns/anno.jsonld"],
      type: "Annotation", motivation: "commenting", bodyValue: "Wrong (97%): The fee is $18,500.",
      target: { source: id, selector: { type: "AdobeAnnoSelector", subtype: "highlight", node: { index: 1 }, quadPoints: h.quadPoints, boundingBox: h.boundingBox, strokeColor: VERDICT_COLOR.contradicted } },
      creator: { type: "Person", name: "boneify" }, created: "2026-11-14T00:00:00Z",
    });
  });
});

describe("/api/check returns highlights", () => {
  it("for a sample with a PDF: adobeDocId, a highlight per found receipt, and matching annotations", async () => {
    const r = await (await post({ sampleId: "msa-summary" })).json();
    expect(r.adobeDocId).toBe(adobeDocId(await msa()));
    const boxed = r.claims.filter((c: any) => c.receipt.highlight);
    expect(boxed.length).toBeGreaterThanOrEqual(8);
    expect(r.adobeAnnotations).toHaveLength(boxed.length);
    for (const c of r.claims) expect(c.receipt).toHaveProperty("highlight");
  });

  it("for an uploaded PDF too, and null / [] for plain text", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([await msa()], { type: "application/pdf" }), "msa.pdf");
    fd.append("aiText", "Customer shall pay a monthly service fee of $12,500.");
    const r = await (await check.POST(new Request("http://localhost/api/check", { method: "POST", body: fd }))).json();
    expect(r.claims[0].receipt.highlight).toMatchObject({ page: 2 });
    expect(r.adobeAnnotations).toHaveLength(1);
    const t = await (await post({ sourceText: "The fee is $12,500 per month.", aiText: "The fee is $12,500 per month." })).json();
    expect(t.adobeDocId).toBeNull();
    expect(t.adobeAnnotations).toEqual([]);
    expect(t.claims[0].receipt.highlight).toBeNull();
  });
});
