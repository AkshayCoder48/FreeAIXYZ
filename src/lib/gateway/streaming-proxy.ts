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
  emptyUpstreamResponseError,
  errorResponse,
  generateRequestId,
  GatewayError,
  sseErrorEvent,
  sseTerminalErrorChunk,
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
   * R-2 (TRUE FIX — pre-flight): before opening a 200 OK SSE stream, we
   * await the upstream's first chunk (or first throw). If the upstream
   * fails BEFORE yielding any content, we return a real HTTP error
   * Response (404/502/429/401/…) with a JSON body — we do NOT open a
   * 200 OK stream and then deliver the error as an in-band `event: error`
   * frame (which clients can't classify because the HTTP status is 200,
   * producing the dreaded `Status: N/A` rendering). Mid-stream errors
   * (after at least one content chunk has been forwarded) keep the
   * existing `event: error` + terminal-chunk behavior.
   *
   * Audit D1: failover candidates are tried in order during the pre-flight.
   * The X-Failover marker is emitted as an SSE comment line at the start
   * of the stream when failover occurs.
   */
  async streamChat(
    req: ChatRequest,
    adapter: ProviderAdapter,
    fallbacks: FailoverCandidate[] = [],
  ): Promise<{ response: Response; timings: StreamTimings }> {
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

    const candidates: FailoverCandidate[] = [{ req, adapter }, ...fallbacks];

    // ─── PRE-FLIGHT: try each candidate until one yields a first chunk ───
    // R-2: pre-first-token errors get a real HTTP status, NOT a 200 OK
    // SSE stream with an in-band event:error frame.
    let firstDelta: string | null = null;
    let successGen: AsyncGenerator<string, void, unknown> | null = null;
    let successCandidate: FailoverCandidate | null = null;
    let preflightErr: GatewayError | null = null;
    let failoverOccurred = false;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const isPrimary = i === 0;
      timings.upstreamRequestStart = timings.upstreamRequestStart ?? Date.now();
      let gen: AsyncGenerator<string, void, unknown>;
      try {
        gen = candidate.adapter.stream(candidate.req);
      } catch (err) {
        preflightErr = this.wrapUnknownStreamErr(
          err,
          candidate,
          timings.requestId,
        );
        failoverOccurred = !isPrimary || failoverOccurred;
        continue;
      }
      try {
        const first = await gen.next();
        if (first.done) {
          // Generator returned without yielding anything → empty upstream.
          preflightErr = emptyUpstreamResponseError(
            candidate.adapter.id,
            candidate.req.modelId,
          );
          try { await gen.return(undefined); } catch { /* ignore */ }
          failoverOccurred = !isPrimary || failoverOccurred;
          continue;
        }
        // Pre-flight succeeded — this candidate is the winner.
        firstDelta = first.value;
        successGen = gen;
        successCandidate = candidate;
        timings.upstreamFirstChunk = Date.now();
        if (!isPrimary) failoverOccurred = true;
        break;
      } catch (err) {
        // Pre-first-token throw → try next candidate (audit D1 failover).
        preflightErr = this.wrapUnknownStreamErr(
          err,
          candidate,
          timings.requestId,
        );
        try { await gen.return(undefined); } catch { /* ignore */ }
        failoverOccurred = !isPrimary || failoverOccurred;
        continue;
      }
    }

    // ─── PRE-FLIGHT FAILED → return real HTTP error Response (R-2) ───
    if (successGen === null || successCandidate === null || firstDelta === null) {
      const err =
        preflightErr ??
        new GatewayError({
          type: "UPSTREAM_5XX",
          status: 502,
          code: "upstream_error",
          message: "Upstream provider failed to generate a response.",
          provider: adapter.id,
          model: req.modelId,
          requestId: timings.requestId,
        });
      timings.error = err.message;
      timings.totalDurationMs = Date.now() - timings.requestStart;
      providerHealthService.recordProviderFailure(
        successCandidate?.adapter.id ?? adapter.id,
        err,
      );
      providerHealthService.recordModelFailure(
        successCandidate?.req.modelId ?? req.modelId,
        err,
      );
      metricsService.recordRequest({
        requestId: timings.requestId,
        providerId: successCandidate?.adapter.id ?? adapter.id,
        modelId: successCandidate?.req.modelId ?? req.modelId,
        status: err.status,
        type: "stream_error",
        message: err.message,
        streamRequested: true,
        durationMs: timings.totalDurationMs,
      });
      metricsService.recordStreamTimings(timings);
      return { response: errorResponse(err), timings };
    }

    // ─── PRE-FLIGHT SUCCEEDED → open 200 OK SSE stream ───
    const finalCandidate = successCandidate;
    const gen = successGen;
    const bufferedFirstDelta = firstDelta;
    const emitFailoverMarker = failoverOccurred;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.runStreamAfterPreflight(
          controller,
          finalCandidate,
          gen,
          bufferedFirstDelta,
          emitFailoverMarker,
          timings,
          sseId,
          created,
          encoder,
        ).catch((err) => {
          this.handleStreamError(
            controller,
            err,
            timings,
            finalCandidate.adapter.id,
            finalCandidate.req.modelId,
            encoder,
            sseId,
            created,
          );
          try { controller.close(); } catch { /* already closed */ }
        });
      },
      cancel: () => {
        // Client disconnected — surface as aborted (PRD §59, §212).
        timings.error = "client-aborted";
        timings.clientLatencyMs = Date.now() - timings.requestStart;
        try { gen.return(undefined); } catch { /* best-effort */ }
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

  /**
   * Consume the (already pre-flighted) generator + forward every delta to the
   * client. The first chunk is already in hand from the pre-flight; we emit it
   * immediately, then pull the rest of the stream. Mid-stream errors keep the
   * `event: error` + terminal-chunk behavior (R-2 mid-stream case).
   */
  private async runStreamAfterPreflight(
    controller: ReadableStreamDefaultController<Uint8Array>,
    candidate: FailoverCandidate,
    gen: AsyncGenerator<string, void, unknown>,
    firstDelta: string,
    emitFailoverMarker: boolean,
    timings: StreamTimings,
    sseId: string,
    created: number,
    encoder: TextEncoder,
  ): Promise<void> {
    // Audit D1: emit the failover marker as an SSE comment if we ended up
    // using a non-primary candidate so observability is preserved.
    if (emitFailoverMarker) {
      try {
        controller.enqueue(
          encoder.encode(
            `: X-Failover used ${candidate.req.modelId} (primary failed pre-flight)\n\n`,
          ),
        );
      } catch { /* best-effort */ }
    }

    let firstEnqueued = false;
    let anyContent = false;

    // Emit the buffered first chunk immediately (no buffering beyond the
    // single pre-flight chunk — the price of returning a real HTTP status
    // for pre-first-token errors).
    if (firstDelta) {
      timings.chunkCount += 1;
      timings.bytes += byteLength(firstDelta);
      anyContent = true;
      this.enqueueChunk(
        controller,
        encoder,
        sseId,
        created,
        candidate.req.modelId,
        firstDelta,
      );
      timings.proxyFirstForward = Date.now();
      timings.ttfbMs = timings.proxyFirstForward - timings.requestStart;
      timings.ttftMs = timings.ttfbMs;
      firstEnqueued = true;
    }

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
        anyContent = true;
        this.enqueueChunk(
          controller,
          encoder,
          sseId,
          created,
          candidate.req.modelId,
          delta,
        );
        if (!firstEnqueued) {
          timings.proxyFirstForward = Date.now();
          timings.ttfbMs = timings.proxyFirstForward - timings.requestStart;
          timings.ttftMs = timings.ttfbMs;
          firstEnqueued = true;
        }
        if (candidate.req.signal?.aborted) {
          this.sendAborted(controller, timings, encoder);
          return;
        }
      }
      // R-5: refuse to pass on a fully-empty stream. (Can happen if the
      // pre-flight chunk was the empty string and nothing else came.)
      if (!anyContent) {
        const emptyErr = emptyUpstreamResponseError(
          candidate.adapter.id,
          candidate.req.modelId,
        );
        this.handleStreamError(
          controller,
          emptyErr,
          timings,
          candidate.adapter.id,
          candidate.req.modelId,
          encoder,
          sseId,
          created,
        );
        timings.totalDurationMs = Date.now() - timings.requestStart;
        metricsService.recordStreamTimings(timings);
        return;
      }
      // Success — emit final stop chunk + usage + [DONE] (PRD §10, audit E2).
      this.enqueueFinal(
        controller,
        encoder,
        sseId,
        created,
        candidate.req,
        timings.bytes,
      );
      providerHealthService.recordProviderSuccess(candidate.adapter.id);
      providerHealthService.recordModelSuccess(candidate.req.modelId);
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
    } catch (err) {
      // Mid-stream failure (after at least the pre-flight chunk was
      // forwarded) → emit `event: error` + terminal chunk (R-2 mid-stream
      // case). Clients parsing SSE see the structured error; clients that
      // also check the top-level `http_status` field on the SSE error frame
      // can recover the real HTTP status.
      try { await gen.return(undefined); } catch { /* ignore */ }
      this.handleStreamError(
        controller,
        err,
        timings,
        candidate.adapter.id,
        candidate.req.modelId,
        encoder,
        sseId,
        created,
      );
      timings.totalDurationMs = Date.now() - timings.requestStart;
      metricsService.recordStreamTimings(timings);
    }
  }

  /**
   * Wrap a non-GatewayError thrown by `adapter.stream()` (or by `gen.next()`
   * during pre-flight) into a classified GatewayError. Re-uses the same
   * auth/quota/5xx heuristic as the proxy routes so the resulting HTTP status
   * is consistent across the canonical + legacy paths.
   */
  private wrapUnknownStreamErr(
    err: unknown,
    candidate: FailoverCandidate,
    requestId: string,
  ): GatewayError {
    if (err instanceof GatewayError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    const isAuth = /\bHTTP (401|403)\b/i.test(msg) || /unauthorized|forbidden/i.test(msg);
    const isQuota = /quota|rate.?limit|429/i.test(msg);
    const isNotFound = /\bHTTP 404\b|not.?found|does not exist/i.test(msg);
    if (isNotFound) {
      return new GatewayError({
        type: "MODEL_NOT_FOUND",
        status: 404,
        code: "model_not_found",
        message: `Upstream returned 404 for model "${candidate.req.modelId}".`,
        upstreamDetail: msg,
        provider: candidate.adapter.id,
        model: candidate.req.modelId,
        requestId,
      });
    }
    return new GatewayError({
      type: isAuth ? "AUTHENTICATION_REQUIRED" : isQuota ? "RATE_LIMITED" : "UPSTREAM_5XX",
      status: isAuth ? 401 : isQuota ? 429 : 502,
      code: isAuth ? "authentication_required" : isQuota ? "rate_limited" : "upstream_error",
      message: isAuth
        ? "Provider requires authentication (HTTP 401)."
        : isQuota
          ? "Upstream rate limit exceeded. Retry after 60s."
          : "Upstream provider failed to generate a response.",
      upstreamDetail: msg,
      provider: candidate.adapter.id,
      model: candidate.req.modelId,
      requestId,
      requiresAuth: isAuth,
      retryAfter: isQuota ? 60 : undefined,
    });
  }

  // NOTE: the previous runStream() (which consumed candidates inside a single
  // 200 OK stream and surfaced pre-first-token errors as in-band event:error
  // frames) has been replaced by the pre-flight + runStreamAfterPreflight
  // flow above. Pre-first-token errors now return a real HTTP error Response
  // (404/502/429/401/…) with a JSON body — no more `Status: N/A` for
  // streaming clients that read response.status.

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

  /** Catch-all error handler — emit SSE error event + terminal chunk + record health/metrics (R-2). */
  private handleStreamError(
    controller: ReadableStreamDefaultController<Uint8Array>,
    err: unknown,
    timings: StreamTimings,
    providerId: string,
    modelId: string,
    encoder: TextEncoder,
    sseId: string,
    created: number,
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
      // R-2: emit `event: error` frame first (clients that parse SSE events
      // surface it as a stream error), then a terminal `data:` chunk with
      // `finish_reason: "error"` + `[DONE]` so `Status: N/A` clients that
      // only watch `data:` frames see a non-`stop` finish reason.
      controller.enqueue(encoder.encode(sseErrorEvent(ge)));
      controller.enqueue(
        encoder.encode(sseTerminalErrorChunk(ge, sseId, created, modelId)),
      );
    } catch {
      // best-effort — controller may already be closed
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

/** Functional entry-point (PRD §6, audit D1 failover). Now async (R-2 pre-flight). */
export async function streamChat(
  req: ChatRequest,
  adapter: ProviderAdapter,
  fallbacks: FailoverCandidate[] = [],
): Promise<{ response: Response; timings: StreamTimings }> {
  return streamingProxyService.streamChat(req, adapter, fallbacks);
}
