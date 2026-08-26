/**
 * StreamingProxyService (PRD §6, §10, §11, §13, §137, §211-215).
 *
 * The HEART of the streaming fix. Builds a ReadableStream<Uint8Array>
 * that forwards every upstream delta to the client immediately as an
 * OpenAI-shaped SSE chunk — NO buffering, NO re-pacing, NO sleep (PRD §137).
 *
 * For non-streaming providers (capabilities.streaming=false), the legacy
 * adapter yields the full text as a single delta; we emit it honestly as
 * one content chunk + stop — never fake-stream (PRD §137).
 *
 * Records StreamTimings for the debug UI (/api/debug/stream, PRD §6).
 */

import {
  generateRequestId,
  GatewayError,
  sseErrorEvent,
} from "@/lib/gateway/errors";
import { providerHealthService } from "@/lib/gateway/health";
import { metricsService } from "@/lib/gateway/metrics";
import type {
  ChatRequest,
  ProviderAdapter,
  StreamTimings,
} from "@/lib/gateway/types";

const DEBUG_TIMINGS_TTL_MS = 5 * 60 * 1000; // PRD §6 — 5 min
const DEBUG_PRUNE_INTERVAL_MS = 60_000;

/** Headers that disable all known SSE-buffering layers (PRD §11, §12). */
export const STREAM_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "X-No-Buffer": "true",
};

