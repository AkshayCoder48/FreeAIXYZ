/**
 * Image Manipulation APIs — Casper Technology
 * Provides: removebg, upscale, deblur, colorize, nanobanana2 edit, faceswap
 *
 * Base URL: https://apis.xcasper.space
 * All endpoints use GET with query parameters.
 */

import { NextRequest, NextResponse } from "next/server";
import { CASPER_BASE_URL } from "@/lib/providers/image-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Map of available Casper Tech image manipulation endpoints
const MANIPULATION_ENDPOINTS: Record<string, {
  path: string;
  description: string;
  params: string[];
}> = {
  removebg: { path: "/api/ai/removebg", description: "Remove image background", params: ["url"] },
  enlarger: { path: "/api/ai/enlarger", description: "Upscale/enlarge image", params: ["url"] },
  unblur: { path: "/api/ai/unblur", description: "Deblur and upscale image", params: ["url", "scale"] },
  unwatermark: { path: "/api/ai/unwatermark", description: "Remove watermarks from image", params: ["url"] },
  colorize: { path: "/api/ai/colorize", description: "Colorize black & white image", params: ["url"] },
  nanobanana2: { path: "/api/ai/nanobanana2", description: "AI image edit with prompt", params: ["url", "prompt"] },
  faceswap: { path: "/api/ai/faceswap", description: "Face swap between two images", params: ["source", "target"] },
  iloveimg: { path: "/api/ai/iloveimg", description: "Compress/resize image", params: ["url", "scale"] },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    if (!action || !MANIPULATION_ENDPOINTS[action]) {
      return NextResponse.json({
        error: `Unknown action "${action}". Available: ${Object.keys(MANIPULATION_ENDPOINTS).join(", ")}`,
        available_actions: Object.entries(MANIPULATION_ENDPOINTS).map(([key, val]) => ({
          action: key,
          description: val.description,
          required_params: val.params,
        })),
      }, { status: 400 });
    }

    const endpoint = MANIPULATION_ENDPOINTS[action];
    const searchParams = new URLSearchParams();

    // Map params to query string
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    }

    // Validate required params
    const url = searchParams.get("url") || searchParams.get("source");
    if (!url && action !== "faceswap") {
      return NextResponse.json({ error: `"url" parameter is required for ${action}` }, { status: 400 });
    }
    if (action === "faceswap" && (!searchParams.get("source") || !searchParams.get("target"))) {
      return NextResponse.json({ error: `"source" and "target" URLs are required for faceswap` }, { status: 400 });
    }

    const upstreamUrl = `${CASPER_BASE_URL}${endpoint.path}?${searchParams}`;
    const res = await fetch(upstreamUrl, { method: "GET", signal: request.signal });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Casper Tech ${action} failed: HTTP ${res.status}`, detail: errText.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({
      success: true,
      provider: "casper-tech",
      action,
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Image manipulation failed: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "Image Manipulation (Casper Tech)",
    provider: "Casper Technology",
    base_url: CASPER_BASE_URL,
    endpoint: "POST /api/v1/image/manipulate",
    note: 'Send { "action": "<action>", ...params } in JSON body.',
    actions: Object.entries(MANIPULATION_ENDPOINTS).map(([key, val]) => ({
      action: key,
      description: val.description,
      required_params: val.params,
      upstream: `${CASPER_BASE_URL}${val.path}`,
    })),
  });
}
