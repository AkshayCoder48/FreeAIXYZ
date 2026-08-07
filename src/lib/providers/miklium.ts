/**
 * Miklium provider — free, no-auth chatbot on Vercel.
 *
 * Endpoint: POST https://miklium.vercel.app/api/chatbot
 * Body: { message: string, model?: string }
 * Response: { success: boolean, response: string }
 *
 * 5 models: miklium, personalityless, male, female, all
 * No streaming (non-streaming only).
 *
 * Credit: Miklium (https://miklium.vercel.app)
 */

import type { Provider, ProviderCompletionRequest } from "./types";

const ENDPOINT = "https://miklium.vercel.app/api/chatbot";

export const mikliumProvider: Provider = {
  id: "miklium",

  async complete(req) {
    const lastUserMsg = [...req.messages].reverse().find((m) => m.role === "user");
    const message = lastUserMsg?.content || "Hello";

    const payload: Record<string, unknown> = {
      message,
      model: req.model.upstream || "miklium",
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Miklium returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as { success?: boolean; response?: string };
    if (!data.success || !data.response) {
      throw new Error("Miklium returned no response");
    }
    return { text: data.response };
  },

  async *stream(req) {
    const result = await this.complete(req);
    yield result.text;
  },
};
