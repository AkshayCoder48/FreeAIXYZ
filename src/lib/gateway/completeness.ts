/**
 * Text-completeness heuristics shared by every auto-continuation layer.
 *
 * WHY THIS EXISTS: users reported the AI "stops whenever it wants" — replies
 * cut mid-code (unclosed ``` fences, unbalanced braces, half-written lines).
 * Several upstream providers hard-cap completion tokens and/or silently drop
 * the connection, ending the stream while the text is still structurally
 * incomplete. These heuristics let the gateway detect "this text is NOT
 * finished" and keep generating until the upstream itself signals a real end.
 *
 * Design constraints:
 *   - HIGH PRECISION for the generic layer: only structurally-impossible
 *     endings (unclosed code fence, unbalanced brackets inside code) trigger
 *     continuation. A false positive costs one wasted round (the model then
 *     replies DONE); a false negative costs a visibly truncated answer.
 *   - Zero dependencies, O(n) single pass, cheap enough for every stream.
 */

/** Longest overlap window used when trimming re-emitted prefixes. */
export const OVERLAP_WINDOW = 600;
/** Minimum length (chars) for a suffix/prefix to count as a real overlap. */
export const MIN_OVERLAP = 8;
/** How many chars of the tail to quote in the continuation instruction. */
export const CONTINUE_TAIL_CHARS = 160;

/** Count occurrences of a regex in a string (all matches). */
function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Detect an unclosed markdown code fence: an ODD number of ``` fence
 * openings means the model was cut inside a code block — the single
 * strongest "the answer is incomplete" signal there is.
 */
export function hasUnclosedFence(text: string): boolean {
  const fences = countMatches(text, /(^|\n)```/g);
  return fences % 2 === 1;
}

/**
 * Detect unbalanced structural brackets inside code content.
 * Braces/brackets/parens are counted across the WHOLE text but weighted:
 *   - If the text contains code fences, count only within fenced blocks.
 *   - Otherwise count across the whole text (many models emit raw code with
 *     no fences at all).
 * Strings/comments are not parsed — the goal is a cheap conservative signal:
 * a net surplus of OPENERS at end-of-text means "cut mid-code".
 */
export function hasUnbalancedBrackets(text: string): boolean {
  let openCurly = 0;
  let openSquare = 0;
  let openParen = 0;
  const fenceCount = countMatches(text, /(^|\n)```/g);
  if (fenceCount >= 2) {
    // Count brackets ONLY inside fenced code blocks (line-based state
    // machine — immune to fence-language suffixes and stray backticks).
    let inFence = false;
    for (const line of text.split("\n")) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (!inFence) continue;
      for (const ch of line) {
        switch (ch) {
          case "{": openCurly++; break;
          case "}": openCurly--; break;
          case "[": openSquare++; break;
          case "]": openSquare--; break;
          case "(": openParen++; break;
          case ")": openParen--; break;
        }
      }
    }
  } else {
    // No (complete) fences — count across the whole text.
    for (const ch of text) {
      switch (ch) {
        case "{": openCurly++; break;
        case "}": openCurly--; break;
        case "[": openSquare++; break;
        case "]": openSquare--; break;
        case "(": openParen++; break;
        case ")": openParen--; break;
      }
    }
  }
  // Net surplus of openers. Tolerance of 0: prose rarely opens a stray
  // `{`; if it does, one wasted continuation round is harmless (DONE
  // swallow ends the stream cleanly).
  return openCurly > 0 || openSquare > 0 || openParen > 0;
}

/**
 * Is this text structurally incomplete (i.e. the model was almost certainly
 * cut off before finishing)? Used by both the nsfwgf provider-level
 * continuation and the gateway-level generic auto-continue.
 */
export function looksIncomplete(text: string): boolean {
  const t = text.trimEnd();
  if (t.length < 40) return false; // too short to judge — don't waste a round
  if (hasUnclosedFence(t)) return true;
  if (hasUnbalancedBrackets(t)) return true;
  return false;
}

/**
 * Longest suffix of `acc` that is also a prefix of `cont` (≥ MIN_OVERLAP
 * chars, capped at OVERLAP_WINDOW). Models often re-emit the tail of the
 * cut-off text at the start of a continuation — that duplicated prefix must
 * be trimmed exactly once or the client sees doubled text.
 */
export function overlapTrimLen(acc: string, cont: string): number {
  const max = Math.min(acc.length, cont.length, OVERLAP_WINDOW);
  for (let k = max; k >= MIN_OVERLAP; k--) {
    if (acc.endsWith(cont.slice(0, k))) return k;
  }
  return 0;
}

/** Quote-safe tail snippet of `text` for the continuation instruction. */
export function tailSnippet(text: string): string {
  const t = text.trimEnd();
  return t.slice(-CONTINUE_TAIL_CHARS);
}

/**
 * Build the continuation instruction. Anchoring the model with a verbatim
 * quote of its own ending measurably reduces seam artifacts (re-emitting
 * from an earlier token — e.g. `const renderer = new` +
 * `renderer.setSize(` → the mangled `newrenderer.setSize(`).
 */
export function continueInstruction(accumulated: string): string {
  const tail = tailSnippet(accumulated);
  return (
    "Continue your previous response EXACTLY from where it stopped. " +
    `Your response ended with this text (do NOT repeat it): "…${tail}"\n` +
    "Begin your output with the VERY NEXT character after that ending — " +
    "mid-word or mid-line if that is where it stopped. Do not repeat any " +
    "text you already wrote, do not restart the code block, do not add " +
    "commentary. Output ONLY the continuation until the response is " +
    "genuinely finished. " +
    "The single word DONE must NEVER appear inside your reply — reply with " +
    "exactly one word DONE ONLY IF there is truly nothing at all left to " +
    "write (your previous response was already 100% complete)."
  );
}
