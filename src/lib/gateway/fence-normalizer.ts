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
import {
  freshBalance,
  feedBalance,
  lenientJsonParse,
  repairTruncatedJson,
} from "@/lib/json-repair";

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
 *
 * NEWLINE-TOLERANT OPENER (the `````\ntool_call` leak fix): real upstreams
 * (observed live on au/* models) open the fence with the ``` marker and put
 * the label on the NEXT line. The old regex required the label on the same
 * line, so those blocks fell through to plain text and leaked as visible
 * "```\ntool_call\n```" garbage while a parallel tool call parsed fine.
 * `\r?\n?[ \t]*` between the marker and the label accepts both shapes — a
 * plain ``` code fence whose first content line starts with "tool_call"
 * is tool intent either way.
 */
const FENCE_OPEN_RE =
  /```[ \t]*\r?\n?[ \t]*(?:tool_calls?|tool-calls?|function[_\s-]*calls?)[ \t]*\r?\n?/i;
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
  "```\ntool_call",
  "```\ntool_calls",
  "```\nfunction_call",
  "```\nfunction_calls",
  "```\r\ntool_call",
  "<｜｜DSML｜｜tool_calls>",
];

const FENCE_CLOSE = "```";

/**
 * BRACKET-LABEL tool-call openers (the live `[tool_call] {…}` leak, observed
 * on the Onyx fleet): some upstreams label a text-embedded tool call with a
 * bracket tag instead of a ``` fence —
 *
 *   [tool_call] {"name":"create_file_chunk","arguments":{…}}
 *   [tool_calls] [{"name":"web_search","arguments":{"query":…}}]
 *   [tool-call]: {…}
 *
 * The old behavior: the bare-JSON path matched only the CONTAINER after the
 * label, so the JSON converted to delta.tool_calls while the label itself
 * leaked into the visible reply as a dangling `[tool_call]` fragment
 * (verified live in the OnyxAgent UI). Recognizing the label lets the whole
 * construct convert; the label is consumed as machinery (like a ``` opener).
 */
const BRACKET_LABEL_BASE =
  /\[(?:tool[_\s-]*calls?|tool-calls?|function[_\s-]*calls?)[\s:]*\][\s:]*/i;
/** The label must be immediately followed by a JSON container to ARM. */
const BRACKET_LABEL_ARMED_RE = new RegExp(
  BRACKET_LABEL_BASE.source + "(?=[{\\[])",
  "i",
);
/** Canonical literals for split-across-deltas hold-back math. */
const BRACKET_LABEL_LITERALS: string[] = [
  "[tool_call]",
  "[tool_calls]",
  "[tool-call]",
  "[tool-calls]",
  "[function_call]",
  "[function_calls]",
  "[function-call]",
  "[function-calls]",
  "[tool call]",
  "[function call]",
];

/**
 * BARE-JSON tool-call openers. Real upstreams (observed live) write the tool
 * call as plain JSON with NO fence at all:
 *
 *   [{"name":"ask_user","arguments":{"questions":[...]}}]
 *
 * …and — the fleet-wide leak fixed here — with ESCAPED or CURLY quotes:
 *
 *   [{\"name\":\"ask_user\",\"arguments\":{…}}]      (every quote escaped)
 *   [{\"name\":\"ask_user\",…\"Hard content?”,,”More”?,“Tail\"…}]   (mixed curly)
 *
 * The trigger fires on `[\s*{\s*<q>key<q>\s*:` where <q> is a quote-ish
 * delimiter: straight `"`, backslash-escaped `\"` (any number of leading
 * backslashes), or curly `“ ”`. Firing early (before we can know whether
 * an arguments key follows) is safe: the accumulated container is
 * validated at completion and re-emitted as text when it is ordinary JSON.
 */
