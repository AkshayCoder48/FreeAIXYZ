/**
 * fleet-meta — shared, server-safe metadata for the public Onyx fleet.
 *
 * A plain module (no "use client") so both RSC pages (/models and its
 * group/detail routes) and client islands (the /models catalog) import the
 * exact same group ordering, labels and serialized model shape.
 *
 * Public identity rules (per product decision):
 *   - Only onyx-* fleet ids are ever shown; underlying provider-prefixed
 *     routes never appear on any public surface.
 *   - Provider attribution is always "Onyx AI".
 *   - The 18+ badge is only rendered for slots whose fleet entry is marked
 *     `uncensored` (live hard-test-verified — never faked).
 */

export type FleetGroupSlug = "uncensored" | "general" | "creative";

export interface CatalogFleetModel {
  /** Public fleet id (onyx-*). */
  id: string;
  /** Clean display name — never contains "onyx". */
  name: string;
  /** One-line brief (card subtitle / picker description). */
  brief: string;
  /** Longer description (detail page). */
  description: string;
  group: FleetGroupSlug;
  /** 18+ badge flag — hard-test-verified slots only. */
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

export interface FleetGroupMeta {
  slug: FleetGroupSlug;
  /** Long label (page headings, metadata). */
  label: string;
  /** Short label (filter pills, breadcrumbs). */
  shortLabel: string;
}

/** Fixed display order: the 18+ line first, then general, then creative. */
export const FLEET_GROUP_META: readonly FleetGroupMeta[] = [
  { slug: "uncensored", label: "Uncensored · 18+", shortLabel: "Uncensored" },
  { slug: "general", label: "General", shortLabel: "General" },
  { slug: "creative", label: "Creative", shortLabel: "Creative" },
];

const GROUP_SLUGS = new Set<string>(FLEET_GROUP_META.map((g) => g.slug));

/** True only for the three fleet-group slugs — anything else (old provider
 *  ids like "tb" or "nsfwgirlfriend") is invalid and redirects to /models. */
export function isFleetGroupSlug(raw: string): raw is FleetGroupSlug {
  return GROUP_SLUGS.has(raw);
}

/** Group label lookup (falls back to the raw slug). */
export function fleetGroupLabel(slug: FleetGroupSlug): string {
  return FLEET_GROUP_META.find((g) => g.slug === slug)?.label ?? slug;
}

/** Compact context-window label ("128k ctx" / "unknown"). */
export function formatCtx(tokens: number): string {
  if (tokens <= 0) return "unknown ctx";
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k ctx` : `${tokens} ctx`;
}
