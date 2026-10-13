import Link from "next/link";
import {
  Zap,
  Wrench,
  Layers,
  Terminal,
  Globe,
  Activity,
  ArrowRight,
  Cpu,
  Boxes,
  Play,
  Check,
} from "lucide-react";
import { NATIVE_PROVIDERS, OFFERED_MODELS, type NativeModel } from "@/lib/native-catalog";
import { AuroraGlyph } from "@/components/aurora/shell";
import { CrimsonOrb } from "@/components/aurora/crimson-orb";
import { QuickstartTerminal } from "@/components/aurora/quickstart-terminal";

// Pure static content (no dynamic APIs, no fetches) — prerendered at build
// time and served from the CDN edge. Explicit for honesty (perf pass 3-perf).
export const dynamic = "force-static";

/**
 * Landing page — HYPERDIMENSION AI "Crimson Orb" (Stitch 3D UI kit:
 * developer_portal_api_hub_crimson_orb).
 *
 * Hero: the living crimson orb (tiny 2D canvas — incandescent core, ember
 * arcs, breathing halo) crowning the interactive SDK terminal (cURL / Python /
 * Node tabs). Below: a telemetry stats bar, featured free models on obsidian
 * cards with crimson/ember rims, the provider mesh strip, the feature bento,
 * the deep quickstart (tools example), and the final CTA.
 *
 * Type: Space Grotesk display, Geist body, JetBrains Mono for ids/telemetry.
 * Strictly warm — crimson #ff2a55 / ember #ff850d / gold #ffba27 on
 * #111319 ground. No blue/indigo.
 */

const MODEL_COUNT = OFFERED_MODELS.length;
const PROVIDER_COUNT = NATIVE_PROVIDERS.length;
const STREAMING_COUNT = OFFERED_MODELS.filter((m) => m.capabilities.streaming).length;
const TOOLS_COUNT = OFFERED_MODELS.filter((m) => m.capabilities.tools).length;

/** Four flagship models — first streaming model of four distinct providers. */
const FEATURED: NativeModel[] = (() => {
  const picked: NativeModel[] = [];
  const seen = new Set<string>();
  for (const m of OFFERED_MODELS) {
    if (seen.has(m.providerId)) continue;
    if (!m.capabilities.streaming) continue;
    picked.push(m);
    seen.add(m.providerId);
    if (picked.length === 4) break;
  }
  return picked;
})();

const FEATURES = [
  {
    icon: Zap,
    title: "True end-to-end SSE",
    desc: "stream:true returns real upstream deltas — every layer streams, no gateway re-pacing. The [DONE] sentinel finalizes cleanly.",
    wide: true,
  },
  {
    icon: Wrench,
    title: "Native tool calling",
    desc: "Real OpenAI tools/tool_choice/parallel_tool_calls forwarded to every capable provider. Streamed tool-call deltas are accumulated, executed, and resumed.",
    wide: true,
  },
  {
    icon: Terminal,
    title: "OpenAI-compatible",
    desc: "Drop-in /api/v1/chat/completions. Point any OpenAI SDK at the base URL — zero code changes.",
  },
  {
    icon: Globe,
    title: "No key. No account.",
    desc: "No auth, no API keys, no sign-up walls. The gateway aggregates free upstreams behind one surface.",
  },
  {
    icon: Cpu,
    title: "Static model registry",
    desc: "The catalog is bundled at build time — no dynamic fetching, no stale caches, every model maps to a live adapter.",
  },
  {
    icon: Activity,
    title: "Provider health",
    desc: "Per-provider circuit breakers, per-model health, failover candidates, structured error envelopes.",
  },
  {
    icon: Layers,
    title: "Canonical IDs",
    desc: "Every model is shortId/originalId — e.g. oc/gpt-5.6. Cross-provider duplicates stay distinct.",
  },
];

const TELEMETRY = [
  { icon: Boxes, value: String(MODEL_COUNT), label: "Free models", tone: "crimson" },
  { icon: Globe, value: String(PROVIDER_COUNT), label: "Native providers", tone: "ember" },
  { icon: Zap, value: String(STREAMING_COUNT), label: "True streaming", tone: "crimson" },
  { icon: Wrench, value: String(TOOLS_COUNT), label: "Tool-calling models", tone: "ember" },
] as const;

const MICRO_SPECS = ["OpenAI SDK drop-in", "No key required", "Real SSE streaming"];