const BARE_KEYS = [
  "__tool_calls",
  "function_name",
  "function",
  "arguments",
  "parameters",
  "name",
  "args",
  "tool",
] as const;
const BARE_KEY_ALT = BARE_KEYS.join("|");
/** A quote-ish delimiter: zero-or-more backslashes + straight/curly quote. */
const BARE_Q = `\\\\*["“”]`;
const BARE_OPEN_RE = new RegExp(
  `(\\[\\s*\\{\\s*${BARE_Q}\\s*(?:${BARE_KEY_ALT})\\s*${BARE_Q}\\s*:|\\{\\s*${BARE_Q}\\s*(?:${BARE_KEY_ALT})\\s*${BARE_Q}\\s*:)`,
);
/** Canonical (whitespace-stripped) trigger literals for hold-back math. */
const BARE_TRIGGERS: string[] = [];
for (const k of BARE_KEYS) {
  for (const q1 of ['"', '\\"', "“", "”", '\\\\"']) {
    for (const q2 of ['"', '\\"', "”"]) {
      BARE_TRIGGERS.push(`[{${q1}${k}${q2}:`, `{${q1}${k}${q2}:`);
    }
  }
}
/** Keys that mark an object as having a tool NAME. */
const BARE_NAME_KEYS = ["name", "function_name", "tool"] as const;
/** Keys that mark an object as having tool ARGUMENTS. */
const BARE_ARGS_KEYS = ["arguments", "args", "parameters"] as const;

