/**
 * Streaming fence normalizer — FIX B ("the AI says it has no tools").
 *
 * PROBLEM (diagnosed live against the deployed gateway):
 * Several upstreams CANNOT emit standard `delta.tool_calls` SSE chunks. When
 * a tool-using request streams, the model writes the tool call as a fenced
 * code block INSIDE `delta.content`:
 *
 *   data: {"choices":[{"delta":{"content":"```tool_call\n[{\"name\":\"get_weather\",\"arguments\":{\"city\":\"Tokyo\"}}]\n```"}}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}]}   ← "stop", NOT "tool_calls"
 *
 * A standard OpenAI client therefore sees plain text, renders a code block,
 * never executes the tool, and the model — receiving no tool result —
 * concludes "I don't have tools".
 *
 * FIX (this module, applied at the gateway so EVERY OpenAI-compatible
 * client is fixed at once):
 *   - accumulate streamed `delta.content`
 *   - when the accumulated text opens a tool-call fence (```tool_call,
 *     ```tool_calls, ```tool-call, ```function_call, …) STOP forwarding those
 *     text deltas and buffer them
 *   - when the fence closes (or the stream ends), parse the body into
 *     standard tool calls and re-emit them as `delta.tool_calls` chunks
 *   - the finish_reason is rewritten to "tool_calls" (the streaming-proxy
 *     consults `didEmitToolCalls`)
 *   - text BEFORE the fence is forwarded as normal content; the fence body
 *     itself is never shown as text
 *   - malformed fence bodies are re-emitted as text (nothing is ever lost)
 *
 * Also handles the DeepSeek-style DSML tag form:
 *
 *   <｜｜DSML｜｜tool_calls>
 *     <｜｜DSML｜｜invoke name="get_weather">
 *       <｜｜DSML｜｜parameter name="city">Tokyo<｜｜DSML｜｜/parameter>
 *     <｜｜DSML｜｜/invoke>
 *   </｜｜DSML｜｜tool_calls>
 *
 * The normalizer is OPT-IN: construct it with `enabled = true` only when the
 * request actually carried `tools` (a model that spontaneously writes a
 * ```tool_call block in a tools-less conversation should keep it as text).
 *
 * Streaming safety: only a small tail (≤ 23 chars) is ever held back between
 * deltas — the minimum needed to detect an opener split across chunk
 * boundaries. Everything else flows through immediately.
 */

import { generateToolCallId } from "@/lib/openai-types";

/** One normalized tool-call fragment (complete call — safe for accumulators). */
export interface FenceToolCallFragment {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** push()/flush() output: pass-through text and/or normalized tool calls. */
export interface FenceDeltaOut {
  /** Plain text to forward as `delta.content`. */
  content?: string;
  /** Complete tool calls to forward as `delta.tool_calls`. */
  toolCalls?: FenceToolCallFragment[];
}

/**
 * Openers, longest first. Each is matched case-insensitively; the regex form
 * also tolerates `tool-calls`, `function calls`, etc.
 */
const FENCE_OPEN_RE =
  /```(?:tool_calls?|tool-calls?|function[_\s-]*calls?)[ \t]*\n?/i;
const DSML_OPEN_RE = /<｜｜DSML｜｜tool_calls\s*>/i;
const DSML_CLOSE_RE = /<\/｜｜DSML｜｜tool_calls\s*>/i;

/** Literal opener strings used for split-across-deltas prefix detection. */
const OPENER_LITERALS: string[] = [
  "```tool_call",
  "```tool_calls",
  "```tool-call",
  "```tool-calls",
  "```function_call",
  "```function_calls",
  "```function-call",
  "```function-calls",
  "```function call",
  "```function calls",
  "<｜｜DSML｜｜tool_calls>",
];

const FENCE_CLOSE = "```";
const MAX_OPENER_LEN = Math.max(...OPENER_LITERALS.map((s) => s.length));

type Mode = "text" | "fence" | "dsml";

