/**
 * Model catalog store — STATIC, in-memory.
 *
 * The catalog is seeded once at startup from the hand-curated MODELS[]
 * registry (src/lib/providers/registry.ts) and never re-fetched or synced.
 * There is no dynamic discovery, no background refresh, and no database
 * persistence. Health probes (circuit breakers) update entries in memory
 * with copy-on-write swaps so concurrent readers always see a consistent
 * snapshot.
 */

import { getProviderEntry, parseCanonicalModelId } from "@/lib/gateway/ids";
import type {
  DiscoveredModel,
  HealthResult,
  ModelStatus,
} from "@/lib/gateway/types";

export interface ModelHealthEntry {
  status: ModelStatus;
  failureCount: number;
  lastSuccess?: string;
  lastFailure?: string;
  latencyMs?: number;
}

interface CatalogState {
  /** publicId → model. */
  models: Map<string, DiscoveredModel>;
  /** providerId → set of publicIds (including degraded ones — never removed). */
  byProvider: Map<string, Set<string>>;
  /** providerId → last known health. */
  providerHealth: Map<string, HealthResult>;
  /** publicId → model-level health entry. */
  modelHealth: Map<string, ModelHealthEntry>;
  lastUpdated: string;
  catalogStale: boolean;
}

function freshState(): CatalogState {
  return {
    models: new Map(),
    byProvider: new Map(),
    providerHealth: new Map(),
    modelHealth: new Map(),
    lastUpdated: new Date(0).toISOString(),
    catalogStale: true,
  };
}

class ModelCatalogStore {
  private state: CatalogState = freshState();

  /**
   * Snapshot accessor — does NOT mutate (copy-on-write invariant).
   *
   * Reads always see a consistent snapshot because the only writers all
   * build a new state in a local variable and swap the reference at the
   * very end (never mutate `this.state` in place).
   */
  getCatalog(): {
    models: DiscoveredModel[];
    lastUpdated: string;
    catalogStale: boolean;
  } {
    const snapshot = this.state;
    return {
      models: Array.from(snapshot.models.values()),
      lastUpdated: snapshot.lastUpdated,
      catalogStale: snapshot.catalogStale,
    };
  }

  getModel(publicId: string): DiscoveredModel | undefined {
    const snapshot = this.state;
    return snapshot.models.get(publicId);
  }

  /** Resolve a canonical id (or bare upstream id within a namespace) → model. */
  resolveModel(publicId: string): DiscoveredModel | null {
    const snapshot = this.state;
    const direct = snapshot.models.get(publicId);
    if (direct) return direct;
    const parsed = parseCanonicalModelId(publicId);
    if (!parsed) return null;
    // Graceful fallback: find by (providerId, upstreamId).
    for (const m of snapshot.models.values()) {
      if (
        m.providerId === parsed.providerId &&
        m.upstreamId === parsed.upstreamId
      ) return m;
    }
    return null;
  }

  getProviderModels(providerId: string): DiscoveredModel[] {
    const snapshot = this.state;
    const ids = snapshot.byProvider.get(providerId);
    if (!ids) return [];
    const out: DiscoveredModel[] = [];
    for (const id of ids) {
      const m = snapshot.models.get(id);
      if (m) out.push(m);
    }
    return out;
  }

  getProviderHealth(providerId: string): HealthResult | undefined {
    return this.state.providerHealth.get(providerId);
  }

  /**
   * Copy-on-write update for provider health.
   * Builds a new state with the updated entry and swaps the reference
   * atomically — concurrent readers never see a partial mutation.
   */
  setProviderHealth(providerId: string, result: HealthResult): void {
    this.swapState((prev) => ({
      models: prev.models,
      byProvider: prev.byProvider,
      providerHealth: new Map(prev.providerHealth).set(providerId, result),
      modelHealth: prev.modelHealth,
      lastUpdated: prev.lastUpdated,
      catalogStale: prev.catalogStale,
    }));
  }

