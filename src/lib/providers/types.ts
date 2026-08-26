/** Shared provider interface + types. */

import type { GatewayModel } from "./registry";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderCompletionRequest {
  model: GatewayModel;
  messages: ProviderMessage[];
  signal?: AbortSignal;
  /** Optional auth token (e.g., LMArena session token from /settings). */
  authToken?: string;
  /** Optional tools for function calling (passed through to providers that support it). */
  tools?: ProviderTool[];
  /** Optional tool choice: "auto" | "none" | "required" */
  toolChoice?: string;
  /** Sampling params (audit E1) — forwarded from the OpenAI-shaped request
   * body to OpenAI-compatible upstreams. Non-OpenAI providers silently
   * ignore them. */
  temperature?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  topP?: number;
  stop?: string | string[];
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  n?: number;
  streamOptions?: { include_usage?: boolean };
}

export interface ProviderCompletionResult {
  text: string;
}

/**
 * A provider can:
 *   - complete(): return the full text in one shot
 *   - stream(): yield incremental text deltas as they arrive from upstream
 *
 * Providers that natively stream (auroraai, etc) yield genuine upstream tokens.
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
