/**
 * Provider display-name registry (PRD §15).
 *
 * Upstream catalogs publish providers as routing slugs (e.g. "openrouter",
 * "cloudflare", "ai-horde"). The unified registry preserves these slugs on
 * `UnifiedModel.provider` / `UnifiedProvider.name` so routing stays stable,
 * but the CATALOG UI needs friendly display names for the tabs / headers.
 *
 * This map is the single source of truth for slug → friendly display name.
 * Sources: verified live against `https://gratisfy.xyz/api/models/all`
 * `providerCatalog[].displayName` (2026-08-31) and Pollinations's `brand`
 * field (gen.pollinations.ai). When a slug is missing, the caller falls
 * back to a title-cased version of the slug.
 */

/** Gratisfy routing-slug → friendly display name (36 active slugs). */
export const GRATISFY_PROVIDER_NAMES: Record<string, string> = {
  vercel: "Vercel",
  pollinations: "Pollinations",
  unorouter: "Uno Router",
  "ai-horde": "AI Horde",
  paxsenix: "PaxSenix",
  evolvex: "EvolveX",
  navy: "Navy",
  secrets: "Secrets",
  voidai: "VoidAI",
  cloudflare: "Cloudflare",
  aihubmix: "AIHubMix",
  mistral: "Mistral AI",
  aqua: "Aqua",
  tokenreply: "TokenReply",
  mnn: "MNN AI",
  literouter: "LiteRouter",
  "crax-gpt": "Crax GPT",
  "github-models": "GitHub Models",
  electronhub: "Electron Hub",
  logfare: "Logfare",
  cohere: "Cohere",
  openrouter: "OpenRouter",
  aichixia: "Aichixia",
  "google-ai-studio": "Google AI Studio",
  groq: "Groq",
  blaze: "Blaze",
  naga: "NagaAI",
  "ibm-watsonx": "IBM watsonx",
  meganova: "MegaNova",
  routmy: "Rout.my",
  ollama: "Ollama Cloud",
  "mistral-codestral": "Mistral Codestral",
  zai: "Z.AI",
  "opencode-zen": "OpenCode Zen",
  subaxis: "Subaxis",
  atessa: "Atessa",
};

/** Pollinations brand → friendly display name (common brands). */
export const POLLINATIONS_BRAND_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  qwen: "Qwen",
  llama: "Llama",
  meta: "Meta",
  google: "Google",
  mistral: "Mistral AI",
  elevenlabs: "ElevenLabs",
  perplexity: "Perplexity",
  microsoft: "Microsoft",
  amazon: "Amazon",
  "tomdacatto": "TomdacatAI",
  "tomdacatai": "TomdacatAI",
  deepseek: "DeepSeek",
  "z-ai": "Z.AI",
  zai: "Z.AI",
  nous: "Nous",
  llama3: "Llama3",
  sciphi: "SciPhi",
  llm7: "LLM7",
  evil: "Evil",
  huggingface: "HuggingFace",
  "ai-horde": "AI Horde",
  electrolora: "ElectroLora",
  "generic": "Generic",
};

/** Native short-code provider → friendly display name. */
export const NATIVE_PROVIDER_NAMES: Record<string, string> = {
  tb: "Toolbaz",
  au: "AuroraAI",
  fx: "FreeAIXYZ",
  fc: "FreeChat",
  jg: "JollyGen",
  ki: "Kilo Code",
  llm7: "LLM7",
  oc: "OpenCode",
  sw: "Swarm",
  sp: "SpicyWriter",
  ss: "SurfSense",
  ua: "UnlimitedAI",
  vx: "Vexa",
  go: "GPT-OSS",
};

/**
 * Resolve the friendly display name for a provider across all sources.
 * Falls back to a title-cased slug when no explicit mapping exists.
 *
 * @param source  the model source ("native" | "gratisfy" | "pollinations")
 * @param provider the routing slug / brand / short code
 */
export function providerDisplayName(
  source: "native" | "gratisfy" | "pollinations",
  provider: string,
): string {
  if (source === "native") {
    return NATIVE_PROVIDER_NAMES[provider] ?? titleCase(provider);
  }
  if (source === "gratisfy") {
    return GRATISFY_PROVIDER_NAMES[provider] ?? titleCase(provider);
  }
  if (source === "pollinations") {
    return (
      POLLINATIONS_BRAND_NAMES[provider.toLowerCase()] ??
      POLLINATIONS_BRAND_NAMES[provider] ??
      titleCase(provider)
    );
  }
  return titleCase(provider);
}

function titleCase(slug: string): string {
  if (!slug) return "Unknown";
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
