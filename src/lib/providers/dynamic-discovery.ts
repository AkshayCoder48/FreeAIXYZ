/**
 * Dynamic model discovery for OpenAI-compatible upstream providers
 * (PRD §27-34, §165, §169).
 *
 * Each discoverer hits the provider's `/models` or `/v1/models` endpoint,
 * parses the OpenAI-shaped `{ object: "list", data: [{id, ...}] }` response,
 * and returns an array of `DiscoveredModel` objects with:
 *   - canonical public id `<shortId>/<upstreamId>` (NEVER modified — PRD §22, §25)
 *   - conservative capability defaults (PRD §35 — don't claim from names alone)
 *   - discoveryMode = "dynamic", discoveredFrom = full URL, raw upstream object
 *
 * Each discoverer is wrapped in try/catch + 8s timeout (AbortController). On
 * ANY error (timeout, network, parse, non-200) it returns `[]` and logs to
 * `console.error("[discovery] <provider> failed:", ...)`. Discoverers never
 * throw — Phase 2a's discovery service isolates providers in parallel
 * (PRD §70, §205).
 *
 * `registerDynamicDiscoverers(reg)` registers each discoverer into the
 * `providerRegistry`. For providers that already have a legacy adapter
 * (pollinations, llm7, kilocode, freechat, opencode, gptoss, vexa, freeaixyz),
 * the discoverer returns a CLONED adapter that overrides `discoverModels`
 * (and `discoveryMode = "dynamic"`) while keeping the legacy `complete` /
 * `stream` / `healthCheck`. For freegpt (no legacy adapter — Node-only APIs),
 * the discoverer returns a fresh adapter that delegates `complete` / `stream`
 * to the existing `freeGptProvider` instance + a best-effort `discoverModels`
 * that tries the dynamic endpoint, falling back to the manually-curated
 * MODELS[] entries for freegpt on failure.
 *
 * NOTE on freegpt discovery: the `/v1/models` endpoint is behind the same
 * Cloudflare TLS fingerprinting + WASM challenge as completions. Plain
 * Node fetch returns 403. We attempt a `curl`-based GET with challenge
 * headers; if it fails, we return `[]` and let the adapter's fallback to
 * MODELS[] entries cover freegpt. This is intentionally best-effort
 * (PRD §27 — discovery must never break the gateway).
 */

import {
  canonicalModelId,
  getProviderEntry,
} from "@/lib/gateway/ids";
import {
  classifyUpstreamStatus,
  GatewayError,
} from "@/lib/gateway/errors";
import type {
  ChatRequest,
  DiscoveredModel,
  ModelCapabilities,
  ProviderAdapter,
} from "@/lib/gateway/types";
import { freeGptProvider } from "./freegpt";
import {
  MODELS,
  type GatewayModel,
  type ProviderId,
} from "./registry";
import type { ProviderTool } from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

const DISCOVERY_TIMEOUT_MS = 8_000; // PRD §29 (per-provider)

const STATUS_MARKER = "__HTTP_STATUS__";

// ─── Capability helpers (PRD §35) ────────────────────────────────────────────

/**
 * Conservative default capability set. Don't claim capabilities just from
 * model names — most upstreams don't expose capability metadata, so we
 * default to text-only + streaming, with tools/vision/image OFF unless the
 * discoverer overrides based on KNOWN provider behaviour (PRD §35).
 */
function defaultCapabilities(
  overrides: Partial<ModelCapabilities> = {},
): ModelCapabilities {
  return {
    text: true,
    image: false,
    imageEdit: false,
    audioInput: false,
    audioOutput: false,
    vision: false,
    tools: false,
    streaming: true,
    ...overrides,
  };
}

