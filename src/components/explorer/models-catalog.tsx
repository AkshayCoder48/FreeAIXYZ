"use client";

/**
 * ModelsCatalog — redesigned /models catalog (PRD §29, §30, §31, §78).
 *
 * Fetches `/api/v1/models/unified` (OpenAI-shape list across native + g4f +
 * auth-gated gratisfy sources) + `/api/v1/pricing` (for the XYZ multiplier).
 *
 * Layout (PRD §29):
 *   - Page title + search input
 *   - Provider filter tabs: All | <source:provider combo per row>…
 *   - One section per provider, each with its own header + grid of cards
 *
 * Card (PRD §31):
 *   - Provider name + status badge (Live=emerald / Degraded=amber /
 *     Unavailable=slate)
 *   - Model display name (large, clickable → /models/[provider]/[publicId])
 *   - Model description (line-clamped to 2 lines)
 *   - Model id + Copy button (PRD §33)
 *   - `<Select>` (real shadcn Select, w-full + min-w-0 — never overflows)
 *     for switching between sibling models in the same provider section
 *   - Capability badges (wrap to next line when needed)
 *   - Source badge (BYOK=violet, G4F=orange, Native=slate)
 *   - Pricing rows: Input $X/M · Output $Y/M · ~Responses/XYZ
 *   - If pricing undocumented → "Pricing not documented" (PRD §26 — never $0)
 *
 * Overflow hardening (PRD §30):
 *   - Normal document flow (flex column). NO absolute positioning anywhere.
 *   - Card root has `min-w-0` so children can shrink inside the grid cell.
 *   - Model name + description + id all use `overflow-wrap: anywhere;
 *     word-break: break-word;` so long ids never push the card wider.
 *   - Capability badge container is `flex flex-wrap` (wraps to next line).
 *   - Pricing rows are `flex justify-between min-w-0` so prices don't escape.
 *   - `<SelectTrigger>` is `w-full min-w-0` — never overflows the card.
 *   - Card height adapts naturally — no fixed height; only `min-h-0` where
 *     needed (children can shrink in a flex column).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Copy, Check, AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { providerDisplayName } from "@/lib/xyz/provider-names";

// ─── Types from /api/v1/models/unified + /api/v1/pricing ─────────────────────

interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  image: boolean;
  reasoning: boolean;
  webSearch: boolean;
  streaming: boolean;
  tools?: boolean;
}

interface ModelPricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD" | "pollen";
  status: string; // documented | supplied | estimated | free | not_documented
  source: string;
  verifiedAt?: string;
}

type Source = "native" | "gratisfy" | "pollinations";

interface UnifiedModelEntry {
  id: string; // publicId, e.g. "native:tb:gpt-5"
  object: "model";
  source: Source;
  provider: string;
  displayName: string;
  originalModelId: string; // e.g. "tb/gpt-5"
  streaming: boolean;
  available: boolean;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
}

interface UnifiedResponse {
  object: "list";
  data: UnifiedModelEntry[];
  stale: boolean;
}

interface PricingResponse {
  version: number;
  currency: "USD" | "pollen";
  multiplier: number;
  referenceRequest: { inputTokens: number; outputTokens: number };
  updatedAt: string;
}

// ─── Helpers — all labels derived dynamically from the data ────────────────

function sourceLabel(source: Source): string {
  if (source === "gratisfy") return "Gratisfy";
  if (source === "pollinations") return "Pollinations";
  return "Native";
}

/** Section id — per-provider split. Each upstream provider (routing slug /
 * brand / native short-code) gets its OWN section so the user can browse
 * e.g. "Cloudflare", "OpenRouter", "AI Horde", "TomdacatAI" separately —
 * NOT collapsed into a single "Gratisfy" / "Pollinations" bucket.
 * Matches the user's directive: "make the providers from pollination and
 * gratisfy to show every provider separately not in a single provider". */
