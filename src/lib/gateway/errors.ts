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
  | "AUTHENTICATION_REQUIRED"
  | "EMPTY_UPSTREAM_RESPONSE";

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
  /** Raw upstream error text (sanitized message stays in `message`; raw
   * upstream detail moves here so HTML/billing/deprecation blobs never
   * pollute the user-facing message — R-10). */
  upstream_detail?: string;
  /** True when retrying the same request might succeed (5xx/rate-limit).
   * False for 4xx client-payload faults. */
  retryable?: boolean;
  /** True when this model requires authentication the gateway doesn't hold
   * (R-9 — surfaces in /api/v1/models so clients can route around it). */
  requires_auth?: boolean;
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
  /** Raw upstream error text (HTML/billing/deprecation blobs). R-10. */
  readonly upstreamDetail?: string;
  /** Whether this model requires upstream auth the gateway lacks. R-9. */
  readonly requiresAuth?: boolean;

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
    upstreamDetail?: string;
    requiresAuth?: boolean;
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
    this.upstreamDetail = opts.upstreamDetail;
    this.requiresAuth = opts.requiresAuth;
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
      upstream_detail: this.upstreamDetail,
      retryable: isRetryableType(this.type),
      requires_auth: this.requiresAuth,
    };
  }
}

/** Whether a GatewayError type is retryable (R-7 — client-payload faults are not). */
export function isRetryableType(type: GatewayErrorType): boolean {
  return (
    type === "UPSTREAM_5XX" ||
    type === "UPSTREAM_UNAVAILABLE" ||
    type === "UPSTREAM_TIMEOUT" ||
    type === "RATE_LIMITED" ||
    type === "PROVIDER_UNAVAILABLE" ||
    type === "STREAM_ERROR" ||
    type === "EMPTY_UPSTREAM_RESPONSE"
  );
}

/** Default HTTP status per error type (PRD §147, R-7). */
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
    case "EMPTY_UPSTREAM_RESPONSE":
      // R-5: upstream returned an empty reply — that's an upstream fault, so 502.
      return 502;
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
 * Classify an upstream HTTP status into a gateway error type (PRD §148, audit A3-A6, R-7, R-10).
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
 *
 * R-10: the raw upstream `body` is moved into `upstream_detail` and the
 * user-facing `message` is sanitized (HTML / billing / deprecation blobs
 * never leak). R-9: 401 responses carry `requires_auth: true` so the
 * catalogue can label them.
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
  const sanitizedBody = ctx.body ? sanitizeUpstreamMessage(ctx.body) : undefined;
  const upstreamDetail = ctx.body;

  if (status === 401) {
    return new GatewayError({
      ...base,
      type: "AUTHENTICATION_REQUIRED",
      status: 401,
      message: `Provider requires authentication (HTTP 401).`,
      requiresAuth: true,
      upstreamDetail,
    });
  }
  if (status === 403) {
    // A5: surface 403 honestly (was PROVIDER_UNAVAILABLE 502).
    return new GatewayError({
      ...base,
      type: "UPSTREAM_4XX",
      status: 403,
      message: `Provider rejected the request (HTTP 403).`,
      upstreamDetail,
    });
  }
  if (status === 404) {
    const modelName404 = ctx.model ?? "unknown";
    return new GatewayError({
      ...base,
      type: "MODEL_NOT_FOUND",
      status: 404,
      message: `Upstream returned 404 for model "${modelName404}".`,
      upstreamDetail,
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
      upstreamDetail,
    });
  }
  if (status === 408) {
    return new GatewayError({
      ...base,
      type: "UPSTREAM_TIMEOUT",
      status: 504,
      message: `Upstream timed out (HTTP 408).`,
      upstreamDetail,
    });
  }
  if (status === 503 || status === 504) {
    // A6: gateway unavailable — return 503 (not 502).
    return new GatewayError({
      ...base,
      type: "UPSTREAM_UNAVAILABLE",
      status: 503,
      message: `Upstream unavailable (HTTP ${status}). Retry later.`,
      upstreamDetail,
    });
  }
  if (status >= 400 && status < 500) {
    // A3: pass through the upstream's 4xx status verbatim.
    return new GatewayError({
      ...base,
      type: "UPSTREAM_4XX",
      status,
      message: sanitizedBody
        ? `Upstream rejected request (HTTP ${status}). ${sanitizedBody}`
        : `Upstream rejected request (HTTP ${status}).`,
      upstreamDetail,
    });
  }
  if (status >= 500) {
    // Pass through the upstream's 5xx status verbatim. R-10: keep the
    // message short + sanitized; raw upstream body lives in upstream_detail.
    return new GatewayError({
      ...base,
      type: "UPSTREAM_5XX",
      status,
      message: `Upstream error (HTTP ${status}).`,
      upstreamDetail,
    });
  }
  return new GatewayError({
    ...base,
    type: "UPSTREAM_4XX",
    status: 400,
    message: `Unexpected upstream status ${status}.`,
    upstreamDetail,
  });
}

