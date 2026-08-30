/**
 * Provider discovery architecture — unified types (Task 11-backend, PRD §23-24).
 *
 * These types describe the new isolated per-provider discovery system that
 * lives under `src/providers/<provider>/{discover,normalize,free,index}.ts`.
 * They are independent of the legacy `src/lib/providers/` chat adapters and
 * the gateway's `DiscoveredModel` shape — `sync.ts` converts between the
 * two when applying sync results to `catalogStore`.
 */

export type PricingMode =
  | "api" // every model requires paid API key (none currently in free catalog)
  | "hybrid" // some free, some paid (LLM7 — a few require API keys)
  | "pattern" // free determined by id/name pattern (kilocode, opencode, freegpt, spicywriter)
  | "entirely_free"; // every discovered model is free (most providers here)

export type FreeConfidence =
  | "confirmed" // upstream explicitly priced (input > 0 → NOT free)
  | "provider" // upstream marks model as free OR provider is `entirely_free`
  | "pattern" // matches a provider-specific regex
  | "inferred" // heuristically guessed
  | "unknown"; // can't determine — defaults to NOT free

export type ModelType =
  | "chat"
  | "image"
  | "audio"
  | "video"
  | "embedding"
  | "other";

export type ModelStatus = "active" | "removed" | "temporarily_unavailable";

export type ProviderStatus =
  | "healthy"
  | "syncing"
  | "degraded"
  | "failed"
  | "disabled";

/**
 * The unified model representation produced by every provider adapter.
 * Stable identity is `providerId:modelId` (PRD §23).
 */
export interface UnifiedModel {
  /** Stable canonical id `<providerId>:<modelId>`. */
  id: string;
  /** Full provider id (e.g. "spicywriter"). */
  providerId: string;
  /** Upstream model id (verbatim, never overwritten — PRD §22). */
  modelId: string;
  /** Display name (defaults to modelId). */
  name: string;
  type: ModelType;
  free: boolean;
  freeConfidence: FreeConfidence;
  pricing?: { input?: number; output?: number };
  capabilities: {
    streaming?: boolean;
    vision?: boolean;
    imageGeneration?: boolean;
    audio?: boolean;
    tools?: boolean;
    reasoning?: boolean;
  };
  status: ModelStatus;
  /** ISO timestamp first seen by the sync engine. */
  firstSeenAt: string;
  /** ISO timestamp last seen. */
  lastSeenAt: string;
  /** Verbatim raw upstream object (PRD §229). */
  raw?: unknown;
}

/** Per-provider free classification (PRD §14-18). */
export interface FreeClassification {
  free: boolean;
  confidence: FreeConfidence;
  reason: string;
}

/**
 * Raw-ish normalized fields from `fetchModels()`. Each adapter normalizes
 * further into a `UnifiedModel` via `normalizeModel()`.
 */
export interface ProviderModel {
  id: string;
  name?: string;
  raw: unknown;
}

/**
 * Per-provider adapter contract — discoverers are isolated (PRD §9, §28).
 * Each adapter declares its own `fetchModels`, `normalizeModel`, and
 * `classifyFree` so adding/removing a provider never touches the others.
 */
export interface ProviderModelAdapter {
  id: string;
  name: string;
  pricingMode: PricingMode;
  /** Live (or manual) fetch of upstream model list. NEVER throws. */
  fetchModels(): Promise<ProviderModel[]>;
  /** Map a raw upstream item to the unified shape. */
  normalizeModel(raw: ProviderModel): UnifiedModel;
  /** Per-provider free classification (PRD §14-18). */
  classifyFree(model: UnifiedModel): FreeClassification;
}

/** Single-provider sync result (PRD §8, §24). */
export interface SyncResult {
  providerId: string;
  status: ProviderStatus;
  found: number;
  added: number;
  updated: number;
  removed: number;
  free: number;
  error?: string;
  durationMs: number;
}

/** Aggregate sync result for `syncAll()` (PRD §8). */
export interface FullSyncResult {
  results: SyncResult[];
  totalAdded: number;
  totalUpdated: number;
  totalRemoved: number;
  totalFree: number;
  totalActive: number;
  durationMs: number;
}

/** Per-provider sync configuration (PRD §29, §31). */
export interface ProviderConfig {
  id: string;
  pricingMode: PricingMode;
  /** Per-provider fetch timeout (ms) — PRD §29. */
  timeoutMs: number;
  /** Whether the adapter is enabled (PRD §28). */
  enabled: boolean;
  /** Free regex patterns for `pattern` providers (PRD §18). */
  freePatterns?: RegExp[];
  /** Maximum models to keep (caps memory for high-cardinality upstreams). */
  maxModels?: number;
}