/**
 * One instance PER STREAM. Feed it every `delta.content` piece via push();
 * call flush() exactly once when the upstream generator finishes, BEFORE the
 * final stop chunk is emitted.
 */
export class FenceNormalizer {
  private mode: Mode = "text";
  /** Text not yet forwarded (either held-back tail or fence body). */
  private pending = "";
  /** Recognized fence opener text (kept so failed parses can be re-emitted). */
  private openerText = "";
  /** Extra buffer for fence/dsml bodies (pending holds only the tail). */
  private openerBody = "";
  private hadToolCalls = false;
  private emittedCount = 0;
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** True if any fence-parsed tool call was emitted during this stream. */
  get didEmitToolCalls(): boolean {
    return this.hadToolCalls;
  }

  /** Number of fence-parsed tool calls emitted (diagnostics). */
  get emittedToolCallCount(): number {
    return this.emittedCount;
  }

  /**
   * Consume one content delta. Returns pass-through text and/or fully-formed
   * tool calls. When disabled (request carried no tools), text passes through
   * untouched and tool calls are never produced.
   */
  push(chunk: string): FenceDeltaOut {
    if (!this.enabled) return chunk ? { content: chunk } : {};
    if (!chunk) return {};

    this.pending += chunk;
    return this.drain(false);
  }

