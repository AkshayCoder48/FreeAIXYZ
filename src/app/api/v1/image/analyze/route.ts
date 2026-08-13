/**
 * Image Analysis API — Casper Technology
 * Provides image analysis tools: removebg detection, colorize, upscale info.
 *
 * Endpoint: POST /api/v1/image/analyze
 * Body (JSON): { url, action? }
 *
 * Actions:
 *   - colorize   — Colorize a B&W image
 *   - removebg   — Remove background (returns foreground image)
 *   - enlarger   — Upscale image
 *   - unblur     — Deblur and upscale
 *
 * Upstream base: https://apis.xcasper.space/api/ai/
 */

import { NextRequest, NextResponse } from "next/server";
import { CASPER_BASE_URL } from "@/lib/providers/image-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ANALYZE_ACTIONS: Record<string, string> = {
  colorize: "/api/ai/colorize",
  removebg: "/api/ai/removebg",
  enlarger: "/api/ai/enlarger",
  unblur: "/api/ai/unblur",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.url && !body.image_url) {
      return NextResponse.json({ error: "url or image_url is required" }, { status: 400 });
    }

    const imageUrl = body.url || body.image_url;
    const action = body.action || "removebg";

    if (!ANALYZE_ACTIONS[action]) {
      return NextResponse.json({
        error: `Unknown action "${action}". Available: ${Object.keys(ANALYZE_ACTIONS).join(", ")}`,
      }, { status: 400 });
    }

    const params = new URLSearchParams({ url: imageUrl });
    if (body.scale) params.set("scale", String(body.scale));

    const upstreamUrl = `${CASPER_BASE_URL}${ANALYZE_ACTIONS[action]}?${params}`;
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
    return NextResponse.json({ error: `Image analysis failed: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "Image Analysis (Casper Tech)",
    provider: "Casper Technology",
    endpoint: "POST /api/v1/image/analyze",
    params: ["url (required)", "action (optional, default: removebg)", "scale (optional, for unblur)"],
    actions: Object.entries(ANALYZE_ACTIONS).map(([key, path]) => ({
      action: key,
      upstream: `${CASPER_BASE_URL}${path}`,
    })),
    note: "Upload any image URL; choose an action (colorize, removebg, enlarger, unblur).",
  });
}
