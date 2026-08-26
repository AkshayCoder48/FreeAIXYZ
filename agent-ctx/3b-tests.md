# Task 3-b — Tests (Phase 3b)

**Agent:** full-stack-developer (tests)
**Scope:** Create the Phase 3b test suite — 7 `*.test.mjs` files + a deterministic fake slow provider + a tiny test runner (no test framework dependency). The KEY regression test proves `streamChat()` forwards every upstream delta IMMEDIATELY (not buffered then re-paced) by asserting wall-clock arrival times of SSE chunks.

## Files created

| File | Purpose | PRD refs |
|---|---|---|
| `tests/fake-slow-provider.mjs` | Deterministic provider emitting "Hello"/" world"/"!" at +500/+1000/+1500ms | §130, §182, §183, §231 |
| `tests/streaming-regression.test.mjs` | **THE KEY TEST** — timing assertions prove streaming is fixed | §130, §131, §182, §183, §231, §238 |
| `tests/sse-parser.test.mjs` | 18 SSE parser cases (split chunks, UTF-8 split, CRLF, [DONE], comments, etc.) | §17-20, §128 |
| `tests/ids.test.mjs` | canonicalModelId round-trip + duplicate-provider distinction (`po` vs `pi`) | §25, §99, §168 |
| `tests/errors.test.mjs` | Error taxonomy: 403→PROVIDER_UNAVAILABLE/NOT-retried (the PRD §207 bug) | §63, §147, §148 |
| `tests/redact.test.mjs` | Header/body redaction + outbound sanitization | §126, §209, §210, §40 |
| `tests/freegpt-403.test.mjs` | 403 → PROVIDER_UNAVAILABLE SSE error event + no retry + recordModelFailure spy | §207, §236 |
| `tests/discovery.test.mjs` | Failure isolation + per-task timeout + dedup + duplicate-provider distinction | §132, §169, §205, §235 |
| `tests/run-tests.mjs` | Tiny test runner — no framework dep (PRD §151), summary table (PRD §76) | §75, §76, §151 |

## Files modified

| File | Change | PRD refs |
|---|---|---|
| `package.json` | Added `"test": "bun tests/run-tests.mjs"` + `"test:streaming": "node test-streaming.mjs"`. All other scripts untouched. | §75 |

## Test runner

```bash
cd /home/z/my-project/freeaixyz
bun run test                 # run all 7 tests
bun run test streaming       # filter by substring (runs streaming-regression only)
bun run test:streaming       # the existing playwright E2E (test-streaming.mjs)
```

## Pass/fail counts

```
========================================================================
Test Summary
========================================================================
TEST                  RESULT  DURATION
----------------------------------------
streaming-regression  PASS    1.50s
discovery             PASS    502ms
errors                PASS    8ms
freegpt-403           PASS    4ms
ids                   PASS    0ms
redact                PASS    1ms
sse-parser            PASS    1ms
----------------------------------------
Total: 7   PASS: 7   FAIL: 0   (2.02s)
========================================================================
```

**7/7 PASS, 0 FAIL in 2.02s total.**

## KEY ASSERTION that proves streaming is fixed (PRD §130, §182, §231)

The streaming-regression test's timing log:

```
[timing-log] streaming regression timings (relative to request start):
  firstByteMs        = 502ms
  firstContentMs     = 502ms  (expected ~500ms)
  secondContentMs    = 1002ms  (expected ~1000ms)
  doneMs             = 1503ms  (expected ~1500-1800ms)
  totalContent       = "Hello world!"
  eventCount         = 4
  timings.chunkCount = 3
  timings.ttftMs     = 502ms
  timings.bytes     = 12
  [+502ms] event #0 delta="Hello"
  [+1002ms] event #1 delta=" world"
  [+1503ms] event #2 delta="!"
  [+1503ms] event #3 delta=null
```

**Why this proves the fix:**

1. **`firstContentMs = 502ms` (asserted < 1100ms)** — the "Hello" chunk arrives at ~+500ms, NOT at ~+1500ms. On the OLD `streamText()` re-pacer (the bug PRD §238/§137 calls out), ALL upstream deltas were buffered into `fullText` BEFORE any SSE chunk was emitted — the first client chunk would arrive at ~+1500ms (after upstream completion). This assertion WOULD FAIL on the legacy code.

2. **`secondContentMs = 1002ms` (asserted > 200ms gap from first)** — the " world" chunk arrives 500ms after "Hello", proving deltas are forwarded INCREMENTALLY as they arrive, not all-at-once at the end.

3. **`doneMs = 1503ms` (asserted < 2500ms)** — the [DONE] sentinel arrives shortly after the upstream completes (~+1500ms), not delayed by re-pacing.

4. **`totalContent = "Hello world!"`** — content order preserved, no deltas lost.

5. **`timings.chunkCount = 3` (asserted >= 3)** — the proxy's StreamTimings correctly records every upstream delta (one entry per yield from the generator).

6. **`timings.ttftMs = 502ms` (asserted < 1100ms)** — Time-To-First-Token reflects genuine incremental forwarding, not the upstream's full completion time.

## Implementation quirks observed (not bugs, but worth noting for future phases)

1. **Streaming-proxy success path does NOT call `controller.close()` after enqueuing `[DONE]`.** The error path correctly calls `controller.close()` after `sseErrorEvent()`, but the success path only enqueues the stop chunk + `[DONE]` and returns. In production, Next.js's HTTP response machinery closes the connection when the source returns, so the client sees the stream end naturally. But for DIRECT reads (like the test), `reader.read()` would hang indefinitely. The streaming-regression test works around this by reading until `[DONE]` is seen, then `reader.cancel()`. **Recommendation for Phase 4+ if direct stream inspection is needed:** add `controller.close()` at the end of `enqueueFinal()`.

2. **Streaming-proxy error path does NOT emit a `data: [DONE]` sentinel.** Only `enqueueFinal` (success path) emits `[DONE]`. The error path emits only `sseErrorEvent(err)` + `controller.close()`. The freegpt-403 test asserts the stream CLOSES (reader.read() returns done=true) rather than asserting `[DONE]` is emitted, which matches the actual behavior.

3. **`providerHealthService` uses `console.warn` (not `console.error`) for failure logging.** The test runner originally captured only `console.log`/`console.error` and missed the warn output; updated to capture all three for clean summary output.

## Lint status

`bun run lint`: 5 errors — ALL in pre-existing files owned by Phase 2a/2b (documented in their work logs):
- `src/app/api/v1/chat/freeaixyz-proxy/route.ts` (require import)
- `src/lib/freegpt-signer.cjs` (require imports)
- `src/lib/freegpt-wasm.js` (require imports)

**My files (tests/*.mjs + package.json): ZERO lint errors.**

## Determinism (PRD §183)

All 7 tests are fully deterministic — no real network calls:
- The fake slow provider uses `setTimeout` only.
- The freegpt-403 test uses a mock provider that throws `classifyUpstreamStatus(403, ...)` without hitting freegpt.tech.
- The discovery test uses mock discoverers with controlled sleep durations + a hung task that times out at 500ms.
- The sse-parser/ids/errors/redact tests use only in-memory data structures.
- All timing assertions have generous slack (e.g., `< 1100ms` instead of exactly `500ms`) to handle CI jitter.
