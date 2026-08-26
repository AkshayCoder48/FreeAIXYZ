import type { FreeClassification, UnifiedModel } from "../types";

/**
 * OpenCode uses `-free` / `_free` suffix to mark free-tier models.
 * Pattern: `/-?_?free$/i`.
 */
export function classifyFree(model: UnifiedModel): FreeClassification {
  const id = model.modelId;
  if (/(^|[-_])free$/i.test(id)) {
    return {
      free: true,
      confidence: "pattern",
      reason: "matches /-?_?free$/i (opencode pattern)",
    };
  }
  return {
    free: false,
    confidence: "pattern",
    reason: "no -free/_free suffix (opencode paid)",
  };
}
