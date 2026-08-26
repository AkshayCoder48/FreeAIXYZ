/**
 * Gateway startup sequence (PRD §28, §30, §31, §85, audit C1 cold-start fix).
 *
 * Idempotent across hot reloads via a globalThis flag (mirrors the db.ts
 * pattern). NEVER throws — every step is wrapped in try/catch so a
 * failed provider discovery can't make the whole app unusable (PRD §28).
 */
import { catalogStore } from "@/lib/gateway/catalog";
import { buildLegacyDiscoveredModels } from "@/lib/gateway/adapters/legacy";
import { modelDiscoveryService } from "@/lib/gateway/discovery";
import { providerRegistry } from "@/lib/gateway/registry";

const GATEWAY_READY_FLAG = "__freeaixyzGatewayReady" as const;

interface GatewayReadyGlobal {
  [GATEWAY_READY_FLAG]?: Promise<void>;
}

const g = globalThis as unknown as GatewayReadyGlobal;

/**
 * Initialize the gateway. Idempotent (PRD §28, §31, §85). Steps:
 *   1. Load last-known catalog from Prisma (PRD §31).
 *   2. Sync-seed from legacy MODELS[] so the catalog is never empty (audit C1).
 *   3. Register legacy adapters into the registry (PRD §71).
 *   4. Register any dynamic discoverers from Phase 2b (optional, dynamic import).
 *   5. Kick off background discoverAll() (non-blocking — PRD §28).
 *   6. Start periodic background refresh (PRD §30).
 *
 * NEVER throws. Every step is wrapped in try/catch + logged.
 */
export async function initGateway(): Promise<void> {
  if (g[GATEWAY_READY_FLAG]) return g[GATEWAY_READY_FLAG]!;
  g[GATEWAY_READY_FLAG] = (async () => {
    // 1. Load last-known catalog from Prisma (PRD §31).
    await catalogStore.loadFromDb().catch((err) =>
      console.error("[gateway.startup] catalog loadFromDb failed:", err),
    );
    // 2. Sync-seed from legacy MODELS[] (audit C1 cold-start fix).
    // If loadFromDb returned an empty state, the catalog has zero models
    // until the background discovery (kicked off non-blocking below) finishes.
    // The first burst of parallel requests would all get spurious 404s. Seed
    // synchronously so the gateway is "ready" with a non-empty catalog.
    try {
      catalogStore.seedSync(buildLegacyDiscoveredModels());
    } catch (err) {
      console.error("[gateway.startup] catalog seedSync failed:", err);
    }
    // 3. Register legacy adapters (synchronous seed).
    try {
      providerRegistry.list(); // triggers ensureSeeded()
    } catch (err) {
      console.error("[gateway.startup] legacy seed failed:", err);
    }
    // 4. Dynamic discoverers from Phase 2b (optional module).
    await registerDynamicDiscoverers().catch((err) =>
      console.error("[gateway.startup] dynamic discoverers failed:", err),
    );
    // 5. LEGACY discoverAll DISABLED — it was racing with the new isolated
    //    per-provider sync engine (step 5b). The legacy `discoverAll()` walks
    //    the legacy MODELS[] array (only 2 SpicyWriter entries, 16 Kilo Code)
    //    and atomically REPLACES the catalog state via atomicUpdate(),
    //    stomping over the 51 live SpicyWriter models (and 30 live Kilo Code
    //    models) the new sync engine had just pushed in. This was the root
    //    cause of "SpicyWriter shows only 2 models" on production even though
    //    /api/sync/status reported "spicywriter: 51 found, 14 free".
    //    The new sync engine (step 5b) is the single source of truth.
    // modelDiscoveryService.discoverAll().catch((err) =>
    //   console.error("[gateway.startup] initial discoverAll failed:", err),
    // );
    // 5b. Kick off the NEW isolated per-provider sync engine (Task 11-backend).
    //     This re-fetches live model lists from every provider's /models
    //     endpoint (or manual fallback) and pushes results into the
    //     in-memory catalog. SpicyWriter's new "Ox Alpha" / "Gemma 4 31B T"
    //     / "Ling 2.6 Flash" / "Lunaris" / "Nemo" free models are auto-
    //     discovered here.
    //
    //     On Vercel serverless, each cold start gets a fresh module scope
    //     (no persistence between invocations). To make the catalog actually
    //     reflect the synced state on cold start, we AWAIT syncAll() here
    //     instead of firing it non-blocking. The first request after a cold
    //     start pays the sync latency (~3-5s for 17 providers in parallel);
    //     subsequent requests on the warm instance are fast (idempotent flag
    //     skips the await). This is the tradeoff for not running a separate
    //     persistence layer (SQLite is ephemeral on Vercel).
    try {
      const providersModule = (await import(
        /* webpackChunkName: "providers-sync" */ "@/providers"
      )) as typeof import("@/providers");
      providersModule.ensureProvidersRegistered();
      try {
        await providersModule.syncAll();
      } catch (err) {
        console.error("[gateway.startup] initial syncAll failed:", err);
      }
    } catch (err) {
      console.error("[gateway.startup] providers module import failed:", err);
    }
    // 6. Periodic background refresh — re-runs the new sync engine every 30
    //    minutes (PRD §30). The legacy `modelDiscoveryService` periodic
    //    refresh is also disabled to avoid the same race condition recurring.
    // modelDiscoveryService.startBackgroundRefresh();
    try {
      const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
      const refreshTimer = setInterval(async () => {
        try {
          const providersModule = (await import(
            /* webpackChunkName: "providers-sync" */ "@/providers"
          )) as typeof import("@/providers");
          providersModule.ensureProvidersRegistered();
          await providersModule.syncAll();
        } catch (err) {
          console.error("[gateway.startup] periodic syncAll failed:", err);
        }
      }, REFRESH_INTERVAL_MS);
      if (typeof refreshTimer.unref === "function") {
        refreshTimer.unref();
      }
    } catch (err) {
      console.error("[gateway.startup] periodic refresh setup failed:", err);
    }
  })();
  return g[GATEWAY_READY_FLAG]!;
}

/** True once the gateway has finished its initial (synchronous) setup. */
export function isGatewayReady(): boolean {
  return Boolean(g[GATEWAY_READY_FLAG]);
}

/**
 * Phase 2b agent may create `src/lib/providers/dynamic-discovery.ts` which
 * default-exports a function `registerDynamicDiscoverers(registry)` that
 * calls `registry.registerDynamicDiscoverer(providerId, fn)` for each
 * provider it wants to plug in (e.g. FreeGPT, which uses Node-only APIs).
 * Best-effort dynamic import so the gateway still works without Phase 2b.
 */
async function registerDynamicDiscoverers(): Promise<void> {
  try {
    // Path is indirected via a runtime variable so TypeScript can't
    // statically resolve it AND bundlers (Turbopack/webpack) won't try to
    // build it as a static dependency. The module is OPTIONAL — Phase 2b
    // agent creates `src/lib/providers/dynamic-discovery.ts`.
    const modulePath = "@/lib/providers/dynamic-discovery";
    const mod = (await import(modulePath)) as {
      registerDynamicDiscoverers?: (reg: typeof providerRegistry) => void;
    };
    const register = mod.registerDynamicDiscoverers;
    if (typeof register === "function") {
      register(providerRegistry);
      await providerRegistry.boot();
    }
  } catch {
    // Module doesn't exist yet (Phase 2b hasn't run). Safe to ignore.
  }
}
