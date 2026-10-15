"use client";

/**
 * ModelsCatalog — /models fleet catalog (static data, FreeAIXYZ design).
 *
 * Receives the serialized Onyx fleet via props (RSC-serialized from the
 * static FLEET_CATALOG — no network fetch, no discovery, no credentials).
 * The fleet is the ONLY public model surface: clean display names, onyx-*
 * ids, and "Onyx AI" attribution everywhere. Provider-prefixed routes are
 * never listed here.
 *
 * Ten-family layout (PRD §8/§10):
 *   - Eyebrow + headline + search
 *   - Category filter pills (General / Performance / Reasoning / Coding /
 *     Creative / Multimodal / Experimental / Flagship — only categories
 *     with live models render a pill)
 *   - One section per family (01 ASTRA → 10 ZENITH, fixed order) with a
 *     responsive grid of obsidian cards. Families with no public models
 *     yet (RIVEN, ZENITH) render an honest empty state — never placeholder
 *     models.
 *   - The AMORA family is identifiable through its family metadata and
 *     carries an adults-only notice WITHIN the section; the 18+ notice also
 *     renders on each AMORA card. Nothing adult-related lives in the
 *     navigation.
 *
 * Search matches names, ids, briefs, descriptions, family names and the
 * legacy aliases (so "onyx-lust-v1" still finds Amora).
 */

import * as React from "react";
import { Search, AlertTriangle, Boxes } from "lucide-react";

import { cn } from "@/lib/utils";
import { FleetCard } from "@/components/explorer/fleet-card";
import {
  FLEET_FAMILIES,
  FLEET_CATEGORIES,
  fleetCategoryLabel,
  type CatalogFleetModel,
  type FleetCategory,
  type FleetFamilyMeta,
} from "@/components/explorer/fleet-meta";

export type { CatalogFleetModel };

export interface ModelsCatalogData {
  models: CatalogFleetModel[];
}

export function ModelsCatalog({ data }: { data: ModelsCatalogData }) {
  const { models } = data;
  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState<"all" | FleetCategory>("all");

  // Models per family, preserving the fixed 01→10 family order.
  const families = React.useMemo(
    () =>
      FLEET_FAMILIES.map((f: FleetFamilyMeta) => ({
        ...f,
        items: models.filter((m) => m.family === f.id),
      })),
    [models],
  );

  // Only categories with live models get a filter pill.
  const liveCategories = React.useMemo(() => {
    const counts = new Map<FleetCategory, number>();
    for (const m of models) {
      counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    }
    return FLEET_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map(
      (c) => ({ ...c, count: counts.get(c.id) ?? 0 }),
    );
  }, [models]);

  const q = query.trim().toLowerCase();

  const matchesQuery = React.useCallback(
    (m: CatalogFleetModel) => {
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.familyName.toLowerCase().includes(q) ||
        m.brief.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.legacyIds.some((legacy) => legacy.toLowerCase().includes(q))
      );
    },
    [q],
  );

  // Apply search + category filter.
  const filtered = React.useMemo(
    () =>
      families
        .filter((f) => categoryFilter === "all" || f.category === categoryFilter)
        .map((f) => ({ ...f, items: f.items.filter(matchesQuery) })),
    [families, categoryFilter, matchesQuery],
  );

  // Any visible model at all (drives the no-results state).
  const anyVisible = filtered.some((f) => f.items.length > 0);
  const populatedFamilies = families.filter((f) => f.items.length > 0).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header + search */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div className="flex flex-col gap-3">
            <span className="fxz-section-eyebrow">FreeAIXYZ // model catalog</span>
            <h1 className="fxz-page-title">
              Onyx fleet <span className="fxz-gradient-word">models</span>
            </h1>
            <p className="text-[15px] text-muted-foreground max-w-2xl leading-relaxed">
              {models.length} free models across {FLEET_FAMILIES.length} families
              — {populatedFamilies} shipping today — served by Onyx AI through
              one OpenAI-compatible endpoint. No API key required.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fleet models…"
              className="fxz-input w-full rounded-lg pl-9 pr-3 h-11 text-sm outline-none"
              aria-label="Search fleet models"
            />
          </div>
        </div>

        {/* Category filter pills (warm active) */}
        <div
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 custom-scroll"
          role="tablist"
          aria-label="Filter by category"
        >
          <button
            type="button"
            role="tab"
            aria-selected={categoryFilter === "all"}
            onClick={() => setCategoryFilter("all")}
            className={cn(
              "fxz-chip",
              categoryFilter === "all" && "fxz-chip-active",
            )}
          >
            All ({models.length})
          </button>
          {liveCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={categoryFilter === c.id}
              onClick={() => setCategoryFilter(c.id)}
              className={cn(
                "fxz-chip",
                categoryFilter === c.id && "fxz-chip-active",
              )}
            >
              {c.label} ({c.count})
            </button>
          ))}
        </div>
      </div>

      {/* Sections — one per family (01 ASTRA → 10 ZENITH) */}
      {!anyVisible && q ? (
        <div className="fxz-panel rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No fleet models match “{query}”.
          </p>
        </div>
      ) : (
        filtered.map((f) => (
          <section
            key={f.id}
            className="flex flex-col gap-3"
            aria-labelledby={`fleet-family-${f.id}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2
                id={`fleet-family-${f.id}`}
                className="text-lg font-bold text-white"
              >
                <span className="font-mono text-xs text-muted-foreground mr-2">
                  {f.index}
                </span>
                {f.name}
              </h2>
              <span className="fxz-badge font-mono">{fleetCategoryLabel(f.category)}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {f.items.length > 0
                  ? `${f.items.length} model${f.items.length === 1 ? "" : "s"}`
                  : "no public models yet"}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground max-w-3xl">
              {f.tagline}
              {f.adult && (
                <span
                  className="fxz-badge-nsfw gap-1.5 ml-2"
                  title="Hard-test verified uncensored · adults only"
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  18+ · adults only
                </span>
              )}
            </p>
            {f.items.length === 0 ? (
              /* Honest empty family — defined in the registry, nothing fake. */
              <div className="fxz-panel rounded-xl p-5 flex items-center gap-3 text-muted-foreground">
                <Boxes className="h-4 w-4 text-hd-line shrink-0" aria-hidden />
                <p className="text-xs leading-relaxed">
                  The {f.name} family is defined in the registry — no public
                  models have been released in it yet. Placeholder models are
                  never listed.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {f.items.map((m, mi) => (
                  <FleetCard key={m.id} m={m} emberRim={mi % 2 === 1} />
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
