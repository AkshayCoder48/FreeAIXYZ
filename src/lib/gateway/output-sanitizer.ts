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
 * unemitted until more deltas arrive (or finish()). Long enough to cover the
 * longest marker prefix that can span a delta boundary ("[tool result for …"
 * is ~40 chars; "<tool_result …" ~30; a label + newline ~14).
 */
const TAIL_HOLD = 64;

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
    if (cleaned.length <= TAIL_HOLD) {
      this.buffer = cleaned;
      return "";
    }
    const emit = cleaned.slice(0, cleaned.length - TAIL_HOLD);
    this.buffer = cleaned.slice(cleaned.length - TAIL_HOLD);
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
