/**
 * Vexa discoverer — `https://vexa-ai.pages.dev` has NO /models endpoint
 * (both `/v1/models` and `/models` 404). Manual fallback to the legacy
 * MODELS[] entries; `gpt-4.1-nano` marked offline since audit confirmed
 * "No provider available".
 */
import { manualModels } from "../_shared";

const IDS = ["vexa", "gpt-4.1-nano"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://vexa-ai.pages.dev",
    note: "vexa has no /models endpoint; legacy fallback to known-good models",
  });
}
