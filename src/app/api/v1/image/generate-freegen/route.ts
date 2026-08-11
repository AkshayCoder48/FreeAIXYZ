/**
 * FreeGen AI Image Generation API Route.
 *
 * Interfaces with the FreeGen provider:
 *   - Prompt Signer: https://prompt-signer.freegen.app
 *   - Image Generator: https://image-generator.freegen.app
 *   - WebSocket Bridge: wss://websocket-bridge.freegen.app/ws
 *
 * Because generations are managed in a task queue, this API route
 * communicates with a WebSocket bridge, waiting for the job to complete
 * before returning the final direct URL.
 *
 * Endpoint: POST /api/v1/image/generate-freegen
 * Body: { prompt, size? }
 *
 * Size options: square, widescreen_169, portrait_45, portrait_23,
 *               story_916, landscape_43, landscape_32
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SIGNER_URL = "https://prompt-signer.freegen.app";
const GENERATOR_URL = "https://image-generator.freegen.app";
const WEBSOCKET_URL = "wss://websocket-bridge.freegen.app/ws";

/** Size mapping from friendly names to aspect ratio IDs. */
const SIZE_MAP: Record<string, string> = {
  square: "1:1",
  widescreen_169: "16:9",
  portrait_45: "4:5",
  portrait_23: "2:3",
  story_916: "9:16",
  landscape_43: "4:3",
  landscape_32: "3:2",
};

/**
 * Generate the mandatory Base64 HMAC Signature for WebSocket Bridge Authentication.
 * Formulates: sha256_hex(jobId + timestamp) encoded to base64, sliced to 20 chars,
 * and appended with timestamp.
 */
function createWebSocketAuth(jobId: string, timestamp: number): string {
  const message = jobId + timestamp;
  const hashHex = crypto.createHash("sha256").update(message).digest("hex");
  const b64 = Buffer.from(hashHex).toString("base64");
  return b64.substring(0, 20) + ":" + timestamp;
}

/**
 * Subscribe to a job via WebSocket and wait for the result.
 * Uses a dynamic import for `ws` since it's a Node.js-only module.
 */
async function waitForImageViaWebSocket(
  jobId: string,
  timeoutMs = 35000,
): Promise<string> {
  // Dynamic import of ws (Node.js only)
  const ws = (await import("ws")).default;

  return new Promise<string>((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const auth = createWebSocketAuth(jobId, timestamp);

    const socket = new ws(WEBSOCKET_URL);

    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Image generation task timed out in queue. Please retry."));
    }, timeoutMs);

    socket.on("open", () => {
      console.log(`WS Connected. Subscribing to job ${jobId}...`);
      socket.send(
        JSON.stringify({
          type: "subscribe",
          job_id: jobId,
          auth: auth,
        }),
      );
    });

    socket.on("message", (rawData: Buffer) => {
      try {
        const message = JSON.parse(rawData.toString());

        if (message.type === "status") {
          console.log(
            `Queue Status Update for Job [${jobId}]: ${message.message}`,
          );
        } else if (message.type === "result") {
          clearTimeout(timeout);
          socket.close();
          resolve(message.image_data);
        }
      } catch (e) {
        console.error("Error parsing WebSocket message:", e);
      }
    });

    socket.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket communication error: ${err.message}`));
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, size } = body as { prompt?: string; size?: string };

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    const ratio_id = SIZE_MAP[size || "square"] || "1:1";

    // ── Step 1: Get signed timestamps from signer ──
    console.log(`Step 1: Signing prompt -> "${prompt}"`);
    const signerRes = await fetch(SIGNER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!signerRes.ok) {
      throw new Error(
        `Signer authentication rejected with status ${signerRes.status}`,
      );
    }

    const signerData = (await signerRes.json()) as { ts: number; sig: string };
    const { ts, sig } = signerData;

    // ── Step 2: Submit to generation queue ──
    console.log("Step 2: Submitting job to Generator Queue...");
    const generatorRes = await fetch(GENERATOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ts, sig, ratio_id }),
    });

    if (!generatorRes.ok) {
      const errorJson = await generatorRes.json().catch(() => ({}));
      throw new Error(
        (errorJson as { error?: string }).error ||
          `Generator rejected with status ${generatorRes.status}`,
      );
    }

    const genData = (await generatorRes.json()) as { job_id?: string };
    const jobId = genData.job_id;

    if (!jobId) {
      throw new Error(
        "Server initialized job but returned no queue job_id.",
      );
    }

    console.log(`Step 2 complete. Job ID queued: ${jobId}`);

    // ── Step 3: Establish WebSocket Bridge subscriber ──
    const imageB64Url = await waitForImageViaWebSocket(jobId);

    console.log("Step 3 complete. Image successfully generated.");
    return NextResponse.json({
      success: true,
      data_url: imageB64Url,
      prompt: prompt,
      job_id: jobId,
      size: size || "square",
      ratio_id,
    });
  } catch (err: unknown) {
    console.error("Image Generation Route Error:", err);
    const message = err instanceof Error ? err.message : "Generation processing error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

/** GET endpoint returning usage documentation. */
export async function GET() {
  return NextResponse.json({
    service: "FreeGen Image Generation",
    endpoint: "POST /api/v1/image/generate-freegen",
    params: [
      "prompt (required) — text description of the image to generate",
      "size (optional) — aspect ratio: square, widescreen_169, portrait_45, portrait_23, story_916, landscape_43, landscape_32",
    ],
    sizes: SIZE_MAP,
    providers: {
      signer: SIGNER_URL,
      generator: GENERATOR_URL,
      websocket: WEBSOCKET_URL,
    },
    note: "Generations are queued and results are delivered via WebSocket bridge. No API key required.",
  });
}
