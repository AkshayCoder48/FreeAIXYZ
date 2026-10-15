/**
 * Truncated-JSON repair — the "cut off mid-generation" recovery.
 *
 * PROBLEM (diagnosed live): long tool-call generations get cut by the
 * upstream mid-string, e.g.
 *
 *   [{"name":"ask_user","arguments":{"questions":[{"text":"What should the
 *   file be named?"},{"text":"Do you want me to
 *
 * A JSON.parse on this throws → the parser falls back to raw-text
 * passthrough → the client renders the half-finished JSON as assistant
 * text (Open WebUI: "returned full raw tool call not in tool call deltas").
 *
 * REPAIR: track bracket nesting + string state; at the cut, close the open
 * string, drop a dangling trailing comma, and close every open container in
 * reverse order. The result is valid JSON representing everything the model
 * managed to generate — a PARTIAL but structurally sound tool call the
 * client can actually execute.
 *
 * - Balanced/valid JSON is returned UNCHANGED (repair is a no-op when the
 *   stack is empty and no string is open).
 * - Pure heuristic — never throws; worst case the repaired string still
 *   fails JSON.parse and the caller keeps its text fallback.
 *
 * ─── STRING-STYLE SCANNER (the escaped/curly tool-call fix) ───────────────
 *
 * Real upstreams (observed live on the fleet) write tool calls with quotes
 * that are NOT plain ASCII `"`:
 *
 *   ESCAPED:   [{"name":"ask_user"...   (every quote preceded by a backslash)
 *   CURLY:     ["Q1?”,”Q2”?,“Q3"]       (U+201C/U+201D used as delimiters)
 *   MIXED:     ["Hard content?”,”More”?,“Tail\"]   (all three at once)
 *
 * The scanner therefore tracks HOW each string was opened:
 *
 *   style 1 (plain):   opened by a bare "    → \" is an ESCAPE, only a
 *                                        bare " closes (strict JSON rules —
 *                                        curly quotes stay content, so prose
 *                                        values like "she said “hi”" survive)
 *   style 2 (escaped): opened by \"      → \" CLOSES; any bare quote-ish
 *                                        char also closes (mixed-style
 *                                        tolerance: "q1?” closes curly)
 *   style 3 (curly):   opened by “ ” „  → ” " and \" close; “ „ stay
 *                                        content (nested curly prose)
 *
 * Outside a string, a backslash immediately followed by a quote-ish char
 * OPENS an escaped string (the `\` is treated as part of the delimiter, not
 * as a junk character). This keeps bracket counting correct for the
 * fully-escaped form, where otherwise nothing ever closes.
 */

/** Characters models use as JSON string delimiters (observed on the fleet). */
const QUOTEISH = new Set(['"', "“", "”", "„"]);

/** String styles for the balance scanner. 0 = not inside a string. */
type StrStyle = 0 | 1 | 2 | 3;

/**
 * Repair a (possibly truncated) JSON string by closing whatever is left
 * open. Safe to call on valid JSON (identity). String-style aware: an
 * escaped-open string is closed with `\"`, a curly-open one with `”`.
 */
export function repairTruncatedJson(s: string): string {
  if (!s) return s;

  let style: StrStyle = 0;
  let esc = false; // escaped-char flag INSIDE a plain string
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = i + 1 < s.length ? s[i + 1] : "";
    if (esc) {
      esc = false;
      continue;
    }
    if (style === 0) {
      if (c === "\\" && QUOTEISH.has(next)) {
        style = 2;
        i++;
        continue;
      }
      if (QUOTEISH.has(c)) {
        style = c === '"' ? 1 : 3;
        continue;
      }
      if (c === "[" || c === "{") stack.push(c);
      else if (c === "]" || c === "}") stack.pop();
      continue;
    }
    if (style === 1) {
      // Plain string: strict JSON escapes; ONLY a bare " closes.
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') style = 0;
      continue;
    }
    // Escaped-open or curly-open string.
    if (c === "\\" && QUOTEISH.has(next)) {
      style = 0;
      i++;
      continue;
    }
    if (style === 2 && QUOTEISH.has(c)) {
      style = 0; // any bare quote-ish closes an escaped-open string
      continue;
    }
    if (style === 3 && (c === '"' || c === "”")) {
      style = 0; // ” and " close a curly-open string; “ „ stay content
      continue;
    }
  }

  // Nothing left open → already balanced, return as-is.
  if (style === 0 && stack.length === 0) return s;

  let out = s;
  if (style === 1) out += '"';
  else if (style === 2) out += '\\"';
  else if (style === 3) out += "”";
  // A dangling trailing comma (e.g. cut right after `[{...},`) would make
  // the repaired JSON invalid — strip it.
  out = out.replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "[" ? "]" : "}";
  }
  return out;
}

