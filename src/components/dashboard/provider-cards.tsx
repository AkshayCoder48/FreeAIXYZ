"use client";

/**
 * ProviderCards — native provider grid.
 *
 * Receives the static provider list via props (serialized from the RSC —
 * no fetch, no discovery, no refresh). Renders a card per provider with:
 * short id chip, model/streaming counts, capability counts.
 */

import { Server, Zap, Wrench, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StaticProviderEntry {
  id: string;
  shortId: string;
  name: string;
  description: string;
  modelCount: number;
  streamingCount: number;
  toolsCount: number;
  visionCount: number;
}

interface ProviderCardsProps {
  providers: StaticProviderEntry[];
  /** Limit number of cards shown. */
  limit?: number;
}

export function ProviderCards({ providers, limit }: ProviderCardsProps) {
  const shown = limit ? providers.slice(0, limit) : providers;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg sm:text-xl font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Server className="h-4 w-4" strokeWidth={1.75} />
          </span>
          Providers ({providers.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((p) => (
          <div
            key={p.id}
            className={cn(
              "group rounded-xl border border-border bg-card p-4 sm:p-5",
              "transition-all duration-300 hover:border-foreground/20 hover:shadow-sm",
              "flex flex-col gap-3 min-w-0",
            )}
          >
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground truncate">
                  {p.name}
                </h4>
                <p
                  className="text-[10px] font-mono text-muted-foreground mt-0.5"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {p.shortId}
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                free
              </span>
            </div>

            {p.description && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {p.description}
              </p>
            )}

            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                <span className="font-mono">{p.modelCount}</span> models
              </span>
              {p.streamingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-900 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                  <Zap className="h-2.5 w-2.5" />
                  <span className="font-mono">{p.streamingCount}</span> streaming
                </span>
              )}
              {p.toolsCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  <Wrench className="h-2.5 w-2.5" />
                  <span className="font-mono">{p.toolsCount}</span> tools
                </span>
              )}
              {p.visionCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  <Eye className="h-2.5 w-2.5" />
                  <span className="font-mono">{p.visionCount}</span> vision
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
