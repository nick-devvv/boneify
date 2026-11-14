// The recorded run the home page and the demo replay: POST /api/check {"sampleId":"msa-summary","compare":"llm"},
// saved as data/demo/recorded-check.json (its own file, so re-recording never touches the API test fixtures).
// Re-record it with Drex + NDI on and both pages follow:
//   curl -s -X POST localhost:3000/api/check -H 'content-type: application/json' \
//     -d '{"sampleId":"msa-summary","compare":"llm"}' > data/demo/recorded-check.json

import type { CheckResult } from "../../lib/types";
import fixture from "../../data/demo/recorded-check.json";
import msa from "../../data/samples/msa-summary.json";

export const RECORDED = fixture as unknown as CheckResult;
export const RECORDED_SOURCE: { id: string; name: string; text: string; aiText: string; task: string } = {
  id: msa.id,
  name: msa.sourceName,
  text: msa.sourceText,
  aiText: msa.aiText,
  task: (msa as { context?: { task?: string } }).context?.task ?? "",
};
