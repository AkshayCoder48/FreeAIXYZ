import { Nav } from "@/components/nav";
import {
  ArrowRight,
  Server,
  Cpu,
  CheckCircle2,
  Terminal,
  ShieldOff,
  Plug,
  Infinity as InfinityIcon,
  Wrench,
  Zap,
  Globe,
  Code2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MODELS, PROVIDER_INFO } from "@/lib/providers";

const FEATURES = [
  {
    icon: InfinityIcon,
    title: "Unlimited & Free",
    desc: "No quotas, no credits, no signup. Send as many requests as you want — truly unlimited inference at zero cost.",
  },
  {
    icon: Plug,
    title: "OpenAI-Compatible",
    desc: "Drop-in replacement for /v1/chat/completions and /v1/models. Point any OpenAI SDK at the base URL — zero code changes.",
  },
  {
    icon: ShieldOff,
    title: "No Auth Required",
    desc: "No API keys, no bearer tokens, no OAuth flows. The gateway is wide open by design.",
  },
  {
    icon: Zap,
    title: "Real Streaming",
    desc: "Set stream: true and get standard SSE chunks — token-by-token deltas identical to OpenAI's format.",
  },
  {
    icon: Server,
    title: "Serverless Scale",
    desc: "Runs on Next.js edge-friendly route handlers. Stateless, horizontally scalable, Vercel global edge network.",
  },
  {
    icon: Wrench,
    title: "Tool / Function Calling",
    desc: "Full OpenAI tools API support — pass tools in your request, get back tool_calls with finish_reason.",
  },
];

