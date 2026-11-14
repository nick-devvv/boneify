// Swap point 1: who makes the green / red / yellow call.

import type { Decider } from "../types";
import { getConfig, type Config } from "../config";
import { ApiError } from "../errors";
import { localDecider } from "./local";
import { createLlmDecider } from "./llm";
import { createDrexDecider } from "./drex";

export const DECIDER_IDS = ["local", "llm", "drex"] as const;

export function getDecider(id?: string, cfg: Config = getConfig()): Decider {
  const which = (id ?? cfg.decider).toLowerCase();
  switch (which) {
    case "local":
      return localDecider;
    case "llm":
      return createLlmDecider(cfg);
    case "drex":
      return createDrexDecider(cfg);
    default:
      throw new ApiError(400, "unknown_engine", `Unknown decider "${which}". Use one of: ${DECIDER_IDS.join(", ")}.`);
  }
}
