import { getConfig, VERSION } from "../../../lib/config";
import { json, options } from "../../../lib/api";
import { internProblem } from "../../../lib/fix/intern";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Never reveals keys: `ready` only says whether the key an engine needs is set.
export function GET(): Response {
  const cfg = getConfig();
  const nace = Boolean(cfg.naceApiKey);
  const llm = Boolean(cfg.llmApiKey);
  const naceNote = "Set NACE_API_KEY to enable.";
  return json({
    ok: true,
    version: VERSION,
    defaults: { decider: cfg.decider, perceiver: cfg.perceiver, reviewThreshold: cfg.reviewThreshold },
    deciders: [
      { id: "local", label: "Simple rules (offline)", ready: true },
      { id: "llm", label: cfg.llmLabel, model: cfg.llmModel, ready: llm, ...(llm ? {} : { note: "Set LLM_API_KEY to enable." }) },
      { id: "drex", label: "Drex", model: cfg.drexModel, ready: nace, ...(nace ? {} : { note: naceNote }) },
    ],
    intern: (() => {
      const why = internProblem(cfg);
      return { label: "Intern (Nace agent harness)", system1: cfg.internSystem1, system2: cfg.internSystem2, ready: !why, ...(why ? { note: why } : {}) };
    })(),
    perceivers: [
      { id: "local", label: "Built-in reader (offline)", ready: true },
      { id: "ndi", label: "NDI (Nace Document Intelligence)", ready: nace, ...(nace ? {} : { note: naceNote }) },
    ],
  });
}

export const OPTIONS = options;
