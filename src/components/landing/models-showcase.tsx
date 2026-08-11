"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Zap,
  Wrench,
  Eye,
  MessageSquare,
  Layers,
  AlertTriangle,
  Check,
  Cpu,
  Server,
  Globe,
  Key,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MODELS,
  PROVIDER_INFO,
  type GatewayModel,
  type ProviderId,
} from "@/lib/providers";

const CATEGORY_META: Record<
  GatewayModel["category"],
  { label: string; color: string }
> = {
  professional: { label: "Professional", color: "text-sky-300 border-sky-500/30 bg-sky-500/5" },
  sfw: { label: "SFW", color: "text-primary border-primary/30 bg-primary/5" },
  unrestricted: { label: "Unrestricted", color: "text-amber-300 border-amber-500/30 bg-amber-500/5" },
  reasoning: { label: "Reasoning", color: "text-violet-300 border-violet-500/30 bg-violet-500/5" },
};

const PROVIDER_COLORS: Partial<Record<ProviderId, string>> = {
  toolbaz: "text-amber-500",
  auroraai: "text-rose-500",
  surfsense: "text-cyan-500",
  jollygen: "text-pink-500",
  unlimitedai: "text-orange-500",
  pollinations: "text-green-500",
  kilocode: "text-violet-500",
  llm7: "text-sky-500",
  spicywriter: "text-rose-400",
  freegpt: "text-purple-500",
  opencode: "text-teal-500",
  freechat: "text-lime-500",
  miklium: "text-indigo-500",
  swarm: "text-orange-600",
  search: "text-cyan-500",
  music: "text-pink-500",
};

function providerColor(pid: ProviderId): string {
  return PROVIDER_COLORS[pid] ?? "text-muted-foreground";
}

function formatCtx(tokens: number): string {
  if (!tokens) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

function CapIcon({ on, icon: Icon, label }: { on: boolean; icon: typeof Zap; label: string }) {
  return (
    <span
      title={label + (on ? ": yes" : ": no")}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
        on
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted/30 text-muted-foreground/40",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

export function ModelsShowcase() {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderId | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return MODELS.filter((m) => {
      if (m.modality === "text-to-image") return false;
      if (providerFilter !== "all" && m.provider !== providerFilter) return false;
      if (categoryFilter !== "all" && m.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    });
  }, [query, providerFilter, categoryFilter]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of MODELS) {
      if (m.modality === "text-to-image") continue;
      counts[m.provider] = (counts[m.provider] ?? 0) + 1;
    }
    return counts;
  }, []);

  const textModelCount = useMemo(
    () => MODELS.filter((m) => m.modality !== "text-to-image").length,
    [],
  );

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models by name, description, or provider…"
            className="pl-9 h-11 bg-background/60"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={providerFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setProviderFilter("all")}
            className="h-8"
          >
            All providers ({textModelCount})
          </Button>
          {(Object.keys(PROVIDER_INFO) as ProviderId[]).map((pid) => (
            <Button
              key={pid}
              variant={providerFilter === pid ? "default" : "outline"}
              size="sm"
              onClick={() => setProviderFilter(pid)}
              className="h-8"
            >
              {PROVIDER_INFO[pid].name} ({providerCounts[pid] ?? 0})
            </Button>
          ))}
          <div className="w-px bg-border mx-1" />
          {(["all", "professional", "reasoning", "sfw", "unrestricted"] as const).map((cat) => (
            <Button
              key={cat}
              variant={categoryFilter === cat ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCategoryFilter(cat)}
              className="h-8 capitalize"
            >
              {cat === "all" ? "All types" : cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((m, i) => {
          const cat = CATEGORY_META[m.category];
          return (
            <motion.div
              key={`${m.provider}:${m.id}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.015, 0.3) }}
              className="group rounded-xl border border-border bg-card/50 backdrop-blur p-4 hover:border-primary/40 transition-colors flex flex-col gap-3"
            >
              {/* header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <code className="text-sm font-semibold break-all">{m.id}</code>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={cn("text-[10px] font-medium", providerColor(m.provider))}>
                      {PROVIDER_INFO[m.provider]?.name ?? m.provider}
                    </span>
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground">
                      ctx {formatCtx(m.contextWindow)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant="outline" className={cn("text-[9px]", cat.color)}>
                    {cat.label}
                  </Badge>
                  {m.requiresKey && (
                    <Badge
                      variant="outline"
                      className="text-[9px] border-primary/40 text-primary bg-primary/5 flex items-center gap-1"
                      title={`Requires a ${PROVIDER_INFO[m.provider]?.name ?? ""} API key`}
                    >
                      <Key className="h-2.5 w-2.5" />
                      BYOK
                    </Badge>
                  )}
                </div>
              </div>

              {/* description */}
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 min-h-[2rem]">
                {m.description}
              </p>

              {/* capabilities */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                <CapIcon on={m.capabilities.streaming} icon={Zap} label="Streaming" />
                <CapIcon on={m.capabilities.tools} icon={Wrench} label="Tool calling" />
                <CapIcon on={m.capabilities.webSearch} icon={Globe} label="Web search" />
                <CapIcon on={m.capabilities.systemPrompt} icon={MessageSquare} label="System prompt" />
                <CapIcon on={m.capabilities.multiTurn} icon={Layers} label="Multi-turn" />
                <CapIcon on={m.capabilities.vision} icon={Eye} label="Vision" />
                {m.experimental && (
                  <span title="Experimental — may be unavailable" className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> beta
                  </span>
                )}
              </div>

              {/* accepted params */}
              <div className="flex flex-wrap gap-1 pt-0.5">
                {m.capabilities.streaming && <ParamChip label="stream" />}
                {m.capabilities.tools && <ParamChip label="tools" />}
                {m.capabilities.tools && <ParamChip label="tool_choice" />}
                {m.capabilities.webSearch && <ParamChip label="web_search" />}
                {m.capabilities.systemPrompt && <ParamChip label="system" />}
                <ParamChip label="messages" />
                <ParamChip label="model" />
              </div>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No models match &ldquo;{query}&rdquo;.
        </div>
      )}

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted-foreground pt-2 border-t border-border/50">
        <span className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> {textModelCount} models</span>
        <span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" /> {Object.keys(PROVIDER_INFO).length} providers</span>
        <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" /> streaming</span>
        <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5 text-primary" /> tool calling</span>
        <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-primary" /> web search</span>
        <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-muted-foreground/50" /> vision</span>
      </div>
    </div>
  );
}

function ParamChip({ label }: { label: string }) {
  return (
    <code className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground border border-border/50">
      {label}
    </code>
  );
}
