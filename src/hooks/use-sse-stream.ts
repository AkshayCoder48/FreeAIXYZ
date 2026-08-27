"use client";

/**
 * useSseStream — a client-side incremental SSE parser hook (PRD §17-20, §56, §59, §61, §107).
 *
 * Mirrors the server's SseParser. Maintains an incomplete-event buffer across
 * reader chunks (a chunk can be half an event or 20 events). Handles UTF-8
 * split across byte boundaries via ONE TextDecoder({ stream: true }) reused
 * across chunks. Multi-line `data:` fields, CRLF/LF, `event:` field, comments,
 * and the `[DONE]` sentinel (PRD §19).
 *
 * Returns timing instrumentation (TTFT, chunk count, duration, bytes) — used
 * by the streaming-diagnostics panel (PRD §107).
 *
 * NO setInterval / fake streaming (PRD §137). Real fetch + ReadableStream reader.
 */

import { useCallback, useRef, useState } from "react";

export type SseStreamState =
  | "idle"
  | "connecting"
  | "streaming"
  | "done"
  | "error"
  | "aborted";

export interface SseError {
  /** Error type from the structured envelope (PRD §146), if known. */
  type?: string;
  message: string;
  provider?: string;
  model?: string;
  requestId?: string;
  code?: string;
  status?: number;
  upstreamStatus?: number;
}

export interface SseTimings {
  /** Wall-clock at fetch() invocation (ms since epoch). */
  requestStart: number | null;
  /** Wall-clock at first decoded chunk arrival. */
  firstChunkAt: number | null;
  /** Wall-clock at stream end (done / error / abort). */
  streamEndAt: number | null;
  /** Number of SSE events parsed. */
  chunkCount: number;
  /** Total bytes received across all chunks. */
  bytes: number;
}

export interface SseTimingsDerived {
  /** Time-to-first-token (request → first content chunk). */
  ttftMs: number | null;
  /** Stream duration (request → stream end). */
  durationMs: number | null;
}

