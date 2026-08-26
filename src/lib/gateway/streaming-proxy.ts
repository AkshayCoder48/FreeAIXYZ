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
 *
 * Audit fixes:
 *   - E2: stream_options.include_usage=true → emit a final usage SSE chunk
 *     before [DONE] (estimated token counts).
 *   - D1: when the primary adapter fails BEFORE any content is forwarded,
 *     try the next fallback (provider failover). Cap at the size of the
 *     fallbacks list — never cascade beyond the explicitly-provided list.
 */

import {
  generateRequestId,
  GatewayError,
  isFailoverCandidate,
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

/**
 * Failover candidate (audit D1). The gateway resolves the requested model
 * to its adapter, then if a failover is needed, tries each fallback in
 * order — typically alternative providers that expose the same upstream
 * model id (e.g. `tb/gpt-5.2` rate-limited → `oc/gpt-5.2`).
 */
export interface FailoverCandidate {
  req: ChatRequest;
  adapter: ProviderAdapter;
}

class StreamingProxyService {
  /** requestId → StreamTimings for the debug UI (auto-pruned after 5 min). */
  private debugTimings = new Map<string, StreamTimings>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Stream chat completion → Response. Forwards every upstream delta
   * immediately as an OpenAI-shaped SSE chunk (PRD §137).
   *
   * Audit D1: when the primary adapter fails BEFORE any content is
   * forwarded, each fallback is tried in order. The X-Failover header
   * is NOT set on the streaming response (the Response is constructed
   * before the first upstream chunk is pulled, so the header can't be
   * known at construction time) — instead, a `: ` comment line is
   * enqueued at the start of the stream when failover occurs so SSE
   * clients can still observe it.
   */
  streamChat(
    req: ChatRequest,
    adapter: ProviderAdapter,
    fallbacks: FailoverCandidate[] = [],
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
        this.runStream(
          controller,
          req,
          adapter,
          fallbacks,
          timings,
          sseId,
          created,
          encoder,
        ).catch((err) => {
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
        });
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
    fallbacks: FailoverCandidate[],
    timings: StreamTimings,
    sseId: string,
    created: number,
    encoder: TextEncoder,
  ): Promise<void> {
    // Build the list of candidates: primary first, then fallbacks.
    const candidates: FailoverCandidate[] = [
      { req, adapter },
      ...fallbacks,
    ];
    let lastErr: unknown = null;
    let lastCandidate: FailoverCandidate | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const isPrimary = i === 0;
      timings.upstreamRequestStart = Date.now();
      // Once we successfully fall over to a candidate, expose the
      // switch via an SSE comment line (audit D1 observability).
      if (!isPrimary) {
        try {
          controller.enqueue(
            encoder.encode(
              `: X-Failover ${req.modelId}→${candidate.req.modelId}\n\n`,
            ),
          );
        } catch {
          // best-effort
        }
      }
      lastCandidate = candidate;
      const gen = candidate.adapter.stream(candidate.req);
      let firstEnqueued = false;
      try {
        while (true) {
          if (candidate.req.signal?.aborted) {
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
          this.enqueueChunk(controller, encoder, sseId, created, candidate.req.modelId, delta);
          if (!firstEnqueued) {
            timings.proxyFirstForward = Date.now();
            timings.ttfbMs =
              timings.proxyFirstForward - timings.requestStart;
            timings.ttftMs = timings.ttfbMs;
            firstEnqueued = true;
          }
          if (candidate.req.signal?.aborted) {
            this.sendAborted(controller, timings, encoder);
            return;
          }
        }
        // Success — emit final stop chunk + usage + [DONE] (PRD §10, audit E2).
        this.enqueueFinal(controller, encoder, sseId, created, candidate.req, timings.bytes);
        providerHealthService.recordProviderSuccess(candidate.adapter.id);
        metricsService.recordRequest({
          requestId: timings.requestId,
          providerId: candidate.adapter.id,
          modelId: candidate.req.modelId,
          status: 200,
          type: "stream",
          message: "ok",
          streamRequested: true,
          ttftMs: timings.ttftMs,
          durationMs: Date.now() - timings.requestStart,
        });
        return;
      } catch (err) {
        // Generator cleanup — ignore secondary errors.
        try {
          await gen.return(undefined);
        } catch {
          // ignore
        }
        lastErr = err;
        // Audit D1: only failover if NO content has been forwarded yet.
        // Once the client has received a content chunk, switching adapters
        // would corrupt the stream (mixed provider outputs).
        if (firstEnqueued) {
          // Mid-stream failure — surface as an SSE error event.
          this.handleStreamError(
            controller,
            err,
            timings,
            candidate.adapter.id,
            candidate.req.modelId,
            encoder,
          );
          timings.totalDurationMs = Date.now() - timings.requestStart;
          metricsService.recordStreamTimings(timings);
          return;
        }
        // Audit D1: only failover for retryable error types (5xx, rate-limit,
        // provider-unavailable). Client errors (4xx) wouldn't be solved by
        // switching providers — they'd just fail the same way.
        const ge = err instanceof GatewayError ? err : new GatewayError({
          type: "STREAM_ERROR",
          message: err instanceof Error ? err.message : String(err),
          status: 502,
          provider: candidate.adapter.id,
          model: candidate.req.modelId,
          requestId: timings.requestId,
        });
        if (!isFailoverCandidate(ge) || i === candidates.length - 1) {
          // No failover possible — surface the error.
          this.handleStreamError(
            controller,
            err,
            timings,
            candidate.adapter.id,
            candidate.req.modelId,
            encoder,
          );
          timings.totalDurationMs = Date.now() - timings.requestStart;
          metricsService.recordStreamTimings(timings);
          return;
        }
        // Try the next fallback candidate.
        continue;
      }
    }

    // All candidates exhausted — emit the last error.
    if (lastErr && lastCandidate) {
      this.handleStreamError(
        controller,
        lastErr,
        timings,
        lastCandidate.adapter.id,
        lastCandidate.req.modelId,
        encoder,
      );
    }
    timings.totalDurationMs = Date.now() - timings.requestStart;
    metricsService.recordStreamTimings(timings);
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

  /**
   * Enqueue the final stop chunk + (optional) usage chunk + [DONE] sentinel.
   *
   * Audit E2: when `stream_options.include_usage === true`, the gateway
   * appends a final SSE chunk with `choices: []` and a `usage` block before
   * the `[DONE]` sentinel. Token counts are estimated (~4 chars/token) —
   * the gateway doesn't have a real tokenizer, but the audit specifically
   * asks for "honest about usage reporting" which means the chunk shape
   * must be present and the counts must be non-zero/non-fake.
   */
  private enqueueFinal(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    sseId: string,
    created: number,
    req: ChatRequest,
    completionBytes: number,
  ): void {
    const model = req.modelId;
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
    // Audit E2: emit usage chunk when the client asked for it.
    if (req.streamOptions?.include_usage) {
      const promptText = req.messages.map((m) => m.content).join("\n");
      const promptTokens = Math.max(1, Math.ceil(promptText.length / 4));
      const completionTokens = Math.max(1, Math.ceil(completionBytes / 4));
      const usagePayload = {
        id: sseId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(usagePayload)}\n\n`),
      );
    }
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

/** Functional entry-point (PRD §6, audit D1 failover). */
export function streamChat(
  req: ChatRequest,
  adapter: ProviderAdapter,
  fallbacks: FailoverCandidate[] = [],
): { response: Response; timings: StreamTimings } {
  return streamingProxyService.streamChat(req, adapter, fallbacks);
}