type Mode = "text" | "fence" | "dsml" | "bare";

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
  /** Bare-JSON container body accumulated while mode === "bare". */
  private bareBody = "";
  /** Bracket-label text consumed when a bare container was entered via
   *  `[tool_call] {…}` (re-emitted with the body when validation fails). */
  private bareLabel = "";
  /** How many chars of bareBody have been fed into the balance scanner. */
  private bareFed = 0;
  /** Bracket/string balance scanner state for the open bare container. */
  private bareBalance = freshBalance();
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
        let match = useFence ? fenceMatch : dsmlMatch;
        if (match === null) {
          // 1a-b. BRACKET-LABEL opener (`[tool_call] {…}` — the live fleet
          // leak). Must run BEFORE the bare check: the bare path would match
          // only the container AFTER the label, letting the label itself
          // leak into the visible text while the JSON converts (observed
          // live: a dangling `[tool_call]` fragment in the rendered reply).
          const labelMatch = BRACKET_LABEL_ARMED_RE.exec(this.pending);
          if (labelMatch !== null) {
            outTextParts.push(this.pending.slice(0, labelMatch.index));
            this.bareLabel = this.pending.slice(
              labelMatch.index,
              labelMatch.index + labelMatch[0].length,
            );
            this.bareBody = this.pending.slice(
              labelMatch.index + labelMatch[0].length,
            );
            this.pending = "";
            this.bareFed = 0;
            this.bareBalance = freshBalance();
            this.mode = "bare";
            continue;
          }
          // 1b. BARE-JSON tool-call opener? (no fence at all — observed on
          // real upstreams). Accumulate the container while it streams.
          const bareMatch = BARE_OPEN_RE.exec(this.pending);
          if (bareMatch !== null) {
            outTextParts.push(this.pending.slice(0, bareMatch.index));
            this.bareLabel = "";
            this.bareBody = this.pending.slice(bareMatch.index);
            this.pending = "";
            this.bareFed = 0;
            this.bareBalance = freshBalance();
            this.mode = "bare";
            continue;
          }
          match = null;
        }
        if (match !== null) {
          outTextParts.push(this.pending.slice(0, match.index));
          this.openerText = match[0];
          this.pending = this.pending.slice(match.index + match[0].length);
          this.mode = useFence ? "fence" : "dsml";
          continue;
        }

        // 2. No complete opener. Hold back a tail that could still COMPLETE
        //    into an opener (split across deltas) — fence/DSML opener
        //    prefixes AND bare-JSON trigger prefixes. At end-of-stream there
        //    is nothing left to wait for → release everything.
        const hold = final
          ? 0
          : Math.max(
              this.openerPrefixSuffixLen(this.pending),
              this.bareTriggerSuffixLen(this.pending),
              this.bracketLabelSuffixLen(this.pending),
            );
        const emitLen = this.pending.length - hold;
        if (emitLen > 0) {
          outTextParts.push(this.pending.slice(0, emitLen));
          this.pending = this.pending.slice(emitLen);
        }
        break; // nothing more can happen in text mode
      }

      if (this.mode === "bare") {
        // 1c. New text always lands in `pending` (push) — move it into the
        //     bare container body first, then feed the un-fed portion into
        //     the bracket/string balance scanner. When nesting returns to
        //     zero the container is COMPLETE — parse it. Everything after
        //     the completion index returns to text mode. A TRAILING LONE
        //     BACKSLASH is held back: it may be the first half of a `\"`
        //     delimiter split across deltas (without the hold, the scanner
        //     would open a PLAIN string on the next delta and mis-track).
        if (this.pending) {
          let feed = this.pending;
          if (!final && feed.endsWith("\\")) {
            this.bareBody += feed.slice(0, -1);
            this.pending = "\\";
          } else {
            this.bareBody += feed;
            this.pending = "";
          }
        }
        const unfed = this.bareBody.slice(this.bareFed);
        this.bareFed = this.bareBody.length;
        const rel = feedBalance(this.bareBalance, unfed);
        if (rel !== -1) {
          const abs = this.bareBody.length - unfed.length + rel;
          const completed = this.bareBody.slice(0, abs + 1);
          this.pending = this.bareBody.slice(abs + 1);
          this.bareBody = "";
          this.bareFed = 0;
          this.bareBalance = freshBalance();
          this.finishBare(completed, false, outTextParts, outCalls);
          continue;
        }
        if (final) {
          // Truncated at end-of-stream — repair the JSON (close open
          // strings/brackets) and try to salvage a partial tool call.
          const whole = this.bareBody;
          this.bareBody = "";
          this.bareFed = 0;
          this.mode = "text";
          this.finishBare(whole, true, outTextParts, outCalls);
          break;
        }
        // Still open — keep accumulating (the body must never leak as
        // text before we know whether it is a tool call).
        break;
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
   * A balanced (or end-of-stream truncated) bare-JSON container: validate
   * that it is tool-call-shaped (name + arguments-ish keys), convert to
   * standard tool calls, or re-emit it as text when it is ordinary JSON.
   */
  private finishBare(
    body: string,
    truncated: boolean,
    outTextParts: string[],
    outCalls: FenceToolCallFragment[],
  ): void {
    this.mode = "text";
    const calls = parseBareBody(body, truncated);
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
      this.bareLabel = ""; // the label is machinery — consumed, never shown
      return;
    }
    // Ordinary JSON (or unparseable) — re-emit as text (never lose
    // content). A bracket label that armed this capture is re-emitted with
    // it: the construct was NOT a tool call, so it is the model's text.
    outTextParts.push(this.bareLabel + body);
    this.bareLabel = "";
  }

  /**
   * Length of the longest suffix of `s` whose whitespace-stripped form is a
   * strict prefix of a bare-JSON trigger literal — i.e. a tail that could
   * still complete into `[{"name":` etc. across delta boundaries.
   * Whitespace between JSON tokens is tolerated by stripping it from the
   * suffix before the prefix check; a suffix consisting purely of
   * whitespace also counts (it may precede an incoming trigger).
   */
  private bareTriggerSuffixLen(s: string): number {
    if (s.length === 0) return 0;
    // Valid trigger prefixes are ≤ 24 canonical chars — only the last
    // (canonical-length + whitespace) region can hold one.
    const maxCanon = 24;
    const window = s.length > maxCanon * 8 ? s.slice(s.length - maxCanon * 8) : s;
    for (let p = 0; p < window.length; p++) {
      const tail = window.slice(p);
      const canon = tail.replace(/\s+/g, "");
      if (BARE_TRIGGERS.some((t) => t.startsWith(canon) && canon.length < t.length)) {
        return tail.length;
      }
      // Pure-whitespace tail — hold it (a trigger may follow immediately).
      if (canon.length === 0 && tail.length > 0) {
        return tail.length;
      }
    }
    return 0;
  }

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
    // EMPTY-BODY FENCE (the ```\ntool_call\n\n``` leak fix): an opener with
    // no body carries zero user value — it is pure tool machinery the model
    // emitted and then abandoned. Re-emitting it as content (the old
    // fall-through) leaked the raw fence markers into the visible reply.
    if (!fullBody.trim()) {
      this.openerText = "";
      return;
    }
    // REPAIR IS ALWAYS ALLOWED for tool_call-labeled fences: the label is
    // explicit tool intent, so a malformed body (curly quotes, missing
    // brackets, truncation artifacts) is aggressively salvaged instead of
    // leaking to the client as raw JSON text. Valid JSON parses via the
    // plain candidates first — repair variants are appended AFTER, so this
    // changes nothing for well-formed bodies.
    const calls = parseFenceBody(fullBody, true);
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
    // Unparseable but NON-EMPTY → re-emit the BODY as text (never lose
    // content) WITHOUT the ```/tool_call opener — the opener is machinery,
    // not something the model meant the user to see.
    outTextParts.push(fullBody);
    this.openerText = "";
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
   * Length of the longest suffix of `s` that is a proper prefix of a bracket
   * label (`[tool_call]`…), case-insensitive. 0 = nothing to hold. A partial
   * label (`[tool`, `[tool_call`) split across deltas must not leak as text
   * before it can arm — same rule as the fence/bare openers.
   */
  private bracketLabelSuffixLen(s: string): number {
    if (s.length === 0) return 0;
    const lower = s.toLowerCase();
    let best = 0;
    for (const label of BRACKET_LABEL_LITERALS) {
      // (a) PROPER PREFIX (split mid-label): "[tool", "[tool_call"…
      const maxK = Math.min(label.length - 1, lower.length);
      for (let k = maxK; k > best; k--) {
        if (lower.endsWith(label.slice(0, k))) {
          best = k;
          break;
        }
      }
      // (b) COMPLETE label + trailing whitespace: could still ARM when the
      // NEXT delta opens the container (the live case — label in one
      // delta, the JSON object in the next). Hold label + whitespace tail
      // (capped: a long whitespace run without a container is prose
      // formatting, not an arming gap).
      const at = lower.lastIndexOf(label);
      if (at !== -1) {
        const tail = lower.slice(at + label.length);
        // an arming gap may be pure whitespace AND/OR colons ("[tool_call]: ")
        const gapOk = /^[\s:]*$/.test(tail);
        if (tail.length === 0 || gapOk) {
          const hold = Math.min(lower.length - at, label.length + 20);
          if (hold > best) best = hold;
        }
      }
    }
    return best;
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
 *   - LENIENT salvage (last resort): curly quotes, stray junk between
 *     elements, missing brackets — anything the tolerant parser recovers
 * Returns null when the body does not yield ANY valid call (caller re-emits
 * as text).
 */
export function parseFenceBody(
  body: string,
  allowRepair = false,
): ParsedToolCall[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const candidates = jsonCandidates(trimmed, allowRepair);

  // Pass 1 — strict JSON.parse on every candidate.
  for (const candidate of candidates) {
    const calls = extractCalls(candidate);
    if (calls !== null && calls.length > 0) return calls;
  }

  // Pass 2 — LENIENT salvage (curly quotes / junk / missing brackets).
  // The ```tool_call label is explicit intent, so we salvage aggressively.
  for (const candidate of candidates.slice(0, 4)) {
    const parsed = lenientJsonParse(candidate);
    if (parsed === null) continue;
    const calls = normalizeParsedCalls(parsed);
    if (calls !== null && calls.length > 0) return calls;
  }
  return null;
}

/**
 * Parse a BARE (unfenced) JSON container into tool calls. Stricter than
 * parseFenceBody: a bare container must be tool-call-SHAPED — the first
 * item needs BOTH a name-ish key AND an arguments-ish key — otherwise it
 * is ordinary JSON (an example object in prose, a config dump, …) and is
 * re-emitted as text by the caller.
 */
function parseBareBody(
  body: string,
  truncated: boolean,
): ParsedToolCall[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const candidates = jsonCandidates(trimmed, truncated);

  // Pass 1 — strict JSON.parse (with tool-call shape validation).
  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    // `__tool_calls` marker object (providers that serialize native
    // tool_calls deltas as JSON marker strings).
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray((parsed as Record<string, unknown>).__tool_calls)
    ) {
      const inner = (parsed as Record<string, unknown>).__tool_calls as Array<
        Record<string, unknown>
      >;
      const calls: ParsedToolCall[] = [];
      for (const c of inner) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.name !== "string" || !c.name) continue;
        const raw = c.arguments;
        const args =
          typeof raw === "string"
            ? raw
            : raw === undefined || raw === null
              ? "{}"
              : JSON.stringify(raw);
        calls.push({ name: c.name, arguments: args });
      }
      if (calls.length > 0) return calls;
      continue;
    }

    if (!bareShapeOk(parsed)) continue; // ordinary JSON — not a tool call

    const calls = extractCalls(candidate);
    if (calls !== null && calls.length > 0) return calls;
  }

  // Pass 2 — LENIENT salvage (curly quotes / escaped delimiters / junk /
  // missing brackets), gated by the same tool-call SHAPE check so ordinary
  // JSON arrays in prose are never hijacked.
  for (const candidate of candidates.slice(0, 4)) {
    const parsed = lenientJsonParse(candidate);
    if (parsed === null) continue;
    if (!bareShapeOk(parsed)) continue;
    const calls = normalizeParsedCalls(parsed);
    if (calls !== null && calls.length > 0) return calls;
  }
  return null;
}

