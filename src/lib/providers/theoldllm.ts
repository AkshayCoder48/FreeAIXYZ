/**
 * TheOldLLM provider.
 *
 * TheOldLLM is behind a Vercel Security Checkpoint (WASM PoW + Cloudflare
 * Turnstile) that requires a real browser to solve. In sandboxed server
 * environments where headless browsers can't run, this provider returns a
 * clear, graceful error so other models are completely unaffected.
 *
 * The models remain in the registry (visible in /models and the playground)
 * so users can see what's available. When the gateway runs in an environment
 * that supports headless browsers, the solver can be activated.
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const UNAVAILABLE_MESSAGE =
  "TheOldLLM models require a browser-based Vercel challenge solver that can't run in this environment. " +
  "Other models still work — try gpt-5.4-mini, nsfw-lustre-reasoning, kimi-k2, or grok-4-fast.";

export const theOldLlmProvider: Provider = {
  id: "theoldllm",

  async complete(_req: ProviderCompletionRequest) {
    throw new Error(UNAVAILABLE_MESSAGE);
  },

  async *stream(_req: ProviderCompletionRequest) {
    throw new Error(UNAVAILABLE_MESSAGE);
    yield ""; // unreachable, satisfies generator type
  },
};
