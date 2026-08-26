import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use standalone output for Docker/self-hosted, skip for Vercel
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable Turbopack in the dev sandbox — the box has only 4GB RAM and
  // Turbopack's incremental compiler + hot-module graph consumes ~2.5GB
  // on its own, leaving no headroom for Prisma discovery (which parallel-
  // fetches 9 upstreams and parses large JSON model lists). The webpack
  // dev server is more memory-conservative at the cost of slightly slower
  // cold compiles.
  devIndicators: false,
};

export default nextConfig;
