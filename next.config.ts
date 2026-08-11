import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use standalone output for Docker/self-hosted, skip for Vercel
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