export default function Home() {
  return (
    <div className="fxz-aurora-root min-h-screen flex flex-col text-[#e2e2ea]">
      {/* ───────────────────────────────────────────────────────────────────
          HERO — crimson orb + SDK terminal + keycap CTAs.
          ─────────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden flex flex-col">
        {/* Ambient crimson/ember blobs (kit top glows). */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="fxz-glow-a" />
          <div className="fxz-glow-b" />
        </div>

        {/* ── Floating pill nav (top-center) ── */}
        <header className="relative z-20 pt-5 px-4 flex justify-center">
          <nav
            className="w-full max-w-3xl flex items-center justify-between rounded-full border border-crimson/25 bg-hd-deep/80 backdrop-blur-xl px-4 sm:px-5 py-2.5"
            style={{
              boxShadow:
                "0 18px 50px -18px rgba(0,0,0,0.9), 0 0 22px rgba(255,42,85,0.14), inset 0 1px 0 rgba(255,255,255,0.07)",
            }}
            aria-label="Main navigation"
          >
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <AuroraGlyph size={16} />
              <span className="flex flex-col leading-none">
                <span className="font-display text-[15px] font-bold tracking-tight text-white">
                  HyperDimension<span className="text-crimson">AI</span>
                </span>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-muted-foreground mt-1">
                  Crimson Core Matrix
                </span>
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-7">
              <Link href="/chat" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                Playground
              </Link>
              <Link href="/models" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                Models
              </Link>
              <Link href="/docs" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                Docs
              </Link>
              <a href="#quickstart" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                API
              </a>
              <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                Features
              </a>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/models" className="hidden sm:block text-sm font-medium text-[#e2e2ea] hover:text-white transition-colors">
                Browse
              </Link>
              <Link href="/chat" className="fxz-nav-cta">
                Open Playground
                <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
              </Link>
            </div>
          </nav>
        </header>

        {/* ── Hero content: copy (left) + orb-crowned terminal (right) ── */}
        <div className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-6 pt-12 sm:pt-16 pb-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
            {/* Left: badge, headline, lede, CTAs, micro-specs */}
            <div className="lg:col-span-7 flex flex-col gap-5 min-w-0">
              <div className="fxz-fade-up">
                <span className="fxz-eyebrow">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ember opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-crimson" />
                  </span>
                  Crimson Core Matrix · {MODEL_COUNT} free models · zero keys
                </span>
              </div>

              <h1
                className="fxz-hero-title max-w-2xl fxz-fade-up"
                style={{ animationDelay: "80ms" }}
              >
                Unlimited AI inference.
                <span className="block">
                  <span className="fxz-gradient-word">100% free.</span> No key.
                  No account.
                </span>
              </h1>

              <p
                className="max-w-xl text-[15px] md:text-base font-normal leading-relaxed text-muted-foreground fxz-fade-up"
                style={{ animationDelay: "160ms" }}
              >
                {MODEL_COUNT} native models across {PROVIDER_COUNT} providers,
                streamed through one OpenAI-compatible API — with real tool
                calling, live web search, and zero keys or accounts.
              </p>

              {/* CTAs — crimson glow + frosted glass (kit pair). */}
              <div
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 fxz-fade-up"
                style={{ animationDelay: "240ms" }}
              >
                <Link href="/chat" className="fxz-keycap w-full sm:w-auto">
                  <Play className="h-4 w-4" strokeWidth={2.5} />
                  Open the Playground
                </Link>
                <Link href="/models" className="fxz-ghost-pill w-full sm:w-auto">
                  <Boxes className="h-4 w-4 text-ember" strokeWidth={1.75} />
                  Browse {MODEL_COUNT} Models
                </Link>
              </div>

              {/* Micro specs under CTA (kit check_circle row). */}
              <div
                className="flex flex-wrap items-center gap-x-6 gap-y-2 fxz-fade-up"
                style={{ animationDelay: "300ms" }}
              >
                {MICRO_SPECS.map((spec) => (
                  <span
                    key={spec}
                    className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground"
                  >
                    <Check className="h-3.5 w-3.5 text-ember" strokeWidth={2.5} />
                    {spec}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: the Crimson Orb crowning the SDK terminal. */}
            <div
              className="lg:col-span-5 flex flex-col items-center min-w-0 fxz-fade-up"
              style={{ animationDelay: "360ms" }}
            >
              <div className="w-36 sm:w-44 lg:w-52 -mb-10 sm:-mb-12 lg:-mb-14 relative z-0" aria-hidden>
                <CrimsonOrb />
              </div>
              <div className="relative z-10 w-full">
                <QuickstartTerminal />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          TELEMETRY BAR — mono metrics on obsidian tiles.
          ─────────────────────────────────────────────────────────────────── */}
      <section className="w-full bg-hd-deep/90 border-y border-crimson/20 backdrop-blur-md relative">
        <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {TELEMETRY.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3.5 min-w-0">
              <div
                className={
                  "fxz-icon-tile shrink-0 " +
                  (stat.tone === "ember" ? "fxz-icon-tile-ember" : "")
                }
              >
                <stat.icon className="h-4.5 w-4.5" strokeWidth={1.75} style={{ width: 18, height: 18 }} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-mono text-[22px] leading-7 font-bold tracking-tight text-white">
                  {stat.value}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ember truncate">
                  {stat.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          FEATURED MODELS — obsidian cards with crimson/ember rims.
          ─────────────────────────────────────────────────────────────────── */}
      <section className="w-full px-6 py-16 sm:py-20 max-w-7xl mx-auto flex flex-col gap-8 relative">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="fxz-section-eyebrow mb-1.5">Crimson core weights</div>
            <h2 className="text-3xl md:text-[34px] font-bold tracking-tight text-white">
              Featured free models
            </h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            Hot-swappable through one OpenAI-compatible endpoint. Every card
            links straight into the live playground.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURED.map((m, i) => {
            const emberRim = i % 2 === 1;
            return (
              <div
                key={m.id}
                className={
                  "group relative rounded-2xl bg-hd-deep/85 backdrop-blur-xl p-5 flex flex-col justify-between transition-all border shadow-[0_12px_32px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.08)] " +
                  (emberRim
                    ? "border-ember/25 hover:border-ember hover:shadow-[0_16px_36px_rgba(255,133,13,0.25),inset_0_1px_2px_rgba(255,133,13,0.4)]"
                    : "border-crimson/25 hover:border-crimson hover:shadow-[0_16px_36px_rgba(255,42,85,0.28),inset_0_1px_2px_rgba(255,42,85,0.45)]")
                }
              >
                <div>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <span
                      className={
                        "px-2 py-0.5 rounded-full font-mono text-[10px] font-bold " +
                        (emberRim
                          ? "bg-ember/15 text-ember border border-ember/40"
                          : "bg-crimson/15 text-crimson border border-crimson/40")
                      }
                    >
                      FREE
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {m.providerShortId}/{m.name}
                    </span>
                  </div>
                  <h3 className="text-[17px] font-bold text-white leading-snug">
                    {m.name}
                  </h3>
                  <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed line-clamp-2" title={m.description}>
                    {m.description}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-hd-highest/60 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {m.capabilities.tools && (
                      <span className="fxz-badge fxz-badge-ember">tools</span>
                    )}
                    {m.capabilities.reasoning && (
                      <span className="fxz-badge fxz-badge-warm">reasoning</span>
                    )}
                    {m.contextWindow > 0 && (
                      <span className="fxz-badge">
                        {m.contextWindow >= 1000
                          ? `${Math.round(m.contextWindow / 1000)}k ctx`
                          : `${m.contextWindow} ctx`}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/chat?model=${encodeURIComponent(m.id)}`}
                    aria-label={`Try ${m.name} in the playground`}
                    className={
                      "shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-hd-high border transition-all " +
                      (emberRim
                        ? "text-ember border-ember/25 hover:bg-ember hover:text-black"
                        : "text-crimson border-crimson/25 hover:bg-crimson hover:text-white")
                    }
                  >
                    <Play className="h-4 w-4" strokeWidth={2.5} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-center pt-2">
          <Link href="/models" className="fxz-ghost-pill">
            View all {MODEL_COUNT} models
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          PROVIDER MESH STRIP
          ─────────────────────────────────────────────────────────────────── */}
      <section className="relative border-y border-crimson/20 bg-hd-deep/60">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col md:flex-row items-center gap-6 md:gap-10">
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] uppercase text-muted-foreground shrink-0">
            Native providers
          </p>
          <div className="flex flex-wrap justify-center gap-x-7 gap-y-3 items-center w-full">
            {NATIVE_PROVIDERS.slice(0, 12).map((p) => (
              <span key={p.id} className="text-sm font-medium text-muted-foreground hover:text-white transition-colors">
                {p.name}
              </span>
            ))}
            {NATIVE_PROVIDERS.length > 12 && (
              <span className="text-sm text-hd-line">+{NATIVE_PROVIDERS.length - 12} more</span>
            )}
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          FEATURES BENTO
          ─────────────────────────────────────────────────────────────────── */}
      <section id="features" className="relative py-16 sm:py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12 max-w-2xl mx-auto flex flex-col items-center">
            <p className="fxz-section-eyebrow mb-4">Under the hood</p>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight text-white leading-tight">
              Every adapter implements chat,
              <br />
              streaming, and <span className="fxz-gradient-word">tools</span>.
            </h2>
            <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
              A lean OpenAI-compatible gateway over free native providers.
              Canonical model IDs, structured errors, per-provider health — and
              a complete tool-calling pipeline.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:auto-rows-fr">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={
                  "group relative overflow-hidden rounded-2xl border bg-hd-deep/85 backdrop-blur-xl p-6 transition-colors " +
                  (i % 2 === 0
                    ? "border-crimson/20 hover:border-crimson/60"
                    : "border-ember/20 hover:border-ember/60") +
                  (f.wide ? " md:col-span-2" : "")
                }
              >
                <span
                  className={
                    "inline-flex h-9 w-9 items-center justify-center rounded-xl mb-4 " +
                    (i % 2 === 0 ? "fxz-icon-tile" : "fxz-icon-tile fxz-icon-tile-ember")
                  }
                >
                  <f.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <h3 className="text-base font-semibold text-white mb-2 tracking-tight">
                  {f.title}
                </h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{f.desc}</p>
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{
                    background:
                      i % 2 === 0
                        ? "radial-gradient(circle at top right, rgba(255,42,85,0.10), transparent 70%)"
                        : "radial-gradient(circle at top right, rgba(255,133,13,0.10), transparent 70%)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          QUICKSTART — the full tool-calling request.
          ─────────────────────────────────────────────────────────────────── */}
      <section id="quickstart" className="relative py-16 sm:py-20 px-6 border-t border-crimson/15">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-10 flex flex-col items-center">
            <p className="fxz-section-eyebrow mb-3">Quick start</p>
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Point any OpenAI client at the gateway.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Streaming + tools, exactly like the spec you already use.
            </p>
          </div>

          <div className="fxz-cmdbar overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-hd-highest/60">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-crimson shadow-[0_0_6px_rgba(255,42,85,0.8)]" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-ember shadow-[0_0_6px_rgba(255,133,13,0.8)]" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-gold" />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                curl · bash
              </span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 text-[12px] leading-relaxed text-[#e2e2ea] custom-scroll font-mono">
              <code>{`curl -N https://freeaixyz4all.vercel.app/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "oc/gpt-5.6",
    "messages": [{"role":"user","content":"Hello"}],
    "stream": true,
    "tools": [{
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "Search the live web",
        "parameters": {"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}
      }
    }],
    "tool_choice": "auto"
  }'`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          FINAL CTA + FOOTER (sticky bottom via mt-auto)
          ─────────────────────────────────────────────────────────────────── */}
      <section className="relative py-16 sm:py-20 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="relative w-full rounded-3xl overflow-hidden border border-crimson/30 bg-gradient-to-br from-hd-high/90 via-hd-deep/95 to-hd-deep p-8 sm:p-12 shadow-[0_20px_60px_rgba(0,0,0,0.8)] backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-8">
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle 420px at 12% 0%, rgba(255,42,85,0.16), transparent 65%)",
              }}
            />
            <div className="flex flex-col gap-2.5 max-w-xl relative z-10 text-center md:text-left">
              <span className="fxz-section-eyebrow">Immediate provisioning</span>
              <h3 className="text-2xl sm:text-[32px] font-bold tracking-tight text-white leading-tight">
                Start building with{" "}
                {MODEL_COUNT} free models right now.
              </h3>
              <p className="text-[15px] text-muted-foreground leading-relaxed">
                No credit card. No subscription. Open the playground and stream
                your first tokens in seconds — or wire your OpenAI SDK straight
                into the gateway.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto relative z-10">
              <Link href="/chat" className="fxz-keycap w-full sm:w-auto justify-center">
                <Play className="h-4 w-4" strokeWidth={2.5} />
                Start chatting
              </Link>
              <a href="#quickstart" className="fxz-ghost-pill w-full sm:w-auto justify-center">
                View the API
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-crimson/20 bg-hd-deep/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2.5">
            <AuroraGlyph size={10} />
            <span className="text-[#e2e2ea]">HyperDimension AI — free AI gateway</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/chat" className="hover:text-white transition-colors">Playground</Link>
            <Link href="/models" className="hover:text-white transition-colors">Models</Link>
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
            <a href="/api/v1/models" className="hover:text-white transition-colors">API</a>
          </div>
          <span className="font-mono">GET /health · GET /ready</span>
        </div>
      </footer>
    </div>
  );
}