class StreamingProxyService {
  /** requestId → StreamTimings for the debug UI (auto-pruned after 5 min). */
  private debugTimings = new Map<string, StreamTimings>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Stream chat completion → Response. Forwards every upstream delta
   * immediately as an OpenAI-shaped SSE chunk (PRD §137).
   */
  streamChat(
    req: ChatRequest,
    adapter: ProviderAdapter,
  ): { response: Response; timings: StreamTimings } {
    const requestId = generateRequestId();
    const now = Date.now();
    const created = Math.floor(now / 1000);
    const sseId = `chatcmpl-${requestId}`;
    const encoder = new TextEncoder();
    const timings: StreamTimings = {
      requestId,
      requestStart: now,
      chunkCount: 0,
      bytes: 0,
      providerId: adapter.id,
      modelId: req.modelId,
      streamRequested: true,
    };
    this.debugTimings.set(requestId, timings);
    this.schedulePrune();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.runStream(controller, req, adapter, timings, sseId, created, encoder).catch(
          (err) => {
            this.handleStreamError(
              controller,
              err,
              timings,
              adapter.id,
              req.modelId,
              encoder,
            );
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
        );
      },
      cancel: () => {
        // Client disconnected — surface as aborted (PRD §59, §212).
        timings.error = "client-aborted";
        timings.clientLatencyMs = Date.now() - timings.requestStart;
      },
    });

    return {
      response: new Response(stream, {
        status: 200,
        headers: STREAM_HEADERS,
      }),
      timings,
    };
  }

  /** Main streaming loop — never re-paces, never buffers (PRD §137). */
  private async runStream(
    controller: ReadableStreamDefaultController<Uint8Array>,
    req: ChatRequest,
    adapter: ProviderAdapter,
    timings: StreamTimings,
    sseId: string,
    created: number,
    encoder: TextEncoder,
  ): Promise<void> {
    timings.upstreamRequestStart = Date.now();
    const gen = adapter.stream(req);
    let firstEnqueued = false;
    try {
      while (true) {
        // Check abort BEFORE pulling the next chunk (PRD §59, §212).
        if (req.signal?.aborted) {
          this.sendAborted(controller, timings, encoder);
          return;
        }
        const next = await gen.next();
        if (next.done) break;
        const delta = next.value;
        if (!delta) continue;
        if (timings.upstreamFirstChunk === undefined) {
          timings.upstreamFirstChunk = Date.now();
        }
        timings.chunkCount += 1;
        timings.bytes += byteLength(delta);
        this.enqueueChunk(controller, encoder, sseId, created, req.modelId, delta);
        if (!firstEnqueued) {
          timings.proxyFirstForward = Date.now();
          timings.ttfbMs =
            timings.proxyFirstForward - timings.requestStart;
          timings.ttftMs = timings.ttfbMs;
          firstEnqueued = true;
        }
        if (req.signal?.aborted) {
          this.sendAborted(controller, timings, encoder);
          return;
        }
      }
      // Final stop chunk + [DONE] sentinel (PRD §10).
      this.enqueueFinal(controller, encoder, sseId, created, req.modelId);
      providerHealthService.recordProviderSuccess(adapter.id);
      metricsService.recordRequest({
        requestId: timings.requestId,
        providerId: adapter.id,
        modelId: req.modelId,
        status: 200,
        type: "stream",
        message: "ok",
        streamRequested: true,
        ttftMs: timings.ttftMs,
        durationMs: Date.now() - timings.requestStart,
      });
    } finally {
      try {
        await gen.return(undefined);
      } catch {
        // generator cleanup — ignore
      }
      timings.totalDurationMs = Date.now() - timings.requestStart;
      metricsService.recordStreamTimings(timings);
    }
  }

  /** Emit a STREAM_ABORTED error event (PRD §59, §212). */
  private sendAborted(
    controller: ReadableStreamDefaultController<Uint8Array>,
    timings: StreamTimings,
    encoder: TextEncoder,
  ): void {
    const err = new GatewayError({
      type: "STREAM_ABORTED",
      message: "Client aborted the stream.",
      status: 499,
      requestId: timings.requestId,
    });
    try {
      controller.enqueue(encoder.encode(sseErrorEvent(err)));
    } catch {
      // controller may be closed — best-effort.
    }
    timings.error = "aborted";
  }

  /** Catch-all error handler — emit SSE error event + record health/metrics. */
  private handleStreamError(
    controller: ReadableStreamDefaultController<Uint8Array>,
    err: unknown,
    timings: StreamTimings,
    providerId: string,
    modelId: string,
    encoder: TextEncoder,
  ): void {
    const ge =
      err instanceof GatewayError
        ? err
        : new GatewayError({
            type: "STREAM_ERROR",
            message: err instanceof Error ? err.message : String(err),
            status: 502,
            provider: providerId,
            model: modelId,
            requestId: timings.requestId,
          });
    timings.error = ge.message;
    try {
      controller.enqueue(encoder.encode(sseErrorEvent(ge)));
    } catch {
      // best-effort
    }
    providerHealthService.recordProviderFailure(providerId, err);
    providerHealthService.recordModelFailure(modelId, err);
    metricsService.recordRequest({
      requestId: timings.requestId,
      providerId,
      modelId,
      status: ge.status,
      type: "stream_error",
      message: ge.message,
      streamRequested: true,
      ttftMs: timings.ttftMs,
      durationMs: Date.now() - timings.requestStart,
    });
  }

  /** Enqueue one OpenAI-shaped content-delta chunk (PRD §137 — no buffering). */
  private enqueueChunk(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    sseId: string,
    created: number,
    model: string,
    delta: string,
  ): void {
    const payload = {
      id: sseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        { index: 0, delta: { content: delta }, finish_reason: null },
      ],
    };
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    controller.enqueue(encoder.encode(line));
  }

  /** Enqueue the final stop chunk + [DONE] sentinel. */
  private enqueueFinal(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    sseId: string,
    created: number,
    model: string,
  ): void {
    const payload = {
      id: sseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  }

  /** Get the timings for a recent request (debug UI, PRD §6). */
  getTimings(requestId: string): StreamTimings | undefined {
    return this.debugTimings.get(requestId);
  }

  /** Snapshot of all recent timings (debug UI). */
  listTimings(): StreamTimings[] {
    return Array.from(this.debugTimings.values());
  }

  /** Schedule periodic pruning of stale debug timings. */
  private schedulePrune(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      const cutoff = Date.now() - DEBUG_TIMINGS_TTL_MS;
      for (const [id, t] of this.debugTimings) {
        if (t.requestStart < cutoff) this.debugTimings.delete(id);
      }
      if (this.debugTimings.size === 0 && this.pruneTimer) {
        clearInterval(this.pruneTimer);
        this.pruneTimer = null;
      }
    }, DEBUG_PRUNE_INTERVAL_MS);
    if (typeof this.pruneTimer.unref === "function") {
      this.pruneTimer.unref();
    }
  }
}

/** UTF-8 byte length (Node runtime; Buffer is available). */
function byteLength(s: string): number {
  if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8");
  // Edge-runtime fallback (text/encode).
  return new TextEncoder().encode(s).length;
}

// globalThis-backed singleton (see catalog.ts / registry.ts for the pattern).
const globalForStreamingProxy = globalThis as unknown as {
  __freeaixyzStreamingProxyService?: StreamingProxyService;
};

export const streamingProxyService: StreamingProxyService =
  globalForStreamingProxy.__freeaixyzStreamingProxyService ??
  new StreamingProxyService();

if (!globalForStreamingProxy.__freeaixyzStreamingProxyService) {
  globalForStreamingProxy.__freeaixyzStreamingProxyService = streamingProxyService;
}

/** Functional entry-point (PRD §6). */
export function streamChat(
  req: ChatRequest,
  adapter: ProviderAdapter,
): { response: Response; timings: StreamTimings } {
  return streamingProxyService.streamChat(req, adapter);
}
