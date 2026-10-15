/**
 * GENERIC gateway-level auto-continuation ("never stop until the upstream
 * truly stops").
 *
 * Problem: several upstream providers hard-cap completion tokens or drop the
 * SSE connection mid-generation. The provider adapters yield their deltas and
 * end, and the client receives a reply that is visibly cut mid-code (unclosed
 * ``` fence, unbalanced braces, half a line). Users experience this as "the
 * AI stops whenever it wants".
 *
 * The nsfwgf provider has its own provider-level continuation (its upstream
 * caps at ~300 tokens with a finish_reason signal). This module generalizes
 * the SAME strategy to EVERY provider at the gateway layer:
 *
 *   1. Run the adapter's stream and forward every delta LIVE.
 *   2. When the adapter ends, check the accumulated text with structural
 *      completeness heuristics (`looksIncomplete` — unclosed code fence,
 *      unbalanced brackets inside code).
 *   3. If the text looks incomplete, transparently issue a continuation
 *      request through the SAME adapter (original messages + the partial
 *      assistant text + a tail-anchored "continue EXACTLY after …"
 *      instruction) and keep streaming LIVE.
 *   4. Repeat until the text looks complete, the model replies DONE, an
 *      empty continuation comes back, or the round cap is hit.
 *
 * Seam handling is shared with the nsfwgf implementation: the first
 * OVERLAP_WINDOW chars of each continuation round are held back so (a) a
 * "DONE" reply can be swallowed and (b) any re-emitted overlap of the cut-off
 * tail can be trimmed exactly once.
 *
 * Failure policy: a continuation round that errors BEFORE yielding anything
 * is retried once; a round that fails after already streaming content (or a
 * round that exhausts its retry) ENDS THE STREAM GRACEFULLY — the client
 * keeps the (long) coherent text it already received; we never error a
 * stream that already delivered content.
 */

import {
  continueInstruction,
  looksIncomplete,
  overlapTrimLen,
  OVERLAP_WINDOW,
} from "@/lib/gateway/completeness";
import type { ChatRequest, ProviderAdapter } from "@/lib/gateway/types";
import { sleep } from "@/lib/gateway/retry";

/** Max continuation rounds for the GENERIC layer (nsfwgf does its own, richer
 *  version internally; this cap bounds worst-case latency for everyone). */
export const MAX_GENERIC_CONTINUATION_ROUNDS = 8;
/** Hard budget on total accumulated chars the generic layer will continue up
 *  to. Story/roleplay models asked to "continue" will keep writing new scenes
 *  indefinitely — this backstop guarantees the stream always terminates. */
const MAX_GENERIC_CONTINUATION_CHARS = 16_000;
/** Retries per continuation round before giving up gracefully. */
const ROUND_RETRIES = 1;
/** The model's confirmation that the text was already complete. */
const DONE_MARKER_RE = /^DONE\b/i;
/** Diagnostic tag written to dev.log (grep [AUTO-CONT]). */
const TAG = "[AUTO-CONT]";

function buildContReq(req: ChatRequest, accumulated: string): ChatRequest {
  return {
    ...req,
    messages: [
      ...req.messages,
      { role: "assistant", content: accumulated },
      { role: "user", content: continueInstruction(accumulated) },
    ],
  };
}

/** How one continuation round ended. */
type RoundOutcome =
  | { kind: "continue"; text: string } // streamed content — maybe more to come
  | { kind: "done" } // DONE marker or empty continuation — natural end
  | { kind: "failed" }; // error after retries / after partial output — end gracefully

/**
 * ONE continuation round as a LIVE async generator: yields client-visible
 * deltas as they arrive (after hold-back + one-time overlap trim), returns
 * the round outcome.
 */
async function* continuationRound(
  adapter: ProviderAdapter,
  req: ChatRequest,
  accumulated: string,
): AsyncGenerator<string, RoundOutcome, unknown> {
  const contReq = buildContReq(req, accumulated);
  let yielded = "";

  for (let attempt = 0; attempt <= ROUND_RETRIES; attempt++) {
    let gen: AsyncGenerator<string, void, unknown> | null = null;
    let holding = true;
    let pending = "";
    try {
      gen = adapter.stream(contReq);
      while (true) {
        const n = await gen.next();
        if (n.done) break;
        const delta = n.value;
        if (!delta) continue;
        if (holding) {
          pending += delta;
          if (DONE_MARKER_RE.test(pending.trimStart())) {
            console.error(`${TAG} model replied DONE — natural end`);
            return { kind: "done" };
          }
          if (pending.length >= OVERLAP_WINDOW) {
            const trim = overlapTrimLen(accumulated, pending);
            const out = pending.slice(trim);
            if (out) {
              yielded += out;
              yield out;
            }
            holding = false;
            pending = "";
          }
        } else {
          yielded += delta;
          yield delta;
        }
      }
      // Flush a still-held short tail.
      if (holding && pending) {
        if (DONE_MARKER_RE.test(pending.trimStart())) {
          console.error(`${TAG} model replied DONE (short round) — natural end`);
          return { kind: "done" };
        }
        const trim = overlapTrimLen(accumulated, pending);
        const out = pending.slice(trim);
        if (out) {
          yielded += out;
          yield out;
        }
      }
      if (!yielded.trim()) {
        console.error(`${TAG} empty continuation — natural end`);
        return { kind: "done" };
      }
      return { kind: "continue", text: yielded };
    } catch (err) {
      try { if (gen) await gen.return(undefined); } catch { /* best-effort */ }
      console.error(
        `${TAG} continuation round FAILED (attempt ${attempt + 1}${
          yielded ? `, after +${yielded.length} chars already streamed` : ""
        }): ${err instanceof Error ? err.message : String(err)}`,
      );
      // Only retry when NOTHING was streamed yet (a retry after partial
      // output would duplicate content).
      if (yielded === "" && attempt < ROUND_RETRIES) {
        await sleep(600);
        continue;
      }
      return { kind: yielded ? "continue" : "failed", text: yielded };
    }
  }
  return { kind: "failed" };
}