function sectionId(m: UnifiedModelEntry): string {
  if (m.source === "native") return `native:${m.provider}`;
  return `${m.source}:${m.provider}`; // e.g. "gratisfy:cloudflare"
}

/** Section header / tab label. Uses the friendly display-name map so tabs
 * read "Cloudflare Workers AI", "OpenRouter", "AI Horde" — not raw slugs. */
function sectionLabel(source: Source, provider: string): string {
  return providerDisplayName(source, provider);
}

function providerSubLabel(m: UnifiedModelEntry): string {
  // Small label under the model name on the card. Shows source + provider.
  if (m.source === "native") return `Native · ${providerDisplayName("native", m.provider)}`;
  if (m.source === "pollinations") {
    return `Pollinations · ${providerDisplayName("pollinations", m.provider)}`;
  }
  return `Gratisfy · ${providerDisplayName("gratisfy", m.provider)}`;
}

/** Strip the provider prefix from the upstream id, e.g. "tb/gpt-5" → "gpt-5". */
function shortModelName(m: UnifiedModelEntry): string {
  const oid = m.originalModelId || m.displayName;
  const slash = oid.lastIndexOf("/");
  if (slash >= 0) return oid.slice(slash + 1);
  return m.displayName || oid;
}

/** Derive a one-line description from capabilities (never hardcoded model-by-model). */
function modelDescription(m: UnifiedModelEntry): string {
  const caps = m.capabilities;
  const parts: string[] = [];
  if (caps.reasoning) parts.push("reasoning");
  if (caps.vision) parts.push("vision");
  if (caps.webSearch) parts.push("web search");
  if (caps.image) parts.push("image gen");
  if (caps.audio) parts.push("audio");
  if (caps.video) parts.push("video");
  if (caps.tools) parts.push("tool use");
  if (parts.length === 0) {
    return caps.text ? "Text completion model" : "Specialized model";
  }
  return `Supports ${parts.join(", ")}`;
}

interface StatusMeta {
  label: string;
  dot: string;
  badge: string;
}