  /**
   * End of stream: release any held text, close an unterminated fence
   * (models occasionally never write the closing ``` — the body may still
   * parse), and parse a trailing partial opener conservatively (kept as text).
   */
  flush(): FenceDeltaOut {
    if (!this.enabled) {
      const out = this.pending ? { content: this.pending } : {};
      this.pending = "";
      return out;
    }
    return this.drain(true);
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Core state machine. `final` = end of stream (no more chunks will arrive,
   * so openers can no longer complete and fences can no longer close).
   */
  private drain(final: boolean): FenceDeltaOut {
    const outTextParts: string[] = [];
    const outCalls: FenceToolCallFragment[] = [];

    // Loop: one transition per iteration (text → fence → text → …).
    for (let guard = 0; guard < 100; guard++) {
      if (this.mode === "text") {
        // 1. Complete opener present? → flush pre-text, enter capture mode.
        const fenceMatch = FENCE_OPEN_RE.exec(this.pending);
        const dsmlMatch = DSML_OPEN_RE.exec(this.pending);
        const useFence =
          fenceMatch !== null &&
          (dsmlMatch === null || fenceMatch.index <= dsmlMatch.index);
        const match = useFence ? fenceMatch : dsmlMatch;
        if (match !== null) {
          outTextParts.push(this.pending.slice(0, match.index));
          this.openerText = match[0];
          this.pending = this.pending.slice(match.index + match[0].length);
          this.mode = useFence ? "fence" : "dsml";
          continue;
        }

        // 2. No complete opener. Hold back a tail that could still COMPLETE
        //    into an opener (split across deltas). At end-of-stream there is
        //    nothing left to wait for → release everything.
        const hold = final ? 0 : this.openerPrefixSuffixLen(this.pending);
        const emitLen = this.pending.length - hold;
        if (emitLen > 0) {
          outTextParts.push(this.pending.slice(0, emitLen));
          this.pending = this.pending.slice(emitLen);
        }
        break; // nothing more can happen in text mode
      }

      if (this.mode === "fence") {
        // 3. Look for the closing ```.
        const closeIdx = this.pending.indexOf(FENCE_CLOSE);
        if (closeIdx !== -1) {
          const body = this.pending.slice(0, closeIdx);
          this.pending = this.pending.slice(closeIdx + FENCE_CLOSE.length);
          this.finishFence(body, false, outTextParts, outCalls);
          continue;
        }
        if (final) {
          // Unterminated fence at end-of-stream → try to parse what we have.
          this.finishFence(this.pending, true, outTextParts, outCalls);
          this.pending = "";
          break;
        }
        // Hold back up to 2 chars in case ``` is split across deltas.
        const hold = Math.min(2, this.pending.length);
        const bodyPart = this.pending.slice(0, this.pending.length - hold);
        if (bodyPart) {
          this.openerBody += bodyPart;
          this.pending = this.pending.slice(bodyPart.length);
        }
        break;
      }

      // mode === "dsml"
      const closeMatch = DSML_CLOSE_RE.exec(this.pending);
      if (closeMatch !== null) {
        const body = this.openerBody + this.pending.slice(0, closeMatch.index);
        this.pending = this.pending.slice(
          closeMatch.index + closeMatch[0].length,
        );
        this.finishDsml(body, outTextParts, outCalls);
        continue;
      }
      if (final) {
        this.finishDsml(
          this.openerBody + this.pending,
          outTextParts,
          outCalls,
        );
        this.openerBody = "";
        this.pending = "";
        this.mode = "text";
        break;
      }
      // Hold back a tail that could complete the close tag.
      const closeLen = "</｜｜DSML｜｜tool_calls>".length;
      const hold = Math.min(closeLen - 1, this.pending.length);
      const bodyPart = this.pending.slice(0, this.pending.length - hold);
      if (bodyPart) {
        this.openerBody += bodyPart;
        this.pending = this.pending.slice(bodyPart.length);
      }
      break;
    }

    const out: FenceDeltaOut = {};
    const text = outTextParts.join("");
    if (text) out.content = text;
    if (outCalls.length > 0) out.toolCalls = outCalls;
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * A closed (or end-of-stream unterminated) fence: parse the body into tool
   * calls, or re-emit the whole block as text when unparseable.
   */
  private finishFence(
    body: string,
    unterminated: boolean,
    outTextParts: string[],
    outCalls: FenceToolCallFragment[],
  ): void {
    this.mode = "text";
    const fullBody = this.openerBody + body;
    this.openerBody = "";
    const calls = parseFenceBody(fullBody);
    if (calls !== null && calls.length > 0) {
      for (const call of calls) {
        outCalls.push({
          index: this.emittedCount,
          id: generateToolCallId(),
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        });
        this.emittedCount++;
      }
      this.hadToolCalls = true;
      return;
    }
    // Unparseable → re-emit the ORIGINAL block as text (never lose content).
    outTextParts.push(
      `${this.openerText}${fullBody}${unterminated ? "" : FENCE_CLOSE}`,
    );
  }

  /** A closed (or end-of-stream) DSML block: parse invoke/parameter tags. */
  private finishDsml(
    body: string,
    outTextParts: string[],
    outCalls: FenceToolCallFragment[],
  ): void {
    this.mode = "text";
    const calls = parseDsmlBody(body);
    if (calls.length > 0) {
      for (const call of calls) {
        outCalls.push({
          index: this.emittedCount,
          id: generateToolCallId(),
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        });
        this.emittedCount++;
      }
      this.hadToolCalls = true;
      // The DSML tags are consumed — never shown as text (matches the
      // fence behavior: the tool-call block is not visible content).
      return;
    }
    // Unparseable DSML → keep any inner text, strip the raw tags (the tags
    // themselves are markup, not content the model intended to show).
    const stripped = body
      .replace(/<｜｜DSML｜｜[^>]*>/g, "")
      .replace(/<\/｜｜DSML｜｜[^>]*>/g, "")
      .trim();
    if (stripped) outTextParts.push(stripped);
  }

  /**
   * Length of the longest suffix of `s` that is a proper prefix of a known
   * opener (case-insensitive). 0 = nothing to hold.
   */
  private openerPrefixSuffixLen(s: string): number {
    if (s.length === 0) return 0;
    const lower = s.toLowerCase();
    let best = 0;
    for (const opener of OPENER_LITERALS) {
      const maxK = Math.min(opener.length - 1, lower.length);
      for (let k = maxK; k > best; k--) {
        if (lower.endsWith(opener.slice(0, k))) {
          best = k;
          break;
        }
      }
    }
    return best;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Body parsers (shared by streaming + non-streaming normalization)
// ───────────────────────────────────────────────────────────────────────────

export interface ParsedToolCall {
  name: string;
  arguments: string;
}

/**
 * Parse a fence body into tool calls. Accepts:
 *   - a JSON array of {name, arguments} (or OpenAI {function:{name,args}})
 *   - a single JSON object of the same shape
 *   - loosely-escaped JSON (models emit \" and \\\" variants)
 *   - JSON embedded in surrounding prose (extracts the outermost […] / {…})
 * Returns null when the body does not yield ANY valid call (caller re-emits
 * as text).
 */
export function parseFenceBody(body: string): ParsedToolCall[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  for (const candidate of jsonCandidates(trimmed)) {
    const calls = extractCalls(candidate);
    if (calls !== null && calls.length > 0) return calls;
  }
  return null;
}

/** Parse DSML invoke/parameter tags into tool calls. */
export function parseDsmlBody(body: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const invokeRe = /<｜｜DSML｜｜invoke\s+name="([^"]+)"\s*>([\s\S]*?)(?:<｜｜DSML｜｜\/invoke>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(body)) !== null) {
    const name = m[1];
    const invokeBody = m[2] ?? "";
    const args: Record<string, string> = {};
    const paramRe = /<｜｜DSML｜｜parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?:<｜｜DSML｜｜\/parameter>|(?=<｜｜DSML｜｜)|$)/gi;
    let p: RegExpExecArray | null;
    while ((p = paramRe.exec(invokeBody)) !== null) {
      args[p[1]] = (p[2] ?? "").trim();
    }
    if (name) {
      calls.push({ name, arguments: JSON.stringify(args) });
    }
  }
  if (calls.length === 0) {
    // Some "DSML" bodies are actually plain JSON — fall back.
    const json = parseFenceBody(body);
    if (json) return json;
  }
  return calls;
}

