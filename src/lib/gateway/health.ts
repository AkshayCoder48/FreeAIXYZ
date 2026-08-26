/**
 * Provider + model health service with circuit breaker (PRD §46-48, §121-123, R-8).
 *
 * Per-provider circuit breaker: healthy → (N consecutive failures) → open
 * (60s cooldown) → half-open (1 probe) → healthy/closed. NEVER permanently
 * hides a provider (PRD §122). Model-level health tracks failure counts and
 * downgrades status to degraded/offline.
 *
 * R-8 (per-route circuit breaker): in addition to the per-provider breaker,
 * there is now a per-MODEL breaker keyed by canonical model id. This is the
 * direct fix for BUG-6 from the audit — a single failing model of a provider
 * was taking down its healthy siblings (`po/openai-fast` and `ss/*` scored
 * 0% under load but 100% when serialized). Now an individual model that
 * fails N times opens its OWN breaker, leaving the rest of the provider's
 * models untouched. The provider-wide breaker is still consulted for
 * genuine provider-wide outages (e.g. FreeGPT.tech down).
 *
 * Outcomes are recorded by the streaming-proxy on every successful /
 * failed stream and by the health-check background loop.
 */

import { db } from "@/lib/db";
import { catalogStore } from "@/lib/gateway/catalog";
import { providerRegistry } from "@/lib/gateway/registry";
import type {
  HealthResult,
  ModelStatus,
  ProviderStatus,
} from "@/lib/gateway/types";

const FAILURE_THRESHOLD = 5; // consecutive failures → open (PRD §121)
const COOLDOWN_MS = 60 * 1000; // 60s (PRD §121)
const SUCCESS_WINDOW = 10; // rolling window for success-rate calc
const MODEL_DEGRADED_FAILURES = 2;
const MODEL_OFFLINE_FAILURES = 5;
// R-8: per-MODEL breaker threshold. Lower than the provider threshold so a
// single misbehaving model trips its own breaker quickly without waiting
// for the whole provider to degrade.
const MODEL_BREAKER_THRESHOLD = 3;
const MODEL_BREAKER_COOLDOWN_MS = 30 * 1000;

type BreakerState = "closed" | "open" | "half_open";

interface BreakerEntry {
  status: BreakerState;
  consecutiveFailures: number;
  openedAt?: number;
  successes: boolean[]; // rolling window
}

interface ModelHealthInternal {
  status: ModelStatus;
  failureCount: number;
  lastSuccess?: string;
  lastFailure?: string;
  latencyMs?: number;
}

class ProviderHealthService {
  private breakers = new Map<string, BreakerEntry>();
  /** R-8: per-MODEL circuit breaker map. Keyed by canonical model id
   * (e.g. `po/openai-fast`, `ss/qwen-2.5`). Separate from the per-provider
   * breaker so a single failing model can't take down its siblings. */
  private modelBreakers = new Map<string, BreakerEntry>();
  private modelHealth = new Map<string, ModelHealthInternal>();

  // ─── Provider-level health + circuit breaker ─────────────────────────────

  /** Run a provider's adapter.healthCheck() and update circuit state. */
  async checkProvider(providerId: string): Promise<HealthResult> {
    const adapter = providerRegistry.get(providerId);
    const lastChecked = new Date().toISOString();
    if (!adapter?.healthCheck) {
      const result: HealthResult = {
        providerId,
        status: "unknown" as ProviderStatus,
        lastChecked,
        message: "adapter has no healthCheck()",
      };
      catalogStore.setProviderHealth(providerId, result);
      return result;
    }
    const breaker = this.getBreaker(providerId);
    if (breaker.status === "open") {
      const elapsed = Date.now() - (breaker.openedAt ?? 0);
      if (elapsed < COOLDOWN_MS) {
        const result: HealthResult = {
          providerId,
          status: "offline" as ProviderStatus,
          lastChecked,
          message: `circuit open (cooldown ${Math.round((COOLDOWN_MS - elapsed) / 1000)}s)`,
        };
        catalogStore.setProviderHealth(providerId, result);
        return result;
      }
      // Cooldown elapsed → half-open probe (PRD §122).
      breaker.status = "half_open";
    }
    try {
      const result = await adapter.healthCheck();
      this.recordProviderOutcome(
        providerId,
        result.status === "healthy",
      );
      const successRate = this.computeSuccessRate(providerId);
      const enriched: HealthResult = {
        ...result,
        lastChecked,
        successRate,
        errorRate: 1 - successRate,
      };
      catalogStore.setProviderHealth(providerId, enriched);
      this.persistProviderHealth(providerId, enriched).catch((err) =>
        console.error(`[gateway.health] provider persist ${providerId}:`, err),
      );
      return enriched;
    } catch (err) {
      this.recordProviderOutcome(providerId, false, err);
      const result: HealthResult = {
        providerId,
        status: "offline" as ProviderStatus,
        lastChecked,
        message: err instanceof Error ? err.message : String(err),
      };
      catalogStore.setProviderHealth(providerId, result);
      return result;
    }
  }

