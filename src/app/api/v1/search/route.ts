/**
 * Web Search API — standalone endpoint that returns search results.
 *
 * Distinct service, NOT combined into chat models.
 * Clients call this to get raw search results, then feed them to any model.
 *
 * Endpoint: POST /api/v1/search
 * Body: { query: string, num?: number }
 * Response: { results: [{ title, url, snippet }], query, count }
 *
 * GET /api/v1/search?q=...&num=... also works.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Perform a search using DuckDuckGo's HTML endpoint (more scrape-friendly). */
async function search(query: string, num: number = 8): Promise<SearchResult[]> {
  try {
    // DuckDuckGo HTML endpoint — returns simple HTML with results
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

    // DuckDuckGo HTML format:
    // <a class="result__a" href="//duckduckgo.com/l/?uddg=ENCODED_URL&rut=...">Title</a>
    // Split by "result__a" to get each result block
    const linkBlocks = html.split(/class="result__a"/i);
    for (const block of linkBlocks.slice(1, num + 1)) {
      // Extract href from the current block
      const hrefMatch = block.match(/href="([^"]+)"/i);
      // Extract title text (between > and </a>)
      const titleMatch = block.match(/>([\s\S]*?)<\/a>/i);
      // Extract snippet from the same result block
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

      if (hrefMatch && titleMatch) {
        const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        let url = hrefMatch[1];
        // DDG wraps URLs: //duckduckgo.com/l/?uddg=ENCODED_URL
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

    // Fallback: Google search
    if (results.length === 0) {
      return googleFallback(query, num);
    }

    return results;
  } catch {
    return [];
  }
}

/** Fallback: Google search via HTML scraping. */
async function googleFallback(query: string, num: number): Promise<SearchResult[]> {
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

/** POST /api/v1/search — { query, num? } → { results } */
export async function POST(request: Request) {
  let body: { query?: string; num?: number };
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
  const results = await search(query, num);

  return NextResponse.json({
    query,
    count: results.length,
    results,
  });
}

/** GET /api/v1/search?q=...&num=... */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const num = Math.min(parseInt(url.searchParams.get("num") || "8"), 20);

  if (!query) {
    return NextResponse.json({
      service: "Web Search API",
      usage: "POST /api/v1/search with { query: string, num?: number }",
      example: "GET /api/v1/search?q=latest+news&num=8",
    });
  }

  const results = await search(query, num);
  return NextResponse.json({ query, count: results.length, results });
}
