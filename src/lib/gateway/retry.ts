/**
 * Transient-upstream retry heuristics (FIX A).
 *
 * The live diagnosis observed intermittent HTTP 502s whose body was the
 * upstream's own error text ("The edge runtime does not support Node.js
 * 'crypto' module" — an upstream provider itself running on a Vercel Edge
 * function). Those failures are TRANSIENT: the same request succeeds on the
 * next attempt. Letting one of them kill the client's whole turn is wrong.
 *
 * This module centralizes:
 *   - `isTransientUpstreamError(err)` — classify a failure as retryable
 *     (network-ish errors, 5xx, 429, and the edge/crypto crash text).
 *   - `retryDelayMs(attempt)` — small linear backoff (400ms, 800ms…).
 *
 * Used by:
 *   - streaming-proxy pre-flight (retry the SAME candidate once before
 *     failing over to another provider),
 *   - the non-streaming canonical path in /api/v1/chat/completions,
 *   - the internal proxy hops (freegpt-proxy / freeaixyz-proxy fetch).
 *
 * NEVER retried: 4xx client errors (the request itself is wrong — retrying
 * wastes the client's time) and aborted signals.
 */

/** Error text fragments that mark a failure as transient / retryable. */
const TRANSIENT_PATTERNS: RegExp[] = [
  /edge runtime/i,
  /node\.js ['"]?crypto['"]? module/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bEAI_AGAIN\b/i,
  /\bEPIPE\b/i,
  /fetch failed/i,
  /network error/i,
  /socket hang ?up/i,
  /connection (reset|refused|closed|timed ?out)/i,
  /terminated/i,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,
  /\bHTTP 50[234]\b/i,
  /\bHTTP 429\b/i,
  /\bupstream (50[234]|error)\b/i,
  /internal server error/i,
  /timeout/i,
  /overloaded/i,
  /temporarily unavailable/i,
  /circuit open/i,
];

/** Is this thrown value a transient, retry-worthy upstream failure? */
export function isTransientUpstreamError(err: unknown): boolean {
  // Never retry when the CLIENT went away.
  if (err instanceof Error && err.name === "AbortError") return false;
  if (
    err !== null &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  ) {
    return false;
  }

  const status =
    err !== null && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  // 5xx and 429 are retryable by definition; 4xx never is.
  if (Number.isFinite(status) && status > 0) {
    if (status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err !== null && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message)
          : String(err ?? "");

  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** Linear backoff: 400ms × attempt (attempt is 0-based). Capped at 1.5s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(400 * (attempt + 1), 1500);
}

/** Best-effort sleep that stays honest about client aborts. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call `fn` up to `attempts` times, retrying only on transient failures
 * (isTransientUpstreamError). Re-throws the LAST error when all attempts
 * fail or the error is non-transient.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1) break;
      if (!isTransientUpstreamError(err)) break;
      await sleep(retryDelayMs(attempt));
    }
  }
  throw lastErr;
}
