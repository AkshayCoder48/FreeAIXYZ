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
 */

export type ProviderId =
  | "toolbaz"
  | "nsfwlover"
  | "freeaionline"
  | "surfsense"
  | "jollygen"
  | "unlimitedai"
  | "pollinations"
  | "g4f"
  | "kilocode"
  | "llm7";

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
  tb("llama-4-maverick", "llama-4-maverick", "Llama 4 Maverick", "professional", 1000000),
  tb("L3-70B-Euryale-v2.1", "L3-70B-Euryale-v2.1", "L3-70B Euryale v2.1", "sfw", 8000),
  tb("midnight-rose", "midnight-rose", "Midnight Rose", "sfw", 8000),

  // ─── nsfwlover.com provider: uncensored NSFW roleplay (real streaming) ────
  nsfw("nsfw-llama3-8b", "llama3-8b", "Uncensored LLaMA-3 8B roleplay (sao10k/l3-lunaris-8b) — real token streaming, no content filters", 8000),

  // ─── free-ai-online.com provider: best-effort, may be captcha-gated ──────
  fao("grok-4-free", "Grok4_free_online", "Grok 4 (free, ad-supported WordPress frontend) — experimental, may be captcha-gated", 8000),

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

  // ─── g4f (GPT4Free) provider: 96+ aggregated free providers ─────────────
  g4f("gpt-4o", "gpt-4o", "GPT-4o — OpenAI multimodal flagship (via g4f aggregator)", "professional", 128000),
  g4f("gpt-4o-mini", "gpt-4o-mini", "GPT-4o Mini — fast, lightweight (via g4f aggregator)", "professional", 128000),
  g4f("gpt-4.1-nano", "gpt-4.1-nano", "GPT-4.1 Nano — ultra-fast, lightweight", "professional", 128000),
  g4f("gpt-5", "gpt-5", "GPT-5 — OpenAI's flagship model (via g4f aggregator)", "professional", 128000),
  g4f("gpt-5-nano", "gpt-5-nano", "GPT-5 Nano — fast, lightweight GPT-5 variant", "professional", 128000),
  g4f("gpt-5.4-nano", "gpt-5.4-nano", "GPT-5.4 Nano — latest lightweight GPT variant", "professional", 128000),
  g4f("o3-mini", "o3-mini", "O3 Mini — OpenAI reasoning model (via g4f aggregator)", "reasoning", 200000),
  g4f("smart", "smart", "Smart — balanced general-purpose model", "professional", 128000),
  g4f("reasoning", "reasoning", "Reasoning — deep step-by-step thinking model", "reasoning", 128000),
  g4f("chat", "chat", "Chat — conversational general-purpose model", "professional", 128000),
  g4f("mistral-nemo", "mistral-nemo", "Mistral Nemo — efficient 12B model by Mistral AI", "professional", 128000),
  g4f("command-r", "command-r", "Command R — Cohere's retrieval-augmented model", "professional", 128000),
  g4f("command-a", "command-a", "Command A — Cohere's flagship enterprise model", "professional", 256000),
  g4f("deepseek-coder", "deepseek-coder", "DeepSeek Coder — specialized for code generation", "professional", 128000),
  g4f("openai", "openai", "OpenAI — general-purpose via g4f aggregator", "professional", 128000),
  // NSFW models from g4f
  g4f("nsfw-unmoderated-gpt", "unmoderated-gpt", "Unmoderated GPT — uncensored, no content filters (via g4f)", "nsfw", 128000),
  g4f("nsfw-seed-rp", "seed-rp", "Seed RP — uncensored roleplay model, no content filters (via g4f)", "nsfw", 128000),
  g4f("nsfw-plutotext", "plutotext-r3-emotional", "PlutoText R3 Emotional — uncensored emotional roleplay (via g4f)", "nsfw", 128000),
  // Additional g4f working models (225+ verified working, daily-updated)
  g4f("gpt-4", "gpt-4", "GPT-4 — OpenAI's legacy flagship (via g4f)", "professional", 8192),
  g4f("deepseek-r1", "deepseek-r1", "DeepSeek R1 — advanced reasoning model (via g4f)", "reasoning", 64000),
  g4f("deepseek", "deepseek", "DeepSeek — general-purpose chat (via g4f)", "professional", 64000),
  g4f("nova", "nova", "Nova — fast general-purpose model (via g4f)", "professional", 128000),
  g4f("study", "study", "Study — educational assistance model (via g4f)", "sfw", 128000),
  g4f("search", "search", "Search — web-informed answers (via g4f)", "professional", 128000),
  g4f("gpt-5.4-mini", "gpt-5.4-mini", "GPT-5.4 Mini — lightweight latest-gen (via g4f)", "professional", 128000),
  g4f("gpt-5.5", "gpt-5.5", "GPT-5.5 — next-gen OpenAI model (via g4f)", "professional", 128000),
  g4f("gpt-5.6-luna", "gpt-5.6-luna", "GPT-5.6 Luna — OpenAI variant (via g4f)", "professional", 128000),
  g4f("gpt-5.6-sol", "gpt-5.6-sol", "GPT-5.6 Sol — OpenAI variant (via g4f)", "professional", 128000),
  g4f("gpt-5.6-terra", "gpt-5.6-terra", "GPT-5.6 Terra — OpenAI variant (via g4f)", "professional", 128000),
  g4f("claude-sonnet-5", "claude-sonnet-5", "Claude Sonnet 5 — Anthropic's latest (via g4f)", "professional", 200000),
  g4f("claude-fable-5", "claude-fable-5", "Claude Fable 5 — Anthropic storytelling model (via g4f)", "professional", 200000),
  g4f("kimi-k2", "kimi-k2", "Kimi K2 — Moonshot long-context model (via g4f)", "professional", 128000),
  g4f("kimi-k2.6", "kimi-k2.6", "Kimi K2.6 — latest Moonshot model (via g4f)", "professional", 128000),
  g4f("minimax-m2", "minimax-m2", "Minimax M2 — Chinese AI model (via g4f)", "professional", 128000),
  g4f("minimax-m2.5", "minimax-m2.5", "Minimax M2.5 — latest Chinese AI (via g4f)", "professional", 196000),
  g4f("glm-4.6", "glm-4.6", "GLM 4.6 — Zhipu AI model (via g4f)", "professional", 128000),
  g4f("grok-4.1-fast", "grok-4.1-fast", "Grok 4.1 Fast — xAI's fast model (via g4f)", "professional", 131000),
  g4f("qwen-3.5-flash", "qwen-3.5-flash", "Qwen 3.5 Flash — Alibaba fast model (via g4f)", "professional", 262144),
  g4f("qwen-3.6-max", "qwen-3.6-max", "Qwen 3.6 Max — Alibaba flagship (via g4f)", "professional", 262144),
  g4f("qwen-3.7-plus", "qwen-3.7-plus", "Qwen 3.7 Plus — Alibaba enhanced (via g4f)", "professional", 262144),
  g4f("qwen-3.5-plus", "qwen-3.5-plus", "Qwen 3.5 Plus — Alibaba balanced (via g4f)", "professional", 262144),
  g4f("qwen-3-coder-plus", "qwen-3-coder-plus", "Qwen 3 Coder Plus — Alibaba code model (via g4f)", "professional", 1048576),
  g4f("qwen-plus", "qwen-plus", "Qwen Plus — Alibaba general (via g4f)", "professional", 262144),
  g4f("qwen-3-max", "qwen-3-max", "Qwen 3 Max — Alibaba flagship (via g4f)", "professional", 262144),
  g4f("qwen-3.5-397b", "qwen-3.5-397b-a17b", "Qwen 3.5 397B — Alibaba massive MoE (via g4f)", "professional", 262144),
  g4f("command-r-plus24", "command-r-plus24", "Command R+ 2024 — Cohere enhanced (via g4f)", "professional", 128000),
  g4f("command-r24", "command-r24", "Command R 2024 — Cohere updated (via g4f)", "professional", 128000),
  g4f("command-r7b24", "command-r7b24", "Command R7B 2024 — Cohere lightweight (via g4f)", "professional", 128000),
  g4f("command-r7b-arabic25", "command-r7b-arabic25", "Command R7B Arabic 2025 — Cohere multilingual (via g4f)", "professional", 128000),
  g4f("command-a25", "command-a25", "Command A 2025 — Cohere latest flagship (via g4f)", "professional", 256000),
  g4f("felo-chat", "felo-chat", "Felo Chat — AI assistant (via g4f)", "professional", 128000),
  g4f("felo-search", "felo-search", "Felo Search — AI web search (via g4f)", "professional", 128000),
  g4f("pplx-pro", "pplx_pro", "Perplexity Pro — AI search reasoning (via g4f)", "reasoning", 128000),
  g4f("llama-405b", "llama3.1:405b", "Llama 3.1 405B — Meta's largest model (via g4f)", "professional", 131072),
  g4f("llama-70b", "llama3.1:70b", "Llama 3.1 70B — Meta large model (via g4f)", "professional", 131072),
  g4f("llama-8b", "llama3.1:8b", "Llama 3.1 8B — Meta lightweight (via g4f)", "professional", 131072),
  g4f("qwq-32b", "qwq:32b", "QwQ 32B — Qwen reasoning model (via g4f)", "reasoning", 131072),
  g4f("qwen3-32b", "qwen3:32b-q8_0", "Qwen 3 32B — Alibaba mid-size (via g4f)", "professional", 131072),
  g4f("qwen-72b", "qwen2.5:72b", "Qwen 2.5 72B — Alibaba large (via g4f)", "professional", 131072),
  g4f("gemma-27b", "gemma3:27b", "Gemma 3 27B — Google open model (via g4f)", "professional", 131072),
  g4f("phi4", "phi4:latest", "Phi-4 — Microsoft's latest SLM (via g4f)", "professional", 131072),
  g4f("deepseek-r1-70b", "deepseek-r1:70b", "DeepSeek R1 70B — reasoning (via g4f)", "reasoning", 64000),
  g4f("deepseek-v3-671b", "deepseek-v3.1:671b", "DeepSeek V3.1 671B — massive MoE (via g4f)", "professional", 64000),
  g4f("codestral-22b", "codestral:22b-v0.1-q8_0", "Codestral 22B — Mistral code model (via g4f)", "professional", 256000),
  g4f("nsfw-llama-uncensored", "llama2-uncensored:latest", "Llama 2 Uncensored — no content filters (via g4f)", "nsfw", 4096),
  g4f("gpt-oss-120b", "gpt-oss:120b", "GPT-OSS 120B — OpenAI open-weight large (via g4f)", "professional", 131072),
  g4f("gpt-oss-20b-g4f", "gpt-oss:20b", "GPT-OSS 20B — OpenAI open-weight fast (via g4f)", "professional", 131072),
  g4f("nemotron-ultra-cloud", "nemotron-3-ultra:cloud", "NVIDIA Nemotron 3 Ultra — cloud reasoning (via g4f)", "reasoning", 1000000),
  g4f("nemotron-super-cloud", "nemotron-3-super:cloud", "NVIDIA Nemotron 3 Super — cloud (via g4f)", "professional", 1000000),
  g4f("mistral-small-24b", "mistral-small3.1:24b-instruct-2503-q8_0", "Mistral Small 3.1 24B — efficient (via g4f)", "professional", 128000),

  // ─── Kilo Code provider: 10 free models, no key, real SSE ───────────────
  kc("tencent-hy3", "tencent/hy3:free", "Tencent Hy3 — large-scale Chinese/English model", "professional", 262144),
  kc("stepfun-flash", "stepfun/step-3.7-flash:free", "StepFun Step 3.7 Flash — fast Chinese AI model", "professional", 262144),
  kc("nemotron-ultra", "nvidia/nemotron-3-ultra-550b-a55b:free", "NVIDIA Nemotron 3 Ultra (550B) — flagship reasoning model", "reasoning", 1000000),
  kc("nemotron-super", "nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA Nemotron 3 Super (120B) — high-performance model", "professional", 1000000),
  kc("nemotron-nano-omni", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "NVIDIA Nemotron 3 Nano Omni (30B) — compact reasoning", "reasoning", 256000),
  kc("nemotron-safety", "nvidia/nemotron-3.5-content-safety:free", "NVIDIA Nemotron 3.5 Content Safety — moderation model", "sfw", 128000),
  kc("laguna-xs", "poolside/laguna-xs-2.1:free", "Poolside Laguna XS 2.1 — code-optimized model", "professional", 262144),
  kc("laguna-m", "poolside/laguna-m.1:free", "Poolside Laguna M.1 — balanced code model", "professional", 262144),
  kc("cohere-north-code", "cohere/north-mini-code:free", "Cohere North Mini Code — lightweight code model", "professional", 256000),
  kc("kilo-auto-free", "kilo-auto/free", "Kilo Auto Free — auto-routes to best available free model", "professional", 262144),

  // ─── LLM7.io provider: free anonymous, no key ───────────────────────────
  l7("gpt-oss-20b", "gpt-oss:20b", "GPT-OSS 20B — OpenAI open-weight model, free anonymous access", "professional", 131072),
  l7("minimax-m27", "minimax-m2.7", "Minimax M2.7 — latest Minimax model, free anonymous access", "professional", 196000),
  l7("codestral-latest", "codestral-latest", "Codestral — Mistral's code generation model, free anonymous", "professional", 256000),
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

