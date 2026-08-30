/**
 * SurfSense discoverer — `https://api.surfsense.com/api/v1/public/anon-chat/stream`
 * is a chat endpoint with NO /models listing. Two upstream model slugs known
 * to work: `gpt-5.4-mini-no-login` and `gpt-o4-mini-no-login`.
 */
import { manualModels } from "../_shared";

const IDS = ["gpt-5.4-mini-no-login", "gpt-o4-mini-no-login"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://api.surfsense.com/api/v1/public/anon-chat/stream",
    note: "surfsense has no /models endpoint; two known-good slugs",
  });
}
