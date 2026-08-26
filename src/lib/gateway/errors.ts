/**
 * API error taxonomy + normalization (PRD §62, §146, §147, §148, §149, audit A3-A6).
 *
 * Every gateway error is normalized into a structured envelope:
 *
 *   { error: { type, message, provider, model, request_id, code, status } }
 *
 * Upstream status codes are passed through where safe (audit A3-A6: 400→400,
 * 429→429+Retry-After, 403→403, 503/504→503). 403 from a provider is
 * classified as UPSTREAM_4XX (NOT retried — PRD §63, §148).
 */

export type GatewayErrorType =
  | "MODEL_NOT_FOUND"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "UPSTREAM_4XX"
  | "UPSTREAM_5XX"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "STREAM_ERROR"
  | "STREAM_ABORTED"
  | "INVALID_REQUEST"
  | "DISCOVERY_FAILED"
  | "VERIFICATION_FAILED"
  | "RATE_LIMITED"
  | "AUTHENTICATION_REQUIRED";

export interface GatewayErrorBody {
  type: GatewayErrorType;
  message: string;
  provider?: string;
  model?: string;
  request_id: string;
  code?: string;
  /** HTTP status to send to the client (PRD §147). */
  status: number;
  /** Raw upstream status if this came from an upstream response. */
  upstreamStatus?: number;
}

export class GatewayError extends Error {
  readonly type: GatewayErrorType;
  readonly status: number;
  readonly upstreamStatus?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly requestId: string;
  readonly code?: string;
  /** Retry-After seconds (set for RATE_LIMITED errors — A4). */
  readonly retryAfter?: number;

  constructor(opts: {
    type: GatewayErrorType;
    message: string;
    status?: number;
    upstreamStatus?: number;
    provider?: string;
    model?: string;
    requestId?: string;
    code?: string;
    retryAfter?: number;
  }) {
    super(opts.message);
    this.name = "GatewayError";
    this.type = opts.type;
    this.status = opts.status ?? defaultStatusFor(opts.type);
    this.upstreamStatus = opts.upstreamStatus;
    this.provider = opts.provider;
    this.model = opts.model;
    this.requestId = opts.requestId ?? generateRequestId();
    this.code = opts.code ?? opts.type.toLowerCase();
    this.retryAfter = opts.retryAfter;
  }

  toJSON(): GatewayErrorBody {
    return {
      type: this.type,
      message: this.message,
      provider: this.provider,
      model: this.model,
      request_id: this.requestId,
      code: this.code,
      status: this.status,
      upstreamStatus: this.upstreamStatus,
    };
  }
}

/** Default HTTP status per error type (PRD §147). */
export function defaultStatusFor(type: GatewayErrorType): number {
  switch (type) {
    case "MODEL_NOT_FOUND":
    case "PROVIDER_NOT_FOUND":
      return 404;
    case "INVALID_REQUEST":
      return 400;
    case "AUTHENTICATION_REQUIRED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "UPSTREAM_TIMEOUT":
      return 504;
    case "UPSTREAM_UNAVAILABLE":
    case "PROVIDER_UNAVAILABLE":
      return 503;
    case "UPSTREAM_4XX":
      // Default for unknown-shape 4xx — when the upstream status is known it
      // is passed through explicitly in classifyUpstreamStatus (A3, A5).
      return 400;
    case "UPSTREAM_5XX":
    case "STREAM_ERROR":
    case "STREAM_ABORTED":
    case "DISCOVERY_FAILED":
    case "VERIFICATION_FAILED":
      return 502;
    default:
      return 500;
  }
}

/**
 * Classify an upstream HTTP status into a gateway error type (PRD §148, audit A3-A6).
 *
 * Pass-through mapping (preserve the upstream's HTTP status on the client
 * response rather than inflating everything to 502):
 *   - 400-499 → UPSTREAM_4XX with the upstream's status (e.g. 400 → 400,
 *     403 → 403, 422 → 422). 401 → AUTHENTICATION_REQUIRED (401).
 *     429 → RATE_LIMITED (429) with a Retry-After hint.
 *   - 503 / 504 → UPSTREAM_UNAVAILABLE (503). The gateway returns 503
 *     instead of 502 to make the "transient, retry later" semantic honest.
 *   - 408 → UPSTREAM_TIMEOUT (504) — preserved.
 *   - other 5xx → UPSTREAM_5XX with the upstream's status (500, 502, …).
 */
