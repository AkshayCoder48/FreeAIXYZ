/**
 * API error taxonomy + normalization (PRD §62, §146, §147, §148, §149).
 *
 * Every gateway error is normalized into a structured envelope:
 *
 *   { error: { type, message, provider, model, request_id, code, status } }
 *
 * Upstream status codes are preserved where safe (PRD §147). 403 from a
 * provider is classified as PROVIDER_UNAVAILABLE and is NOT retried
 * (PRD §63, §148).
 */

export type GatewayErrorType =
  | "MODEL_NOT_FOUND"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "UPSTREAM_4XX"
  | "UPSTREAM_5XX"
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

  constructor(opts: {
    type: GatewayErrorType;
    message: string;
    status?: number;
    upstreamStatus?: number;
    provider?: string;
    model?: string;
    requestId?: string;
    code?: string;
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
    case "PROVIDER_UNAVAILABLE":
    case "UPSTREAM_4XX":
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
 * Classify an upstream HTTP status into a gateway error type (PRD §148).
 * 403 → PROVIDER_UNAVAILABLE (NOT retried). 429 → RATE_LIMITED. 5xx →
 * UPSTREAM_5XX (retry candidate). 408/504 → UPSTREAM_TIMEOUT (retry candidate).
 */
export function classifyUpstreamStatus(
  status: number,
  ctx: {
    provider?: string;
    model?: string;
    requestId?: string;
    body?: string;
  } = {},
): GatewayError {
  const base = { ...ctx, upstreamStatus: status };
  if (status === 403 || status === 401) {
    return new GatewayError({
      ...base,
      type: status === 403 ? "PROVIDER_UNAVAILABLE" : "AUTHENTICATION_REQUIRED",
      message:
        status === 403
          ? `Provider rejected the request (HTTP 403). Marked degraded — not retried.`
          : `Provider requires authentication (HTTP 401).`,
    });
  }
  if (status === 404) {
    return new GatewayError({
      ...base,
      type: "MODEL_NOT_FOUND",
      message: `Upstream returned 404 for model "${ctx.model ?? "?"}".`,
    });
  }
  if (status === 429) {
    return new GatewayError({
      ...base,
      type: "RATE_LIMITED",
      message: `Provider rate limit hit (HTTP 429). Retry later.`,
    });
  }
  if (status === 408 || status === 504) {
    return new GatewayError({
      ...base,
      type: "UPSTREAM_TIMEOUT",
      message: `Upstream timed out (HTTP ${status}).`,
    });
  }
  if (status >= 400 && status < 500) {
    return new GatewayError({
      ...base,
      type: "UPSTREAM_4XX",
      message: `Upstream rejected request (HTTP ${status}).${ctx.body ? ` ${ctx.body.slice(0, 160)}` : ""}`,
    });
  }
  if (status >= 500) {
    return new GatewayError({
      ...base,
      type: "UPSTREAM_5XX",
      message: `Upstream error (HTTP ${status}).${ctx.body ? ` ${ctx.body.slice(0, 160)}` : ""}`,
    });
  }
  return new GatewayError({
    ...base,
    type: "UPSTREAM_4XX",
    message: `Unexpected upstream status ${status}.`,
  });
}

/** Retryable status codes (PRD §63). 403/401/400 are NOT retried. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
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
  return new Response(JSON.stringify({ error: err.toJSON() }), {
    status: err.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build an SSE error event string for an in-stream failure (PRD §61). */
export function sseErrorEvent(err: GatewayError): string {
  return `event: error\ndata: ${JSON.stringify({ error: err.toJSON() })}\n\n`;
}