/**
 * JSON-string-state scanner used by streaming normalizers to detect when a
 * bare JSON container becomes COMPLETE (nesting returns to zero).
 * String-style aware (see the module header) so escaped- and curly-quoted
 * tool-call bodies complete at the correct index mid-stream.
 */
export interface JsonBalanceState {
  depth: number;
  /** 0 = outside string; 1 = plain "-string; 2 = \"-escaped; 3 = curly. */
  strStyle: StrStyle;
  /** Escape flag inside a plain string (char after an odd backslash). */
  esc: boolean;
  /** Has at least one character been fed (guards the initial depth=0). */
  fed: number;
}

export function freshBalance(): JsonBalanceState {
  return { depth: 0, strStyle: 0, esc: false, fed: 0 };
}

/**
 * Feed one chunk into the balance scanner.
 * Returns the index (within `chunk`) where nesting FIRST returned to zero
 * after having been open — i.e. the container is complete at that index —
 * or -1 while still open / not yet started.
 */
export function feedBalance(st: JsonBalanceState, chunk: string): number {
  let completeAt = -1;
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    const next = i + 1 < chunk.length ? chunk[i + 1] : "";
    st.fed++;
    if (st.esc) {
      st.esc = false;
      continue;
    }
    if (st.strStyle === 0) {
      if (c === "\\" && QUOTEISH.has(next)) {
        st.strStyle = 2;
        i++;
        st.fed++;
        continue;
      }
      if (QUOTEISH.has(c)) {
        st.strStyle = c === '"' ? 1 : 3;
        continue;
      }
      if (c === "[" || c === "{") {
        st.depth++;
        continue;
      }
      if (c === "]" || c === "}") {
        st.depth--;
        // Nesting returned to zero after having been open → container
        // complete at this index (first time only).
        if (st.depth === 0 && completeAt === -1 && st.fed > 1) {
          completeAt = i;
        }
        continue;
      }
      continue;
    }
    if (st.strStyle === 1) {
      if (c === "\\") {
        st.esc = true;
        continue;
      }
      if (c === '"') st.strStyle = 0;
      continue;
    }
    // Escaped-open or curly-open string.
    if (c === "\\" && QUOTEISH.has(next)) {
      st.strStyle = 0;
      i++;
      st.fed++;
      continue;
    }
    if (st.strStyle === 2 && QUOTEISH.has(c)) {
      st.strStyle = 0;
      continue;
    }
    if (st.strStyle === 3 && (c === '"' || c === "”")) {
      st.strStyle = 0;
      continue;
    }
  }
  return completeAt;
}

// ───────────────────────────────────────────────────────────────────────────
// LENIENT JSON PARSER — last-resort salvage for malformed tool calls
// ───────────────────────────────────────────────────────────────────────────

/**
 * Tolerant JSON parser for model-generated tool calls that strict
 * JSON.parse rejects. Handles (all observed live on the fleet):
 *
 *   - curly/smart quotes as string delimiters (“ ” „)
 *   - backslash-escaped quotes as delimiters (\"name\")
 *   - missing closing brackets        ["q1","q2"} }  → auto-close
 *   - stray junk between elements     ["q1" ? , "q2"] → junk skipped
 *   - trailing commas, missing commas, missing colons
 *   - truncation at EOF               (open containers auto-close)
 *   - trailing prose after the root value (ignored)
 *
 * Values are produced directly (no textual repair pass), so mismatched
 * closers close every intermediate container that stands in the way —
 * e.g. a `}` arriving while a `[` is open closes the array AND the object.
 *
 * Returns the first parsed root value, or null when nothing parseable
 * exists. Callers MUST only use this after strict JSON.parse failed (it is
 * a heuristic salvage, not a validator).
 */

/** Sentinel: no value at this position (separator / EOF / unrecognizable). */
const NO_VALUE = Symbol("lenient-no-value");

/** Thrown when a closer arrives; carries the auto-closed container value. */
class CloseSignal {
  constructor(
    public ch: "]" | "}",
    /** The container that was auto-closed by this closer (if any). */
    public value: unknown,
  ) {}
}