/**
 * Wrap an adapter stream so the generation continues automatically while the
 * accumulated text looks structurally incomplete. Passthrough-safe: when the
 * text looks complete (the overwhelmingly common case) the wrapper adds ZERO
 * extra requests and forwards every delta unchanged.
 */
export function wrapStreamWithAutoContinue(
  adapter: ProviderAdapter,
  req: ChatRequest,
): AsyncGenerator<string, void, unknown> {
  // Tool-carrying requests are exempt: the fence normalizer and tool-call
  // pipeline own the stream end-state; interleaving continuations could
  // corrupt tool-call parsing.
  const eligible = (req.tools?.length ?? 0) === 0;
  // Self-continuing adapters (nsfwgf) run their own continuation loop —
  // wrapping them caused DOUBLE continuation (the "unlimited generation"
  // bug: 24 provider rounds + 8 more generic rounds).
  if (adapter.selfContinuing) {
    return adapter.stream(req);
  }
  return (async function* () {
    const base = adapter.stream(req);
    let accumulated = "";
    try {
      while (true) {
        const n = await base.next();
        if (n.done) break;
        const delta = n.value;
        if (!delta) continue;
        accumulated += delta;
        yield delta;
      }
    } finally {
      try { await base.return(undefined); } catch { /* best-effort */ }
    }

    if (!eligible) return;
    if (req.signal?.aborted) return;
    if (!looksIncomplete(accumulated)) return;

    console.error(
      `${TAG} ${adapter.id}/${req.modelId}: stream ended while text looks incomplete (${accumulated.length} chars) — continuing`,
    );

    for (let round = 1; round <= MAX_GENERIC_CONTINUATION_ROUNDS; round++) {
      if (req.signal?.aborted) return;
      if (accumulated.length >= MAX_GENERIC_CONTINUATION_CHARS) {
        console.error(
          `${TAG} ${adapter.id}/${req.modelId}: total-char budget reached (${accumulated.length} chars) — ending`,
        );
        return;
      }
      const round$ = continuationRound(adapter, req, accumulated);
      let outcome: RoundOutcome | null = null;
      try {
        while (true) {
          const n = await round$.next();
          if (n.done) {
            outcome = n.value;
            break;
          }
          accumulated += n.value;
          yield n.value;
        }
      } finally {
        try { await round$.return({ kind: "failed" }); } catch { /* best-effort */ }
      }
      if (!outcome || outcome.kind === "failed") return; // graceful end
      if (outcome.kind === "done") return; // natural end
      console.error(
        `${TAG} ${adapter.id}/${req.modelId}: round ${round} +${outcome.text.length} chars (total ${accumulated.length})`,
      );
      if (!looksIncomplete(accumulated)) {
        console.error(
          `${TAG} ${adapter.id}/${req.modelId}: text now complete after round ${round}`,
        );
        return;
      }
    }
    console.error(
      `${TAG} ${adapter.id}/${req.modelId}: round cap reached — ending with ${accumulated.length} chars`,
    );
  })();
}

/**
 * Non-streaming variant: complete() + continuation rounds until the text
 * looks structurally complete. Same policies as the streaming wrapper.
 */
export async function completeWithAutoContinue(
  adapter: ProviderAdapter,
  req: ChatRequest,
): Promise<{ text: string }> {
  let text = (await adapter.complete(req)).text ?? "";
  if ((req.tools?.length ?? 0) > 0) return { text };
  if (req.signal?.aborted) return { text };
  if (adapter.selfContinuing) return { text }; // adapter already continued

  for (let round = 1; round <= MAX_GENERIC_CONTINUATION_ROUNDS; round++) {
    if (!looksIncomplete(text)) break;
    if (text.length >= MAX_GENERIC_CONTINUATION_CHARS) {
      console.error(
        `${TAG} ${adapter.id}/${req.modelId}: total-char budget reached (${text.length} chars) — stopping`,
      );
      break;
    }
    console.error(
      `${TAG} ${adapter.id}/${req.modelId}: complete() text looks incomplete (${text.length} chars) — continuing (round ${round})`,
    );
    const contReq = buildContReq(req, text);
    let cont: string | null = null;
    for (
      let attempt = 0;
      attempt <= ROUND_RETRIES && cont === null;
      attempt++
    ) {
      try {
        const res = await adapter.complete(contReq);
        cont = res.text ?? "";
      } catch (err) {
        console.error(
          `${TAG} continuation complete() FAILED (attempt ${attempt + 1}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        if (attempt < ROUND_RETRIES) await sleep(600);
      }
    }
    if (cont === null) break; // failed — keep what we have
    if (DONE_MARKER_RE.test(cont.trimStart())) break; // model says complete
    const trim = overlapTrimLen(text, cont);
    const out = cont.slice(trim);
    if (!out.trim()) break; // empty continuation — natural end
    text += out;
  }
  return { text };
}
