/**
 * Unified model registry.
 *
 * Multiple free upstream providers are aggregated behind a single
 * OpenAI-compatible surface. Each model declares its provider, capabilities,
 * and (for display) a description + accepted params.
 *
 * Naming convention:
 *   - Professional models (grok, gpt, claude, gemini, deepseek, llama, o3)
 *     keep their original id.
 *   - SFW-only / general models get a clean descriptive id.
 *   - NSFW / uncensored models get an explicit "nsfw-" prefix so callers know.
 *
 * Total: 89 chat/text models + 142 text-to-image models (separate registry)
 * across 16 text providers + 5 image providers.
 */

export type ProviderId =
  | "toolbaz"
  | "nsfwlover"
  | "surfsense"
  | "jollygen"
  | "unlimitedai"
  | "pollinations"
  | "kilocode"
  | "llm7"
  | "spicywriter"
  | "freegpt"
  | "g4fspace"
  | "search"
  | "music";

export interface ModelCapabilities {
  /** Returns token-by-token SSE deltas (true upstream streaming). */
  streaming: boolean;
  /** OpenAI-style function/tool calling via prompt injection. */
  tools: boolean;
  /** Accepts a system prompt. */
  systemPrompt: boolean;
  /** Multi-turn conversation history. */
  multiTurn: boolean;
  /** Image / vision inputs. */
  vision: boolean;
  /** Live web search for grounded, up-to-date answers. */
  webSearch: boolean;
}

export interface GatewayModel {
  id: string;
  provider: ProviderId;
  /** Upstream model id sent to the provider. */
  upstream: string;
  description: string;
  /** Short label for chips/badges. */
  category: "professional" | "sfw" | "nsfw" | "reasoning";
  capabilities: ModelCapabilities;
  /** Max context window (approx, in tokens). 0 = unknown. */
  contextWindow: number;
  /** Whether the model is currently reachable from this gateway. */
  experimental?: boolean;
  /** Whether the model requires an API key from the user. */
  requiresKey?: boolean;
  /** The HTTP header the gateway reads the API key from (when requiresKey=true). */
  keyHeader?: string;
  /** Modality — text models answer prompts; text-to-image models emit images. */
  modality?: "text" | "text-to-image";
  /** For text-to-image models only: visual style family. */
  imageCategory?: "anime" | "realism" | "nsfw-anime" | "nsfw-realism" | "mixed" | "general";
}