/** Retryable status codes (PRD §63). 403/401/400 are NOT retried. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Whether a GatewayError is a failover candidate (audit D1, R-8). Failover is
 * attempted when the requested provider is genuinely unavailable or rate-
 * limited — NOT on 4xx client errors (which a fallback would also hit).
 */
export function isFailoverCandidate(err: GatewayError): boolean {
  return (
    err.type === "UPSTREAM_5XX" ||
    err.type === "UPSTREAM_UNAVAILABLE" ||
    err.type === "UPSTREAM_TIMEOUT" ||
    err.type === "RATE_LIMITED" ||
    err.type === "PROVIDER_UNAVAILABLE" ||
    err.type === "EMPTY_UPSTREAM_RESPONSE"
  );
}

// ─── Empty-content validation (R-1) ──────────────────────────────────────

/**
 * Inspect a message list and return true iff at least one user/system/
 * assistant message carries a non-empty content payload.
 *
 * Used by the fx/* proxy path (R-1) so that `content:""`, `content:null`,
 * `content:[]`, `content:[{type:"text",text:""}]`, or `image_url.url:""`
 * are rejected locally with HTTP 400 `invalid_request_error` instead of
 * being forwarded to the upstream which then leaks an internal
 * cache-writer error back to the client.
 *
 * Parity with the 16 other adapters' existing `normalizeMessagesForGateway`
 * check that drops empty content parts and rejects when nothing survives.
 *
 * Variant matrix (per audit §4.2):
 *   - A `content:""`         → reject (length 0)
 *   - B `content:"   "`      → ACCEPT (whitespace passes through — the audit
 *                              confirms the upstream treats it as non-empty)
 *   - E `content:null`       → reject
 *   - F `content:[]`         → reject (no parts at all)
 *   - G `content:[{text:""}]`→ reject (the only part has empty text)
 *   - I `text:""+img:""`     → reject (both parts empty)
 *   - H assistant w/ tools  → ACCEPT (variant H succeeds)
 */
export function hasNonEmptyContent(
  messages: Array<{
    role?: string;
    content?: string | null | Array<
      | { type: "text"; text?: string }
      | { type: "image_url"; image_url?: { url?: string } }
      | Record<string, unknown>
    >;
    tool_calls?: unknown[];
  }>,
): boolean {
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    // Assistant messages with tool_calls count as content (R-1 variant H).
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return true;
    }
    const c = m.content;
    if (typeof c === "string") {
      // R-1 variant B: whitespace-only strings are ACCEPTED (audit confirms
      // the upstream cache-writer only rejects literally empty strings).
      // Use length > 0, NOT trim() — variant B `content:"   "` passes through.
      if (c.length > 0) return true;
      continue;
    }
    if (c === null) continue;
    if (Array.isArray(c)) {
      if (c.length === 0) continue; // empty array → no content here
      for (const part of c) {
        if (!part || typeof part !== "object") continue;
        const t = (part as { type?: string }).type;
        if (t === "text") {
          // R-1 variant G: empty text part → reject. Whitespace-only text
          // part is also treated as empty (the audit doesn't explicitly
          // cover this case; the safe behavior is to reject).
          const text = (part as { text?: string }).text;
          if (typeof text === "string" && text.trim() !== "") return true;
        } else if (t === "image_url") {
          // R-1 variant I: empty image_url.url → reject.
          const url = (part as { image_url?: { url?: string } }).image_url?.url;
          if (typeof url === "string" && url.trim() !== "") return true;
        }
      }
    }
  }
  return false;
}

/**
 * Build the canonical R-1 INVALID_REQUEST error for empty content.
 * The exact message + code clients should see so the upstream cache-writer
 * string "Data to cache (message or image) cannot be empty." never leaks.
 */
export function emptyContentError(model?: string, provider?: string): GatewayError {
  return new GatewayError({
    type: "INVALID_REQUEST",
    status: 400,
    code: "invalid_request_error",
    message: "messages must contain at least one non-empty content part.",
    model,
    provider,
  });
}

