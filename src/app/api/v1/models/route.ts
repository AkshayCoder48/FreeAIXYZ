/**
 * GET /api/v1/models — OpenAI-compatible model listing (PRD §49, §54, §166, R-6, R-9).
 *
 * Now served dynamically from the gateway catalog instead of the hard-coded
 * MODELS[] array. Lists every DiscoveredModel that has a registered adapter
 * and is not in "offline" status.
 *
 * Query params:
 *   - ?health=true   — include capabilities + status + contextWindow +
 *                       last_checked + requires_auth (R-6, R-9)
 *   - ?all=true      — include degraded + offline (delisted) models too
 *
 * Backward-compat: legacy clients that request an old-style id like
 * `fgpt-gpt-5-5` won't find it here (the chat route handles resolution
 * via the legacy fallback). The /v1/models listing now exposes the
 * canonical `<shortId>/<upstreamId>` ids (PRD §166).
 *
 * R-3: delisted providers (currently FreeGPT — confirmed dead upstream)
 * are filtered out of the default listing. They reappear with ?all=true.
 */

import { NextResponse } from "next/server";
import {
  catalogStore,
  providerRegistry,
  type DiscoveredModel,
} from "@/lib/gateway";
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

/** Whether to include a model in the listing given the showAll flag (R-3, R-6). */
function shouldInclude(m: DiscoveredModel, showAll: boolean): boolean {
  if (showAll) return true;
  // Default listing hides offline models (PRD §54 — don't permanently hide,
  // just don't surface by default). R-3: delisted providers are offline.
  return m.status !== "offline";
}

/** Map internal ModelStatus → PRD-facing healthy|degraded|down (R-6). */
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

/**
 * R-9: best-effort flag for models that are documented as auth-gated.
 * Today, the gateway advertises a "no auth required" catalogue, but the
 * audit found 53 requests returning HTTP 401 against `kc/kilo-auto/*`
 * models. The catalog doesn't carry an `requires_auth` field yet (we'd
 * need to extend the discovery schema), so for now we conservatively flag
 * the kc/kilo-auto/* family based on the audit data. This becomes a true
 * per-model field once the discovery adapters learn to surface it.
 */
function requiresAuth(m: DiscoveredModel): boolean {
  if (m.providerId === "kilocode") {
    // kc/kilo-auto/* and kc/kilo-auto/small etc. require an upstream
    // subscription the gateway does not hold.
    if (m.upstreamId.startsWith("kilo-auto/")) return true;
  }
  return false;
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

  let models: DiscoveredModel[];
  try {
    const catalog = catalogStore.getCatalog();
    models = catalog.models.filter((m) => shouldInclude(m, showAll));
  } catch (err) {
    console.error("[/v1/models] catalog read failed:", err);
    // Best-effort empty listing rather than a 500 — clients can retry.
    models = [];
  }

  // Only list models whose provider has a registered adapter.
  const visible = models.filter((m) => providerRegistry.get(m.providerId));

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
      // ?health=true → include capabilities + status + context window +
      // last_checked + requires_auth (R-6, R-9).
      const entry: Record<string, unknown> = { ...base };
      entry.capabilities = m.capabilities;
      // R-6: surface the PRD-facing healthy|degraded|down status.
      entry.status = healthStatus(m);
      entry.internal_status = m.status;
      entry.context_window = m.metadata?.contextWindow ?? null;
      // R-6: last_checked — fall back to discoveredAt when no probe yet.
      entry.last_checked = m.lastVerifiedAt ?? m.discoveredAt;
      entry.discovery_mode = m.discoveryMode;
      entry.discovered_from = m.discoveredFrom ?? null;
      entry.discovered_at = m.discoveredAt;
      // R-9: requires_auth flag for auth-gated models.
      entry.requires_auth = requiresAuth(m);
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