export const MODELS: readonly GatewayModel[] = [
  // ─── Toolbaz provider: professional / SFW models ──────────────────────────
  tb("toolbaz-v4.5-fast", "toolbaz-v4.5-fast", "Toolbaz v4.5 Fast — quick & balanced general model", "professional", 8000),
  tb("toolbaz_v4", "toolbaz_v4", "ToolBaz v4 — general purpose", "professional", 8000),
  tb("gpt-5", "gpt-5", "GPT-5", "professional", 128000),
  tb("gpt-5.2", "gpt-5.2", "GPT-5.2", "professional", 128000),
  tb("gpt-4o-latest", "gpt-4o-latest", "GPT-4o (latest)", "professional", 128000),
  tb("gpt-oss-120b", "gpt-oss-120b", "GPT-OSS-120B — open-weight", "professional", 32000),
  tb("o3-mini", "o3-mini", "o3-mini — reasoning model", "reasoning", 200000),
  tb("claude-sonnet-4", "claude-sonnet-4", "Claude Sonnet 4", "professional", 200000),
  tb("gemini-2.5-flash", "gemini-2.5-flash", "Gemini 2.5 Flash", "professional", 1000000),
  tb("gemini-2.5-pro", "gemini-2.5-pro", "Gemini 2.5 Pro", "professional", 2000000),
  tb("gemini-3-flash", "gemini-3-flash", "Gemini 3 Flash", "professional", 1000000),
  tb("gemini-3.1-flash-lite", "gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", "professional", 1000000),
  tb("gemini-3.5-flash", "gemini-3.5-flash", "Gemini 3.5 Flash — fast and capable, great for coding", "professional", 1000000),
  tb("gemini-3.6-flash", "gemini-3.6-flash", "Gemini 3.6 Flash — latest, excellent for coding tasks", "professional", 1000000),
  tb("codestral-latest", "codestral-latest", "Codestral — Mistral's code generation model, excellent for programming", "professional", 256000),
  tb("gpt-oss-20b", "gpt-oss-20b", "GPT-OSS 20B — lightweight open-weight model", "professional", 131072),
  tb("deepseek-r1", "deepseek-r1", "DeepSeek R1 — reasoning", "reasoning", 64000),
  tb("deepseek-v3", "deepseek-v3", "DeepSeek V3", "professional", 64000),
  tb("deepseek-v3.1", "deepseek-v3.1", "DeepSeek V3.1", "professional", 64000),
  tb("grok-4-fast", "grok-4-fast", "Grok 4 Fast", "professional", 131000),
  tb("L3-70B-Euryale-v2.1", "L3-70B-Euryale-v2.1", "L3-70B Euryale v2.1", "sfw", 8000),
  tb("midnight-rose", "midnight-rose", "Midnight Rose", "sfw", 8000),

  // ─── nsfwlover.com provider: uncensored NSFW roleplay (real streaming) ────
  nsfw("nsfw-llama3-8b", "llama3-8b", "Uncensored LLaMA-3 8B roleplay (sao10k/l3-lunaris-8b) — real token streaming, no content filters", 8000),

  // ─── SurfSense provider: free no-login, real SSE streaming ───────────────
  ss("gpt-5.4-mini", "gpt-5.4-mini-no-login", "GPT-5.4 Mini — fast, no login required, real token streaming", "professional", 128000),
  ss("gpt-o4-mini", "gpt-o4-mini-no-login", "GPT o4 Mini — reasoning model, no login required, real token streaming", "reasoning", 128000),

  // ─── JollyGen provider: unrestricted NSFW roleplay, 3-msg limit rotated ──
  jg("nsfw-jollygen", "jollygen", "Unrestricted NSFW roleplay — no content filters, fresh identity per request, real token streaming", 8000),

  // ─── UnlimitedAI.chat provider: uncensored reasoning, NDJSON streaming ───
  uai("nsfw-lustre-reasoning", "chat-model-reasoning", "Uncensored reasoning model — no content filters, real token streaming, deep thinking", "nsfw", 128000),
  uai("nsfw-lustre-search", "chat-model-reasoning-with-search", "Uncensored reasoning + web search — browses live results, no content filters", "nsfw", 128000, true),

  // ─── Pollinations.ai provider: free, no-auth, OpenAI-compatible SSE ──────
  pol("openai-fast", "openai-fast", "GPT-OSS 20B Reasoning — fast, no signup, real token streaming with reasoning", "reasoning", 128000, true),

  // ─── Kilo Code provider: 16 free models, no key, real SSE (tested OK) ───
  kc("tencent-hy3", "tencent/hy3:free", "Tencent Hy3 — large-scale Chinese/English model", "professional", 262144),
  kc("nemotron-ultra", "nvidia/nemotron-3-ultra-550b-a55b:free", "NVIDIA Nemotron 3 Ultra (550B) — flagship reasoning model", "reasoning", 1000000),
  kc("nemotron-super", "nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA Nemotron 3 Super (120B) — high-performance model", "professional", 1000000),
  kc("nemotron-nano-omni", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "NVIDIA Nemotron 3 Nano Omni (30B) — compact reasoning", "reasoning", 256000),
  kc("nemotron-safety", "nvidia/nemotron-3.5-content-safety:free", "NVIDIA Nemotron 3.5 Content Safety — moderation model", "sfw", 128000),
  kc("laguna-xs", "poolside/laguna-xs-2.1:free", "Poolside Laguna XS 2.1 — code-optimized model", "professional", 262144),
  kc("laguna-m", "poolside/laguna-m.1:free", "Poolside Laguna M.1 — balanced code model", "professional", 262144),
  kc("laguna-s", "poolside/laguna-s-2.1:free", "Poolside Laguna S 2.1 — full-size code model", "professional", 262144),
  kc("cohere-north-code", "cohere/north-mini-code:free", "Cohere North Mini Code — lightweight code model", "professional", 256000),
  kc("kilo-auto-free", "kilo-auto/free", "Kilo Auto Free — auto-routes to best available free model", "professional", 262144),
  kc("kilo-auto-frontier", "kilo-auto/frontier", "Kilo Auto Frontier — routes to most capable model", "professional", 262144),
  kc("kilo-auto-balanced", "kilo-auto/balanced", "Kilo Auto Balanced — routes to balanced quality/speed model", "professional", 262144),
  kc("kilo-auto-efficient", "kilo-auto/efficient", "Kilo Auto Efficient — routes to fastest model", "professional", 262144),
  kc("kilo-auto-small", "kilo-auto/small", "Kilo Auto Small — routes to smallest/cheapest model", "professional", 262144),
  kc("stepfun-step-37-flash", "stepfun/step-3.7-flash:free", "StepFun Step 3.7 Flash — fast multilingual model", "professional", 262144),
  kc("ling-30-flash", "inclusionai/ling-3.0-flash:free", "InclusionAI Ling 3.0 Flash — Chinese/English bilingual model", "professional", 262144),

  // ─── LLM7.io provider: free anonymous, no key (5 models verified working) ──
  l7("l7-gpt-oss-20b", "gpt-oss:20b", "GPT-OSS 20B — OpenAI open-weight model, free anonymous via LLM7", "professional", 131072),
  l7("l7-codestral", "codestral-latest", "Codestral — Mistral's code generation model, free anonymous", "professional", 256000),
  l7("l7-deepseek-v4-flash", "deepseek-v4-flash:0731", "DeepSeek V4 Flash — fast latest DeepSeek via LLM7", "professional", 64000),
  l7("l7-gemini-3-1-flash-lite", "gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite — lightweight Google model via LLM7", "professional", 1000000),
  l7("l7-minimax-m2-7", "minimax-m2.7", "MiniMax M2.7 — large Chinese model via LLM7", "professional", 1000000),

  // ─── SpicyWriter provider: free anonymous NSFW/uncensored, real SSE ────
  // Each call mints a fresh anon id (X-Anonymous-User-Id) → unlimited free.
  // Uncensored system preamble auto-injected for nsfw-* models.
  sw("nsfw-ling-2-6-flash", "Ling 2.6 Flash", "Ling 2.6 Flash — uncensored NSFW, real token streaming, tool calling supported", 128000),
  sw("nsfw-nemo", "Nemo", "Nemo — uncensored NSFW model, real token streaming, tool calling supported", 128000),

  // ─── FreeGPT.tech provider: WASM-secured, 27 free models, no key ────
  // Each request mints a fresh UUID, fetches a one-time PoW challenge, and
  // signs it via a WASM module before calling the OpenAI-compatible endpoint.
  // Backup host (standalone.freegpt.win:3001) — no Cloudflare, so the
  // cf-turnstile-token header can be empty. Real SSE streaming.
  fg("fgpt-gpt-4o-mini", "gpt-4o-mini", "GPT-4o mini — fast, lightweight, WASM-secured via FreeGPT.tech (no key)", "professional", 128000),
  fg("fgpt-gpt-5-4-mini", "gpt-5.4-mini", "GPT-5.4 mini — fast flagship-tier, tool calling supported (FreeGPT.tech)", "professional", 128000, { tools: true }),
  fg("fgpt-gpt-5-4-nano", "gpt-5.4-nano", "GPT-5.4 nano — ultra-light variant (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-5-3-free", "gpt-5.3-free", "GPT-5.3 free — mid-tier free model (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-5-3-thinking-free", "gpt-5.3-thinking-free", "GPT-5.3 thinking free — reasoning model, shows chain-of-thought (FreeGPT.tech)", "reasoning", 128000),
  fg("fgpt-gpt-5-free", "gpt-5-free", "GPT-5 free — flagship free tier (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-deepseek-v4-flash", "deepseek-v4-flash", "DeepSeek V4 Flash — fast latest DeepSeek (FreeGPT.tech)", "professional", 64000),
  fg("fgpt-gpt-5-mini", "gpt-5-mini", "GPT-5 mini — compact flagship (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-5-nano", "gpt-5-nano", "GPT-5 nano — smallest GPT-5 variant (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gemini-3-1-flash-lite", "gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite preview — Google lightweight (FreeGPT.tech)", "professional", 1000000),
  fg("fgpt-grok-4-20-fast", "grok-4.20-fast", "Grok 4.20 Fast — xAI fast variant (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-llama-3-3-70b", "Meta-Llama-3.3-70B-Instruct", "Llama 3.3 70B Instruct — Meta open flagship, tool calling supported (FreeGPT.tech)", "professional", 128000, { tools: true }),
  fg("fgpt-qwen-3-5-397b", "Qwen/Qwen3.5-397B-A17B", "Qwen 3.5 397B (A17B) — Alibaba flagship MoE (FreeGPT.tech)", "professional", 262144),
  fg("fgpt-qwen-3-6-plus", "qwen3.6-plus", "Qwen 3.6 Plus — Alibaba enhanced, tool calling supported (FreeGPT.tech)", "professional", 262144, { tools: true }),
  fg("fgpt-grok-4", "grok-4", "Grok 4 — xAI flagship, hidden (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-deepseek-reasoner", "deepseek-reasoner", "DeepSeek Reasoner — reasoning model, shows chain-of-thought (FreeGPT.tech)", "reasoning", 64000),
  fg("fgpt-gemini-2-5-flash", "gemini-2.5-flash", "Gemini 2.5 Flash — fast Google model (FreeGPT.tech)", "professional", 1000000),
  fg("fgpt-gpt-4-1-mini", "gpt-4.1-mini", "GPT-4.1 mini — fast lightweight (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-4-1-nano", "gpt-4.1-nano", "GPT-4.1 nano — smallest GPT-4.1 (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-deepseek-chat", "deepseek-chat", "DeepSeek Chat — general DeepSeek model (FreeGPT.tech)", "professional", 64000),
  fg("fgpt-gpt-3-5-turbo", "gpt-3.5-turbo", "GPT-3.5 Turbo — legacy OpenAI model (FreeGPT.tech)", "professional", 16000),
  fg("fgpt-grok-3", "grok-3", "Grok 3 — previous xAI flagship (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-grok-3-mini", "grok-3-mini", "Grok 3 mini — compact xAI (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-gpt-5-4", "gpt-5.4", "GPT-5.4 — latest flagship, free on test days (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gemini-2-5-pro", "gemini-2.5-pro", "Gemini 2.5 Pro — Google flagship, free on test days (FreeGPT.tech)", "professional", 2000000),
  fg("fgpt-grok-4-3", "grok-4.3", "Grok 4.3 — newest xAI flagship, free on test days (FreeGPT.tech)", "professional", 131000),
  fgImg("fgpt-gpt-image-2", "gpt-image-2", "GPT-Image 2 — OpenAI image generation (FreeGPT.tech)", "general"),
  fgImg("fgpt-nano-banana-2", "nano-banana-2", "Nano Banana 2 — Google Gemini image generation (FreeGPT.tech)", "realism"),
  fgImg("fgpt-flux-2-flex", "flux-2-flex", "Flux 2 Flex — Black Forest Labs photoreal image generation (FreeGPT.tech)", "realism"),
  // Additional FreeGPT models (50 total from the upstream model list)
  fg("fgpt-gpt-5-5", "gpt-5.5", "GPT-5.5 — improved flagship (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-5-6-luna", "gpt-5.6-luna", "GPT-5.6 Luna — creative variant (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-5-6-sol", "gpt-5.6-sol", "GPT-5.6 Sol — solar variant (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-deepseek-v4-pro", "deepseek-v4-pro", "DeepSeek V4 Pro — full DeepSeek flagship (FreeGPT.tech)", "professional", 64000),
  fg("fgpt-gemini-3-pro-preview", "gemini-3-pro-preview", "Gemini 3 Pro Preview — Google flagship preview (FreeGPT.tech)", "professional", 2000000),
  fg("fgpt-gemini-3-5-flash", "gemini-3.5-flash", "Gemini 3.5 Flash — Google fast model (FreeGPT.tech)", "professional", 1000000),
  fg("fgpt-gemini-3-flash-preview", "gemini-3-flash-preview", "Gemini 3 Flash Preview — Google latest fast (FreeGPT.tech)", "professional", 1000000),
  fg("fgpt-gemini-3-1-pro-preview", "gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview — Google pro preview (FreeGPT.tech)", "professional", 2000000),
  fg("fgpt-claude-fable-5", "claude-fable-5", "Claude Fable 5 — Anthropic storytelling model (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-claude-sonnet-5", "claude-sonnet-5", "Claude Sonnet 5 — Anthropic latest (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-claude-opus-5", "claude-opus-5", "Claude Opus 5 — Anthropic flagship (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-claude-opus-4-8", "claude-opus-4-8", "Claude Opus 4.8 — previous Anthropic flagship (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-claude-opus-4-7", "claude-opus-4-7", "Claude Opus 4.7 — Anthropic model (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-claude-opus-4-6", "claude-opus-4-6", "Claude Opus 4.6 — Anthropic model (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-claude-sonnet-4-6", "claude-sonnet-4-6", "Claude Sonnet 4.6 — Anthropic model (FreeGPT.tech)", "professional", 200000),
  fg("fgpt-grok-4-20", "grok-4.20", "Grok 4.20 — xAI flagship (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-grok-4-20-non-reasoning", "grok-4.20-0309-non-reasoning", "Grok 4.20 Non-Reasoning — fast xAI variant (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-grok-imagine", "grok-imagine", "Grok Imagine — xAI image-capable model (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-gpt-4o", "gpt-4o", "GPT-4o — OpenAI multimodal flagship (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gpt-4-1", "gpt-4.1", "GPT-4.1 — OpenAI model (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-o3", "o3", "o3 — OpenAI reasoning flagship (FreeGPT.tech)", "reasoning", 200000),
  fg("fgpt-o4-mini", "o4-mini", "o4 Mini — OpenAI compact reasoning (FreeGPT.tech)", "reasoning", 128000),
  fg("fgpt-gpt-oss-120b", "gpt-oss-120b", "GPT-OSS 120B — OpenAI open-weight (FreeGPT.tech)", "professional", 131000),
  fg("fgpt-baidu-eb50", "Webapp/Baidu/EB50", "Baidu EB50 — Chinese AI model (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-baidu-eb45t", "Webapp/Baidu/EB45T", "Baidu EB45T — Chinese AI model (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-mimo-v2-5", "mimo-v2.5", "Xiaomi MiMo V2.5 — Xiaomi AI model (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-mimo-v2-5-pro", "mimo-v2.5-pro", "Xiaomi MiMo V2.5 Pro — enhanced Xiaomi (FreeGPT.tech)", "professional", 128000),
  fg("fgpt-gemini-3-1-flash-image", "gemini-3.1-flash-image", "Gemini 3.1 Flash Image — Google image-capable (FreeGPT.tech)", "professional", 1000000),



  // ─── g4f.space provider: 165 reverse-engineered chat models ──────────
  // Reverse-engineered from g4f.dev — proxies 30+ chat providers.
  // No signup, no key. 3 active days per 12 days anonymous limit.
  // Credit: g4f.dev / xtekky/gpt4free (https://github.com/xtekky/gpt4free)
  g4f("g4f-aliestaha-fable-traces", "AliesTaha/fable-traces", "fable-traces — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-catniti-gpt-oss-120b", "Catniti/gpt-oss-120b", "gpt-oss-120b — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-qwen-qwen3-235b-a22b", "Qwen/Qwen3-235B-A22B", "Qwen3-235B-A22B — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-yoanndev90-diffusiongemma-26b-a4b-it-free", "YoannDev90/diffusiongemma-26b-a4b-it:free", "diffusiongemma-26b-a4b-it:free — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-yoanndev90-laguna-s-2-1-free", "YoannDev90/laguna-s-2.1:free", "laguna-s-2.1:free — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-agnes", "agnes", "agnes — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-allam-2-7b", "allam-2-7b", "allam-2-7b — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-auto", "auto", "auto — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-bottlecapai-thinkingcap-qwen3-6-27b", "bottlecapai/ThinkingCap-Qwen3.6-27B", "ThinkingCap-Qwen3.6-27B — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-claude-3-5-sonnet", "claude-3.5-sonnet", "claude-3.5-sonnet — via g4f.space (api.airforce)", "professional", 128000),
  g4f("g4f-deepreinforce-ai-ornith-1-0-9b", "deepreinforce-ai/Ornith-1.0-9B", "Ornith-1.0-9B — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-deepseek", "deepseek", "deepseek — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-deepseek-ai-deepseek-v4-flash", "deepseek-ai/DeepSeek-V4-Flash", "DeepSeek-V4-Flash — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-deepseek-ai-deepseek-v4-pro", "deepseek-ai/DeepSeek-V4-Pro", "DeepSeek-V4-Pro — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-deepseek-ai-deepseek-v4-flash-2", "deepseek-ai/deepseek-v4-flash", "deepseek-v4-flash — via g4f.space (KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV))", "professional", 128000),
  g4f("g4f-deepseek-ai-deepseek-v4-pro-2", "deepseek-ai/deepseek-v4-pro", "deepseek-v4-pro — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-deepseek-pro", "deepseek-pro", "deepseek-pro — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-deepseek-v3-2", "deepseek-v3.2", "deepseek-v3.2 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-deepseek-v4-flash", "deepseek-v4-flash", "deepseek-v4-flash — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-deepseek-v4-flash-thinking", "deepseek-v4-flash-thinking", "deepseek-v4-flash-thinking — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-deepseek-v4-flash-0731", "deepseek-v4-flash:0731", "deepseek-v4-flash:0731 — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-deepseek-v4-pro", "deepseek-v4-pro", "deepseek-v4-pro — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-deepseek-v4-pro-thinking", "deepseek-v4-pro-thinking", "deepseek-v4-pro-thinking — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-diffusion-gemma", "diffusion-gemma", "diffusion-gemma — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-empero-ai-qwythos-9b-claude-mythos-5-1m", "empero-ai/Qwythos-9B-Claude-Mythos-5-1M", "Qwythos-9B-Claude-Mythos-5-1M — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-gemini-2-5-flash", "gemini-2.5-flash", "gemini-2.5-flash — via g4f.space (Google Antigravity)", "professional", 128000),
  g4f("g4f-gemini-2-5-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash-lite — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemini-2-5-pro---0", "gemini-2.5-pro (+0)", "gemini-2.5-pro (+0) — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gemini-3", "gemini-3", "gemini-3 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gemini-3-flash-preview", "gemini-3-flash-preview", "gemini-3-flash-preview — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemini-3-1-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemini-3-1-pro", "gemini-3.1-pro", "gemini-3.1-pro — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gemini-3-5-flash", "gemini-3.5-flash", "gemini-3.5-flash — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemini-3-5-pro", "gemini-3.5-pro", "gemini-3.5-pro — via g4f.space (api.airforce)", "professional", 128000),
  g4f("g4f-gemini-3-6-flash", "gemini-3.6-flash", "gemini-3.6-flash — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemini-flash-latest", "gemini-flash-latest", "gemini-flash-latest — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemini-flash-lite-latest", "gemini-flash-lite-latest", "gemini-flash-lite-latest — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-gemma-4-31b", "gemma-4-31b", "gemma-4-31b — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-gemma-4-31b-it", "gemma-4-31b-it", "gemma-4-31b-it — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gemma4-31b", "gemma4:31b", "gemma4:31b — via g4f.space (ollama.com)", "professional", 128000),
  g4f("g4f-glm", "glm", "glm — via g4f.space (nectar by pollinations.ai)", "professional", 128000),
  g4f("g4f-glm-4-6", "glm-4.6", "glm-4.6 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-glm-4-6-thinking", "glm-4.6-thinking", "glm-4.6-thinking — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-glm-4-7", "glm-4.7", "glm-4.7 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-glm-5", "glm-5", "glm-5 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-glm-5-thinking", "glm-5-thinking", "glm-5-thinking — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-glm-5-1", "glm-5.1", "glm-5.1 — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-glm-5-2", "glm-5.2", "glm-5.2 — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-glm-5-2-thinking", "glm-5.2-thinking", "glm-5.2-thinking — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-glm-5v-turbo", "glm-5v-turbo", "glm-5v-turbo — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-google-diffusiongemma-26b-a4b-it", "google/diffusiongemma-26b-a4b-it", "diffusiongemma-26b-a4b-it — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-google-gemma-4-26b-a4b-it-free", "google/gemma-4-26b-a4b-it:free", "gemma-4-26b-a4b-it:free — via g4f.space (openrouter.ai)", "professional", 128000),
  g4f("g4f-google-gemma-4-31b-it", "google/gemma-4-31B-it", "gemma-4-31B-it — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-gpt-3-5-turbo", "gpt-3.5-turbo", "gpt-3.5-turbo — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-gpt-4o", "gpt-4o", "gpt-4o — via g4f.space (api.airforce)", "professional", 128000),
  g4f("g4f-gpt-4o-mini", "gpt-4o-mini", "gpt-4o-mini — via g4f.space (api.airforce)", "professional", 128000),
  g4f("g4f-gpt-5-nano", "gpt-5-nano", "gpt-5-nano — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gpt-5-3-codex", "gpt-5.3-codex", "gpt-5.3-codex — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gpt-5-4", "gpt-5.4", "gpt-5.4 — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-gpt-5-4-mini", "gpt-5.4-mini", "gpt-5.4-mini — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-gpt-5-5", "gpt-5.5", "gpt-5.5 — via g4f.space (nectar by pollinations.ai)", "professional", 128000),
  g4f("g4f-gpt-5-6-so", "gpt-5.6-so", "gpt-5.6-so — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-gpt-laborratse", "gpt-laborratse", "gpt-laborratse — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-gpt-oss", "gpt-oss", "gpt-oss — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-gpt-oss-120b", "gpt-oss-120b", "gpt-oss-120b — via g4f.space (cerebras.ai)", "professional", 128000),
  g4f("g4f-gpt-oss-120b-2", "gpt-oss:120b", "gpt-oss:120b — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-gpt-oss-20b", "gpt-oss:20b", "gpt-oss:20b — via g4f.space (ollama.com)", "professional", 128000),
  g4f("g4f-grok", "grok", "grok — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-grok-4-1-fast", "grok-4.1-fast", "grok-4.1-fast — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-grok-4-20-fast", "grok-4.20-fast", "grok-4.20-fast — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-grok-4-3", "grok-4.3", "grok-4.3 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-grok-4-5", "grok-4.5", "grok-4.5 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-grok-uncensored", "grok-uncensored", "grok-uncensored — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-groq-compound", "groq/compound", "compound — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-kimi-k2-6", "kimi-k2.6", "kimi-k2.6 — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-kimi-k2-7", "kimi-k2.7", "kimi-k2.7 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-kimi-k2-7-code", "kimi-k2.7-code", "kimi-k2.7-code — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-laborratse-de-uncensored", "laborratse-de-uncensored", "laborratse-de-uncensored — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-llama-3-1-8b-instant", "llama-3.1-8b-instant", "llama-3.1-8b-instant — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-llama-3-3-70b-versatile", "llama-3.3-70b-versatile", "llama-3.3-70b-versatile — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-mdhm-hmmd-gemma4-e4b-uncensored-q8-latest", "mdhm_hmmd/gemma4-e4b-uncensored-q8:latest", "gemma4-e4b-uncensored-q8:latest — via g4f.space (ollama.cloud.orion)", "professional", 128000),
  g4f("g4f-mercury", "mercury", "mercury — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-meta-llama-llama-prompt-guard-2-86m", "meta-llama/llama-prompt-guard-2-86m", "llama-prompt-guard-2-86m — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-meta-llama-3-1-70b-instruct", "meta/llama-3.1-70b-instruct", "llama-3.1-70b-instruct — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-meta-llama-3-1-8b-instruct", "meta/llama-3.1-8b-instruct", "llama-3.1-8b-instruct — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-meta-llama-3-2-11b-vision-instruct", "meta/llama-3.2-11b-vision-instruct", "llama-3.2-11b-vision-instruct — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-meta-llama-3-2-3b-instruct", "meta/llama-3.2-3b-instruct", "llama-3.2-3b-instruct — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-meta-llama-3-2-90b-vision-instruct", "meta/llama-3.2-90b-vision-instruct", "llama-3.2-90b-vision-instruct — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-meta-llama-3-3-70b-instruct", "meta/llama-3.3-70b-instruct", "llama-3.3-70b-instruct — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-minimax", "minimax", "minimax — via g4f.space (nectar by pollinations.ai)", "professional", 128000),
  g4f("g4f-minimax-m2-7", "minimax-m2.7", "minimax-m2.7 — via g4f.space (ollama.pro)", "professional", 128000),
  g4f("g4f-minimax-m3", "minimax-m3", "minimax-m3 — via g4f.space (ollama.com)", "professional", 128000),
  g4f("g4f-minimaxai-minimax-m3", "minimaxai/minimax-m3", "minimax-m3 — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-mistral", "mistral", "mistral — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-mistral-code-latest", "mistral-code-latest", "mistral-code-latest — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-mistral-medium-3-5", "mistral-medium-3-5", "mistral-medium-3-5 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-models-gemini-2-5-flash", "models/gemini-2.5-flash", "gemini-2.5-flash — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-2-5-flash-lite", "models/gemini-2.5-flash-lite", "gemini-2.5-flash-lite — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-3-flash-preview", "models/gemini-3-flash-preview", "gemini-3-flash-preview — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-3-1-flash-lite", "models/gemini-3.1-flash-lite", "gemini-3.1-flash-lite — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-3-1-flash-lite-preview", "models/gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite-preview — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-3-5-flash", "models/gemini-3.5-flash", "gemini-3.5-flash — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-3-5-flash-lite", "models/gemini-3.5-flash-lite", "gemini-3.5-flash-lite — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-3-6-flash", "models/gemini-3.6-flash", "gemini-3.6-flash — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-flash-latest", "models/gemini-flash-latest", "gemini-flash-latest — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-flash-lite-latest", "models/gemini-flash-lite-latest", "gemini-flash-lite-latest — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-robotics-er-1-6-preview", "models/gemini-robotics-er-1.6-preview", "gemini-robotics-er-1.6-preview — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemini-robotics-er-2-preview", "models/gemini-robotics-er-2-preview", "gemini-robotics-er-2-preview — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemma-4-26b-a4b-it", "models/gemma-4-26b-a4b-it", "gemma-4-26b-a4b-it — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-models-gemma-4-31b-it", "models/gemma-4-31b-it", "gemma-4-31b-it — via g4f.space (gemini-v1beta)", "professional", 128000),
  g4f("g4f-moonshotai-kimi-k2-5", "moonshotai/Kimi-K2.5", "Kimi-K2.5 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-moonshotai-kimi-k2-7-code", "moonshotai/Kimi-K2.7-Code", "Kimi-K2.7-Code — via g4f.space (community-day-2026)", "professional", 128000),
  g4f("g4f-morriszdweck-osaii-api-fast", "morriszdweck/osaii-api-fast", "osaii-api-fast — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-nemotron-3-nano-30b", "nemotron-3-nano:30b", "nemotron-3-nano:30b — via g4f.space (ollama.com)", "professional", 128000),
  g4f("g4f-nemotron-3-super", "nemotron-3-super", "nemotron-3-super — via g4f.space (ollama.com)", "professional", 128000),
  g4f("g4f-nemotron-3-ultra", "nemotron-3-ultra", "nemotron-3-ultra — via g4f.space (ollama.com)", "professional", 128000),
  g4f("g4f-nova", "nova", "nova — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-nvidia-llama-3-1-nemoguard-8b-content-safety", "nvidia/llama-3.1-nemoguard-8b-content-safety", "llama-3.1-nemoguard-8b-content-safety — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-llama-3-1-nemoguard-8b-topic-control", "nvidia/llama-3.1-nemoguard-8b-topic-control", "llama-3.1-nemoguard-8b-topic-control — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-llama-3-3-nemotron-super-49b-v1", "nvidia/llama-3.3-nemotron-super-49b-v1", "llama-3.3-nemotron-super-49b-v1 — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-3-nano-30b-a3b", "nvidia/nemotron-3-nano-30b-a3b", "nemotron-3-nano-30b-a3b — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-3-nano-30b-a3b-free", "nvidia/nemotron-3-nano-30b-a3b:free", "nemotron-3-nano-30b-a3b:free — via g4f.space (openrouter.ai)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-3-nano-omni-30b-a3b-reasoning", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "nemotron-3-nano-omni-30b-a3b-reasoning — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-3-super-120b-a12b", "nvidia/nemotron-3-super-120b-a12b", "nemotron-3-super-120b-a12b — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-3-super-120b-a12b-free", "nvidia/nemotron-3-super-120b-a12b:free", "nemotron-3-super-120b-a12b:free — via g4f.space (openrouter.ai)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-ultra-550b-a55b", "nemotron-3-ultra-550b-a55b — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-nemotron-nano-9b-v2-free", "nvidia/nemotron-nano-9b-v2:free", "nemotron-nano-9b-v2:free — via g4f.space (openrouter.ai)", "professional", 128000),
  g4f("g4f-nvidia-nvidia-nemotron-nano-9b-v2", "nvidia/nvidia-nemotron-nano-9b-v2", "nvidia-nemotron-nano-9b-v2 — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-nvidia-riva-translate-4b-instruct-v2", "nvidia/riva-translate-4b-instruct-v2", "riva-translate-4b-instruct-v2 — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-openai", "openai", "openai — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-openai-fast", "openai-fast", "openai-fast — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-openai-gpt-oss-120b", "openai/gpt-oss-120b", "gpt-oss-120b — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-openai-gpt-oss-20b", "openai/gpt-oss-20b", "gpt-oss-20b — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-openai-gpt-oss-safeguard-20b", "openai/gpt-oss-safeguard-20b", "gpt-oss-safeguard-20b — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-openrouter-free", "openrouter/free", "free — via g4f.space (openrouter.ai)", "professional", 128000),
  g4f("g4f-opus-4-7", "opus-4.7", "opus-4.7 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-poolside-laguna-xs-2-1", "poolside/laguna-xs-2.1", "laguna-xs-2.1 — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-poolside-laguna-xs-2-1-free", "poolside/laguna-xs-2.1:free", "laguna-xs-2.1:free — via g4f.space (openrouter.ai)", "professional", 128000),
  g4f("g4f-qwen-coder", "qwen-coder", "qwen-coder — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-qwen-qwen3-6-27b", "qwen/qwen3.6-27b", "qwen3.6-27b — via g4f.space (groq.com)", "professional", 128000),
  g4f("g4f-qwen3-6-plus", "qwen3.6-plus", "qwen3.6-plus — via g4f.space (qwen)", "professional", 128000),
  g4f("g4f-qwen3-7-max", "qwen3.7-max", "qwen3.7-max — via g4f.space (qwen)", "professional", 128000),
  g4f("g4f-qwen3-7-plus", "qwen3.7-plus", "qwen3.7-plus — via g4f.space (qwen)", "professional", 128000),
  g4f("g4f-qwen3-8-max", "qwen3.8-max", "qwen3.8-max — via g4f.space (qwen)", "professional", 128000),
  g4f("g4f-qwen3-8-max-preview", "qwen3.8-max-preview", "qwen3.8-max-preview — via g4f.space (qwen)", "professional", 128000),
  g4f("g4f-schizogpt", "schizogpt", "schizogpt — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-sonar", "sonar", "sonar — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-srv-mrdypihj16e8b1776409-zai-org-glm-5-2", "srv_mrdypihj16e8b1776409:zai-org/GLM-5.2", "GLM-5.2 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-srv-mrtd0gge48cb809ab7eb-grok-4-5", "srv_mrtd0gge48cb809ab7eb:grok-4.5", "srv_mrtd0gge48cb809ab7eb:grok-4.5 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-step-3-7", "step-3.7", "step-3.7 — via g4f.space (eaon.dev)", "professional", 128000),
  g4f("g4f-stepfun-ai-step-3-7-flash", "stepfun-ai/step-3.7-flash", "step-3.7-flash — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-tomdacatto-ezra", "tomdacatto/ezra", "ezra — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-turbo", "turbo", "turbo — via g4f.space (perplexity)", "professional", 128000),
  g4f("g4f-vendouple-deepseek-v4", "vendouple/deepseek-v4", "deepseek-v4 — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-vendouple-deepseek-v4-pro", "vendouple/deepseek-v4-pro", "deepseek-v4-pro — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-vendouple-gemma-4-31b-sdft-heretic-rp", "vendouple/gemma-4-31b-sdft-heretic-rp", "gemma-4-31b-sdft-heretic-rp — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-vendouple-laguna-s-2-1-free", "vendouple/laguna-s-2.1:free", "laguna-s-2.1:free — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-venice-uncensored", "venice-uncensored", "venice-uncensored — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-venice-uncensored-role-play", "venice-uncensored-role-play", "venice-uncensored-role-play — via g4f.space (navy)", "professional", 128000),
  g4f("g4f-voodoohop-anyvm-deepseek-chat", "voodoohop/anyvm-deepseek-chat", "anyvm-deepseek-chat — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-voodoohop-weaver", "voodoohop/weaver", "weaver — via g4f.space (gen.pollinations.ai)", "professional", 128000),
  g4f("g4f-z-ai-glm-5-2", "z-ai/glm-5.2", "glm-5.2 — via g4f.space (nvidia.com)", "professional", 128000),
  g4f("g4f-zai-glm-4-7", "zai-glm-4.7", "zai-glm-4.7 — via g4f.space (cerebras.ai)", "professional", 128000),
  g4f("g4f-zai-org-glm-5-1-fp8", "zai-org/GLM-5.1-FP8", "GLM-5.1-FP8 — via g4f.space (crowllm.com)", "professional", 128000),
  g4f("g4f-zai-org-glm-5-2", "zai-org/GLM-5.2", "GLM-5.2 — via g4f.space (community-day-2026)", "professional", 128000),

  // ─── Standalone services: web search + music generation ────────────────
  // These use separate API endpoints (not chat completions).
  // See /api/v1/search and /api/v1/music/generate for the actual calls.
  svc("web-search", "/api/v1/search", "DuckDuckGo web search — returns titles, URLs, and snippets. POST {query} or GET ?q=...", "search", 0),
  svc("music-generate", "/api/v1/music/generate", "ACE-Step 1.5 AI music generation — auto-fetches API key, returns base64 audio. POST {prompt, lyrics?, duration?}", "music", 0),


];