/**
 * Tool-call SHAPE gate for bare (unfenced) containers: the first object
 * must carry BOTH a name-ish key AND an arguments-ish key (top-level or
 * nested under `function`). Ordinary JSON fails this and stays text.
 */
function bareShapeOk(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== "object") return false;
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const first = arr.find(
    (x) => x !== null && typeof x === "object",
  ) as Record<string, unknown> | undefined;
  if (!first) return false;
  const fn = (first.function ?? null) as Record<string, unknown> | null;
  const hasName =
    BARE_NAME_KEYS.some(
      (k) => typeof (first as Record<string, unknown>)[k] === "string",
    ) || typeof fn?.name === "string";
  const hasArgs =
    BARE_ARGS_KEYS.some(
      (k) => (first as Record<string, unknown>)[k] !== undefined,
    ) || fn?.arguments !== undefined;
  return hasName && hasArgs;
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
  return normalizeParsedCalls(parsed);
}

/** Normalize an ALREADY-PARSED value into tool calls (strict shapes only). */
function normalizeParsedCalls(parsed: unknown): ParsedToolCall[] | null {
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: ParsedToolCall[] = [];
  for (const item of arr) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const fn = (obj.function ?? null) as Record<string, unknown> | null;
    const name =
      typeof obj.name === "string"
        ? obj.name
        : typeof obj.function_name === "string"
          ? obj.function_name
          : typeof obj.tool === "string"
            ? obj.tool
            : typeof fn?.name === "string"
              ? (fn?.name as string)
              : undefined;
    if (!name) continue;
    const rawArgs =
      obj.arguments ?? obj.args ?? fn?.arguments ?? fn?.parameters ?? obj.parameters;
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
 * Each base (whole string + extracted outermost container) is expanded with
 * unescape variants (\" → ", \\\" → "), and — when `allowRepair` is set
 * (truncated container / tool_call-labeled fence) — with truncated-JSON
 * repair variants appended AFTER the plain ones so valid JSON always wins.
 */
function jsonCandidates(s: string, allowRepair = false): string[] {
  const out: string[] = [];
  const push = (t: string): void => {
    if (t && !out.includes(t)) out.push(t);
  };

  // Extract the outermost container (models wrap tool JSON in prose).
  const extracted = extractOutermostContainer(s);

  // Bases + their unescape variants.
  const bases = extracted && extracted !== s ? [s, extracted] : [s];
  for (const base of bases) {
    push(base);
    if (base.includes('\\"')) push(base.replace(/\\"/g, '"'));
    if (/\\+"/.test(base)) push(base.replace(/\\+"/g, '"'));
  }

  if (allowRepair) {
    // Truncated-JSON repair on every variant so far: closes open strings
    // and brackets, salvaging a structurally sound PARTIAL tool call.
    for (const base of [...out]) {
      push(repairTruncatedJson(base));
    }
  }
  return out;
}

/** The outermost JSON array or object in `s`, or null when none. */
function extractOutermostContainer(s: string): string | null {
  const arrIdx = indexOfTopLevel(s, "[");
  const objIdx = indexOfTopLevel(s, "{");
  const pick = arrIdx === -1 ? objIdx : objIdx === -1 ? arrIdx : Math.min(arrIdx, objIdx);
  if (pick === -1) return null;
  const open = s[pick];
  const close = open === "[" ? "]" : "}";
  const lastIdx = s.lastIndexOf(close);
  if (lastIdx > pick) return s.slice(pick, lastIdx + 1);
  return null;
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