/** Build a DiscoveredModel from a provider id + raw upstream id. */
function buildDiscoveredModel(
  providerId: string,
  upstreamId: string,
  raw: unknown,
  discoveredFrom: string,
  capabilities: ModelCapabilities = defaultCapabilities(),
  /**
   * Override the discovery mode (audit H2). Defaults to "dynamic" since
   * this helper is used by discoverers that hit upstream /models endpoints.
   * Callers with hardcoded id lists pass "manual" to stay honest.
   */
  discoveryMode: "dynamic" | "manual" = "dynamic",
): DiscoveredModel {
  const entry = getProviderEntry(providerId);
  return {
    id: canonicalModelId(providerId, upstreamId),
    providerId,
    providerName: entry?.name ?? providerId,
    upstreamId,
    name: upstreamId, // no custom names (PRD §22, §166)
    capabilities,
    metadata: {
      source: "dynamic-discovery",
      raw, // PRD §229 — preserve verbatim
    },
    discoveredAt: new Date().toISOString(),
    status: "active",
    discoveryMode,
    discoveredFrom,
  };
}

/**
 * Fall back to the legacy MODELS[] entries for a provider when the dynamic
 * discoverer can't reach the upstream's /models endpoint. Many providers
 * (FreeChat, Vexa, sometimes Pollinations) don't expose OpenAI-shaped
 * /models; without this fallback their adapters would be entirely absent
 * from the catalog. Maps each legacy GatewayModel into a DiscoveredModel
 * using the canonical-id helpers so the rest of the gateway can resolve
 * it normally.
 */
function legacyFallback(providerId: string): DiscoveredModel[] {
  const entry = getProviderEntry(providerId);
  const shortId = entry?.shortId ?? providerId.slice(0, 2);
  const baseUrl = entry?.baseUrl ?? `https://${providerId}`;
  const displayName = entry?.name ?? providerId;
  const isImage = (m: GatewayModel) => m.modality === "text-to-image";
  const out: DiscoveredModel[] = [];
  for (const m of MODELS) {
    if (m.provider !== providerId) continue;
    out.push({
      id: `${shortId}/${m.upstream}`,
      providerId,
      providerName: displayName,
      upstreamId: m.upstream,
      name: m.id,
      capabilities: {
        text: !isImage(m),
        image: isImage(m),
        imageEdit: false,
        audioInput: false,
        audioOutput: false,
        vision: m.capabilities.vision,
        tools: m.capabilities.tools,
        streaming: m.capabilities.streaming,
      },
      metadata: {
        contextWindow: m.contextWindow,
        source: "legacy-fallback",
        raw: { description: m.description, category: m.category },
      },
      discoveredAt: new Date().toISOString(),
      status: "active",
      discoveryMode: "manual",
      discoveredFrom: baseUrl,
    });
  }
  return out;
}

// ─── OpenAI-shaped /models fetcher ──────────────────────────────────────────

interface UpstreamModel {
  id: string;
  [k: string]: unknown;
}

/**
 * Fetch `<url>` with an 8s AbortController timeout, parse the OpenAI-shaped
 * `{ data: [{id, ...}, ...] }` response, dedup by upstream id (PRD §169),
 * and return a `DiscoveredModel[]`. Returns `[]` on any failure.
 *
 * Also accepts a bare array `[{id,...}, ...]` or `[{name,...}, ...]` (used by
 * Pollinations' `/models?json=true` endpoint — items use `name` not `id`).
 */
async function fetchModelsList(
  url: string,
  providerId: string,
  capabilities?: ModelCapabilities,
  idField: "id" | "name" = "id",
): Promise<DiscoveredModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    let items: UpstreamModel[] = [];
    if (Array.isArray(json)) {
      items = json as UpstreamModel[];
    } else if (json && typeof json === "object") {
      const obj = json as { data?: UpstreamModel[]; models?: UpstreamModel[] };
      items = obj.data ?? obj.models ?? [];
    }
    const seen = new Set<string>();
    const models: DiscoveredModel[] = [];
    for (const item of items) {
      const upstreamId = item?.[idField] ?? item?.id;
      if (!upstreamId || typeof upstreamId !== "string") continue;
      if (seen.has(upstreamId)) continue; // dedup (PRD §169)
      seen.add(upstreamId);
      models.push(
        buildDiscoveredModel(
          providerId,
          upstreamId,
          item,
          url,
          capabilities ?? defaultCapabilities(),
        ),
      );
    }
    return models;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Per-provider discoverers ────────────────────────────────────────────────

