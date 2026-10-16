/**
 * GET /api/v1/models — OpenAI-compatible model listing.
 *
 * THE PUBLIC LISTING IS THE ONYX FLEET — every entry is a public onyx-* id
 * (clean display names live in the UI; "onyx" only ever appears in the id).
 * The old provider-prefixed ids (tb/…, ng/…, l7/…) are NOT listed any more —
 * they still ROUTE internally (fleet slots map onto them), but the public
 * surface is fleet-only. `?all=true` adds the underlying catalog back for
 * debugging.
 *
 * Ten-family metadata (PRD §9): every fleet entry additionally carries
 * `name`, `provider`, `family`, `variant`, `version`, `release_order`,
 * `category`, `content_classification`, `status` and `aliases` (the
 * previous-generation ids that still resolve to the same slot). Display
 * names stay independent of the inference id; classification comes from
 * family metadata — never inferred from a model's name.
 *
 * Query params:
 *   - ?health=true   — include capabilities + status + contextWindow
 *   - ?all=true      — fleet + underlying catalog (debug view)
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
import { withCors, corsPreflight } from "@/lib/api/cors";
import { FLEET_MODELS, FLEET_PROVIDER_NAME } from "@/lib/onyx/fleet";
import { fleetFamily } from "@/lib/onyx/families";
import { findNativeModel } from "@/lib/native-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CREATED_EPOCH = Math.floor(Date.now() / 1000);

/** Owned_by field — fall back to providerId when display name is missing. */
function ownedBy(m: DiscoveredModel): string {
  return m.providerName || m.providerId;
}

/** Whether to include an underlying model in the debug listing. */
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

/**
 * Capability gate honesty (FIX B): expose a plain string-array of capability
 * names on EVERY model entry (not just ?health=true) so OpenAI clients can
 * filter tool-capable / stream-capable models BEFORE sending a request —
 * e.g. `models.filter(m => m.capabilities.includes("tools"))`.
 */
function capabilityList(m: DiscoveredModel): string[] {
  const caps = m.capabilities;
  const out: string[] = [];
  if (caps.text) out.push("text");
  if (caps.image) out.push("image");
  if (caps.imageEdit) out.push("image_edit");
  if (caps.audioInput) out.push("audio_input");
  if (caps.audioOutput) out.push("audio_output");
  if (caps.vision) out.push("vision");
  if (caps.tools) out.push("tools");
  if (caps.streaming) out.push("streaming");
  return out;
}

/** Capabilities for a fleet entry, derived from its underlying route. */
function fleetCapabilities(route: string, thinking?: boolean): string[] {
  const underlying = findNativeModel(route);
  const out: string[] = thinking ? ["text", "thinking"] : ["text"];
  if (!underlying) return out;
  if (underlying.capabilities.vision) out.push("vision");
  if (underlying.capabilities.tools) out.push("tools");
  if (underlying.capabilities.streaming) out.push("streaming");
  return out;
}

/** GET /api/v1/models (CORS-wrapped). */
export async function GET(request: Request): Promise<Response> {
  return withCors(await listModels(request));
}

/** OPTIONS /api/v1/models — CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function listModels(request: Request): Promise<Response> {
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
    gatewayModels = catalog.models;
  } catch (err) {
    console.error("[/v1/models] catalog read failed:", err);
    gatewayModels = [];
  }

  // ─── THE FLEET — the public listing (onyx ids, Onyx AI branding) ────────
  const byRoute = new Map(gatewayModels.map((m) => [m.id, m]));
  const fleetData = FLEET_MODELS.map((f) => {
    const underlying = byRoute.get(f.route) ?? null;
    const base = {
      id: f.id,
      object: "model" as const,
      created: CREATED_EPOCH,
      owned_by: FLEET_PROVIDER_NAME,
      // ── Ten-family metadata (PRD §9) ──
      name: f.name,
      provider: FLEET_PROVIDER_NAME,
      family: fleetFamily(f.family).name,
      variant: f.variant,
      version: f.version,
      release_order: f.releaseOrder,
      category: f.category,
      content_classification: f.contentClassification,
      status: "active" as const,
      aliases: [...f.legacyIds],
      capabilities: fleetCapabilities(f.route, f.thinking),
      // THINKING MODEL marker: the two-round flow (planning round streamed
      // as reasoning_content + final round with tools) fires by default.
      ...(f.thinking ? { thinking: true } : {}),
      free: true,
    };
    if (!showHealth) return base;
    const entry: Record<string, unknown> = { ...base };
    if (underlying) {
      entry.capability_flags = underlying.capabilities;
      entry.status = healthStatus(underlying);
      entry.internal_status = underlying.status;
      entry.context_window = underlying.metadata?.contextWindow ?? null;
      entry.last_checked = underlying.lastVerifiedAt ?? underlying.discoveredAt;
      const healthEntry = catalogStore.getModelHealth(underlying.id);
      if (healthEntry) entry.health = healthEntry;
    } else {
      entry.status = "down";
      entry.internal_status = "offline";
    }
    return entry as unknown as {
      id: string;
      object: "model";
      created: number;
      owned_by: string;
    };
  });

  // ─── Underlying catalog — only in the ?all=true debug view ──────────────
  const visible = gatewayModels
    .filter((m) => shouldInclude(m, showAll))
    .filter((m) => providerRegistry.get(m.providerId));

  const underlyingData = visible.map((m) => {
    const base = {
      id: m.id,
      object: "model" as const,
      created: CREATED_EPOCH,
      owned_by: ownedBy(m),
      capabilities: capabilityList(m),
      free: m.free !== false,
    };
    if (!showHealth) return base;
    const entry: Record<string, unknown> = { ...base };
    entry.capability_flags = m.capabilities;
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
  });

  const payload: OAIModelList = {
    object: "list",
    data: showAll ? [...fleetData, ...underlyingData] : fleetData,
  };
  return NextResponse.json(payload);
}
