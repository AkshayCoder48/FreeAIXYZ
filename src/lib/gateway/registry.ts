/**
 * Provider registry (PRD §141).
 *
 * Singleton. Legacy adapters are auto-registered on first synchronous
 * access (PRD §71). Phase 2b agents call registerDynamicDiscoverer() to
 * plug in real upstream /models discovery (e.g. for FreeGPT, which uses
 * Node-only APIs and isn't part of the legacy PROVIDERS map).
 */

import { buildLegacyAdapters } from "@/lib/gateway/adapters/legacy";
import { getByShortId } from "@/lib/gateway/ids";
import type { ProviderAdapter } from "@/lib/gateway/types";

export type DynamicDiscoverer = (
  providerId: string,
) => Promise<ProviderAdapter | null>;

class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private byShortId = new Map<string, ProviderAdapter>();
  private discoverers = new Map<string, DynamicDiscoverer>();
  private legacySeeded = false;
  private dynamicBooted = false;
  private bootPromise: Promise<void> | null = null;

  /** Register an adapter. Idempotent by id (later registration wins). */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    if (adapter.shortId) this.byShortId.set(adapter.shortId, adapter);
  }

  /**
   * Register a dynamic discoverer for a provider (PRD §141). The discoverer
   * will be invoked on the next boot() and may return a ProviderAdapter
   * or null (if the provider is currently unreachable).
   */
  registerDynamicDiscoverer(providerId: string, fn: DynamicDiscoverer): void {
    this.discoverers.set(providerId, fn);
  }

  /** Synchronously seed legacy adapters (idempotent). */
  private ensureSeeded(): void {
    if (this.legacySeeded) return;
    this.legacySeeded = true;
    for (const a of buildLegacyAdapters()) this.register(a);
  }

  /**
   * Boot dynamic discoverers (PRD §141). Called by startup.ts after
   * legacy seeding. Idempotent and parallel-safe.
   */
  async boot(): Promise<void> {
    this.ensureSeeded();
    if (this.dynamicBooted) return;
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = (async () => {
      for (const [providerId, fn] of this.discoverers) {
        try {
          const adapter = await fn(providerId);
          if (adapter) this.register(adapter);
        } catch (err) {
          console.error(
            `[gateway.registry] dynamic discoverer for ${providerId} failed:`,
            err,
          );
        }
      }
      this.dynamicBooted = true;
    })();
    return this.bootPromise;
  }

  get(id: string): ProviderAdapter | undefined {
    this.ensureSeeded();
    return this.adapters.get(id);
  }

  getByShortId(shortId: string): ProviderAdapter | undefined {
    this.ensureSeeded();
    return this.byShortId.get(shortId);
  }

  list(): ProviderAdapter[] {
    this.ensureSeeded();
    return Array.from(this.adapters.values());
  }

  /** Resolve a short id → provider id (no adapter lookup, returns undefined if unknown). */
  resolveShortId(shortId: string): string | undefined {
    const entry = getByShortId(shortId);
    if (entry) return entry.id;
    return this.byShortId.get(shortId)?.id;
  }
}

// Use globalThis-backed singleton so all module instances share the same
// ProviderRegistry (matters in Turbopack dev where each route graph might
// otherwise get its own instance — see catalog.ts for the same pattern).
const globalForRegistry = globalThis as unknown as {
  __freeaixyzProviderRegistry?: ProviderRegistry;
};

export const providerRegistry: ProviderRegistry =
  globalForRegistry.__freeaixyzProviderRegistry ?? new ProviderRegistry();

if (!globalForRegistry.__freeaixyzProviderRegistry) {
  globalForRegistry.__freeaixyzProviderRegistry = providerRegistry;
}