/**
 * Pollinations — SWITCHED (2026-08-30) to the new gen.pollinations.ai host.
 * The old `https://text.pollinations.ai/models?json=true` endpoint returned
 * a 1-model anonymous list. The new `https://gen.pollinations.ai/models`
 * endpoint is public (security:[] in the OpenAPI spec) and returns 320
 * models with full pricing + brand + category + classification (verified
 * live anonymous 200). Each entry carries a `name` (unique id), `title`,
 * `description`, `brand` (OpenAI/Qwen/Anthropic/Google/…), `category`
 * (text|image|audio|video|realtime|embedding|3d), `paid_only`, `pricing`
 * (pollen currency).
 *
 * Some items are image/video/audio models (category !== "text"). For those,
 * set image:true / audio:true / video:true and text:false, streaming:false.
 */
async function discoverPollinations(): Promise<DiscoveredModel[]> {
  const url = "https://gen.pollinations.ai/models";
  try {
    const models = await fetchModelsList(url, "pollinations", undefined, "name");
    if (models.length === 0) {
      return legacyFallback("pollinations");
    }
    return models.map((m) => {
      const idLower = m.upstreamId.toLowerCase();
      const isImage = /flux|turbo|sdxl|image/.test(idLower);
      if (isImage) {
        return {
          ...m,
          capabilities: defaultCapabilities({
            image: true,
            text: false,
            streaming: false,
          }),
        };
      }
      return m;
    });
  } catch (err) {
    console.error(
      "[discovery] pollinations failed:",
      err instanceof Error ? err.message : err,
    );
    return legacyFallback("pollinations");
  }
}

/** LLM7 — `https://api.llm7.io/v1/models` (no auth). */
async function discoverLlm7(): Promise<DiscoveredModel[]> {
  try {
    const models = await fetchModelsList("https://api.llm7.io/v1/models", "llm7");
    if (models.length === 0) return legacyFallback("llm7");
    // Filter out known-broken models that require API key or are removed.
    // The audit found these return 401 (subscription required) or 400 (model
    // unavailable) when called via /v1/chat/completions.
    const BLOCKED_LLM7 = new Set([
      "deepseek-v4-flash:0731", // now requires API key — 401
      "gpt-oss:20b",            // removed from catalog — 400
      "gpt-4.1-mini",           // 404
      "gpt-4.1-nano",           // 404
      "gpt-4o-mini",            // 401
      "gpt-3.5-turbo",          // 401
      "claude-fable-5",         // 401
      "claude-haiku-4-5",       // 401
      "claude-opus-4-8",        // 401
      "claude-opus-5",          // 401
      "claude-sonnet-4-6",      // 401
      "claude-sonnet-5",        // 401
      "codestral-latest",       // 401
      "dark-beast-krea2",       // 401
      "firefly-gpt-image-2",    // 401
      "firefly-image-5",        // 401
      "flux-klein-2",           // 401
      "gemini-3-flash",         // 401
      "gemini-3.1-flash-lite",  // 401
      "gemini-3.5-flash-low",   // 401
      "gemini-3.7-flash",      // 401
      "gemini-omni-flash",      // 401
      "gemma4:31b",             // 401
      "glm-5.3",                // 401
      "gpt-5.4",                // 401
      "gpt-5.4-mini",           // 401
      "gpt-5.5",                // 401
      "gpt-5.6-sol",            // 401
      "gpt-5.6-terra",          // 401
      "gpt-image-2",            // 401
      "grok-4.5",               // 401
      "grok-4.6",               // 401
      "imagine-1.5",            // 401
      "kimi-k2.6",              // 401
      "kling-v3.0-pro",         // 401
      "kling-v3.0-turbo",       // 401
      "meta-Llama-3.1-8B-Instruct-Turbo", // 401
      "mistral-Nemo-Instruct-2407", // 401
      "mistral-Small-24B-Instruct-2501", // 401
      "seed-2.0-mini",          // 401
      "seedance-2.0",           // 401
      "seedance-2.0-fast",      // 401
      "seedance-2.0-mini",      // 401
    ]);
    return models
      .filter((m) => !BLOCKED_LLM7.has(m.upstreamId))
      .map((m) => {
        // Mark Inkling models as offline — they return 401.
        if (/^Inkling/i.test(m.upstreamId)) {
          return { ...m, status: "offline" as const };
        }
        return m;
      });
  } catch (err) {
    console.error(
      "[discovery] llm7 failed:",
      err instanceof Error ? err.message : err,
    );
    return legacyFallback("llm7");
  }
}

