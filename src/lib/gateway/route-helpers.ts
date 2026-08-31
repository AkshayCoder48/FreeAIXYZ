/**
 * Shared route helpers (PRD §28, §49, §66, §71, §99, §113).
 *
 * - ensureGateway()         — idempotent initGateway() call for every route
 * - resolveAdapterForModel() — canonical id → { model, adapter } | null
 * - parseModelParam()        — parse `<shortId>/<upstreamId>` strings
 *
 * All API routes import these helpers and call `await ensureGateway()` at the
 * top so the catalog is loaded before any lookup.
 */

import {
  catalogStore,
  initGateway,
  parseCanonicalModelId,
  providerRegistry,
} from "@/lib/gateway";
import type { DiscoveredModel, ProviderAdapter } from "@/lib/gateway";

/**
 * Initialize the gateway (idempotent across hot reloads — PRD §28). Every API
 * route calls this at the top so the catalog is loaded before any lookup.
 *
 * NEVER throws — startup.ts wraps every step in try/catch + logs failures.
 */
export async function ensureGateway(): Promise<void> {
  await initGateway();
}

/**
 * Resolve a public model id into its DiscoveredModel + ProviderAdapter
 * (PRD §49, §66, §99). Returns null when the model is not found in the
 * catalog (route returns 404 MODEL_NOT_FOUND) or its provider has no
 * registered adapter (route returns 404 PROVIDER_NOT_FOUND).
 *
 * Accepts both canonical ids (`fg/gpt-5.5`, `tb/gpt-5`) and bare upstream ids
 * that resolve within a known provider namespace (graceful fallback during
 * migration — catalogStore.resolveModel handles that).
 */
export function resolveAdapterForModel(
  publicId: string,
): { model: DiscoveredModel; adapter: ProviderAdapter } | null {
  if (!publicId) return null;
  const model = catalogStore.resolveModel(publicId);
  if (!model) return null;
  const adapter = providerRegistry.get(model.providerId);
  if (!adapter) return null;
  return { model, adapter };
}

/**
 * Parse a canonical model id parameter into { providerId, upstreamId }
 * (PRD §66, §99). Returns null if the prefix namespace is unknown.
 *
 * Used by `/api/models/[id]` and anywhere a route takes a model id in the
 * path rather than the request body.
 */
export function parseModelParam(
  param: string,
): { providerId: string; upstreamId: string } | null {
  return parseCanonicalModelId(param);
}
