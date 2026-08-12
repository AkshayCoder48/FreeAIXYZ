/**
 * Image Variation API — Casper Technology
 * Generate creative variations from a reference image.
 *
 * Endpoint: POST /api/v1/image/variation
 * Body (multipart/form-data): { image, prompt? }
 * Body (JSON): { image_url, prompt? }
 *
 * Proxies to: https://ai-image-gen.xcasper.space/v1/image/variation/generate
 */

import { NextRequest, NextResponse } from "next/server";
import { CASPER_BASE_URL } from "@/lib/providers/image-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  try {
    let upstreamRes: Response;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      upstreamRes = await fetch(`${CASPER_BASE_URL}/v1/image/variation/generate`, {
        method: "POST",
        body: formData,
        signal: request.signal,
      });
    } else {
      const body = await request.json();
      if (!body.image_url && !body.image) {
        return NextResponse.json({ error: "image_url or image (file) is required" }, { status: 400 });
      }

      const formData = new FormData();
      if (body.prompt) formData.append("prompt", body.prompt);
      if (body.image_url) formData.append("image_url", body.image_url);

      upstreamRes = await fetch(`${CASPER_BASE_URL}/v1/image/variation/generate`, {
        method: "POST",
        body: formData,
        signal: request.signal,
      });
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Casper Tech variation failed: HTTP ${upstreamRes.status}`, detail: errText.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    return NextResponse.json({
      success: true,
      provider: "casper-tech",
      endpoint: "variation",
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
    params: ["image_url or image file (required)", "prompt (optional)"],
    upstream: `${CASPER_BASE_URL}/v1/image/variation/generate`,
    note: "Generates creative variations from a reference image.",
  });
}
