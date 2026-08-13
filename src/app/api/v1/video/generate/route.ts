/**
 * Video Generation API — Disabled
 *
 * All video generation providers have been removed.
 * This endpoint returns a 503 error for POST requests and a disabled status for GET.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "No video generation providers available. Video generation has been disabled.",
      hint: "Video generation providers have been removed. Check back later for new providers.",
    },
    { status: 503 },
  );
}

export async function GET() {
  return NextResponse.json({
    service: "Video Generation",
    total_models: 0,
    status: "disabled",
    message: "Video generation is currently unavailable. Previously supported providers have been removed.",
  });
}
