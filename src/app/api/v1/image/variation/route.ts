/**
 * Image Variation API — Casper Technology
 * Uses the nanobanana2 endpoint for AI-driven image variation/editing.
 *
 * Endpoint: POST /api/v1/image/variation
 * Body (JSON): { url, prompt? }
 *
 * Upstream: GET https://apis.xcasper.space/api/ai/nanobanana2?url=...&prompt=...
 */

import { NextRequest, NextResponse } from "next/server";
import { CASPER_BASE_URL } from "@/lib/providers/image-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.url && !body.image_url) {
      return NextResponse.json({ error: "url or image_url is required" }, { status: 400 });
    }

    const imageUrl = body.url || body.image_url;
    const params = new URLSearchParams({ url: imageUrl });
    if (body.prompt) params.set("prompt", body.prompt);

    const upstreamUrl = `${CASPER_BASE_URL}/api/ai/nanobanana2?${params}`;
    const res = await fetch(upstreamUrl, { method: "GET", signal: request.signal });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Casper Tech variation failed: HTTP ${res.status}`, detail: errText.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = await res.json();
    return NextResponse.json({
      success: true,
      provider: "casper-tech",
      action: "variation",
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Image variation failed: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "Image Variation",
    provider: "Casper Technology",
    endpoint: "POST /api/v1/image/variation",
    params: ["url (required)", "prompt (optional)"],
    upstream: `${CASPER_BASE_URL}/api/ai/nanobanana2`,
    note: "Generates creative variations from a reference image using AI editing.",
  });
}
