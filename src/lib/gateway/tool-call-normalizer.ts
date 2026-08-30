/**
 * Streaming Tool-Call Normalizer (PRD §9-§15, §24).
 *
 * THE ROOT-CAUSE FIX for the raw `{"__tool_calls":[...]}` leak.
 *
 * Provider adapters that speak OpenAI natively (kilocode, opencode, gptoss,
 * freegpt, llm7, swarm) plus the gateway's own `sse-parser.extractOpenAiDelta`
 * convert upstream `delta.tool_calls` into a gateway-internal JSON MARKER
 * string:
 *
 *   {"__tool_calls":[{"name":"ls","arguments":""}]}
 *
 * Each upstream tool-call delta becomes ONE such marker (first delta carries
 * the name; subsequent deltas carry argument fragments). Without this
 * normalizer, `streaming-proxy.enqueueChunk` wraps every yielded delta as
 * `choices[0].delta.content` — so the markers flow to the client as raw
 * assistant TEXT and render as JSON inside the chat bubble (PRD §8).
 *
 * This normalizer sits between the raw provider delta and the OpenAI-shaped
 * SSE output (PRD §24 architecture):
 *
 *   Provider stream → Raw Transport → SSE Decoder →
 *     → [THIS] Provider Normalizer + Tool-Call Accumulator →
 *     → Unified Stream Event (delta.content | delta.tool_calls) →
 *     → Chat UI
 *
 * Responsibilities (PRD §9-§15):
 *  - detect `__tool_calls` markers inside each incoming delta
 *  - parse each marker (each marker is itself complete JSON)
 *  - accumulate by tool-call INDEX across multiple deltas:
 *        name       = first non-empty name fragment wins (§11)
 *        arguments  = concatenated fragments, NEVER overwritten (§11)
 *  - generate a STABLE request-scoped id per index (NOT per delta) (§14)
 *  - emit INCREMENTAL OpenAI-shaped `delta.tool_calls` chunks (the fragment
 *    that arrived in THIS delta) so standard OpenAI streaming clients
 *    accumulate correctly
 *  - pass plain text through as `delta.content`
 *  - NEVER emit the raw `__tool_calls` JSON as content (§8, §16)
 *  - NEVER JSON.parse the accumulated argument buffer — only individual
 *    complete markers, which are valid JSON (§12)
 *
 * Forbidden behaviors (per user PRD): no fallback, no buffering of the whole
 * stream, no fake-completed tool call, no filtering `__tool_calls` text
 * AFTER generation. This normalizer intercepts the marker BEFORE it reaches
 * content — the correct architectural layer.
 */

/** One normalized output: either text content, tool-call fragments, or both. */
export interface NormalizedDelta {
  /** Plain text to forward as `delta.content` (empty string = none). */
  content?: string;
  /** Incremental tool-call fragments to forward as `delta.tool_calls`. */
  toolCalls?: Array<{
    index: number;
    /** Present only on the FIRST delta for this index (stable id, §14). */
    id?: string;
    type: "function";
    function: {
      /** Present only when this delta introduces/sets the name (§11). */
      name?: string;
      /** The argument FRAGMENT from THIS delta (§11, §12). */
      arguments?: string;
    };
  }>;
}

/** Internal per-index accumulator state (PRD §13-§15). */
interface ToolCallAccumulator {
  index: number;
  id: string;
  name: string;
  argBuffer: string;
  /** Has the stable id been emitted on a prior delta? */
  idEmitted: boolean;
  /** Has a non-empty name been emitted on a prior delta? */
  nameEmitted: boolean;
}

/** A captured diagnostic event for the debug dashboard (PRD §21, §22). */
export interface NormalizerLogEntry {
  /** ms since normalizer construction */
  t: number;
  phase:
    | "text_delta"
    | "tool_delta"
    | "tool_name"
    | "tool_args"
    | "tool_args_complete"
    | "tool_ready"
    | "suppress_unparseable"
    | "mixed";
  index?: number;
  name?: string;
  fragment?: string;
  note?: string;
}

const TOOL_CALL_MARKER_RE = /\{"__tool_calls":\s*(\[[\s\S]*?\])\}/g;

/**
 * Streaming tool-call normalizer. One instance PER STREAM (per request) so
 * accumulation state persists across deltas.
 */
