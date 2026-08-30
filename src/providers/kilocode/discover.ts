/**
 * Kilo Code discoverer — `https://api.kilo.ai/api/gateway/models`
 * (OpenRouter-style listing). Filter to `:free` tier — the upstream returns
 * 367 entries, most paid. Supports OpenAI tool calling natively.
 */
import { fetchModelsJson } from "../_shared";

const URL = "https://api.kilo.ai/api/gateway/models";

export async function discover() {
  return fetchModelsJson(URL, {
    timeoutMs: 12_000,
    idField: "id",
  });
}