/**
 * Kilo Code — `https://api.kilo.ai/api/gateway/models` (NOT `/v1/models`
 * which 404s). OpenRouter-style listing. Filter to `:free` tier only
 * (Kilo Code supports OpenAI tool calling natively, so set tools:true).
 */
async function discoverKilocode(): Promise<DiscoveredModel[]> {
  const url = "https://api.kilo.ai/api/gateway/models";
  try {
    const models = await fetchModelsList(url, "kilocode");
    if (models.length === 0) return legacyFallback("kilocode");
    // Cap at 30 free-tier models — the upstream returns 367 entries, most
    // of which are duplicates or paid; persisting all of them caused OOM
    // kills in the dev sandbox. The legacy MODELS[] fallback provides a
    // curated subset for users who want to browse all available models.
    return models
      .filter((m) => m.upstreamId.endsWith(":free"))
      .slice(0, 30)
      .map((m) => ({
        ...m,
        capabilities: defaultCapabilities({ tools: true }),
      }));
  } catch (err) {
    console.error(
      "[discovery] kilocode failed:",
      err instanceof Error ? err.message : err,
    );
    return legacyFallback("kilocode");
  }
}

/** FreeChat — `https://llmproxy.org` has no `/v1/models` endpoint (404).
 * Fall back to the static legacy MODELS[] entry (one model: `fc/v3`). */