  getModelHealth(publicId: string): ModelHealthEntry | undefined {
    return this.state.modelHealth.get(publicId);
  }

  /**
   * Copy-on-write update for model-level health.
   * The corresponding model object's `status` field is also updated by
   * replacing the model entry in the new Map (NOT by mutating the original
   * model object in place — that would leak the mutation to the previous
   * snapshot via shared reference).
   */
  setModelHealth(
    publicId: string,
    status: ModelStatus,
    latencyMs?: number,
  ): void {
    this.swapState((prev) => {
      const prevEntry = prev.modelHealth.get(publicId);
      const newEntry: ModelHealthEntry = {
        status,
        failureCount: prevEntry?.failureCount ?? 0,
        lastSuccess: prevEntry?.lastSuccess,
        lastFailure: prevEntry?.lastFailure,
        latencyMs: latencyMs ?? prevEntry?.latencyMs,
      };
      const newModelHealth = new Map(prev.modelHealth).set(publicId, newEntry);
      // Clone the model object if its status actually changes — never mutate
      // the original (it's shared with the previous snapshot).
      const oldModel = prev.models.get(publicId);
      if (oldModel && oldModel.status !== status) {
        const newModels = new Map(prev.models);
        newModels.set(publicId, { ...oldModel, status });
        return {
          models: newModels,
          byProvider: prev.byProvider,
          providerHealth: prev.providerHealth,
          modelHealth: newModelHealth,
          lastUpdated: prev.lastUpdated,
          catalogStale: prev.catalogStale,
        };
      }
      return {
        models: prev.models,
        byProvider: prev.byProvider,
        providerHealth: prev.providerHealth,
        modelHealth: newModelHealth,
        lastUpdated: prev.lastUpdated,
        catalogStale: prev.catalogStale,
      };
    });
  }

  /** Mark the catalog as stale (health probes failing). Copy-on-write. */
  markStale(): void {
    this.swapState((prev) => ({
      ...prev,
      catalogStale: true,
    }));
  }

  /**
   * Synchronously seed the catalog from the static MODELS[] registry.
   *
   * Atomic swap: builds a fresh CatalogState and assigns it. If the catalog
   * is already populated, the seed is merged in (existing entries preserved,
   * new ones added).
   */
  seedSync(models: DiscoveredModel[]): void {
    this.swapState((prev) => {
      const newModels = new Map(prev.models);
      const newByProvider = new Map(prev.byProvider);
      for (const m of models) {
        newModels.set(m.id, { ...m });
        const set = newByProvider.get(m.providerId) ?? new Set<string>();
        set.add(m.id);
        newByProvider.set(m.providerId, set);
      }
      return {
        models: newModels,
        byProvider: newByProvider,
        providerHealth: prev.providerHealth,
        modelHealth: prev.modelHealth,
        lastUpdated: new Date().toISOString(),
        catalogStale: false,
      };
    });
  }

  /** List every provider id present in the catalog. */
  listProviders(): string[] {
    return Array.from(this.state.byProvider.keys());
  }

  /**
   * Apply a pure state transformation synchronously. `fn` receives the
   * previous state and must return a NEW state object; it must never mutate
   * `prev` in place.
   */
  private swapState(fn: (prev: CatalogState) => CatalogState): void {
    this.state = fn(this.state);
  }
}

// Use globalThis-backed singleton so all module instances (route handlers,
// startup) share the same in-memory catalog. Without this, dev servers can
// hold multiple instances per route graph, leading to /v1/models showing 0
// models even after a successful seed.
const globalForCatalog = globalThis as unknown as {
  __freeaixyzCatalogStore?: ModelCatalogStore;
};

export const catalogStore: ModelCatalogStore =
  globalForCatalog.__freeaixyzCatalogStore ?? new ModelCatalogStore();

if (!globalForCatalog.__freeaixyzCatalogStore) {
  globalForCatalog.__freeaixyzCatalogStore = catalogStore;
}

// Re-export for convenience (used by /api/providers).
export { getProviderEntry };