export default function Home() {
  const textModels = MODELS.filter((m) => m.modality !== "text-to-image");
  const providerCount = Object.keys(PROVIDER_INFO).length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />

      <main className="flex-1">
        {/* ─── Hero Section ─────────────────────────────────────────────────── */}
        <section className="relative mx-auto max-w-6xl px-6 pt-20 sm:pt-32 pb-24">
          {/* Subtle texture overlay */}
          <div className="pointer-events-none absolute inset-0 texture-lines" />

          <div className="relative flex flex-col items-center text-center gap-8">
            {/* Label */}
            <span
              className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              Free AI Inference Platform
            </span>

            {/* Hero Headline — Oversized Serif */}
            <h1
              className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-bold tracking-tighter leading-none max-w-5xl"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              Unlimited
              <br />
              free AI
            </h1>

            {/* Thick rule accent */}
            <div className="flex items-center gap-3">
              <div className="h-[4px] w-16 bg-foreground" />
              <div className="h-4 w-4 border-2 border-foreground" />
              <div className="h-[4px] w-16 bg-foreground" />
            </div>

            {/* Subtitle */}
            <p
              className="text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed"
              style={{ fontFamily: "var(--font-body), serif" }}
            >
              A free AI inference platform with an OpenAI-compatible API.
              {" "}{textModels.length} models across {providerCount} providers —
              all free, no signup, instant inference.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
              <a
                href="/chat"
                className="inline-flex items-center gap-2 h-14 px-10 bg-foreground text-background font-medium text-sm uppercase tracking-widest hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground transition-colors duration-100"
              >
                Open Playground
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/docs"
                className="inline-flex items-center gap-2 h-14 px-10 border-2 border-foreground text-foreground font-medium text-sm uppercase tracking-widest hover:bg-foreground hover:text-background transition-colors duration-100"
              >
                <Code2 className="h-4 w-4" strokeWidth={1.5} />
                View docs
              </a>
            </div>
          </div>
        </section>

        {/* ─── Thick Section Rule ──────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-6">
          <div className="h-[4px] bg-foreground" />
        </div>

        {/* ─── Stats Section (Inverted) ─────────────────────────────────────── */}
        <section className="bg-foreground text-background">
          {/* Vertical line texture on inverted section */}
          <div className="pointer-events-none absolute inset-0 texture-vertical" />
          <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
              {[
                { value: String(textModels.length), label: "Free Models", icon: Cpu },
                { value: String(providerCount), label: "Providers", icon: Globe },
                { value: "∞", label: "Daily Requests", icon: InfinityIcon },
                { value: "$0", label: "Cost", icon: Zap },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <stat.icon
                    className="h-5 w-5 mx-auto mb-3 text-background/50"
                    strokeWidth={1.5}
                  />
                  <div
                    className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tighter leading-none"
                    style={{ fontFamily: "var(--font-brand), serif" }}
                  >
                    {stat.value}
                  </div>
                  <div
                    className="text-xs text-background/50 uppercase tracking-widest mt-2"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Thick Section Rule ──────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-6">
          <div className="h-[4px] bg-foreground" />
        </div>

        {/* ─── Features Grid ────────────────────────────────────────────────── */}
        <section className="relative mx-auto max-w-6xl px-6 py-24">
          {/* Grid texture overlay */}
          <div className="pointer-events-none absolute inset-0 texture-grid" />

          <div className="relative">
            <div className="text-center mb-16">
              <h2
                className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tighter"
                style={{ fontFamily: "var(--font-brand), serif" }}
              >
                Built to be
                <br />
                <em>frictionless</em>
              </h2>
              <p
                className="text-base text-muted-foreground mt-4 max-w-xl mx-auto leading-relaxed"
                style={{ fontFamily: "var(--font-body), serif" }}
              >
                Everything you&apos;d want from a free AI endpoint, with none of the usual gates or gotchas.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="group border border-foreground p-6 sm:p-8 transition-colors duration-100 hover:bg-foreground hover:text-background"
                >
                  <f.icon
                    className="h-6 w-6 mb-5 text-foreground group-hover:text-background transition-colors duration-100"
                    strokeWidth={1.5}
                  />
                  <h3
                    className="text-xl font-bold mb-2"
                    style={{ fontFamily: "var(--font-brand), serif" }}
                  >
                    {f.title}
                  </h3>
                  <p
                    className="text-sm text-muted-foreground leading-relaxed group-hover:text-background/70 transition-colors duration-100"
                    style={{ fontFamily: "var(--font-body), serif" }}
                  >
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Thick Section Rule ──────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-6">
          <div className="h-[8px] bg-foreground" />
        </div>

        {/* ─── Quickstart Section ──────────────────────────────────────────── */}
        <section className="relative mx-auto max-w-6xl px-6 py-24">
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
            <div>
              <span
                className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
                style={{ fontFamily: "var(--font-code), monospace" }}
              >
                <Terminal className="h-3 w-3 inline mr-1.5" strokeWidth={1.5} />
                Quickstart
              </span>
              <h2
                className="text-4xl sm:text-5xl font-bold tracking-tighter mt-4"
                style={{ fontFamily: "var(--font-brand), serif" }}
              >
                Drop-in for any
                <br />
                <em>OpenAI</em> client
              </h2>
              <p
                className="text-base text-muted-foreground mt-4 leading-relaxed"
                style={{ fontFamily: "var(--font-body), serif" }}
              >
                The gateway exposes a fully OpenAI-compatible Chat Completions API.
                Set the base URL to{" "}
                <code className="text-foreground text-sm font-semibold" style={{ fontFamily: "var(--font-code), monospace" }}>/api/v1</code>{" "}
                and use any dummy string as the API key — authentication is disabled.
              </p>
              <ul className="mt-8 space-y-3 text-sm">
                {[
                  "POST /api/v1/chat/completions",
                  "GET /api/v1/models",
                  "Supports stream: true (SSE)",
                  "Supports tools & tool_calls",
                  "Returns OpenAI-shaped usage stats",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" strokeWidth={1.5} />
                    <code className="text-xs font-semibold" style={{ fontFamily: "var(--font-code), monospace" }}>{t}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-foreground overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-foreground bg-foreground text-background">
                <Terminal className="h-4 w-4" strokeWidth={1.5} />
                <span className="text-xs font-medium uppercase tracking-widest" style={{ fontFamily: "var(--font-code), monospace" }}>quickstart</span>
              </div>
              <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-foreground/80" style={{ fontFamily: "var(--font-code), monospace" }}>
                <code>{`curl /api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# All model ids work drop-in.
# No API key required.`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* ─── Thick Section Rule ──────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-6">
          <div className="h-[4px] bg-foreground" />
        </div>

        {/* ─── Final CTA ──────────────────────────────────────────────────── */}
        <section className="bg-foreground text-background">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28 text-center">
            <h2
              className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tighter"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              Start building.
            </h2>
            <p
              className="text-base text-background/60 mt-4 max-w-lg mx-auto leading-relaxed"
              style={{ fontFamily: "var(--font-body), serif" }}
            >
              Free inference, unlimited requests, zero configuration.
              Point your OpenAI client and go.
            </p>
            <a
              href="/chat"
              className="inline-flex items-center gap-2 h-14 px-10 mt-8 bg-background text-foreground font-medium text-sm uppercase tracking-widest hover:bg-foreground hover:text-background hover:border-2 hover:border-background transition-colors duration-100"
            >
              Open Playground
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>
      </main>

      {/* ─── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-foreground bg-background">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="text-sm font-bold tracking-tight"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              FreeAI<span className="text-muted-foreground">4All</span>
            </span>
            <span className="text-xs text-muted-foreground">
              · Free AI Inference · OpenAI-compatible
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "var(--font-code), monospace" }}>
            <a href="/chat" className="hover:text-foreground transition-colors duration-100">Playground</a>
            <a href="/models" className="hover:text-foreground transition-colors duration-100">Models</a>
            <a href="/image" className="hover:text-foreground transition-colors duration-100">Image Studio</a>
            <a href="/docs" className="hover:text-foreground transition-colors duration-100">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
