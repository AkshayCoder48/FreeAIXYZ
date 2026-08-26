/**
 * Sensitive-data redactor (PRD §126).
 *
 * Redacts Authorization, Cookie, API-Key, Bearer, tokens, secrets from logs
 * and diagnostic output. Used by the streaming instrumentation, debug
 * endpoints, and error normalizer so no credential ever leaks to the client
 * or to the dev log.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "apikey",
  "x-api-key",
  "x-auth",
  "x-secure-signature",
  "x-secure-nonce",
  "x-secure-fingerprint",
  "x-secure-challenge",
  "x-secure-challenge-id",
  "x-secure-timestamp",
  "x-secure-client-ip",
  "x-secure-challenge-expires-at",
  "x-secure-challenge-version",
  "x-secure-version",
  "x-session-id",
  "x-finger",
  "userid",
  "uuid",
  "cf-turnstile-token",
]);

const SENSITIVE_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, "$1<redacted>"],
  [/(token=)[^&\s]+/gi, "$1<redacted>"],
  [/(api[_-]?key=)[^&\s]+/gi, "$1<redacted>"],
  [/(sk-[A-Za-z0-9]{20,})/g, "<redacted-key>"],
  [/[A-F0-9]{64,}/gi, "<redacted-hex>"],
];

/** Redact a single header value if the header name is sensitive. */
export function redactHeader(name: string, value: string): string {
  if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) return "<redacted>";
  let v = value;
  for (const [re, rep] of SENSITIVE_VALUE_PATTERNS) v = v.replace(re, rep);
  return v;
}

/** Redact a full headers object, returning a safe copy (PRD §209). */
export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = redactHeader(k, v);
  }
  return out;
}

/** Filter out unsafe client-controlled headers before forwarding upstream (PRD §209). */
const UNSAFE_FORWARD_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "content-encoding",
  "x-forwarded-for",
  "x-real-ip",
  "x-forwarded-proto",
  "x-forwarded-host",
]);

/** Produce a safe outbound header map: drop unsafe, redact sensitive values. */
export function sanitizeOutboundHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (UNSAFE_FORWARD_HEADERS.has(k.toLowerCase())) continue;
    out[k] = redactHeader(k, v);
  }
  return out;
}

/** Only forward safe response headers upstream → client (PRD §210). */
const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "cache-control",
  "x-accel-buffering",
  "x-no-buffer",
]);

export function safeResponseHeaders(
  upstream: Headers,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = { ...overrides };
  upstream.forEach((value, key) => {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) {
      out[key] = value;
    }
  });
  return out;
}

/** Redact arbitrary text (e.g. an upstream body preview) for logging. */
export function redactText(input: string): string {
  let v = input;
  for (const [re, rep] of SENSITIVE_VALUE_PATTERNS) v = v.replace(re, rep);
  return v;
}

/** Truncate a body preview for safe diagnostic display (PRD §40). */
export function bodyPreview(body: string, max = 240): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return redactText(trimmed);
  return redactText(trimmed.slice(0, max)) + "…";
}
