/**
 * GET /api/v1/models — OpenAI-compatible model listing.
 *
 * Lists every native model from the STATIC catalog (hand-curated MODELS[]
 * registry — no network fetch, no discovery). Only models whose provider has
 * a registered adapter and that are not delisted appear by default.
 *
 * Query params:
 *   - ?health=true   — include capabilities + status + contextWindow
 *   - ?all=true      — include degraded + offline (delisted) models too
 */

import { NextResponse } from "next/server";
import {
  catalogStore,
  providerRegistry,
  type DiscoveredModel,
} from "@/lib/gateway";
import { isDelistedModel } from "@/lib/gateway/delisted";
import { ensureGateway } from "@/lib/gateway/route-helpers";
import type { OAIModelList } from "@/lib/openai-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CREATED_EPOCH = Math.floor(Date.now() / 1000);

/** Owned_by field — fall back to providerId when display name is missing. */
function ownedBy(m: DiscoveredModel): string {
  return m.providerName || m.providerId;
}

/** Whether to include a model in the listing given the showAll flag. */
function shouldInclude(m: DiscoveredModel, showAll: boolean): boolean {
  if (showAll) return true;
  // Default listing hides offline models (don't permanently hide — just
  // don't surface by default). Delisted providers are offline.
  if (m.status === "offline") return false;
  // Reliability-sweep delisted models — individually confirmed broken upstream.
  if (isDelistedModel(m.id)) return false;
  return true;
}

/** Map internal ModelStatus → PRD-facing healthy|degraded|down. */
function healthStatus(m: DiscoveredModel): "healthy" | "degraded" | "down" {
  switch (m.status) {
    case "active":
      return "healthy";
    case "degraded":
      return "degraded";
    case "offline":
    case "unknown":
      return "down";
    default:
      return "down";
  }
}

/** GET /api/v1/models. */
export async function GET(request: Request) {
  await ensureGateway();

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL("http://localhost/");
  }
  const showAll = url.searchParams.get("all") === "true";
  const showHealth = url.searchParams.get("health") === "true";

  let gatewayModels: DiscoveredModel[];
  try {
    const catalog = catalogStore.getCatalog();
    gatewayModels = catalog.models.filter((m) => shouldInclude(m, showAll));
  } catch (err) {
    console.error("[/v1/models] catalog read failed:", err);
    gatewayModels = [];
  }

  // Only list models whose provider has a registered adapter.
  const visible = gatewayModels.filter((m) => providerRegistry.get(m.providerId));

  const payload: OAIModelList = {
    object: "list",
    data: visible.map((m) => {
      const base = {
        id: m.id,
        object: "model" as const,
        created: CREATED_EPOCH,
        owned_by: ownedBy(m),
      };
      if (!showHealth) return base;
      // ?health=true → include capabilities + status + context window.
      const entry: Record<string, unknown> = { ...base };
      entry.capabilities = m.capabilities;
      entry.status = healthStatus(m);
      entry.internal_status = m.status;
      entry.context_window = m.metadata?.contextWindow ?? null;
      entry.last_checked = m.lastVerifiedAt ?? m.discoveredAt;
      entry.discovery_mode = m.discoveryMode;
      entry.free = m.free !== false;
      const healthEntry = catalogStore.getModelHealth(m.id);
      if (healthEntry) entry.health = healthEntry;
      return entry as unknown as {
        id: string;
        object: "model";
        created: number;
        owned_by: string;
      };
    }),
  };
  return NextResponse.json(payload);
}
