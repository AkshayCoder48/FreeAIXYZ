import type { NextConfig } from "next";

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
};

export default nextConfig;
