/**
 * Image Analysis API — Casper Technology
 * Upload any image; AI extracts colours, lighting & composition to craft a generation prompt.
 *
 * Endpoint: POST /api/v1/image/analyze
 * Body (multipart/form-data): { image }
 * Body (JSON): { image_url }
 *
 * Proxies to: https://ai-image-gen.xcasper.space/v1/image/analyze/generate
 *
 * Returns: { prompt, palette, ... }
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
      upstreamRes = await fetch(`${CASPER_BASE_URL}/v1/image/analyze/generate`, {
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
      if (body.image_url) formData.append("image_url", body.image_url);

      upstreamRes = await fetch(`${CASPER_BASE_URL}/v1/image/analyze/generate`, {
        method: "POST",
        body: formData,
        signal: request.signal,
      });
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Casper Tech image analysis failed: HTTP ${upstreamRes.status}`, detail: errText.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    return NextResponse.json({
      success: true,
      provider: "casper-tech",
      endpoint: "analyze",
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Image analysis failed: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "Image Analysis (Image-to-Prompt)",
    provider: "Casper Technology",
    endpoint: "POST /api/v1/image/analyze",
    params: ["image_url or image file (required)"],
    upstream: `${CASPER_BASE_URL}/v1/image/analyze/generate`,
    returns: { prompt: "AI-generated prompt describing the image", palette: "Extracted color palette" },
    note: "Upload any image; AI extracts colours, lighting & composition to craft a generation prompt.",
  });
}