function statusBadge(m: UnifiedModelEntry): StatusMeta {
  // Live=emerald, Degraded=amber, Unavailable=slate (PRD §31).
  if (m.available && m.streaming) {
    return {
      label: "Live",
      dot: "bg-emerald-500",
      badge:
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    };
  }
  if (m.available && !m.streaming) {
    return {
      label: "Degraded",
      dot: "bg-amber-500",
      badge:
        "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    };
  }
  return {
    label: "Unavailable",
    dot: "bg-slate-500",
    badge:
      "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

interface SourceBadgeMeta {
  label: string;
  cls: string;
}

function sourceBadge(m: UnifiedModelEntry): SourceBadgeMeta {
  // Gratisfy=violet, Pollinations=rose, Native=slate. NO indigo or blue.
  if (m.source === "gratisfy") {
    return {
      label: "BYOK",
      cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30",
    };
  }
  if (m.source === "pollinations") {
    return {
      label: "Pollinations",
      cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
    };
  }
  return {
    label: "Native",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30",
  };
}

function capabilityBadges(caps: ModelCapabilities): string[] {
  const out: string[] = [];
  if (caps.text) out.push("Chat");
  if (caps.reasoning) out.push("Reasoning");
  if (caps.vision) out.push("Vision");
  if (caps.webSearch) out.push("Search");
  if (caps.image) out.push("Image");
  if (caps.audio) out.push("Audio");
  if (caps.video) out.push("Video");
  if (caps.tools) out.push("Tools");
  return out;
}

/** Modality filter matcher — used by the modality filter tabs. */
function modelMatchesModality(m: UnifiedModelEntry, modality: string): boolean {
  const c = m.capabilities;
  switch (modality) {
    case "chat":
      return c.text;
    case "image":
      return c.image;
    case "audio":
      return c.audio;
    case "video":
      return c.video;
    case "reasoning":
      return c.reasoning;
    case "vision":
      return c.vision;
    default:
      return true;
  }
}

/** Pollen-priced models require a Pollinations wallet connection (user
 * directive: "pollen models required pollination connection"). Returns
 * true when this model is pollen-denominated and thus gated behind the
 * user having connected their Pollinations wallet. */
function requiresPollenConnection(m: UnifiedModelEntry): boolean {
  return m.pricing?.currency === "pollen" && m.pricing.status !== "free";
}

function isPricingDocumented(p: ModelPricing | undefined | null): boolean {
  if (!p) return false;
  if (p.status === "not_documented") return false;
  if (p.inputPerMillion == null || p.outputPerMillion == null) return false;
  return true;
}

function formatPrice(v: number | null | undefined, currency: "USD" | "pollen" = "USD"): string {
  if (v == null) return "—";
  // 1 pollen = 1 XYZ (gateway peg). Pollen-denominated upstream prices are
  // displayed in the gateway's XYZ currency at par.
  if (v === 0) return currency === "pollen" ? "0 XYZ" : "$0";
  if (currency === "pollen") {
    if (v < 0.01) return `${v.toFixed(4)} XYZ`;
    if (v < 1) return `${v.toFixed(3)} XYZ`;
    return `${v.toFixed(2)} XYZ`;
  }
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * PRD §41 — standardized 1000 in / 1000 out per request. Responses per
 * 1 XYZ = floor(1 / (usdCost * multiplier)). Returns null when pricing
 * is undocumented or the model is free (no finite count).
 */
function responsesPerXYZ(
  p: ModelPricing | undefined | null,
  multiplier: number,
): number | null {
  if (!isPricingDocumented(p)) return null;
  if (p!.status === "free") return null;
  const input = p!.inputPerMillion ?? 0;
  const output = p!.outputPerMillion ?? 0;
  const usdCost = (1000 / 1e6) * input + (1000 / 1e6) * output;
  if (usdCost <= 0) return null;
  const denom = usdCost * (multiplier || 1);
  if (denom <= 0) return null;
  return Math.floor(1 / denom);
}

function modelHref(m: UnifiedModelEntry): string {
  // /models/[provider]/[publicId URL-encoded] — W4-B builds the route.
  return `/models/${encodeURIComponent(m.provider)}/${encodeURIComponent(m.id)}`;
}

// ─── Top-level catalog component ─────────────────────────────────────────────

export function ModelsCatalog() {
  const [models, setModels] = React.useState<UnifiedModelEntry[]>([]);
  const [stale, setStale] = React.useState(false);
  const [pricing, setPricing] = React.useState<PricingResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState("");
  const [activeSection, setActiveSection] = React.useState<string>("all");
  const [modality, setModality] = React.useState<string>("all");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const mRes = await fetch("/api/v1/models/unified", {
          cache: "no-store",
        });
        if (!mRes.ok) {
          throw new Error(`Failed to load models (HTTP ${mRes.status})`);
        }
        const mj = (await mRes.json()) as UnifiedResponse;
        if (cancelled) return;
        setModels(Array.isArray(mj.data) ? mj.data : []);
        setStale(Boolean(mj.stale));

        // Pricing is optional — failure is silent.
        try {
          const pRes = await fetch("/api/v1/pricing", { cache: "no-store" });
          if (pRes.ok) {
            const pj = (await pRes.json()) as PricingResponse;
            if (!cancelled) setPricing(pj);
          }
        } catch {
          /* noop */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // PRD §31 — only currently-available models appear in provider cards.
  const availableModels = React.useMemo(
    () => models.filter((m) => m.available),
    [models],
  );

  // Build the list of provider tabs (one per source:provider combo).
  const sections = React.useMemo(() => {
    const map = new Map<
      string,
      { source: Source; provider: string; count: number }
    >();
    for (const m of availableModels) {
      const id = sectionId(m);
      const e = map.get(id);
      if (e) e.count++;
      else map.set(id, { source: m.source, provider: m.provider, count: 1 });
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({
        id,
        label: sectionLabel(v.source, v.provider),
        count: v.count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [availableModels]);

  // Apply modality + search + active tab.
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    return availableModels.filter((m) => {
      if (activeSection !== "all" && sectionId(m) !== activeSection) return false;
      if (modality !== "all" && !modelMatchesModality(m, modality)) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        m.originalModelId.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        sourceLabel(m.source).toLowerCase().includes(q)
      );
    });
  }, [availableModels, query, activeSection, modality]);

  // Group filtered models by section for rendering.
  const grouped = React.useMemo(() => {
    const map = new Map<
      string,
      { source: Source; provider: string; models: UnifiedModelEntry[] }
    >();
    for (const m of filtered) {
      const id = sectionId(m);
      const e = map.get(id);
      if (e) e.models.push(m);
      else map.set(id, { source: m.source, provider: m.provider, models: [m] });
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({
        id,
        label: sectionLabel(v.source, v.provider),
        source: v.source,
        provider: v.provider,
        models: v.models,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered]);

  const multiplier = pricing?.multiplier ?? 1;

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* Header: title + search */}
      <header className="flex flex-col gap-4 min-w-0">
        <div className="flex items-baseline justify-between gap-3 flex-wrap min-w-0">
          <h1 className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground">
            Models
          </h1>
          <span
            className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {availableModels.length} available · {sections.length} providers
          </span>
        </div>

        {/* Search — w-full + min-w-0, no chance of horizontal overflow */}
        <div className="relative w-full min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models, ids, providers…"
            className="pl-9 h-11 rounded-lg"
            aria-label="Search models"
          />
        </div>
      </header>

      {/* Modality filter tabs — Chat / Image / Audio / Video / Embeddings */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <FilterTab
          active={modality === "all"}
          onClick={() => setModality("all")}
          label="All modalities"
          count={availableModels.length}
        />
        {[
          { id: "chat", label: "Chat" },
          { id: "image", label: "Image gen" },
          { id: "audio", label: "Audio / TTS" },
          { id: "video", label: "Video gen" },
          { id: "reasoning", label: "Reasoning" },
          { id: "vision", label: "Vision" },
        ].map((mod) => (
          <FilterTab
            key={mod.id}
            active={modality === mod.id}
            onClick={() => setModality(mod.id)}
            label={mod.label}
            count={availableModels.filter((m) => modelMatchesModality(m, mod.id)).length}
          />
        ))}
      </div>

      {/* Provider filter tabs — wrap when out of room */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <FilterTab
          active={activeSection === "all"}
          onClick={() => setActiveSection("all")}
          label="All"
          count={availableModels.length}
        />
        {sections.map((s) => (
          <FilterTab
            key={s.id}
            active={activeSection === s.id}
            onClick={() => setActiveSection(s.id)}
            label={s.label}
            count={s.count}
          />
        ))}
      </div>

      {/* Stale banner */}
      {stale && !loading && !error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2 min-w-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span className="min-w-0">
            Catalog is being served from cache. The last discovery run may be
            stale.
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2 min-w-0">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0 flex flex-col gap-2">
            <div className="font-medium">Failed to load models</div>
            <div
              className="text-xs"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {error}
            </div>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="self-start text-xs px-3 py-1.5 rounded-md border border-rose-500/30 hover:bg-rose-500/10 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 min-w-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && grouped.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          No models match the current filters.
        </div>
      )}

      {/* Provider sections */}
      {!loading && !error && grouped.length > 0 && (
        <div className="flex flex-col gap-10 min-w-0">
          {grouped.map((sec) => (
            <ProviderSection
              key={sec.id}
              label={sec.label}
              source={sec.source}
              models={sec.models}
              multiplier={multiplier}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FilterTab ──────────────────────────────────────────────────────────────

function FilterTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border min-w-0 max-w-full",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
      )}
      style={{ fontFamily: "var(--font-mono), monospace" }}
    >
      <span className="truncate max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
      <span
        className={cn(
          "text-[10px] tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
          active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ─── ProviderSection — header + grid of cards ───────────────────────────────

const INITIAL_CARDS_PER_SECTION = 24;
const LOAD_MORE_INCREMENT = 24;

function ProviderSection({
  label,
  source,
  models,
  multiplier,
}: {
  label: string;
  source: Source;
  models: UnifiedModelEntry[];
  multiplier: number;
}) {
  // Per-section pagination so a section with 2k+ models (G4F aggregate)
  // doesn't render thousands of DOM nodes at once. Initial 24, +24 on
  // "Show more".
  const [visibleCount, setVisibleCount] = React.useState<number>(
    INITIAL_CARDS_PER_SECTION,
  );

  // Reset pagination when the model set changes (e.g. user typed in search).
  React.useEffect(() => {
    setVisibleCount(INITIAL_CARDS_PER_SECTION);
  }, [models]);

  const visible = models.slice(0, visibleCount);
  const remaining = models.length - visible.length;

  return (
    <section className="flex flex-col gap-3 min-w-0">
      <header className="flex items-baseline justify-between gap-3 min-w-0">
        <h2
          className="text-xl font-medium tracking-tight text-foreground truncate overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
          title={label}
        >
          {label}
        </h2>
        <span
          className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground shrink-0"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {models.length} model{models.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 min-w-0">
        {visible.map((m) => (
          <ProviderCard
            key={m.id}
            model={m}
            siblings={models}
            multiplier={multiplier}
          />
        ))}
      </div>
      {remaining > 0 && (
        <div className="flex justify-center pt-2 min-w-0">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((c) => c + LOAD_MORE_INCREMENT)
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs uppercase tracking-[0.1em] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            Show {Math.min(LOAD_MORE_INCREMENT, remaining)} more ·{" "}
            {remaining} hidden
          </button>
        </div>
      )}
    </section>
  );
}

// ─── ProviderCard — the actual card (PRD §31 layout) ────────────────────────

function ProviderCard({
  model,
  siblings,
  multiplier,
}: {
  model: UnifiedModelEntry;
  siblings: UnifiedModelEntry[];
  multiplier: number;
}) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);

  const sBadge = statusBadge(model);
  const srcBadge = sourceBadge(model);
  const caps = capabilityBadges(model.capabilities);
  const pricing = model.pricing;
  const documented = isPricingDocumented(pricing);
  const isFree = pricing?.status === "free";
  const respPer = responsesPerXYZ(pricing, multiplier);

  // Cap the Select dropdown options to avoid building thousands of React
  // elements per card when a provider section has 5k+ models (the G4F
  // aggregate). The user can use the search box to find specific models;
  // the Select is a quick in-section switcher.
  const siblingOptions = React.useMemo(
    () => siblings.slice(0, 50),
    [siblings],
  );

  const handleCardClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't navigate when the click originated from any interactive child.
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button, a, [role='combobox'], [role='option'], select, input")) {
        return;
      }
      router.push(modelHref(model));
    },
    [model, router],
  );

  const handleCopy = React.useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(model.id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        /* clipboard not available */
      }
    },
    [model.id],
  );

  return (
    <Card
      // PRD §30: normal document flow (flex column). NO absolute positioning.
      onClick={handleCardClick}
      className={cn(
        "min-w-0 flex flex-col gap-3 p-4 sm:p-5 rounded-xl border bg-card text-card-foreground shadow-sm transition-colors cursor-pointer",
        "border-border hover:border-foreground/20",
      )}
    >
      {/* Row 1: provider sub-label + status badge */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div
          className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground min-w-0 truncate"
          style={{ fontFamily: "var(--font-mono), monospace" }}
          title={providerSubLabel(model)}
        >
          {providerSubLabel(model)}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium shrink-0",
            sBadge.badge,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", sBadge.dot)} />
          {sBadge.label}
        </span>
      </div>

      {/* Row 2: model display name (large, clickable) */}
      <Link
        href={modelHref(model)}
        onClick={(e) => e.stopPropagation()}
        className="text-base font-semibold tracking-tight text-foreground hover:underline min-w-0"
        style={{
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          display: "block",
        }}
        title={model.id}
      >
        {shortModelName(model)}
      </Link>

      {/* Row 3: description (clamped to 2 lines) */}
      <p
        className="text-xs text-muted-foreground line-clamp-2 min-w-0"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
      >
        {modelDescription(model)}
      </p>

      {/* Row 4: model id + copy button (PRD §33 — directly copyable) */}
      <div className="flex items-center gap-2 min-w-0">
        <code
          className="flex-1 min-w-0 text-[11px] text-muted-foreground bg-muted/40 px-2 py-1 rounded-md font-mono overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ fontFamily: "var(--font-mono), monospace" }}
          title={model.id}
        >
          {model.id}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover:bg-accent transition-colors"
          aria-label="Copy model id"
          title="Copy model id"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Row 5: Select Model ▼ — real shadcn Select, w-full + min-w-0.
          The dropdown is capped at 50 entries (siblingOptions) — see the
          memoization above — to avoid building thousands of React elements
          per card when the section aggregates 5k+ models. */}
      <Select
        value={model.id}
        onValueChange={(v) => {
          const target = siblings.find((s) => s.id === v);
          if (target) router.push(modelHref(target));
        }}
      >
        <SelectTrigger
          aria-label="Switch model"
          className="w-full min-w-0 h-9 text-xs"
        >
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {siblingOptions.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {shortModelName(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Row 6: capability badges — flex-wrap so they wrap to next line */}
      {caps.length > 0 && (
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {caps.map((c) => (
            <Badge
              key={c}
              variant="outline"
              className="text-[10px] uppercase tracking-wider px-1.5 py-0 h-5 text-muted-foreground border-border"
            >
              {c}
            </Badge>
          ))}
        </div>
      )}

      {/* Row 7: source badge (BYOK / Pollinations / Native) + pollen-required */}
      <div className="flex flex-wrap gap-1.5 min-w-0">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] uppercase tracking-wider px-1.5 py-0 h-5",
            srcBadge.cls,
          )}
        >
          {srcBadge.label}
        </Badge>
        {requiresPollenConnection(model) && (
          <Badge
            variant="outline"
            title="Pollen-priced models require a connected Pollinations wallet."
            className="text-[10px] uppercase tracking-wider px-1.5 py-0 h-5 bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30"
          >
            Pollen · Connect
          </Badge>
        )}
      </div>

      {/* Row 8: pricing rows — flex justify-between, min-w-0 so prices don't escape */}
      <div className="flex flex-col gap-2 min-w-0 border-t border-border pt-3 mt-1">
        {documented ? (
          <>
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                Input
              </span>
              <span
                className="text-sm font-medium tabular-nums text-right min-w-0"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                {isFree
                  ? "Free"
                  : `${formatPrice(pricing!.inputPerMillion, pricing!.currency)}/M`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                Output
              </span>
              <span
                className="text-sm font-medium tabular-nums text-right min-w-0"
                style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              >
                {isFree
                  ? "Free"
                  : `${formatPrice(pricing!.outputPerMillion, pricing!.currency)}/M`}
              </span>
            </div>
            {respPer !== null && (
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                  ~Responses / XYZ
                </span>
                <span
                  className="text-sm font-medium tabular-nums text-right min-w-0"
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  ~{respPer.toLocaleString()}
                </span>
              </div>
            )}
          </>
        ) : (
          <p
            className="text-xs text-muted-foreground italic min-w-0"
            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
          >
            Pricing not documented
          </p>
        )}
      </div>
    </Card>
  );
}
