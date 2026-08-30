/**
 * Deterministic fake slow provider (PRD §130, §182, §183, §231).
 *
 * Emits 3 SSE content deltas at DETERMINISTIC wall-clock times so the
 * streaming-regression test can assert that `streamChat()` forwards
 * each delta to the client IMMEDIATELY (not buffered until upstream
 * completion — the bug PRD §238 / §137 calls out).
 *
 *   +0ms     generator returned
 *   +500ms   yields "Hello"
 *   +1000ms  yields " world"
 *   +1500ms  yields "!"
 *   +1500ms  generator returns (done)
 *
 * `complete()` returns `{ text: "Hello world!" }` after 1500ms.
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
      return { text: "Hello world!" };
    },

    /**
     * Streaming completion — yields 3 deltas at deterministic times.
     * Genuine streaming: each `yield` is gated on a `sleep(500)` so the
     * caller can observe incremental arrival (PRD §10, §137).
     */
    async *stream(req) {
      await sleep(STEP_MS);
      yield "Hello";
      await sleep(STEP_MS);
      yield " world";
      await sleep(STEP_MS);
      yield "!";
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