export interface UseSseStreamResult {
  state: SseStreamState;
  timings: SseTimings;
  derived: SseTimingsDerived;
  /** Last structured error (when state === "error"). */
  error: SseError | null;
  start: (opts: StartOpts) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * One OpenAI-shaped tool-call delta fragment (PRD §11-§17, §24).
 *
 * The wire format mirrors `delta.tool_calls[i]` exactly:
 *  - `index`       identifies which tool call this fragment belongs to
 *                  (the client MUST accumulate by index across deltas).
 *  - `id`          appears ONLY on the FIRST delta for a given index
 *                  (stable thereafter; client should keep the first non-empty
 *                  id and ignore subsequent ids for the same index).
 *  - `function.name` appears ONLY on the delta that introduces the name
 *                  (empty/absent name deltas must NOT erase the accumulated
 *                  name — PRD §11).
 *  - `function.arguments` is the INCREMENTAL fragment — the client MUST
 *                  concatenate across deltas for the same index. NEVER
 *                  JSON.parse the partial buffer — only parse when the
 *                  stream ends or `finish_reason:"tool_calls"` arrives
 *                  (PRD §12).
 */
export interface ToolCallDelta {
  index: number;
  /** Stable per-index id; present ONLY on the first delta for this index. */
  id?: string;
  type: "function";
  function: {
    /** Present only on the delta that introduces the name (PRD §11). */
    name?: string;
    /** INCREMENTAL fragment — the client must concatenate by index. */
    arguments?: string;
  };
}

export interface StartOpts {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Fired for each content delta (string). */
  onDelta: (content: string) => void;
  /**
   * Fired for each `delta.tool_calls` chunk (PRD §11-§17). The array passed
   * is the array of tool-call fragments from ONE SSE event — typically one
   * fragment per call, but multiple can appear in a single chunk.
   */
  onToolCallDelta?: (tc: ToolCallDelta[]) => void;
  /** Fired for an `event: error` SSE event (PRD §61). */
  onError?: (err: SseError) => void;
  /** Fired when stream completes successfully. */
  onDone?: () => void;
  /** Fired for every raw `data:` line (PRD §108 — raw debugger). */
  onRawData?: (line: string) => void;
}

interface ParsedEvent {
  data: string;
  event?: string;
  done: boolean;
}

/** Parse one SSE event's `data:` field as JSON; return the parsed object or null. */
function tryJson<T = unknown>(data: string): T | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Defense-in-depth (PRD §8): never leak a raw `__tool_calls` marker string as
 * assistant text. The server-side `ToolCallNormalizer`
 * (`src/lib/gateway/tool-call-normalizer.ts`) should already have converted
 * these into proper `delta.tool_calls` chunks before they reach the client.
 * This regex is a backstop for any legacy code path that still emits the
 * marker as `delta.content`. Match a leading `{"__tool_calls":` (with
 * optional leading whitespace) — the canonical marker shape.
 */
const RAW_TOOL_CALL_MARKER_RE = /^\s*\{"__tool_calls"\s*:/;

/** Extract a content delta from an OpenAI-shaped SSE event. */
function extractContentDelta(data: string): string | null {
  const json = tryJson<{
    choices?: Array<{
      delta?: {
        content?: string;
        reasoning_content?: string;
        tool_calls?: unknown[];
      };
    }>;
  }>(data);
  if (!json) return null;
  const choice = json.choices?.[0];
  const delta = choice?.delta;
  if (!delta) return null;
  if (typeof delta.content === "string" && delta.content) {
    // PRD §8 backstop — never leak raw __tool_calls markers as text.
    if (RAW_TOOL_CALL_MARKER_RE.test(delta.content)) {
      return null;
    }
    return delta.content;
  }
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
    // Reasoning text never carries a __tool_calls marker — pass through.
    return delta.reasoning_content;
  }
  // tool_calls are handled separately via extractToolCallDelta — never
  // surfaced as text content (PRD §8, §16).
  return null;
}

/**
 * Extract an array of tool-call delta fragments from an OpenAI-shaped SSE
 * event. Returns null if the event has no `delta.tool_calls` array or the
 * array is empty. The caller accumulates by index (PRD §11-§17).
 */
function extractToolCallDelta(data: string): ToolCallDelta[] | null {
  const json = tryJson<{
    choices?: Array<{
      delta?: {
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  }>(data);
  if (!json) return null;
  const choice = json.choices?.[0];
  const delta = choice?.delta;
  if (!delta?.tool_calls || delta.tool_calls.length === 0) return null;
  const out: ToolCallDelta[] = [];
  for (const raw of delta.tool_calls) {
    if (!raw || typeof raw.index !== "number") continue;
    const fn = raw.function ?? {};
    out.push({
      index: raw.index,
      id:
        typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined,
      type: "function",
      function: {
        name:
          typeof fn.name === "string" && fn.name.length > 0
            ? fn.name
            : undefined,
        arguments:
          typeof fn.arguments === "string" ? fn.arguments : undefined,
      },
    });
  }
  return out.length > 0 ? out : null;
}

/** Extract an error object from an SSE event payload (PRD §61, §146). */
function extractErrorPayload(event: ParsedEvent): SseError | null {
  const json = tryJson<{
    error?: {
      type?: string;
      message?: string;
      provider?: string;
      model?: string;
      request_id?: string;
      code?: string;
      status?: number;
      upstreamStatus?: number;
    };
  }>(event.data);
  if (!json?.error) return null;
  const e = json.error;
  return {
    type: e.type,
    message: e.message ?? "Upstream error",
    provider: e.provider,
    model: e.model,
    requestId: e.request_id,
    code: e.code,
    status: e.status,
    upstreamStatus: e.upstreamStatus,
  };
}

/**
 * The hook. Create one per chat session / stream. DO NOT reuse across streams
 * without calling reset() (PRD §18 — one decoder per stream).
 */
export function useSseStream(): UseSseStreamResult {
  const [state, setState] = useState<SseStreamState>("idle");
  const [error, setError] = useState<SseError | null>(null);
  const [timings, setTimings] = useState<SseTimings>({
    requestStart: null,
    firstChunkAt: null,
    streamEndAt: null,
    chunkCount: 0,
    bytes: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);
  const bufferRef = useRef<string>("");
  const currentDataRef = useRef<string[]>([]);
  const currentEventRef = useRef<string | undefined>(undefined);
  const doneSeenRef = useRef<boolean>(false);
  /**
   * Idempotent finalize guard (PRD §A5 — watchdog hardening). Once true, no
   * termination path (idle-watchdog, [DONE], end-of-stream) may re-fire
   * `opts.onDone?.()` or re-call `setState("done")`. Prevents the harmless-but-
   * noisy double-fire that occurred when the idle watchdog aborted the stream
   * and the subsequent end-of-stream pass re-finalized.
   */
  const finalizedRef = useRef<boolean>(false);

  const reset = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        // ignore
      }
      abortRef.current = null;
    }
    decoderRef.current = null;
    bufferRef.current = "";
    currentDataRef.current = [];
    currentEventRef.current = undefined;
    doneSeenRef.current = false;
    finalizedRef.current = false;
    setState("idle");
    setError(null);
    setTimings({
      requestStart: null,
      firstChunkAt: null,
      streamEndAt: null,
      chunkCount: 0,
      bytes: 0,
    });
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        // ignore
      }
    }
    setState((prev) => (prev === "streaming" || prev === "connecting" ? "aborted" : prev));
    setTimings((t) => ({
      ...t,
      streamEndAt: t.streamEndAt ?? Date.now(),
    }));
  }, []);

  /** Process a single SSE line; emits parsed events via pushEvent. */
  const processLine = useCallback(
    (line: string, opts: StartOpts, events: ParsedEvent[]) => {
      // Empty line → event boundary.
      if (line === "") {
        if (
          currentDataRef.current.length > 0 ||
          currentEventRef.current !== undefined
        ) {
          const ev: ParsedEvent = {
            data: currentDataRef.current.join("\n"),
            event: currentEventRef.current,
            done: false,
          };
          if (ev.data === "[DONE]") {
            ev.done = true;
            doneSeenRef.current = true;
          }
          events.push(ev);
          currentDataRef.current = [];
          currentEventRef.current = undefined;
        }
        return;
      }
      // Comment line (heartbeat).
      if (line.startsWith(":")) return;
      const colonIdx = line.indexOf(":");
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
      let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      switch (field) {
        case "data":
          currentDataRef.current.push(value);
          break;
        case "event":
          currentEventRef.current = value;
          break;
        default:
          // id, retry, unknown → preserve silently.
          break;
      }
    },
    [],
  );

  /** Drain the buffer for complete events. */
  const drain = useCallback(
    (opts: StartOpts): ParsedEvent[] => {
      const events: ParsedEvent[] = [];
      let idx: number;
      while ((idx = bufferRef.current.indexOf("\n")) >= 0) {
        const line = bufferRef.current.slice(0, idx);
        bufferRef.current = bufferRef.current.slice(idx + 1);
        const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;
        processLine(stripped, opts, events);
        if (doneSeenRef.current) break;
      }
      return events;
    },
    [processLine],
  );

  /** Flush a trailing buffered event at end-of-stream. */
  const flushTrailing = useCallback((): ParsedEvent[] => {
    const events: ParsedEvent[] = [];
    if (
      !doneSeenRef.current &&
      (currentDataRef.current.length > 0 ||
        currentEventRef.current !== undefined)
    ) {
      const ev: ParsedEvent = {
        data: currentDataRef.current.join("\n"),
        event: currentEventRef.current,
        done: false,
      };
      if (ev.data === "[DONE]") {
        ev.done = true;
        doneSeenRef.current = true;
      }
      events.push(ev);
      currentDataRef.current = [];
      currentEventRef.current = undefined;
    }
    return events;
  }, []);

  const start = useCallback(
    async (opts: StartOpts): Promise<void> => {
      // Reset state for a fresh stream (PRD §18 — one decoder per stream).
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // ignore
        }
      }
      decoderRef.current = new TextDecoder("utf-8");
      bufferRef.current = "";
      currentDataRef.current = [];
      currentEventRef.current = undefined;
      doneSeenRef.current = false;
      finalizedRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;
      const requestStart = Date.now();
      setState("connecting");
      setError(null);
      setTimings({
        requestStart,
        firstChunkAt: null,
        streamEndAt: null,
        chunkCount: 0,
        bytes: 0,
      });

      let response: Response;
      try {
        response = await fetch(opts.url, {
          method: opts.method ?? "POST",
          headers: opts.headers ?? { "Content-Type": "application/json" },
          body: opts.body,
          signal: controller.signal,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setState("aborted");
          setTimings((t) => ({
            ...t,
            streamEndAt: t.streamEndAt ?? Date.now(),
          }));
          return;
        }
        const err: SseError = {
          message: (e as Error).message || "Network request failed",
          type: "NETWORK",
        };
        setError(err);
        setState("error");
        setTimings((t) => ({
          ...t,
          streamEndAt: t.streamEndAt ?? Date.now(),
        }));
        opts.onError?.(err);
        return;
      }

      if (!response.ok) {
        // Read body for a structured error envelope (PRD §146).
        let errBody = "";
        try {
          errBody = await response.text();
        } catch {
          // ignore
        }
        const parsed = tryJson<{
          error?: Partial<SseError> & { message?: string };
        }>(errBody);
        const err: SseError = {
          type: parsed?.error?.type ?? "HTTP_ERROR",
          message:
            parsed?.error?.message ??
            `HTTP ${response.status} ${response.statusText}`,
          provider: parsed?.error?.provider,
          model: parsed?.error?.model,
          requestId: parsed?.error?.requestId,
          code: parsed?.error?.code,
          status: parsed?.error?.status ?? response.status,
          upstreamStatus: parsed?.error?.upstreamStatus,
        };
        setError(err);
        setState("error");
        setTimings((t) => ({
          ...t,
          streamEndAt: t.streamEndAt ?? Date.now(),
        }));
        opts.onError?.(err);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const err: SseError = {
          message: "No response body — stream unavailable.",
          type: "NO_BODY",
        };
        setError(err);
        setState("error");
        setTimings((t) => ({
          ...t,
          streamEndAt: t.streamEndAt ?? Date.now(),
        }));
        opts.onError?.(err);
        return;
      }

      setState("streaming");
      let firstChunkAt: number | null = null;
      let chunkCount = 0;
      let bytes = 0;
      let capturedError: SseError | null = null;

      // ─── IDEMPOTENT FINALIZE (PRD §A5 — watchdog hardening) ─────────────
      // Exactly one of the three termination paths (idle-watchdog, [DONE],
      // end-of-stream) may fire `opts.onDone?.()` + `setState("done")`. The
      // `finalizedRef` boolean ensures the others short-circuit. The watchdog
      // aborts the fetch on idle; without this guard, the subsequent
      // end-of-stream pass would re-finalize and double-fire `onDone`.
      const finalizeDone = (streamEndAt: number) => {
        if (finalizedRef.current) return;
        finalizedRef.current = true;
        setTimings({
          requestStart,
          firstChunkAt,
          streamEndAt,
          chunkCount,
          bytes,
        });
        setState("done");
        opts.onDone?.();
      };

      // ─── IDLE-TIMEOUT WATCHDOG ────────────────────────────────────────────
      // If no chunks arrive for IDLE_TIMEOUT_MS while the stream is open, the
      // upstream has stalled (sent a partial response then went silent). The
      // HTTP body never closes, so reader.read() blocks forever. Without this
      // watchdog, the UI keeps showing the "Stop" button as if the AI were
      // still generating — even though it silently auto-stopped. We abort the
      // stream after the idle window and call onDone so the UI flips back to
      // the "Send" button and the partial assistant text is preserved.
      const IDLE_TIMEOUT_MS = 25_000; // 25 seconds of total silence
      let lastChunkAt = Date.now();
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const armIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          // Idle window elapsed — abort the stream.
          if (doneSeenRef.current || capturedError) return;
          try {
            controller.abort();
          } catch {
            // ignore
          }
          // Treat as a clean done — the upstream stopped sending. The
          // finalizeDone() helper is idempotent (PRD §A5) so a later
          // end-of-stream pass through the same closure won't double-fire.
          if (!doneSeenRef.current) {
            doneSeenRef.current = true;
            finalizeDone(Date.now());
          }
        }, IDLE_TIMEOUT_MS);
        if (idleTimer && typeof (idleTimer as { unref?: () => void }).unref === "function") {
          (idleTimer as { unref: () => void }).unref();
        }
      };
      armIdleTimer();

      try {
        while (true) {
          // Race the read against the idle timer so a stalled upstream can't
          // keep the UI stuck on "streaming" forever.
          let read;
          try {
            read = await reader.read();
          } catch (e) {
            if ((e as Error).name === "AbortError") {
              // Either user clicked stop OR the idle watchdog aborted.
              if (doneSeenRef.current) {
                // Idle-watchdog path already finalized state — just exit.
                break;
              }
              setState("aborted");
              break;
            }
            throw e;
          }
          const { done, value } = read;
          if (done) break;
          if (!value) continue;
          if (firstChunkAt === null) firstChunkAt = Date.now();
          bytes += value.byteLength;
          lastChunkAt = Date.now();
          armIdleTimer();

          const decoder = decoderRef.current!;
          bufferRef.current += decoder.decode(value, { stream: true });

          const events = drain(opts);
          chunkCount += events.length;

          for (const ev of events) {
            if (opts.onRawData) opts.onRawData(ev.data);
            if (ev.done) {
              // [DONE] sentinel — release reader (PRD §19).
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              doneSeenRef.current = true;
              continue;
            }
            if (ev.event === "error" || ev.event === "err") {
              const parsedErr = extractErrorPayload(ev);
              if (parsedErr) {
                capturedError = parsedErr;
                setError(parsedErr);
                opts.onError?.(parsedErr);
              }
              continue;
            }
            // Inline data: {"error": {...}} payloads.
            const inlineErr = extractErrorPayload(ev);
            if (inlineErr) {
              capturedError = inlineErr;
              setError(inlineErr);
              opts.onError?.(inlineErr);
              continue;
            }
            const delta = extractContentDelta(ev.data);
            if (delta) opts.onDelta(delta);
            // Tool-call deltas (PRD §11-§17) — accumulate by index in the UI;
            // never surfaced as text content (PRD §8, §16).
            const tcDelta = extractToolCallDelta(ev.data);
            if (tcDelta) opts.onToolCallDelta?.(tcDelta);
          }

          setTimings({
            requestStart,
            firstChunkAt,
            streamEndAt: null,
            chunkCount,
            bytes,
          });

          if (doneSeenRef.current) break;
          if (capturedError) break;
        }

        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }

        // Flush any trailing buffered event.
        if (!doneSeenRef.current && !capturedError) {
          const trailing = flushTrailing();
          chunkCount += trailing.length;
          for (const ev of trailing) {
            if (opts.onRawData) opts.onRawData(ev.data);
            if (ev.done) {
              doneSeenRef.current = true;
              continue;
            }
            if (ev.event === "error") {
              const parsedErr = extractErrorPayload(ev);
              if (parsedErr) {
                capturedError = parsedErr;
                setError(parsedErr);
                opts.onError?.(parsedErr);
              }
              continue;
            }
            const inlineErr = extractErrorPayload(ev);
            if (inlineErr) {
              capturedError = inlineErr;
              setError(inlineErr);
              opts.onError?.(inlineErr);
              continue;
            }
            const delta = extractContentDelta(ev.data);
            if (delta) opts.onDelta(delta);
            const tcDelta = extractToolCallDelta(ev.data);
            if (tcDelta) opts.onToolCallDelta?.(tcDelta);
          }
        }

        try {
          await reader.cancel();
        } catch {
          // ignore
        }

        const streamEndAt = Date.now();
        if (capturedError) {
          // Error path is NOT guarded by finalizedRef — errors are terminal
          // and never co-occur with a clean done.
          setTimings({
            requestStart,
            firstChunkAt,
            streamEndAt,
            chunkCount,
            bytes,
          });
          setState("error");
        } else {
          // [DONE] seen OR stream ended without [DONE] (server may omit it) —
          // treat as clean done. Idempotent: no-op if the watchdog already
          // finalized (PRD §A5).
          finalizeDone(streamEndAt);
        }
      } catch (e) {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        if ((e as Error).name === "AbortError") {
          if (doneSeenRef.current) {
            // Idle-watchdog path already finalized state — just exit.
            return;
          }
          setState("aborted");
          setTimings((t) => ({
            ...t,
            requestStart,
            firstChunkAt,
            streamEndAt: t.streamEndAt ?? Date.now(),
            chunkCount,
            bytes,
          }));
          return;
        }
        const err: SseError = {
          message: (e as Error).message || "Stream parsing failed",
          type: "PARSE",
        };
        setError(err);
        setState("error");
        setTimings((t) => ({
          ...t,
          requestStart,
          firstChunkAt,
          streamEndAt: t.streamEndAt ?? Date.now(),
          chunkCount,
          bytes,
        }));
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        opts.onError?.(err);
      }
    },
    [drain, flushTrailing],
  );

  const derived: SseTimingsDerived = {
    ttftMs:
      timings.requestStart !== null && timings.firstChunkAt !== null
        ? timings.firstChunkAt - timings.requestStart
        : null,
    durationMs:
      timings.requestStart !== null && timings.streamEndAt !== null
        ? timings.streamEndAt - timings.requestStart
        : null,
  };

  return { state, timings, derived, error, start, stop, reset };
}