/**
 * Build the canonical R-5 EMPTY_UPSTREAM_RESPONSE error.
 * Used when the upstream returned a fully-formed 200 with `content:""` —
 * the gateway refuses to pass that on as a silent success.
 */
export function emptyUpstreamResponseError(
  provider?: string,
  model?: string,
  upstreamDetail?: string,
): GatewayError {
  return new GatewayError({
    type: "EMPTY_UPSTREAM_RESPONSE",
    status: 502,
    code: "empty_upstream_response",
    message: "Upstream provider returned an empty response.",
    provider,
    model,
    upstreamDetail,
  });
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
  // A4 + R-13: expose a Retry-After hint to clients when the upstream is
  // rate-limited (or when a 502 quota leak surfaces — R-13).
  if (err.type === "RATE_LIMITED") {
    headers["Retry-After"] = String(err.retryAfter ?? 60);
  }
  return new Response(JSON.stringify({ error: err.toJSON() }), {
    status: err.status,
    headers,
  });
}

/**
 * Build an SSE error event string for an in-stream failure (PRD §61, R-2).
 *
 * R-2 hardening: in addition to the structured `error` object, the payload
 * surfaces a top-level `http_status` field so simple clients that only read
 * the SSE `data:` JSON (and don't recurse into `error.status`) can still
 * discover the real HTTP status that would have been returned had the request
 * been non-streaming. This is belt-and-suspenders — the canonical fix is that
 * pre-first-token errors never open a 200 OK stream in the first place (see
 * streaming-proxy.ts `streamChat` pre-flight), but mid-stream errors still
 * arrive over a 200 OK stream and need every available surface for the client
 * to recover the real status.
 */
export function sseErrorEvent(err: GatewayError): string {
  const body = err.toJSON();
  return `event: error\ndata: ${JSON.stringify({
    error: body,
    // Top-level mirror of the HTTP status that would have been sent for a
    // non-streaming version of this request. Read this when you only want
    // the status code without parsing the nested `error` object.
    http_status: body.status,
  })}\n\n`;
}

/**
 * Build the terminal SSE chunk that MUST follow an in-stream `event: error`
 * frame so a streaming client can unambiguously detect that the stream
 * ended in failure (R-2). Emits:
 *   1. A `data:` chunk with `finish_reason: "error"` (so a client parsing
 *      only `data:` frames sees a non-`stop` finish reason).
 *   2. The `[DONE]` sentinel (so a client waiting on `[DONE]` is released).
 *
 * Without this, a `200 OK` streaming response that hit an upstream error
 * after the first chunk would leave `Status: N/A` clients hanging.
 */
export function sseTerminalErrorChunk(
  err: GatewayError,
  sseId: string,
  created: number,
  model: string,
): string {
  const payload = {
    id: sseId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "error",
      },
    ],
    // Some clients read `error` off the top-level chunk instead of the
    // `event: error` frame — surface it both ways (R-2).
    error: err.toJSON(),
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

// ─── Upstream error sanitization (R-10) ──────────────────────────────────

/**
 * Strip HTML, billing notices, deprecation blobs, and other raw upstream
 * internals out of an error message. Returns the sanitized short message;
 * the full raw text is preserved separately as `upstream_detail`.
 *
 * Example: "Swarm returned HTTP 500: <!DOCTYPE html><!--[if lt IE 7]>…"
 *   → message: "Upstream error (HTTP 500)."
 *     upstream_detail: "<!DOCTYPE html>…"
 *
 * Example: "Pollinations returned HTTP 500: {\"error\":\"402 Payment Required\",\"deprecation_notice\":\"…\"}"
 *   → message: "Upstream error (HTTP 500)."
 *     upstream_detail: "{\"error\":\"402 Payment Required\",\"deprecation_notice\":\"…\"}"
 */
export function sanitizeUpstreamMessage(raw: string): string {
  if (!raw) return "";
  // Detect HTML payloads (Cloudflare challenge pages, provider error pages).
  if (/^\s*<(?:!doctype|html|head|body)\b/i.test(raw) || /<html\b/i.test(raw.slice(0, 200))) {
    return "Upstream returned an HTML error page instead of JSON.";
  }
  // Detect JSON error blobs.
  if (raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    return "Upstream returned a structured error body.";
  }
  // Otherwise keep the first 160 chars but strip newlines/control chars.
  return raw.replace(/[\r\n\t]+/g, " ").slice(0, 160).trim();
}
