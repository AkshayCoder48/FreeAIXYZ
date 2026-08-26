import Link from "next/link";
import {
  ArrowRight,
  Server,
  Plug,
  ShieldOff,
  Zap,
  Search,
  Code2,
  Activity,
} from "lucide-react";
import { Nav } from "@/components/nav";
import {
  SectionLabel,
  GradientButton,
  GradientText,
  FeaturedCard,
  InvertedSection,
  SiteFooter,
  HeroGraphic,
  LiveStatsBar,
  FadeIn,
} from "@/components/site";
import { ProviderCards } from "@/components/dashboard/provider-cards";

const FEATURES = [
  {
    icon: Plug,
    title: "OpenAI-Compatible",
    desc: "Drop-in replacement for /v1/chat/completions and /v1/models. Point any OpenAI SDK at the base URL — zero code changes.",
    wide: true,
  },
  {
    icon: Zap,
    title: "True End-to-End SSE",
    desc: "stream:true returns real SSE deltas (upstream pacing varies). Every layer (upstream → proxy → runtime → browser → parser → UI) streams. No gateway-side re-pacing (upstream pacing preserved).",
  },
  {
    icon: ShieldOff,
    title: "No Auth Required",
    desc: "No API keys, no bearer tokens. The gateway aggregates free upstream providers behind one OpenAI-shaped surface.",
  },
  {
    icon: Server,
    title: "Dynamic Model Discovery",
    desc: "Model catalogs are fetched from each provider's /models endpoint at startup — no hand-maintained model list. New upstream models appear automatically.",
  },
  {
    icon: Search,
    title: "Canonical IDs",
    desc: "Every model is <shortProviderId>/<originalUpstreamId>, e.g. fg/gpt-5. No custom marketing names. Cross-provider duplicates stay distinct.",
  },
  {
    icon: Activity,
    title: "Provider Health",
    desc: "Per-provider circuit breakers, per-model health, latency tracking, structured errors. 403s are classified, not silently retried.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1">
        {/* ───────── Hero ───────── */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.4] pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle 800px at 20% 20%, rgba(0, 82, 255, 0.07), transparent 60%), radial-gradient(circle 600px at 80% 80%, rgba(77, 124, 255, 0.05), transparent 60%)",
            }}
          />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-20 lg:py-28">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-12 items-center">
              {/* Left: headline + CTAs */}
              <FadeIn className="flex flex-col items-start gap-6 max-w-2xl">
                <SectionLabel>Dynamic discovery · True SSE</SectionLabel>
                <h1 className="text-5xl sm:text-6xl lg:text-7xl font-normal tracking-tight text-foreground leading-[1.05]">
                  The observable{" "}
                  <GradientText>AI gateway</GradientText>
                  <br />
                  that streams.
                </h1>
                <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl">
                  A robust OpenAI-compatible gateway that aggregates free
                  upstream providers, discovers their model catalogs at launch,
                  preserves true end-to-end SSE streaming, classifies upstream
                  errors, and exposes per-provider health — all behind canonical{" "}
                  <code
                    className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded-md text-sm"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    shortId/originalId
                  </code>{" "}
                  model IDs.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <GradientButton asChild size="lg">
                    <Link href="/chat">
                      Open playground
                      <ArrowRight className="size-4 ml-1" />
                    </Link>
                  </GradientButton>
                  <GradientButton asChild size="lg" variant="outline">
                    <Link href="/models">
                      Explore models
                      <Search className="size-4 ml-1" />
                    </Link>
                  </GradientButton>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Code2 className="size-4" /> OpenAI-compatible
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Zap className="size-4" /> Real streaming
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Activity className="size-4" /> Provider health
                  </span>
                </div>
              </FadeIn>

              {/* Right: animated hero graphic */}
              <div className="relative">
                <HeroGraphic />
              </div>
            </div>
          </div>
        </section>

        {/* ───────── Stats Bar (InvertedSection) ───────── */}
        <InvertedSection className="border-b border-border/40">
          <div className="relative z-10">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-10 sm:pt-12">
              <SectionLabel className="border-white/10 bg-white/5 text-white/70">
                Live metrics
              </SectionLabel>
              <h2 className="mt-4 text-2xl sm:text-3xl font-normal tracking-tight text-white">
                Snapshot of the gateway, refreshed every 10s.
              </h2>
            </div>
            <LiveStatsBar />
          </div>
        </InvertedSection>

        {/* ───────── Providers Grid ───────── */}
        <section className="border-b border-border bg-muted/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
            <FadeIn className="flex flex-col gap-2 mb-8">
              <SectionLabel>Providers</SectionLabel>
              <h2 className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground mt-2">
                Every adapter exposes discovery, chat, image, and health.
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl mt-1">
                Adding a provider requires one adapter — never touches the
                chat UI, model selector, or router. Each card below is live.
              </p>
            </FadeIn>
            <ProviderCards />
          </div>
        </section>

        {/* ───────── Features ───────── */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
            <FadeIn className="flex flex-col gap-2 mb-8">
              <SectionLabel>Architecture</SectionLabel>
              <h2 className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground mt-2">
                The transformation applied to this repository.
              </h2>
            </FadeIn>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <FadeIn
                  key={f.title}
                  index={i}
                  stagger={0.08}
                  className={
                    f.wide
                      ? "lg:col-span-2 group rounded-xl border border-border bg-card p-6 transition-all hover:border-accent/30 hover:shadow-accent"
                      : "group rounded-xl border border-border bg-card p-6 transition-all hover:border-accent/30 hover:shadow-accent"
                  }
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent mb-4 group-hover:scale-110 transition-transform">
                    <f.icon className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <h3 className="text-lg font-semibold text-foreground mb-1.5">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Quick Start (FeaturedCard) ───────── */}
        <section className="bg-background">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
            <FadeIn className="flex flex-col gap-2 mb-6">
              <SectionLabel>Quick start</SectionLabel>
              <h2 className="text-3xl sm:text-4xl font-normal tracking-tight text-foreground mt-2">
                Point any OpenAI client at the gateway.
              </h2>
              <p className="text-sm text-muted-foreground max-w-2xl mt-1">
                Model IDs are canonical (e.g.{" "}
                <code
                  className="font-mono text-accent px-1"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  fg/gpt-5
                </code>
                ,{" "}
                <code
                  className="font-mono text-accent px-1"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  po/openai-fast
                </code>
                ).
              </p>
            </FadeIn>
            <FadeIn>
              <FeaturedCard innerClassName="p-0">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full bg-rose-400/80" />
                    <span className="inline-block h-3 w-3 rounded-full bg-amber-400/80" />
                    <span className="inline-block h-3 w-3 rounded-full bg-emerald-400/80" />
                  </div>
                  <span
                    className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
                    style={{ fontFamily: "var(--font-mono), monospace" }}
                  >
                    curl · bash
                  </span>
                </div>
                <pre
                  className="overflow-x-auto bg-[#0F172A] text-zinc-100 p-5 text-xs leading-relaxed rounded-[10px]"
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  <code>{`curl -N https://<gateway>/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "po/openai-fast",
    "messages": [{"role":"user","content":"Hello"}],
    "stream": true
  }'`}</code>
                </pre>
              </FeaturedCard>
            </FadeIn>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
