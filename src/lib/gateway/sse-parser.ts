/**
 * Incremental SSE parser (PRD §17-20).
 *
 * A network chunk ≠ an SSE event. A chunk may contain half an event, one
 * event, or twenty events. This parser maintains an incomplete-event buffer
 * across chunks, correctly handles UTF-8 split across byte boundaries (via
 * TextDecoder { stream: true }), multi-line `data:` fields, CRLF/LF, `event:`
 * lines, and `[DONE]` termination.
 *
 * Usage:
 *
 *   const parser = new SseParser();
 *   for await (const chunk of stream) {
 *     for (const ev of parser.feed(chunk)) { ... }
 *   }
 *   for (const ev of parser.end()) { ... }   // flush trailing
 */

export interface SseEvent {
  /** Concatenated `data:` lines (joined with "\n"). */
  data: string;
  /** `event:` field if present, else undefined. */
  event?: string;
  /** `id:` field if present. */
  id?: string;
  /** `retry:` field if present (ms). */
  retry?: number;
  /** Whether data === "[DONE]" (OpenAI termination sentinel). */
  done: boolean;
}

/**
 * Streaming SSE parser. Stateless across instances; maintains internal buffer.
 * Create one per SSE connection — do NOT reuse (PRD §18 — one decoder per stream).
 */
export class SseParser {
  private decoder = new TextDecoder("utf-8");
  private buffer = "";
  /** Current event fields being assembled. */
  private currentData: string[] = [];
  private currentEvent: string | undefined;
  private currentId: string | undefined;
  private currentRetry: number | undefined;
  /** True once [DONE] has been parsed → no further events emitted. */
  private doneSeen = false;

  /** Feed a raw byte chunk; returns zero or more complete SSE events. */
  feed(chunk: Uint8Array): SseEvent[] {
    if (this.doneSeen) return [];
    // Stream-aware decode handles UTF-8 split across chunk boundaries (PRD §18).
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  /** Finalize the stream, flushing any trailing buffered event. */
  end(): SseEvent[] {
    // Flush any remaining decoded bytes.
    this.buffer += this.decoder.decode();
    const events = this.drain();
    // Emit a trailing event if the buffer ended without a trailing newline.
    if (!this.doneSeen && (this.currentData.length > 0 || this.currentEvent || this.currentId)) {
      events.push(this.buildEvent());
      this.resetCurrent();
    }
    this.doneSeen = true;
    return events;
  }

  private drain(): SseEvent[] {
    const events: SseEvent[] = [];
    // Handle CRLF and LF uniformly. Split on \n; strip a trailing \r.
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;
      this.processLine(stripped, events);
      if (this.doneSeen) break;
    }
    return events;
  }

  private processLine(line: string, events: SseEvent[]): void {
    // Empty line → event boundary (PRD §20).
    if (line === "") {
      if (this.currentData.length > 0 || this.currentEvent || this.currentId) {
        events.push(this.buildEvent());
        this.resetCurrent();
      }
      return;
    }
    // Comment line (starts with ':') → ignore (heartbeat).
    if (line.startsWith(":")) return;

    const colonIdx = line.indexOf(":");
    // No colon → field with empty value.
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    // Skip the colon and (per spec) one leading space.
    let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "data":
        this.currentData.push(value);
        break;
      case "event":
        this.currentEvent = value;
        break;
      case "id":
        this.currentId = value;
        break;
      case "retry": {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) this.currentRetry = n;
        break;
      }
      default:
        // Unknown field → preserve silently (PRD §229).
        break;
    }
  }

  private buildEvent(): SseEvent {
    const data = this.currentData.join("\n");
    if (data === "[DONE]") {
      this.doneSeen = true;
      return { data, done: true };
    }
    return {
      data,
      event: this.currentEvent,
      id: this.currentId,
      retry: this.currentRetry,
      done: false,
    };
  }

  private resetCurrent(): void {
    this.currentData = [];
    this.currentEvent = undefined;
    this.currentId = undefined;
    this.currentRetry = undefined;
  }

  get isDone(): boolean {
    return this.doneSeen;
  }
}

/**
 * Convenience: extract a content delta from an OpenAI-shaped SSE event.
 * Handles `choices[0].delta.content`, `choices[0].delta.tool_calls`, and
 * `choices[0].delta.reasoning_content`. Returns null if no usable delta.
 */
export function extractOpenAiDelta(ev: SseEvent): string | null {
  if (ev.done) return null;
  if (!ev.data) return null;
  try {
    const json = JSON.parse(ev.data) as {
      choices?: Array<{
        delta?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{ index: number; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string;
      }>;
      error?: { message?: string };
    };
    if (json.error) return null; // caller should detect via extractSseError
    const choice = json.choices?.[0];
    if (!choice) return null;
    const delta = choice.delta;
    if (!delta) return null;
    // Reasoning content (gptoss) → surfaced inline as text.
    const reasoning = delta.reasoning_content;
    const content = delta.content;
    const toolCalls = delta.tool_calls;
    if (typeof content === "string" && content) return content;
    if (typeof reasoning === "string" && reasoning) return reasoning;
    if (toolCalls && toolCalls.length > 0) {
      return JSON.stringify({
        __tool_calls: toolCalls.map((tc) => ({
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || "",
        })),
      });
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract an inline SSE error object, if present (e.g. vexa: data: {"error":{...}}). */
export function extractSseError(ev: SseEvent): { message: string } | null {
  if (!ev.data) return null;
  try {
    const json = JSON.parse(ev.data) as { error?: { message?: string } };
    if (json.error && typeof json.error.message === "string") {
      return { message: json.error.message };
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** True if the SSE event's finish_reason indicates stream completion. */
export function isFinishEvent(ev: SseEvent): boolean {
  if (!ev.data) return false;
  try {
    const json = JSON.parse(ev.data) as {
      choices?: Array<{ finish_reason?: string }>;
    };
    return Boolean(json.choices?.[0]?.finish_reason);
  } catch {
    return false;
  }
}
