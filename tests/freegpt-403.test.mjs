/**
 * FreeGPT 403 handling test (PRD §63, §148, §207, §236).
 *
 * Verifies the 403-handling framework WITHOUT hitting real freegpt.tech
 * (PRD §183 — deterministic). The original bug (PRD §207) was the gateway
 * retrying 403 responses from Cloudflare; the fix (Phase 2b) makes 403
 * → PROVIDER_UNAVAILABLE (NOT retried per PRD §63) and surfaces the
 * structured error as an SSE event in-stream (PRD §61, §148).
 *
 * Methodology:
 *   1. Mock provider adapter whose `stream()` async generator immediately
 *      throws `classifyUpstreamStatus(403, { provider, model })` on first
 *      `.next()` call.
 *   2. Call `streamChat(req, mockProvider)` → `{ response, timings }`.
 *   3. Read the SSE stream. Assert:
 *        - The stream emits `event: error` containing JSON with
 *          `error.type === "PROVIDER_UNAVAILABLE"` and
 *          `error.upstreamStatus === 403` (PRD §148).
 *        - The stream closes (reader.read() returns done OR a per-read
 *          timeout fires after the error event has been consumed).
 *        - The mock's `stream()` was called exactly ONCE (not retried — PRD §63).
 *   4. Assert `isRetryableStatus(403) === false`.
 *   5. Soft-assert that `providerHealthService.recordModelFailure` was
 *      invoked (the streaming-proxy's `handleStreamError` calls it).
 *
 * NOTE on [DONE] emission: the streaming-proxy's error path enqueues
 * `sseErrorEvent(err)` + calls `controller.close()` but does NOT emit a
 * `data: [DONE]` sentinel (the success path's `enqueueFinal` is the only
 * emitter of `[DONE]`). This is the actual implementation behavior we
 * observe; the test asserts the stream CLOSES after the error event,
 * which is the contract that matters (the client knows the stream is over
 * because `reader.read()` resolves `{done: true}`).
 */

import assert from "node:assert/strict";
import { streamChat } from "../src/lib/gateway/streaming-proxy.ts";
import { SseParser } from "../src/lib/gateway/sse-parser.ts";
import { classifyUpstreamStatus, isRetryableStatus } from "../src/lib/gateway/errors.ts";
import { providerHealthService } from "../src/lib/gateway/health.ts";

function createMock403Provider() {
  let streamCallCount = 0;
  let completeCallCount = 0;

  const adapter = {
    id: "freegpt",
    shortId: "fg",
    name: "FreeGPT (mock)",
    discoveryMode: "dynamic",

    async *stream(req) {
      streamCallCount++;
      // Throw immediately on first .next() — the streaming-proxy's
      // `await gen.next()` rejects, which routes through handleStreamError.
      throw classifyUpstreamStatus(403, {
        provider: "freegpt",
        model: "gpt-5",
        body: "<html>Cloudflare blocked the request</html>",
      });
      // unreachable
      yield "never";
    },

    async complete(req) {
      completeCallCount++;
      throw classifyUpstreamStatus(403, {
        provider: "freegpt",
        model: "gpt-5",
      });
    },

    async discoverModels() {
      return [];
    },

    async healthCheck() {
      return {
        status: "degraded",
        providerId: "freegpt",
        lastChecked: new Date().toISOString(),
        message: "Cloudflare 403",
      };
    },
  };

  return { adapter, getStreamCallCount: () => streamCallCount };
}

