/**
 * GET /api/v1/models — OpenAI-compatible model listing (PRD §49, §54, §166, R-6, R-9).
 *
 * Lists every DiscoveredModel that has a registered adapter and is not in
 * "offline" status, MERGED with the unified BYOK catalog (native +
 * gratisfy + g4f + pollinations sources — fetched fresh from upstream on
 * every call per the user's "remove caching of catalog" directive). This
 * means a single GET /api/v1/models now returns the full set of models
 * the playground's dropdown offers — including Gratisfy's 168+
 * BYOK-gated models, G4F's 5000+ community models, and the Pollinations
 * anonymous-tier model. OpenAI-API consumers see the same catalog the
 * website renders.
 *
 * Query params:
 *   - ?health=true   — include capabilities + status + contextWindow +
 *                       last_checked + requires_auth (R-6, R-9)
 *   - ?all=true      — include degraded + offline (delisted) models too
 *
 * Backward-compat: legacy clients that request an old-style id like
 * `fgpt-gpt-5-5` won't find it here (the chat route handles resolution
 * via the legacy fallback). The /v1/models listing now exposes the
 * canonical `<shortId>/<upstreamId>` ids (PRD §166) AND the unified
 * source-prefixed ids (`gratisfy:<provider>:<model>`,
 * `g4f:<provider>:<model>`, `pollinations:pollinations:<model>`).
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
import { isDelistedModel } from "@/lib/gateway/delisted";
import { ensureGateway } from "@/lib/gateway/route-helpers";
import type { OAIModelList } from "@/lib/openai-types";
import { getUnifiedModels, getSessionUserId } from "@/lib/xyz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CREATED_EPOCH = Math.floor(Date.now() / 1000);

/** Owned_by field — fall back to providerId when display name is missing. */
function ownedBy(m: DiscoveredModel): string {
  return m.providerName || m.providerId;
}

/** Whether to include a model in the listing given the showAll flag (R-3, R-6).
 *
 * PRD §42 — free-only catalog: by default, ONLY free models are surfaced.
 * Paid / PRO / auth-gated models (`free: false`) are hidden — they reappear
 * with `?all=true`. This makes the API honest: if a model is listed, the
 * gateway can actually call it for free. The legacy MODELS[] registry marks
 * all its entries as `free: true` (hand-curated free-only set), so legacy
 * models continue to appear.
 *
 * 10x-sweep delisted models (src/lib/gateway/delisted.ts) are also hidden
 * — they were individually tested 10 times and failed every attempt.
 */
function shouldInclude(m: DiscoveredModel, showAll: boolean): boolean {
  if (showAll) return true;
  // Default listing hides offline models (PRD §54 — don't permanently hide,
  // just don't surface by default). R-3: delisted providers are offline.
  if (m.status === "offline") return false;
  // 10x-sweep delisted models — individually confirmed broken upstream.
  if (isDelistedModel(m.id)) return false;
  // PRD §42 — free-only catalog. Paid models only appear via ?all=true.
  if (m.free === false) return false;
  return true;
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
  // Optional ?unified=true — when set, ONLY the unified-registry models
  // are returned (no gateway legacy catalog). Defaults to false so the
  // endpoint returns the merged set, which is what the user wants: "make
  // all models show on catalog" + "fix app v1/models not showing gratisfy
  // g4f and pollinations models".
  const unifiedOnly = url.searchParams.get("unified") === "true";

  let gatewayModels: DiscoveredModel[];
  try {
    const catalog = catalogStore.getCatalog();
    gatewayModels = catalog.models.filter((m) => shouldInclude(m, showAll));
  } catch (err) {
    console.error("[/v1/models] catalog read failed:", err);
    gatewayModels = [];
  }

  // Only list models whose provider has a registered adapter.
  const visible = unifiedOnly ? [] : gatewayModels.filter((m) => providerRegistry.get(m.providerId));

  // Fetch the unified-registry catalog (native + g4f + gratisfy + pollinations)
  // fresh from upstream on every call. No caching (per user request). If the
  // fetch fails (network/upstream down), we serve whatever we got — never
  // crash the listing. The session is OPTIONAL — anonymous users still see
  // the catalog (the default-key Gratisfy discovery + anonymous Pollinations
  // + native pricing-board models + G4F public discovery all work without
  // a session).
  const userId = await getSessionUserId(request).catch(() => null);
  const unified = await getUnifiedModels(userId ?? undefined).catch(() => ({
    models: [],
    providers: [],
    stale: false,
  }));
  const unifiedEntries = unified.models.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: CREATED_EPOCH,
    owned_by: m.provider,
    // Light-weight extensions so OpenAI-API consumers can still see the
    // source / pricing / capabilities without needing /api/v1/models/unified.
    source: m.source,
    provider: m.provider,
    display_name: m.displayName,
    pricing: m.pricing,
    capabilities: m.capabilities,
  }));

  const payload: OAIModelList = {
    object: "list",
    data: [
      ...visible.map((m) => {
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
        // PRD §42 — expose the free classification so clients can verify.
        entry.free = m.free !== false;
        entry.free_confidence = m.freeConfidence ?? "unknown";
        entry.free_reason = m.freeReason ?? null;
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
      ...unifiedEntries,
    ],
  };
  return NextResponse.json(payload);
}
