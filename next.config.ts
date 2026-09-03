import type { NextConfig } from "next";

/**
 * CORS headers applied at the routing layer (belt-and-suspenders alongside
 * the per-route `withCors` wrappers — see src/lib/api/cors.ts). These fire
 * for EVERY /api/* path and every /v1 alias, including paths handled before
 * a route function runs, so even Next-generated 404/405 responses carry
 * Access-Control-* headers.
 */
const corsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  {
    key: "Access-Control-Allow-Methods",
    value: "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
  },
  {
    key: "Access-Control-Allow-Headers",
    value:
      "Content-Type, Content-Length, Authorization, Accept, Accept-Language, Origin, User-Agent, X-API-Key, X-Requested-With, X-Request-Id, Cache-Control, Pragma, OpenAI-Beta, OpenAI-Organization, OpenAI-Project, HTTP-Referer, X-Title",
  },
  {
    key: "Access-Control-Expose-Headers",
    value:
      "Content-Type, Content-Length, X-Request-Id, X-Gateway, X-Failover, Retry-After",
  },
  { key: "Access-Control-Max-Age", value: "86400" },
  // Gateway identity (see src/lib/api/cors.ts GATEWAY_ID): one header glance
  // proves whether this deployment served the request.
  { key: "X-Gateway", value: "freeaixyz4all" },
];

const nextConfig: NextConfig = {
  // Use standalone output for Docker/self-hosted, skip for Vercel
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  /* config options here */
  // Typecheck is clean — the build must fail on type errors.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // NOTE (2026-08-31): the dev script runs `next dev --webpack` (see
  // package.json) instead of the Turbopack default. Rationale: this box has
  // only 4GB RAM and Turbopack's incremental compiler + hot-module graph
  // consumes ~2.5GB on its own. That memory pressure caused intermittent
  // silent dev-server crashes + RUNTIME ChunkLoadErrors in the browser
  // ("Failed to load chunk /_next/static/chunks/...react-server-dom-turbopack-
  // client...") because the browser held RSC payloads referencing chunks the
  // restarted server no longer served. The webpack dev server is more
  // memory-conservative at the cost of slower cold compiles. A second
  // aggravating factor was the parent-directory bun.lock making Turbopack
  // infer the WRONG workspace root (/home/z/my-project instead of the
  // project dir) — with webpack this inference is irrelevant. Do NOT set
  // `turbopack.root` to the project dir: Turbopack treats it as the
  // workspace root and then fails to resolve next/package.json.
  devIndicators: false,

  // ─── FIX C: /v1 compatibility aliases ────────────────────────────────────
  // Most OpenAI SDKs default to `{baseURL}/chat/completions` where baseURL
  // ends in `/v1` (or they hit `{baseURL}/v1/chat/completions` when given a
  // bare domain). Previously those paths 404'd with an HTML page, which is
  // painful to debug from an app. With these rewrites ANY base-URL convention
  // works:
  //   https://freeaixyz4all.vercel.app            (bare domain)
  //   https://freeaixyz4all.vercel.app/v1         (OpenAI SDK default)
  //   https://freeaixyz4all.vercel.app/api/v1     (canonical)
  // NOTE: rewrites returned as a plain array run AFTER filesystem routes
  // (afterFiles), so the existing /models and /chat PAGES keep winning on
  // their exact paths — only the un-shadowed alias paths below re-route.
  async rewrites() {
    return [
      { source: "/v1/chat/completions", destination: "/api/v1/chat/completions" },
      { source: "/v1/models", destination: "/api/v1/models" },
      { source: "/v1/status", destination: "/api/v1/status" },
      { source: "/v1/tools/execute", destination: "/api/tools/execute" },
      { source: "/chat/completions", destination: "/api/v1/chat/completions" },
      { source: "/api/chat/completions", destination: "/api/v1/chat/completions" },
      { source: "/api/models", destination: "/api/v1/models" },
      { source: "/api/status", destination: "/api/v1/status" },
    ];
  },

  // CORS headers at the routing layer (see comment above).
  async headers() {
    return [
      { source: "/api/:path*", headers: corsHeaders },
      { source: "/v1/:path*", headers: corsHeaders },
      { source: "/health", headers: corsHeaders },
      { source: "/ready", headers: corsHeaders },
    ];
  },
};

export default nextConfig;