  /** True if the circuit breaker is currently open for this provider. */
  isOpen(providerId: string): boolean {
    const b = this.breakers.get(providerId);
    if (!b) return false;
    if (b.status === "open") {
      const elapsed = Date.now() - (b.openedAt ?? 0);
      if (elapsed >= COOLDOWN_MS) {
        // Auto-promote to half-open on next check (PRD §122).
        b.status = "half_open";
        return false;
      }
      return true;
    }
    return false;
  }

  /** Record a successful outcome (called by streaming-proxy on 2xx). */
  recordProviderSuccess(providerId: string): void {
    this.recordProviderOutcome(providerId, true);
  }

  /** Record a failed outcome (called by streaming-proxy on err/5xx). */
  recordProviderFailure(providerId: string, err?: unknown): void {
    this.recordProviderOutcome(providerId, false, err);
  }

  private recordProviderOutcome(
    providerId: string,
    success: boolean,
    err?: unknown,
  ): void {
    const b = this.getBreaker(providerId);
    b.successes.push(success);
    if (b.successes.length > SUCCESS_WINDOW) b.successes.shift();
    if (success) {
      b.consecutiveFailures = 0;
      if (b.status === "half_open") b.status = "closed";
    } else {
      b.consecutiveFailures += 1;
      if (
        b.status === "half_open" ||
        b.consecutiveFailures >= FAILURE_THRESHOLD
      ) {
        b.status = "open";
        b.openedAt = Date.now();
      }
      if (err) {
        console.warn(
          `[gateway.health] provider ${providerId} failure:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private getBreaker(providerId: string): BreakerEntry {
    let b = this.breakers.get(providerId);
    if (!b) {
      b = { status: "closed", consecutiveFailures: 0, successes: [] };
      this.breakers.set(providerId, b);
    }
    return b;
  }

  private computeSuccessRate(providerId: string): number {
    const b = this.breakers.get(providerId);
    if (!b || b.successes.length === 0) return 0;
    const ok = b.successes.filter(Boolean).length;
    return ok / b.successes.length;
  }

  // ─── Model-level health (PRD §47, R-8 per-model breaker) ─────────────────

  /**
   * R-8: True if the per-MODEL circuit breaker is currently open.
   *
   * The model breaker opens after MODEL_BREAKER_THRESHOLD consecutive
   * failures (lower than the provider threshold so a single bad model
   * trips quickly without dragging the rest of the provider down — direct
   * fix for BUG-6 where one failing `po/openai-fast` model was poisoning
   * the entire `po/*` pool).
   *
   * Cooldown is shorter (30s) than the provider cooldown (60s) so a model
   * that recovers gets re-probed sooner.
   */
  isModelOpen(modelId: string): boolean {
    const b = this.modelBreakers.get(modelId);
    if (!b) return false;
    if (b.status === "open") {
      const elapsed = Date.now() - (b.openedAt ?? 0);
      if (elapsed >= MODEL_BREAKER_COOLDOWN_MS) {
        // Auto-promote to half-open — let the next request probe the model.
        b.status = "half_open";
        return false;
      }
      return true;
    }
    return false;
  }

  /** Record a successful model request — decay failures, restore status, close model breaker. */
  recordModelSuccess(publicId: string): void {
    // R-8: close the per-model breaker if it was open/half-open.
    const mb = this.modelBreakers.get(publicId);
    if (mb) {
      mb.consecutiveFailures = 0;
      if (mb.status === "half_open") mb.status = "closed";
    }
    const entry =
      this.modelHealth.get(publicId) ??
      ({ status: "active" as ModelStatus, failureCount: 0 } as ModelHealthInternal);
    entry.lastSuccess = new Date().toISOString();
    if (entry.failureCount > 0) {
      entry.failureCount = Math.max(0, entry.failureCount - 1);
    }
    if (entry.status === "degraded" && entry.failureCount === 0) {
      entry.status = "active";
    }
    this.modelHealth.set(publicId, entry);
    catalogStore.setModelHealth(publicId, entry.status, entry.latencyMs);
    this.persistModelHealth(publicId, entry).catch((err) =>
      console.error(`[gateway.health] model persist ${publicId}:`, err),
    );
  }

  /** Record a failed model request — bump failures, downgrade status, maybe open model breaker. */
  recordModelFailure(publicId: string, err?: unknown): void {
    // R-8: bump the per-model breaker; open it if the threshold is hit.
    const mb = this.getModelBreaker(publicId);
    mb.consecutiveFailures += 1;
    if (
      mb.status === "half_open" ||
      mb.consecutiveFailures >= MODEL_BREAKER_THRESHOLD
    ) {
      mb.status = "open";
      mb.openedAt = Date.now();
    }
    const entry =
      this.modelHealth.get(publicId) ??
      ({ status: "active" as ModelStatus, failureCount: 0 } as ModelHealthInternal);
    entry.failureCount += 1;
    entry.lastFailure = new Date().toISOString();
    if (entry.failureCount >= MODEL_OFFLINE_FAILURES) {
      entry.status = "offline";
    } else if (entry.failureCount >= MODEL_DEGRADED_FAILURES) {
      entry.status = "degraded";
    }
    this.modelHealth.set(publicId, entry);
    catalogStore.setModelHealth(publicId, entry.status, entry.latencyMs);
    this.persistModelHealth(publicId, entry).catch((err) =>
      console.error(`[gateway.health] model persist ${publicId}:`, err),
    );
    if (err) {
      console.warn(
        `[gateway.health] model ${publicId} failure:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Get or create the per-model breaker entry (R-8). */
  private getModelBreaker(modelId: string): BreakerEntry {
    let b = this.modelBreakers.get(modelId);
    if (!b) {
      b = { status: "closed", consecutiveFailures: 0, successes: [] };
      this.modelBreakers.set(modelId, b);
    }
    return b;
  }

  getModelHealth(publicId: string): ModelHealthInternal | undefined {
    return this.modelHealth.get(publicId);
  }

  // ─── Persistence (best-effort) ───────────────────────────────────────────

  private async persistProviderHealth(
    providerId: string,
    result: HealthResult,
  ): Promise<void> {
    try {
      await db.provider.update({
        where: { id: providerId },
        data: {
          status: result.status,
          latencyMs: result.latencyMs ?? null,
          lastHealthCheckAt: new Date(result.lastChecked),
          successRate: result.successRate ?? null,
          errorRate: result.errorRate ?? null,
        },
      });
    } catch (err) {
      // Provider row may not exist yet (e.g. before first discovery). Tolerate.
      console.error(`[gateway.health] provider update ${providerId}:`, err);
    }
  }

  private async persistModelHealth(
    publicId: string,
    entry: ModelHealthInternal,
  ): Promise<void> {
    try {
      // ModelHealth.modelId references ProviderModel.id (cuid), not publicId.
      const row = await db.providerModel.findUnique({
        where: { publicId },
      });
      if (!row) return;
      await db.modelHealth.upsert({
        where: { modelId: row.id },
        create: {
          modelId: row.id,
          status: entry.status,
          failureCount: entry.failureCount,
          lastFailure: entry.lastFailure ? new Date(entry.lastFailure) : null,
          lastSuccess: entry.lastSuccess ? new Date(entry.lastSuccess) : null,
          lastChecked: new Date(),
          latencyMs: entry.latencyMs ?? null,
        },
        update: {
          status: entry.status,
          failureCount: entry.failureCount,
          lastFailure: entry.lastFailure ? new Date(entry.lastFailure) : null,
          lastSuccess: entry.lastSuccess ? new Date(entry.lastSuccess) : null,
          lastChecked: new Date(),
          latencyMs: entry.latencyMs ?? null,
        },
      });
    } catch (err) {
      console.error(`[gateway.health] model health ${publicId}:`, err);
    }
  }
}

// globalThis-backed singleton (see catalog.ts / registry.ts for the pattern).
const globalForHealth = globalThis as unknown as {
  __freeaixyzProviderHealthService?: ProviderHealthService;
};

export const providerHealthService: ProviderHealthService =
  globalForHealth.__freeaixyzProviderHealthService ?? new ProviderHealthService();

if (!globalForHealth.__freeaixyzProviderHealthService) {
  globalForHealth.__freeaixyzProviderHealthService = providerHealthService;
}
