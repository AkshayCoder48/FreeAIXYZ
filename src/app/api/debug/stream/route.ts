/**
 * GET /api/debug/stream — slow SSE diagnostic (PRD §15, §16).
 *
 * Emits 4 SSE events spaced ~1 second apart, then `[DONE]`. Used to detect
 * buffering at every layer between the runtime and the client:
 *
 *   - If events arrive incrementally (one per second), the path is clean.
 *   - If all 4 events arrive together at ~4s, something between the route
 *     handler and the client is buffering the whole stream.
 *
 * The handler sets all the standard SSE-buffering-disabling headers:
 *   - `Content-Type: text/event-stream`
 *   - `Cache-Control: no-cache, no-transform`
 *   - `X-Accel-Buffering: no`    (nginx)
 *   - `Connection: keep-alive`
 *
 * The Promise-based sleep between enqueues forces the runtime to flush each
 * chunk to the network individually.
 */

import { withCors, corsPreflight } from "@/lib/api/cors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "X-No-Buffer": "true",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET /api/debug/stream. */
export async function GET(): Promise<Response> {
  return withCors(await streamDebug());
}

/** CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function streamDebug(): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 1; i <= 4; i++) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: i })}\n\n`),
          );
          await sleep(1000);
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch {
        // controller may already be closed — best-effort.
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, { status: 200, headers: HEADERS });
}
