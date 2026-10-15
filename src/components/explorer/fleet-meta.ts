/**
 * fleet-meta — shared, server-safe metadata for the public Onyx fleet.
 *
 * A plain module (no "use client") so both RSC pages (/models and its
 * family/detail routes) and client islands (the /models catalog) import the
 * exact same serialized model shape.
 *
 * Ten-family architecture: grouping is by FAMILY (ASTRA … ZENITH, defined in
 * `@/lib/onyx/families`) and filtering is by CATEGORY. Family + category
 * metadata are re-exported from the centralized registry modules so every
 * surface uses one source of truth.
 *
 * Public identity rules (per product decision):
 *   - Only onyx-* fleet ids are ever shown; underlying provider-prefixed
 *     routes never appear on any public surface.
 *   - Provider attribution is always "Onyx AI".
 *   - Mature-audience classification lives on model ENTRIES (the 18+ notice)
 *     — never in the primary navigation.
 */

import type {
  ContentClassification,
  FleetCategory,
  FleetFamilyId,
} from "@/lib/onyx/families";

export {
  FLEET_FAMILIES,
  FLEET_CATEGORIES,
  fleetFamily,
  fleetCategoryLabel,
  isFleetFamilySlug,
  isLegacyFleetGroupSlug,
} from "@/lib/onyx/families";

export type {
  ContentClassification,
  FleetCategory,
  FleetFamilyId,
  FleetFamilyMeta,
} from "@/lib/onyx/families";

/** The client-serializable fleet model (no `route` — internal routing only). */
export interface CatalogFleetModel {
  /** Public fleet id (onyx-*). */
  id: string;
  /** Previous-generation ids that still resolve to this slot (aliases). */
  legacyIds: readonly string[];
  /** Clean display name — "[Family] [Variant] [Version]", never "onyx". */
  name: string;
  /** Family slug ("amora"). */
  family: FleetFamilyId;
  /** Family wordmark ("AMORA"). */
  familyName: string;
  /** Optional variant suffix ("Pro", "Raw", …) or null. */
  variant: string | null;
  /** Optional version string ("2", "2.6", …) or null. */
  version: string | null;
  /** Release order within the family(+variant) line. */
  releaseOrder: number;
  /** Functional category ("general", "coding", …). */
  category: FleetCategory;
  /** Content classification — from family metadata, never from the name. */
  contentClassification: ContentClassification;
  /** One-line brief (card subtitle / picker description). */
  brief: string;
  /** Longer description (detail page). */
  description: string;
  /** 18+ notice — hard-test-verified slots only. */
  uncensored: boolean;
  /** Always "Onyx AI". */
  providerName: string;
  capabilities: {
    streaming: boolean;
    reasoning: boolean;
    vision: boolean;
    tools: boolean;
    webSearch: boolean;
    multiTurn: boolean;
    systemPrompt: boolean;
  };
  contextWindow: number;
}

/** Compact context-window label ("128k ctx" / "unknown"). */
export function formatCtx(tokens: number): string {
  if (tokens <= 0) return "unknown ctx";
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k ctx` : `${tokens} ctx`;
}
