/**
 * Web Search provider — uses the z-ai-web-dev-sdk to search the web, then
 * feeds the results to an existing LLM provider to generate a grounded answer.
 *
 * This creates "search models" that have real-time information access.
 * The search is performed using ZAI's web_search function, and the results
 * are passed as context to a backing LLM (HeckAI/DeepSeek by default).
 */

import ZAI from "z-ai-web-dev-sdk";
import type { Provider, ProviderCompletionRequest } from "./types";
import { heckAiProvider } from "./heckai";

interface SearchResult {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Perform a web search using z-ai-web-dev-sdk. */
async function webSearch(query: string, num: number = 8): Promise<SearchResult[]> {
  try {
    const zai = await ZAI.create();
    const results = await zai.functions.invoke("web_search", {
      query,
      num,
    });
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

/** Build a context string from search results. */
function buildSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";
  const parts = results.map((r, i) =>
    `[${i + 1}] ${r.name}\nURL: ${r.url}\n${r.snippet}`,
  );
  return `Web search results:\n${parts.join("\n\n")}\n\nBased on these results, answer the user's question. Cite sources by number like [1], [2].`;
}

export const webSearchProvider: Provider = {
  id: "heckai", // uses HeckAI as the backing LLM

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    // Extract the user's question
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const question = lastUserMsg?.content || "Hello";

    // Perform web search
    const results = await webSearch(question, 8);
    const searchContext = buildSearchContext(results);

    if (searchContext) {
      // Inject search results as system context
      const augmentedMessages = [
        ...req.messages.filter((m) => m.role === "system"),
        { role: "system" as const, content: searchContext },
        ...req.messages.filter((m) => m.role !== "system"),
      ];

      // Use HeckAI (DeepSeek V4 Flash) as the backing LLM
      yield* heckAiProvider.stream({
        ...req,
        messages: augmentedMessages,
      });
    } else {
      // No search results — just use the backing LLM directly
      yield* heckAiProvider.stream(req);
    }
  },
};
