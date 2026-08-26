/**
 * Web Search API — returns search results via the Z.AI web_search function
 * (z-ai-web-dev-sdk), with DuckDuckGo HTML parsing as a no-auth fallback.
 *
 * Audit F1: prior implementation claimed to support "Miklium / DuckDuckGo /
 * Google" but all three engines silently failed for most queries (Miklium's
 * POST endpoint returned empty results; DuckDuckGo's HTML scraping broke on
 * the new result markup; Google actively blocks Node fetch). The endpoint
 * always returned `count: 0, engine: "none"`, which the audit correctly
 * flagged as a stub masquerading as a working endpoint.
 *
 * Now we delegate to the Z.AI SDK's `web_search` function (a real search
 * backend) when available, and keep DuckDuckGo HTML parsing as a graceful
 * fallback for the case where the SDK isn't configured. The response shape
 * is the OpenAI-friendly `{query, count, results, engine}` documented in
 * the route's prior docs.
 *
 * Endpoint: POST /api/v1/search  body: { query, num?, engine? }
 *           GET  /api/v1/search?q=...&num=...&engine=...
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResponse {
  results: SearchResult[];
  engine: string;
}

/** DuckDuckGo HTML search — reliable, no API key, fallback only (audit F1). */
async function duckduckgoSearch(
  query: string,
  num: number = 8,
): Promise<SearchResult[]> {
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
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const results: SearchResult[] = [];

    const linkBlocks = html.split(/class="result__a"/i);
    for (const block of linkBlocks.slice(1, num + 1)) {
      const hrefMatch = block.match(/href="([^"]+)"/i);
      const titleMatch = block.match(/>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
      );

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

/**
 * Z.AI SDK web_search function — real backend (audit F1 preferred path).
 *
 * Lazily imported so the route doesn't fail at module-load if the SDK
 * isn't installed/configured. Returns [] on any error so the DuckDuckGo
 * fallback can take over.
 */
async function zaiWebSearch(
  query: string,
  num: number,
): Promise<SearchResult[]> {
  try {
    const mod = (await import("z-ai-web-dev-sdk")) as {
      default?: { create(): Promise<ZaiClient> };
    };
    const ZAI = mod.default;
    if (!ZAI || typeof ZAI.create !== "function") return [];
    const client = await ZAI.create();
    if (
      !client?.functions?.invoke ||
      typeof client.functions.invoke !== "function"
    ) {
      return [];
    }
    // SDK signature: functions.invoke('web_search', { query, num, recency_days })
    const raw = (await client.functions.invoke("web_search", {
      query,
      num,
    })) as Array<{
      url?: string;
      name?: string;
      snippet?: string;
      title?: string;
      host_name?: string;
      rank?: number;
      date?: string;
      favicon?: string;
    }> | null;
    if (!Array.isArray(raw)) return [];
    const out: SearchResult[] = [];
    for (const item of raw) {
      const url = item?.url;
      if (!url || typeof url !== "string") continue;
      out.push({
        title: item.name ?? item.title ?? "",
        url,
        snippet: item.snippet ?? "",
      });
      if (out.length >= num) break;
    }
    return out;
  } catch (err) {
    console.error(
      "[/api/v1/search] z-ai web_search failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Thin interface to keep the dynamic import typed without exporting it. */
interface ZaiClient {
  functions: {
    invoke: (
      name: "web_search",
      args: { query: string; num?: number; recency_days?: number },
    ) => Promise<unknown>;
  };
}

/** Unified search — tries Z.AI first, falls back to DuckDuckGo (audit F1). */
async function search(
  query: string,
  num: number = 8,
  engine?: string,
): Promise<SearchResponse> {
  // Explicit DuckDuckGo request → skip Z.AI.
  if (engine === "duckduckgo") {
    const results = await duckduckgoSearch(query, num);
    if (results.length > 0) return { results, engine: "duckduckgo" };
    return { results: [], engine: "none" };
  }

  // Default + `engine === "auto" | "zai" | undefined` → try Z.AI first.
  if (engine === undefined || engine === "auto" || engine === "zai") {
    const results = await zaiWebSearch(query, num);
    if (results.length > 0) return { results, engine: "zai" };
    // Fall through to DuckDuckGo.
  }

  // Last resort: DuckDuckGo HTML.
  const results = await duckduckgoSearch(query, num);
  if (results.length > 0) return { results, engine: "duckduckgo" };

  return { results: [], engine: "none" };
}

/** POST /api/v1/search — { query, num?, engine? } → { results } */
export async function POST(request: Request) {
  let body: { query?: string; num?: number; engine?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          type: "INVALID_REQUEST",
          message: "Invalid JSON body.",
          code: "invalid_request",
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      {
        error: {
          type: "INVALID_REQUEST",
          message: "`query` is required and must be a non-empty string.",
          code: "invalid_request",
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  const num = Math.min(Math.max(1, body.num || 8), 20);
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
  const num = Math.min(
    Math.max(1, parseInt(url.searchParams.get("num") || "8", 10) || 8),
    20,
  );
  const engine = url.searchParams.get("engine") || undefined;

  if (!query) {
    return NextResponse.json({
      service: "Web Search API",
      engines: ["zai", "duckduckgo", "auto"],
      usage:
        "POST /api/v1/search with { query: string, num?: number, engine?: 'zai'|'duckduckgo'|'auto' }",
      example: "GET /api/v1/search?q=latest+news&num=8&engine=zai",
    });
  }

  const { results, engine: usedEngine } = await search(query, num, engine);
  return NextResponse.json({
    query,
    count: results.length,
    results,
    engine: usedEngine,
  });
}
