/**
 * Legacy provider → ProviderAdapter wrapper (PRD §71, §72).
 *
 * Wraps the existing hard-coded MODELS[] + PROVIDERS map into the new
 * ProviderAdapter contract. Each adapter delegates complete()/stream() to
 * the legacy Provider instance, and discoverModels() returns the MODELS[]
 * entries for that provider mapped into DiscoveredModel[].
 *
 * NEVER overwrites the upstreamId (PRD §25). The canonical public id is
 * `<shortId>/<upstreamId>` and is the only id exposed to clients; the
 * legacy `GatewayModel.id` (e.g. "fgpt-gpt-5-5") is preserved as the
 * DiscoveredModel.name metadata only.
 */

import {
  canonicalModelId,
  getProviderEntry,
} from "@/lib/gateway/ids";
import {
  classifyUpstreamStatus,
  generateRequestId,
  GatewayError,
} from "@/lib/gateway/errors";
import type {
  ChatRequest,
  DiscoveredModel,
  HealthResult,
  ModelCapabilities,
  ProviderAdapter,
} from "@/lib/gateway/types";
import {
  MODELS,
  PROVIDER_INFO,
  type GatewayModel,
  type ProviderId,
} from "@/lib/providers/registry";
import { PROVIDERS, getProvider } from "@/lib/providers/index";
import type { ProviderTool } from "@/lib/providers/types";

/** Map a legacy GatewayModel into the new ModelCapabilities shape (PRD §71). */
function mapCapabilities(legacy: GatewayModel): ModelCapabilities {
  const isImage = legacy.modality === "text-to-image";
  return {
    text: !isImage,
    streaming: legacy.capabilities.streaming,
    tools: legacy.capabilities.tools,
    vision: legacy.capabilities.vision,
    image: isImage,
    imageEdit: false,
    audioInput: false,
    audioOutput: false,
  };
}

/** Convert a legacy GatewayModel entry into a DiscoveredModel. */
function toDiscoveredModel(m: GatewayModel): DiscoveredModel {
  // R-3: providers currently known to be broken upstream are marked offline
  // so they don't appear in `GET /api/v1/models` by default. They're still
  // accessible via `?all=true` for debugging, and direct calls to their
  // models return PROVIDER_UNAVAILABLE (circuit open) — never a silent
  // 200 with empty content.
  //
  // As of the 2026-08-26 reliability sweep:
  //   - freegpt: 56 models at 0% success — the /api/challenge endpoint
  //     now returns HTML (Cloudflare page) instead of JSON, so the WASM
  //     signer integration can't get a valid challenge. Verified dead in
  //     a cold isolated re-test. The fix requires reverse-engineering the
  //     new challenge response shape — out of scope for this hotfix.
  //     Removed from the catalogue until repaired.
  const isDelisted = DELISTED_PROVIDERS.has(m.provider);
  return {
    id: canonicalModelId(m.provider, m.upstream),
    providerId: m.provider,
    providerName: PROVIDER_INFO[m.provider]?.name ?? m.provider,
    upstreamId: m.upstream, // NEVER overwritten (PRD §25)
    name: m.id, // legacy display name — metadata only
    capabilities: mapCapabilities(m),
    metadata: {
      contextWindow: m.contextWindow,
      source: "legacy",
      raw: {
        description: m.description,
        category: m.category,
        imageCategory: m.imageCategory,
        modality: m.modality,
        experimental: m.experimental,
      },
    },
    discoveredAt: new Date().toISOString(),
    status: isDelisted ? "offline" : "active",
    discoveryMode: "manual", // hand-curated (PRD §34)
    discoveredFrom: isDelisted ? "legacy-registry (delisted: upstream outage)" : "legacy-registry",
  };
}

/**
 * R-3: providers currently delisted from `GET /api/v1/models` because they
 * are confirmed dead upstream. Models still appear via `?all=true` and the
 * adapter's chat route still returns a clean PROVIDER_UNAVAILABLE error —
 * the delisting just stops the catalogue from advertising capability the
 * gateway cannot deliver. Remove a provider from this set the moment its
 * integration is repaired.
 */
export const DELISTED_PROVIDERS: ReadonlySet<string> = new Set([
  "freegpt", // challenge endpoint returns HTML — integration broken upstream
]);

/** Find the legacy GatewayModel matching (provider, upstream). */
function findLegacyModel(
  providerId: string,
  upstreamId: string,
): GatewayModel | undefined {
  return MODELS.find(
    (m) => m.provider === providerId && m.upstream === upstreamId,
  );
}

