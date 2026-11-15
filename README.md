<div align="center">

<img src="docs/media/rex.svg" width="88" alt="Rex, the Boneify T-rex">

# Boneify

**Fossil or fiction?** Boneify checks every sentence an AI writes against the original document, and shows you the proof on the page.

🥇 **1st place, Adobe track** · 🥈 **2nd place overall** · Drexathon 2026

[Live app](https://boneify.vercel.app) · [Slides](https://boneify-slides.vercel.app) · [Drexathon entry](https://github.com/nace-ai/intern/pull/39)

<br>

<img src="docs/media/demo.gif" width="100%" alt="Boneify checking a contract summary: each sentence cracks open as correct, wrong or made up, then the proof opens in Adobe's PDF viewer">

</div>

## What it does

Add the original document, paste what an AI wrote about it and press **Check**. Every sentence comes back **Correct**, **Wrong** or **Made up**, with a receipt: the page, the clause and the quote, boxed in the real PDF.

| | |
|---|---|
| **Read** | NDI (Nace Document Intelligence) reads the original, whether it's a PDF, Word file or scan, and pulls out the key facts with citations. |
| **Check** | Drex checks every sentence at once and says how sure it is. Anything under 60% is flagged for a person to review. |
| **Prove** | The Adobe PDF Embed API opens the real PDF with a box on each clause: green for correct, red for wrong. Click a sentence to jump to its box. |
| **Fix** | Intern rewrites only the flagged sentences from their receipts, then Boneify checks the rewrite again. |

## Results

Drex vs GPT-6.1 Sol on 450 RAGTruth test answers (3,041 sentences labelled by people), from `GET /api/benchmark`:

| | Sentence F1 | Median time per answer | Cost per 1,000 sentences | False alarms |
|---|:---:|:---:|:---:|:---:|
| **Drex Max v1.1** | **0.56** | **0.32 s** | **$0.015** | **354** |
| GPT-6.1 Sol | 0.51 | 4.08 s | $0.65 | 456 |

**12.9× faster, 45× cheaper and 10% more accurate**, and Drex comes out ahead on all three task types (answers, summaries and data reports).

## Run it locally

```bash
git clone https://github.com/nick-devvv/boneify
cd boneify
npm install
cp .env.example .env.local
npm run dev   # http://localhost:3000
```

With no keys it runs offline, using a built-in reader and simple rules. To use Drex and NDI, add your own Nace API key to `.env.local`:

```bash
DECIDER=drex
PERCEIVER=ndi
NACE_BASE_URL=https://console.nace.ai
NACE_API_KEY=your-nace-key
```

To run the GPT comparison too, add `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` for any OpenAI-compatible API. Adobe's viewer only loads on the live site, so locally the proof shows on a page Boneify draws itself.

## Built with

[Nace Drex](https://nace.ai) · NDI · [Intern](https://github.com/nace-ai/intern) · Adobe PDF Embed API · DeepInfra · Next.js · Vercel

## Team

[Nick Dev](https://github.com/nick-devvv) and [Anish Nallapu](https://github.com/anishnallapu)

<sub>The companies in the sample contract are fictional.</sub>
