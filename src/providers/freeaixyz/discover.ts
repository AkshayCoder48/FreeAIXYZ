/**
 * FreeAIXYZ discoverer — WordPress backend (`https://unlimitedai.org/wp-admin/admin-ajax.php`)
 * has NO /models endpoint. The chat adapter uses a 3-step curl flow with
 * hardcoded BOT_IDS. Surface the 8 known bot keys + 8 `-search` variants
 * (which trigger the web-search grounding flag in the adapter).
 */
import { manualModels } from "../_shared";

const BASE_IDS = [
  "chatgpt",
  "gemini",
  "deepseek",
  "claude",
  "grok",
  "perplexity",
  "meta",
  "qwen",
];

export async function discover() {
  // 16 ids total: 8 base + 8 `-search` variants (the chat adapter treats
  // `-search` suffix as "enable web search" automatically).
  const ids = [
    ...BASE_IDS,
    ...BASE_IDS.map((id) => `${id}-search`),
  ];
  return manualModels(ids, {
    source: "manual",
    endpoint: "https://unlimitedai.org/wp-admin/admin-ajax.php",
    note: "freeaixyz has no /models endpoint; BOT_IDS-derived slugs",
    baseIds: BASE_IDS,
  });
}