/** Toolbaz model helper. Tool calling supported (via prompt injection); no real streaming upstream. */
function tb(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "toolbaz",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** nsfwlover.com model helper. Real SSE streaming; tool support via injection. */
function nsfw(
  id: string,
  upstream: string,
  description: string,
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "nsfwlover",
    upstream,
    description,
    category: "nsfw",
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** SurfSense model helper. Real SSE streaming; tool support via injection. */
function ss(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "surfsense",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** JollyGen model helper. Unrestricted NSFW, real streaming, rotated identity. */
function jg(
  id: string,
  upstream: string,
  description: string,
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "jollygen",
    upstream,
    description,
    category: "nsfw",
    contextWindow,
    capabilities: {
      streaming: true,
      tools: false,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** UnlimitedAI.chat model helper. Uncensored, real NDJSON streaming. */
function uai(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
  webSearch = false,
): GatewayModel {
  return {
    id,
    provider: "unlimitedai",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch,
    },
  };
}

/** Pollinations.ai model helper. Free, no-auth, real OpenAI SSE streaming. */
function pol(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
  reasoning = false,
): GatewayModel {
  return {
    id,
    provider: "pollinations",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}


/** Kilo Code model helper. Free, no-auth, real SSE streaming. */
function kc(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "kilocode",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** LLM7.io model helper. Free anonymous, no key. */
function l7(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "llm7",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}


/** SpicyWriter model helper. Free anonymous NSFW/uncensored, real SSE streaming. */
function sw(
  id: string,
  upstream: string,
  description: string,
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "spicywriter",
    upstream,
    description,
    category: "nsfw",
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** FreeGPT.tech model helper. WASM-secured, no key, real OpenAI SSE streaming.
 *  The optional `tools` capability override applies to a few models that
 *  explicitly support tool calls upstream (gpt-5.4-mini, Llama 3.3 70B,
 *  Qwen 3.6 Plus). */
function fg(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
  opts?: { tools?: boolean },
): GatewayModel {
  return {
    id,
    provider: "freegpt",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** FreeGPT.tech image model helper. Same WASM-secured transport as fg(),
 *  but flagged as a text-to-image modality so the UI can group it under
 *  "Image models" and the chat route can route image requests correctly.
 *  FreeGPT image models return a markdown image link in the assistant
 *  message content (parsed by /api/v1/image/generate). */
function fgImg(
  id: string,
  upstream: string,
  description: string,
  imageCategory: GatewayModel["imageCategory"] = "general",
): GatewayModel {
  return {
    id,
    provider: "freegpt",
    upstream,
    description,
    category: "professional",
    contextWindow: 128000,
    modality: "text-to-image",
    imageCategory,
    capabilities: {
      streaming: false,
      tools: false,
      systemPrompt: false,
      multiTurn: false,
      vision: false,
      webSearch: false,
    },
  };
}

/** g4f.space model helper. Free, no-auth, OpenAI-compatible.
 *  Real SSE streaming. 3 active days per 12 days anonymous limit.
 *  Credit: g4f.dev / xtekky/gpt4free */
function g4f(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "g4fspace",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: false,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}




/** Standalone service model (search, music, etc.) — listed for discovery but
 * called via their own endpoints, NOT via /v1/chat/completions. */
function svc(
  id: string,
  upstream: string,
  description: string,
  provider: "search" | "music",
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider,
    upstream,
    description,
    category: "professional",
    contextWindow,
    capabilities: {
      streaming: false,
      tools: false,
      systemPrompt: false,
      multiTurn: false,
      vision: false,
      webSearch: provider === "search",
    },
  };
}



/** Find a model by id (case-insensitive). Returns undefined if not found. */
export function findModel(id: string | undefined): GatewayModel | undefined {
  if (!id) return undefined;
  const lower = id.toLowerCase();
  return MODELS.find((m) => m.id.toLowerCase() === lower);
}

/** The default model used when a request omits `model`. */
export const DEFAULT_MODEL_ID = "toolbaz-v4.5-fast";

/** Resolve a requested model id. Falls back to the default if unknown. */
export function resolveGatewayModel(
  requested: string | undefined,
): GatewayModel {
  const found = findModel(requested);
  if (found) return found;
  const id = requested && requested.trim() ? requested.trim() : DEFAULT_MODEL_ID;
  return {
    id,
    provider: "toolbaz",
    upstream: id,
    description: "Unknown model (passed through to Toolbaz)",
    category: "professional",
    contextWindow: 0,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** Provider display metadata. */
export const PROVIDER_INFO: Record<
  ProviderId,
  { name: string; description: string }
> = {
  "freegpt": {
    name: "FreeGPT.tech",
    description: "50 free models (GPT-5.5/5.6, Claude Opus/Sonnet 5, Grok 4.20, Gemini 3, DeepSeek V4, Llama 3.3) — WASM-secured, no API key needed",
  },
  "g4fspace": {
    name: "g4f.space",
    description: "165 reverse-engineered chat models from 30+ providers (Blackbox, DDG, Airforce, Groq, NVIDIA, Gemini, community Ollama) — via g4f.dev, no signup, no key. 3 active days per 12 days.",
  },
  "jollygen": {
    name: "JollyGen",
    description: "Unrestricted NSFW roleplay — rotated guest identity, no content filters",
  },
  "kilocode": {
    name: "Kilo Code",
    description: "16 free models (NVIDIA Nemotron, Tencent Hy3, Poolside, StepFun, Ling) — no key, real SSE streaming",
  },
  "llm7": {
    name: "LLM7.io",
    description: "Free anonymous no-key access to GPT-OSS, Minimax, Codestral",
  },
  "music": {
    name: "Music Generation",
    description: "ACE-Step 1.5 AI music generation — real API key, returns base64 audio. POST /api/v1/music/generate",
  },
  "nsfwlover": {
    name: "NSFWLover",
    description: "Uncensored LLaMA-3 roleplay engine with real token streaming",
  },
  "pollinations": {
    name: "Pollinations",
    description: "Free no-auth OpenAI-compatible API with real token streaming and reasoning",
  },
  "search": {
    name: "Web Search",
    description: "DuckDuckGo web search — returns titles, URLs, snippets. POST /api/v1/search {query}",
  },
  "spicywriter": {
    name: "SpicyWriter",
    description: "2 uncensored NSFW models (Ling 2.6 Flash, Nemo) — free anonymous, rotated anon id per call, real SSE streaming",
  },
  "surfsense": {
    name: "SurfSense",
    description: "Free no-login chat with real token streaming (gpt-5.4-mini, o4-mini)",
  },
  "toolbaz": {
    name: "Toolbaz",
    description: "Free multi-model aggregator (gpt-5, claude, gemini, grok, deepseek…)",
  },
  "unlimitedai": {
    name: "UnlimitedAI",
    description: "Uncensored reasoning + web search, NDJSON token streaming",
  },
};
