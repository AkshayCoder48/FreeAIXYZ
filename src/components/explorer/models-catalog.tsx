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
 * Layout:
 *   - Eyebrow + headline (one crimson gradient word) + search
 *   - Fleet-line filter pills (All / Uncensored · 18+ / General / Creative)
 *   - One section per fleet line with a responsive grid of obsidian cards;
 *     the Uncensored section carries a group-level 18+ warning chip.
 *
 * Card (FleetCard): display name → detail page, brief, capability chips,
 * onyx id pill + copy, "Try in chat" → /chat?model=<id>, and a prominent
 * crimson-glow 18+ UNCENSORED badge on hard-test-verified slots.
 */

import * as React from "react";
import { Search, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { FleetCard } from "@/components/explorer/fleet-card";
import {
  FLEET_GROUP_META,
  type CatalogFleetModel,
  type FleetGroupSlug,
} from "@/components/explorer/fleet-meta";

export type { CatalogFleetModel };

export interface ModelsCatalogData {
  models: CatalogFleetModel[];
}

export function ModelsCatalog({ data }: { data: ModelsCatalogData }) {
  const { models } = data;
  const [query, setQuery] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState<"all" | FleetGroupSlug>("all");

  // Group by fleet line, preserving the fixed display order.
  const groups = React.useMemo(
    () =>
      FLEET_GROUP_META.map((g) => ({
        ...g,
        items: models.filter((m) => m.group === g.slug),
      })),
    [models],
  );

  // Apply search + group filter.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => groupFilter === "all" || g.slug === groupFilter)
      .map((g) => ({
        ...g,
        items: q
          ? g.items.filter(
              (m) =>
                m.name.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q) ||
                m.brief.toLowerCase().includes(q) ||
                m.description.toLowerCase().includes(q),
            )
          : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query, groupFilter]);

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
              {models.length} free models across {FLEET_GROUP_META.length} fleet
              lines — Uncensored, General and Creative — served by Onyx AI
              through one OpenAI-compatible endpoint. No API key required.
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

        {/* Fleet-line filter pills (warm active) */}
        <div
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 custom-scroll"
          role="tablist"
          aria-label="Filter by fleet line"
        >
          <button
            type="button"
            role="tab"
            aria-selected={groupFilter === "all"}
            onClick={() => setGroupFilter("all")}
            className={cn(
              "fxz-chip",
              groupFilter === "all" && "fxz-chip-active",
            )}
          >
            All ({models.length})
          </button>
          {groups.map((g) => (
            <button
              key={g.slug}
              type="button"
              role="tab"
              aria-selected={groupFilter === g.slug}
              onClick={() => setGroupFilter(g.slug)}
              className={cn(
                "fxz-chip",
                groupFilter === g.slug && "fxz-chip-active",
              )}
            >
              {g.label} ({g.items.length})
            </button>
          ))}
        </div>
      </div>

      {/* Sections — one per fleet line */}
      {filtered.length === 0 ? (
        <div className="fxz-panel rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No fleet models match “{query}”.
          </p>
        </div>
      ) : (
        filtered.map((g) => (
          <section
            key={g.slug}
            className="flex flex-col gap-3"
            aria-labelledby={`fleet-group-${g.slug}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2
                id={`fleet-group-${g.slug}`}
                className="text-lg font-bold text-white"
              >
                {g.label}
              </h2>
              <span className="text-xs text-muted-foreground font-mono">
                {g.items.length} model{g.items.length === 1 ? "" : "s"}
              </span>
              {g.slug === "uncensored" && (
                <span
                  className="fxz-badge-nsfw gap-1.5"
                  title="Every slot in this line passed a live uncensored hard-test battery"
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  18+ · adults only
                </span>
              )}
            </div>
            {g.slug === "uncensored" && (
              <p className="text-xs leading-relaxed text-muted-foreground max-w-3xl">
                Adults only. These slots passed a live uncensored hard-test
                battery (zero refusals) and are verified 18+ — explicit adult
                content, no filtering, no lectures.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((m, mi) => (
                <FleetCard key={m.id} m={m} emberRim={mi % 2 === 1} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
