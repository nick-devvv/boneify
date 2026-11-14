# Boneify

**Fossil or fiction?** Boneify checks every sentence an AI writes against the original document, and shows the page and clause that proves it. Built at Drexathon with Nace Drex, NDI, Intern, Adobe and DeepInfra.

Each sentence of an AI summary gets one verdict: **Correct**, **Wrong** or **Made up**, with how sure Drex is, a "needs review" flag when it isn't, and a receipt: the page, the clause number and the quote from the original, highlighted in the real PDF.

## Drex vs GPT-6.1 (Track 1)

Same 450 RAGTruth test answers (3,041 sentences, graded against the human answer key), from `GET /api/benchmark`:

| | Accuracy (sentence F1) | Median time per answer | Cost per 1,000 sentences |
|---|---|---|---|
| **Drex Max v1.1** | **0.56** | **0.32 s** | **$0.015** |
| GPT-6.1 Sol | 0.51 | 4.08 s | $0.654 |

**12.9× faster, 45× cheaper and 10% more accurate**, and Drex wins each of the three types of writing on its own.

## How it works

1. **NDI reads it.** Any PDF, Word file or scan, page by page.
2. **Drex checks it.** Every sentence at once: correct, wrong or made up.
3. **You get the receipt.** The page and clause for each sentence, highlighted in the PDF with the Adobe PDF Embed API.
4. **Fix with Intern.** Intern (Nace's agent harness, Drex as System 1, a DeepInfra model as System 2) rewrites only the flagged sentences from their receipts, and Boneify checks the rewrite again. NDI also pulls out the document's key facts, each with its citation.

## The site

| Page | What it does |
|---|---|
| `/` | The story: scroll to dig up the fossil, one bone per sentence. |
| `/demo` | The check played once in five steps (arrows, captions, ← →). Replays the recorded check, or runs it live when Drex and NDI are on. |
| `/check` | Try it: add a document (or pick a sample), paste the AI's text, press Check. Brush the sand while you wait. |
| `/scoreboard` | The proof: faster, cheaper, more accurate, the race, the scores and what it means for a firm. |

Dark mode is the moon button in every header.

## Run it

```bash
npm install
cp .env.example .env.local   # keys go here only, never in git
npm run dev                  # http://localhost:3000
```

Without keys everything runs offline (built-in reader and simple rules). With keys, set:

- `DECIDER=drex`, `PERCEIVER=ndi`, `NACE_BASE_URL`, `NACE_API_KEY`: Drex and NDI.
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_LABEL`: the big AI model in the race.
- `NEXT_PUBLIC_ADOBE_CLIENT_ID`: a free Adobe PDF Embed API key for the site's domain. Without it, Try it draws the contract page itself.

Re-record the demo with the real engines (the demo and the offline fallback replay this file):

```bash
curl -s -X POST localhost:3000/api/check -H 'content-type: application/json' \
  -d '{"sampleId":"msa-summary","compare":"llm"}' > data/demo/recorded-check.json
```

More: `docs/MVP_SPEC.md` (API), `docs/DECISIONS.md`, `docs/FRONTEND.md`. Sample companies are fictional.
