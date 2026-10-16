/**
 * Deterministic fake slow provider (PRD §130, §182, §183, §231).
 *
 * Emits 3 SSE content deltas at DETERMINISTIC wall-clock times so the
 * streaming-regression test can assert that `streamChat()` forwards
 * each delta to the client IMMEDIATELY (not buffered until upstream
 * completion — the bug PRD §238 / §137 calls out).
 *
 *   +0ms     generator returned
 *   +500ms   yields DELTA_1
 *   +1000ms  yields DELTA_2
 *   +1500ms  yields DELTA_3
 *   +1500ms  generator returns (done)
 *
 * G4 note: the streaming proxy now routes delta.content through the
 * VisibleContentSanitizer, which holds back the last 64 chars of the
 * cleaned buffer (so machinery markers split across deltas are caught
 * whole). Each delta here is deliberately sized 65–96 chars: above the
 * 64-char hold-back (so content is still released INCREMENTALLY per delta,
 * keeping the test's incremental-forwarding proof meaningful) but at or
 * below delta-pacing's 96-char split threshold (paced 40-char pieces come
 * 70ms apart, which would defeat the >200ms inter-chunk gap assertion).
 * (The old "Hello"/" world"/"!" deltas summed to 12 chars and would be
 * held back entirely until finish().)
 *
 * `complete()` returns `{ text: FULL_TEXT }` after 1500ms.
 * `discoverModels()` returns a single DiscoveredModel.
 *
 * This provider is ONLY used by tests — it is NEVER registered with the
 * real gateway `providerRegistry` (PRD §231 — deterministic, no network).
 */

const PROVIDER_ID = "fake";
const SHORT_ID = "fk";
const PROVIDER_NAME = "FakeSlow";
const UPSTREAM_ID = "test-model";
const MODEL_ID = "fake/test-model";

const STEP_MS = 500; // 500ms per delta

// Plain prose, 65–96 chars each (see G4 note above), no transcript labels
// or tool machinery, so the sanitizer passes them through unchanged and
// releases content per delta.
const DELTA_1 =
  "Hello from the fake slow provider: this first delta clears the hold-back window.";
const DELTA_2 =
  " Second delta arrives five hundred milliseconds later and is forwarded immediately.";
const DELTA_3 =
  " Third and final delta closes the upstream stream; the held tail flushes at the end.";

export const FAKE_STREAM_DELTAS = [DELTA_1, DELTA_2, DELTA_3];
export const FAKE_FULL_TEXT = DELTA_1 + DELTA_2 + DELTA_3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a fresh fake slow provider. Returns a plain object that
 * structurally satisfies the `ProviderAdapter` interface
 * (gateway/types.ts).
 */
export function createFakeSlowProvider() {
  return {
    id: PROVIDER_ID,
    shortId: SHORT_ID,
    name: PROVIDER_NAME,
    discoveryMode: "dynamic",

    /** Non-streaming completion — accumulates the same deltas then returns. */
    async complete(req) {
      await sleep(STEP_MS * 3);
      return { text: FAKE_FULL_TEXT };
    },

    /**
     * Streaming completion — yields 3 deltas at deterministic times.
     * Genuine streaming: each `yield` is gated on a `sleep(500)` so the
     * caller can observe incremental arrival (PRD §10, §137).
     */
    async *stream(req) {
      await sleep(STEP_MS);
      yield DELTA_1;
      await sleep(STEP_MS);
      yield DELTA_2;
      await sleep(STEP_MS);
      yield DELTA_3;
      // generator returns (done=true) here
    },

    /** Returns one DiscoveredModel describing the test model. */
    async discoverModels() {
      const now = new Date().toISOString();
      return [
        {
          id: MODEL_ID,
          providerId: PROVIDER_ID,
          providerName: PROVIDER_NAME,
          upstreamId: UPSTREAM_ID,
          name: UPSTREAM_ID,
          capabilities: {
            text: true,
            image: false,
            imageEdit: false,
            audioInput: false,
            audioOutput: false,
            vision: false,
            tools: false,
            streaming: true,
          },
          metadata: { source: "fake-slow-provider" },
          discoveredAt: now,
          status: "active",
          discoveryMode: "dynamic",
          discoveredFrom: "test://fake-slow-provider",
        },
      ];
    },

    /** No-op health check (always healthy). */
    async healthCheck() {
      return {
        status: "healthy",
        providerId: PROVIDER_ID,
        lastChecked: new Date().toISOString(),
        latencyMs: 0,
      };
    },
  };
}

export const FAKE_PROVIDER_ID = PROVIDER_ID;
export const FAKE_MODEL_ID = MODEL_ID;
export const FAKE_UPSTREAM_ID = UPSTREAM_ID;