export async function run() {
  // Sanity: 403 is NOT retried (PRD §63).
  assert.equal(
    isRetryableStatus(403),
    false,
    "403 must NOT be retried (PRD §63)",
  );

  const { adapter, getStreamCallCount } = createMock403Provider();

  // Spy on providerHealthService.recordModelFailure (best-effort — if the
  // import or method shape differs, skip this assertion per spec).
  let recordModelFailureCalls = 0;
  let recordModelFailureSpy = null;
  try {
    const orig = providerHealthService.recordModelFailure.bind(providerHealthService);
    recordModelFailureSpy = function (_modelId, _err) {
      recordModelFailureCalls++;
      // Call original to preserve internal state.
      return orig.call(providerHealthService, _modelId, _err);
    };
    providerHealthService.recordModelFailure = recordModelFailureSpy;
  } catch (e) {
    // If spying fails, we still run the rest of the test.
    console.log("  [info] could not install recordModelFailure spy:", e?.message);
  }

  const req = {
    modelId: "fg/gpt-5",
    upstreamId: "gpt-5",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  };

  const { response, timings } = streamChat(req, adapter);
  assert.equal(response.status, 200, "streaming response status is 200 (errors are in-stream)");

  const reader = response.body.getReader();
  const parser = new SseParser();

  let errorEvent = null;
  let streamClosed = false;
  const READ_TIMEOUT_MS = 2000;

  // Read until we see the error event AND the stream closes (or timeout).
  // The error path enqueues sseErrorEvent + controller.close(), so after
  // the error chunk we expect reader.read() to return { done: true }.
  while (!streamClosed) {
    const readP = reader.read();
    const timeoutP = new Promise((resolve) =>
      setTimeout(() => resolve({ __timeout: true }), READ_TIMEOUT_MS),
    );
    const r = await Promise.race([readP, timeoutP]);
    if (r.__timeout) {
      break;
    }
    if (r.done) {
      streamClosed = true;
      break;
    }
    for (const ev of parser.feed(r.value)) {
      if (ev.event === "error" && ev.data && !errorEvent) {
        try {
          const body = JSON.parse(ev.data);
          if (body.error) errorEvent = body.error;
        } catch { /* not JSON — ignore */ }
      }
    }
    // Once we have the error event, the next read should return done=true
    // (the streaming-proxy's handleStreamError closes the controller).
    if (errorEvent) {
      // Continue looping to confirm stream closes — but the next read
      // might block on `controller.close()` actually being invoked, so
      // we just continue the loop (with the same per-read timeout).
    }
  }
  try { await reader.cancel(); } catch { /* best-effort */ }

  // 1. The stream emits an event: error containing the structured error.
  assert.ok(
    errorEvent,
    "stream must emit an `event: error` with a JSON error body",
  );
  assert.equal(
    errorEvent.type,
    "PROVIDER_UNAVAILABLE",
    `error.type must be PROVIDER_UNAVAILABLE (got ${errorEvent.type})`,
  );
  assert.equal(
    errorEvent.upstreamStatus,
    403,
    `error.upstreamStatus must be 403 (got ${errorEvent.upstreamStatus}) — PRD §148`,
  );
  assert.equal(
    errorEvent.status,
    502,
    `error.status must be 502 (default for PROVIDER_UNAVAILABLE)`,
  );
  assert.equal(errorEvent.provider, "freegpt");
  assert.equal(errorEvent.model, "gpt-5");
  assert.ok(errorEvent.request_id?.startsWith("req_"));

  // 2. The stream closes after the error event (the error-path enqueues
  //    sseErrorEvent + controller.close() — the production success-path's
  //    `[DONE]` sentinel is NOT emitted on error, but the stream does close).
  assert.ok(
    streamClosed,
    "stream must close after the error event (reader.read() returned done=true)",
  );

  // 3. The mock provider's stream() was called EXACTLY ONCE (no retry).
  assert.equal(
    getStreamCallCount(),
    1,
    `mock.stream() must be called exactly once (got ${getStreamCallCount()}) — 403 is NOT retried (PRD §63)`,
  );

  // 4. providerHealthService.recordModelFailure was called by
  //    handleStreamError (best-effort — skip if spy couldn't be installed).
  if (recordModelFailureSpy) {
    assert.ok(
      recordModelFailureCalls >= 1,
      `providerHealthService.recordModelFailure must be called (got ${recordModelFailureCalls} calls)`,
    );
  } else {
    console.log("  [info] recordModelFailure spy not installed — skipping assertion");
  }

  // 5. Timings recorded the error.
  assert.ok(timings.error, "timings.error must be populated");
  assert.ok(timings.error.includes("403"), "timings.error message mentions 403");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("freegpt-403.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("freegpt-403.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
