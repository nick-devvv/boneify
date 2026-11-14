# Decisions

Places where docs/MVP_SPEC.md was unclear or contradicted itself, and the simplest option picked. None of these change the API contract.

1. **`.env.example` ships `DECIDER=local`.** The spec's settings table says tonight is `DECIDER=llm`, but the README quick start says `cp .env.example .env.local` "works as-is with the offline engines". With no `LLM_API_KEY`, `llm` cannot work as-is, so the template defaults to `local` and a comment says to switch to `llm` once the key is in.
2. **`NACE_BASE_URL` is the host, without `/v1`.** Drex is documented at `https://console.nace.ai/v1/systemone` and NDI at base `https://console.nace.ai/v1`. The code appends `/v1/...` itself; a trailing `/v1` in the setting is stripped so either spelling works.
3. **Relative imports, no `@/` alias.** Keeps Next.js, vitest and tsx resolving the same paths with no extra config.
4. **`zod` 3.25.** Its API covers everything the request validation needs and matches what was available to build and test with tonight.
5. **vitest 5 and unpdf 2.** `vitest@4` failed to install (npm peer-resolution crash on `@vitest/browser-playwright@5`), so the project uses the current majors: `vitest@^5.1`, `unpdf@^2.1`, `next@^16.4`. TypeScript stays on 5.9 because Next.js builds against the JavaScript compiler API that TypeScript 7 removed.
6. **`invalid_request` (400) for malformed bodies.** The contract lists example codes; a body that is not JSON, a multipart form that can't be read, or a field of the wrong type returns `400 invalid_request` with the field named. All listed codes are used exactly as specified.
7. **`task` / `question` are also accepted at the top level of the JSON body**, mirroring the multipart fields. `context` wins when both are sent.
8. **Demo contract wording.** The invented MSA's confidentiality clause survives for three years, not five. With "five (5) years" in an unrelated clause, no word-matching engine can tell it from the planted "runs for five years" error; the offline rules baseline must catch every planted number error (spec tests), so the sample avoids that coincidence. Drex and the LLM still face cases like it in RAGTruth.
9. **`ragtruth-real` is RAGTruth test response #1238** (Summary task, mistral-7B-instruct, two human-marked conflicts), picked as a short, neutral news story. It has no PDF (`hasPdf: false`).
10. **RAGTruth sample counts.** `npm run prepare-data` reproduces the spec's sample exactly: 450 answers, 266 sentences marked wrong (123 contradicted, 143 not in source), 171 answers with a span, average source 2,447 characters, max 9,918. The sentence total is 3,041 rather than 3,098 because counts depend on the sentence splitter; the benchmark reports the real number from our splitter.
11. **`full.jsonl` is not committed** (about 10 MB). `npm run prepare-data` writes it for `--full` runs.
12. **Abstain-curve accuracy is three-way accuracy** (exact supported / contradicted / not_in_source match) on the sentences at or above each confidence threshold.
13. **`onlyMistakes=true` keeps only the wrong sentences** inside each returned example (and drops examples with none), matching the spec's example response. Failed answers (`error`) are counted in `metrics.failedExamples` but are not listed in `examples`.
14. **Benchmark progress files** are `data/results/.<name>.partial.json` (git-ignored). The results file itself is only written when a run finishes, so `/api/benchmark` never shows a half-finished run. A 401/402/403 stops the run early (every call would fail), with progress saved for `--resume`.
15. **The `local` baseline is not tuned on the test set.** Its thresholds were set on the demo samples only; tuning against RAGTruth test would grade it against its own answer key.
16. **Checked against the live Nace docs (Nov 14).** The request/response formats in `drex.ts` and `ndi.ts` match console.nace.ai/docs. Three details from the docs are handled: (a) a job still running when `wait_seconds` ends comes back as HTTP 202 and is polled; (b) the upload `metadata` part is a text field, not a file part; (c) zero-retention accounts can't ground on a `parse_result`, so a 4xx there retries once with the `workspace_file` source.
17. **NDI fallbacks cover URL sources too.** The spec names text and file sources; a URL that NDI can't parse also falls back to the built-in reader, with a warning.
18. **Text sources upload to NDI as `.txt`**, whatever their display name (a sample's text is named `msa.pdf`).
19. **NDI cost.** The shape of a job's `cost` is still to confirm (spec "to confirm" list). The code reads a number, or `usd` / `amount` / `total` from an object, and otherwise reports 0 rather than guessing.
20. **LLM output tokens = max(completion_tokens, total_tokens - prompt_tokens).** Gemini's OpenAI endpoint leaves hidden thinking tokens out of `completion_tokens` but bills them as output.
21. **The Gemini row is priced at Google's published paid rate** (Gemini 3.5 Flash: $1.50 / 1M input, $9.00 / 1M output incl. thinking, set via `LLM_PRICE_*`), even though the run used the free tier, so the scoreboard compares list prices, not "$0".

## Front-end numbers additions (spec update on main, Nov 14)

22. **The spec's sentence counts were corrected from 3,098 to 3,041** (by task 933 / 815 / 1,350 → 926 / 812 / 1,303). The old numbers can't be reproduced from the data: 64 close variants of the obvious splitting rules (punctuation + line breaks, minimum 1–4 words, list markers kept or stripped) and `Intl.Segmenter` all miss, the best by 14 sentences. The new numbers are what `extractClaims()` gives on the committed sample, the same counts the benchmark grades on. Every human-label number was already right and is unchanged: 450 answers, 266 wrong (123 contradicted, 143 not in source), wrong by task 44 / 46 / 176, 6 writer models. Scores are unaffected either way: every decider is graded on the same sentences.
23. **`?task=` keeps the same `dataset` object** (it already carries `byTask`). Each run row's `dataset.examples` / `sentences` and `headline` switch to that task.
24. **Headline fields are `null`, never estimated,** when a results file predates per-task latency and cost.
25. **`comparison` appears only when the request sends `compare`.** An unknown `compare` engine is `400 unknown_engine` (like `decider`); a comparison decider that fails gives `comparison: null` plus a warning, and the check still returns 200.
26. **`receipt.section`** is the last clause number found at the start of a line between the start of the receipt's line and its end, so "2. TERM\n2.1 Initial Term. ..." gives "2.1". Matches `2.1`, `§3.2`, `Article 4`, `Section 5`, `Clause 7`, and `3.` (returned as "3").
27. **`POST /api/split`** errors: missing or empty `text` is `400 missing_ai_text`, over 20,000 characters is `413 too_large`. Text with no sentence of 3+ words returns `{ "count": 0, "claims": [] }`.

## Event day (Nov 14)

28. **Adobe PDF Embed highlights.** `receipt.highlight` is `{ page, pageWidth, pageHeight, quadPoints, boundingBox }` in PDF points (origin bottom-left; quadPoints per line in Adobe's order: upper-left, upper-right, lower-left, lower-right), or `null`. `/api/check` adds `adobeDocId` (stable, from the PDF bytes; pass as `metaData.id` to `previewFile`) and `adobeAnnotations` (ready-made highlight annotations in Adobe's schema, coloured green / red / yellow by verdict). Boxes come from the PDF's own text layer (via unpdf), not from NDI's polygons, so they line up whichever reader found the receipt. Short quotes ("$12,500") are found through their surrounding source line, so a text source's one-page numbering can't misplace them. ALL-CAPS heading lines are left out of a box when the quote also covers clause lines. Letter positions use Helvetica widths. A `sampleId` with a PDF gets highlights on that PDF; plain text sources get `null` / `[]`.
29. **NDI second pass with numbers removed.** Sentences NDI doesn't find are asked again with their numbers stripped (`method: "semantic-numbers-ignored"`), so a contradicted sentence ("runs for five years") still gets the clause it contradicts ("three (3)"). Live on msa-summary: both planted number errors now point at §2.1 and §3.1.
30. **A sentence judged correct always shows evidence:** if the perceiver found no receipt for a `supported` sentence, the built-in matcher fills it in (`method: "lexical"`).
31. **NDI classify + extract ("document profile").** With `PERCEIVER=ndi`, `/api/check` also runs NDI Classify (contract / financial report / invoice / policy / article) and NDI Extract (title, parties, effective date, up to 8 key figures, each with its citation) on the same parse, beside ground. Both are optional extras: they never fail a check, and a failure leaves `documentType: null` / `keyFacts: []` plus a warning. The built-in reader always gives `null` / `[]`. One schema serves every kind of document, so there is no second round trip after classify. Live on msa-summary: total time unchanged (about 7.8 s; profile finishes inside ground), 11 cited facts, contract at 0.999. New fields: `documentType: { id, label, confidence, reason } | null`, `keyFacts: [{ field, label, value, status, page, quote, section, confidence, charStart, charEnd, highlight }]`, `usage.profile`.
32. **NDI cost is now read.** The live API sends `cost: { total_usd: "0.0081", lines: [...] }`; the code now reads `total_usd` (it reported $0 before). Ground and profile are counted separately even though they run at the same time. Live on msa-summary: ground about $0.17 (2 jobs), profile about $0.011, Drex decide about $0.0001.
33. **Fix with Intern (`POST /api/fix`).** Same body as `/api/check`. boneify checks the text, [Intern](https://github.com/nace-ai/intern) rewrites only the flagged sentences from their receipts, and boneify checks the rewrite against the same document (read once; classify + extract are not repeated). Intern runs headless (`intern -p --json`) with System 1 = Drex (`drex-latest`, it decides when Intern is advancing, off plan or done) and System 2 = DeepInfra Qwen3.8-27B (it writes). DeepInfra is only Intern's writer: boneify's verdicts always come from the decider. Intern works in a throwaway temp folder with source.txt, draft.txt and issues.md, a turn budget (16), a 150 s timeout, and an environment holding only PATH, HOME, the Nace and DeepInfra keys and proxy settings. Live on msa-summary: trust score 70 → 100 in 36 s (check 8.8 s, Intern 24 s, re-check 3.3 s), 4 Drex decisions inside Intern. Where the `intern` CLI isn't installed (Vercel), the route answers `501 intern_unavailable`, and `/api/health` has `intern.ready` so the site can hide the button. A recorded live response is in `data/fixtures/fix-response.json`. Settings: `INTERN_BIN`, `INTERN_SYSTEM1`, `INTERN_SYSTEM2`, `INTERN_MAX_TURNS`, `INTERN_TIMEOUT_SECONDS`, `DEEPINFRA_API_KEY`.
34. **Time budgets keep every check under Vercel's 120 s limit,** whatever a provider does: reading the source gets 35 s (then the built-in reader), receipts 40 s (then the built-in matcher), the decider 75 s (then `504 provider_timeout`), key facts 15 s from their start (then left out). Each fallback adds a warning. Worst case is about 110 s; a normal check takes 8–12 s.
35. **URL sources reach NDI.** NDI picks its reader from the file name's extension, so a page URL with none (`/wiki/Page`, `example.com`) is sent as `<name>.html`. Sites that block NDI's fetcher still fall back to the built-in reader.
36. **Pre-deploy check (Nov 14, 12:25):** production build (`next start`) with Drex + NDI. All routes were tested: both samples, both PDFs uploaded, plain text, a URL, `compare: "llm"`, `/api/fix` over HTTP (earnings: 75 → 100 in 28 s), every error case and CORS. The live Nace contract tests pass.

### Using the highlights (front end)


Every `/api/check` on a PDF (an upload, or a sample with a PDF) returns `adobeDocId` and `adobeAnnotations`. Each receipt's `highlight` holds its position on the page in PDF points.

```js
const view = adobeDCView.previewFile({ content: { location: { url: pdfUrl } }, metaData: { fileName: "msa.pdf", id: result.adobeDocId } }, { enableAnnotationAPIs: true });
view.then((v) => v.getAnnotationManager()).then((m) => m.addAnnotations(result.adobeAnnotations));
```

### Using the key facts (front end, optional)

`result.documentType?.label` ("Contract") and `result.keyFacts.filter((k) => k.status === "found")` give a "Key facts" panel: `label`, `value`, then `§section · p.page` as the citation. `highlight` has the same shape as a receipt's, so clicking a fact can jump to its box in the Adobe viewer.

### Using "Fix with Intern" (front end, optional)

Show the button only when `health.intern.ready`. `POST /api/fix` takes the same body as `/api/check` and takes about 30–40 s, so show progress ("Intern is fixing 3 sentences…"). It returns:
- `before` and `after`: two full check results. Show the trust score going from `before.summary.trustScore` to `after.summary.trustScore`.
- `changes[]`: `{ before, after, verdict, evidence }`, one per flagged sentence, for a before → after list. `after: null` means Intern removed the sentence.
- `fixedText`: the corrected text, with copy and download.
- `intern`: `system1Asks` (how many decisions Drex made inside Intern), `decisions[]`, `toolCalls[]`, `system2`, `reply`.

Build against `data/fixtures/fix-response.json` without running Intern.
