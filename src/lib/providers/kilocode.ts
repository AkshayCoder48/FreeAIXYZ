/**
 * Kilo Code provider (api.kilo.ai).
 *
 * Free, no-auth, OpenAI-compatible API with 10 free models and real SSE
 * streaming. The free tier routes through OpenRouter's free model pool.
 *
 * Endpoint: POST https://api.kilo.ai/api/gateway/chat/completions
 * Models:   GET  https://api.kilo.ai/api/gateway/models
 *
 * Response: standard OpenAI SSE with `: OPENROUTER PROCESSING` keep-alive
 * comments before the first token.
 */

import type { Provider, ProviderCompletionRequest } from "./types";
import { assertToolsForwarded } from "@/lib/tools/forwarding";

const ENDPOINT = "https://api.kilo.ai/api/gateway/chat/completions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const choice = json?.choices?.[0];
    if (!choice) return null;
    // Handle content deltas
    const content = choice.delta?.content;
    if (typeof content === "string" && content) return content;
    // Handle tool_calls deltas — convert to text that the gateway can parse
    const toolCalls = choice.delta?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const formatted = toolCalls.map((tc: { function?: { name?: string; arguments?: string } }) => ({
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "",
      }));
      return JSON.stringify({ __tool_calls: formatted });
    }
    // Task 4 fix (v4): yield delta.reasoning as content. Kilo Code (via
    // OpenRouter) emits the model's chain-of-thought in `delta.reasoning`
    // BEFORE the final answer arrives in `delta.content`. The reasoning
    // phase can last 5-44s (run #22: 986 reasoning deltas over 43.8s before
    // the first content delta — within 16s of Vercel's 60s maxDuration).
    //
    // Before this fix, parseSseLine returned null for reasoning deltas →
    // the adapter's stream() generator yielded NOTHING for the entire
    // reasoning phase → the gateway's pre-flight (which awaits the first
    // yielded chunk) timed out OR the upstream closed mid-reasoning →
    // 502 empty_upstream_response (44/252 errors in the v3 load test).
    //
    // Yielding reasoning content makes the adapter produce output during
    // the reasoning phase → pre-flight succeeds within ~2s TTFB → the
    // 200 OK stream opens immediately → no timeout, no empty_response.
    // The reasoning text is honest model output; clients see the model
    // "thinking" before the answer (verbose but correct).
    const reasoning = choice.delta?.reasoning;
    if (typeof reasoning === "string" && reasoning) return reasoning;
    return null;
  } catch {
    return null;
  }
}

/** Fetch with retry on rate limit. */
async function fetchWithRetry(
  payload: unknown,
  signal?: AbortSignal,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (res.status === 429) {
      if (attempt < maxRetries) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Kilo Code returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    return res;
  }
  throw new Error("Kilo Code: retry attempts exhausted.");
}

export const kiloCodeProvider: Provider = {
  id: "kilocode",

  async complete(req) {
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
    // Forward OpenAI sampling params (audit E1).
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.topP !== undefined) payload.top_p = req.topP;
    if (req.stop !== undefined) payload.stop = req.stop;
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.presencePenalty !== undefined) payload.presence_penalty = req.presencePenalty;
    if (req.frequencyPenalty !== undefined) payload.frequency_penalty = req.frequencyPenalty;
    if (req.n !== undefined) payload.n = req.n;
    // Pass tools natively if provided (KiloCode/OpenRouter supports OpenAI tool calling)
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
      payload.tool_choice = req.toolChoice ?? "auto";
    }
    if (req.parallelToolCalls !== undefined) {
      payload.parallel_tool_calls = req.parallelToolCalls;
    }
    // Tool PRD §20 — prove tools survived into the provider payload.
    assertToolsForwarded(payload, req.tools, "kilocode", req.model.upstream);

    const res = await fetchWithRetry(payload, req.signal);
    if (!res.body) {
      throw new Error("Kilo Code: no response body.");
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