/** Parse a candidate JSON string into normalized tool calls. */
function extractCalls(candidate: string): ParsedToolCall[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: ParsedToolCall[] = [];
  for (const item of arr) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const fn = (obj.function ?? null) as Record<string, unknown> | null;
    const name = typeof obj.name === "string" ? obj.name : typeof fn?.name === "string" ? (fn?.name as string) : undefined;
    if (!name) continue;
    const rawArgs =
      obj.arguments ?? fn?.arguments ?? fn?.parameters ?? obj.parameters;
    const args =
      typeof rawArgs === "string"
        ? rawArgs
        : rawArgs === undefined || rawArgs === null
          ? "{}"
          : JSON.stringify(rawArgs);
    out.push({ name, arguments: args });
  }
  return out.length > 0 ? out : null;
}

/**
 * Loose-JSON candidates for models that emit escaped / prose-wrapped JSON.
 */
function jsonCandidates(s: string): string[] {
  const candidates: string[] = [s];

  // Unescape \" → " (single-escaped).
  if (s.includes('\\"')) candidates.push(s.replace(/\\"/g, '"'));
  // Unescape \\" → " (double-escaped).
  if (s.includes('\\\\\\"')) candidates.push(s.replace(/\\+"/g, '"'));
  // Strip stray backslashes before quotes.
  if (/\\+"/.test(s)) candidates.push(s.replace(/\\+"/g, '"'));

  // Extract outermost JSON array or object when wrapped in prose.
  const arrIdx = indexOfTopLevel(s, "[");
  const objIdx = indexOfTopLevel(s, "{");
  const pick = arrIdx === -1 ? objIdx : objIdx === -1 ? arrIdx : Math.min(arrIdx, objIdx);
  if (pick !== -1) {
    const open = s[pick];
    const close = open === "[" ? "]" : "}";
    const lastIdx = s.lastIndexOf(close);
    if (lastIdx > pick) {
      candidates.push(s.slice(pick, lastIdx + 1));
    }
  }

  // Deduplicate.
  return [...new Set(candidates)];
}

/** Index of the first `ch` that is not inside a string literal (approximate). */
function indexOfTopLevel(s: string, ch: string): number {
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr && c === ch) return i;
  }
  return -1;
}
