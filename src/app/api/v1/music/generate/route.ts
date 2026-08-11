/**
 * ACE Music API route — generates AI music using ACE-Step 1.5.
 *
 * Uses a real API key.
 *
 * Endpoint: POST /api/v1/music/generate
 * Body: { prompt, lyrics?, duration?, language?, instrumental?, bpm?, key?, seed? }
 * Response: { success, audios: [{audio_base64, format}], metadata }
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACE_API_URL = "https://api.acemusic.ai/v1/chat/completions";

// Real ACE Music API key
const ACE_API_KEY = "cf3c582f94c44cf3a3fb1f7a6ab916d0";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://acemusic.ai",
  Referer: "https://acemusic.ai/",
};

interface MusicRequest {
  prompt: string;
  lyrics?: string;
  duration?: number;
  language?: string;
  instrumental?: boolean;
  bpm?: number;
  key?: string;
  seed?: number;
  sampleMode?: boolean;
  batchSize?: number;
}

export async function POST(request: Request) {
  let body: MusicRequest;
  try {
    body = (await request.json()) as MusicRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.prompt && !body.lyrics && !body.sampleMode) {
    return NextResponse.json(
      { error: "Either prompt, lyrics, or sampleMode is required" },
      { status: 400 },
    );
  }

  // Build the message content
  let content: string;
  if (body.prompt && body.lyrics) {
    content = `<prompt>${body.prompt}</prompt>\n<lyrics>${body.lyrics}</lyrics>`;
  } else if (body.lyrics) {
    content = body.lyrics;
  } else {
    content = body.prompt || "Generate a song";
  }

  // Build audio_config
  const audioConfig: Record<string, unknown> = {
    vocal_language: body.language || "en",
    format: "mp3",
  };
  if (body.duration) audioConfig.duration = body.duration;
  if (body.bpm) audioConfig.bpm = body.bpm;
  if (body.instrumental) audioConfig.instrumental = true;
  if (body.key) audioConfig.key_scale = body.key;

  // Build request body
  const requestBody: Record<string, unknown> = {
    messages: [{ role: "user", content }],
    audio_config: audioConfig,
    stream: false,
  };
  if (body.sampleMode) requestBody.sample_mode = true;
  if (body.seed) requestBody.seed = body.seed;
  if (body.batchSize && body.batchSize > 1) requestBody.batch_size = body.batchSize;

  try {
    const res = await fetch(ACE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACE_API_KEY}`,
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(110000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `ACE Music API error (${res.status}): ${errText.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const data = await res.json();

    // Extract audio and metadata
    const choice = data.choices?.[0]?.message;
    const audios = choice?.audio || [];
    const metadata = choice?.content || "";

    if (audios.length === 0) {
      return NextResponse.json(
        { error: "No audio in response", raw: JSON.stringify(data).slice(0, 500) },
        { status: 502 },
      );
    }

    // Extract base64 audio
    const audioResults = audios.map(
      (a: { audio_url?: { url?: string } }) => {
        const url = a.audio_url?.url || "";
        const base64 = url.includes(",") ? url.split(",")[1] : url;
        return { audio_base64: base64, format: "mp3" };
      },
    );

    return NextResponse.json({
      success: true,
      audios: audioResults,
      metadata,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Music generation failed: ${message}` },
      { status: 500 },
    );
  }
}

/** GET — return API status */
export async function GET() {
  return NextResponse.json({
    service: "ACE Music Generation",
    auth: "real API key (embedded)",
    models: ["ace-step-1.5"],
    params: [
      "prompt", "lyrics", "duration", "language", "instrumental",
      "bpm", "key", "seed", "sampleMode", "batchSize",
    ],
    endpoint: "POST /api/v1/music/generate",
  });
}
