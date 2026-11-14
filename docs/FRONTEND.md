# Boneify front end

Four pages, all in `app/` next to the API routes. The front end never computes or hard-codes a statistic: it formats what the API returns and shows a dash for anything the API hasn't returned yet (see "Front-end numbers" in [MVP_SPEC.md](MVP_SPEC.md)).

| Page | What it shows | Where the data comes from |
| --- | --- | --- |
| `/` Home | A scroll story in five chapters: Fossil or fiction? (one bone per sentence), it catches mistakes, how it works (NDI reads → Drex checks → receipt), faster than GPT-6.1, try it | The recorded check `data/demo/recorded-check.json` + `data/samples/msa-summary.json`; speed, cost and accuracy from `GET /api/benchmark` |
| `/demo` Demo | Exactly what Try it does, in five steps: the AI summary as a paragraph → split into sentences, NDI reads the PDF, Drex checks them all → the wrong ones, each with its clause lit on its page → the made-up one → who did what and the race. Plays once; arrows, dots and ← → step through it | The recorded check. When Drex and NDI are on (`GET /api/health`), it runs the same check live in the background and uses it if it lands before the verdicts. A small label says "live check" or "recorded check" |
| `/check` Try it | 1 add the original (file or sample), 2 paste the AI text (live sentence count), 3 press Check. "NDI is reading…", then "Drex is checking N sentences" as each layer cracks. Results: who did what, the PDF with highlights, one row per sentence with its quote, how sure Drex is and NEEDS REVIEW | `GET /api/samples`, `GET /api/health`, `POST /api/split`, `POST /api/check` (with `compare: "llm"` when the LLM is ready) |
| `/scoreboard` Scoreboard | Drex vs GPT-6.1: three proof cards (faster, cheaper, more accurate), the race at the real pace, one dot per test sentence, scores with caught / missed / false alarms, cost and review sliders | `GET /api/benchmark?task=…`, `GET /api/benchmark/:run` |

## Plain words used everywhere

Correct (amber bone) · Wrong (red cracked bone) · Made up (faded bone). The receipt is the clause and page in the original. Accuracy is sentence F1, time is the median per answer, cost is per 1,000 sentences. The big AI model is named by its label from the API (GPT-6.1 Sol today).

## The PDF with highlights (Adobe)

`app/_ui/AdobeViewer.tsx` loads Adobe's PDF Embed API, opens the sample PDF (or the uploaded PDF), adds the API's ready-made `adobeAnnotations` and jumps to the selected sentence's page. It needs `NEXT_PUBLIC_ADOBE_CLIENT_ID`, a free key from Adobe's developer console registered for the site's domain (and `localhost` for local runs). Without it, or if Adobe's script can't load, Try it draws the contract page itself (`app/_ui/Contract.tsx`) with the same highlights.

## Recording the demo with Drex + NDI

The home page, the demo and the offline fallback replay `data/demo/recorded-check.json`. The copy in the repo was recorded with the offline engines; re-record it with Drex and NDI on before the demo, and everything follows automatically, including the race:

```bash
curl -s -X POST localhost:3000/api/check -H 'content-type: application/json' \
  -d '{"sampleId":"msa-summary","compare":"llm"}' > data/demo/recorded-check.json
```

## Fallbacks

- No network on stage: Try it falls back to the recorded contract check for the contract sample, labelled "OFFLINE".
- The scoreboard race uses a preview pace until both benchmark runs exist, and says so under the track.
- `NEXT_PUBLIC_API_BASE` points the pages at an API hosted elsewhere; empty means the same site.

## Dark mode and motion

The moon button in every header flips the whole site to a warm dark (an inverted palette; pixel art, amber buttons and PDF pages keep their colours). The choice is remembered and applied before first paint. The current 1 · 2 · 3 step pops once when you land on a page. Everything respects `prefers-reduced-motion`.

## Files

- `app/_ui/`: header (steps, dark mode), the key, pixel sprites, the contract page, the Adobe viewer, the sand dig, the source viewer, the API client, the fossil, formatting.
- `app/demo/LiveDemo.tsx`, `app/check/CheckApp.tsx`, `app/scoreboard/Scoreboard.tsx`, `app/_ui/HomeStory.tsx`: one client component per page.
- Fonts: Geist and Geist Mono (`geist`), Instrument Serif (`@fontsource/instrument-serif`), all bundled, no Google Fonts call at runtime.
