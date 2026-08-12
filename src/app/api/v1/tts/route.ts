/**
 * TTS API — Text-to-Speech using Kokoro (JARVIS-style).
 *
 * Free, unlimited, no API key. Powered by Kokoro TTS.
 *
 * Endpoint: POST /api/v1/tts
 * Body: { text, voice?, language?, speed? }
 * Response: { success, audio_base64, format, duration_ms }
 *
 * GET /api/v1/tts — returns service info.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KOKORO_API_URL = "https://kokoro-tts-api-2e6e6c6f0dc5.herokuapp.com/api/v1/tts";

interface TTSRequest {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
}

export async function POST(request: Request) {
  let body: TTSRequest;
  try {
    body = (await request.json()) as TTSRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "`text` is required" }, { status: 400 });
  }

  if (body.text.length > 5000) {
    return NextResponse.json(
      { error: "Text too long (max 5000 characters)" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(KOKORO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FreeAI4All-TTS/1.0",
      },
      body: JSON.stringify({
        text: body.text.trim(),
        voice: body.voice || "af_bella",
        speed: body.speed || 1.0,
        language: body.language || "en-us",
      }),
      signal: AbortSignal.timeout(50000),
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      // If response is audio binary
      if (contentType.includes("audio") || contentType.includes("octet-stream")) {
        const audioBuf = await res.arrayBuffer();
        const base64 = Buffer.from(audioBuf).toString("base64");
        return NextResponse.json({
          success: true,
          audio_base64: base64,
          format: "wav",
          duration_ms: 0,
        });
      }
      // If JSON response
      const data = await res.json();
      if (data.audio_base64 || data.audio) {
        return NextResponse.json({
          success: true,
          audio_base64: data.audio_base64 || data.audio,
          format: data.format || "wav",
          duration_ms: data.duration_ms || 0,
        });
      }
      if (data.url || data.audio_url) {
        const audioRes = await fetch(data.url || data.audio_url);
        const audioBuf = await audioRes.arrayBuffer();
        const base64 = Buffer.from(audioBuf).toString("base64");
        return NextResponse.json({
          success: true,
          audio_base64: base64,
          format: "wav",
          duration_ms: 0,
        });
      }
    }

    // Fallback: use z-ai-web-dev-sdk TTS via CLI
    try {
      const { execSync } = await import("child_process");
      const output = execSync(
        `z-ai-web-dev-sdk tts --text "${body.text.trim().replace(/"/g, '\\"').slice(0, 1000)}" --voice "${body.voice || "alloy"}" --speed ${body.speed || 1.0}`,
        { timeout: 45000, encoding: "base64" },
      );
      if (output) {
        return NextResponse.json({
          success: true,
          audio_base64: output,
          format: "mp3",
          duration_ms: 0,
          source: "z-ai-sdk",
        });
      }
    } catch {
      // SDK fallback failed too
    }

    return NextResponse.json({
      error: "TTS service currently unavailable.",
      hint: "Try again later or use a shorter text input.",
    }, { status: 503 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `TTS failed: ${message}` },
      { status: 500 },
    );
  }
}

/** GET — return API status */
export async function GET() {
  return NextResponse.json({
    service: "JARVIS TTS (Kokoro)",
    description: "Free text-to-speech API powered by Kokoro TTS. Natural human-like voice in any language.",
    auth: "None required",
    params: ["text (required)", "voice (default: af_bella)", "language (default: en-us)", "speed (default: 1.0)"],
    endpoint: "POST /api/v1/tts",
    voices: ["af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael"],
  });
}
