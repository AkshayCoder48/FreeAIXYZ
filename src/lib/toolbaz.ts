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

import { randomBytes } from "crypto";

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
  return arr[randomBytes(1)[0] % arr.length];
}

function randomString(length: number, alphabet: string): string {
  const bytes = randomBytes(length);
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
  const encoded = Buffer.from(JSON.stringify(fingerprint), "utf8").toString(
    "base64",
  );
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
 * Convert an array of pre-serialized turns into the single `text` string that
 * writing.php expects. The prompt is wrapped with the Hangul-filler delimiters
 * exactly like the Toolbaz web UI does.
 *
 * Callers are responsible for serializing each message to its `text` (this
 * keeps tool-call / tool-result rendering in the API route layer, where it
 * belongs).
 */
export function turnsToText(turns: PromptTurn[]): string {
  const filtered = turns.filter((t) => t.text != null && t.text !== "");
  if (filtered.length === 0) {
    return `${FILLER} : ${FILLER}`;
  }

  // Single user message -> exact same shape as the website.
  if (filtered.length === 1 && filtered[0].role === "user") {
    return `${FILLER} : ${filtered[0].text}${FILLER}`;
  }

  const parts: string[] = [];
  for (const t of filtered) {
    const label =
      t.role === "system"
        ? "System"
        : t.role === "assistant"
          ? "Assistant"
          : t.role === "tool" || t.role === "function"
            ? "Tool"
            : "User";
    parts.push(`${label}: ${t.text}`);
  }
  return `${FILLER} : ${parts.join("\n\n")}${FILLER}`;
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
 */
export async function complete({
  model,
  turns,
  signal,
}: CompletionOptions): Promise<CompletionResult> {
  const { captcha, sessionId, userAgent } = await requestCaptchaToken();

  const text = turnsToText(turns);
  const body = new URLSearchParams({
    text,
    capcha: captcha,
    model,
    session_id: sessionId,
  }).toString();

  const res = await fetch(WRITING_ENDPOINT, {
    method: "POST",
    headers: buildHeaders(userAgent),
    body,
    signal,
  });

  if (!res.ok) {
    throw new Error(
      `writing.php returned HTTP ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }

  const raw = await res.text();
  const cleaned = cleanResponse(raw);
  return { text: cleaned, model, sessionId };
}

/** Models exposed by the gateway. */
export const TOOLBAZ_MODELS = [
  {
    id: "toolbaz-v4.5-fast",
    upstream: "toolbaz-v4.5-fast",
    description: "Toolbaz v4.5 Fast — the only upstream model currently accepted",
  },
] as const;

/**
 * Resolve any incoming model name to a real upstream Toolbaz model.
 * Toolbaz only accepts `toolbaz-v4.5-fast` (other names return INVALID_MODEL),
 * so all OpenAI-style aliases collapse to it.
 */
export function resolveModel(requested: string | undefined): string {
  // The single valid upstream model.
  return TOOLBAZ_MODELS[0].upstream;
}
