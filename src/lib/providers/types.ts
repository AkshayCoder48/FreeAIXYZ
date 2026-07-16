/** Shared provider interface + types. */

import type { GatewayModel } from "./registry";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderCompletionRequest {
  model: GatewayModel;
  messages: ProviderMessage[];
  signal?: AbortSignal;
  /** Optional auth token (e.g., LMArena session token from /settings). */
  authToken?: string;
}

export interface ProviderCompletionResult {
  text: string;
}

/**
 * A provider can:
 *   - complete(): return the full text in one shot
 *   - stream(): yield incremental text deltas as they arrive from upstream
 *
 * Providers that natively stream (nsfwlover) yield genuine upstream tokens.
 * Providers that don't (toolbaz) yield the full text once — the gateway layer
 * re-paces it for the client.
 */
export interface Provider {
  readonly id: GatewayModel["provider"];

  /** Non-streaming completion. Returns the full text. */
  complete(req: ProviderCompletionRequest): Promise<ProviderCompletionResult>;

  /**
   * Streaming completion. Yields incremental text chunks as an async generator.
   * The final yielded value, concatenated, equals the full completion.
   */
  stream(req: ProviderCompletionRequest): AsyncGenerator<string, void, unknown>;
}
