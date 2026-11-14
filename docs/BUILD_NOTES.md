# boneify: build notes for event day

The spec ([MVP_SPEC.md](MVP_SPEC.md)) says *what* to build. This file says *how to rebuild it fast*: the order, the exact versions and commands, what needs a key, and every gotcha already hit and solved the night before. Hand both files to whoever (or whatever) is building, and follow this runbook top to bottom.

A complete reference build exists at commit `db30aa4` on `nick-devvv/receipts-mvp` (102 offline tests, build passing). Choices made where the spec was unclear are in [DECISIONS.md](DECISIONS.md).

## Event-day timeline (build 11:00, hard deadline 15:00)

| Time | What | Done when |
| --- | --- | --- |
| 11:00 | Scaffold + install (section 1) | `npm test` and `npm run build` run |
| 11:15 | Steps 2–6: splitter, local perceiver, local decider, pipeline + `/api/check` + `/api/health`, samples | `curl` on `{"sampleId":"msa-summary"}` returns 10 claims |
| 11:45 | Paste the **Nace key**. Steps 10–11: mock server, `drex.ts`, `ndi.ts`, `npm run test:live` against the **real** API | live contract tests pass |
| 12:15 | Step 7 + OpenAI key: LLM decider, **pilot** 20 answers, then start the full `llm` benchmark in the background | pilot cost known; full run started |
| 12:30 | Lunch. Benchmark keeps running |  |
| 13:00 | Steps 8–9: start the full **Drex** benchmark | `data/results/drex.json` |
| 13:30 | Spec additions (dataset / improvement / compare / section / split), fixtures | `/api/benchmark` shows `improvement` |
| 14:15 | README, commit results, rehearse the demo | |
| 14:45 | Buffer. **Submit by 15:00.** | |

Do the risky, key-dependent things (live Nace calls, both benchmark runs) early, because they run in the background while you build the rest.

## 1. Setup: versions that actually install

```bash
npm install next@^16.4 react@^19.2 react-dom@^19.2 unpdf@^2.1 zod@^3.25.76
npm install -D vitest@^5.1 typescript@^5.9 tsx@^4.20 @types/node@^22 @types/react@^19 pdf-lib@^1.17
```

- **`vitest@4` crashes npm's installer** ("Cannot read properties of null (reading 'edgesOut')") because of a peer mismatch. Use vitest 5.
- **TypeScript stays on 5.9.** Next.js builds against the JS compiler API that TypeScript 7 removed.
- `next build` fails with "Couldn't find any `pages` or `app` directory" until the first route exists. That's expected at scaffold time.
- `next dev` writes an `AGENTS.md` telling agents to read `node_modules/next/dist/docs/`. In Next 16 route `params` is a **Promise**: `{ params }: { params: Promise<{ id: string }> }`, then `await params`.
- Use relative imports (no `@/` alias), so Next, vitest and tsx resolve the same paths.
- Scripts run under `tsx`, which doesn't load `.env.local`. Add a tiny loader (`scripts/_env.ts`) imported first by every script.

## 2. Keys and settings

| Key | When | Where |
| --- | --- | --- |
| `NACE_API_KEY` (`nace_sk_...`) | at the event | `.env.local` only |
| `OPENAI_API_KEY` / `LLM_API_KEY` | morning | `.env.local` only |

```bash
DECIDER=drex
PERCEIVER=ndi
NACE_BASE_URL=https://console.nace.ai
NACE_API_KEY=nace_sk_...
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-6.1-sol            # check the exact id in the OpenAI dashboard
LLM_LABEL=GPT-6.1 Sol
LLM_PRICE_INPUT_PER_MTOK=2       # confirm on OpenAI's pricing page; OpenAI does not report cost per call
LLM_PRICE_OUTPUT_PER_MTOK=10
```

- **Gemini's free tier is useless for the benchmark:** 20 requests per model per day (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`); the run needs about 450. `gemini-flash-latest` was also returning 503/502 under load at night; `gemini-3.5-flash` worked in about 5 s.
- **Count hidden thinking tokens.** Some OpenAI-compatible hosts leave reasoning tokens out of `completion_tokens` but bill them. Use `output = max(completion_tokens, total_tokens - prompt_tokens)`.
- Never put a real key in code, tests, fixtures or logs. `/api/health` only says `ready: true/false`.

## 3. Nace API: verified against console.nace.ai/docs (Nov 14)

**Drex** `POST /v1/systemone`, `Authorization: Bearer nace_sk_...`
- Body: `{ model, state, questions }`. `state` may be a string or any JSON; `questions` is an object keyed by id, 1 to 512 entries.
- Choice question: `{ "type": "choice", "instructions": "...", "criteria": { "supported": "...", "contradicted": "...", "not_in_source": "..." } }`.
- Answer: `answers[id] = { type: "choice", choice, confidence, probabilities: { label: p } }`. A `noul` answer is `{ type: "noul", noul: <P(yes)>, confidence }`.
- Also: `model` (`drex-latest` resolves to `drex-max-v1.1`), `usage.input_tokens`, `usage.output_tokens`, `evaluation_time_ms`, `request_id`. Only input tokens are billed.
- Errors: 401 key, 402 credit, 422 invalid (unknown model → issue path `model`), 429 / 500 / 503 / 529 retry. Body max 4 MiB, text only.

