/**
 * Pollinations discoverer — `https://text.pollinations.ai/models?json=true`.
 *
 * Returns a bare array of `{name, ...}` items (NOT the OpenAI `{data:[]}`
 * shape). Some items are image models — we surface them so the free catalog
 * can mark them as imageGeneration capability.
 *
 * Live-fetch every refresh so newly added models appear automatically (no
 * hardcoding — PRD §21).
 */
import { fetchModelsJson } from "../_shared";
import type { ProviderModel } from "../types";

const URL = "https://text.pollinations.ai/models?json=true";

export function discover(): Promise<ProviderModel[]> {
  return fetchModelsJson(URL, {
    timeoutMs: 8_000,
    idField: "name",
  });
}
