/**
 * Gateway startup (static registry boot).
 *
 * Idempotent across hot reloads via a globalThis flag. NEVER throws —
 * every step is wrapped in try/catch so a failure can't make the whole
 * app unusable.
 *
 * The catalog is 100% STATIC: it is seeded from the hand-curated MODELS[]
 * registry (src/lib/providers/registry.ts) and never re-fetched or synced.
 * There is no dynamic discovery, no background refresh, no DB persistence.
 */

import { catalogStore } from "@/lib/gateway/catalog";
import { buildLegacyDiscoveredModels } from "@/lib/gateway/adapters/legacy";
import { providerRegistry } from "@/lib/gateway/registry";

const GATEWAY_READY_FLAG = "__freeaixyzGatewayReady" as const;

interface GatewayReadyGlobal {
  [GATEWAY_READY_FLAG]?: Promise<void>;
}

const g = globalThis as unknown as GatewayReadyGlobal;

/**
 * Initialize the gateway. Idempotent. Steps:
 *   1. Sync-seed the catalog from the static MODELS[] registry.
 *   2. Register the provider adapters into the registry.
 */
export async function initGateway(): Promise<void> {
  if (g[GATEWAY_READY_FLAG]) return g[GATEWAY_READY_FLAG]!;
  g[GATEWAY_READY_FLAG] = (async () => {
    // 1. Seed the catalog from the static registry (idempotent).
    try {
      catalogStore.seedSync(buildLegacyDiscoveredModels());
    } catch (err) {
      console.error("[gateway.startup] catalog seedSync failed:", err);
    }
    // 2. Register adapters (synchronous, idempotent).
    try {
      providerRegistry.list(); // triggers ensureSeeded()
    } catch (err) {
      console.error("[gateway.startup] adapter seed failed:", err);
    }
  })();
  return g[GATEWAY_READY_FLAG]!;
}

/** True once the gateway has finished its initial (synchronous) setup. */
export function isGatewayReady(): boolean {
  return Boolean(g[GATEWAY_READY_FLAG]);
}
