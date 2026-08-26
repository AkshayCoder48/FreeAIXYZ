/**
 * Streaming regression test (PRD §130, §131, §182, §183, §231, §238).
 *
 * This is THE KEY TEST. It proves that `streamChat()` (the new streaming
 * proxy from Phase 2a) forwards every upstream delta to the client
 * IMMEDIATELY as it arrives — it does NOT buffer the full upstream
 * response and re-pace it (the bug PRD §137/§238 calls out).
 *
 * Methodology (PRD §182 — "test timing, not just final content"):
 *   1. Build a fake slow provider whose `stream()` async generator yields
 *      "Hello" at +500ms, " world" at +1000ms, "!" at +1500ms.
 *   2. Call `streamChat(req, fakeProvider)` → `{ response, timings }`.
 *   3. Read `response.body` with a single `TextDecoder` (PRD §18) +
 *      `SseParser` to extract each SSE event as it arrives. Record wall
 *      time at first byte + each event arrival.
 *   4. ASSERT:
 *        - First content chunk ("Hello") arrives BEFORE 1100ms
 *          (slack for CI jitter — would be ~1500ms+ on the old
 *          buffered-then-re-paced `streamText()` code).
 *        - Second content chunk (" world") arrives > 200ms after the
 *          first — proves incremental, not all-at-once.
 *        - [DONE] arrives BEFORE 2500ms.
 *        - Concatenated content === "Hello world!".
 *        - timings.chunkCount >= 3 (we observed ≥3 upstream deltas).
 *        - timings.ttftMs < 1100 (time-to-first-token).
 *
 * This test would FAIL on the legacy `streamText()` re-pacer which:
 *   - buffers ALL upstream deltas into `fullText` (no client output until
 *     upstream completion at +1500ms),
 *   - then re-paces with 30ms inter-chunk sleep (final [DONE] at +~1520ms+).
 * The "Hello" content would arrive at ~1500ms instead of ~500ms.
 *
 * Deterministic (PRD §183): no real network — the fake provider uses
 * `setTimeout` only.
 */

import assert from "node:assert/strict";
import { SseParser, extractOpenAiDelta } from "../src/lib/gateway/sse-parser.ts";
import { streamChat } from "../src/lib/gateway/streaming-proxy.ts";
import { createFakeSlowProvider } from "./fake-slow-provider.mjs";

// CI jitter tolerance — the fake provider yields at +500/1000/1500ms; the
// proxy + reader + decoder add a few ms. We assert "well before the next
// expected chunk" rather than exact equality.
const FIRST_CONTENT_MAX_MS = 1100;   // "Hello" must arrive < 1100ms
const INTER_CHUNK_MIN_MS = 200;      // gap between "Hello" and " world"
const DONE_MAX_MS = 2500;            // [DONE] must arrive < 2500ms
const TTFT_MAX_MS = 1100;            // timings.ttftMs must be < 1100ms

