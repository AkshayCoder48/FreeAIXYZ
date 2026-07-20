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
 * Total: 285 models across 32 providers.
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
  | "heckai"
  | "spicywriter"
  | "search"
  | "music"
  | "easychat"
  | "ollama-swarm"
  | "yqcloud"
  | "wewordle"
  | "qwen-chat"
  | "pollinations-image"
  | "pollinations-g4f"
  | "perplexity-g4f"
  | "opera-aria"
  | "openaifm"
  | "huggingspace"
  | "bfl-flux"
  | "anyprovider"
  | "api-airforce"
  | "audio"
  | "cerebras-ai"
  | "community-day-2026"
  | "crowllm-com"
  | "deepinfra-com"
  | "gemini-cli"
  | "gemini-v1beta"
  | "gen-pollinations-ai"
  | "google-antigravity"
  | "groq-com"
  | "kobold-llamacpp-swarm"
  | "ktai"
  | "modelscope-ai"
  | "nectar-pollinations-ai"
  | "nvidia-com"
  | "ollama-com"
  | "ollama-pro"
  | "opencode-ai-zen"
  | "openrouter-ai"
  | "perplexity"
  | "pollinations-ai"
  | "qwen";

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

  // ─── Kilo Code provider: 9 free models, no key, real SSE (tested OK) ───
  kc("tencent-hy3", "tencent/hy3:free", "Tencent Hy3 — large-scale Chinese/English model", "professional", 262144),
  kc("nemotron-ultra", "nvidia/nemotron-3-ultra-550b-a55b:free", "NVIDIA Nemotron 3 Ultra (550B) — flagship reasoning model", "reasoning", 1000000),
  kc("nemotron-super", "nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA Nemotron 3 Super (120B) — high-performance model", "professional", 1000000),
  kc("nemotron-nano-omni", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "NVIDIA Nemotron 3 Nano Omni (30B) — compact reasoning", "reasoning", 256000),
  kc("nemotron-safety", "nvidia/nemotron-3.5-content-safety:free", "NVIDIA Nemotron 3.5 Content Safety — moderation model", "sfw", 128000),
  kc("laguna-xs", "poolside/laguna-xs-2.1:free", "Poolside Laguna XS 2.1 — code-optimized model", "professional", 262144),
  kc("laguna-m", "poolside/laguna-m.1:free", "Poolside Laguna M.1 — balanced code model", "professional", 262144),
  kc("cohere-north-code", "cohere/north-mini-code:free", "Cohere North Mini Code — lightweight code model", "professional", 256000),
  kc("kilo-auto-free", "kilo-auto/free", "Kilo Auto Free — auto-routes to best available free model", "professional", 262144),

  // ─── LLM7.io provider: free anonymous, no key (tested OK) ───────────────
  l7("gpt-oss-20b", "gpt-oss:20b", "GPT-OSS 20B — OpenAI open-weight model, free anonymous access", "professional", 131072),
  l7("codestral-latest", "codestral-latest", "Codestral — Mistral's code generation model, free anonymous", "professional", 256000),

  // ─── HeckAI provider: free, no-auth, real SSE streaming ────────────────
  ha("heckai-gemini-3-flash", "google/gemini-3-flash-preview", "Gemini 3 Flash Preview — Google's latest fast model (via HeckAI)", "professional", 1000000),
  ha("heckai-gemini-3-1-flash-lite", "google/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite — Google lightweight (via HeckAI)", "professional", 1000000),
  ha("heckai-deepseek-v4-pro", "deepseek/deepseek-v4-pro", "DeepSeek V4 Pro — latest flagship (via HeckAI)", "professional", 64000),
  ha("heckai-deepseek-v4-flash", "deepseek/deepseek-v4-flash", "DeepSeek V4 Flash — fast variant (via HeckAI)", "professional", 64000),
  ha("heckai-qwen3-7-plus", "qwen/qwen3.7-plus", "Qwen 3.7 Plus — Alibaba enhanced (via HeckAI)", "professional", 262144),
  ha("heckai-minimax-m3", "minimax/minimax-m3", "Minimax M3 — Chinese AI flagship (via HeckAI)", "professional", 196000),
  ha("heckai-stepfun-flash", "stepfun/step-3.7-flash", "StepFun 3.7 Flash — fast Chinese AI (via HeckAI)", "professional", 262144),

  // ─── SpicyWriter provider: free anonymous NSFW/uncensored, real SSE ────
  // Each call mints a fresh anon id (X-Anonymous-User-Id) → unlimited free.
  // Uncensored system preamble auto-injected for nsfw-* models.
  sw("nsfw-ling-2-6-flash", "Ling 2.6 Flash", "Ling 2.6 Flash — uncensored NSFW, real token streaming, tool calling supported", 128000),
  sw("nsfw-nemo", "Nemo", "Nemo — uncensored NSFW model, real token streaming, tool calling supported", 128000),

  // ─── Standalone services: web search + music generation ────────────────
  // These use separate API endpoints (not chat completions).
  // See /api/v1/search and /api/v1/music/generate for the actual calls.
  svc("web-search", "/api/v1/search", "DuckDuckGo web search — returns titles, URLs, and snippets. POST {query} or GET ?q=...", "search", 0),
  svc("music-generate", "/api/v1/music/generate", "ACE-Step 1.5 AI music generation — auto-fetches API key, returns base64 audio. POST {prompt, lyrics?, duration?}", "music", 0),

  // ─── G4F-working: confirmed no-auth models (daily tested) ───
  // Accessed via G4F.space API with Provider:Model format
  // ─── AnyProvider (AnyProvider) — 46 models ──────────────
  gf("anyprovider", "anyprovider-gpt-4o-mini-tts", "AnyProvider:gpt-4o-mini-tts", "gpt-4o-mini-tts (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-gpt-4-1-nano", "AnyProvider:gpt-4.1-nano", "gpt-4.1-nano (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-smart", "AnyProvider:smart", "smart (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-gpt-4o", "AnyProvider:gpt-4o", "gpt-4o (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-reasoning", "AnyProvider:reasoning", "reasoning (via AnyProvider)", "AnyProvider", "reasoning", 128000),
  gf("anyprovider", "anyprovider-gpt-4", "AnyProvider:gpt-4", "gpt-4 (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-study", "AnyProvider:study", "study (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-gpt-image", "AnyProvider:gpt-image", "gpt-image (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-search", "AnyProvider:search", "search (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-command-r", "AnyProvider:command-r", "command-r (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-command-a", "AnyProvider:command-a", "command-a (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-command-r-plus", "AnyProvider:command-r-plus", "command-r-plus (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-command-r7b", "AnyProvider:command-r7b", "command-r7b (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-deepseek-r1", "AnyProvider:deepseek-r1", "deepseek-r1 (via AnyProvider)", "AnyProvider", "reasoning", 64000),
  gf("anyprovider", "anyprovider-aria", "AnyProvider:aria", "aria (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-r1-1776", "AnyProvider:r1-1776", "r1-1776 (via AnyProvider)", "AnyProvider", "reasoning", 128000),
  gf("anyprovider", "anyprovider-sd-3-5-large", "AnyProvider:sd-3.5-large", "sd-3.5-large (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-openai-fast", "AnyProvider:openai-fast", "openai-fast (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-openai", "AnyProvider:openai", "openai (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-chat", "AnyProvider:chat", "chat (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-nova", "AnyProvider:nova", "nova (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-perplexity", "AnyProvider:perplexity", "perplexity (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-sana", "AnyProvider:sana", "sana (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-qwen-3-6-27b", "AnyProvider:qwen-3.6-27b", "qwen-3.6-27b (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-7-plus", "AnyProvider:qwen-3.7-plus", "qwen-3.7-plus (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-7-max", "AnyProvider:qwen-3.7-max", "qwen-3.7-max (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-6-max", "AnyProvider:qwen-3.6-max", "qwen-3.6-max (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-5-plus", "AnyProvider:qwen-3.5-plus", "qwen-3.5-plus (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-omni-flash", "AnyProvider:qwen-3-omni-flash", "qwen-3-omni-flash (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-5-flash", "AnyProvider:qwen-3.5-flash", "qwen-3.5-flash (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-plus", "AnyProvider:qwen-plus", "qwen-plus (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-5-omni-plus", "AnyProvider:qwen-3.5-omni-plus", "qwen-3.5-omni-plus (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-5-omni-flash", "AnyProvider:qwen-3.5-omni-flash", "qwen-3.5-omni-flash (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-coder-plus", "AnyProvider:qwen-3-coder-plus", "qwen-3-coder-plus (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-max", "AnyProvider:qwen-3-max", "qwen-3-max (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-6-35b-a3b", "AnyProvider:qwen-3.6-35b-a3b", "qwen-3.6-35b-a3b (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-5-397b-a17b", "AnyProvider:qwen-3.5-397b-a17b", "qwen-3.5-397b-a17b (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-qwen-3-vl-plus", "AnyProvider:qwen-3-vl-plus", "qwen-3-vl-plus (via AnyProvider)", "AnyProvider", "professional", 262144),
  gf("anyprovider", "anyprovider-command-r-plus24", "AnyProvider:command-r-plus24", "command-r-plus24 (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-gpt-5-nano", "AnyProvider:gpt-5-nano", "gpt-5-nano (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-gpt-5-4-nano", "AnyProvider:gpt-5.4-nano", "gpt-5.4-nano (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-command-r7b24", "AnyProvider:command-r7b24", "command-r7b24 (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-command-r24", "AnyProvider:command-r24", "command-r24 (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-command-r7b-arabic25", "AnyProvider:command-r7b-arabic25", "command-r7b-arabic25 (via AnyProvider)", "AnyProvider", "professional", 256000),
  gf("anyprovider", "anyprovider-command-a25", "AnyProvider:command-a25", "command-a25 (via AnyProvider)", "AnyProvider", "professional", 128000),
  gf("anyprovider", "anyprovider-pplx-pro", "AnyProvider:pplx_pro", "pplx_pro (via AnyProvider)", "AnyProvider", "professional", 128000),

  // ─── BlackForestLabs_Flux1Dev (BlackForest Labs Flux) — 1 models ──────────────
  gf("bfl-flux", "bfl-flux-dev", "BlackForestLabs_Flux1Dev:flux-dev", "flux-dev (via BlackForest Labs Flux)", "BlackForestLabs_Flux1Dev", "professional", 128000),

  // ─── HuggingSpace (HuggingFace Space) — 7 models ──────────────
  gf("huggingspace", "huggingspace-command-a-03-2025", "HuggingSpace:command-a-03-2025", "command-a-03-2025 (via HuggingFace Space)", "HuggingSpace", "professional", 128000),
  gf("huggingspace", "huggingspace-command-r-plus-08-2024", "HuggingSpace:command-r-plus-08-2024", "command-r-plus-08-2024 (via HuggingFace Space)", "HuggingSpace", "professional", 256000),
  gf("huggingspace", "huggingspace-command-a", "HuggingSpace:command-a", "command-a (via HuggingFace Space)", "HuggingSpace", "professional", 128000),
  gf("huggingspace", "huggingspace-command-r7b-arabic-02-2025", "HuggingSpace:command-r7b-arabic-02-2025", "command-r7b-arabic-02-2025 (via HuggingFace Space)", "HuggingSpace", "professional", 256000),
  gf("huggingspace", "huggingspace-command-r-08-2024", "HuggingSpace:command-r-08-2024", "command-r-08-2024 (via HuggingFace Space)", "HuggingSpace", "professional", 256000),
  gf("huggingspace", "huggingspace-command-r7b-12-2024", "HuggingSpace:command-r7b-12-2024", "command-r7b-12-2024 (via HuggingFace Space)", "HuggingSpace", "professional", 256000),
  gf("huggingspace", "huggingspace-command-r", "HuggingSpace:command-r", "command-r (via HuggingFace Space)", "HuggingSpace", "professional", 256000),

  // ─── OpenAIFM (OpenAI.fm) — 17 models ──────────────
  gf("openaifm", "openaifm-ballad", "OpenAIFM:ballad", "ballad (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-scientific-style", "OpenAIFM:scientific_style", "scientific_style (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-ash", "OpenAIFM:ash", "ash (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-calm", "OpenAIFM:calm", "calm (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-coral", "OpenAIFM:coral", "coral (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-alloy", "OpenAIFM:alloy", "alloy (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-friendly", "OpenAIFM:friendly", "friendly (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-noir-detective", "OpenAIFM:noir_detective", "noir_detective (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-cowboy", "OpenAIFM:cowboy", "cowboy (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-patient-teacher", "OpenAIFM:patient_teacher", "patient_teacher (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-sage", "OpenAIFM:sage", "sage (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-fable", "OpenAIFM:fable", "fable (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-onyx", "OpenAIFM:onyx", "onyx (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-shimmer", "OpenAIFM:shimmer", "shimmer (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-nova", "OpenAIFM:nova", "nova (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-verse", "OpenAIFM:verse", "verse (via OpenAI.fm)", "OpenAIFM", "professional", 128000),
  gf("openaifm", "openaifm-echo", "OpenAIFM:echo", "echo (via OpenAI.fm)", "OpenAIFM", "professional", 128000),

  // ─── OperaAria (Opera Aria) — 1 models ──────────────
  gf("opera-aria", "opera-aria", "OperaAria:aria", "aria (via Opera Aria)", "OperaAria", "professional", 128000),

  // ─── Perplexity (Perplexity) — 13 models ──────────────
  gf("perplexity-g4f", "perplexity-auto", "Perplexity:auto", "auto (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-o3pro", "Perplexity:o3pro", "o3pro (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-pplx-alpha", "Perplexity:pplx_alpha", "pplx_alpha (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-pplx-pro-upgraded", "Perplexity:pplx_pro_upgraded", "pplx_pro_upgraded (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-gpt5-thinking", "Perplexity:gpt5_thinking", "gpt5_thinking (via Perplexity)", "Perplexity", "reasoning", 128000),
  gf("perplexity-g4f", "perplexity-claude45sonnet", "Perplexity:claude45sonnet", "claude45sonnet (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-experimental", "Perplexity:experimental", "experimental (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-gpt41", "Perplexity:gpt41", "gpt41 (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-claude37sonnetthinking", "Perplexity:claude37sonnetthinking", "claude37sonnetthinking (via Perplexity)", "Perplexity", "reasoning", 128000),
  gf("perplexity-g4f", "perplexity-gemini2flash", "Perplexity:gemini2flash", "gemini2flash (via Perplexity)", "Perplexity", "professional", 1000000),
  gf("perplexity-g4f", "perplexity-claude40opusthinking", "Perplexity:claude40opusthinking", "claude40opusthinking (via Perplexity)", "Perplexity", "reasoning", 128000),
  gf("perplexity-g4f", "perplexity-o4mini", "Perplexity:o4mini", "o4mini (via Perplexity)", "Perplexity", "professional", 128000),
  gf("perplexity-g4f", "perplexity-pplx-reasoning", "Perplexity:pplx_reasoning", "pplx_reasoning (via Perplexity)", "Perplexity", "reasoning", 128000),

  // ─── Pollinations (Pollinations) — 4 models ──────────────
  gf("pollinations-g4f", "pollinations-openai-fast", "Pollinations:openai-fast", "openai-fast (via Pollinations)", "Pollinations", "professional", 128000),
  gf("pollinations-g4f", "pollinations-openai", "Pollinations:openai", "openai (via Pollinations)", "Pollinations", "professional", 128000),
  gf("pollinations-g4f", "pollinations-gpt-oss", "Pollinations:gpt-oss", "gpt-oss (via Pollinations)", "Pollinations", "professional", 128000),
  gf("pollinations-g4f", "pollinations-sana", "Pollinations:sana", "sana (via Pollinations)", "Pollinations", "professional", 128000),

  // ─── PollinationsImage (Pollinations Image) — 1 models ──────────────
  gf("pollinations-image", "pollinations-sana-2", "PollinationsImage:sana", "sana (via Pollinations Image)", "PollinationsImage", "professional", 128000),

  // ─── Qwen (Qwen Chat) — 16 models ──────────────
  gf("qwen-chat", "qwen-qwen3-5-flash", "Qwen:qwen3.5-flash", "qwen3.5-flash (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-6-27b", "Qwen:qwen3.6-27b", "qwen3.6-27b (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-6-plus", "Qwen:qwen3.6-plus", "qwen3.6-plus (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-6-35b-a3b", "Qwen:qwen3.6-35b-a3b", "qwen3.6-35b-a3b (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-7-max", "Qwen:qwen3.7-max", "qwen3.7-max (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-7-plus", "Qwen:qwen3.7-plus", "qwen3.7-plus (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-5-plus", "Qwen:qwen3.5-plus", "qwen3.5-plus (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-5-omni-plus", "Qwen:qwen3.5-omni-plus", "qwen3.5-omni-plus (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-6-max-preview", "Qwen:qwen3.6-max-preview", "qwen3.6-max-preview (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-5-397b-a17b", "Qwen:qwen3.5-397b-a17b", "qwen3.5-397b-a17b (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-omni-flash-2025-12-01", "Qwen:qwen3-omni-flash-2025-12-01", "qwen3-omni-flash-2025-12-01 (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-5-omni-flash", "Qwen:qwen3.5-omni-flash", "qwen3.5-omni-flash (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-coder-plus", "Qwen:qwen3-coder-plus", "qwen3-coder-plus (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen-plus-2025-07-28", "Qwen:qwen-plus-2025-07-28", "qwen-plus-2025-07-28 (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-max-2026-01-23", "Qwen:qwen3-max-2026-01-23", "qwen3-max-2026-01-23 (via Qwen Chat)", "Qwen", "professional", 262144),
  gf("qwen-chat", "qwen-qwen3-vl-plus", "Qwen:qwen3-vl-plus", "qwen3-vl-plus (via Qwen Chat)", "Qwen", "professional", 262144),

  // ─── WeWordle (WeWordle) — 7 models ──────────────
  gf("wewordle", "wewordle-gpt-4o-mini", "WeWordle:gpt-4o-mini", "gpt-4o-mini (via WeWordle)", "WeWordle", "professional", 128000),
  gf("wewordle", "wewordle-gpt-4o", "WeWordle:gpt-4o", "gpt-4o (via WeWordle)", "WeWordle", "professional", 128000),
  gf("wewordle", "wewordle-gpt-4", "WeWordle:gpt-4", "gpt-4 (via WeWordle)", "WeWordle", "professional", 128000),
  gf("wewordle", "wewordle-v3", "WeWordle:v3", "v3 (via WeWordle)", "WeWordle", "professional", 128000),
  gf("wewordle", "wewordle-deepseek", "WeWordle:deepseek", "deepseek (via WeWordle)", "WeWordle", "professional", 64000),
  gf("wewordle", "wewordle-deepseek-reasoner", "WeWordle:deepseek-reasoner", "deepseek-reasoner (via WeWordle)", "WeWordle", "professional", 64000),
  gf("wewordle", "wewordle-deepseek-r1", "WeWordle:deepseek-r1", "deepseek-r1 (via WeWordle)", "WeWordle", "reasoning", 64000),

  // ─── Yqcloud (Yqcloud) — 1 models ──────────────
  gf("yqcloud", "yqcloud-gpt-4", "Yqcloud:gpt-4", "gpt-4 (via Yqcloud)", "Yqcloud", "professional", 128000),

  // ─── OllamaSwarm — 64 server-allowed models ───
  gf("ollama-swarm", "ollama-swarm-deepseek-v4-pro", "srv_mq7ktfibad45c29f3839:deepseek-v4-pro:cloud", "deepseek-v4-pro (via OllamaSwarm)", "ollama-swarm", "professional", 64000),
  gf("ollama-swarm", "ollama-swarm-deepseek-v4-flash", "srv_mq7ktfibad45c29f3839:deepseek-v4-flash:cloud", "deepseek-v4-flash (via OllamaSwarm)", "ollama-swarm", "professional", 64000),
  gf("ollama-swarm", "ollama-swarm-minimax-m2-7", "srv_mq7ktfibad45c29f3839:minimax-m2.7:cloud", "minimax-m2.7 (via OllamaSwarm)", "ollama-swarm", "professional", 196000),
  gf("ollama-swarm", "ollama-swarm-kimi-k2-6", "srv_mq7ktfibad45c29f3839:kimi-k2.6:cloud", "kimi-k2.6 (via OllamaSwarm)", "ollama-swarm", "professional", 200000),
  gf("ollama-swarm", "ollama-swarm-minimax-m3", "srv_mq7ktfibad45c29f3839:minimax-m3:cloud", "minimax-m3 (via OllamaSwarm)", "ollama-swarm", "professional", 196000),
  gf("ollama-swarm", "ollama-swarm-glm-4-7", "srv_mq7ktfibad45c29f3839:glm-4.7:cloud", "glm-4.7 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-glm-5-1", "srv_mq7ktfibad45c29f3839:glm-5.1:cloud", "glm-5.1 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-minimax-m2-5", "srv_mq7ktfibad45c29f3839:minimax-m2.5:cloud", "minimax-m2.5 (via OllamaSwarm)", "ollama-swarm", "professional", 196000),
  gf("ollama-swarm", "ollama-swarm-deepseek-v3-2", "srv_mq7ktfibad45c29f3839:deepseek-v3.2:cloud", "deepseek-v3.2 (via OllamaSwarm)", "ollama-swarm", "professional", 64000),
  gf("ollama-swarm", "ollama-swarm-qwen3-6", "srv_mq7ktfibad45c29f3839:qwen3.6:latest", "qwen3.6 (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-qwen3-6-27b", "srv_mq7ktfibad45c29f3839:qwen3.6:27b", "qwen3.6:27b (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-llama3-2-3b", "srv_mq7ktfibad45c29f3839:llama3.2:3b", "llama3.2:3b (via OllamaSwarm)", "ollama-swarm", "professional", 8000),
  gf("ollama-swarm", "ollama-swarm-llama3", "srv_mq7ktfibad45c29f3839:llama3:latest", "llama3 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-nemesis-ia-v3", "srv_mq7ktfibad45c29f3839:nemesis-ia-v3:latest", "nemesis-ia-v3 (via OllamaSwarm)", "ollama-swarm", "nsfw", 128000),
  gf("ollama-swarm", "ollama-swarm-nemesis-ia", "srv_mq7ktfibad45c29f3839:nemesis-ia:latest", "nemesis-ia (via OllamaSwarm)", "ollama-swarm", "nsfw", 128000),
  gf("ollama-swarm", "ollama-swarm-deepseek-r1-671b", "srv_mq7ktfibad45c29f3839:deepseek-r1:671b", "deepseek-r1:671b (via OllamaSwarm)", "ollama-swarm", "reasoning", 64000),
  gf("ollama-swarm", "ollama-swarm-llama3-3-70b", "srv_mq7ktfibad45c29f3839:llama3.3:70b", "llama3.3:70b (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-dolphin-mixtral-8x7b", "srv_mq7ktfibad45c29f3839:dolphin-mixtral:8x7b", "dolphin-mixtral:8x7b (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-wizard-vicuna-uncensored-13b", "srv_mq7ktfibad45c29f3839:wizard-vicuna-uncensored:13b", "wizard-vicuna-uncensored:13b (via OllamaSwarm)", "ollama-swarm", "nsfw", 8000),
  gf("ollama-swarm", "ollama-swarm-qwen2-5-72b", "srv_mq7ktfibad45c29f3839:qwen2.5:72b", "qwen2.5:72b (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-codestral-22b", "srv_mq7ktfibad45c29f3839:codestral:22b", "codestral:22b (via OllamaSwarm)", "ollama-swarm", "professional", 256000),
  gf("ollama-swarm", "ollama-swarm-llama3-8b", "srv_mq7ktfibad45c29f3839:llama3:8b", "llama3:8b (via OllamaSwarm)", "ollama-swarm", "professional", 8000),
  gf("ollama-swarm", "ollama-swarm-mistral-7b", "srv_mq7ktfibad45c29f3839:mistral:7b", "mistral:7b (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-deepseek-r1-7b", "srv_mq7ktfibad45c29f3839:deepseek-r1:7b", "deepseek-r1:7b (via OllamaSwarm)", "ollama-swarm", "reasoning", 64000),
  gf("ollama-swarm", "ollama-swarm-gemma3-27b", "srv_mq7ktfibad45c29f3839:gemma3:27b", "gemma3:27b (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-dolphin-llama3-8b", "srv_mq7ktfibad45c29f3839:dolphin-llama3:8b", "dolphin-llama3:8b (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-qwen2-5-0-5b", "srv_mq7ktfibad45c29f3839:qwen2.5:0.5b", "qwen2.5:0.5b (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-llama3-2", "srv_mq7ktfibad45c29f3839:llama3.2:latest", "llama3.2 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-mistral-nemo", "srv_mq7ktfibad45c29f3839:mistral-nemo:latest", "mistral-nemo (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-huihui-ai-gemma-4-abliterated-26b", "srv_mq7ktfibad45c29f3839:huihui_ai/gemma-4-abliterated:26b", "huihui_ai/gemma-4-abliterated:26b (via OllamaSwarm)", "ollama-swarm", "nsfw", 128000),
  gf("ollama-swarm", "ollama-swarm-huihui-ai-qwen3-5-abliterated-27b", "srv_mq7ktfibad45c29f3839:huihui_ai/qwen3.5-abliterated:27b", "huihui_ai/qwen3.5-abliterated:27b (via OllamaSwarm)", "ollama-swarm", "nsfw", 262144),
  gf("ollama-swarm", "ollama-swarm-gemma4-26b", "srv_mq7ktfibad45c29f3839:gemma4:26b", "gemma4:26b (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-huihui-ai-qwen3-6-abliterated-27b", "srv_mq7ktfibad45c29f3839:huihui_ai/qwen3.6-abliterated:27b", "huihui_ai/qwen3.6-abliterated:27b (via OllamaSwarm)", "ollama-swarm", "nsfw", 262144),
  gf("ollama-swarm", "ollama-swarm-huihui-ai-gpt-oss-abliterated", "srv_mq7ktfibad45c29f3839:huihui_ai/gpt-oss-abliterated:latest", "huihui_ai/gpt-oss-abliterated (via OllamaSwarm)", "ollama-swarm", "nsfw", 128000),
  gf("ollama-swarm", "ollama-swarm-huihui-ai-gemma-4-abliterated-12b", "srv_mq7ktfibad45c29f3839:huihui_ai/gemma-4-abliterated:12b", "huihui_ai/gemma-4-abliterated:12b (via OllamaSwarm)", "ollama-swarm", "nsfw", 128000),
  gf("ollama-swarm", "ollama-swarm-qwen3-coder-next", "srv_mq7ktfibad45c29f3839:qwen3-coder-next:cloud", "qwen3-coder-next (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-qwen3-5", "srv_mq7ktfibad45c29f3839:qwen3.5:cloud", "qwen3.5 (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-kimi-k2-5", "srv_mq7ktfibad45c29f3839:kimi-k2.5:cloud", "kimi-k2.5 (via OllamaSwarm)", "ollama-swarm", "professional", 200000),
  gf("ollama-swarm", "ollama-swarm-qwen2-5-3b", "srv_mq7ktfibad45c29f3839:qwen2.5:3b", "qwen2.5:3b (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-gemma4", "srv_mq7ktfibad45c29f3839:gemma4:latest", "gemma4 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-gpt-oss-120b-cloud", "srv_mq7ktfibad45c29f3839:gpt-oss:120b-cloud", "gpt-oss:120b-cloud (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-phi3", "srv_mq7ktfibad45c29f3839:phi3:latest", "phi3 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-mapler-gpt2", "srv_mq7ktfibad45c29f3839:mapler/gpt2:latest", "mapler/gpt2 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-mistral", "srv_mq7ktfibad45c29f3839:mistral:latest", "mistral (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-qwen3", "srv_mq7ktfibad45c29f3839:qwen3:latest", "qwen3 (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-gemma3", "srv_mq7ktfibad45c29f3839:gemma3:latest", "gemma3 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-mistral-small3-2", "srv_mq7ktfibad45c29f3839:mistral-small3.2:latest", "mistral-small3.2 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-devstral", "srv_mq7ktfibad45c29f3839:devstral:latest", "devstral (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-phi4", "srv_mq7ktfibad45c29f3839:phi4:latest", "phi4 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-deepseek-coder-v2", "srv_mq7ktfibad45c29f3839:deepseek-coder-v2:latest", "deepseek-coder-v2 (via OllamaSwarm)", "ollama-swarm", "professional", 64000),
  gf("ollama-swarm", "ollama-swarm-deepseek-r1", "srv_mq7ktfibad45c29f3839:deepseek-r1:latest", "deepseek-r1 (via OllamaSwarm)", "ollama-swarm", "reasoning", 64000),
  gf("ollama-swarm", "ollama-swarm-llama3-1", "srv_mq7ktfibad45c29f3839:llama3.1:latest", "llama3.1 (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-qwen3-8b-q4-k-m", "srv_mq7ktfibad45c29f3839:qwen3:8b-q4_K_M", "qwen3:8b-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-qwen2-5-14b-instruct-q4-k-m", "srv_mq7ktfibad45c29f3839:qwen2.5:14b-instruct-q4_K_M", "qwen2.5:14b-instruct-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-llama3-1-8b-instruct-q4-k-m", "srv_mq7ktfibad45c29f3839:llama3.1:8b-instruct-q4_K_M", "llama3.1:8b-instruct-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 128000),
  gf("ollama-swarm", "ollama-swarm-llama3-2-1b-instruct-q4-k-m", "srv_mq7ktfibad45c29f3839:llama3.2:1b-instruct-q4_K_M", "llama3.2:1b-instruct-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 8000),
  gf("ollama-swarm", "ollama-swarm-qwen2-5-7b-instruct-q4-k-m", "srv_mq7ktfibad45c29f3839:qwen2.5:7b-instruct-q4_K_M", "qwen2.5:7b-instruct-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-llama3-2-3b-instruct-q4-k-m", "srv_mq7ktfibad45c29f3839:llama3.2:3b-instruct-q4_K_M", "llama3.2:3b-instruct-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 8000),
  gf("ollama-swarm", "ollama-swarm-tinyllama-1-1b-chat-v1-q4-k-m", "srv_mq7ktfibad45c29f3839:tinyllama:1.1b-chat-v1-q4_K_M", "tinyllama:1.1b-chat-v1-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 8000),
  gf("ollama-swarm", "ollama-swarm-qwen3-32b-q4-k-m", "srv_mq7ktfibad45c29f3839:qwen3:32b-q4_K_M", "qwen3:32b-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-qwen3-14b-q4-k-m", "srv_mq7ktfibad45c29f3839:qwen3:14b-q4_K_M", "qwen3:14b-q4_K_M (via OllamaSwarm)", "ollama-swarm", "professional", 262144),
  gf("ollama-swarm", "ollama-swarm-devstral-2-123b-cloud", "srv_mq7ktfibad45c29f3839:devstral-2:123b-cloud", "devstral-2:123b-cloud (via OllamaSwarm)", "ollama-swarm", "professional", 8000),
  gf("ollama-swarm", "ollama-swarm-deepseek-v3-1-671b-cloud", "srv_mq7ktfibad45c29f3839:deepseek-v3.1:671b-cloud", "deepseek-v3.1:671b-cloud (via OllamaSwarm)", "ollama-swarm", "professional", 64000),
  gf("ollama-swarm", "ollama-swarm-deepseek-r1-32b", "srv_mq7ktfibad45c29f3839:deepseek-r1:32b", "deepseek-r1:32b (via OllamaSwarm)", "ollama-swarm", "reasoning", 64000),

  // ─── EasyChat — 2 models ───
  gf("easychat", "easychat-gpt-5", "gpt-5", "gpt-5 (via EasyChat)", "EasyChat", "professional", 128000),
  gf("easychat", "easychat-grok-4-1-fast", "grok-4.1-fast", "grok-4.1-fast (via EasyChat)", "EasyChat", "professional", 131000),
  // ─── G4F.space — 175 models across 23 providers ───
  // Auth: Bearer token (G4F user key) — enables unlimited daily access
  // gf(providerId, id, upstream, description, ownerLabel, category, contextWindow)
  // ─── GeminiCLI (GeminiCLI) — 2 models ──────────────
  gf("gemini-cli", "gemini-gemini-3-flash-preview", "srv_mkopnfu316bf4ff43369:gemini-3-flash-preview", "gemini-3-flash-preview (via GeminiCLI)", "GeminiCLI", "professional", 1000000),
  gf("gemini-cli", "gemini-gemini-3-1-flash-lite", "srv_mkopnfu316bf4ff43369:gemini-3.1-flash-lite", "gemini-3.1-flash-lite (via GeminiCLI)", "GeminiCLI", "professional", 1000000),

  // ─── Google Antigravity (Google Antigravity) — 6 models ──────────────
  gf("google-antigravity", "google-gemini-2-5-flash", "srv_mlv668eaa6d92f50ff10:gemini-2.5-flash", "gemini-2.5-flash (via Google Antigravity)", "Google Antigravity", "professional", 1000000),
  gf("google-antigravity", "google-gemini-3-1-pro-low", "srv_mlv668eaa6d92f50ff10:gemini-3.1-pro-low", "gemini-3.1-pro-low (via Google Antigravity)", "Google Antigravity", "professional", 1000000),
  gf("google-antigravity", "google-gemini-2-5-flash-lite", "srv_mlv668eaa6d92f50ff10:gemini-2.5-flash-lite", "gemini-2.5-flash-lite (via Google Antigravity)", "Google Antigravity", "professional", 1000000),
  gf("google-antigravity", "google-gemini-3-flash", "srv_mlv668eaa6d92f50ff10:gemini-3-flash", "gemini-3-flash (via Google Antigravity)", "Google Antigravity", "professional", 1000000),
  gf("google-antigravity", "google-gemini-3-pro-high", "srv_mlv668eaa6d92f50ff10:gemini-3-pro-high", "gemini-3-pro-high (via Google Antigravity)", "Google Antigravity", "professional", 1000000),
  gf("google-antigravity", "google-gemini-2-5-flash-thinking", "srv_mlv668eaa6d92f50ff10:gemini-2.5-flash-thinking", "gemini-2.5-flash-thinking (via Google Antigravity)", "Google Antigravity", "reasoning", 1000000),

  // ─── KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV) (KTAI) — 6 models ──────────────
  gf("ktai", "ktai-deepseek-ai-deepseek-v4-pro", "srv_mp1v9cyha31b95fa8c9a:deepseek-ai/deepseek-v4-pro", "deepseek-ai/deepseek-v4-pro (via KTAI)", "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)", "professional", 64000),
  gf("ktai", "ktai-deepseek-ai-deepseek-v4-flash", "srv_mp1v9cyha31b95fa8c9a:deepseek-ai/deepseek-v4-flash", "deepseek-ai/deepseek-v4-flash (via KTAI)", "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)", "professional", 64000),
  gf("ktai", "ktai-openai-gpt-oss-120b", "srv_mp1v9cyha31b95fa8c9a:openai/gpt-oss-120b", "openai/gpt-oss-120b (via KTAI)", "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)", "professional", 128000),
  gf("ktai", "ktai-qwen-qwen3-5-122b-a10b", "srv_mp1v9cyha31b95fa8c9a:qwen/qwen3.5-122b-a10b", "qwen/qwen3.5-122b-a10b (via KTAI)", "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)", "professional", 262144),
  gf("ktai", "ktai-minimaxai-minimax-m2-7", "srv_mp1v9cyha31b95fa8c9a:minimaxai/minimax-m2.7", "minimaxai/minimax-m2.7 (via KTAI)", "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)", "professional", 196000),
  gf("ktai", "ktai-openai-gpt-oss-20b", "srv_mp1v9cyha31b95fa8c9a:openai/gpt-oss-20b", "openai/gpt-oss-20b (via KTAI)", "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)", "professional", 128000),

  // ─── Modelscope AI (Modelscope AI) — 21 models ──────────────
  gf("modelscope-ai", "modelscope-deepseek-ai-deepseek-v4-flash", "srv_mrhxbotq74ee6330d294:deepseek-ai/deepseek-v4-flash", "deepseek-ai/deepseek-v4-flash (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-ai-deepseek-v4-pro", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Pro (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-zai-org-glm-5-2", "srv_mrhxbotq74ee6330d294:zai-org/GLM-5.2", "zai-org/GLM-5.2 (via Modelscope AI)", "Modelscope AI", "professional", 128000),
  gf("modelscope-ai", "modelscope-deepseek-ai-deepseek-v3-1", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V3.1", "deepseek-ai/DeepSeek-V3.1 (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-ai-deepseek-v3-2", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V3.2", "deepseek-ai/DeepSeek-V3.2 (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-ai-deepseek-v4-flash-2", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V4-Flash", "deepseek-ai/DeepSeek-V4-Flash (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-ai-deepseek-v3-2-exp", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V3.2-Exp", "deepseek-ai/DeepSeek-V3.2-Exp (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-minimax-minimax-m1-80k", "srv_mrhxbotq74ee6330d294:MiniMax/MiniMax-M1-80k", "MiniMax/MiniMax-M1-80k (via Modelscope AI)", "Modelscope AI", "professional", 196000),
  gf("modelscope-ai", "modelscope-opencompass-compassjudger-1-32b-instruct", "srv_mrhxbotq74ee6330d294:opencompass/CompassJudger-1-32B-Instruct", "opencompass/CompassJudger-1-32B-Instruct (via Modelscope AI)", "Modelscope AI", "professional", 8000),
  gf("modelscope-ai", "modelscope-qwen-qwen3-5-27b", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3.5-27B", "Qwen/Qwen3.5-27B (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-vl-8b-instruct", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-VL-8B-Instruct", "Qwen/Qwen3-VL-8B-Instruct (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-stepfun-ai-step-3-5-flash", "srv_mrhxbotq74ee6330d294:stepfun-ai/Step-3.5-Flash", "stepfun-ai/Step-3.5-Flash (via Modelscope AI)", "Modelscope AI", "professional", 128000),
  gf("modelscope-ai", "modelscope-qwen-qwen3-5-397b-a17b", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3.5-397B-A17B", "Qwen/Qwen3.5-397B-A17B (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-235b-a22b-instruct-2507", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-235B-A22B-Instruct-2507", "Qwen/Qwen3-235B-A22B-Instruct-2507 (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-vl-8b-thinking", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-VL-8B-Thinking", "Qwen/Qwen3-VL-8B-Thinking (via Modelscope AI)", "Modelscope AI", "reasoning", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-next-80b-a3b-thinking", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-Next-80B-A3B-Thinking", "Qwen/Qwen3-Next-80B-A3B-Thinking (via Modelscope AI)", "Modelscope AI", "reasoning", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-235b-a22b", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-235B-A22B", "Qwen/Qwen3-235B-A22B (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-vl-235b-a22b-instruct", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-VL-235B-A22B-Instruct", "Qwen/Qwen3-VL-235B-A22B-Instruct (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-tencent-hunyuan-hy3", "srv_mrhxbotq74ee6330d294:Tencent-Hunyuan/Hy3", "Tencent-Hunyuan/Hy3 (via Modelscope AI)", "Modelscope AI", "professional", 128000),
  gf("modelscope-ai", "modelscope-qwen-qwen3-235b-a22b-thinking-2507", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-235B-A22B-Thinking-2507", "Qwen/Qwen3-235B-A22B-Thinking-2507 (via Modelscope AI)", "Modelscope AI", "reasoning", 262144),
  gf("modelscope-ai", "modelscope-qwen-qwen3-30b-a3b-thinking-2507", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-30B-A3B-Thinking-2507", "Qwen/Qwen3-30B-A3B-Thinking-2507 (via Modelscope AI)", "Modelscope AI", "reasoning", 262144),

  // ─── Pollinations AI (Pollinations AI) — 1 models ──────────────
  gf("pollinations-ai", "pollinations-openai", "srv_mn1yh26x1ab50575de1a:openai", "openai (via Pollinations AI)", "Pollinations AI", "professional", 128000),

  // ─── api.airforce (API.AirForce) — 6 models ──────────────
  gf("api-airforce", "api-gpt-4o-mini", "srv_mp3lmkuad07322459f47:gpt-4o-mini", "gpt-4o-mini (via API.AirForce)", "api.airforce", "professional", 128000),
  gf("api-airforce", "api-gpt-4o", "srv_mp3lmkuad07322459f47:gpt-4o", "gpt-4o (via API.AirForce)", "api.airforce", "professional", 128000),
  gf("api-airforce", "api-claude-haiku-4-5-p2g", "srv_mp3lmkuad07322459f47:claude-haiku-4.5-p2g", "claude-haiku-4.5-p2g (via API.AirForce)", "api.airforce", "professional", 128000),
  gf("api-airforce", "api-gemini-3-5-pro", "srv_mp3lmkuad07322459f47:gemini-3.5-pro", "gemini-3.5-pro (via API.AirForce)", "api.airforce", "professional", 1000000),
  gf("api-airforce", "api-unmoderated-gpt", "srv_mp3lmkuad07322459f47:unmoderated-gpt", "unmoderated-gpt (via API.AirForce)", "api.airforce", "nsfw", 128000),
  gf("api-airforce", "api-mimo-v2-pro", "srv_mp3lmkuad07322459f47:mimo-v2-pro", "mimo-v2-pro (via API.AirForce)", "api.airforce", "professional", 128000),

  // ─── audio (Audio) — 1 models ──────────────
  gf("audio", "audio-gpt-audio", "srv_mkoqob5pfb6ff5ec61c2:gpt-audio", "gpt-audio (via Audio)", "audio", "professional", 128000),

  // ─── cerebras.ai (Cerebras) — 2 models ──────────────
  gf("cerebras-ai", "cerebras-zai-glm-4-7", "srv_mlj8gd8y789d112ec50d:zai-glm-4.7", "zai-glm-4.7 (via Cerebras)", "cerebras.ai", "professional", 128000),
  gf("cerebras-ai", "cerebras-gpt-oss-120b", "srv_mlj8gd8y789d112ec50d:gpt-oss-120b", "gpt-oss-120b (via Cerebras)", "cerebras.ai", "professional", 128000),

  // ─── community-day-2026 (Community Day 2026) — 6 models ──────────────
  gf("community-day-2026", "community-zai-org-glm-5-2", "srv_mrdypihj16e8b1776409:zai-org/GLM-5.2", "zai-org/GLM-5.2 (via Community Day 2026)", "community-day-2026", "professional", 128000),
  gf("community-day-2026", "community-moonshotai-kimi-k2-7-code", "srv_mrdypihj16e8b1776409:moonshotai/Kimi-K2.7-Code", "moonshotai/Kimi-K2.7-Code (via Community Day 2026)", "community-day-2026", "professional", 200000),
  gf("community-day-2026", "community-deepseek-ai-deepseek-v4-pro", "srv_mrdypihj16e8b1776409:deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Pro (via Community Day 2026)", "community-day-2026", "professional", 64000),
  gf("community-day-2026", "community-empero-ai-qwythos-9b-claude-mythos-5-1m", "srv_mrdypihj16e8b1776409:empero-ai/Qwythos-9B-Claude-Mythos-5-1M", "empero-ai/Qwythos-9B-Claude-Mythos-5-1M (via Community Day 2026)", "community-day-2026", "reasoning", 8000),
  gf("community-day-2026", "community-aliestaha-fable-traces", "srv_mrdypihj16e8b1776409:AliesTaha/fable-traces", "AliesTaha/fable-traces (via Community Day 2026)", "community-day-2026", "professional", 128000),
  gf("community-day-2026", "community-deepseek-ai-deepseek-v4-flash", "srv_mrdypihj16e8b1776409:deepseek-ai/DeepSeek-V4-Flash", "deepseek-ai/DeepSeek-V4-Flash (via Community Day 2026)", "community-day-2026", "professional", 64000),

  // ─── crowllm.com (CrowLLM) — 28 models ──────────────
  gf("crowllm-com", "crowllm-glm-5-2-thinking", "srv_mrgynwuz08a167112109:glm-5.2-thinking", "glm-5.2-thinking (via CrowLLM)", "crowllm.com", "reasoning", 128000),
  gf("crowllm-com", "crowllm-deepseek-v3-2", "srv_mrgynwuz08a167112109:deepseek-v3.2", "deepseek-v3.2 (via CrowLLM)", "crowllm.com", "professional", 64000),
  gf("crowllm-com", "crowllm-deepseek-v3", "srv_mrgynwuz08a167112109:deepseek-v3", "deepseek-v3 (via CrowLLM)", "crowllm.com", "professional", 64000),
  gf("crowllm-com", "crowllm-deepseek-v4-pro-thinking", "srv_mrgynwuz08a167112109:deepseek-v4-pro-thinking", "deepseek-v4-pro-thinking (via CrowLLM)", "crowllm.com", "reasoning", 64000),
  gf("crowllm-com", "crowllm-glm-5-2", "srv_mrgynwuz08a167112109:glm-5.2", "glm-5.2 (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-glm-4-7-flash", "srv_mrgynwuz08a167112109:glm-4.7-flash", "glm-4.7-flash (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-grok-4-1-fast", "srv_mrgynwuz08a167112109:grok-4.1-fast", "grok-4.1-fast (via CrowLLM)", "crowllm.com", "professional", 131000),
  gf("crowllm-com", "crowllm-deepseek-v4-pro", "srv_mrgynwuz08a167112109:deepseek-v4-pro", "deepseek-v4-pro (via CrowLLM)", "crowllm.com", "professional", 64000),
  gf("crowllm-com", "crowllm-deepseek-r1", "srv_mrgynwuz08a167112109:deepseek-r1", "deepseek-r1 (via CrowLLM)", "crowllm.com", "reasoning", 64000),
  gf("crowllm-com", "crowllm-grok-4-3", "srv_mrgynwuz08a167112109:grok-4.3", "grok-4.3 (via CrowLLM)", "crowllm.com", "professional", 131000),
  gf("crowllm-com", "crowllm-deepseek-v4-flash", "srv_mrgynwuz08a167112109:deepseek-v4-flash", "deepseek-v4-flash (via CrowLLM)", "crowllm.com", "professional", 64000),
  gf("crowllm-com", "crowllm-grok-4-20-fast", "srv_mrgynwuz08a167112109:grok-4.20-fast", "grok-4.20-fast (via CrowLLM)", "crowllm.com", "professional", 131000),
  gf("crowllm-com", "crowllm-glm-5-1", "srv_mrgynwuz08a167112109:glm-5.1", "glm-5.1 (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-qwen-qwen3-235b-a22b", "srv_mrgynwuz08a167112109:Qwen/Qwen3-235B-A22B", "Qwen/Qwen3-235B-A22B (via CrowLLM)", "crowllm.com", "professional", 262144),
  gf("crowllm-com", "crowllm-minimax-m3", "srv_mrgynwuz08a167112109:minimax-m3", "minimax-m3 (via CrowLLM)", "crowllm.com", "professional", 196000),
  gf("crowllm-com", "crowllm-grok-4-20-0309-non-reasoning", "srv_mrgynwuz08a167112109:grok-4.20-0309-non-reasoning", "grok-4.20-0309-non-reasoning (via CrowLLM)", "crowllm.com", "reasoning", 131000),
  gf("crowllm-com", "crowllm-moonshotai-kimi-k2-5", "srv_mrgynwuz08a167112109:moonshotai/Kimi-K2.5", "moonshotai/Kimi-K2.5 (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-mistral-large-latest", "srv_mrgynwuz08a167112109:mistral-large-latest", "mistral-large-latest (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-minimaxai-minimax-m3-mxfp8", "srv_mrgynwuz08a167112109:MiniMaxAI/MiniMax-M3-MXFP8", "MiniMaxAI/MiniMax-M3-MXFP8 (via CrowLLM)", "crowllm.com", "professional", 196000),
  gf("crowllm-com", "crowllm-kimi-2-6", "srv_mrgynwuz08a167112109:kimi-2.6", "kimi-2.6 (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-glm-4-7", "srv_mrgynwuz08a167112109:glm-4.7", "glm-4.7 (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-deepseek-v4-flash-thinking", "srv_mrgynwuz08a167112109:deepseek-v4-flash-thinking", "deepseek-v4-flash-thinking (via CrowLLM)", "crowllm.com", "reasoning", 64000),
  gf("crowllm-com", "crowllm-gemma-4-31b", "srv_mrgynwuz08a167112109:gemma-4-31b", "gemma-4-31b (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-zai-org-glm-5-1-fp8", "srv_mrgynwuz08a167112109:zai-org/GLM-5.1-FP8", "zai-org/GLM-5.1-FP8 (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-openai-gpt-oss-120b", "srv_mrgynwuz08a167112109:openai/gpt-oss-120b", "openai/gpt-oss-120b (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-glm-4-6-thinking", "srv_mrgynwuz08a167112109:glm-4.6-thinking", "glm-4.6-thinking (via CrowLLM)", "crowllm.com", "reasoning", 128000),
  gf("crowllm-com", "crowllm-gpt-oss-120b", "srv_mrgynwuz08a167112109:gpt-oss-120b", "gpt-oss-120b (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-glm-4-6", "srv_mrgynwuz08a167112109:glm-4.6", "glm-4.6 (via CrowLLM)", "crowllm.com", "professional", 128000),

  // ─── deepinfra.com (DeepInfra) — 2 models ──────────────
  gf("deepinfra-com", "deepinfra-xiaomimimo-mimo-v2-5-pro", "srv_mp2huzrg06e426ad12f3:XiaomiMiMo/MiMo-V2.5-Pro", "XiaomiMiMo/MiMo-V2.5-Pro (via DeepInfra)", "deepinfra.com", "professional", 128000),
  gf("deepinfra-com", "deepinfra-zai-org-glm-5-2", "srv_mp2huzrg06e426ad12f3:zai-org/GLM-5.2", "zai-org/GLM-5.2 (via DeepInfra)", "deepinfra.com", "professional", 128000),

  // ─── gemini-v1beta (Google Gemini API) — 15 models ──────────────
  gf("gemini-v1beta", "gemini-gemini-flash-lite-latest", "srv_mrgy0nmbc8a86c407f17:models/gemini-flash-lite-latest", "gemini-flash-lite-latest (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-3-5-flash", "srv_mrgy0nmbc8a86c407f17:gemini-3.5-flash", "gemini-3.5-flash (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-3-flash-preview-2", "srv_mrgy0nmbc8a86c407f17:models/gemini-3-flash-preview", "gemini-3-flash-preview (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-3-1-flash-lite-2", "srv_mrgy0nmbc8a86c407f17:models/gemini-3.1-flash-lite", "gemini-3.1-flash-lite (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-3-5-flash-2", "srv_mrgy0nmbc8a86c407f17:models/gemini-3.5-flash", "gemini-3.5-flash (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-2-5-flash", "srv_mrgy0nmbc8a86c407f17:models/gemini-2.5-flash", "gemini-2.5-flash (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-flash-latest", "srv_mrgy0nmbc8a86c407f17:models/gemini-flash-latest", "gemini-flash-latest (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemma-4-31b-it", "srv_mrgy0nmbc8a86c407f17:models/gemma-4-31b-it", "gemma-4-31b-it (via Google Gemini API)", "gemini-v1beta", "professional", 128000),
  gf("gemini-v1beta", "gemini-gemini-3-1-flash-lite-preview", "srv_mrgy0nmbc8a86c407f17:models/gemini-3.1-flash-lite-preview", "gemini-3.1-flash-lite-preview (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-flash-latest-2", "srv_mrgy0nmbc8a86c407f17:gemini-flash-latest", "gemini-flash-latest (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-2-5-flash-lite", "srv_mrgy0nmbc8a86c407f17:models/gemini-2.5-flash-lite", "gemini-2.5-flash-lite (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemini-2-5-flash-2", "srv_mrgy0nmbc8a86c407f17:gemini-2.5-flash", "gemini-2.5-flash (via Google Gemini API)", "gemini-v1beta", "professional", 1000000),
  gf("gemini-v1beta", "gemini-gemma-4-26b-a4b-it", "srv_mrgy0nmbc8a86c407f17:models/gemma-4-26b-a4b-it", "gemma-4-26b-a4b-it (via Google Gemini API)", "gemini-v1beta", "professional", 128000),
  gf("gemini-v1beta", "gemini-gemma-4-31b-it-2", "srv_mrgy0nmbc8a86c407f17:gemma-4-31b-it", "gemma-4-31b-it (via Google Gemini API)", "gemini-v1beta", "professional", 128000),
  gf("gemini-v1beta", "gemini-gemma-4-26b-a4b-it-2", "srv_mrgy0nmbc8a86c407f17:gemma-4-26b-a4b-it", "gemma-4-26b-a4b-it (via Google Gemini API)", "gemini-v1beta", "professional", 128000),

  // ─── gen.pollinations.ai (Pollinations Gen) — 12 models ──────────────
  gf("gen-pollinations-ai", "gen-glm-5-2", "srv_mp5miql908c8738d71be:glm-5.2", "glm-5.2 (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-openai-fast", "srv_mp5miql908c8738d71be:openai-fast", "openai-fast (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-openai", "srv_mp5miql908c8738d71be:openai", "openai (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-kimi-k2-6", "srv_mp5miql908c8738d71be:kimi-k2.6", "kimi-k2.6 (via Pollinations Gen)", "gen.pollinations.ai", "professional", 200000),
  gf("gen-pollinations-ai", "gen-glm", "srv_mp5miql908c8738d71be:glm", "glm (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-gemma", "srv_mp5miql908c8738d71be:gemma", "gemma (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-grok", "srv_mp5miql908c8738d71be:grok", "grok (via Pollinations Gen)", "gen.pollinations.ai", "professional", 131000),
  gf("gen-pollinations-ai", "gen-gpt-5-5", "srv_mp5miql908c8738d71be:gpt-5.5", "gpt-5.5 (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-spit-fires-free", "srv_mp5miql908c8738d71be:Spit-fires/free", "Spit-fires/free (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-vendouple-grok-4-5", "srv_mp5miql908c8738d71be:vendouple/grok-4.5", "vendouple/grok-4.5 (via Pollinations Gen)", "gen.pollinations.ai", "professional", 131000),
  gf("gen-pollinations-ai", "gen-openai-large", "srv_mp5miql908c8738d71be:openai-large", "openai-large (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),
  gf("gen-pollinations-ai", "gen-perplexity-fast", "srv_mp5miql908c8738d71be:perplexity-fast", "perplexity-fast (via Pollinations Gen)", "gen.pollinations.ai", "professional", 128000),

  // ─── groq.com (Groq) — 7 models ──────────────
  gf("groq-com", "groq-llama-3-3-70b-versatile", "srv_mkom688d57c76d8a3542:llama-3.3-70b-versatile", "llama-3.3-70b-versatile (via Groq)", "groq.com", "professional", 128000),
  gf("groq-com", "groq-openai-gpt-oss-120b", "srv_mkom688d57c76d8a3542:openai/gpt-oss-120b", "openai/gpt-oss-120b (via Groq)", "groq.com", "professional", 128000),
  gf("groq-com", "groq-openai-gpt-oss-20b", "srv_mkom688d57c76d8a3542:openai/gpt-oss-20b", "openai/gpt-oss-20b (via Groq)", "groq.com", "professional", 128000),
  gf("groq-com", "groq-qwen-qwen3-6-27b", "srv_mkom688d57c76d8a3542:qwen/qwen3.6-27b", "qwen/qwen3.6-27b (via Groq)", "groq.com", "professional", 262144),
  gf("groq-com", "groq-llama-3-1-8b-instant", "srv_mkom688d57c76d8a3542:llama-3.1-8b-instant", "llama-3.1-8b-instant (via Groq)", "groq.com", "professional", 128000),
  gf("groq-com", "groq-allam-2-7b", "srv_mkom688d57c76d8a3542:allam-2-7b", "allam-2-7b (via Groq)", "groq.com", "professional", 8000),
  gf("groq-com", "groq-groq-compound", "srv_mkom688d57c76d8a3542:groq/compound", "groq/compound (via Groq)", "groq.com", "professional", 128000),

  // ─── kobold & llama.cpp swarm (Kobold / llama.cpp) — 4 models ──────────────
  gf("kobold-llamacpp-swarm", "kobold-qwen3-5-9b-q4-k-m", "srv_mqjxnj9i4e35281e8d60:Qwen3.5-9B-Q4_K_M.gguf", "Qwen3.5-9B-Q4_K_M (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "professional", 262144),
  gf("kobold-llamacpp-swarm", "kobold-qwen3-6-35b-a3b-uncensored-hauhaucs-aggressiv", "srv_mqjxnj9i4e35281e8d60:Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf", "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "nsfw", 262144),
  gf("kobold-llamacpp-swarm", "kobold-qwen3-5-35b-a3b-uncensored-hauhaucs-aggressiv", "srv_mqjxnj9i4e35281e8d60:Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf", "Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "nsfw", 262144),
  gf("kobold-llamacpp-swarm", "kobold-hkuspace", "srv_mqjxnj9i4e35281e8d60:HKUspace.gguf", "HKUspace (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "professional", 128000),

  // ─── nectar by pollinations.ai (Pollinations Nectar) — 8 models ──────────────
  gf("nectar-pollinations-ai", "nectar-glm-5-2", "srv_mkoloq41e34074b6133e:glm-5.2", "glm-5.2 (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 128000),
  gf("nectar-pollinations-ai", "nectar-deepseek", "srv_mkoloq41e34074b6133e:deepseek", "deepseek (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 64000),
  gf("nectar-pollinations-ai", "nectar-mistral", "srv_mkoloq41e34074b6133e:mistral", "mistral (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 128000),
  gf("nectar-pollinations-ai", "nectar-openai-fast", "srv_mkoloq41e34074b6133e:openai-fast", "openai-fast (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 128000),
  gf("nectar-pollinations-ai", "nectar-gpt-5-5", "srv_mkoloq41e34074b6133e:gpt-5.5", "gpt-5.5 (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 128000),
  gf("nectar-pollinations-ai", "nectar-minimax", "srv_mkoloq41e34074b6133e:minimax", "minimax (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 196000),
  gf("nectar-pollinations-ai", "nectar-nova-fast", "srv_mkoloq41e34074b6133e:nova-fast", "nova-fast (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 128000),
  gf("nectar-pollinations-ai", "nectar-deepseek-v4", "srv_mkoloq41e34074b6133e:deepseek-v4", "deepseek-v4 (via Pollinations Nectar)", "nectar by pollinations.ai", "professional", 64000),

  // ─── nvidia.com (NVIDIA NIM) — 27 models ──────────────
  gf("nvidia-com", "nvidia-z-ai-glm-5-2", "srv_mkombumpae45db46dcb8:z-ai/glm-5.2", "z-ai/glm-5.2 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-nvidia-nemotron-3-super-120b-a12b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-super-120b-a12b (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-openai-gpt-oss-120b", "srv_mkombumpae45db46dcb8:openai/gpt-oss-120b", "openai/gpt-oss-120b (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-deepseek-ai-deepseek-v4-pro", "srv_mkombumpae45db46dcb8:deepseek-ai/deepseek-v4-pro", "deepseek-ai/deepseek-v4-pro (via NVIDIA NIM)", "nvidia.com", "professional", 64000),
  gf("nvidia-com", "nvidia-mistralai-mistral-nemotron", "srv_mkombumpae45db46dcb8:mistralai/mistral-nemotron", "mistralai/mistral-nemotron (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-minimaxai-minimax-m3", "srv_mkombumpae45db46dcb8:minimaxai/minimax-m3", "minimaxai/minimax-m3 (via NVIDIA NIM)", "nvidia.com", "professional", 196000),
  gf("nvidia-com", "nvidia-meta-llama-3-1-70b-instruct", "srv_mkombumpae45db46dcb8:meta/llama-3.1-70b-instruct", "meta/llama-3.1-70b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 200000),
  gf("nvidia-com", "nvidia-minimaxai-minimax-m2-7", "srv_mkombumpae45db46dcb8:minimaxai/minimax-m2.7", "minimaxai/minimax-m2.7 (via NVIDIA NIM)", "nvidia.com", "professional", 196000),
  gf("nvidia-com", "nvidia-meta-llama-3-1-8b-instruct", "srv_mkombumpae45db46dcb8:meta/llama-3.1-8b-instruct", "meta/llama-3.1-8b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-deepseek-ai-deepseek-v4-flash", "srv_mkombumpae45db46dcb8:deepseek-ai/deepseek-v4-flash", "deepseek-ai/deepseek-v4-flash (via NVIDIA NIM)", "nvidia.com", "professional", 64000),
  gf("nvidia-com", "nvidia-nvidia-nemotron-3-nano-30b-a3b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-nano-30b-a3b", "nvidia/nemotron-3-nano-30b-a3b (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-mistralai-mistral-large-3-675b-instruct-2512", "srv_mkombumpae45db46dcb8:mistralai/mistral-large-3-675b-instruct-2512", "mistralai/mistral-large-3-675b-instruct-2512 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-stepfun-ai-step-3-7-flash", "srv_mkombumpae45db46dcb8:stepfun-ai/step-3.7-flash", "stepfun-ai/step-3.7-flash (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-qwen-qwen3-5-397b-a17b", "srv_mkombumpae45db46dcb8:qwen/qwen3.5-397b-a17b", "qwen/qwen3.5-397b-a17b (via NVIDIA NIM)", "nvidia.com", "professional", 262144),
  gf("nvidia-com", "nvidia-nvidia-nemotron-3-ultra-550b-a55b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-ultra-550b-a55b (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-mistralai-mistral-small-4-119b-2603", "srv_mkombumpae45db46dcb8:mistralai/mistral-small-4-119b-2603", "mistralai/mistral-small-4-119b-2603 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-thinkingmachines-inkling", "srv_mkombumpae45db46dcb8:thinkingmachines/inkling", "thinkingmachines/inkling (via NVIDIA NIM)", "nvidia.com", "reasoning", 128000),
  gf("nvidia-com", "nvidia-bytedance-seed-oss-36b-instruct", "srv_mkombumpae45db46dcb8:bytedance/seed-oss-36b-instruct", "bytedance/seed-oss-36b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-openai-gpt-oss-20b", "srv_mkombumpae45db46dcb8:openai/gpt-oss-20b", "openai/gpt-oss-20b (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-nvidia-nvidia-nemotron-nano-9b-v2", "srv_mkombumpae45db46dcb8:nvidia/nvidia-nemotron-nano-9b-v2", "nvidia/nvidia-nemotron-nano-9b-v2 (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-qwen-qwen3-next-80b-a3b-instruct", "srv_mkombumpae45db46dcb8:qwen/qwen3-next-80b-a3b-instruct", "qwen/qwen3-next-80b-a3b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 262144),
  gf("nvidia-com", "nvidia-nvidia-nemotron-3-5-content-safety", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3.5-content-safety", "nvidia/nemotron-3.5-content-safety (via NVIDIA NIM)", "nvidia.com", "sfw", 128000),
  gf("nvidia-com", "nvidia-google-gemma-3n-e2b-it", "srv_mkombumpae45db46dcb8:google/gemma-3n-e2b-it", "google/gemma-3n-e2b-it (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-nvidia-llama-3-1-nemotron-nano-vl-8b-v1", "srv_mkombumpae45db46dcb8:nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "nvidia/llama-3.1-nemotron-nano-vl-8b-v1 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-poolside-laguna-xs-2-1", "srv_mkombumpae45db46dcb8:poolside/laguna-xs-2.1", "poolside/laguna-xs-2.1 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-meta-llama-guard-4-12b", "srv_mkombumpae45db46dcb8:meta/llama-guard-4-12b", "meta/llama-guard-4-12b (via NVIDIA NIM)", "nvidia.com", "sfw", 8000),
  gf("nvidia-com", "nvidia-meta-llama-3-2-11b-vision-instruct", "srv_mkombumpae45db46dcb8:meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-11b-vision-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 8000),

  // ─── ollama.com (Ollama) — 3 models ──────────────
  gf("ollama-com", "ollama-gemma4-31b", "srv_mrgykg8eea645e7bb006:gemma4:31b", "gemma4:31b (via Ollama)", "ollama.com", "professional", 128000),
  gf("ollama-com", "ollama-nemotron-3-nano-30b", "srv_mrgykg8eea645e7bb006:nemotron-3-nano:30b", "nemotron-3-nano:30b (via Ollama)", "ollama.com", "professional", 128000),
  gf("ollama-com", "ollama-nemotron-3-super", "srv_mrgykg8eea645e7bb006:nemotron-3-super", "nemotron-3-super (via Ollama)", "ollama.com", "professional", 128000),

  // ─── ollama.pro (Ollama Pro) — 2 models ──────────────
  gf("ollama-pro", "ollama-gpt-oss-120b", "srv_mp2i8rco3148dd85bec1:gpt-oss:120b", "gpt-oss:120b (via Ollama Pro)", "ollama.pro", "professional", 128000),
  gf("ollama-pro", "ollama-deepseek-v4-pro", "srv_mp2i8rco3148dd85bec1:deepseek-v4-pro", "deepseek-v4-pro (via Ollama Pro)", "ollama.pro", "professional", 64000),

  // ─── opencode.ai/zen (OpenCode.ai) — 2 models ──────────────
  gf("opencode-ai-zen", "opencode-nemotron-3-ultra-free", "srv_mrgy2d2493c3e1dc3b74:nemotron-3-ultra-free", "nemotron-3-ultra-free (via OpenCode.ai)", "opencode.ai/zen", "professional", 128000),
  gf("opencode-ai-zen", "opencode-north-mini-code-free", "srv_mrgy2d2493c3e1dc3b74:north-mini-code-free", "north-mini-code-free (via OpenCode.ai)", "opencode.ai/zen", "professional", 128000),

  // ─── openrouter.ai (OpenRouter) — 7 models ──────────────
  gf("openrouter-ai", "openrouter-google-gemma-4-26b-a4b-it", "srv_monk1pkz433a519ff2be:google/gemma-4-26b-a4b-it:free", "google/gemma-4-26b-a4b-it (via OpenRouter)", "openrouter.ai", "professional", 128000),
  gf("openrouter-ai", "openrouter-openrouter-free", "srv_monk1pkz433a519ff2be:openrouter/free", "openrouter/free (via OpenRouter)", "openrouter.ai", "professional", 128000),
  gf("openrouter-ai", "openrouter-nvidia-nemotron-nano-9b-v2", "srv_monk1pkz433a519ff2be:nvidia/nemotron-nano-9b-v2:free", "nvidia/nemotron-nano-9b-v2 (via OpenRouter)", "openrouter.ai", "professional", 8000),
  gf("openrouter-ai", "openrouter-nvidia-nemotron-3-ultra-550b-a55b", "srv_monk1pkz433a519ff2be:nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3-ultra-550b-a55b (via OpenRouter)", "openrouter.ai", "professional", 128000),
  gf("openrouter-ai", "openrouter-nvidia-nemotron-3-nano-30b-a3b", "srv_monk1pkz433a519ff2be:nvidia/nemotron-3-nano-30b-a3b:free", "nvidia/nemotron-3-nano-30b-a3b (via OpenRouter)", "openrouter.ai", "professional", 8000),
  gf("openrouter-ai", "openrouter-nvidia-nemotron-3-super-120b-a12b", "srv_monk1pkz433a519ff2be:nvidia/nemotron-3-super-120b-a12b:free", "nvidia/nemotron-3-super-120b-a12b (via OpenRouter)", "openrouter.ai", "professional", 8000),
  gf("openrouter-ai", "openrouter-poolside-laguna-xs-2-1", "srv_monk1pkz433a519ff2be:poolside/laguna-xs-2.1:free", "poolside/laguna-xs-2.1 (via OpenRouter)", "openrouter.ai", "professional", 128000),

  // ─── perplexity (Perplexity) — 1 models ──────────────
  gf("perplexity", "perplexity-turbo", "srv_mkopv2kp2e0038cdf550:turbo", "turbo (via Perplexity)", "perplexity", "professional", 128000),

  // ─── qwen (Qwen) — 6 models ──────────────
  gf("qwen", "qwen-qwen3-6-plus", "srv_mrgymq8534d9ea96920d:qwen3.6-plus", "qwen3.6-plus (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-max", "srv_mrgymq8534d9ea96920d:qwen3.7-max", "qwen3.7-max (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-plus", "srv_mrgymq8534d9ea96920d:qwen3.7-plus", "qwen3.7-plus (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-max-2", "srv_mrgxthn5dfa6e2f0a5b6:qwen3.7-max", "qwen3.7-max (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-plus-2", "srv_mrgxthn5dfa6e2f0a5b6:qwen3.7-plus", "qwen3.7-plus (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-6-plus-2", "srv_mrgxthn5dfa6e2f0a5b6:qwen3.6-plus", "qwen3.6-plus (via Qwen)", "qwen", "professional", 262144),


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


/** HeckAI model helper. Free, no-auth, real SSE streaming. */
function ha(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "heckai",
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


/**
 * G4F.space model helper. The first arg `providerId` is an owner-based id
 * (e.g. "nvidia-com", "crowllm-com") — the model's `provider` field is set
 * to this value so callers see the real upstream owner. All such ids are
 * backed by the single g4fSpaceProvider instance in providers/index.ts
 * (same endpoint, no auth). The `ownerLabel` arg is the cleaned `owned_by`
 * string from the g4f.space /v1/models endpoint, kept for display.
 */
function gf(
  providerId: ProviderId,
  id: string,
  upstream: string,
  description: string,
  ownerLabel: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: providerId,
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
  "toolbaz": {
    name: "Toolbaz",
    description: "Free multi-model aggregator (gpt-5, claude, gemini, grok, deepseek…)",
  },
  "nsfwlover": {
    name: "NSFWLover",
    description: "Uncensored LLaMA-3 roleplay engine with real token streaming",
  },
  "surfsense": {
    name: "SurfSense",
    description: "Free no-login chat with real token streaming (gpt-5.4-mini, o4-mini)",
  },
  "jollygen": {
    name: "JollyGen",
    description: "Unrestricted NSFW roleplay — rotated guest identity, no content filters",
  },
  "unlimitedai": {
    name: "UnlimitedAI",
    description: "Uncensored reasoning + web search, NDJSON token streaming",
  },
  "pollinations": {
    name: "Pollinations",
    description: "Free no-auth OpenAI-compatible API with real token streaming and reasoning",
  },
  "kilocode": {
    name: "Kilo Code",
    description: "10 free models (NVIDIA Nemotron, Tencent Hy3, Poolside…) — no key, real SSE streaming",
  },
  "llm7": {
    name: "LLM7.io",
    description: "Free anonymous no-key access to GPT-OSS, Minimax, Codestral",
  },
  "heckai": {
    name: "HeckAI",
    description: "7 free models (Gemini 3 Flash, DeepSeek V4, Qwen 3.7, Minimax M3) — no auth, real SSE",
  },
  "spicywriter": {
    name: "SpicyWriter",
    description: "2 uncensored NSFW models (Ling 2.6 Flash, Nemo) — free anonymous, rotated anon id per call, real SSE streaming",
  },
  "anyprovider": {
    name: "AnyProvider",
    description: "46 models (gpt-4o-mini-tts, gpt-4.1-nano, smart, gpt-4o…) via AnyProvider (G4F)",
  },
  "bfl-flux": {
    name: "BlackForest Labs Flux",
    description: "1 models (flux-dev) via BlackForest Labs Flux (G4F)",
  },
  "huggingspace": {
    name: "HuggingFace Space",
    description: "7 models (command-a-03-2025, command-r-plus-08-2024, command-a, command-r7b-arabic-02-2025…) via HuggingFace Space (G4F)",
  },
  "openaifm": {
    name: "OpenAI.fm",
    description: "17 models (ballad, scientific_style, ash, calm…) via OpenAI.fm (G4F)",
  },
  "opera-aria": {
    name: "Opera Aria",
    description: "1 models (aria) via Opera Aria (G4F)",
  },
  "perplexity-g4f": {
    name: "Perplexity",
    description: "13 models (auto, o3pro, pplx_alpha, pplx_pro_upgraded…) via Perplexity (G4F)",
  },
  "pollinations-g4f": {
    name: "Pollinations",
    description: "4 models (openai-fast, openai, gpt-oss, sana) via Pollinations (G4F)",
  },
  "pollinations-image": {
    name: "Pollinations Image",
    description: "1 models (sana) via Pollinations Image (G4F)",
  },
  "qwen-chat": {
    name: "Qwen Chat",
    description: "16 models (qwen3.5-flash, qwen3.6-27b, qwen3.6-plus, qwen3.6-35b-a3b…) via Qwen Chat (G4F)",
  },
  "wewordle": {
    name: "WeWordle",
    description: "7 models (gpt-4o-mini, gpt-4o, gpt-4, v3…) via WeWordle (G4F)",
  },
  "yqcloud": {
    name: "Yqcloud",
    description: "1 models (gpt-4) via Yqcloud (G4F)",
  },
  "ollama-swarm": {
    name: "OllamaSwarm",
    description: "64 models (deepseek-v4-pro, deepseek-v4-flash, minimax-m2.7, kimi-k2.6…) via OllamaSwarm",
  },
  "easychat": {
    name: "EasyChat",
    description: "2 models (gpt-5, grok-4.1-fast) via EasyChat",
  },
  "search": {
    name: "Web Search",
    description: "DuckDuckGo web search — returns titles, URLs, snippets. POST /api/v1/search {query}",
  },
  "music": {
    name: "Music Generation",
    description: "ACE-Step 1.5 AI music generation — auto-fetches API key, returns base64 audio. POST /api/v1/music/generate",
  },
  "api-airforce": {
    name: "API.AirForce",
    description: "6 models (gpt-4o-mini, gpt-4o, claude-haiku-4.5-p2g, gemini-3.5-pro…) via API.AirForce",
  },
  "audio": {
    name: "Audio",
    description: "1 models (gpt-audio) via Audio",
  },
  "cerebras-ai": {
    name: "Cerebras",
    description: "2 models (zai-glm-4.7, gpt-oss-120b) via Cerebras",
  },
  "community-day-2026": {
    name: "Community Day 2026",
    description: "6 models (zai-org/GLM-5.2, moonshotai/Kimi-K2.7-Code, deepseek-ai/DeepSeek-V4-Pro, empero-ai/Qwythos-9B-Claude-Mythos-5-1M…) via Community Day 2026",
  },
  "crowllm-com": {
    name: "CrowLLM",
    description: "28 models (glm-5.2-thinking, deepseek-v3.2, deepseek-v3, deepseek-v4-pro-thinking…) via CrowLLM",
  },
  "deepinfra-com": {
    name: "DeepInfra",
    description: "2 models (XiaomiMiMo/MiMo-V2.5-Pro, zai-org/GLM-5.2) via DeepInfra",
  },
  "gemini-cli": {
    name: "GeminiCLI",
    description: "2 models (gemini-3-flash-preview, gemini-3.1-flash-lite) via GeminiCLI",
  },
  "gemini-v1beta": {
    name: "Google Gemini API",
    description: "15 models (gemini-flash-lite-latest, gemini-3.5-flash, gemini-3-flash-preview, gemini-3.1-flash-lite…) via Google Gemini API",
  },
  "gen-pollinations-ai": {
    name: "Pollinations Gen",
    description: "12 models (glm-5.2, openai-fast, openai, kimi-k2.6…) via Pollinations Gen",
  },
  "google-antigravity": {
    name: "Google Antigravity",
    description: "6 models (gemini-2.5-flash, gemini-3.1-pro-low, gemini-2.5-flash-lite, gemini-3-flash…) via Google Antigravity",
  },
  "groq-com": {
    name: "Groq",
    description: "7 models (llama-3.3-70b-versatile, openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.6-27b…) via Groq",
  },
  "kobold-llamacpp-swarm": {
    name: "Kobold / llama.cpp",
    description: "4 models (Qwen3.5-9B-Q4_K_M, Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M, Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M, HKUspace) via Kobold / llama.cpp",
  },
  "ktai": {
    name: "KTAI",
    description: "6 models (deepseek-ai/deepseek-v4-pro, deepseek-ai/deepseek-v4-flash, openai/gpt-oss-120b, qwen/qwen3.5-122b-a10b…) via KTAI",
  },
  "modelscope-ai": {
    name: "Modelscope AI",
    description: "21 models (deepseek-ai/deepseek-v4-flash, deepseek-ai/DeepSeek-V4-Pro, zai-org/GLM-5.2, deepseek-ai/DeepSeek-V3.1…) via Modelscope AI",
  },
  "nectar-pollinations-ai": {
    name: "Pollinations Nectar",
    description: "8 models (glm-5.2, deepseek, mistral, openai-fast…) via Pollinations Nectar",
  },
  "nvidia-com": {
    name: "NVIDIA NIM",
    description: "27 models (z-ai/glm-5.2, nvidia/nemotron-3-super-120b-a12b, openai/gpt-oss-120b, deepseek-ai/deepseek-v4-pro…) via NVIDIA NIM",
  },
  "ollama-com": {
    name: "Ollama",
    description: "3 models (gemma4:31b, nemotron-3-nano:30b, nemotron-3-super) via Ollama",
  },
  "ollama-pro": {
    name: "Ollama Pro",
    description: "2 models (gpt-oss:120b, deepseek-v4-pro) via Ollama Pro",
  },
  "opencode-ai-zen": {
    name: "OpenCode.ai",
    description: "2 models (nemotron-3-ultra-free, north-mini-code-free) via OpenCode.ai",
  },
  "openrouter-ai": {
    name: "OpenRouter",
    description: "7 models (google/gemma-4-26b-a4b-it, openrouter/free, nvidia/nemotron-nano-9b-v2, nvidia/nemotron-3-ultra-550b-a55b…) via OpenRouter",
  },
  "perplexity": {
    name: "Perplexity",
    description: "1 models (turbo) via Perplexity",
  },
  "pollinations-ai": {
    name: "Pollinations AI",
    description: "1 models (openai) via Pollinations AI",
  },
  "qwen": {
    name: "Qwen",
    description: "6 models (qwen3.6-plus, qwen3.7-max, qwen3.7-plus, qwen3.7-max…) via Qwen",
  },
};
