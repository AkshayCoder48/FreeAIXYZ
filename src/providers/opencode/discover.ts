/**
 * OpenCode discoverer — `https://opencode.ai/zen/v1/models` (64 models, no
 * auth). NOT `api.opencode.ai/v1/models` which returns "Not Found" text.
 * Supports OpenAI tool calling natively.
 */
import { fetchModelsJson } from "../_shared";

const URL = "https://opencode.ai/zen/v1/models";

export async function discover() {
  return fetchModelsJson(URL, {
    timeoutMs: 12_000,
    idField: "id",
  });
}
