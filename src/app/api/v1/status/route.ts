/**
 * GET /api/v1/status — per-model + per-provider status page (R-12).
 *
 * Returns a snapshot of:
 *   - Overall gateway health (overall success rate, total models, healthy count)
 *   - Per-provider health (status, success rate, latency, active model count)
 *   - Per-model health (status, success/failure counts, last success/failure,
 *     latency) — clients can use this to route around outages
 *
 * All data is read from the in-memory catalog + health service — this route
 * is cheap to call (no upstream traffic, no DB read).
 *
 * Query params:
 *   - ?provider=<id>  — only return models for this provider
 *   - ?include_offline=true — include offline models too (default: hidden)
 */

import { NextResponse } from "next/server";
import {
  catalogStore,
  metricsService,
  providerRegistry,
  type DiscoveredModel,
  type HealthResult,
  type ModelStatus,
} from "@/lib/gateway";
import { ensureGateway } from "@/lib/gateway/route-helpers";
import { DELISTED_PROVIDERS } from "@/lib/gateway/adapters/legacy";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

interface ProviderStatusEntry {
  id: string;
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  success_rate?: number;
  error_rate?: number;
  latency_ms?: number;
  active_models: number;
  total_models: number;
  last_checked?: string;
  message?: string;
  delisted: boolean;
}

interface ModelStatusEntry {
  id: string;
  provider: string;
  upstream_id: string;
  name: string;
  status: "healthy" | "degraded" | "down";
  last_checked?: string;
  last_success?: string;
  last_failure?: string;
  failure_count?: number;
  latency_ms?: number;
  requires_auth: boolean;
}

interface StatusResponse {
  generated_at: string;
  overall: {
    total_models: number;
    healthy_models: number;
    degraded_models: number;
    down_models: number;
    delisted_providers: string[];
  };
  providers: ProviderStatusEntry[];
  models: ModelStatusEntry[];
  metrics: {
    requests: number;
    success_rate: number;
    errors: number;
    streaming_requests: number;
    average_ttft_ms: number;
    average_latency_ms: number;
    recent_errors: Array<{
      request_id: string;
      provider?: string;
      model?: string;
      status: number;
      type: string;
      message: string;
      at: string;
    }>;
  };
}

/** Map internal ModelStatus → PRD-facing healthy|degraded|down (R-6). */
function healthStatusFromInternal(s: ModelStatus): "healthy" | "degraded" | "down" {
  switch (s) {
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

function mapProviderStatus(
  health: HealthResult | undefined,
  delisted: boolean,
): "healthy" | "degraded" | "down" | "unknown" {
  if (delisted) return "down";
  if (!health) return "unknown";
  if (health.status === "healthy") return "healthy";
  if (health.status === "degraded") return "degraded";
  if (health.status === "offline") return "down";
  return "unknown";
}

export async function GET(request: Request): Promise<Response> {
  return withCors(await statusSnapshot(request));
}

/** CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function statusSnapshot(request: Request): Promise<Response> {
  await ensureGateway();

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL("http://localhost/");
  }
  const providerFilter = url.searchParams.get("provider");
  const includeOffline = url.searchParams.get("include_offline") === "true";

  const catalog = catalogStore.getCatalog();
  const now = new Date().toISOString();

  // Group models by provider.
  const byProvider = new Map<string, DiscoveredModel[]>();
  for (const m of catalog.models) {
    if (providerFilter && m.providerId !== providerFilter) continue;
    if (!includeOffline && m.status === "offline") continue;
    const arr = byProvider.get(m.providerId) ?? [];
    arr.push(m);
    byProvider.set(m.providerId, arr);
  }

  const providerEntries: ProviderStatusEntry[] = [];
  const modelEntries: ModelStatusEntry[] = [];

  for (const [providerId, models] of byProvider) {
    const providerHealth = catalogStore.getProviderHealth(providerId);
    const adapter = providerRegistry.get(providerId);
    const delisted = DELISTED_PROVIDERS.has(providerId);
    const activeCount = models.filter((m) => m.status === "active").length;
    providerEntries.push({
      id: providerId,
      name: adapter?.name ?? providerId,
      status: mapProviderStatus(providerHealth, delisted),
      success_rate: providerHealth?.successRate,
      error_rate: providerHealth?.errorRate,
      latency_ms: providerHealth?.latencyMs,
      active_models: activeCount,
      total_models: models.length,
      last_checked: providerHealth?.lastChecked,
      message: providerHealth?.message,
      delisted,
    });
    for (const m of models) {
      const modelHealth = catalogStore.getModelHealth(m.id);
      modelEntries.push({
        id: m.id,
        provider: m.providerId,
        upstream_id: m.upstreamId,
        name: m.name,
        status: healthStatusFromInternal(m.status),
        last_checked: m.lastVerifiedAt ?? m.discoveredAt,
        last_success: modelHealth?.lastSuccess,
        last_failure: modelHealth?.lastFailure,
        failure_count: modelHealth?.failureCount,
        latency_ms: modelHealth?.latencyMs,
        requires_auth:
          m.providerId === "kilocode" &&
          m.upstreamId.startsWith("kilo-auto/"),
      });
    }
  }

  // Sort: providers by id, models by provider then id.
  providerEntries.sort((a, b) => a.id.localeCompare(b.id));
  modelEntries.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.id.localeCompare(b.id);
  });

  const metrics = metricsService.getMetrics();
  const overall = {
    total_models: catalog.models.length,
    healthy_models: catalog.models.filter((m) => m.status === "active").length,
    degraded_models: catalog.models.filter((m) => m.status === "degraded").length,
    down_models: catalog.models.filter(
      (m) => m.status === "offline" || m.status === "unknown",
    ).length,
    delisted_providers: Array.from(DELISTED_PROVIDERS),
  };

  const body: StatusResponse = {
    generated_at: now,
    overall,
    providers: providerEntries,
    models: modelEntries,
    metrics: {
      requests: metrics.requests,
      success_rate: metrics.successRate,
      errors: metrics.errors,
      streaming_requests: metrics.streamingRequests,
      average_ttft_ms: metrics.averageTtftMs,
      average_latency_ms: metrics.averageLatencyMs,
      recent_errors: metrics.recentErrors.map((e) => ({
        request_id: e.requestId,
        provider: e.providerId,
        model: e.modelId,
        status: e.status,
        type: e.type,
        message: e.message,
        at: e.at,
      })),
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