/** free-ai-online.com model helper. Experimental; may be blocked. */
function fao(
  id: string,
  upstream: string,
  description: string,
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "freeaionline",
    upstream,
    description,
    category: "sfw",
    contextWindow,
    experimental: true,
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
      tools: true, // via prompt injection
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
      streaming: true, // genuine upstream SSE
      tools: true, // via prompt injection
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

/** g4f (GPT4Free) model helper. Aggregates 96+ free providers via Python. */
function g4f(
  id: string,
  upstream: string,
  description: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "g4f",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true, // g4f streams via Python wrapper
      tools: true, // via prompt injection
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
  // Unknown ids: pass through to toolbaz (which may still accept it).
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
  toolbaz: {
    name: "Toolbaz",
    description: "Free multi-model aggregator (gpt-5, claude, gemini, grok, deepseek…)",
  },
  nsfwlover: {
    name: "NSFWLover",
    description: "Uncensored LLaMA-3 roleplay engine with real token streaming",
  },
  freeaionline: {
    name: "Free-AI-Online",
    description: "Ad-supported WordPress AI frontend (experimental)",
  },
  surfsense: {
    name: "SurfSense",
    description: "Free no-login chat with real token streaming (gpt-5.4-mini, o4-mini)",
  },
  jollygen: {
    name: "JollyGen",
    description: "Unrestricted NSFW roleplay — rotated guest identity, no content filters",
  },
  unlimitedai: {
    name: "UnlimitedAI",
    description: "Uncensored reasoning + web search, NDJSON token streaming",
  },
  pollinations: {
    name: "Pollinations",
    description: "Free no-auth OpenAI-compatible API with real token streaming and reasoning",
  },
  g4f: {
    name: "GPT4Free",
    description: "Aggregates 96+ free AI providers (Pollinations, OpenaiChat, HuggingFace…) — auto-retries",
  },
  kilocode: {
    name: "Kilo Code",
    description: "10 free models (NVIDIA Nemotron, Tencent Hy3, Poolside…) — no key, real SSE streaming",
  },
  llm7: {
    name: "LLM7.io",
    description: "Free anonymous no-key access to GPT-OSS, Minimax, Codestral",
  },
};
