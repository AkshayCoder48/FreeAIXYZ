/**
 * Swarm discoverer — `https://swarm.g4f-dev.workers.dev/v1/models`
 * (community-hosted llama.cpp swarm). OpenAI-shaped `{data:[]}` listing.
 * 7+ GGUF models, all free, native tool calling.
 */
import { fetchModelsJson } from "../_shared";

const URL = "https://swarm.g4f-dev.workers.dev/v1/models";

export async function discover() {
  return fetchModelsJson(URL, {
    timeoutMs: 12_000,
    idField: "id",
  });
}