export class ToolCallNormalizer {
  private accumulators = new Map<number, ToolCallAccumulator>();
  private idCounter = 0;
  private hadToolCalls = false;
  private startMs = Date.now();
  readonly log: NormalizerLogEntry[] = [];

  /**
   * Consume one raw provider delta string and return the normalized output
   * to forward to the client (content and/or tool-call fragments).
   *
   * A delta may be:
   *  (a) pure text                         → { content }
   *  (b) a single complete `__tool_calls` marker (the common case — adapters
   *      build one marker per upstream tool_calls chunk via JSON.stringify) → { toolCalls }
   *  (c) mixed text + one or more markers  → { content, toolCalls }
   *  (d) a delta bearing the `__tool_calls` substring that fails to parse
   *      (should not happen given the adapter invariant, but we MUST NOT
   *      leak raw JSON) → suppressed + logged (§8)
   */
  consume(rawDelta: string): NormalizedDelta {
    if (!rawDelta) return {};

    // ─── Fast path (a): no marker substring at all → pure text. ───
    if (!rawDelta.includes("__tool_calls")) {
      this.log.push({ t: Date.now() - this.startMs, phase: "text_delta" });
      return { content: rawDelta };
    }

    // ─── Primary path (b): whole-delta is one complete marker. ───
    // Adapters do `JSON.stringify({__tool_calls: [...]})` per upstream chunk,
    // so each marker-bearing delta is itself valid JSON. This path is robust
    // against argument fragments containing `]` or `}` (which the regex
    // fallback below cannot handle).
    const whole = tryParseMarker(rawDelta);
    if (whole !== null) {
      const out = this.processMarkerCalls(whole);
      if (out.toolCalls && out.toolCalls.length > 0) {
        this.hadToolCalls = true;
        return out;
      }
      // Marker parsed but yielded no usable fragment — suppress to avoid
      // leaking the raw JSON (§8). Should not happen in practice.
      this.log.push({
        t: Date.now() - this.startMs,
        phase: "suppress_unparseable",
        note: "marker parsed but no fragments",
      });
      return {};
    }

    // ─── Fallback path (c): mixed text + markers via regex scan. ───
    // Handles the rare case where a delta contains prose + a marker, or
    // multiple markers. The regex is non-greedy; argument fragments
    // containing `]` may break it — but the whole-delta parse above already
    // handles the common complete-marker case, so this only runs for mixed.
    if (TOOL_CALL_MARKER_RE.test(rawDelta)) {
      TOOL_CALL_MARKER_RE.lastIndex = 0;
      const result: NormalizedDelta = { content: "" };
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      while ((m = TOOL_CALL_MARKER_RE.exec(rawDelta)) !== null) {
        // text before this marker → content
        result.content += rawDelta.slice(lastIdx, m.index);
        lastIdx = m.index + m[0].length;
        try {
          const calls = JSON.parse(m[1]) as Array<{ name?: string; arguments?: string }>;
          const frag = this.processMarkerCalls(calls);
          if (frag.toolCalls) {
            result.toolCalls = [...(result.toolCalls ?? []), ...frag.toolCalls];
          }
        } catch {
          // unparseable marker fragment — suppress (do NOT leak as text, §8)
          this.log.push({
            t: Date.now() - this.startMs,
            phase: "suppress_unparseable",
            note: "regex marker JSON.parse failed",
          });
        }
      }
      result.content += rawDelta.slice(lastIdx);
      if (result.toolCalls && result.toolCalls.length > 0) this.hadToolCalls = true;
      // Drop content if it's only whitespace surrounding markers.
      if (!result.content?.trim()) delete result.content;
      if (result.content || (result.toolCalls && result.toolCalls.length > 0)) {
        this.log.push({ t: Date.now() - this.startMs, phase: "mixed" });
        return result;
      }
      return {};
    }

    // ─── Path (d): delta bears `__tool_calls` but is neither a complete ───
    //   marker nor regex-matched. Suppress to guarantee no raw JSON leaks
    //   into the assistant bubble (§8). Log for diagnosis.
    this.log.push({
      t: Date.now() - this.startMs,
      phase: "suppress_unparseable",
      note: `unparseable __tool_calls-bearing delta (len=${rawDelta.length})`,
    });
    return {};
  }

