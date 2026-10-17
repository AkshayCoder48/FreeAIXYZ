/**
 * VISIBLE-CONTENT OUTPUT SANITIZER (G4).
 *
 * Defense-in-depth for the model-visible reply path (delta.content /
 * message.content — NEVER delta.tool_calls). Even after the source fixes
 * (narrative toolbaz serialization, natural tool-result framing), models
 * occasionally emit:
 *
 *   1. TRANSCRIPT LABELS — replies opening with a literal "Assistant:" /
 *      "User:" / "System:" / "Tool:" line (the misplaced-rounds regression:
 *      models fed labeled transcripts echo the labels and then fabricate
 *      both sides of the dialogue).
 *   2. MACHINERY ECHOES — tool-exchange protocol text that belongs to the
 *      WIRE, not to the reply:
 *        "[tool result for create_file (call_…)]"        (v1 gateway format)
 *        "The X tool finished with this result:"          (v2 gateway format)
 *        "<tool_result name=… tool_call_id=…>…</tool_result>" (client wire-compat)
 *        "```tool_call …```" fences that escaped the FenceNormalizer
 *        "[Calling create_file with {…}]"                 (client tool-text mode)
 *        "[Used tools: web_search, use_browser]"          (client history
 *            annotation — models ECHO it and INVENT new ones with
 *            hallucinated tool names like "Onyx Platform"; both die here)
 *
 * Both classes are stripped from the visible content at the gateway, so
 * clients (and the conversation history they build from the reply) never
 * see or re-learn the patterns. Structured tool_calls are untouched.
 */

/** Speaker labels that mark transcript junk (never natural speaker names). */
const TRANSCRIPT_LABEL_RE = /^(\s*)(Assistant|User|System|Tool)\s*[:：]\s*/gm;

/**
 * Machinery markers, longest-first. Each entry strips the marker (and, for
 * block markers, everything inside the block) from visible content.
 */
