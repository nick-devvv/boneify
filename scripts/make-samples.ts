// Generates the demo samples in data/samples/ (JSON + PDF from the same text, so they always say exactly the same thing).
// Run once and commit the output:  npx tsx scripts/make-samples.ts [--ragtruth-dir <folder with response.jsonl + source_info.jsonl>]
// All companies and people in msa-summary and earnings-memo are invented. ragtruth-real is real RAGTruth test data (MIT).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { textToPdf } from "../lib/text/pdf-writer";
import type { Sample } from "../lib/samples";

const OUT = path.join(process.cwd(), "data", "samples");
const RAGTRUTH_RAW = "https://raw.githubusercontent.com/ParticleMedia/RAGTruth/main/dataset";
const RAGTRUTH_ID = "1238"; // test split, Summary task, two human-marked conflicts

// ---------------------------------------------------------------- msa-summary (3 pages)

const MSA_PAGES = [
  `MASTER SERVICES AGREEMENT

This Master Services Agreement (the "Agreement") is entered into as of March 1, 2026 (the "Effective Date") by and between Harbor Analytics LLC, a Delaware limited liability company ("Provider"), and Juniper Freight Co., an Oregon corporation ("Customer").

1. SERVICES
1.1 Scope. Provider will deliver route-optimization analytics, a hosted reporting dashboard and quarterly planning workshops as described in Statement of Work No. 1.
1.2 Service Levels. Provider will keep the dashboard available at least 99.5% of each calendar month, excluding scheduled maintenance announced 48 hours in advance.

2. TERM
2.1 Initial Term. The initial term of this Agreement is three (3) years from the Effective Date.
2.2 Renewal. After the initial term, this Agreement renews automatically for successive one (1) year periods unless either party gives written notice of non-renewal at least ninety (90) days before the end of the then-current term.`,

  `3. FEES AND PAYMENT
3.1 Fees. Customer shall pay Provider a monthly service fee of $12,500.
3.2 Invoices. Provider will invoice Customer monthly in arrears. Invoices are payable within thirty (30) days of receipt.
3.3 Late Payment. Undisputed amounts not paid when due accrue interest at 1% per month.
3.4 Price Changes. Provider may increase the monthly service fee once per year, by no more than 4%, with sixty (60) days' written notice.

4. CONFIDENTIALITY
4.1 Each party will protect the other party's Confidential Information with at least reasonable care and will use it only to perform this Agreement.
4.2 These obligations survive for three (3) years after this Agreement ends.

5. DATA
5.1 Customer owns all shipment data it provides. Provider may use aggregated, anonymized data only to improve its services.`,

  `6. TERMINATION
6.1 Termination for Cause. Either party may terminate this Agreement if the other party materially breaches it and does not cure the breach within thirty (30) days after written notice.
6.2 Effect of Termination. On termination, Customer will pay all fees due through the termination date, and Provider will return or delete Customer data within forty-five (45) days.

7. LIABILITY
7.1 Cap. Except for breaches of Section 4, each party's total liability under this Agreement is limited to the fees paid by Customer in the twelve (12) months before the claim.

8. GENERAL
8.1 Governing Law. This Agreement is governed by the laws of the State of Delaware.
8.2 Notices. Notices must be in writing and sent to the addresses on the signature page.

Signed by Dana Whitfield, Chief Executive Officer, Harbor Analytics LLC, and Luis Ortega, Chief Operating Officer, Juniper Freight Co.`,
];

const MSA_AI = [
  "This Master Services Agreement between Harbor Analytics LLC and Juniper Freight Co. took effect on March 1, 2026.",
  "Harbor Analytics provides route-optimization analytics, a hosted reporting dashboard and quarterly planning workshops.",
  "The dashboard must be available at least 99.5% of each month, excluding announced maintenance.",
  "The agreement runs for five years.",
  "After that, it renews automatically for one-year periods unless either party gives 90 days' notice.",
  "Juniper Freight pays a monthly service fee of $18,500.",
  "Invoices are payable within 30 days, and late amounts accrue interest at 1% per month.",
  "Either party may terminate for convenience on 30 days' notice.",
  "Each party's liability is capped at the fees paid in the twelve months before the claim.",
  "The agreement is governed by Delaware law.",
].join(" ");

// ---------------------------------------------------------------- earnings-memo (2 pages)

const EARNINGS_PAGES = [
  `NORTHWIND ROBOTICS REPORTS THIRD QUARTER 2026 RESULTS

PITTSBURGH, November 5, 2026 - Northwind Robotics, Inc., a maker of autonomous mobile robots for warehouses, today reported financial results for the third quarter ended September 30, 2026.

Third quarter highlights
- Revenue was $42.8 million, up 18% from $36.3 million in the third quarter of 2025.
- Gross margin was 41.2%, compared with 37.9% a year earlier.
- Net loss narrowed to $3.1 million, from a net loss of $7.4 million a year earlier.
- The company shipped 1,240 robots, a record for a single quarter.
- Recurring software revenue grew 31% to $11.6 million.

"Customers are moving from pilots to full-site rollouts," said Maya Okafor, Chief Executive Officer of Northwind Robotics. "Our software attach rate keeps rising, and that is lifting our margins."`,

  `Balance sheet
Northwind ended the quarter with $96.4 million in cash and short-term investments and no debt.

Outlook
For the fourth quarter of 2026, Northwind expects revenue between $45 million and $47 million and expects to reach positive operating cash flow in the first half of 2027.

Management
Chief Financial Officer Ben Adeyemi will present the results at the Midwest Industrial Technology Conference on November 18, 2026.

About Northwind Robotics
Northwind Robotics designs autonomous mobile robots and fleet software for distribution centers. The company is headquartered in Pittsburgh, Pennsylvania and employs about 820 people.`,
];