class LenientParser {
  private i = 0;
  constructor(private s: string) {}

  /** Parse the first value in the input; null when nothing parseable. */
  parseRoot(): unknown | null {
    for (;;) {
      this.skipJunk();
      const c = this.peek();
      if (!c) return null;
      // Stray separators/closers at root level (leading junk) — skip.
      if (c === "," || c === ":" || c === "]" || c === "}") {
        this.i++;
        continue;
      }
      if (c === "[" || c === "{") {
        try {
          return this.parseContainer(c);
        } catch (e) {
          if (e instanceof CloseSignal) return e.value;
          throw e;
        }
      }
      try {
        const v = this.parseValue();
        if (v !== NO_VALUE) return v;
        // NO_VALUE with progress (consumed junk) → keep scanning.
        continue;
      } catch (e) {
        if (e instanceof CloseSignal) return e.value ?? null;
        throw e;
      }
    }
  }

  // ── character classes ─────────────────────────────────────────────────

  private peek(): string {
    return this.i < this.s.length ? this.s[this.i] : "";
  }

  private static isQuoteish(c: string): boolean {
    return QUOTEISH.has(c);
  }

  private static isStructural(c: string): boolean {
    return c === "[" || c === "{" || c === "]" || c === "}" || c === "," || c === ":";
  }

  private static isNumberStart(c: string): boolean {
    return (c >= "0" && c <= "9") || c === "-" || c === "+" || c === ".";
  }

  private static isLiteralStart(c: string): boolean {
    return c === "t" || c === "f" || c === "n";
  }

