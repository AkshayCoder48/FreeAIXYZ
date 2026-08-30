/**
 * Provider discovery architecture — barrel + auto-registration
 * (Task 11-backend, PRD §6, §28).
 *
 * Importing this module registers all 17 isolated per-provider adapters
 * into the local registry (PRD §28 — never modify one provider when
 * adding another). `syncAll()` then runs each adapter's `fetchModels()`
 * in parallel and pushes the unified results into `catalogStore`.
 *
 * The existing `src/lib/providers/*.ts` adapters (chat/streaming) stay
 * unchanged — this module ONLY handles model discovery + free classification.
 */

export type {
  FreeClassification,
  FreeConfidence,
  FullSyncResult,
  ModelStatus,
  ModelType,
  PricingMode,
  ProviderConfig,
  ProviderModel,
  ProviderModelAdapter,
  ProviderStatus,
  SyncResult,
  UnifiedModel,
} from "./types";

export {
  getProviderConfig,
  PROVIDER_CONFIGS,
} from "./config";

export {
  allProviders,
  getAdapter,
  getEnabledProviders,
  listProviderIds,
  registerProvider,
} from "./registry";

export { getSyncStatus, syncAll, syncProvider } from "./sync";

// ─── Auto-register all 17 providers (PRD §28) ─────────────────────────────────

import { registerProvider } from "./registry";
import { auroraaiAdapter } from "./auroraai";
import { freeaixyzAdapter } from "./freeaixyz";
import { freechatAdapter } from "./freechat";
import { freegptAdapter } from "./freegpt";
import { gptossAdapter } from "./gptoss";
import { jollygenAdapter } from "./jollygen";
import { kilocodeAdapter } from "./kilocode";
import { llm7Adapter } from "./llm7";
import { mikliumAdapter } from "./miklium";
import { opencodeAdapter } from "./opencode";
import { pollinationsAdapter } from "./pollinations";
import { spicywriterAdapter } from "./spicywriter";
import { surfsenseAdapter } from "./surfsense";
import { swarmAdapter } from "./swarm";
import { toolbazAdapter } from "./toolbaz";
import { unlimitedaiAdapter } from "./unlimitedai";
import { vexaAdapter } from "./vexa";

let REGISTERED = false;
/** Register all 17 adapters. Idempotent — safe to call multiple times. */
export function ensureProvidersRegistered(): void {
  if (REGISTERED) return;
  REGISTERED = true;
  registerProvider(pollinationsAdapter);
  registerProvider(kilocodeAdapter);
  registerProvider(llm7Adapter);
  registerProvider(opencodeAdapter);
  registerProvider(swarmAdapter);
  registerProvider(spicywriterAdapter);
  registerProvider(vexaAdapter);
  registerProvider(gptossAdapter);
  registerProvider(auroraaiAdapter);
  registerProvider(surfsenseAdapter);
  registerProvider(jollygenAdapter);
  registerProvider(unlimitedaiAdapter);
  registerProvider(freechatAdapter);
  registerProvider(mikliumAdapter);
  registerProvider(freeaixyzAdapter);
  registerProvider(freegptAdapter);
  registerProvider(toolbazAdapter);
}

// Register on module import so `import { syncAll } from "@/providers"` is enough.
ensureProvidersRegistered();
