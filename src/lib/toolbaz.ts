/**
 * Toolbaz API client.
 *
 * Toolbaz exposes two endpoints we rely on:
 *   1. POST https://data.toolbaz.com/token.php   -> issues a one-time captcha token
 *   2. POST https://data.toolbaz.com/writing.php -> runs the actual LLM completion
 *
 * Every single request to Toolbaz is issued with a FRESH session id and a FRESH
 * browser-fingerprint token, so credentials are rotated per request (no shared
 * state, no token reuse). This is what powers the "automatic rotation" behavior.
 */

// Use Web Crypto API instead of Node.js crypto for Edge runtime compatibility

const TOKEN_ENDPOINT = "https://data.toolbaz.com/token.php";
const WRITING_ENDPOINT = "https://data.toolbaz.com/writing.php";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// The Hangul Filler (U+3164) is the delimiter Toolbaz's own UI uses to wrap the
// prompt text. Reusing it keeps our payload indistinguishable from the website.
const FILLER = "\u3164";

/**
 * Pool of realistic, recent desktop user-agents. We pick one at random per
 * request so the fingerprint population looks organic instead of identical.
 */
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
];

const LANGUAGES = ["en-US", "en-GB", "en-CA", "en-AU"];
const RESOLUTIONS = [
  "1920x1080",
  "2560x1440",
  "1366x768",
  "1440x900",
  "1536x864",
  "412x915",
];
const TIMEZONES = [
  "Asia/Calcutta",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];
const PLATFORMS: Record<string, string> = {
  "Mozilla/5.0 (Windows": "Win32",
  "Mozilla/5.0 (Macintosh": "MacIntel",
  "Mozilla/5.0 (X11": "Linux x86_64",
  "Mozilla/5.0 (Linux; Android": "Linux armv8l",
};
const COLOR_DEPTHS = [24, 30];
const CORES = [4, 8, 8, 12, 16];

function pick<T>(arr: T[]): T {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return arr[bytes[0] % arr.length];
}

function randomString(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** 36-char alphanumeric id, matching the shape Toolbaz uses for session ids. */
function generateSessionId(): string {
  return randomString(36, ALPHABET);
}

/**
 * Build the browser-fingerprint token that token.php expects.
 *
 * The wire format is: `<6 random base64 chars><base64(JSON fingerprint)>`.
 * The JSON is an obfuscated-key object describing a browser fingerprint
 * (user-agent, language, screen, timezone, platform, color depth, cores,
 * an empty plugins/extensions pair, a unix timestamp, a "0" flag, and a
 * random 36-char token). We synthesize a fresh, internally-consistent
 * fingerprint for every call.
 */
function generateFingerprintToken(): string {
  const userAgent = pick(USER_AGENTS);
  let platform = "Win32";
  for (const key of Object.keys(PLATFORMS)) {
    if (userAgent.startsWith(key)) {
      platform = PLATFORMS[key];
      break;
    }
  }

  const fingerprint = {
    bR6wF: {
      nV5kP: userAgent,
      lQ9jX: pick(LANGUAGES),
      sD2zR: pick(RESOLUTIONS),
      tY4hL: pick(TIMEZONES),
      pL8mC: platform,
      tcQjt: pick(COLOR_DEPTHS),
      hK7jN: pick(CORES),
    },
    uT4bX: { mM9wZ: [], kP8jY: [] },
    tuTcS: Math.floor(Date.now() / 1000),
    tDfxy: "0",
    RtyJt: randomString(36, ALPHABET),
  };

  const prefix = randomString(6, BASE64_ALPHABET);
  // Use btoa instead of Buffer for Edge runtime compatibility
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(fingerprint))));
  return prefix + encoded;
}

interface ToolbazConfig {
  userAgent: string;
}

function buildHeaders(userAgent: string): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Accept: "*/*",
    "User-Agent": userAgent,
    Origin: "https://toolbaz.com",
    Referer: "https://toolbaz.com/",
  };
}

/** Response from token.php */
interface CaptchaResponse {
  success: boolean;
  token?: string;
  message?: string;
}

/**
 * Step 1: ask token.php for a one-time captcha token.
 * A brand new session id + fingerprint are generated for THIS call only.
 */