**NDI** (same key)
- `POST /v1/documents/upload-grants` `{ path, ttl_seconds (≤3600), total_size_bytes }` → `{ workspace_id, upload_url, token, expires_at, max_bytes }`. **A grant works once**, so don't retry the upload on the same grant.
- `POST <upload_url>` with header `X-Upload-Token` and multipart `file` + `metadata`. **`metadata` must be a text field holding JSON** `{"path": ...}`; as a Blob/file part it's a 422. The answer is a job with `result.file.{workspace_id, file_id}`.
- Paths must be unique (`on_conflict: reject`), so use `receipts/<timestamp>-<random>-<name>`.
- `POST /v1/documents/parse?wait_seconds=60` `{ source: { type: "workspace_file", workspace_id, file_id }, output: { formats: ["text", "markdown", "blocks"] } }`. `wait_seconds` is 1 to 100.
- **A job still running when the wait ends comes back as HTTP 202.** Poll `GET /v1/documents/jobs/{id}`: 1 s backing off to 10 s, cap 240 s. Status is one of `queued | running | succeeded | failed | cancelled`.
- Parse result: `result.document.{ text, markdown, page_count, blocks[] }`. Each block has `location.kind` (`page_region` with a 1-based `page` for PDFs). The result also has `lane`.
- `POST /v1/documents/ground?wait_seconds=60` `{ source: { type: "parse_result", job_id }, targets: [{ id, text, semantic: true }], options: { max_matches: 1 } }`. 1 to 30 targets per request.
- Ground result: `result.targets[] = { id, status: found|not_found|failed, matches[]: { rank, matched_text, match_method, confidence, location, cropped_image_url } }`. `char_start` / `char_end` exist only for `text_span` locations (text and HTML sources).
- **Zero-retention accounts can't ground on a `parse_result`.** On a 4xx there, retry once with the `workspace_file` source.
- Still to confirm on the first live call: which block field holds text (read `text`, then `markdown`, then `content`), the shape of a job's `cost`, and the real `drex-latest` price.

## 4. Gotchas already solved

- **Upload text sources to NDI as `.txt`.** A sample's text is named `msa.pdf`; uploading it with a PDF type makes NDI's parse fail.
- **Sentence splitter:** don't split on `Inc.`, `Dr.`, `U.S.`, `e.g.`, `No.` or initials. Never split inside `$3.5M` (a period needs whitespace after it). Strip list markers (`-`, `1.`, `2)`). Treat ALL-CAPS headings and paragraph breaks as boundaries, and join wrapped lines. Test: `text.slice(start, end) === sentence` for every sentence.
- **Offline (local) decider and matcher:**
  - Check each number in a claim against the clause its *own surrounding words* point to (5 words either side, numbers removed, top 2 clauses), not the whole document. Otherwise "five years" passes because "five (5) years" appears in an unrelated clause.
  - Find clauses with numbers removed from the query, so the wrong number can't steer the search.
  - Merge heading-sized units (fewer than 4 content words, ignoring numbers) into the next clause. "6.2 Effect of Termination." must not outrank real sentences.
  - "No. 1" is not a negation. Read "forty-five" as 45, not 40 and 5. Strip possessives ("Pingan's" → "pingan"). Use light stemming (effective/effect, payable/pay).
  - Ignore numbers when matching receipts, so a wrong number still points at the right clause.
  - Don't tune it on the RAGTruth test set. Its honest baseline is **sentence F1 0.254** (P 0.150, R 0.846).
- **Benchmark runner:** serialise progress saves, or concurrent workers race on the temp file (ENOENT on rename). Stop the run on 401/402/403 (every call would fail), keep progress, and use `--resume`.
- **Mock numbers never reach the scoreboard:** refuse Drex runs against localhost without `--allow-mock`, save those as `*-mock.json` (git-ignored), and hide them in the API.

## 5. Numbers to expect

| Thing | Value |
| --- | --- |
| RAGTruth sample | 450 answers (150 per task, seed 2026), 3,041 sentences with our splitter, 266 wrong (123 contradicted, 143 not in source), 171 answers with a span, 6 writer models |
| By task (sentences / wrong) | QA 926 / 44 · Summary 812 / 46 · Data2txt 1,303 / 176 |
| LLM benchmark size | 450 calls, ~0.53M input tokens, ~0.09M answer tokens plus any hidden thinking |
| GPT-6.1 Sol cost ($2 / $10) | ~$2 with no thinking, ~$4 with 500 thinking tokens per call, ~$11 with 2,000. **Pilot 20 answers first:** `npm run bench -- --decider llm --name llm-pilot --limit 20`, then multiply its cost by 22.5 |
| Mock check, Drex + NDI | ~6 s per check (two polls of about 3 s each); offline check under 100 ms |
| `local` run | ~1.5 s for all 450 |

The spec once said 3,098 sentences; that number could not be reproduced and was corrected to 3,041 (DECISIONS.md #22).

## 6. Commands, in order, once the keys are in

```bash
npm run prepare-data                          # if data/ragtruth/sample.jsonl isn't committed yet
npm test && npm run build
npm run test:live                             # real Nace: response shapes in ~1 minute
npm run smoke -- drex
npm run smoke -- ndi
npm run smoke -- llm
npm run bench -- --decider llm --name llm-pilot --limit 20          # cost check, then delete data/results/llm-pilot.json
npm run bench -- --decider llm --name llm-gpt --label "GPT-6.1 Sol" --concurrency 4
npm run bench -- --decider drex --name drex --concurrency 4
npm run bench -- --decider local --name local
curl -s localhost:3000/api/benchmark | jq .improvement                # Drex vs GPT: speedup, costRatio, f1Delta
```

## 7. Demo fallbacks

- NDI slow on stage → set `PERCEIVER=local`, keep `DECIDER=drex`.
- Venue Wi-Fi down → `npm run dev` on a laptop, with committed results and fixtures.
- Drex F1 below GPT → lead with `improvement.speedup` and `costRatio`, plus the abstain curve.
- The live race: `POST /api/check {"sampleId":"msa-summary","compare":"llm"}` puts Drex and GPT on the same memo, with real time and cost side by side.
