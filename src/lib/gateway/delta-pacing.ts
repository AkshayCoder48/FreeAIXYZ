/**
 * Delta pacing — makes every model LOOK like it streams.
 *
 * Problem: providers whose upstreams don't support SSE (capabilities
 * .streaming = false) yield the whole text as ONE delta; a few adapters
 * yield big per-round chunks. The proxy forwards honestly — but a single
 * 3,000-char delta arriving in one network frame renders as "the model
 * returned the full thing at once" in every client. Tool calls still work
 * on such streams (they're parsed after the stream ends), which is why
 * users saw "tool call works but text isn't streaming".
 *
 * Fix: wrap the adapter stream — deltas larger than SPLIT_ABOVE get sliced
 * into ~PIECE-char code-point chunks, each enqueued with a tiny gap so the
 * network layer emits separate frames and clients paint progressively.
 * Small deltas from REAL streamers pass through untouched with ZERO added
 * latency. The gap is a few ms per piece: a 3k-char blob becomes a ~1s
 * stream; pacing never exceeds the upstream's own generation time on real
 * streamers (they're already below the threshold).
 */

import { sleep } from "@/lib/gateway/retry";

/** Deltas at or below this size pass through untouched (real streamers). */
const SPLIT_ABOVE = 96;
/** Target piece size in code points. */
const PIECE = 40;
/**
 * Gap between pieces. Live-tuned: 12ms was too fast to read as streaming
 * (a 600-char blob rendered in ~100ms). 70ms → ~570 chars/s — a 600-char
 * response spreads ~1s, a 3k-char blob ~5s: visibly, comfortably streaming.
 */
const PIECE_GAP_MS = 70;

/** Split one large delta into code-point-safe pieces. */
function splitDelta(delta: string): string[] {
  // Spread iterates by CODE POINT — a piece boundary can never split a
  // surrogate pair (emoji, CJK extensions).
  const cps = Array.from(delta);
  const pieces: string[] = [];
  for (let i = 0; i < cps.length; i += PIECE) {
    pieces.push(cps.slice(i, i + PIECE).join(""));
  }
  return pieces;
}

/**
 * Wrap an async generator: oversized deltas are re-emitted as paced pieces.
 * Everything else — ordering, the return value, thrown errors — passes
 * through unchanged.
 */
export function paceLargeDeltas(
  gen: AsyncGenerator<string, void, unknown>,
): AsyncGenerator<string, void, unknown> {
  return (async function* () {
    while (true) {
      const n = await gen.next();
      if (n.done) return n.value;
      const delta = n.value;
      if (!delta) continue;
      if (delta.length <= SPLIT_ABOVE) {
        yield delta;
        continue;
      }
      const pieces = splitDelta(delta);
      for (let i = 0; i < pieces.length; i++) {
        if (i > 0) await sleep(PIECE_GAP_MS);
        yield pieces[i];
      }
    }
  })();
}
