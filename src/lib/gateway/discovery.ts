/**
 * Model discovery service (PRD §27-34, §69, §70, §78, §203-205).
 *
 * For each registered provider, calls discoverModels() in parallel with
 * a per-provider 15s timeout (PRD §29). Failed providers do NOT abort
 * the whole run (PRD §70, §205). Persisted as DiscoveryRun rows, and the
 * catalog is replaced atomically via catalogStore.atomicUpdate (PRD §200).
 */

import { db } from "@/lib/db";
import { catalogStore } from "@/lib/gateway/catalog";
import { providerRegistry } from "@/lib/gateway/registry";
import type { DiscoveredModel, DiscoveryResult } from "@/lib/gateway/types";

const PROVIDER_TIMEOUT_MS = 15_000; // PRD §29
const DEFAULT_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min — PRD §30

class ModelDiscoveryService {
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;

  /** Discover models for every registered provider (PRD §28, §69). */
  async discoverAll(): Promise<DiscoveryResult[]> {
    if (this.running) {
      // Discovery already in progress — return empty (PRD §200).
      return [];
    }
    this.running = true;
    try {
      await providerRegistry.boot();
      const adapters = providerRegistry.list();
      const startedAtByProvider = new Map<string, string>();
      for (const a of adapters) startedAtByProvider.set(a.id, new Date().toISOString());
      const entries = await Promise.allSettled(
        adapters.map((a) => this.discoverProviderWithTimeout(a.id)),
      );
      const results: DiscoveryResult[] = entries.map((e, i) => {
        const adapter = adapters[i];
        const startedAt = startedAtByProvider.get(adapter.id)!;
        if (e.status === "fulfilled") return e.value;
        return {
          providerId: adapter.id,
          models: [],
          mode: adapter.discoveryMode,
          startedAt,
          finishedAt: new Date().toISOString(),
          modelsFound: 0,
          modelsAdded: 0,
          modelsRemoved: 0,
          error: e.reason instanceof Error ? e.reason.message : String(e.reason),
        };
      });
      // Persist DiscoveryRun rows (PRD §79-84).
      // DISABLED in the dev sandbox — Prisma inserts during discovery
      // were a major contributor to OOM kills (the box has only 4GB RAM
      // and Turbopack already consumes ~2.5GB). The in-memory catalog is
      // the source of truth; DiscoveryRun rows are only for historical
      // audit. Re-enable on a host with adequate memory.
      // this.persistRun(results).catch((err) =>
      //   console.error("[gateway.discovery] persistRun failed:", err),
      // );
      // Atomic catalog swap (PRD §200, §202).
      try {
        await catalogStore.atomicUpdate(results);
      } catch (err) {
        console.error("[gateway.discovery] atomicUpdate failed:", err);
        catalogStore.markStale();
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  /** Single-provider discovery (PRD §113 — manual refresh). */
  async discoverProvider(providerId: string): Promise<DiscoveryResult> {
    await providerRegistry.boot();
    const result = await this.discoverProviderWithTimeout(providerId);
    // DiscoveryRun persistence disabled in dev sandbox (see discoverAll()).
    // this.persistRun([result]).catch((err) =>
    //   console.error("[gateway.discovery] persistRun failed:", err),
    // );
    try {
      await catalogStore.atomicUpdate([result]);
    } catch (err) {
      console.error("[gateway.discovery] atomicUpdate failed:", err);
      catalogStore.markStale();
    }
    return result;
  }

  private async discoverProviderWithTimeout(
    providerId: string,
  ): Promise<DiscoveryResult> {
    const adapter = providerRegistry.get(providerId);
    const startedAt = new Date().toISOString();
    if (!adapter?.discoverModels) {
      return {
        providerId,
        models: [],
        mode: adapter?.discoveryMode ?? "manual",
        startedAt,
        finishedAt: new Date().toISOString(),
        modelsFound: 0,
        modelsAdded: 0,
        modelsRemoved: 0,
        error: "adapter has no discoverModels()",
      };
    }
    try {
      const models = await this.withTimeout(
        adapter.discoverModels(),
        PROVIDER_TIMEOUT_MS,
        providerId,
      );
      // Dedup by providerId+upstreamId (PRD §68).
      const seen = new Set<string>();
      const deduped: DiscoveredModel[] = [];
      for (const m of models) {
        const key = `${m.providerId}|${m.upstreamId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(m);
      }
      const priorModels = catalogStore.getProviderModels(providerId);
      const priorIds = new Set(priorModels.map((m) => m.id));
      const newIds = new Set(deduped.map((m) => m.id));
      const modelsAdded = deduped.filter((m) => !priorIds.has(m.id)).length;
      const modelsRemoved = priorModels.filter((m) => !newIds.has(m.id)).length;
      return {
        providerId,
        models: deduped,
        mode: adapter.discoveryMode,
        startedAt,
        finishedAt: new Date().toISOString(),
        modelsFound: deduped.length,
        modelsAdded,
        modelsRemoved,
      };
    } catch (err) {
      // Discovery error → mark stale; DO NOT delete existing models (PRD §203).
      catalogStore.markStale();
      return {
        providerId,
        models: [],
        mode: adapter.discoveryMode,
        startedAt,
        finishedAt: new Date().toISOString(),
        modelsFound: 0,
        modelsAdded: 0,
        modelsRemoved: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Race a promise against a timeout (PRD §29, §69). */
  private withTimeout<T>(
    p: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`discovery timed out after ${ms}ms for ${label}`));
      }, ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /** Persist one DiscoveryRun row per provider result (PRD §79-84). */
  private async persistRun(results: DiscoveryResult[]): Promise<void> {
    for (const r of results) {
      try {
        await db.discoveryRun.create({
          data: {
            providerId: r.providerId,
            startedAt: new Date(r.startedAt),
            finishedAt: new Date(r.finishedAt),
            modelsFound: r.modelsFound,
            modelsAdded: r.modelsAdded,
            modelsRemoved: r.modelsRemoved,
            error: r.error ?? null,
            mode: r.mode,
          },
        });
      } catch (err) {
        console.error(
          `[gateway.discovery] DiscoveryRun write failed for ${r.providerId}:`,
          err,
        );
      }
    }
  }

  /** Start background refresh (PRD §30). */
  startBackgroundRefresh(intervalMs = DEFAULT_REFRESH_INTERVAL_MS): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.discoverAll().catch((err) =>
        console.error("[gateway.discovery] background refresh failed:", err),
      );
    }, intervalMs);
    if (typeof this.interval.unref === "function") {
      this.interval.unref();
    }
  }

  /** Stop background refresh (used in tests / shutdown). */
  stopBackgroundRefresh(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

// globalThis-backed singleton (see catalog.ts / registry.ts for the pattern).
const globalForDiscovery = globalThis as unknown as {
  __freeaixyzModelDiscoveryService?: ModelDiscoveryService;
};

export const modelDiscoveryService: ModelDiscoveryService =
  globalForDiscovery.__freeaixyzModelDiscoveryService ??
  new ModelDiscoveryService();

if (!globalForDiscovery.__freeaixyzModelDiscoveryService) {
  globalForDiscovery.__freeaixyzModelDiscoveryService = modelDiscoveryService;
}
