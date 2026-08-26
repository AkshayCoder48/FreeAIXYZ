/**
 * GET /api/models — extended catalog listing (PRD §50, §217).
 *
 * Returns the full DiscoveredModel objects (capabilities, health, latency,
 * lastVerified, provider info) — richer than the OpenAI-shaped /v1/models
 * listing. Designed for the model explorer UI.
 *
 * Query params (all client-side filtering — fine for now):
 *   - ?provider=fg           — filter by shortId or full providerId
 *   - ?capability=streaming|image|vision|tools|audio
 *   - ?status=active|degraded|offline
 *   - ?q=<search>            — case-insensitive substring match on id/name
 */

import {
  catalogStore,
  errorResponse,
  GatewayError,
  type DiscoveredModel,
} from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface CatalogResponse {
  lastUpdated: string;
  catalogStale: boolean;
  models: DiscoveredModel[];
}

/** GET /api/models. */
export async function GET(request: Request) {
  await ensureGateway();
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider")?.trim();
    const capability = url.searchParams.get("capability")?.trim();
    const status = url.searchParams.get("status")?.trim();
    const q = url.searchParams.get("q")?.trim().toLowerCase();

    const catalog = catalogStore.getCatalog();
    let models = catalog.models;

    if (provider) {
      models = models.filter(
        (m) =>
          m.providerId === provider ||
          m.id.startsWith(`${provider}/`) ||
          m.providerName.toLowerCase() === provider.toLowerCase(),
      );
    }
    if (capability) {
      models = models.filter((m) => Boolean(getCapability(m, capability)));
    }
    if (status) {
      models = models.filter((m) => m.status === status);
    }
    if (q) {
      models = models.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.upstreamId.toLowerCase().includes(q),
      );
    }

    const payload: CatalogResponse = {
      lastUpdated: catalog.lastUpdated,
      catalogStale: catalog.catalogStale,
      models,
    };
    return Response.json(payload);
  } catch (err) {
    const ge =
      err instanceof GatewayError
        ? err
        : new GatewayError({
            type: "PROVIDER_UNAVAILABLE",
            message: err instanceof Error ? err.message : String(err),
          });
    return errorResponse(ge);
  }
}

/** Get a single capability value by name (PRD §50). */
function getCapability(
  m: DiscoveredModel,
  name: string,
): boolean | undefined {
  switch (name.toLowerCase()) {
    case "streaming":
      return m.capabilities.streaming;
    case "image":
      return m.capabilities.image;
    case "imageedit":
      return m.capabilities.imageEdit;
    case "vision":
      return m.capabilities.vision;
    case "tools":
      return m.capabilities.tools;
    case "text":
      return m.capabilities.text;
    case "audioinput":
      return m.capabilities.audioInput;
    case "audiooutput":
      return m.capabilities.audioOutput;
    default:
      return undefined;
  }
}