/** Synthesize a minimal GatewayModel for an unknown upstream id (PRD §72). */
function synthesizeLegacyModel(
  providerId: string,
  upstreamId: string,
): GatewayModel {
  return {
    id: upstreamId,
    provider: providerId as ProviderId,
    upstream: upstreamId,
    description: `Unknown upstream "${upstreamId}" on ${providerId}`,
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
 * Wrap a thrown legacy provider error into a GatewayError when possible.
 * Detects HTTP status codes embedded in error messages and classifies them
 * via the canonical taxonomy (PRD §148, audit A3-A6).
 *
 * Also recognises common rate-limit phrasing ("rate limit", "queue full",
 * "too many requests", "429") so that providers whose retry logic consumes
 * the upstream's 429 status still surface RATE_LIMITED to the client.
 */
function wrapLegacyError(
  err: unknown,
  providerId: string,
  upstreamId: string,
): GatewayError {
  if (err instanceof GatewayError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  // Keyword-based detection for rate limits (some providers swallow the HTTP
  // status code and surface a friendlier message after their own retries).
  if (
    /\b429\b/.test(message) ||
    lower.includes("rate limit") ||
    lower.includes("queue full") ||
    lower.includes("too many requests")
  ) {
    return classifyUpstreamStatus(429, {
      provider: providerId,
      model: upstreamId,
      requestId: generateRequestId(),
      body: message,
    });
  }
  // Naive status-code detection from legacy error text.
  const statusMatch = message.match(/(?:HTTP|status)\D+(\d{3})/i);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  if (status > 0) {
    return classifyUpstreamStatus(status, {
      provider: providerId,
      model: upstreamId,
      requestId: generateRequestId(),
      body: message,
    });
  }
  return new GatewayError({
    type: "UPSTREAM_5XX",
    message,
    status: 502,
    provider: providerId,
    model: canonicalModelId(providerId, upstreamId),
    requestId: generateRequestId(),
  });
}

/** Fetch with a 5s HEAD/GET health probe. */
async function probeHealth(
  baseUrl: string,
  providerId: string,
  activeModels: number,
): Promise<HealthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  const startedAt = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(baseUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });
    } catch {
      // Some hosts reject HEAD → fall back to GET.
      res = await fetch(baseUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });
    }
    const latencyMs = Date.now() - startedAt;
    const ok = res.status >= 200 && res.status < 500;
    return {
      providerId,
      status: ok ? "healthy" : "degraded",
      latencyMs,
      lastChecked: new Date().toISOString(),
      activeModels,
      message: ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      providerId,
      status: "offline",
      latencyMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      activeModels,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build the common sampling/option fields for a ProviderCompletionRequest
 * from a gateway ChatRequest (audit E1). The caller adds the `model` field
 * (resolved separately) before passing to the provider.
 */
function toProviderRequest(req: ChatRequest) {
  return {
    messages: req.messages,
    signal: req.signal,
    tools: req.tools as ProviderTool[] | undefined,
    toolChoice: req.toolChoice,
    temperature: req.temperature,
    maxTokens: req.maxTokens ?? req.maxCompletionTokens,
    topP: req.topP,
    stop: req.stop,
    seed: req.seed,
    presencePenalty: req.presencePenalty,
    frequencyPenalty: req.frequencyPenalty,
    n: req.n,
    streamOptions: req.streamOptions,
  };
}

/** Build a ProviderAdapter for a single legacy provider. */
function buildLegacyAdapter(providerId: string): ProviderAdapter {
  const info = PROVIDER_INFO[providerId as keyof typeof PROVIDER_INFO];
  const entry = getProviderEntry(providerId);
  const shortId = entry?.shortId ?? providerId.slice(0, 2);
  const baseUrl = entry?.baseUrl ?? `https://${providerId}`;
  const displayName = info?.name ?? providerId;
  const activeModels = MODELS.filter((m) => m.provider === providerId).length;

  return {
    id: providerId,
    shortId,
    name: displayName,
    baseUrl,
    discoveryMode: "manual",
    discoverModels: async () => {
      const models = MODELS.filter((m) => m.provider === providerId);
      return models.map(toDiscoveredModel);
    },
    healthCheck: async () => probeHealth(baseUrl, providerId, activeModels),
    complete: async (req: ChatRequest): Promise<{ text: string }> => {
      const provider = getLegacyProvider(providerId);
      const model =
        findLegacyModel(providerId, req.upstreamId) ??
        synthesizeLegacyModel(providerId, req.upstreamId);
      try {
        const result = await provider.complete({
          ...toProviderRequest(req),
          model,
        });
        return { text: result.text };
      } catch (err) {
        throw wrapLegacyError(err, providerId, req.upstreamId);
      }
    },
    stream: async function* (
      req: ChatRequest,
    ): AsyncGenerator<string, void, unknown> {
      const provider = getLegacyProvider(providerId);
      const model =
        findLegacyModel(providerId, req.upstreamId) ??
        synthesizeLegacyModel(providerId, req.upstreamId);
      try {
        // Yield genuine upstream deltas as-is (PRD §10, §137). The legacy
        // adapters that DON'T truly stream have capabilities.streaming=false
        // and the streaming-proxy emits one honest content chunk + stop.
        yield* provider.stream({
          ...toProviderRequest(req),
          model,
        });
      } catch (err) {
        throw wrapLegacyError(err, providerId, req.upstreamId);
      }
    },
  };
}

/** Get the legacy Provider instance for a given id (throws if not registered). */
export function getLegacyProvider(providerId: string) {
  return getProvider(providerId as ProviderId);
}

/**
 * Build the full legacy catalog synchronously (audit C1 cold-start fix).
 *
 * Maps every MODELS[] entry (across all providers) into the new
 * DiscoveredModel shape. Used by startup.ts to seed the in-memory catalog
 * immediately after `loadFromDb` so the gateway can return "ready" with a
 * non-empty catalog — without this, the first burst of parallel requests
 * before background discovery completes would all get spurious 404s.
 */
export function buildLegacyDiscoveredModels(): DiscoveredModel[] {
  return MODELS.map(toDiscoveredModel);
}

/** Build one ProviderAdapter per legacy PROVIDERS entry (PRD §71). */
export function buildLegacyAdapters(): ProviderAdapter[] {
  return Object.keys(PROVIDERS).map(buildLegacyAdapter);
}