  /**
   * Process an array of `{name, arguments}` calls from one marker, merging
   * into per-index accumulators and emitting the INCREMENTAL fragments that
   * arrived in this marker.
   */
  private processMarkerCalls(
    calls: Array<{ name?: string; arguments?: string }>,
  ): NormalizedDelta {
    const out: NormalizedDelta = {};
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i] ?? {};
      const acc = this.getOrCreate(i);
      const frag: {
        index: number;
        id?: string;
        type: "function";
        function: { name?: string; arguments?: string };
      } = { index: i, type: "function", function: {} };

      // ── Stable id: emit only on the FIRST delta for this index (§14). ──
      if (!acc.idEmitted) {
        frag.id = acc.id;
        acc.idEmitted = true;
      }

      // ── Name: first non-empty fragment wins (§11). Empty name deltas ──
      //   must NOT erase the accumulated name.
      const nameFrag = typeof c.name === "string" ? c.name : "";
      if (nameFrag && !acc.name) {
        acc.name = nameFrag;
        frag.function.name = nameFrag;
        this.log.push({
          t: Date.now() - this.startMs,
          phase: "tool_name",
          index: i,
          name: nameFrag,
        });
      } else if (nameFrag && acc.name && nameFrag !== acc.name) {
        // A later non-empty name fragment that differs — keep the first
        // (OpenAI semantics: name is set on the first delta). Do not emit.
      }

      // ── Arguments: concatenate the FRAGMENT (§11). NEVER overwrite. ──
      //   NEVER JSON.parse the accumulated buffer (§12) — only emit the
      //   fragment; the client accumulates + parses when complete.
      //   An empty-string `arguments:""` (the OpenAI first-delta convention
      //   to establish the field) IS forwarded faithfully — the client
      //   appends "" (a no-op) so behavior is unchanged but the field shape
      //   matches real OpenAI streams.
      const hasArgs = typeof c.arguments === "string";
      if (hasArgs) {
        const argFrag = c.arguments as string;
        acc.argBuffer += argFrag;
        frag.function.arguments = argFrag;
        if (argFrag) {
          this.log.push({
            t: Date.now() - this.startMs,
            phase: "tool_args",
            index: i,
            fragment: argFrag,
          });
        }
      }

      // Only emit a tool_calls entry if this delta actually contributed
      // (an id, a name, or an argument fragment).
      if (
        frag.id !== undefined ||
        frag.function.name !== undefined ||
        frag.function.arguments !== undefined
      ) {
        out.toolCalls = [...(out.toolCalls ?? []), frag];
        this.log.push({
          t: Date.now() - this.startMs,
          phase: "tool_delta",
          index: i,
        });
      }
    }
    return out;
  }

  /** Get or create the accumulator for a given tool-call index (§15). */
  private getOrCreate(index: number): ToolCallAccumulator {
    let acc = this.accumulators.get(index);
    if (!acc) {
      acc = {
        index,
        id: `call_${this.idCounter++}_${index}`,
        name: "",
        argBuffer: "",
        idEmitted: false,
        nameEmitted: false,
      };
      this.accumulators.set(index, acc);
    }
    return acc;
  }

  /** True if any tool-call fragment was emitted during this stream. */
  get didEmitToolCalls(): boolean {
    return this.hadToolCalls;
  }

  /** Snapshot of accumulated tool calls (for the debug dashboard, §22). */
  snapshot(): Array<{ index: number; id: string; name: string; argBuffer: string }> {
    return Array.from(this.accumulators.values()).map((a) => ({
      index: a.index,
      id: a.id,
      name: a.name,
      argBuffer: a.argBuffer,
    }));
  }
}

/**
 * Try to parse `s` as a single complete `__tool_calls` marker object.
 * Returns the inner calls array (with name/arguments) or null if `s` is not
 * a complete marker. Used for the common "whole delta is one marker" path
 * which is robust against argument fragments containing `]` / `}`.
 */
function tryParseMarker(
  s: string,
): Array<{ name?: string; arguments?: string }> | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const obj = JSON.parse(trimmed) as { __tool_calls?: unknown };
    if (obj && Array.isArray(obj.__tool_calls)) {
      return obj.__tool_calls as Array<{ name?: string; arguments?: string }>;
    }
  } catch {
    return null;
  }
  return null;
}
