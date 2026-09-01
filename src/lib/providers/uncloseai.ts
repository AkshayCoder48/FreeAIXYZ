/**
 * UncloseAI provider — free, no-auth, OpenAI-compatible API.
 *
 * Endpoint: POST https://hermes.ai.unturf.com/v1/chat/completions
 *
 * Live-verified (Task 7 discovery): pure OpenAI SSE shape, no API key, no
 * signup, no cookies, no signing. Returns standard
 * `data: {"choices":[{"delta":{"content":"..."}}]}` frames + `[DONE]`.
 *
 * Single community-hosted GPU serving `Lorbus/Qwen3.6-27B-int4-AutoRound`
 * (an int4-quantized Qwen 3.6 27B). Slow (2–40s TTFB) but uncensored and
 * genuinely free with no strings attached.
 *
 * Credit: UncloseAI / Hermes (https://hermes.ai.unturf.com)
 * Discovered via: https://uncloseai.com (free AI services directory)
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { assertToolsForwarded } from "@/lib/tools/forwarding";

const ENDPOINT = "https://hermes.ai.unturf.com/v1/chat/completions";

interface UncloseAiDelta {
  choices?: {
    delta?: {
      content?: string;
      reasoning?: string;
      role?: string;
      /** Native tool-call deltas (Tool PRD §10) — accumulated upstream. */
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as UncloseAiDelta;
    // Surface inline stream errors so the caller can throw.
    if (json.error?.message) {
      throw new Error(`UncloseAI stream error: ${json.error.message}`);
    }
    const delta = json?.choices?.[0]?.delta;
    if (!delta) return null;
    // Tool PRD §10 — NEVER parse only `content` from SSE chunks. Upstream
    // tool-call deltas (id/name/argument fragments) are converted into the
    // `__tool_calls` marker string; the gateway ToolCallNormalizer accumulates
    // them into proper OpenAI-shaped `delta.tool_calls` chunks downstream.
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      const formatted = delta.tool_calls.map((tc) => ({
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
      return JSON.stringify({ __tool_calls: formatted });
    }
    // Standard content delta.
    if (typeof delta.content === "string" && delta.content) return delta.content;
    // Qwen-family models sometimes emit chain-of-thought in `reasoning`.
    // Yield it so the stream stays alive during long thinking phases
    // (same fix as kilocode.ts / llm7.ts — prevents empty_upstream_response).
    if (typeof delta.reasoning === "string" && delta.reasoning) {
      return delta.reasoning;
    }
    return null;
  } catch (err) {
    // Re-throw UncloseAI stream errors so the caller can surface them.
    if (err instanceof Error && err.message.startsWith("UncloseAI stream error:")) {
      throw err;
    }
    return null;
  }
}

export const uncloseAiProvider: Provider = {
  id: "uncloseai",

  async complete(req) {
    // Buffer the stream for non-streaming requests.
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const payload: Record<string, unknown> = {
      model: req.model.upstream,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    };
    // Forward OpenAI sampling params (audit E1) — UncloseAI speaks the
    // full OpenAI chat-completions contract.
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.topP !== undefined) payload.top_p = req.topP;
    if (req.stop !== undefined) payload.stop = req.stop;
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.presencePenalty !== undefined) payload.presence_penalty = req.presencePenalty;
    if (req.frequencyPenalty !== undefined) payload.frequency_penalty = req.frequencyPenalty;
    if (req.n !== undefined) payload.n = req.n;
    // Tools pass through natively (OpenAI-compatible endpoint).
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
      payload.tool_choice = req.toolChoice ?? "auto";
    }
    if (req.parallelToolCalls !== undefined) {
      payload.parallel_tool_calls = req.parallelToolCalls;
    }
    // Tool PRD §20 — prove tools survived into the provider payload.
    assertToolsForwarded(payload, req.tools, "uncloseai", req.model.upstream);

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `UncloseAI returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseSseLine(line);
          if (delta) yield delta;
        }
      }
      const delta = parseSseLine(buffer);
      if (delta) yield delta;
    } finally {
      reader.releaseLock();
    }
  },
};
