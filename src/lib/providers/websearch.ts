/**
 * Web Search provider — performs a direct Google search, scrapes results,
 * then uses HeckAI as the backing LLM to generate a grounded answer.
 *
 * No z-ai SDK, no MCP server, no Toolbaz fallback.
 * Uses HeckAI (DeepSeek V4 Flash/Pro) as the backing LLM.
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { heckAiProvider } from "./heckai";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Perform a Google search by scraping the HTML results page. */
async function googleSearch(query: string, num: number = 8): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const results: SearchResult[] = [];

    // Parse Google search results from HTML
    // Each result is in a <div> with class containing "g" and has an <a href> and <h3>
    const linkRegex = /<a[^>]+href="\/url\?q=([^&"]+)&[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null && results.length < num) {
      const url = decodeURIComponent(match[1]);
      if (!url.startsWith("http") || url.includes("google.com")) continue;

      // Extract title from the link content (usually contains an <h3>)
      const titleMatch = match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

      // Find snippet — look for the text after the link's container
      const afterLink = html.slice(match.index, match.index + 2000);
      const snippetMatch = afterLink.match(/<(?:span|div)[^>]*class="[^"]*(?:st|IsZvec|OBKLkc)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
        : "";

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    // Fallback: try data-href links (newer Google format)
    if (results.length === 0) {
      const dataHrefRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = dataHrefRegex.exec(html)) !== null && results.length < num) {
        const url = match[1];
        if (url.includes("google.com") || url.includes("gstatic.com")) continue;
        const titleMatch = match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
        if (title && url) {
          results.push({ title, url, snippet: "" });
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

/** Build a compact context string from search results. */
function buildSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";
  // Keep it compact — HeckAI has a limited input size
  const parts = results.slice(0, 5).map(
    (r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`,
  );
  return `Search results:\n${parts.join("\n")}\n\nAnswer using these results. Cite [1], [2] etc.`;
}

export const webSearchProvider: Provider = {
  id: "websearch",

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
    const results = await googleSearch(question, 8);
    const searchContext = buildSearchContext(results);

    // Merge search context into a single system message (HeckAI doesn't handle multiple system messages)
    const existingSystem = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const systemContent = [existingSystem, searchContext].filter(Boolean).join("\n\n");

    const augmentedMessages = [
      ...(systemContent ? [{ role: "system" as const, content: systemContent }] : []),
      ...req.messages.filter((m) => m.role !== "system"),
    ];

    // Use HeckAI as the backing LLM
    // Override the model to use the backing LLM specified in upstream
    yield* heckAiProvider.stream({
      model: { ...req.model, upstream: req.model.upstream, provider: "heckai" },
      messages: augmentedMessages,
      signal: req.signal,
    });
  },
};
