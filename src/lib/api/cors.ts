/**
 * CORS policy (the "failed to fetch" fix).
 *
 * FreeAIXYZ is a PUBLIC, KEYLESS, OpenAI-compatible gateway. Browser apps on
 * ANY origin — https://onyxagent-lac.vercel.app, localhost dev servers, hosted
 * notebooks, third-party gateways — must be able to call it directly with
 * fetch/XHR and the OpenAI SDKs.
 *
 * Before this module, the API routes returned NO `Access-Control-*` headers
 * and exposed no `OPTIONS` handler, so every non-same-origin browser request
 * died at the CORS preflight with an opaque `TypeError: Failed to fetch`.
 *
 * Usage (App Router route.ts):
 *
 *   import { withCors, corsPreflight } from "@/lib/api/cors";
 *
 *   export async function POST(request: Request) {
 *     return withCors(await handle(request));   // adds Access-Control-* headers
 *   }
 *   export async function OPTIONS() {
 *     return corsPreflight();                   // 204 + preflight headers
 *   }
 *
 * `withCors` is body-safe for STREAMING responses: it re-wraps the original
 * `Response` (body, status, statusText) with a merged header set — it never
 * reads or buffers the stream.
 */

/**
 * The allow-list mirrored by `withCors` and `corsPreflight`.
 *
 * `Access-Control-Allow-Origin: *` is correct for this API: there is no auth,
 * no cookies, and no credentials — `*` cannot leak anything. (The credentialed
 * mode `Access-Control-Allow-Credentials` is intentionally NOT set: browsers
 * forbid `*` together with credentials.)
 */
export const CORS_ALLOW_HEADERS =
  [
    "Content-Type",
    "Content-Length",
    "Authorization",
    "Accept",
    "Accept-Language",
    "Origin",
    "User-Agent",
    "X-API-Key",
    "X-Requested-With",
    "X-Request-Id",
    "Cache-Control",
    "Pragma",
    "OpenAI-Beta",
    "OpenAI-Organization",
    "OpenAI-Project",
    "HTTP-Referer",
    "X-Title",
  ].join(", ");

export const CORS_ALLOW_METHODS =
  "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD";

/** Headers the browser is allowed to READ from responses. */
export const CORS_EXPOSE_HEADERS =
  [
    "Content-Type",
    "Content-Length",
    "X-Request-Id",
    "X-Failover",
    "Retry-After",
    "X-RateLimit-Remaining",
  ].join(", ");

/** Plain header record — reused by next.config.ts `headers()` and vercel.json. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
  "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
  "Access-Control-Max-Age": "86400",
};

/**
 * Merge CORS headers onto an existing Response without disturbing its body.
 *
 * Body-safe: constructs a new Response around the ORIGINAL body reference.
 * For a streaming (ReadableStream) body this passes the stream through
 * untouched — no buffering, no re-pacing, no clone.
 */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CORS preflight handler (`OPTIONS`).
 *
 * 204 No Content — the spec-recommended preflight success status — carrying
 * the full preflight header set. Browsers cache it for 24h via
 * Access-Control-Max-Age, so subsequent cross-origin calls skip preflight.
 */
export function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    statusText: "No Content",
    headers: {
      ...CORS_HEADERS,
      Allow: CORS_ALLOW_METHODS,
    },
  });
}