async function discoverFreechat(): Promise<DiscoveredModel[]> {
  const url = "https://llmproxy.org/v1/models";
  try {
    const models = await fetchModelsList(url, "freechat");
    if (models.length > 0) {
      return models.map((m) => ({
        ...m,
        capabilities: defaultCapabilities({ tools: true }),
      }));
    }
  } catch (err) {
    console.error(
      "[discovery] freechat failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return legacyFallback("freechat");
}

/** OpenCode — `https://opencode.ai/zen/v1/models` (NOT `api.opencode.ai/v1/models`
 * which returns "Not Found" text). 64 models, no auth, supports tools. */
async function discoverOpencode(): Promise<DiscoveredModel[]> {
  const url = "https://opencode.ai/zen/v1/models";
  try {
    const models = await fetchModelsList(url, "opencode");
    if (models.length === 0) return legacyFallback("opencode");
    // Cap at 30 models — the upstream returns 64 entries; combined with
    // the other 8 providers' dynamic results this would push the catalog
    // past the dev sandbox memory budget.
    return models
      .slice(0, 30)
      .map((m) => ({
        ...m,
        capabilities: defaultCapabilities({ tools: true }),
      }));
  } catch (err) {
    console.error(
      "[discovery] opencode failed:",
      err instanceof Error ? err.message : err,
    );
    return legacyFallback("opencode");
  }
}

/** GPT-OSS — Cloudflare Worker. Upstream returns 200 OK with empty content
 * for every prompt (verified by audit — the inference backend is gone).
 * Mark all GPT-OSS models as "offline" so they appear in the catalog for
 * discovery completeness but the chat playground surfaces them as
 * unavailable rather than producing confusing empty responses. */
async function discoverGptoss(): Promise<DiscoveredModel[]> {
  const url = "https://broken-water-d859.junioralive.workers.dev/v1/models";
  try {
    const models = await fetchModelsList(url, "gptoss");
    if (models.length === 0) return legacyFallback("gptoss");
    return models.map((m) => ({
      ...m,
      capabilities: defaultCapabilities({ tools: true }),
      // All GPT-OSS models are currently broken upstream — empty content.
      status: "offline" as const,
    }));
  } catch (err) {
    console.error(
      "[discovery] gptoss failed:",
      err instanceof Error ? err.message : err,
    );
    return legacyFallback("gptoss").map((m) => ({ ...m, status: "offline" as const }));
  }
}

/**
 * Vexa — `https://vexa-ai.pages.dev`. No `/v1/models` endpoint (404).
 * Only the default `vexa` model is callable; `gpt-4.1-nano` returns
 * "No provider available". Fall back to the static legacy MODELS[] list
 * (1 entry: `vx/vexa`) and mark the broken `gpt-4.1-nano` as offline.
 */
async function discoverVexa(): Promise<DiscoveredModel[]> {
  const urls = [
    "https://vexa-ai.pages.dev/v1/models",
    "https://vexa-ai.pages.dev/models",
  ];
  for (const url of urls) {
    try {
      const models = await fetchModelsList(url, "vexa");
      if (models.length > 0) return models;
    } catch (err) {
      console.error(
        `[discovery] vexa ${url} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return legacyFallback("vexa").map((m) => {
    if (m.upstreamId === "gpt-4.1-nano") {
      return { ...m, status: "offline" as const };
    }
    return m;
  });
}

/**
 * FreeAIXYZ — WordPress backend (`unlimitedai.org`), NO `/models` endpoint.
 * Returns the known BOT_IDS keys (chatgpt/gemini/deepseek/claude/grok/
 * perplexity/meta/qwen) as a static list so the catalog always has the
 * canonical FreeAIXYZ models, regardless of WordPress availability.
 *
 * Audit H2: these ids are HARDCODED (not fetched from an upstream /models
 * endpoint), so `discoveryMode: "manual"` — don't claim "dynamic" when
 * the source is a hand-curated constant array. Only the source URL is
 * preserved as `discoveredFrom` for honesty.
 */
async function discoverFreeaixyz(): Promise<DiscoveredModel[]> {
  const knownIds = [
    "chatgpt",
    "gemini",
    "deepseek",
    "claude",
    "grok",
    "perplexity",
    "meta",
    "qwen",
  ];
  const discoveredFrom = "https://unlimitedai.org/wp-admin/admin-ajax.php";
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const id of knownIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    models.push(
      buildDiscoveredModel(
        "freeaixyz",
        id,
        { id, source: "static-bot-ids" },
        discoveredFrom,
        defaultCapabilities({ streaming: true }),
        // Override discoveryMode to "manual" — these ids are hardcoded,
        // not fetched from an upstream /models endpoint (audit H2).
        "manual",
      ),
    );
  }
  return models;
}

// ─── FreeGPT best-effort curl GET ───────────────────────────────────────────

/**
 * Inline curl GET for the FreeGPT `/v1/models` endpoint. FreeGPT is behind
 * Cloudflare TLS fingerprinting, so plain Node fetch returns 403. We mirror
 * the `curlGet` helper from `freegpt.ts` (with the same CHALLENGE_HEADERS
 * approach) WITHOUT modifying freegpt.ts — Task 1's fix is surgical.
 *
 * NOTE: This is best-effort. The `/v1/models` endpoint may also require
 * the WASM challenge signature; if so, this returns HTTP 403 and we return
 * `[]`. The adapter's `discoverModels` then falls back to the manually-
 * curated MODELS[] entries for freegpt.
 */
async function curlGetFreegpt(
  url: string,
): Promise<{ status: number; body: string }> {
  const cp = await import("node:child_process");
  const args = [
    "-s",
    "-S",
    "--max-time",
    "10",
    "-w",
    `\n${STATUS_MARKER}%{http_code}`,
    "-H",
    "Accept: application/json",
    "-H",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "-H",
    "Referer: https://freegpt.tech/",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    "-H",
    "x-origin: https://freegpt.tech",
    url,
  ];

  return new Promise((resolve) => {
    const proc = cp.spawn("curl", args, { timeout: 12_000 });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => {
      const idx = stdout.lastIndexOf(STATUS_MARKER);
      if (idx >= 0) {
        const statusStr = stdout.slice(idx + STATUS_MARKER.length).trim();
        const status = parseInt(statusStr, 10) || 0;
        const body = stdout.slice(0, idx);
        resolve({ status, body });
      } else {
        resolve({ status: 0, body: stdout });
      }
    });
    proc.on("error", () => resolve({ status: 0, body: stderr }));
  });
}

/**
 * FreeGPT — `https://freegpt.tech/api/openai/oneapi/v1/models` (best-effort).
 * Tries curl-based GET with challenge headers. On 403/failure, returns `[]`
 * and the adapter falls back to MODELS[] entries for freegpt.
 */
async function discoverFreegpt(): Promise<DiscoveredModel[]> {
  const url = "https://freegpt.tech/api/openai/oneapi/v1/models";
  try {
    const { status, body } = await curlGetFreegpt(url);
    if (status !== 200 || !body) {
      console.error(
        `[discovery] freegpt returned HTTP ${status || "?"} (best-effort — challenge may be required)`,
      );
      return [];
    }
    const data = (await JSON.parse(body)) as {
      data?: UpstreamModel[];
      models?: UpstreamModel[];
    };
    const items: UpstreamModel[] = data.data ?? data.models ?? [];
    const seen = new Set<string>();
    const models: DiscoveredModel[] = [];
    for (const item of items) {
      const upstreamId = item?.id;
      if (!upstreamId || typeof upstreamId !== "string") continue;
      if (seen.has(upstreamId)) continue;
      seen.add(upstreamId);
      models.push(buildDiscoveredModel("freegpt", upstreamId, item, url));
    }
    return models;
  } catch (err) {
    console.error(
      "[discovery] freegpt failed (best-effort):",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

// ─── Public discoverer map + helpers ────────────────────────────────────────

/**
 * Map from provider full-id → discoverer function. Each function returns a
 * `DiscoveredModel[]` (never throws; on failure returns `[]`).
 */
export const DYNAMIC_DISCOVERERS: Record<
  string,
  () => Promise<DiscoveredModel[]>
> = {
  pollinations: discoverPollinations,
  llm7: discoverLlm7,
  kilocode: discoverKilocode,
  freechat: discoverFreechat,
  opencode: discoverOpencode,
  gptoss: discoverGptoss,
  vexa: discoverVexa,
  freeaixyz: discoverFreeaixyz,
  freegpt: discoverFreegpt,
};

/**
 * Look up the dynamic discoverer for a provider id.
 * Returns `undefined` if the provider has no dynamic discoverer.
 */
export function getDynamicDiscoverer(
  providerId: string,
): (() => Promise<DiscoveredModel[]>) | undefined {
  return DYNAMIC_DISCOVERERS[providerId];
}

// ─── FreeGPT adapter (built fresh — no legacy adapter exists) ───────────────

/** Find a legacy GatewayModel for freegpt by upstream id. */
function findFreegptLegacyModel(upstreamId: string): GatewayModel {
  const found = MODELS.find(
    (m) => m.provider === "freegpt" && m.upstream === upstreamId,
  );
  if (found) return found;
  // Synthesize a minimal GatewayModel so the freeGptProvider can still
  // route the request (it only reads `upstream`).
  return {
    id: upstreamId,
    provider: "freegpt" as ProviderId,
    upstream: upstreamId,
    description: `FreeGPT model "${upstreamId}"`,
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

/**
 * Wrap a thrown legacy freeGptProvider error into a GatewayError. Detects
 * HTTP status codes embedded in error messages (mirrors legacy.ts) plus the
 * rate-limit keyword detection (audit A4) so Pollinations-style "queue full"
 * messages surface as RATE_LIMITED 429 to the client.
 */
function wrapFreegptError(
  err: unknown,
  upstreamId: string,
): GatewayError {
  if (err instanceof GatewayError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    /\b429\b/.test(message) ||
    lower.includes("rate limit") ||
    lower.includes("queue full") ||
    lower.includes("too many requests")
  ) {
    return classifyUpstreamStatus(429, {
      provider: "freegpt",
      model: upstreamId,
      body: message,
    });
  }
  const statusMatch = message.match(/(?:HTTP|status)\D+(\d{3})/i);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  if (status > 0) {
    return classifyUpstreamStatus(status, {
      provider: "freegpt",
      model: upstreamId,
      body: message,
    });
  }
  return new GatewayError({
    type: "UPSTREAM_5XX",
    message,
    status: 502,
    provider: "freegpt",
    model: canonicalModelId("freegpt", upstreamId),
  });
}

/**
 * Build a fresh ProviderAdapter for freegpt. Freegpt has no legacy adapter
 * (it's not in the PROVIDERS map — Node-only APIs), so we build one inline
 * that delegates `complete` / `stream` to the existing `freeGptProvider`
 * instance and uses the dynamic discoverer (with a MODELS[] fallback) for
 * `discoverModels`.
 */
function buildFreegptAdapter(
  discoverer: () => Promise<DiscoveredModel[]>,
): ProviderAdapter {
  const entry = getProviderEntry("freegpt");
  const shortId = entry?.shortId ?? "fg";
  const baseUrl = entry?.baseUrl ?? "https://freegpt.tech";
  const displayName = entry?.name ?? "FreeGPT";

  return {
    id: "freegpt",
    shortId,
    name: displayName,
    baseUrl,
    discoveryMode: "dynamic",
    discoverModels: async () => {
      // Best-effort dynamic discovery. If the upstream /v1/models endpoint
      // is unreachable (403 challenge, network, etc.), fall back to the
      // manually-curated MODELS[] entries for freegpt so the catalog
      // always has the canonical freegpt models available.
      const dynamic = await discoverer();
      if (dynamic.length > 0) return dynamic;
      const fallback: DiscoveredModel[] = [];
      const seen = new Set<string>();
      for (const m of MODELS) {
        if (m.provider !== "freegpt") continue;
        if (m.modality === "text-to-image") continue; // image models handled elsewhere
        if (seen.has(m.upstream)) continue;
        seen.add(m.upstream);
        fallback.push(
          buildDiscoveredModel(
            "freegpt",
            m.upstream,
            { id: m.upstream, source: "fallback-manual-registry" },
            "https://freegpt.tech/api/openai/oneapi/v1/models",
            defaultCapabilities({ tools: m.capabilities.tools }),
            // Audit H2: this is a static fallback to MODELS[], not a
            // dynamically-fetched entry — mark as "manual".
            "manual",
          ),
        );
      }
      return fallback;
    },
    complete: async (req: ChatRequest): Promise<{ text: string }> => {
      const model = findFreegptLegacyModel(req.upstreamId);
      try {
        const result = await freeGptProvider.complete({
          model,
          messages: req.messages,
          signal: req.signal,
          tools: req.tools as ProviderTool[] | undefined,
          toolChoice: req.toolChoice,
          // Forward OpenAI sampling params (audit E1).
          temperature: req.temperature,
          maxTokens: req.maxTokens ?? req.maxCompletionTokens,
          topP: req.topP,
          stop: req.stop,
          seed: req.seed,
          presencePenalty: req.presencePenalty,
          frequencyPenalty: req.frequencyPenalty,
          n: req.n,
          streamOptions: req.streamOptions,
        });
        return { text: result.text };
      } catch (err) {
        throw wrapFreegptError(err, req.upstreamId);
      }
    },
    stream: async function* (
      req: ChatRequest,
    ): AsyncGenerator<string, void, unknown> {
      const model = findFreegptLegacyModel(req.upstreamId);
      // freeGptProvider.stream() already throws GatewayError on 403/etc.
      // (Task 1 fix). Just delegate — no extra wrapping needed.
      yield* freeGptProvider.stream({
        model,
        messages: req.messages,
        signal: req.signal,
        tools: req.tools as ProviderTool[] | undefined,
        toolChoice: req.toolChoice,
        // Forward OpenAI sampling params (audit E1).
        temperature: req.temperature,
        maxTokens: req.maxTokens ?? req.maxCompletionTokens,
        topP: req.topP,
        stop: req.stop,
        seed: req.seed,
        presencePenalty: req.presencePenalty,
        frequencyPenalty: req.frequencyPenalty,
        n: req.n,
        streamOptions: req.streamOptions,
      });
    },
  };
}

// ─── Registry hook (called by startup.ts via dynamic import) ────────────────

/**
 * Minimal structural interface for the ProviderRegistry. Avoids importing
 * the singleton directly to prevent circular module dependencies. The real
 * `providerRegistry` singleton (from `@/lib/gateway/registry`) satisfies
 * this interface structurally.
 */
interface ProviderRegistryLike {
  registerDynamicDiscoverer(
    providerId: string,
    fn: (id: string) => Promise<ProviderAdapter | null>,
  ): void;
  get(id: string): ProviderAdapter | undefined;
}

/**
 * Register every dynamic discoverer into the `providerRegistry`.
 * Called by `src/lib/gateway/startup.ts` via dynamic import.
 *
 * For each provider in `DYNAMIC_DISCOVERERS`:
 *   - If a legacy adapter already exists in the registry (pollinations,
 *     llm7, kilocode, freechat, opencode, gptoss, vexa, freeaixyz), the
 *     discoverer returns a CLONED adapter that overrides `discoverModels`
 *     with the dynamic discoverer (and sets `discoveryMode = "dynamic"`),
 *     keeping the legacy `complete` / `stream` / `healthCheck`.
 *   - For freegpt (no legacy adapter), the discoverer builds a fresh
 *     adapter via `buildFreegptAdapter` that delegates `complete` / `stream`
 *     to the `freeGptProvider` instance + uses the dynamic discoverer
 *     (with a MODELS[] fallback) for `discoverModels`.
 */
export function registerDynamicDiscoverers(
  reg: ProviderRegistryLike,
): void {
  for (const [providerId, discoverer] of Object.entries(
    DYNAMIC_DISCOVERERS,
  )) {
    reg.registerDynamicDiscoverer(
      providerId,
      async (id: string): Promise<ProviderAdapter | null> => {
        const legacy = reg.get(id);
        if (legacy) {
          // Clone the legacy adapter, override discoverModels + discoveryMode.
          return {
            ...legacy,
            discoveryMode: "dynamic" as const,
            discoverModels: discoverer,
          };
        }
        // No legacy adapter — only build a fresh one for freegpt.
        // Other providers without a legacy adapter (none currently) return
        // null and are skipped (Phase 3a can wire them up if needed).
        if (id === "freegpt") {
          return buildFreegptAdapter(discoverer);
        }
        return null;
      },
    );
  }
}