  /**
   * Skip junk: anything that is not a value-start or structural char.
   * Stops at quotes, `\` (may precede a quote), brackets, separators,
   * number starts, and literal starts.
   */
  private skipJunk(): void {
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (
        LenientParser.isQuoteish(c) ||
        LenientParser.isStructural(c) ||
        LenientParser.isNumberStart(c) ||
        LenientParser.isLiteralStart(c) ||
        c === "\\"
      ) {
        return;
      }
      this.i++;
    }
  }

  /** skipJunk + also skip commas (element/member separators). */
  private skipJunkAndCommas(): void {
    while (this.i < this.s.length) {
      this.skipJunk();
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      return;
    }
  }

  // ── scalars ───────────────────────────────────────────────────────────

  /**
   * Parse a string with the style rules from the module header.
   * Returns null when the cursor is not at a string start.
   */
  private tryString(): string | null {
    let style: 1 | 2 | 3;
    if (this.peek() === "\\") {
      const next = this.i + 1 < this.s.length ? this.s[this.i + 1] : "";
      if (!QUOTEISH.has(next)) return null;
      style = 2;
      this.i += 2; // consume \ + quote
    } else {
      const c = this.peek();
      if (!QUOTEISH.has(c)) return null;
      style = c === '"' ? 1 : 3;
      this.i += 1;
    }
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      const next = this.i + 1 < this.s.length ? this.s[this.i + 1] : "";
      if (style === 1) {
        if (c === "\\") {
          // JSON escape: \" \\ \/ \n … — keep the escaped char verbatim
          // except for the two JSON-unmarshalable raw forms.
          if (next === "n") {
            out += "\n";
            this.i += 2;
            continue;
          }
          if (next === "t") {
            out += "\t";
            this.i += 2;
            continue;
          }
          out += next;
          this.i += next ? 2 : 1;
          continue;
        }
        if (c === '"') {
          this.i++;
          return out;
        }
        out += c;
        this.i++;
        continue;
      }
      // style 2 (escaped-open) / 3 (curly-open)
      if (c === "\\" && QUOTEISH.has(next)) {
        this.i += 2;
        return out;
      }
      if (style === 2 && QUOTEISH.has(c)) {
        this.i++;
        return out;
      }
      if (style === 3 && (c === '"' || c === "”")) {
        this.i++;
        return out;
      }
      if (c === "\\" && next) {
        out += next; // \x inside tolerant strings → literal x
        this.i += 2;
        continue;
      }
      out += c;
      this.i++;
    }
    // EOF inside the string — auto-close (salvage the partial content).
    return out;
  }

  private tryNumber(): unknown {
    const m = /^[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/.exec(this.s.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return Number(m[0]);
  }

  private tryLiteral(): unknown {
    const rest = this.s.slice(this.i);
    if (rest.startsWith("true")) {
      this.i += 4;
      return true;
    }
    if (rest.startsWith("false")) {
      this.i += 5;
      return false;
    }
    if (rest.startsWith("null")) {
      this.i += 4;
      return null;
    }
    // t/f/n word that is not a literal → junk word; consume it so the
    // scanner makes progress.
    const m = /^[a-z]+/i.exec(rest);
    if (m) this.i += m[0].length;
    return NO_VALUE;
  }

  // ── values / containers ───────────────────────────────────────────────

  /**
   * Parse one value at the cursor. Returns NO_VALUE at separators/EOF.
   * A closer (`]`/`}`) is consumed and thrown as CloseSignal so enclosing
   * containers can auto-close (see the class header).
   */
  private parseValue(): unknown {
    this.skipJunk();
    const c = this.peek();
    if (!c) return NO_VALUE;
    if (c === "]") {
      this.i++;
      throw new CloseSignal("]", undefined);
    }
    if (c === "}") {
      this.i++;
      throw new CloseSignal("}", undefined);
    }
    if (c === "," || c === ":") return NO_VALUE;
    if (c === "[") return this.parseArray();
    if (c === "{") return this.parseObject();
    const str = this.tryString();
    if (str !== null) return str;
    if (LenientParser.isNumberStart(c)) {
      const num = this.tryNumber();
      if (num !== null) return num;
      this.i++; // stray -/+/. → junk
      return NO_VALUE;
    }
    if (LenientParser.isLiteralStart(c)) return this.tryLiteral();
    if (c === "\\") {
      // backslash not followed by a quote → junk
      this.i++;
      return NO_VALUE;
    }
    this.i++;
    return NO_VALUE;
  }

  private parseArray(): unknown[] {
    this.i++; // consume [
    const out: unknown[] = [];
    for (;;) {
      this.skipJunkAndCommas();
      const c = this.peek();
      if (!c) return out; // EOF → auto-close
      if (c === "]") {
        this.i++;
        return out;
      }
      if (c === "}") {
        this.i++;
        // `}` while an array is open: the array auto-closes and the
        // closer propagates to the object that matches it.
        throw new CloseSignal("}", out);
      }
      if (c === ",") {
        this.i++; // stray separator
        continue;
      }
      const before = this.i;
      try {
        const v = this.parseValue();
        if (v !== NO_VALUE) out.push(v);
        else if (this.i === before) this.i++; // guarantee progress
      } catch (e) {
        if (e instanceof CloseSignal) {
          if (e.value !== undefined) out.push(e.value);
          if (e.ch === "]") return out; // our closer — done
          throw new CloseSignal(e.ch, out); // propagate, auto-closed
        }
        throw e;
      }
    }
  }

  private parseObject(): Record<string, unknown> {
    this.i++; // consume {
    const obj: Record<string, unknown> = {};
    for (;;) {
      this.skipJunkAndCommas();
      const c = this.peek();
      if (!c) return obj; // EOF → auto-close
      if (c === "}") {
        this.i++;
        return obj;
      }
      if (c === "]") {
        this.i++;
        throw new CloseSignal("]", obj);
      }
      // Key (string expected; non-string keys are unsupported → skip the
      // member entirely by parsing the value and discarding it).
      const key = this.tryString();
      if (key === null) {
        // Non-string key: parse (and discard) the value. Guarantee progress
        // so a stray `:` or unrecognizable char can never spin the loop.
        const before = this.i;
        const v = this.parseValue();
        if (v === NO_VALUE && this.i === before) this.i++;
        continue;
      }
      // Colon (tolerate its absence).
      this.skipJunk();
      if (this.peek() === ":") this.i++;
      // Value.
      const beforeVal = this.i;
      try {
        const v = this.parseValue();
        if (v !== NO_VALUE) obj[key] = v;
        else if (this.i === beforeVal) this.i++; // guarantee progress
      } catch (e) {
        if (e instanceof CloseSignal) {
          if (e.value !== undefined) obj[key] = e.value;
          if (e.ch === "}") return obj;
          throw new CloseSignal(e.ch, obj);
        }
        throw e;
      }
    }
  }

  private parseContainer(open: string): unknown {
    return open === "[" ? this.parseArray() : this.parseObject();
  }
}

/** See the LenientParser class header for the tolerated malformations. */
export function lenientJsonParse(s: string): unknown | null {
  if (!s) return null;
  try {
    return new LenientParser(s).parseRoot();
  } catch {
    return null;
  }
}
