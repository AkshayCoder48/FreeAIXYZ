/**
 * Toolbaz provider adapter.
 *
 * Wraps the existing `complete()` from src/lib/toolbaz.ts to satisfy the
 * Provider interface. Toolbaz returns the full text in a single HTTP chunk
 * (no real streaming), so `stream()` yields the whole text once and the
 * gateway layer re-paces it for clients.
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
