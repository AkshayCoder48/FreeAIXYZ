/**
 * Gateway startup sequence (PRD §28, §30, §31, §85).
 *
 * Idempotent across hot reloads via a globalThis flag (mirrors the db.ts
 * pattern). NEVER throws — every step is wrapped in try/catch so a
 * failed provider discovery can't make the whole app unusable (PRD §28).
 */

import { catalogStore } from "@/lib/gateway/catalog";
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
 *   2. Register legacy adapters into the registry (PRD §71).
 *   3. Register any dynamic discoverers from Phase 2b (optional, dynamic import).
 *   4. Kick off background discoverAll() (non-blocking — PRD §28).
 *   5. Start periodic background refresh (PRD §30).
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
    // 2. Register legacy adapters (synchronous seed).
    try {
      providerRegistry.list(); // triggers ensureSeeded()
    } catch (err) {
      console.error("[gateway.startup] legacy seed failed:", err);
    }
    // 3. Dynamic discoverers from Phase 2b (optional module).
    await registerDynamicDiscoverers().catch((err) =>
      console.error("[gateway.startup] dynamic discoverers failed:", err),
    );
    // 4. Kick off background discovery (non-blocking — PRD §28).
    modelDiscoveryService.discoverAll().catch((err) =>
      console.error("[gateway.startup] initial discoverAll failed:", err),
    );
    // 5. Start periodic background refresh (PRD §30).
    try {
      modelDiscoveryService.startBackgroundRefresh();
    } catch (err) {
      console.error("[gateway.startup] background refresh start failed:", err);
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
