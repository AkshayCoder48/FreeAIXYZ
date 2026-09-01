"use client";

/**
 * ModelsCatalog — /models catalog (static data, WARM AURORA design).
 *
 * Receives the static native model list via props (serialized from the RSC
 * — no network fetch, no discovery, no pricing).
 *
 * Layout:
 *   - Eyebrow + headline (one warm gradient word) + search
 *   - Provider filter pills (warm active state)
 *   - One section per provider with a responsive grid of dark-glass cards
 *
 * Card (dark glass, warm hover glow):
 *   - Provider name + capability badges (warm mono chips)
 *   - Model display name (clickable → /models/[provider]/[model])
 *   - Description (line-clamped to 2 lines)
 *   - Model id (warm code pill) + Copy button
 *   - "Try in playground" warm keycap-style link (→ /chat?model=…)
 *
 * Overflow hardening: normal document flow (flex column), `min-w-0` on
 * card roots, `overflow-wrap: anywhere` on long ids, wrapping badge rows.
 */

import * as React from "react";
import Link from "next/link";
import { Search, Copy, Check, MessageSquare, Zap, Brain, Wrench, Eye, Globe } from "lucide-react";

import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CatalogModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  description: string;
  category: "professional" | "sfw" | "unrestricted" | "reasoning";
  capabilities: {
    streaming: boolean;
    reasoning: boolean;
    vision: boolean;
    tools: boolean;
    webSearch: boolean;
  };
  contextWindow: number;
}

export interface CatalogProvider {
  id: string;
  shortId: string;
  name: string;
}

export interface ModelsCatalogData {
  models: CatalogModel[];
  providers: CatalogProvider[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ModelsCatalog({ data }: { data: ModelsCatalogData }) {
  const { models, providers } = data;
  const [query, setQuery] = React.useState("");
  const [providerFilter, setProviderFilter] = React.useState<string>("all");
  const [copied, setCopied] = React.useState<string | null>(null);

  // Group models by provider (preserving catalog order).
  const groups = React.useMemo(() => {
    const byProvider = new Map<string, CatalogModel[]>();
    for (const m of models) {
      const list = byProvider.get(m.providerId);
      if (list) list.push(m);
      else byProvider.set(m.providerId, [m]);
    }
    return Array.from(byProvider.entries()).map(([providerId, items]) => ({
      providerId,
      providerName: items[0]?.providerName ?? providerId,
      items,
    }));
  }, [models]);

  // Apply search + provider filter.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => providerFilter === "all" || g.providerId === providerFilter)
      .map((g) => ({
        ...g,
        items: q
          ? g.items.filter(
              (m) =>
                m.name.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q) ||
                m.description.toLowerCase().includes(q),
            )
          : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, query, providerFilter]);

  const copyId = React.useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header + search */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div className="flex flex-col gap-3">
            <span className="fxz-section-eyebrow">Native catalog</span>
            <h1 className="fxz-page-title">
              Native <span className="fxz-gradient-word">models</span>
            </h1>
            <p className="text-[15px] text-[#9c9c9d] max-w-2xl leading-relaxed">
              {models.length} free models across {groups.length} native
              providers. Static registry — every model maps to an implemented
              adapter. No API key required.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#7c7c7f] pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="fxz-input w-full rounded-lg pl-9 pr-3 h-10 text-sm outline-none"
              aria-label="Search models"
            />
          </div>
        </div>

        {/* Provider filter pills (warm active) */}
        <div
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 custom-scroll"
          role="tablist"
          aria-label="Filter by provider"
        >
          <button
            type="button"
            role="tab"
            aria-selected={providerFilter === "all"}
            onClick={() => setProviderFilter("all")}
            className={cn(
              "fxz-chip",
              providerFilter === "all" && "fxz-chip-active",
            )}
          >
            All ({models.length})
          </button>
          {groups.map((g) => (
            <button
              key={g.providerId}
              type="button"
              role="tab"
              aria-selected={providerFilter === g.providerId}
              onClick={() => setProviderFilter(g.providerId)}
              className={cn(
                "fxz-chip",
                providerFilter === g.providerId && "fxz-chip-active",
              )}
            >
              {g.providerName} ({g.items.length})
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {filtered.length === 0 ? (
        <div className="fxz-panel rounded-xl p-8 text-center">
          <p className="text-sm text-[#9c9c9d]">
            No models match “{query}”.
          </p>
        </div>
      ) : (
        filtered.map((g) => (
          <section
            key={g.providerId}
            className="flex flex-col gap-3"
            aria-labelledby={`provider-${g.providerId}`}
          >
            <div className="flex items-baseline gap-3">
              <h2
                id={`provider-${g.providerId}`}
                className="text-lg font-semibold text-white"
              >
                {g.providerName}
              </h2>
              <span className="text-xs text-[#7c7c7f] font-mono">
                {g.items.length} model{g.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((m) => (
                <div
                  key={m.id}
                  className="fxz-panel fxz-panel-hover p-4 flex flex-col gap-2.5 min-w-0 rounded-xl"
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <Link
                      href={`/models/${m.providerId}/${encodeURIComponent(m.id)}`}
                      className="text-sm font-semibold text-white hover:text-[#ff8a6b] transition-colors leading-snug"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {m.name}
                    </Link>
                    {m.capabilities.streaming && (
                      <span className="fxz-badge fxz-badge-warm gap-1 shrink-0">
                        <Zap className="h-2.5 w-2.5" /> stream
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs text-[#9c9c9d] leading-relaxed line-clamp-2"
                    title={m.description}
                  >
                    {m.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {m.capabilities.reasoning && (
                      <span className="fxz-badge gap-1">
                        <Brain className="h-2.5 w-2.5 text-[#ff6b4a]" /> reasoning
                      </span>
                    )}
                    {m.capabilities.vision && (
                      <span className="fxz-badge gap-1">
                        <Eye className="h-2.5 w-2.5" /> vision
                      </span>
                    )}
                    {m.capabilities.tools && (
                      <span className="fxz-badge gap-1">
                        <Wrench className="h-2.5 w-2.5 text-[#ff6b4a]" /> tools
                      </span>
                    )}
                    {m.capabilities.webSearch && (
                      <span className="fxz-badge gap-1">
                        <Globe className="h-2.5 w-2.5" /> web search
                      </span>
                    )}
                    {m.contextWindow > 0 && (
                      <span className="fxz-badge font-mono">
                        {m.contextWindow >= 1000
                          ? `${Math.round(m.contextWindow / 1000)}k ctx`
                          : `${m.contextWindow} ctx`}
                      </span>
                    )}
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <code
                      className="fxz-code flex-1 min-w-0 truncate"
                      title={m.id}
                    >
                      {m.id}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyId(m.id)}
                      className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md border border-white/10 text-[#9c9c9d] hover:text-white hover:border-[#ff6b4a]/40 transition-colors"
                      aria-label={`Copy model id ${m.id}`}
                    >
                      {copied === m.id ? (
                        <Check className="h-3.5 w-3.5 text-[#ffb347]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <Link
                      href={`/chat?model=${encodeURIComponent(m.id)}`}
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 h-7 rounded-md text-[#2f3031] transition-transform hover:-translate-y-px"
                      style={{
                        background: "#e6e6e6",
                        boxShadow:
                          "0 0 0 1.5px rgba(0,0,0,0.85), 0 0 10px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.25)",
                      }}
                    >
                      <MessageSquare className="h-3 w-3" /> Try
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
