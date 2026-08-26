/**
 * LLM7.io discoverer — `https://api.llm7.io/v1/models` (no auth).
 *
 * Hybrid pricing: most models are free anonymous, but a known set returns
 * 401 (subscription required) or 400 (model unavailable). We let free.ts
 * filter those out using the BLOCKED set.
 */
import { fetchModelsJson } from "../_shared";

const URL = "https://api.llm7.io/v1/models";

export async function discover() {
  return fetchModelsJson(URL, {
    timeoutMs: 10_000,
    idField: "id",
  });
}

/** Models that LLM7 itself lists but that reject anonymous calls (401 / 400).
 *  Audit verified these. NOT hardcoded model names from us — these are
 *  discovered to NOT work and so are not in the free catalog. */
export const BLOCKED_LLM7 = new Set<string>([
  "deepseek-v4-flash:0731",
  "gpt-oss:20b",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
  "gpt-3.5-turbo",
  "claude-fable-5",
  "claude-haiku-4-5",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "codestral-latest",
  "dark-beast-krea2",
  "firefly-gpt-image-2",
  "firefly-image-5",
  "flux-klein-2",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-low",
  "gemini-3.7-flash",
  "gemini-omni-flash",
  "gemma4:31b",
  "glm-5.3",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-image-2",
  "grok-4.5",
  "grok-4.6",
  "imagine-1.5",
  "kimi-k2.6",
  "kling-v3.0-pro",
  "kling-v3.0-turbo",
  "meta-Llama-3.1-8B-Instruct-Turbo",
  "mistral-Nemo-Instruct-2407",
  "mistral-Small-24B-Instruct-2501",
  "seed-2.0-mini",
  "seedance-2.0",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
]);
