// Swap point 2: who reads the file and finds receipts.

import type { Perceiver } from "../types";
import { getConfig, type Config } from "../config";
import { ApiError } from "../errors";
import { localPerceiver } from "./local";
import { createNdiPerceiver } from "./ndi";

export const PERCEIVER_IDS = ["local", "ndi"] as const;

/** A perceiver may collect warnings while parsing (e.g. "NDI could not parse this file; used the built-in reader"). */
export interface PerceiverWithWarnings extends Perceiver {
  warnings?: string[];
}

export function getPerceiver(id?: string, cfg: Config = getConfig()): PerceiverWithWarnings {
  const which = (id ?? cfg.perceiver).toLowerCase();
  switch (which) {
    case "local":
      return localPerceiver;
    case "ndi":
      return createNdiPerceiver(cfg); // fresh per request: it collects that request's warnings
    default:
      throw new ApiError(400, "unknown_engine", `Unknown perceiver "${which}". Use one of: ${PERCEIVER_IDS.join(", ")}.`);
  }
}
