/**
 * Image Mask Edit API — Casper Technology
 * Edit specific regions of an image using a text prompt and mask.
 *
 * Endpoint: POST /api/v1/image/mask
 * Body (multipart/form-data): { image, mask, prompt }
 * Body (JSON): { image_url, mask_url, prompt }
 *
 * Proxies to: https://ai-image-gen.xcasper.space/v1/image/mask/generate
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
      // Forward multipart directly to Casper Tech
      const formData = await request.formData();
      upstreamRes = await fetch(`${CASPER_BASE_URL}/v1/image/mask/generate`, {
        method: "POST",
        body: formData,
        signal: request.signal,
      });
    } else {
      // JSON body — convert image_url/mask_url fields to multipart
      const body = await request.json();
      if (!body.prompt) {
        return NextResponse.json({ error: "prompt is required" }, { status: 400 });
      }
      if (!body.image_url && !body.image) {
        return NextResponse.json({ error: "image_url or image (file) is required" }, { status: 400 });
      }

      const formData = new FormData();
      formData.append("prompt", body.prompt);
      if (body.image_url) formData.append("image_url", body.image_url);
      if (body.mask_url) formData.append("mask_url", body.mask_url);

      upstreamRes = await fetch(`${CASPER_BASE_URL}/v1/image/mask/generate`, {
        method: "POST",
        body: formData,
        signal: request.signal,
      });
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Casper Tech mask edit failed: HTTP ${upstreamRes.status}`, detail: errText.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    return NextResponse.json({
      success: true,
      provider: "casper-tech",
      endpoint: "mask-edit",
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Mask edit failed: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "Image Mask Edit",
    provider: "Casper Technology",
    endpoint: "POST /api/v1/image/mask",
    params: ["prompt (required)", "image_url or image file", "mask_url or mask file"],
    upstream: `${CASPER_BASE_URL}/v1/image/mask/generate`,
    note: "Accepts multipart/form-data or JSON with image_url/mask_url fields.",
  });
}
