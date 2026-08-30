/**
 * Error taxonomy tests (PRD §62, §63, §125, §146, §147, §148, §149).
 *
 * Every gateway error is normalized into a structured envelope:
 *
 *   { error: { type, message, provider, model, request_id, code, status, upstreamStatus? } }
 *
 * 403 from a provider → PROVIDER_UNAVAILABLE, status 502, NOT retried
 * (PRD §63, §148 — the original bug was the gateway retrying 403s).
 * 429 → RATE_LIMITED, retried. 5xx → UPSTREAM_5XX, retried.
 * 408/504 → UPSTREAM_TIMEOUT, retried. 401 → AUTHENTICATION_REQUIRED, NOT retried.
 */

import assert from "node:assert/strict";
import {
  GatewayError,
  classifyUpstreamStatus,
  defaultStatusFor,
  isRetryableStatus,
  generateRequestId,
  errorResponse,
  sseErrorEvent,
} from "../src/lib/gateway/errors.ts";

const CTX = { provider: "freegpt", model: "gpt-5" };

export async function run() {
  // 1. 403 → PROVIDER_UNAVAILABLE, status 502, NOT retried (PRD §63, §148).
  {
    const err = classifyUpstreamStatus(403, CTX);
    assert.equal(err.type, "PROVIDER_UNAVAILABLE");
    assert.equal(err.status, 502, "403 → status 502 (default for PROVIDER_UNAVAILABLE)");
    assert.equal(err.upstreamStatus, 403, "upstreamStatus preserved");
    assert.equal(err.provider, "freegpt");
    assert.equal(err.model, "gpt-5");
    assert.equal(isRetryableStatus(403), false, "403 is NOT retried (PRD §63)");
  }

  // 2. 429 → RATE_LIMITED, retried.
  {
    const err = classifyUpstreamStatus(429, CTX);
    assert.equal(err.type, "RATE_LIMITED");
    assert.equal(err.status, 429);
    assert.equal(err.upstreamStatus, 429);
    assert.equal(isRetryableStatus(429), true, "429 IS retried");
  }

  // 3. 500 → UPSTREAM_5XX, retried.
  {
    const err = classifyUpstreamStatus(500, CTX);
    assert.equal(err.type, "UPSTREAM_5XX");
    assert.equal(err.status, 502);
    assert.equal(err.upstreamStatus, 500);
    assert.equal(isRetryableStatus(500), false, "500 not in retry list (only 408/429/502/503/504)");
  }

  // 3b. 502/503/504 are retried per isRetryableStatus.
  assert.equal(isRetryableStatus(502), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(504), true);
  assert.equal(isRetryableStatus(408), true);

  // 4. 404 → MODEL_NOT_FOUND, status 404, NOT retried.
  {
    const err = classifyUpstreamStatus(404, CTX);
    assert.equal(err.type, "MODEL_NOT_FOUND");
    assert.equal(err.status, 404);
    assert.equal(isRetryableStatus(404), false, "404 NOT retried");
  }

  // 5. 401 → AUTHENTICATION_REQUIRED, status 401, NOT retried.
  {
    const err = classifyUpstreamStatus(401, CTX);
    assert.equal(err.type, "AUTHENTICATION_REQUIRED");
    assert.equal(err.status, 401);
    assert.equal(isRetryableStatus(401), false, "401 NOT retried");
  }

  // 6. 504 → UPSTREAM_TIMEOUT, retried.
  {
    const err = classifyUpstreamStatus(504, CTX);
    assert.equal(err.type, "UPSTREAM_TIMEOUT");
    assert.equal(err.status, 504);
    assert.equal(err.upstreamStatus, 504);
    assert.equal(isRetryableStatus(504), true);
  }

  // 7. 408 → UPSTREAM_TIMEOUT.
  {
    const err = classifyUpstreamStatus(408, CTX);
    assert.equal(err.type, "UPSTREAM_TIMEOUT");
    assert.equal(err.status, 504);
  }

  // 8. 400 → UPSTREAM_4XX, NOT retried.
  {
    const err = classifyUpstreamStatus(400, CTX);
    assert.equal(err.type, "UPSTREAM_4XX");
    assert.equal(err.status, 502);
    assert.equal(isRetryableStatus(400), false);
  }

  // 9. defaultStatusFor — STREAM_ABORTED → 502 (PRD §147).
  assert.equal(defaultStatusFor("STREAM_ABORTED"), 502);
  assert.equal(defaultStatusFor("MODEL_NOT_FOUND"), 404);
  assert.equal(defaultStatusFor("PROVIDER_NOT_FOUND"), 404);
  assert.equal(defaultStatusFor("INVALID_REQUEST"), 400);
  assert.equal(defaultStatusFor("AUTHENTICATION_REQUIRED"), 401);
  assert.equal(defaultStatusFor("RATE_LIMITED"), 429);
  assert.equal(defaultStatusFor("UPSTREAM_TIMEOUT"), 504);
  assert.equal(defaultStatusFor("PROVIDER_UNAVAILABLE"), 502);
  assert.equal(defaultStatusFor("UPSTREAM_5XX"), 502);
  assert.equal(defaultStatusFor("UPSTREAM_4XX"), 502);
  assert.equal(defaultStatusFor("STREAM_ERROR"), 502);
  assert.equal(defaultStatusFor("DISCOVERY_FAILED"), 502);
  assert.equal(defaultStatusFor("VERIFICATION_FAILED"), 502);

  // 10. generateRequestId starts with "req_" and is unique across 1000 calls (PRD §125).
  {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = generateRequestId();
      assert.ok(id.startsWith("req_"), `id starts with req_ (got ${id})`);
      ids.add(id);
    }
    assert.equal(ids.size, 1000, "1000 unique request ids generated");
  }

  // 11. GatewayError constructor — explicit status overrides default.
  {
    const err = new GatewayError({
      type: "STREAM_ABORTED",
      message: "aborted",
      status: 499, // explicit override
      provider: "freegpt",
      model: "gpt-5",
    });
    assert.equal(err.status, 499);
    assert.equal(err.type, "STREAM_ABORTED");
    assert.equal(err.provider, "freegpt");
    assert.ok(err.requestId.startsWith("req_"));
    assert.equal(err.code, "stream_aborted");
    assert.equal(err.name, "GatewayError");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof GatewayError);
  }

  // 12. toJSON round-trips the structured envelope (PRD §146).
  {
    const err = classifyUpstreamStatus(403, CTX);
    const body = err.toJSON();
    assert.equal(body.type, "PROVIDER_UNAVAILABLE");
    assert.equal(body.status, 502);
    assert.equal(body.upstreamStatus, 403);
    assert.equal(body.provider, "freegpt");
    assert.equal(body.model, "gpt-5");
    assert.ok(body.request_id.startsWith("req_"));
    assert.equal(body.code, "provider_unavailable");
  }

  // 13. errorResponse builds a JSON Response with the right status.
  {
    const err = classifyUpstreamStatus(429, CTX);
    const res = errorResponse(err);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("content-type"), "application/json");
    const body = await res.json();
    assert.equal(body.error.type, "RATE_LIMITED");
    assert.equal(body.error.upstreamStatus, 429);
  }

  // 14. sseErrorEvent builds an `event: error\ndata: {...}\n\n` line (PRD §61).
  {
    const err = classifyUpstreamStatus(403, CTX);
    const line = sseErrorEvent(err);
    assert.ok(line.startsWith("event: error\n"), "starts with event: error");
    assert.ok(line.endsWith("\n\n"), "ends with \\n\\n");
    assert.ok(line.includes(`"type":"PROVIDER_UNAVAILABLE"`), "contains type");
    assert.ok(line.includes(`"upstreamStatus":403`), "contains upstreamStatus");
  }

  // 15. classifyUpstreamStatus with body preview.
  {
    const err = classifyUpstreamStatus(422, { ...CTX, body: "validation failed" });
    assert.equal(err.type, "UPSTREAM_4XX");
    assert.ok(err.message.includes("422"), "message includes status");
    assert.ok(err.message.includes("validation failed"), "message includes body preview");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("errors.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("errors.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
