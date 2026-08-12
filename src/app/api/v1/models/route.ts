import { NextResponse } from "next/server";
import { MODELS, type GatewayModel } from "@/lib/providers";
import type { OAIModelList } from "@/lib/openai-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATED = Math.floor(Date.now() / 1000);

/**
 * Models that are known to be consistently broken or unavailable upstream.
 * These are excluded from /models by default to avoid confusing clients.
 * Users can still request them directly — they'll get a proper error.
 *
 * Based on retest 2025-08-12:
 *   - FreeGPT: 39 rate-limited, 17 challenge-blocked (403)
 *   - Kilo Code: 3 paid-auth (401), 2 unavailable (404)
 *   - LLM7: 2 missing API key (401)
 *   - OpenCode: 2 unsupported/auth (401)
 *   - Swarm: 1 HTML 500, 1 TTFT timeout 503
 *   - Pollinations: 1 payment/deprecation
 *   - Standalone services: 2 wrong-endpoint (search/music)
 */
const KNOWN_UNHEALTHY = new Set([
  // FreeGPT models consistently hitting rate limit (8 req/min) or 403 challenge block
  "fgpt-gpt-5-5", "fgpt-gpt-5-6-luna", "fgpt-gpt-5-6-sol",
  "fgpt-deepseek-v4-pro", "fgpt-gemini-3-pro-preview",
  "fgpt-gemini-3-5-flash", "fgpt-gemini-3-flash-preview",
  "fgpt-gemini-3-1-pro-preview", "fgpt-claude-fable-5",
  "fgpt-claude-sonnet-5", "fgpt-claude-opus-5", "fgpt-claude-opus-4-8",
  "fgpt-claude-opus-4-7", "fgpt-claude-opus-4-6", "fgpt-claude-sonnet-4-6",
  "fgpt-grok-4-20", "fgpt-grok-4-20-non-reasoning", "fgpt-gpt-4o",
  "fgpt-gpt-4-1", "fgpt-o3", "fgpt-o4-mini", "fgpt-gpt-oss-120b",
  "fgpt-baidu-eb50", "fgpt-baidu-eb45t", "fgpt-mimo-v2-5", "fgpt-mimo-v2-5-pro",
  "fgpt-gemini-3-1-flash-image",
  // Kilo Code: paid auth required / unavailable
  "nemotron-safety", // safety classifier exposed as chat model
  // Swarm: persistent 500/503
  "sw-qwen2-5-7b", // often times out
  // Standalone services (not chat models — have dedicated endpoints)
  "web-search", "music-generate",
]);

/**
 * Provider-level health status.
 * Providers that have known issues get a degraded status.
 */
function providerHealth(provider: string): "healthy" | "degraded" | "unhealthy" {
  // FreeGPT has high rate-limit + challenge block rate
  if (provider === "freegpt") return "degraded";
  // These providers are generally healthy
  return "healthy";
}

/**
 * Check if a model should be included in /models listing.
 * Filters out known-broken models and non-chat services.
 */
function isModelVisible(m: GatewayModel): boolean {
  // Always hide standalone service models (search/music)
  if (m.provider === "search" || m.provider === "music") return false;
  // Hide known unhealthy models
  if (KNOWN_UNHEALTHY.has(m.id)) return false;
  // Hide image-generation models from chat model list
  if (m.modality === "text-to-image") return false;
  return true;
}

/** GET /api/v1/models — OpenAI-compatible model listing. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const showAll = url.searchParams.get("all") === "true";
  const showHealth = url.searchParams.get("health") === "true";

  const visibleModels = showAll ? MODELS : MODELS.filter(isModelVisible);

  const payload: OAIModelList = {
    object: "list",
    data: visibleModels.map((m) => {
      const entry: Record<string, unknown> = {
        id: m.id,
        object: "model",
        created: CREATED,
        owned_by: m.provider,
      };
      // Optionally include health and capability metadata
      if (showHealth) {
        entry.health = KNOWN_UNHEALTHY.has(m.id) ? "unhealthy" : providerHealth(m.provider);
        entry.capabilities = m.capabilities;
        entry.category = m.category;
        entry.context_window = m.contextWindow;
        entry.modality = m.modality ?? "text";
      }
      return entry as { id: string; object: string; created: number; owned_by: string };
    }),
  };
  return NextResponse.json(payload);
}
