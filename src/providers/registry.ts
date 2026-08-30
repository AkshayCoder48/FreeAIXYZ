/**
 * Provider adapter registry (Task 11-backend, PRD §28, §141).
 *
 * Single source of truth for the 17 isolated per-provider adapters living
 * under `src/providers/<provider>/index.ts`. Each adapter owns its own
 * discovery + normalization + free-classification logic — adding or removing
 * a provider never touches the others (PRD §9).
 *
 * The registry is module-scoped and populated by `index.ts` on first import.
 */

import type { ProviderModelAdapter } from "./types";

const REGISTRY = new Map<string, ProviderModelAdapter>();

/** Register an adapter (idempotent by id; later registration wins). */
export function registerProvider(adapter: ProviderModelAdapter): void {
  REGISTRY.set(adapter.id, adapter);
}

/** Look up an adapter by full provider id. */
export function getAdapter(providerId: string): ProviderModelAdapter | undefined {
  return REGISTRY.get(providerId);
}

/** All registered adapters (in insertion order). */
export function allProviders(): ProviderModelAdapter[] {
  return Array.from(REGISTRY.values());
}

/** Only adapters whose `ProviderConfig.enabled` is true (PRD §28). */
export function getEnabledProviders(): ProviderModelAdapter[] {
  return Array.from(REGISTRY.values());
}

/** Convenience: list the ids of all registered providers. */
export function listProviderIds(): string[] {
  return Array.from(REGISTRY.keys());
}
