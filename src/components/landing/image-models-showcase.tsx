"use client";

/**
 * Image models showcase — a searchable, filterable grid of all text-to-image
 * models (AI Horde, Pollinations gen, FreeGPT image, nekos.life, purrbot).
 *
 * Separate from ModelsShowcase (which shows chat text models) because image
 * models use a different endpoint (/api/v1/image/generate) and have different
 * metadata (category = anime/realism/nsfw-anime/nsfw-realism/mixed).
 */

import { useMemo, useState } from "react";
import {
  IMAGE_MODELS,
  IMAGE_PROVIDER_INFO,
  imageModelCounts,
  type ImageCategory,
  type ImageProviderId,
} from "@/lib/providers/image-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  ImageIcon,
  Server,
  Sparkles,
  ShieldAlert,
} from "lucide-react";

const CATEGORY_META: Record<
  ImageCategory,
  { label: string; color: string; icon: typeof ImageIcon }
> = {
  anime: { label: "Anime", color: "text-pink-500", icon: Sparkles },
  realism: { label: "Realism", color: "text-sky-500", icon: ImageIcon },
  "nsfw-anime": { label: "Mature Anime", color: "text-rose-500", icon: ShieldAlert },
  "nsfw-realism": { label: "Mature Realism", color: "text-red-500", icon: ShieldAlert },
  "nsfw-mixed": { label: "Mature Mixed", color: "text-fuchsia-500", icon: ShieldAlert },
  mixed: { label: "Mixed / Artistic", color: "text-purple-500", icon: Sparkles },
  general: { label: "General", color: "text-primary", icon: ImageIcon },
  "unrestricted-anime": { label: "Unrestricted Anime", color: "text-rose-500", icon: ShieldAlert },
  "unrestricted-realism": { label: "Unrestricted Realism", color: "text-red-500", icon: ShieldAlert },
  "unrestricted-mixed": { label: "Unrestricted Mixed", color: "text-fuchsia-500", icon: ShieldAlert },
};

const PROVIDER_COLORS: Partial<Record<ImageProviderId, string>> = {
  "pollinations-gen": "text-orange-500",
  freegpt: "text-purple-500",
  freegen: "text-cyan-500",
  freepikai: "text-emerald-500",
  aianime: "text-pink-500",
};

const CATEGORY_ORDER: ImageCategory[] = [
  "anime",
  "realism",
  "mixed",
  "general",
  "nsfw-anime",
  "nsfw-realism",
  "nsfw-mixed",
  "unrestricted-anime",
  "unrestricted-realism",
  "unrestricted-mixed",
];

export function ImageModelsShowcase({ allowNsfw = false }: { allowNsfw?: boolean }) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ImageProviderId | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<ImageCategory | "all">("all");

  const visible = useMemo(() => {
    if (allowNsfw) return IMAGE_MODELS;
    return IMAGE_MODELS.filter(
      (m) => m.category !== "nsfw-anime" && m.category !== "nsfw-realism",
    );
  }, [allowNsfw]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return visible.filter((m) => {
      if (providerFilter !== "all" && m.provider !== providerFilter) return false;
      if (categoryFilter !== "all" && m.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    });
  }, [query, providerFilter, categoryFilter, visible]);

  const counts = useMemo(() => imageModelCounts(), []);
  const providerList = Object.keys(IMAGE_PROVIDER_INFO) as ImageProviderId[];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search image models (e.g. anime, flux, meinamix)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 h-10 bg-background/60"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={providerFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setProviderFilter("all")}
            className="h-8"
          >
            All providers ({visible.length})
          </Button>
          {providerList.map((pid) => {
            const count = visible.filter((m) => m.provider === pid).length;
            if (count === 0) return null;
            return (
              <Button
                key={pid}
                variant={providerFilter === pid ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setProviderFilter(pid)}
                className="h-8"
              >
                {IMAGE_PROVIDER_INFO[pid].name} ({count})
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={categoryFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCategoryFilter("all")}
            className="h-8"
          >
            All styles
          </Button>
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const count = counts[cat];
            if (count === 0) return null;
            if (!allowNsfw && (cat === "nsfw-anime" || cat === "nsfw-realism" || cat === "nsfw-mixed" || cat === "unrestricted-anime" || cat === "unrestricted-realism" || cat === "unrestricted-mixed")) return null;
            return (
              <Button
                key={cat}
                variant={categoryFilter === cat ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setCategoryFilter(cat)}
                className="h-8 gap-1.5"
              >
                <meta.icon className={`h-3.5 w-3.5 ${meta.color}`} />
                {meta.label} ({count})
              </Button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m) => {
          const cat = CATEGORY_META[m.category];
          const ProvIcon = Server;
          return (
            <div
              key={m.id}
              className="group rounded-xl border border-border bg-card/40 backdrop-blur p-4 hover:border-primary/40 hover:bg-primary/5 transition-all"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <cat.icon className={`h-3.5 w-3.5 shrink-0 ${cat.color}`} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {cat.label}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm truncate">{m.name}</h3>
                </div>
                {m.nsfw && (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[9px] border-rose-500/40 text-rose-500 bg-rose-500/5"
                  >
                    Mature
                  </Badge>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 min-h-[28px]">
                {m.description}
              </p>

              <div className="mt-3 flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className={`text-[9px] gap-1 ${PROVIDER_COLORS[m.provider] ?? "text-muted-foreground"}`}
                >
                  <ProvIcon className="h-2.5 w-2.5" />
                  {IMAGE_PROVIDER_INFO[m.provider].name}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[9px] gap-1 text-muted-foreground"
                >
                  {m.width}×{m.height}
                </Badge>
              </div>

              <code className="mt-2 block text-[10px] font-mono text-primary/80 truncate">
                {m.id}
              </code>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No image models match your filters.
        </div>
      )}

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground pt-2 border-t border-border/50">
        <span className="flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5" /> {visible.length} image models
        </span>
        <span className="flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5" /> {providerList.length} image providers
        </span>
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-pink-500" /> anime
        </span>
        <span className="flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 text-sky-500" /> realism
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> Mature (pass{" "}
          <code className="text-[10px]">nsfw:true</code>)
        </span>
      </div>
    </div>
  );
}
