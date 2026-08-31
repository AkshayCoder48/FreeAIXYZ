/**
 * Delisted models (PRD §42 + 10x reliability sweep, 2026-08-26).
 *
 * These are individual model ids that the 10x test harness
 * (`scripts/test-models-10x.mjs`) confirmed are 10/10 broken upstream.
 * They're marked `status: "offline"` so /api/v1/models filters them out
 * of the default listing — they reappear with `?all=true` for debugging.
 *
 * Distinct from `DELISTED_PROVIDERS` (which delists an entire provider
 * because the integration is broken — e.g. freegpt). The set below is
 * per-model: the provider itself is healthy, just this specific upstream
 * id is broken (404, auth-required, 500, empty response, etc.).
 *
 * Re-test a model by removing it from this set and re-running the
 * `scripts/test-models-10x.mjs` harness against it. The sync engine will
 * re-include it on the next refresh.
 *
 * Last updated: 2026-08-26 by 10x test sweep (1150 requests, 115 models).
 */
export const DELISTED_MODELS: ReadonlySet<string> = new Set<string>([
  // ─── gptoss / toolbaz gpt-oss-20b — upstream model name not recognized ────
  "go/gpt-oss-20b",
  "tb/gpt-oss-20b",

  // ─── kilocode — upstream 404 / empty response on kc/poolside + inclusionai
  "kc/inclusionai/ling-3.0-flash:free",
  "kc/nvidia/nemotron-3.5-content-safety:free",
  "kc/poolside/laguna-m.1:free",
  "kc/poolside/laguna-xs-2.1:free",

  // ─── llm7 — auth required (HTTP 401) for Inkling family + others ────────
  // The LLM7.io BASIC tier requires a logged-in account for these models.
  "l7/DeepSeek-V4-Flash-0731",
  "l7/Inkling",
  "l7/Inkling-Small",
  "l7/L3-8B-Lunaris-v1-Turbo",
  "l7/XiaomiMiMo/MiMo-V2.5",
  "l7/XiaomiMiMo/MiMo-V2.5-Pro",
  "l7/chroma-v.46-flash",
  "l7/gpt-oss",
  "l7/gpt-oss:20b",

  // ─── opencode — auth required (HTTP 401) for ling/muse family + others ───
  "oc/deepseek-v4-flash-free",
  "oc/ling-3.0-flash-free",
  "oc/ling-3.0-tiny-free",
  "oc/longcat-2.0-free",
  "oc/muse-spark-1.2-contributor-free",
  "oc/nemotron-3.5-lightning-free",

  // ─── swarm — Qwen gguf models all return HTTP 500 / empty upstream ───────
  "sm/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
  "sm/Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf",
  "sm/Qwen3.6-35B-A3B-UD-IQ3_S.gguf",
  "sm/Qwen3.6-35B-A3B-UD-IQ4_XS.gguf",
  "sm/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf",
  "sm/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf",
  "sm/qwen3.5-2b.Q4_K_M.gguf",

  // ─── spicywriter — BALANCED tier requires BASIC account login (not anon)
  //   Only LITE-tier models are genuinely free for anonymous users.
  //   The BALANCED ones were misclassified as free and return HTTP 500.
  "sw/DeepSeek V4 Flash",
  "sw/DeepSeek v3.2",
  "sw/GLM 4.7 Flash",
  "sw/Gemma 4 31B T", // LITE but upstream returns empty response
  "sw/Grok 4 Fast",
  "sw/Grok 4.1 Fast",
  "sw/Hy3",
  "sw/Ling 2.6 Flash", // LITE but upstream returns empty response
  "sw/MiMo V2 Flash",
  "sw/MiMo V2.5",
  "sw/Ox Alpha", // LITE but upstream returns empty response
  "sw/Step 3.5 Flash",

  // ─── vexa — gpt-4.1-nano not routable upstream ───────────────────────────
  "vx/gpt-4.1-nano",
]);

/** True if a canonical model id is on the delisted list. */
export function isDelistedModel(publicId: string): boolean {
  return DELISTED_MODELS.has(publicId);
}
