/**
 * Toolbaz provider adapter.
 *
 * Wraps the existing `complete()` from src/lib/toolbaz.ts to satisfy the
 * Provider interface. Toolbaz's writing.php endpoint returns the full text
 * in a single HTTP response (the upstream doesn't stream tokens) — so
 * `stream()` yields the whole text once. The gateway's streaming-proxy
 * wraps this single yield into a real SSE response (data: chunks + [DONE])
 * so clients see a proper stream regardless.
 *
 * Audit G1: `capabilities.streaming` is true because the gateway DOES
 * emit a real text/event-stream response for `stream: true` requests —
 * the upstream's lack of token-level streaming is an implementation
 * detail, not a capability gap the client should care about.
 */

import { complete as toolbazComplete } from "@/lib/toolbaz";
import type { Provider, ProviderCompletionRequest } from "./types";

export const toolbazProvider: Provider = {
  id: "toolbaz",

  async complete(req) {
    const result = await toolbazComplete({
      model: req.model.upstream,
      turns: req.messages.map((m) => ({ role: m.role, text: m.content })),
      signal: req.signal,
    });
    return { text: result.text };
  },

  async *stream(req) {
    const result = await toolbazComplete({
      model: req.model.upstream,
      turns: req.messages.map((m) => ({ role: m.role, text: m.content })),
      signal: req.signal,
    });
    // Toolbaz doesn't stream — yield the full text in one go.
    yield result.text;
  },
};
