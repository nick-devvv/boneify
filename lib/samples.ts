// Demo samples in data/samples/<id>.json (+ optional PDF). Read from disk; bundled on Vercel via outputFileTracingIncludes.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DecideContext, Verdict } from "./types";
import { ApiError } from "./errors";

export interface Sample {
  id: string;
  title: string;
  description: string;
  sourceName: string;
  pdfFile?: string;
  sourceText: string;
  aiText: string;
  context?: DecideContext;
  plantedErrors: Array<{ sentence: string; expected: Verdict; why: string }>;
}

export const dataDir = () => path.join(process.cwd(), "data");
const samplesDir = () => path.join(dataDir(), "samples");
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function listSamples(): Promise<Sample[]> {
  let files: string[] = [];
  try {
    files = (await readdir(samplesDir())).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: Sample[] = [];
  for (const f of files) out.push(JSON.parse(await readFile(path.join(samplesDir(), f), "utf8")) as Sample);
  return out;
}

export async function getSample(id: string): Promise<Sample> {
  if (!SAFE_ID.test(id)) throw new ApiError(404, "sample_not_found", `No sample called "${id}".`);
  try {
    return JSON.parse(await readFile(path.join(samplesDir(), `${id}.json`), "utf8")) as Sample;
  } catch {
    throw new ApiError(404, "sample_not_found", `No sample called "${id}".`);
  }
}

export async function getSamplePdf(sample: Sample): Promise<Uint8Array> {
  if (!sample.pdfFile || !/^[a-z0-9-]+\.pdf$/.test(sample.pdfFile)) throw new ApiError(404, "sample_not_found", `Sample "${sample.id}" has no PDF.`);
  try {
    return new Uint8Array(await readFile(path.join(samplesDir(), sample.pdfFile)));
  } catch {
    throw new ApiError(404, "sample_not_found", `Sample "${sample.id}" has no PDF.`);
  }
}
