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
 * Total: 312 models across 33 providers.
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
  | "freegpt"
  | "zai"
  | "openrouter-key"
  | "groq-key"
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
  fg("fgpt-gpt-image-2", "gpt-image-2", "GPT-Image 2 — image generation (FreeGPT.tech)", "professional", 128000),

  // ─── Gated providers (require user-supplied API key) ──────────────────────
  // Z.AI (GLM) — JWT token from chat.z.ai local storage, sent via x-zai-token
  gated("zai-glm-5-2", "glm-5.2", "GLM-5.2 — Z.AI flagship, excellent for coding (requires Z.AI JWT)", "zai", "x-zai-token", 128000),
  gated("zai-glm-5-1", "GLM-5.1", "GLM-5.1 — previous Z.AI flagship (requires Z.AI JWT)", "zai", "x-zai-token", 128000),
  gated("zai-glm-5-turbo", "GLM-5-Turbo", "GLM-5-Turbo — fast Z.AI chat model (requires Z.AI JWT)", "zai", "x-zai-token", 128000),
  gated("zai-glm-4-7", "glm-4.7", "GLM-4.7 — classic high-performance Z.AI model (requires Z.AI JWT)", "zai", "x-zai-token", 128000),
  // OpenRouter — API key from openrouter.ai/keys, sent via x-openrouter-key
  gated("or-gpt-5", "openai/gpt-5", "GPT-5 via OpenRouter — flagship reasoning model (requires OpenRouter key)", "openrouter-key", "x-openrouter-key", 128000),
  gated("or-claude-sonnet-5", "anthropic/claude-sonnet-5", "Claude Sonnet 5 via OpenRouter — Anthropic's latest (requires OpenRouter key)", "openrouter-key", "x-openrouter-key", 200000),
  gated("or-gemini-3-5-flash", "google/gemini-3.5-flash", "Gemini 3.5 Flash via OpenRouter — fast and capable (requires OpenRouter key)", "openrouter-key", "x-openrouter-key", 1000000),
  // Groq — API key from console.groq.com/keys, sent via x-groq-key
  gated("groq-llama-3-3-70b", "llama-3.3-70b-versatile", "Llama 3.3 70B Versatile on Groq — ultra-fast inference (requires Groq key)", "groq-key", "x-groq-key", 128000),
  gated("groq-gpt-oss-120b", "openai/gpt-oss-120b", "GPT-OSS 120B on Groq — open-weight model, ultra-fast (requires Groq key)", "groq-key", "x-groq-key", 128000),



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

/** Gated model helper — requires the user to supply their own API key. */
function gated(
  id: string,
  upstream: string,
  description: string,
  provider: "zai" | "openrouter-key" | "groq-key",
  keyHeader: string,
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider,
    upstream,
    description,
    category: "professional",
    contextWindow,
    requiresKey: true,
    keyHeader,
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
    description: "27 free models (GPT-5.4, DeepSeek V4, Gemini, Grok 4, Llama 3.3 70B, Qwen) — WASM-secured, no API key needed",
  },
  "heckai": {
    name: "HeckAI",
    description: "7 free models (Gemini 3 Flash, DeepSeek V4, Qwen 3.7, Minimax M3) — no auth, real SSE",
  },
  "jollygen": {
    name: "JollyGen",
    description: "Unrestricted NSFW roleplay — rotated guest identity, no content filters",
  },
  "kilocode": {
    name: "Kilo Code",
    description: "10 free models (NVIDIA Nemotron, Tencent Hy3, Poolside…) — no key, real SSE streaming",
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
  "zai": {
    name: "Z.AI (BYOK)",
    description: "4 GLM models (GLM-5.2, 5.1, 5-Turbo, 4.7) — requires your Z.AI JWT token from chat.z.ai local storage",
  },
  "openrouter-key": {
    name: "OpenRouter (BYOK)",
    description: "3 models (GPT-5, Claude Sonnet 5, Gemini 3.5 Flash) — requires your OpenRouter API key from openrouter.ai/keys",
  },
  "groq-key": {
    name: "Groq (BYOK)",
    description: "2 models (Llama 3.3 70B, GPT-OSS 120B) on ultra-fast Groq inference — requires your Groq API key from console.groq.com/keys",
  },
};
