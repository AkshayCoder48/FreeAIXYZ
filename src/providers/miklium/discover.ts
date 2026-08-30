/**
 * Miklium discoverer — `https://miklium.vercel.app/api/chatbot` is a chat
 * endpoint with NO /models listing. Five personality ids accepted:
 * miklium, personalityless, male, female, all.
 */
import { manualModels } from "../_shared";

const IDS = ["miklium", "personalityless", "male", "female", "all"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://miklium.vercel.app/api/chatbot",
    note: "miklium has no /models endpoint; five personality slugs",
  });
}