const MACHINERY_MARKER_RES: RegExp[] = [
  // v1 gateway tool-result header (echoed by models from older histories).
  /\[tool result for [^\]]{0,200}\][ \t]*\n?/g,
  // v2 gateway tool-result header (current format — echo backstop).
  /\[The [a-zA-Z0-9_.-]{1,64} tool finished[^\]]{0,200}\][ \t]*\n?/g,
  // Client wire-compat <tool_result> blocks (paired, then unclosed stub).
  /<tool_result[^>]{0,200}>[\s\S]*?<\/tool_result>[ \t]*\n?/g,
  /<tool_result[^>]{0,200}>[ \t]*\n?/g,
  // Client tool-text mode call lines.
  /\[Calling [a-zA-Z0-9_.-]{1,64} with [\s\S]{0,2200}?\][ \t]*\n?/g,
  // PRIOR-TURN TOOL-USE ANNOTATION echoes + hallucinated variants. The
  // client appends "[Used tools: a, b]" to prior assistant messages so the
  // model can see its own past tool use — small models echo the line back
  // AND fabricate new ones for tools that don't exist ("[Used tools: Onyx
  // Platform, Message Display]"). Tool names here are free-form words
  // (spaces allowed), so the pattern is looser than the [Calling …] one.
  /\[Used tools?:\s?[^\]\n]{0,300}\][ \t]*\n?/gi,
  /\(You (?:previously )?used tools?:[^)\n]{0,300}\)[ \t]*\n?/gi,
  // ```tool_call fences that slipped past the FenceNormalizer (paired, then
  // unterminated — an unterminated fence in visible content is always a leak).
  /```tool_call[^\n]*\n[\s\S]*?```[ \t]*\n?/g,
  /```tool_call[^\n]*\n[\s\S]*$/g,
  // A bare opening fence line with nothing after it.
  /```tool_call[ \t]*\n?/g,
  // BRACKET-LABEL tool-call markers that never ARMED (no JSON container
  // followed, so the FenceNormalizer left them as text) — the live fleet
  // leak: upstreams label text-embedded calls `[tool_call] {…}`; when the
  // JSON after the label parses via another path or is absent, the label
  // still surfaces in the visible reply as a dangling fragment. Armed
  // labels are consumed by the FenceNormalizer BEFORE the sanitizer runs,
  // so anything left here is stray machinery.
  /\[(?:tool[_\s-]*calls?|tool-calls?|function[_\s-]*calls?)[\s:]*\][\s:]*(?=\n|$)/gi,
  /\[(?:tool[_\s-]*calls?|tool-calls?|function[_\s-]*calls?)[\s:]*\][\s:]*(?=[{\[])/gi,
  // MULTILINE VARIANT (the "```\ntool_call" leak): the marker and the label
  // on SEPARATE lines — the single-line patterns above miss it. Paired first,
  // then the unterminated tail, then a bare marker+label open.
  /```[ \t]*\r?\n[ \t]*tool_calls?[^\n]*\n[\s\S]*?```[ \t]*\n?/gi,
  /```[ \t]*\r?\n[ \t]*tool_calls?[\s\S]*$/gi,
  /```[ \t]*\r?\n[ \t]*tool_calls?[ \t]*\r?\n?/gi,
  // WEB-SEARCH CITATION TOKENS (live leak, 2026-10-17 UI verify): upstream
  // search grounding (aipkit/unlimitedai with frontend_web_search_active)
  // inlines raw JSON citation payloads into the content stream:
  //   【{"id":1,"cursor":0,"loc":0}】
  // The payload is wire machinery — source coordinates for the upstream
  // site's own citation popover — never user-facing prose. The model
  // narrates its sources in text ("as shown on the npm package page"),
  // so the token is stripped wholesale. Non-JSON brackets (【1】 index
  // style, CJK quotes) are left alone.
  /【\s*\{[^】]{0,400}?\}\s*】[ \t]?/g,
];

/**
 * Body-only clean (machinery markers + transcript labels + blank-run
 * collapse — NO head trim). Used by the streaming class once content has
 * been emitted: its buffer then starts MID-TEXT (it is the held-back tail),
 * and the one-shot head trim would eat interior whitespace wherever the
 * 64-char hold-back boundary lands on a space ("final delta" → "finaldelta").
 */
function sanitizeVisibleBody(text: string): string {
  let out = text;
  for (const re of MACHINERY_MARKER_RES) {
    out = out.replace(re, "");
  }
  // Transcript labels: strip the LABEL ONLY (the rest of the line is the
  // model's actual content). Multi-line flag also covers the reply start.
  out = out.replace(TRANSCRIPT_LABEL_RE, "");
  // Collapse the blank runs left behind by removals.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

/**
 * One-shot sanitizer for complete texts (non-streaming responses, buffered
 * legacy streams) — body clean + head trim.
 */
export function sanitizeVisibleContent(text: string): string {
  if (!text) return text;
  return sanitizeVisibleBody(text).replace(/^[ \t\n]+/, "");
}

/**
 * Hold-back window for streaming: the tail of the cleaned buffer that stays
 * unemitted until more deltas arrive (or finish()). CAPS the dynamic hold
 * from machinerySuffixLen (see below) — see TAIL_HOLD note.
 */
const TAIL_HOLD = 64;

/**
 * DYNAMIC HOLD (the streaming-regression fix): the OLD flat 64-char tail
 * hold meant a stream whose content so far is < 64 chars — or whose first
 * content is followed by a pause (thinking models) — emitted NOTHING until
 * flush(): the client's first byte only arrived at upstream completion
 * (PRD §137 violation, "proxy buffered until upstream completion", live:
 * short replies felt frozen). The hold must cover exactly what could
 * still GROW INTO a machinery marker split across deltas — the same
 * prefix-suffix rule the FenceNormalizer uses for its openers. Everything
 * before that prefix is safe to emit immediately.
 */
const MACHINERY_PREFIX_LITERALS: string[] = [
  // [Used tools: …] / (You previously used tools: …) echoes + fabrications.
  "[used tools:",
  "[used tool:",
  "(you previously used tools:",
  "(you used tools:",
  // [Calling X with {…}] client tool-text mode.
  "[calling ",
  // v1/v2 gateway tool-result headers.
  "[tool result for ",
  "[the ",
  // Client wire-compat <tool_result> blocks.
  "<tool_result",
  // ```tool_call fences that slipped past the FenceNormalizer.
  "```tool_call",
  "```tool_calls",
  "```tool-call",
  "```tool-calls",
  "```function_call",
  "```function_calls",
  "```function-call",
  "```function-calls",
  "```",
  // DSML tags.
  "<｜｜dsml｜｜tool_calls",
  // Unarmed bracket labels (the live [tool_call] leak — stripped only when
  // they resolve as stray machinery; held here so a split label is caught).
  "[tool_call",
  "[tool_calls",
  "[tool-call",
  "[tool-calls",
  "[function_call",
  "[function_calls",
  "[function-call",
  "[function-calls",
  // Transcript speaker labels (sanitizeVisible* strips them at line
  // starts; the hold keeps a split one from being emitted as text first).
  "assistant:",
  "user:",
  "system:",
  "tool:",
];

/**
 * Cap for the unclosed-citation hold (see machinerySuffixLen): a "【" whose
 * matching "】" has not arrived yet may be the head of a JSON citation
 * payload (typical payloads are 20–60 chars; 96 covers generous loc/cursor
 * values). Past the cap the bracket is treated as prose and released.
 */
const CITATION_HOLD_CAP = 96;

/**
 * Length of the longest suffix of `s` (case-folded) that is a proper
 * prefix of a machinery marker literal — i.e. a tail that could still
 * complete into a marker across the next delta boundary. 0 = emit all.
 */
function machinerySuffixLen(s: string): number {
  if (s.length === 0) return 0;
  const lower = s.toLowerCase();
  let best = 0;
  for (const lit of MACHINERY_PREFIX_LITERALS) {
    const maxK = Math.min(lit.length - 1, lower.length);
    for (let k = maxK; k > best; k--) {
      if (lower.endsWith(lit.slice(0, k))) {
        best = k;
        break;
      }
    }
  }
  let hold = Math.min(best, TAIL_HOLD);
  // UNCLOSED CITATION TOKEN: a "【" with no "】" after it could be a
  // JSON-payload citation split across deltas — hold from that bracket so
  // the completed token reaches MACHINERY_MARKER_RES in one buffer.
  // The literal-prefix mechanism above cannot express this (payloads are
  // variable-length JSON), hence the dedicated scan. Capped so a stray
  // bracket in ordinary prose streams without stalling.
  const openIdx = s.lastIndexOf("【");
  if (openIdx !== -1 && s.indexOf("】", openIdx) === -1) {
    const citationHold = s.length - openIdx;
    if (citationHold <= CITATION_HOLD_CAP) {
      hold = Math.max(hold, citationHold);
    }
  }
  return hold;
}

/**
 * Streaming sanitizer — feed it content deltas, receive clean fragments.
 * Usage: `push(delta)` per chunk; `finish()` at stream end.
 */
export class VisibleContentSanitizer {
  private buffer = "";
  private finished = false;
  /**
   * True once any content has been EMITTED — from then on the buffer's head
   * is a mid-text hold-back slice, so the reply-head trim must NOT run again
   * (it would eat the interior space at the slice boundary). Until then the
   * buffer starts at the true reply head and the full clean applies.
   */
  private emitted = false;

  /** Feed one content fragment; returns the clean text to forward now
   * ("" while the hold-back window is unconsumed). */
  push(delta: string): string {
    if (this.finished) return "";
    if (!delta) return "";
    this.buffer += delta;
    const cleaned = this.emitted
      ? sanitizeVisibleBody(this.buffer)
      : sanitizeVisibleContent(this.buffer);
    // DYNAMIC HOLD: only the tail that could still complete into a
    // machinery marker stays unemitted (machinerySuffixLen) — everything
    // before it streams to the client immediately. The old flat 64-char
    // window held back the first content of every short-or-paused stream
    // until flush() ("proxy buffered until upstream completion").
    const hold = machinerySuffixLen(cleaned);
    if (cleaned.length <= hold) {
      this.buffer = cleaned;
      return "";
    }
    const emit = cleaned.slice(0, cleaned.length - hold);
    this.buffer = cleaned.slice(cleaned.length - hold);
    this.emitted = true;
    return emit;
  }

  /** End of stream — releases the held-back tail. */
  finish(): string {
    if (this.finished) return "";
    this.finished = true;
    const out = this.emitted
      ? sanitizeVisibleBody(this.buffer)
      : sanitizeVisibleContent(this.buffer);
    this.buffer = "";
    return out;
  }
}
