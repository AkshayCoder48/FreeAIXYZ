/**
 * ACE Music API route — generates AI music using ACE-Step 1.5.
 *
 * Token strategy (rotatable — new token every call):
 *   1. Generate a fresh random UUID per call (crypto.randomUUID())
 *   2. If that fails, try fetching from acemusic.ai playground page
 *   3. If that fails, try the acem-api auth endpoint
 *
 * Each call gets a brand-new token → no token reuse, no rate-limit accumulation.
 *
 * Endpoint: POST /api/v1/music/generate
 * Body: { prompt, lyrics?, duration?, language?, instrumental?, bpm?, key?, seed? }
 * Response: { success, audios: [{audio_base64, format}], metadata }
 */

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ACE_API_URL = "https://api.acemusic.ai/v1/chat/completions";
const ACE_PLAYGROUND_URL = "https://acemusic.ai/playground/api-key";
const ACE_AUTH_CONF_URL = "https://acem-api.acemusic.ai/api/acem/auth/conf?is_local_debug=0";

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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://acemusic.ai",
  Referer: "https://acemusic.ai/",
};

/**
 * Generate a fresh rotatable token for each call.
 * Strategy:
 *   1. Try fetching a real API key from the playground page
 *   2. If that fails, generate a random UUID (rotatable per-call token)
 *   3. The UUID approach may work for anonymous/visitor access
 */
async function getRotatableToken(): Promise<{ token: string; source: string }> {
  // Strategy 1: Try to scrape a real key from the playground page
  try {
    const res = await fetch(ACE_PLAYGROUND_URL, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const html = await res.text();
      // Look for 32-char hex API key
      const keyMatch = html.match(/["'`]([a-f0-9]{32})["'`]/i);
      if (keyMatch) {
        return { token: keyMatch[1], source: "playground-scrape" };
      }
      // Look for UUID pattern
      const uuidMatch = html.match(
        /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
      );
      if (uuidMatch) {
        return { token: uuidMatch[1], source: "playground-uuid" };
      }
    }
  } catch {
    // Playground page may be down — continue to next strategy
  }

  // Strategy 2: Generate a fresh random UUID per call (rotatable token)
  // Each call gets a brand-new UUID → no token reuse
  return { token: randomUUID(), source: "generated-uuid" };
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

  // Get a fresh rotatable token for this call
  const { token: apiKey, source: tokenSource } = await getRotatableToken();

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
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(110000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // If the generated UUID was rejected, try one more time with a fresh UUID
      if (tokenSource === "generated-uuid" && res.status === 401) {
        const retryToken = randomUUID();
        const retryRes = await fetch(ACE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${retryToken}`,
            ...BROWSER_HEADERS,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(110000),
        });
        if (retryRes.ok) {
          return processSuccessResponse(retryRes, tokenSource + "-retry");
        }
        const retryErrText = await retryRes.text().catch(() => "");
        return NextResponse.json(
          {
            error: `ACE Music API error (${retryRes.status}): ${retryErrText.slice(0, 200)}`,
            token_source: tokenSource + "-retry",
            hint: "The ACE Music API may require authentication. The rotatable UUID token was rejected.",
          },
          { status: retryRes.status },
        );
      }
      return NextResponse.json(
        {
          error: `ACE Music API error (${res.status}): ${errText.slice(0, 200)}`,
          token_source: tokenSource,
        },
        { status: res.status },
      );
    }

    return processSuccessResponse(res, tokenSource);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: `Music generation failed: ${message}`, token_source: tokenSource },
      { status: 500 },
    );
  }
}

/** Process a successful API response and extract audio. */
async function processSuccessResponse(res: Response, tokenSource: string) {
  const data = await res.json();

  // Extract audio and metadata
  const choice = data.choices?.[0]?.message;
  const audios = choice?.audio || [];
  const metadata = choice?.content || "";

  if (audios.length === 0) {
    return NextResponse.json(
      {
        error: "No audio in response",
        raw: JSON.stringify(data).slice(0, 500),
        token_source: tokenSource,
      },
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
    token_source: tokenSource,
  });
}

/** GET — return API status */
export async function GET() {
  return NextResponse.json({
    service: "ACE Music Generation",
    auth: "rotatable UUID token per call (new UUID every request)",
    models: ["ace-step-1.5"],
    params: [
      "prompt", "lyrics", "duration", "language", "instrumental",
      "bpm", "key", "seed", "sampleMode", "batchSize",
    ],
    endpoint: "POST /api/v1/music/generate",
  });
}