export function classifyUpstreamStatus(
  status: number,
  ctx: {
    provider?: string;
    model?: string;
    requestId?: string;
    body?: string;
    retryAfterSeconds?: number;
  } = {},
): GatewayError {
  const base = { ...ctx, upstreamStatus: status };
  if (status === 401) {
    return new GatewayError({
      ...base,
      type: "AUTHENTICATION_REQUIRED",
      status: 401,
      message: `Provider requires authentication (HTTP 401).`,
    });
  }
  if (status === 403) {
    // A5: surface 403 honestly (was PROVIDER_UNAVAILABLE 502).
    return new GatewayError({
      ...base,
      type: "UPSTREAM_4XX",
      status: 403,
      message: `Provider rejected the request (HTTP 403).`,
    });
  }
  if (status === 404) {
    return new GatewayError({
      ...base,
      type: "MODEL_NOT_FOUND",
      status: 404,
      message: `Upstream returned 404 for model "${ctx.model ?? "?"}".`,
    });
  }
  if (status === 429) {
    // A4: rate-limited — return 429 with a Retry-After hint.
    const retryAfter = ctx.retryAfterSeconds ?? 60;
    return new GatewayError({
      ...base,
      type: "RATE_LIMITED",
      status: 429,
      retryAfter,
      message: `Upstream rate limit exceeded. Retry after ${retryAfter}s.`,
    });
  }
  if (status === 408) {
    return new GatewayError({
      ...base,
      type: "UPSTREAM_TIMEOUT",
      status: 504,
      message: `Upstream timed out (HTTP 408).`,
    });
  }
  if (status === 503 || status === 504) {
    // A6: gateway unavailable — return 503 (not 502).
    return new GatewayError({
      ...base,
      type: "UPSTREAM_UNAVAILABLE",
      status: 503,
      message: `Upstream unavailable (HTTP ${status}). Retry later.`,
    });
  }
  if (status >= 400 && status < 500) {
    // A3: pass through the upstream's 4xx status verbatim.
    return new GatewayError({
      ...base,
      type: "UPSTREAM_4XX",
      status,
      message: `Upstream rejected request (HTTP ${status}).${ctx.body ? ` ${ctx.body.slice(0, 160)}` : ""}`,
    });
  }
  if (status >= 500) {
    // Pass through the upstream's 5xx status verbatim.
    return new GatewayError({
      ...base,
      type: "UPSTREAM_5XX",
      status,
      message: `Upstream error (HTTP ${status}).${ctx.body ? ` ${ctx.body.slice(0, 160)}` : ""}`,
    });
  }
  return new GatewayError({
    ...base,
    type: "UPSTREAM_4XX",
    status: 400,
    message: `Unexpected upstream status ${status}.`,
  });
}

/** Retryable status codes (PRD §63). 403/401/400 are NOT retried. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Whether a GatewayError is a failover candidate (audit D1). Failover is
 * attempted when the requested provider is genuinely unavailable or rate-
 * limited — NOT on 4xx client errors (which a fallback would also hit).
 */
export function isFailoverCandidate(err: GatewayError): boolean {
  return (
    err.type === "UPSTREAM_5XX" ||
    err.type === "UPSTREAM_UNAVAILABLE" ||
    err.type === "UPSTREAM_TIMEOUT" ||
    err.type === "RATE_LIMITED" ||
    err.type === "PROVIDER_UNAVAILABLE"
  );
}

/** Monotonic request id for correlation (PRD §125). */
export function generateRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return (
    "req_" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Build a JSON error Response from a GatewayError. */
export function errorResponse(err: GatewayError): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // A4: expose a Retry-After hint to clients when the upstream is rate-limited.
  if (err.type === "RATE_LIMITED") {
    headers["Retry-After"] = String(err.retryAfter ?? 60);
  }
  return new Response(JSON.stringify({ error: err.toJSON() }), {
    status: err.status,
    headers,
  });
}

/** Build an SSE error event string for an in-stream failure (PRD §61). */
export function sseErrorEvent(err: GatewayError): string {
  return `event: error\ndata: ${JSON.stringify({ error: err.toJSON() })}\n\n`;
}