export async function run() {
  const fakeProvider = createFakeSlowProvider();
  const req = {
    modelId: "fake/test-model",
    upstreamId: "test-model",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
  };

  const { response, timings } = streamChat(req, fakeProvider);
  const t0 = timings.requestStart; // t=0 reference (Date.now() at call)

  assert.ok(response && response.body, "streamChat must return a Response with a body");
  assert.equal(response.status, 200, "streaming response status must be 200");
  assert.equal(
    response.headers.get("content-type"),
    "text/event-stream; charset=utf-8",
    "Content-Type must be SSE",
  );
  assert.equal(
    response.headers.get("x-accel-buffering"),
    "no",
    "X-Accel-Buffering: no must be set (PRD §11)",
  );

  const reader = response.body.getReader();
  // PRD §18 — one TextDecoder instance per stream, stream:true to handle
  // multi-byte UTF-8 split across chunk boundaries.
  const parser = new SseParser();

  const events = [];           // { arrivalMs, ev, content? }
  let firstByteMs = null;      // first time reader.read() returned bytes
  let firstContentMs = null;   // first content delta arrival
  let secondContentMs = null;  // second content delta arrival
  let doneMs = null;           // [DONE] arrival
  let totalContent = "";
  let sawDoneSentinel = false;

  // Read the stream with a per-read timeout. The streaming-proxy enqueues
  // all upstream deltas + the [DONE] sentinel; once we have seen [DONE]
  // we cancel the reader (the proxy's success path does not call
  // `controller.close()` — production Response machinery closes the
  // underlying connection — so for direct reads we cancel manually).
  const READ_TIMEOUT_MS = 3000;
  while (!sawDoneSentinel) {
    const readP = reader.read();
    const timeoutP = new Promise((resolve) =>
      setTimeout(() => resolve({ __timeout: true }), READ_TIMEOUT_MS),
    );
    const r = await Promise.race([readP, timeoutP]);
    if (r.__timeout) {
      // Should not happen — the fake provider completes in ~1.5s.
      break;
    }
    if (r.done) break;
    if (firstByteMs === null) firstByteMs = Date.now() - t0;
    for (const ev of parser.feed(r.value)) {
      const arrivalMs = Date.now() - t0;
      if (ev.done) {
        doneMs = arrivalMs;
        sawDoneSentinel = true;
        break;
      }
      const delta = extractOpenAiDelta(ev);
      events.push({ arrivalMs, ev, delta });
      if (delta && !delta.startsWith('{"__tool_calls')) {
        if (firstContentMs === null) firstContentMs = arrivalMs;
        else if (secondContentMs === null && delta) secondContentMs = arrivalMs;
        totalContent += delta;
      }
    }
  }
  // Flush trailing
  for (const ev of parser.end()) {
    if (ev.done && doneMs === null) doneMs = Date.now() - t0;
  }
  if (doneMs === null) doneMs = Date.now() - t0;

  // Release the reader — the proxy's success path doesn't close the
  // controller (production Response machinery closes the connection).
  try { await reader.cancel(); } catch { /* best-effort */ }

  // ─── Print timing log (PRD §6 style) ───────────────────────────────
  const log = [];
  log.push("[timing-log] streaming regression timings (relative to request start):");
  log.push(`  firstByteMs        = ${firstByteMs}ms`);
  log.push(`  firstContentMs     = ${firstContentMs}ms  (expected ~500ms)`);
  log.push(`  secondContentMs    = ${secondContentMs}ms  (expected ~1000ms)`);
  log.push(`  doneMs             = ${doneMs}ms  (expected ~1500-1800ms)`);
  log.push(`  totalContent       = ${JSON.stringify(totalContent)}`);
  log.push(`  eventCount         = ${events.length}`);
  log.push(`  timings.chunkCount = ${timings.chunkCount}`);
  log.push(`  timings.ttftMs     = ${timings.ttftMs ?? "<undefined>"}ms`);
  log.push(`  timings.bytes     = ${timings.bytes}`);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    log.push(`  [+${e.arrivalMs}ms] event #${i} delta=${JSON.stringify(e.delta)}`);
  }
  const logStr = log.join("\n");

  // ─── ASSERT timing (PRD §182) ─────────────────────────────────────
  assert.ok(
    firstByteMs !== null,
    "stream produced no bytes — `streamChat` did not forward anything\n" + logStr,
  );
  assert.ok(
    firstByteMs < 1500,
    `first byte arrived at ${firstByteMs}ms — proxy buffered until upstream completion (PRD §137 violation)\n${logStr}`,
  );
  assert.ok(
    firstContentMs !== null && firstContentMs < FIRST_CONTENT_MAX_MS,
    `first content chunk "Hello" arrived at ${firstContentMs}ms — expected < ${FIRST_CONTENT_MAX_MS}ms (would be ~1500ms on the old re-pacer)\n${logStr}`,
  );
  assert.ok(
    secondContentMs !== null &&
      secondContentMs - firstContentMs > INTER_CHUNK_MIN_MS,
    `second content chunk arrived ${secondContentMs - firstContentMs}ms after the first — expected > ${INTER_CHUNK_MIN_MS}ms (proves incremental, not all-at-once)\n${logStr}`,
  );
  assert.ok(
    doneMs < DONE_MAX_MS,
    `[DONE] arrived at ${doneMs}ms — expected < ${DONE_MAX_MS}ms\n${logStr}`,
  );

  // ─── ASSERT content (PRD §137, §238) ──────────────────────────────
  assert.equal(
    totalContent,
    "Hello world!",
    `concatenated content must equal "Hello world!" — got ${JSON.stringify(totalContent)}\n${logStr}`,
  );

  // ─── ASSERT timings (PRD §6, §130) ────────────────────────────────
  assert.ok(
    timings.chunkCount >= 3,
    `timings.chunkCount must be >= 3 (observed ${timings.chunkCount}) — proxy must record every upstream delta\n${logStr}`,
  );
  assert.ok(
    timings.ttftMs !== undefined && timings.ttftMs < TTFT_MAX_MS,
    `timings.ttftMs must be < ${TTFT_MAX_MS}ms (observed ${timings.ttftMs}) — TTFT must reflect genuine incremental forwarding\n${logStr}`,
  );

  // Print the timing log so the runner captures it (PRD §6 — timing log
  // must surface when the test runs).
  console.log(logStr);

  return { logStr, totalContent, firstContentMs, secondContentMs, doneMs, timings };
}

// Allow direct invocation: `node tests/streaming-regression.test.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("streaming-regression.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("streaming-regression.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
