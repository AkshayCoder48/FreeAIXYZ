"use client";

/**
 * ModelsCatalog — /models catalog (static data).
 *
 * Receives the static native model list via props (serialized from the RSC
 * — no network fetch, no discovery, no pricing).
 *
 * Layout:
 *   - Search input + provider filter tabs
 *   - One section per provider with a responsive grid of model cards
 *
 * Card:
 *   - Provider name + capability badges
 *   - Model display name (clickable → /models/[provider]/[model])
 *   - Description (line-clamped to 2 lines)
 *   - Model id + Copy button
 *   - "Try in playground" link (→ /chat?model=…)
 *
 * Overflow hardening: normal document flow (flex column), `min-w-0` on
 * card roots, `overflow-wrap: anywhere` on long ids, wrapping badge rows.
 */

import * as React from "react";
import Link from "next/link";
import { Search, Copy, Check, MessageSquare, Zap, Brain } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
          <div>
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground">
              Native{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-emerald-400">
                models
              </span>
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
              {models.length} free models across {groups.length} native
              providers. Static registry — every model maps to an implemented
              adapter. No API key required.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="pl-9"
              aria-label="Search models"
            />
          </div>
        </div>

        {/* Provider filter tabs */}
        <div
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
          role="tablist"
          aria-label="Filter by provider"
        >
          <button
            type="button"
            role="tab"
            aria-selected={providerFilter === "all"}
            onClick={() => setProviderFilter("all")}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              providerFilter === "all"
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
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
                "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                providerFilter === g.providerId
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {g.providerName} ({g.items.length})
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No models match “{query}”.
          </p>
        </Card>
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
                className="text-lg font-semibold text-foreground"
              >
                {g.providerName}
              </h2>
              <span className="text-xs text-muted-foreground">
                {g.items.length} model{g.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((m) => (
                <Card
                  key={m.id}
                  className="p-4 flex flex-col gap-2.5 min-w-0 hover:border-foreground/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <Link
                      href={`/models/${m.providerId}/${encodeURIComponent(m.id)}`}
                      className="text-sm font-semibold text-foreground hover:text-accent transition-colors leading-snug"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {m.name}
                    </Link>
                    {m.capabilities.streaming && (
                      <Badge
                        variant="secondary"
                        className="gap-1 shrink-0 text-[10px]"
                      >
                        <Zap className="h-2.5 w-2.5" /> stream
                      </Badge>
                    )}
                  </div>
                  <p
                    className="text-xs text-muted-foreground leading-relaxed line-clamp-2"
                    title={m.description}
                  >
                    {m.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {m.capabilities.reasoning && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Brain className="h-2.5 w-2.5" /> reasoning
                      </Badge>
                    )}
                    {m.capabilities.vision && (
                      <Badge variant="outline" className="text-[10px]">vision</Badge>
                    )}
                    {m.capabilities.tools && (
                      <Badge variant="outline" className="text-[10px]">tools</Badge>
                    )}
                    {m.capabilities.webSearch && (
                      <Badge variant="outline" className="text-[10px]">web search</Badge>
                    )}
                    {m.contextWindow > 0 && (
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {m.contextWindow >= 1000
                          ? `${Math.round(m.contextWindow / 1000)}k ctx`
                          : `${m.contextWindow} ctx`}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <code
                      className="flex-1 min-w-0 text-[10px] font-mono text-muted-foreground bg-muted rounded px-2 py-1 truncate"
                      title={m.id}
                    >
                      {m.id}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyId(m.id)}
                      className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-muted transition-colors"
                      aria-label={`Copy model id ${m.id}`}
                    >
                      {copied === m.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <Link
                      href={`/chat?model=${encodeURIComponent(m.id)}`}
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 h-7 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
                    >
                      <MessageSquare className="h-3 w-3" /> Try
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
