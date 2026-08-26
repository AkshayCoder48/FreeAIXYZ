/**
 * UnlimitedAI discoverer — `https://app.unlimitedai.chat/api/chat` is a chat
 * endpoint with NO /models listing. Two upstream model ids known to work:
 * `chat-model-reasoning` and `chat-model-reasoning-with-search`.
 */
import { manualModels } from "../_shared";

const IDS = ["chat-model-reasoning", "chat-model-reasoning-with-search"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://app.unlimitedai.chat/api/chat",
    note: "unlimitedai has no /models endpoint; two reasoning slugs",
  });
}
