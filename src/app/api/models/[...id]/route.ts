/**
 * GET /api/models/[...id] — full model detail (PRD §90).
 *
 * Path param `id` (catch-all) is the canonical public id
 * (`<shortId>/<upstreamId>` — e.g. `fg/gpt-5`, `po/flux`). The catch-all
 * accepts both URL-encoded slashes (`/api/models/tb%2Fgpt-5`) and the raw
 * slash (`/api/models/tb/gpt-5`), since the canonical id contains a slash.
 *
 * Returns the full DiscoveredModel + provider info + last verified + health.
 */

import {
  catalogStore,
  errorResponse,
  GatewayError,
  providerRegistry,
} from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ModelDetail {
  model: ReturnType<typeof catalogStore.getModel>;
  // Catalog store returns ModelHealthEntry | undefined; allow both for JSON.
  health: ReturnType<typeof catalogStore.getModelHealth> | null;
  provider: {
    id: string;
    shortId: string;
    name: string;
    baseUrl?: string;
    discoveryMode: string;
  } | null;
}

/** GET /api/models/[...id] — accepts both `tb/gpt-5` and `tb%2Fgpt-5`. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string[] }> },
) {
  await ensureGateway();
  try {
    const { id: segments } = await context.params;
    // Join path segments back into a canonical `<shortId>/<upstreamId>` id.
    // Each segment is also URI-decoded in case any element was encoded.
    const decoded = segments
      .map((s) => decodeURIComponent(s))
      .join("/");
    const model = catalogStore.getModel(decoded);
    if (!model) {
      return errorResponse(
        new GatewayError({
          type: "MODEL_NOT_FOUND",
          message: `Model "${decoded}" not found in catalog.`,
          model: decoded,
        }),
      );
    }
    const adapter = providerRegistry.get(model.providerId);
    const detail: ModelDetail = {
      model,
      health: catalogStore.getModelHealth(decoded) ?? null,
      provider: adapter
        ? {
            id: adapter.id,
            shortId: adapter.shortId,
            name: adapter.name,
            baseUrl: adapter.baseUrl,
            discoveryMode: adapter.discoveryMode,
          }
        : null,
    };
    return Response.json(detail);
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