async function requestCaptchaToken(): Promise<{
  captcha: string;
  sessionId: string;
  userAgent: string;
}> {
  const sessionId = generateSessionId();
  const userAgent = pick(USER_AGENTS);
  const fingerprintToken = generateFingerprintToken();

  const body = new URLSearchParams({
    session_id: sessionId,
    token: fingerprintToken,
  }).toString();

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(userAgent),
    body,
  });

  if (!res.ok) {
    throw new Error(
      `token.php returned HTTP ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }

  const data = (await res.json()) as CaptchaResponse;
  if (!data.success || !data.token) {
    throw new Error(
      `token.php failed: ${data.message ?? JSON.stringify(data)}`,
    );
  }

  return { captcha: data.token, sessionId, userAgent };
}

/** Strip the trailing "[model: ...]" marker Toolbaz appends to its output. */
function cleanResponse(text: string): string {
  return text.replace(/\s*\[model:\s*[^\]]*\]\s*$/i, "").trim();
}

/** A pre-serialized conversation turn (role label + text already rendered). */
export interface PromptTurn {
  role: string;
  text: string;
}

/**
 * Hard upstream prompt budget (chars of the SERIALIZED `text` field,
 * FILLER envelope included). Live-probed on writing.php (L3-70B-Euryale):
 * 9 000 chars passes, 9 500 fails with
 * "You have reached the maximum prompt length limit" — so 9 000 is the
 * safe ceiling. Requests over the budget are COMPACTED (see
 * compactTurnsForBudget) instead of surfacing the upstream 400 to clients
 * (a client-side "self-healing" downgrade of a 24KB agent system prompt to
 * "You are helpful. Be concise." was lobotomizing models — the root cause
 * of the agency-speak / misplaced-rounds regression).
 */
export const TOOLBAZ_MAX_PROMPT_CHARS = 9000;

/**
 * Convert an array of pre-serialized turns into the single `text` string that
 * writing.php expects. The prompt is wrapped with the Hangul-filler delimiters
 * exactly like the Toolbaz web UI does.
 *
 * Callers are responsible for serializing each message to its `text` (this
 * keeps tool-call / tool-result rendering in the API route layer, where it
 * belongs).
 *
 * ─── v2: NARRATIVE SERIALIZATION (no labeled transcript) ───────────────────
 * v1 rendered multi-turn history as a labeled transcript
 * ("System: … / User: … / Assistant: … / Tool: …"). Live regression
 * (2026-09 user report): those labels TAUGHT the models to write transcripts
 * in their REPLIES — replies began with a literal "Assistant:" label, then
 * fabricated the user's side too ("User: …"), misplacing conversation
 * rounds, regurgitating tool machinery verbatim and degenerating into
 * scripted support-agent dialogue. v2 renders the same turns as NARRATIVE:
 * roleplay/writing models echo narration far less than they echo dialogue
 * labels, and no "User:"/"Assistant:" token ever appears in the prompt.
 *
 *   system    → instruction blocks, unlabeled, in order (joined by blank
 *               lines — writing.php treats leading text as the brief)
 *   user      → "The user said: …" (all but the latest)
 *               "The user now says: …" (the latest user turn)
 *   assistant → "You replied: …"
 *   tool/func → "A tool reported: …" (pre-serialized upstream in the route
 *               layer already frames tool results as natural sentences)
 * The serialized prompt ends with "Respond now." so the completion starts
 * as the assistant's answer, not as another transcript line.
 */
export function turnsToText(
  turns: PromptTurn[],
  budget: number = TOOLBAZ_MAX_PROMPT_CHARS,
): string {
  const filtered = turns.filter((t) => t.text != null && t.text !== "");
  if (filtered.length === 0) {
    return `${FILLER} : ${FILLER}`;
  }

  // Single user message -> exact same shape as the website.
  if (filtered.length === 1 && filtered[0].role === "user") {
    return `${FILLER} : ${truncateToBudget(filtered[0].text, budget)}${FILLER}`;
  }

  let body = renderNarrative(filtered);
  if (serializedLength(body) > budget) {
    body = renderNarrative(compactTurnsForBudget(filtered, budget));
  }
  return `${FILLER} : ${body}${FILLER}`;
}

/** Length that counts against the budget (FILLER envelope adds 5 chars). */
function serializedLength(body: string): number {
  return body.length + 5; // "\u3164 : " + "\u3164"
}

/** Narrative rendering of the turns (no role labels anywhere). */
function renderNarrative(turns: PromptTurn[]): string {
  // Index of the LAST user turn — everything before it is history; it is
  // the current message.
  let lastUserIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (!t) continue;
    if (t.role === "system") {
      parts.push(t.text);
    } else if (t.role === "assistant") {
      parts.push(`You replied: ${t.text}`);
    } else if (t.role === "tool" || t.role === "function") {
      parts.push(`A tool reported: ${t.text}`);
    } else if (i === lastUserIdx) {
      parts.push(`The user now says: ${t.text}`);
    } else {
      parts.push(`The user said: ${t.text}`);
    }
  }
  return `${parts.join("\n\n")}\n\nRespond now.`;
}

/**
 * Budget compaction — called when the serialized narrative exceeds the
 * upstream limit. Priorities (in this order):
 *   1. Keep EVERY system turn's HEAD (identity + core instructions live in
 *      the first ~2.5KB of agent prompts; the tail is reference material).
 *   2. Keep the LAST 3 turns verbatim (the current exchange — the model
 *      must see the message it is answering and the turns that framed it).
 *   3. Summarize every other turn to one line ("The user said: (earlier
 *      message omitted for length)" style) — presence preserves the
 *      conversation's shape and round ordering without its bulk.
 *   4. As a last resort, truncate system heads further (2.5k → 1.2k → 600).
 */
function compactTurnsForBudget(turns: PromptTurn[], budget: number): PromptTurn[] {
  // Ladder starts at 5000 (not 2500): with a ~1K tool directive and ~2K of
  // last-3-turns, a 5000-char system head still fits the 9000 budget —
  // doubling the instructions that survive compaction vs the first cut.
  const SYS_HEAD = [5000, 2500, 1200, 600];
  // Cap for each verbatim kept turn: a single huge turn (e.g. a create_file
  // tool result carrying a whole HTML file) must not eat the entire budget
  // and collapse the system head two rungs down.
  const TURN_CAP = 2500;
  for (const sysHead of SYS_HEAD) {
    const lastIdx = turns.length - 1;
    const keepVerbatimFrom = Math.max(0, lastIdx - 2); // last 3 turns
    const compacted: PromptTurn[] = turns.map((t, i) => {
      if (t.role === "system") {
        return { role: t.role, text: t.text.slice(0, sysHead) };
      }
      if (i >= keepVerbatimFrom) {
        return t.text.length > TURN_CAP
          ? { role: t.role, text: `${t.text.slice(0, TURN_CAP)}\n…(truncated for length)` }
          : t;
      }
      const ellipsis =
        t.role === "assistant"
          ? "(earlier reply omitted for length)"
          : t.role === "tool" || t.role === "function"
            ? "(earlier tool report omitted for length)"
            : "(earlier message omitted for length)";
      return { role: t.role, text: ellipsis };
    });
    if (serializedLength(renderNarrative(compacted)) <= budget) {
      return compacted;
    }
  }
  // Still over: hard-truncate the whole body (keeps the head — identity
  // first, dialogue tail last would be useless without the instructions).
  return turns;
}

/** Truncate a single text to the budget (single-message fast path). */
function truncateToBudget(text: string, budget: number): string {
  return text.length + 5 > budget ? text.slice(0, Math.max(0, budget - 5)) : text;
}

export interface CompletionOptions {
  model: string;
  /** Pre-serialized conversation turns. */
  turns: PromptTurn[];
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  model: string;
  sessionId: string;
}

/**
 * Run a full completion against Toolbaz with a freshly rotated identity.
 *
 * Flow (all per-request, never reused):
 *   1. generate session id + fingerprint
 *   2. POST token.php  -> captcha token
 *   3. POST writing.php -> completion text
 *
 * No context compression or chunking — if the prompt is too long,
 * Toolbaz will return an error and the caller can handle it.
 *
 * Task 3 fix (v4): Toolbaz intermittently returns HTTP 200 + empty body OR
 * HTTP 5xx from Vercel's shared cloud egress IP (~10–20% observed in
 * production load tests). Direct-wire diagnosis from a sandbox IP produced
 * 10/10 success with the exact same protocol — the failures are a
 * per-IP-reputation blip on data.toolbaz.com's nginx that does NOT persist
 * across a fresh session id + fingerprint. So we retry ONCE with a fresh
 * identity on transient (empty-200 / 5xx / network-timeout) failures.
 *
 * This is NOT a fallback to another provider — it's a same-provider retry
 * with a freshly rotated identity, which is exactly what the adapter already
 * does per request. The retry is capped at 1 to avoid amplifying load.
 *
 * A 300s hard timeout is enforced on the writing.php fetch. Direct-wire
 * data showed ~4s typical, but a synchronous FULL generation (long code
 * outputs) can take much longer — the old 30s cap cut those mid-response
 * (the "AI stops whenever it wants" symptom). 300s lets even slow full
 * generations finish; on Vercel the route's maxDuration clamps first.
 */
export async function complete({
  model,
  turns,
  signal,
}: CompletionOptions): Promise<CompletionResult> {
  // Prompt-length backstop (G3b): turnsToText already compacts to
  // TOOLBAZ_MAX_PROMPT_CHARS, but if the upstream STILL rejects the size
  // (limit drift, or a model-specific tighter cap), halve the budget and
  // rebuild instead of surfacing the 400 to the client (which triggers
  // destructive client-side system-prompt downgrades).
  let budget = TOOLBAZ_MAX_PROMPT_CHARS;
  let text = turnsToText(turns, budget);
  let promptLengthRetries = 0;
  let identityRetries = 0; // fresh-identity retries stay capped at 1 (load)
  const MAX_ATTEMPTS = 6; // 1 + 1 identity retry + up to 2 prompt-length rebuilds + slack
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Caller-initiated abort should never trigger a retry — propagate immediately.
    if (signal?.aborted) throw new Error("Aborted by caller.");

    try {
      // Fresh session id + fingerprint PER attempt (requestCaptchaToken
      // generates them internally on every call — no shared state).
      const { captcha, sessionId, userAgent } = await requestCaptchaToken();

      const body = new URLSearchParams({
        text,
        capcha: captcha,
        model,
        session_id: sessionId,
      }).toString();

      // 300s hard timeout — combines the caller's signal with a timeout
      // abort so either one fires the abort.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300_000);
      const onCallerAbort = () => controller.abort();
      if (signal) signal.addEventListener("abort", onCallerAbort, { once: true });

      let res: Response;
      try {
        res = await fetch(WRITING_ENDPOINT, {
          method: "POST",
          headers: buildHeaders(userAgent),
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", onCallerAbort);
      }

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        // Prompt-length rejection → halve the budget, rebuild the text and
        // retry (budget floor 1200 — below that the prompt is unusable).
        if (/maximum prompt length|prompt (is )?too long|prompt length limit/i.test(raw) && budget > 1200 && promptLengthRetries < 2) {
          promptLengthRetries += 1;
          budget = Math.max(1200, Math.floor(budget / 2));
          text = turnsToText(turns, budget);
          continue;
        }
        // Transient 5xx → retry ONCE with a fresh identity.
        if (res.status >= 500 && identityRetries < 1) {
          identityRetries += 1;
          lastError = new ToolbazError(model, res.status, raw);
          continue;
        }
        throw new ToolbazError(model, res.status, raw);
      }

      const raw = await res.text();

      // Transient empty output (200 + empty body OR "Output is empty!")
      // → retry with a fresh identity. This is the dominant intermittent
      // failure mode from Vercel egress — direct-wire data confirms a
      // fresh session id succeeds on the 2nd attempt.
      const isEmpty = raw.trim() === "" || /^Output is empty!/i.test(raw);
      if (isEmpty) {
        if (identityRetries < 1) {
          identityRetries += 1;
          lastError = new ToolbazError(model, 200, raw || "Output is empty!");
          continue;
        }
        throw new ToolbazError(model, 200, raw || "Output is empty!");
      }

      const cleaned = cleanResponse(raw);
      return { text: cleaned, model, sessionId };
    } catch (err) {
      // Caller-initiated abort → propagate immediately, no retry.
      if (signal?.aborted) throw err;

      // ToolbazError: retry only if transient (5xx or empty-output).
      if (err instanceof ToolbazError) {
        const isTransient =
          err.upstreamStatus >= 500 || /empty/i.test(err.message);
        if (!isTransient || identityRetries >= 1) throw err;
        identityRetries += 1;
        lastError = err;
        continue;
      }

      // Network/timeout errors (AbortError, TypeError fetch failed, etc.)
      // → retry once with a fresh identity.
      if (identityRetries < 1) {
        identityRetries += 1;
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("Toolbaz: retry attempts exhausted.");
}

/**
 * Typed error for upstream Toolbaz failures. Produces a clear, actionable
 * message and exposes the raw upstream body so the client can inspect it.
 *
 * Common upstream failures we translate:
 *   - `INVALID_MODEL`            → the model id isn't recognized by Toolbaz
 *   - `Output is empty!`         → model returned nothing (often a quota blip
 *                                  or a model that refused the prompt)
 *   - `quota limit`              → per-minute rate limit on that model
 *   - `Suspicious Activity`      → captcha/fingerprint rejected
 */
export class ToolbazError extends Error {
  readonly upstreamStatus: number;
  readonly upstreamBody: string;
  readonly model: string;

  constructor(model: string, status: number, body: string) {
    const detail = body.trim().slice(0, 300);
    let message: string;
    if (/INVALID_MODEL/i.test(detail)) {
      message = `Model "${model}" is not recognized by the upstream. See GET /api/v1/models for supported ids.`;
    } else if (/empty/i.test(detail)) {
      message = `Upstream returned an empty response for model "${model}". This is often a transient quota issue — retry, or try a different model.`;
    } else if (/quota/i.test(detail)) {
      message = `Per-minute quota for model "${model}" exceeded. Retry shortly or use a different model.`;
    } else if (/suspicious/i.test(detail)) {
      message = `Upstream rejected the request as suspicious. Retry.`;
    } else {
      message = `Upstream error for model "${model}" (HTTP ${status}): ${detail}`;
    }
    super(message);
    this.name = "ToolbazError";
    this.model = model;
    this.upstreamStatus = status;
    this.upstreamBody = detail;
  }
}

/**
 * Models Toolbaz supports, as advertised on the toolbaz.com writer UI.
 * Each is passed through verbatim to `writing.php`'s `model` field.
 * `unfiltered_x` is intentionally omitted from the public list (it bypasses
 * safety filters), but is still accepted if a caller requests it explicitly.
 */
export interface ToolbazModel {
  id: string;
  description: string;
}

export const TOOLBAZ_MODELS: readonly ToolbazModel[] = [
  { id: "toolbaz-v4.5-fast", description: "Toolbaz v4.5 Fast — quick & balanced" },
  { id: "toolbaz_v4", description: "ToolBaz v4 — general purpose" },
  { id: "gpt-5", description: "GPT-5" },
  { id: "gpt-5.2", description: "GPT-5.2" },
  { id: "gpt-4o-latest", description: "GPT-4o (latest)" },
  { id: "gpt-oss-120b", description: "GPT-OSS-120B — open-weight" },
  { id: "gpt-oss-20b", description: "GPT-OSS 20B — lightweight open-weight" },
  { id: "o3-mini", description: "o3-mini — reasoning" },
  { id: "claude-sonnet-4", description: "Claude Sonnet 4" },
  { id: "gemini-2.5-flash", description: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", description: "Gemini 2.5 Pro" },
  { id: "gemini-3-flash", description: "Gemini 3 Flash" },
  { id: "gemini-3.1-flash-lite", description: "Gemini 3.1 Flash Lite" },
  { id: "gemini-3.5-flash", description: "Gemini 3.5 Flash — fast and capable" },
  { id: "gemini-3.6-flash", description: "Gemini 3.6 Flash — latest, excellent for coding" },
  { id: "codestral-latest", description: "Codestral — Mistral's code generation model" },
  { id: "deepseek-r1", description: "DeepSeek R1 — reasoning" },
  { id: "deepseek-v3", description: "DeepSeek V3" },
  { id: "deepseek-v3.1", description: "DeepSeek V3.1" },
  { id: "grok-4-fast", description: "Grok 4 Fast" },
  { id: "llama-4-maverick", description: "Llama 4 Maverick" },
  { id: "L3-70B-Euryale-v2.1", description: "L3-70B Euryale v2.1" },
  { id: "midnight-rose", description: "Midnight Rose" },
] as const;

/** The default model used when a request omits `model`. */
export const DEFAULT_MODEL = "toolbaz-v4.5-fast";

/**
 * Resolve the incoming `model` to the upstream model id sent to Toolbaz.
 *
 * The requested model id is passed through VERBATIM — Toolbaz accepts a wide
 * range of ids (gpt-5, claude-sonnet-4, gemini-2.5-pro, deepseek-r1, …) and we
 * don't second-guess the caller. If no model is given we default to
 * `toolbaz-v4.5-fast`. Unknown ids are still forwarded so newly-added Toolbaz
 * models work without a code change; if Toolbaz rejects it the error surfaces
 * to the client.
 */
export function resolveModel(requested: string | undefined): string {
  if (!requested || typeof requested !== "string" || requested.trim() === "") {
    return DEFAULT_MODEL;
  }
  return requested.trim();
}

/** The display name echoed back in API responses (what the client asked for). */
export function displayModel(requested: string | undefined): string {
  return resolveModel(requested);
}
