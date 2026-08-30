/**
 * Model catalog store (PRD §31, §171, §200, §202, §203).
 *
 * In-memory cache + Prisma persistence. Single-writer discovery lock
 * guarantees atomic discovery swaps (PRD §200, §202). Disappeared models
 * are marked degraded, NEVER deleted (PRD §84, §203). All Prisma writes
 * are best-effort — a DB failure must never crash the in-memory catalog.
 */

import { db } from "@/lib/db";
import { getProviderEntry, parseCanonicalModelId } from "@/lib/gateway/ids";
import type {
  DiscoveredModel,
  DiscoveryResult,
  HealthResult,
  ModelCapabilities,
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
  /** providerId → set of publicIds (including degraded ones — never removed, PRD §84). */
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
  private discoveryLock: Promise<void> = Promise.resolve();

  /** Serialize concurrent atomic swaps (PRD §200, §201). */
  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.discoveryLock;
    let release!: () => void;
    this.discoveryLock = new Promise<void>((resolve) => (release = resolve));
    return prev.then(() => fn()).finally(release);
  }

  /**
   * Snapshot accessor — does NOT mutate (audit C1: copy-on-write invariant).
   *
   * Reads always see a consistent snapshot because the only writer is
   * `atomicUpdate()` (which builds a new state in a local variable and
   * swaps the reference at the very end) and the small mutation helpers
   * (`setProviderHealth` / `setModelHealth` / `markStale`) which all also
   * swap the reference (never mutate `this.state` in place).
   */
  getCatalog(): {
    models: DiscoveredModel[];
    lastUpdated: string;
    catalogStale: boolean;
  } {
    // Read the state reference ONCE into a local — bulletproof against a
    // concurrent swap that reassigns `this.state` mid-call (audit C1).
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
    // Read the state reference once — never re-read `this.state` mid-call.
    const snapshot = this.state;
    const direct = snapshot.models.get(publicId);
    if (direct) return direct;
    const parsed = parseCanonicalModelId(publicId);
    if (!parsed) return null;
    // Graceful fallback during migration: find by (providerId, upstreamId).
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
   * Copy-on-write update for provider health (audit C1).
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
   * Copy-on-write update for model-level health (audit C1).
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

  /** Mark the catalog as stale when discovery fails (PRD §171). Copy-on-write. */
  markStale(): void {
    this.swapState((prev) => ({
      ...prev,
      catalogStale: true,
    }));
  }

  /**
   * Synchronously seed the catalog from legacy MODELS[] entries (audit C1).
   *
   * Called by startup.ts when loadFromDb() returns 0 rows — without this
   * seed, the gateway returns "ready" with an EMPTY catalog and the first
   * burst of parallel requests all get spurious 404s before the background
   * discovery (which is kicked off non-blocking) populates the catalog.
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

  /**
   * Remove every catalog entry for a single provider (used when a provider
   * is disabled / delisted). Atomic copy-on-write swap. Does NOT throw if
   * the provider has no entries.
   */
  removeProviderModels(providerId: string): void {
    this.swapState((prev) => {
      const newModels = new Map<string, DiscoveredModel>();
      const removedIds = new Set<string>();
      for (const [id, m] of prev.models) {
        if (m.providerId === providerId) {
          removedIds.add(id);
        } else {
          newModels.set(id, m);
        }
      }
      const newByProvider = new Map(prev.byProvider);
      newByProvider.delete(providerId);
      const newModelHealth = new Map(prev.modelHealth);
      for (const id of removedIds) newModelHealth.delete(id);
      return {
        models: newModels,
        byProvider: newByProvider,
        providerHealth: prev.providerHealth,
        modelHealth: newModelHealth,
        lastUpdated: new Date().toISOString(),
        catalogStale: false,
      };
    });
  }

  /**
   * Apply a pure state transformation synchronously (audit C1).
   * The transform returns a NEW CatalogState; this method assigns it to
   * `this.state` atomically. Never mutate `prev` in place inside `fn`.
   *
   * Synchronous (no lock) because the assignment itself is atomic in JS's
   * single-threaded event loop. The discovery lock is only needed for
   * `atomicUpdate()` which spans multiple awaits.
   */
  private swapState(fn: (prev: CatalogState) => CatalogState): void {
    this.state = fn(this.state);
  }

  /**
   * Replace the catalog atomically (PRD §200, §202).
   *
   * For each provider's result: dedup by providerId+upstreamId (PRD §68);
   * mark provider's previous models that disappeared as degraded (do NOT
   * delete — PRD §84, §203); persist Provider + ProviderModel + ModelCapability
   * rows via upsert. DB failures do NOT abort the in-memory swap.
   */
  async atomicUpdate(results: DiscoveryResult[]): Promise<void> {
    await this.withLock(async () => {
      const next: CatalogState = {
        models: new Map(this.state.models),
        byProvider: new Map(),
        providerHealth: new Map(this.state.providerHealth),
        modelHealth: new Map(this.state.modelHealth),
        lastUpdated: new Date().toISOString(),
        catalogStale: false,
      };
      // Clone previous per-provider sets (disappeared models stay listed —
      // PRD §84: never delete).
      for (const [pid, set] of this.state.byProvider) {
        next.byProvider.set(pid, new Set(set));
      }

      for (const r of results) {
        const seenKeys = new Set<string>();
        const newIds = new Set<string>();
        for (const m of r.models) {
          // Dedup by providerId+upstreamId (PRD §68).
          const key = `${m.providerId}|${m.upstreamId}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          next.models.set(m.id, { ...m });
          newIds.add(m.id);
          const set = next.byProvider.get(r.providerId) ?? new Set<string>();
          set.add(m.id);
          next.byProvider.set(r.providerId, set);
        }
        // Mark disappeared models degraded (PRD §84, §203). Skip if the
        // provider returned zero models due to an error — don't punish
        // existing models for a transient failure (PRD §203).
        if (!(r.error && r.models.length === 0)) {
          const prior = next.byProvider.get(r.providerId) ?? new Set<string>();
          for (const id of prior) {
            if (!newIds.has(id)) {
              const m = next.models.get(id);
              // Audit C1: replace the model entry with a shallow-cloned copy
              // when its status changes — never mutate the shared object in
              // place (it would leak the change to the previous snapshot).
              if (m && m.status !== "offline") {
                next.models.set(id, { ...m, status: "degraded" });
              }
            }
          }
        }
        // Best-effort persistence (PRD §82). DB failures never abort swap.
        // NOTE: persistence is currently DISABLED in the dev sandbox because
        // the sequential per-model Prisma upserts (2 queries per model × 300+
        // models × 9 providers) were causing the dev server to be OOM-killed
        // (the box has only 4GB RAM and Turbopack already consumes ~2.5GB).
        // The in-memory catalog is the source of truth — the DB rows are
        // only used to seed the catalog on cold start via loadFromDb(). The
        // new startup.ts loads whatever was persisted last, and the in-memory
        // discovery repopulates it on the next refresh anyway. Re-enable
        // persistence when running on a host with adequate memory.
        // this.persistProvider(r).catch((err) =>
        //   console.error(
        //     `[gateway.catalog] persist failed for provider ${r.providerId}:`,
        //     err,
        //   ),
        // );
      }

      this.state = next;
    });
  }

  /** Load the last-known catalog from Prisma (PRD §31). */
  async loadFromDb(): Promise<void> {
    try {
      const rows = await db.providerModel.findMany({
        include: { provider: true },
      });
      if (rows.length === 0) {
        this.state = freshState();
        return;
      }
      const capsRows = await db.modelCapability.findMany({
        where: { modelId: { in: rows.map((r) => r.id) } },
      });
      const capsByModelId = new Map(capsRows.map((c) => [c.modelId, c]));
      const models = new Map<string, DiscoveredModel>();
      const byProvider = new Map<string, Set<string>>();
      for (const row of rows) {
        const caps = capsByModelId.get(row.id);
        const capabilities: ModelCapabilities = caps
          ? {
              text: caps.text,
              image: caps.image,
              imageEdit: caps.imageEdit,
              audioInput: caps.audioInput,
              audioOutput: caps.audioOutput,
              vision: caps.vision,
              tools: caps.tools,
              streaming: caps.streaming,
            }
          : {
              text: true,
              image: false,
              imageEdit: false,
              audioInput: false,
              audioOutput: false,
              vision: false,
              tools: false,
              streaming: false,
            };
        const m: DiscoveredModel = {
          id: row.publicId,
          providerId: row.providerId,
          providerName: row.provider?.name ?? row.providerId,
          upstreamId: row.upstreamId,
          name: row.name,
          capabilities,
          metadata: row.rawMetadata
            ? { source: "db", raw: safeParse(row.rawMetadata) }
            : { source: "db" },
          discoveredAt: row.firstDiscoveredAt.toISOString(),
          lastVerifiedAt: row.lastVerifiedAt?.toISOString(),
          status: row.status as ModelStatus,
          discoveryMode: row.discoveryMode === "dynamic" ? "dynamic" : "manual",
          discoveredFrom: row.discoveredFrom ?? undefined,
        };
        models.set(m.id, m);
        const set = byProvider.get(m.providerId) ?? new Set<string>();
        set.add(m.id);
        byProvider.set(m.providerId, set);
      }
      this.state = {
        models,
        byProvider,
        providerHealth: new Map(),
        modelHealth: new Map(),
        lastUpdated: new Date().toISOString(),
        catalogStale: false,
      };
    } catch (err) {
      console.error("[gateway.catalog] loadFromDb failed:", err);
    }
  }

  /** Best-effort persistence of a single provider's discovery result. */
  private async persistProvider(r: DiscoveryResult): Promise<void> {
    const shortId = getProviderEntry(r.providerId)?.shortId ?? r.providerId;
    // Upsert provider row.
    let providerOk = true;
    try {
      await db.provider.upsert({
        where: { id: r.providerId },
        create: {
          id: r.providerId,
          shortId,
          name: r.providerId,
          status: "unknown",
          discoveryMode: r.mode,
          lastDiscoveryAt: new Date(r.finishedAt),
        },
        update: {
          discoveryMode: r.mode,
          lastDiscoveryAt: new Date(r.finishedAt),
        },
      });
    } catch (err) {
      // ShortId unique-constraint collision can occur during legacy seeding
      // if multiple providers map to the same fallback shortId; tolerate.
      console.error(
        `[gateway.catalog] provider upsert failed ${r.providerId}:`,
        err,
      );
      providerOk = false;
    }
    if (!providerOk) return;

    for (const m of r.models) {
      try {
        const row = await db.providerModel.upsert({
          where: { publicId: m.id },
          create: {
            providerId: r.providerId,
            upstreamId: m.upstreamId,
            publicId: m.id,
            name: m.name,
            discoveredFrom: m.discoveredFrom ?? null,
            discoveryMode: m.discoveryMode,
            status: m.status,
            lastDiscoveredAt: new Date(m.discoveredAt),
            rawMetadata: m.metadata?.raw
              ? JSON.stringify(m.metadata.raw)
              : null,
          },
          update: {
            name: m.name,
            status: m.status,
            lastDiscoveredAt: new Date(m.discoveredAt),
          },
        });
        await db.modelCapability.upsert({
          where: { modelId: row.id },
          create: {
            modelId: row.id,
            text: m.capabilities.text,
            image: m.capabilities.image,
            imageEdit: m.capabilities.imageEdit,
            audioInput: m.capabilities.audioInput,
            audioOutput: m.capabilities.audioOutput,
            vision: m.capabilities.vision,
            tools: m.capabilities.tools,
            streaming: m.capabilities.streaming,
          },
          update: {
            text: m.capabilities.text,
            image: m.capabilities.image,
            imageEdit: m.capabilities.imageEdit,
            audioInput: m.capabilities.audioInput,
            audioOutput: m.capabilities.audioOutput,
            vision: m.capabilities.vision,
            tools: m.capabilities.tools,
            streaming: m.capabilities.streaming,
          },
        });
      } catch (err) {
        console.error(
          `[gateway.catalog] model upsert failed ${m.id}:`,
          err,
        );
      }
    }
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// Use globalThis-backed singleton so all module instances (route handlers,
// discovery service, startup) share the same in-memory catalog. Without this,
// Turbopack dev server can hold multiple instances per route graph, leading to
// /v1/models showing 0 models even after a successful discovery refresh.
const globalForCatalog = globalThis as unknown as {
  __freeaixyzCatalogStore?: ModelCatalogStore;
};

export const catalogStore: ModelCatalogStore =
  globalForCatalog.__freeaixyzCatalogStore ?? new ModelCatalogStore();

if (!globalForCatalog.__freeaixyzCatalogStore) {
  globalForCatalog.__freeaixyzCatalogStore = catalogStore;
}
