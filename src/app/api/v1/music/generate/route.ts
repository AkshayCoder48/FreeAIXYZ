/**
 * ACE Music API route — generates AI music using ACE-Step 1.5.
 *
 * The API key is AUTO-FETCHED from acemusic.ai on each request.
 * No user input needed — the key is valid per-IP and doesn't require verification.
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
const ACE_PLAYGROUND_URL = "https://acemusic.ai/playground/api-key";

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

/** Auto-fetch an ACE Music API key from the playground page. */
async function fetchAceApiKey(): Promise<string | null> {
  try {
    const res = await fetch(ACE_PLAYGROUND_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Look for API key patterns in the page
    // The key is typically a 32-char hex string
    const keyMatch = html.match(/["'`]([a-f0-9]{32})["'`]/i);
    if (keyMatch) return keyMatch[1];

    // Also try looking in JS chunks
    const scriptMatches = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
    for (const scriptPath of scriptMatches.slice(0, 5)) {
      const url = scriptPath.startsWith("http")
        ? scriptPath
        : `https://acemusic.ai${scriptPath}`;
      const jsRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!jsRes.ok) continue;
      const js = await jsRes.text();
      const jsKeyMatch = js.match(/["'`]([a-f0-9]{32})["'`]/);
      if (jsKeyMatch) return jsKeyMatch[1];
    }

    return null;
  } catch {
    return null;
  }
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

  // Auto-fetch API key (no user input needed)
  const apiKey = await fetchAceApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Could not auto-fetch ACE Music API key. The service may be temporarily unavailable." },
      { status: 503 },
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
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
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
    const audioResults = audios.map((a: { audio_url?: { url?: string } }) => {
      const url = a.audio_url?.url || "";
      const base64 = url.includes(",") ? url.split(",")[1] : url;
      return { audio_base64: base64, format: "mp3" };
    });

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
    auth: "auto-fetched per request (no user input needed)",
    models: ["ace-step-1.5"],
    params: [
      "prompt", "lyrics", "duration", "language", "instrumental",
      "bpm", "key", "seed", "sampleMode", "batchSize",
    ],
    endpoint: "POST /api/v1/music/generate",
  });
}
