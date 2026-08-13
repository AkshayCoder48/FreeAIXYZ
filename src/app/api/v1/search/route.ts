/**
 * Web Search API — returns search results from multiple providers.
 *
 * Providers: Miklium AI search (default), DuckDuckGo HTML fallback, Google fallback.
 *
 * Endpoint: POST /api/v1/search
 * Body: { query: string, num?: number, engine?: "miklium"|"duckduckgo"|"google" }
 * Response: { results: [{ title, url, snippet }], query, count, engine }
 *
 * GET /api/v1/search?q=...&num=...&engine=... also works.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Miklium AI-powered search — synthesizes answer from web results. */
async function mikliumSearch(query: string): Promise<SearchResult[]> {
  try {
    const res = await fetch("https://miklium.vercel.app/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    // Miklium search returns { success, response } or { results }
    if (data.results && Array.isArray(data.results)) {
      return data.results.map((r: { title?: string; url?: string; snippet?: string; link?: string }) => ({
        title: r.title || "",
        url: r.url || r.link || "",
        snippet: r.snippet || "",
      })).filter((r: SearchResult) => r.url);
    }
    // If Miklium returns a synthesized answer instead of links
    if (data.response || data.success) {
      return [{
        title: `Miklium AI Search: ${query}`,
        url: `https://miklium.vercel.app`,
        snippet: data.response || data.answer || "",
      }];
    }
    return [];
  } catch {
    return [];
  }
}

/** DuckDuckGo HTML search — reliable, no API key. */
async function duckduckgoSearch(query: string, num: number = 8): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
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

    const linkBlocks = html.split(/class="result__a"/i);
    for (const block of linkBlocks.slice(1, num + 1)) {
      const hrefMatch = block.match(/href="([^"]+)"/i);
      const titleMatch = block.match(/>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

      if (hrefMatch && titleMatch) {
        const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        let url = hrefMatch[1];
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
          : "";

        if (title && url.startsWith("http")) {
          results.push({ title, url, snippet });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

/** Google search fallback. */
async function googleSearch(query: string, num: number): Promise<SearchResult[]> {
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

    const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null && results.length < num) {
      const url = match[1];
      if (url.includes("google.com") || url.includes("gstatic.com")) continue;
      const titleMatch = match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      if (title && url) results.push({ title, url, snippet: "" });
    }
    return results;
  } catch {
    return [];
  }
}

/** Unified search — tries engines in order, falls back on failure. */
async function search(query: string, num: number = 8, engine?: string): Promise<{ results: SearchResult[]; engine: string }> {
  // Miklium AI search (default — AI-powered, best quality)
  if (!engine || engine === "miklium") {
    const results = await mikliumSearch(query);
    if (results.length > 0) return { results, engine: "miklium" };
    // Fall through to DDG
  }

  // DuckDuckGo fallback
  if (engine === "duckduckgo") {
    const results = await duckduckgoSearch(query, num);
    if (results.length > 0) return { results, engine: "duckduckgo" };
  }

  // Google fallback
  if (engine === "google") {
    const results = await googleSearch(query, num);
    if (results.length > 0) return { results, engine: "google" };
  }

  // Last resort: try DDG if not tried yet
  if (engine !== "duckduckgo") {
    const results = await duckduckgoSearch(query, num);
    if (results.length > 0) return { results, engine: "duckduckgo" };
  }

  return { results: [], engine: "none" };
}

/** POST /api/v1/search — { query, num?, engine? } → { results } */
export async function POST(request: Request) {
  let body: { query?: string; num?: number; engine?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "`query` is required" }, { status: 400 });
  }

  const num = Math.min(body.num || 8, 20);
  const { results, engine: usedEngine } = await search(query, num, body.engine);

  return NextResponse.json({
    query,
    count: results.length,
    results,
    engine: usedEngine,
  });
}

/** GET /api/v1/search?q=...&num=...&engine=... */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const num = Math.min(parseInt(url.searchParams.get("num") || "8"), 20);
  const engine = url.searchParams.get("engine") || undefined;

  if (!query) {
    return NextResponse.json({
      service: "Web Search API",
      engines: ["miklium", "duckduckgo", "google"],
      usage: "POST /api/v1/search with { query: string, num?: number, engine?: string }",
      example: "GET /api/v1/search?q=latest+news&num=8&engine=miklium",
    });
  }

  const { results, engine: usedEngine } = await search(query, num, engine);
  return NextResponse.json({ query, count: results.length, results, engine: usedEngine });
}
