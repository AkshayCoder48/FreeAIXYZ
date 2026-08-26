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
    status: "active",
    discoveryMode: "manual", // hand-curated (PRD §34)
    discoveredFrom: "legacy-registry",
  };
}

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
 * via the canonical taxonomy (PRD §148).
 */
function wrapLegacyError(
  err: unknown,
  providerId: string,
  upstreamId: string,
): GatewayError {
  if (err instanceof GatewayError) return err;
  const message = err instanceof Error ? err.message : String(err);
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
          model,
          messages: req.messages,
          signal: req.signal,
          tools: req.tools as ProviderTool[] | undefined,
          toolChoice: req.toolChoice,
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
          model,
          messages: req.messages,
          signal: req.signal,
          tools: req.tools as ProviderTool[] | undefined,
          toolChoice: req.toolChoice,
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

/** Build one ProviderAdapter per legacy PROVIDERS entry (PRD §71). */
export function buildLegacyAdapters(): ProviderAdapter[] {
  return Object.keys(PROVIDERS).map(buildLegacyAdapter);
}
