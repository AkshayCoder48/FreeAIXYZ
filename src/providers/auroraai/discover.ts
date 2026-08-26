/**
 * AuroraAI discoverer — `https://www.nsfwlover.com/api/openai/chat/completions`
 * is a chat endpoint with NO /models listing. Only one upstream model id
 * is callable: `llama3-8b` (mapped upstream to sao10k/l3-lunaris-8b).
 */
import { manualModels } from "../_shared";

const IDS = ["llama3-8b"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://www.nsfwlover.com/api/openai/chat/completions",
    note: "auroraai has no /models endpoint; single model llama3-8b",
  });
}