const EARNINGS_AI = [
  "Northwind Robotics reported third quarter 2026 revenue of $48.2 million, up 18% from a year earlier.",
  "Gross margin improved to 41.2% from 37.9%.",
  "The net loss narrowed to $3.1 million from $7.4 million.",
  "The company shipped a record 1,240 robots in the quarter.",
  "Recurring software revenue grew 31% to $11.6 million.",
  "Northwind ended the quarter with $96.4 million in cash and short-term investments and no debt.",
  "Management guided fourth quarter revenue to between $45 million and $47 million.",
  "On the call, the CEO announced she will step down at the end of the year.",
].join(" ");

// ---------------------------------------------------------------- ragtruth-real

interface RagResponse { id: string; source_id: string; model: string; response: string; labels: Array<{ start: number; end: number; text: string; meta: string; label_type: string }> }
interface RagSource { source_id: string; task_type: string; source_info: string }

async function readJsonl<T>(dir: string | undefined, file: string, match: (x: T) => boolean): Promise<T> {
  const text = dir ? await readFile(path.join(dir, file), "utf8") : await (await fetch(`${RAGTRUTH_RAW}/${file}`)).text();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const x = JSON.parse(line) as T;
    if (match(x)) return x;
  }
  throw new Error(`Not found in ${file}`);
}

async function ragtruthSample(dir?: string): Promise<Sample> {
  const r = await readJsonl<RagResponse>(dir, "response.jsonl", (x) => x.id === RAGTRUTH_ID);
  const s = await readJsonl<RagSource>(dir, "source_info.jsonl", (x) => x.source_id === r.source_id);
  const { splitSentences } = await import("../lib/text/sentences");
  const sentences = splitSentences(r.response);
  const planted = r.labels.map((l) => {
    const sent = sentences.find((x) => x.start < l.end && l.start < x.end);
    const conflict = /conflict/i.test(l.label_type);
    return {
      sentence: sent?.text ?? l.text,
      expected: (conflict ? "contradicted" : "not_in_source") as "contradicted" | "not_in_source",
      why: `RAGTruth human label (${l.label_type}): ${l.meta.split("\n").slice(1).join(" ").trim()}`,
    };
  });
  return {
    id: "ragtruth-real",
    title: "Real RAGTruth news summary",
    description: `A real AI summary (${r.model}) of a news article from the RAGTruth test set, with the human-marked errors unchanged`,
    sourceName: "article.txt",
    sourceText: s.source_info,
    aiText: r.response,
    context: { task: "Summarize the following news within 116 words" },
    plantedErrors: planted,
  };
}

// ---------------------------------------------------------------- write

async function main() {
  const dirFlag = process.argv.indexOf("--ragtruth-dir");
  const ragDir = dirFlag > 0 ? process.argv[dirFlag + 1] : undefined;
  await mkdir(OUT, { recursive: true });

  const samples: Array<{ sample: Sample; pages?: string[] }> = [
    {
      pages: MSA_PAGES,
      sample: {
        id: "msa-summary",
        title: "Services contract summary",
        description: "AI summary of a 3-page MSA with 3 planted errors",
        sourceName: "msa.pdf",
        pdfFile: "msa.pdf",
        sourceText: MSA_PAGES.join("\n\n"),
        aiText: MSA_AI,
        context: { task: "Summarize the contract for a partner" },
        plantedErrors: [
          { sentence: "The agreement runs for five years.", expected: "contradicted", why: "Section 2.1: the initial term is three (3) years" },
          { sentence: "Juniper Freight pays a monthly service fee of $18,500.", expected: "contradicted", why: "Section 3.1: the monthly service fee is $12,500" },
          { sentence: "Either party may terminate for convenience on 30 days' notice.", expected: "not_in_source", why: "Section 6.1 only allows termination for cause; the contract never mentions termination for convenience" },
        ],
      },
    },
    {
      pages: EARNINGS_PAGES,
      sample: {
        id: "earnings-memo",
        title: "Earnings release analyst memo",
        description: "AI analyst memo on a 2-page quarterly results release with 2 planted errors",
        sourceName: "earnings.pdf",
        pdfFile: "earnings.pdf",
        sourceText: EARNINGS_PAGES.join("\n\n"),
        aiText: EARNINGS_AI,
        context: { task: "Write a short analyst memo on the quarterly results" },
        plantedErrors: [
          { sentence: "Northwind Robotics reported third quarter 2026 revenue of $48.2 million, up 18% from a year earlier.", expected: "contradicted", why: "The release says revenue was $42.8 million (digits swapped)" },
          { sentence: "On the call, the CEO announced she will step down at the end of the year.", expected: "not_in_source", why: "The release never mentions the CEO stepping down" },
        ],
      },
    },
    { sample: await ragtruthSample(ragDir) },
  ];

  for (const { sample, pages } of samples) {
    await writeFile(path.join(OUT, `${sample.id}.json`), JSON.stringify(sample, null, 2) + "\n");
    if (pages && sample.pdfFile) await writeFile(path.join(OUT, sample.pdfFile), await textToPdf(pages, { title: sample.title }));
    console.log(`wrote ${sample.id}${sample.pdfFile ? ` + ${sample.pdfFile}` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
