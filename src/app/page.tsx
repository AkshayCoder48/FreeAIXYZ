import { Nav } from "@/components/nav";
import {
  Zap,
  ArrowRight,
  Server,
  Cpu,
  CheckCircle2,
  Terminal,
  Activity,
  ShieldOff,
  Plug,
  Infinity as InfinityIcon,
  Wrench,
  Eye,
  Sparkles,
  Globe,
  Rocket,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MODELS, PROVIDER_INFO } from "@/lib/providers";

const FEATURES = [
  {
    icon: InfinityIcon,
    title: "Unlimited & Free",
    desc: "No quotas, no credits, no signup. Send as many requests as you want to any model, any time. Truly unlimited inference at zero cost.",
    color: "from-purple-400 to-purple-600",
  },
  {
    icon: Plug,
    title: "OpenAI-Compatible",
    desc: "Drop-in replacement for /v1/chat/completions and /v1/models. Point any OpenAI SDK at the base URL and it works instantly with zero code changes.",
    color: "from-pink-400 to-pink-600",
  },
  {
    icon: ShieldOff,
    title: "No Auth Required",
    desc: "No API keys, no bearer tokens, no OAuth flows. The gateway is wide open by design — just send requests and get responses.",
    color: "from-sky-400 to-sky-600",
  },
  {
    icon: Zap,
    title: "Real Streaming",
    desc: "Set stream: true and get standard SSE chunks — token-by-token deltas identical to OpenAI's streaming format. Real-time, not simulated.",
    color: "from-emerald-400 to-emerald-600",
  },
  {
    icon: Server,
    title: "Serverless Scale",
    desc: "Runs entirely on Next.js edge-friendly route handlers. Stateless, horizontally scalable, deployed on Vercel's global edge network.",
    color: "from-amber-400 to-amber-600",
  },
  {
    icon: Wrench,
    title: "Tool / Function Calling",
    desc: "Full OpenAI tools API support — pass tools in your request, get back tool_calls with finish_reason. Native support on select providers.",
    color: "from-cyan-400 to-cyan-600",
  },
];

export default function Home() {
  const textModels = MODELS.filter((m) => m.modality !== "text-to-image");
  const providerCount = Object.keys(PROVIDER_INFO).length;

  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* ─── Animated Background Blobs ─────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute h-[60vh] w-[60vh] -top-[10%] -left-[10%] rounded-full bg-[#8B5CF6]/10 blur-3xl animate-clay-float" />
        <div className="absolute h-[50vh] w-[50vh] -right-[10%] top-[20%] rounded-full bg-[#EC4899]/10 blur-3xl animate-clay-float-delayed animation-delay-2000" />
        <div className="absolute h-[45vh] w-[45vh] bottom-[5%] left-[30%] rounded-full bg-[#0EA5E9]/10 blur-3xl animate-clay-float-slow animation-delay-4000" />
      </div>

      <Nav />

      <main className="flex-1">
        {/* ─── Hero Section ─────────────────────────────────────────────────── */}
        <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-28 pb-16">
          <div className="flex flex-col items-center text-center gap-8">
            {/* Badge */}
            <Badge
              variant="outline"
              className="gap-2 border-primary/20 text-primary bg-primary/5 px-4 py-1.5 rounded-[20px] text-sm font-medium shadow-clay-button"
            >
              <Activity className="h-3.5 w-3.5" />
              Free AI Inference Platform
            </Badge>

            {/* Hero Headline */}
            <h1
              className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight leading-[1.1] max-w-5xl"
              style={{ fontFamily: "var(--font-brand), sans-serif" }}
            >
              Unlimited free AI,{" "}
              <span className="clay-text-gradient">no key required</span>
            </h1>

            {/* Subtitle */}
            <p
              className="text-lg sm:text-xl text-muted-foreground max-w-2xl leading-relaxed"
              style={{ fontFamily: "var(--font-body), sans-serif" }}
            >
              A free AI inference platform with an OpenAI-compatible API.{" "}
              {textModels.length} models across {providerCount} providers — all free, no signup, instant inference.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
              <a
                href="/chat"
                className="inline-flex items-center gap-2 h-14 px-8 rounded-[20px] bg-gradient-to-br from-[#A78BFA] to-[#7C3AED] text-white font-bold tracking-wide shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 text-base"
              >
                <Rocket className="h-5 w-5" />
                Open Playground
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/docs"
                className="inline-flex items-center gap-2 h-14 px-8 rounded-[20px] bg-white dark:bg-[#2D2440] text-foreground font-bold tracking-wide shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200 border border-primary/10 text-base"
              >
                <Code2 className="h-5 w-5" />
                View docs
              </a>
            </div>

            {/* ─── Stats Orbs ──────────────────────────────────────────────── */}
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-3xl">
              {[
                { value: String(textModels.length), label: "Free Models", icon: Cpu, color: "from-purple-400 to-purple-600" },
                { value: String(providerCount), label: "Providers", icon: Globe, color: "from-pink-400 to-pink-600" },
                { value: "∞", label: "Daily Requests", icon: InfinityIcon, color: "from-sky-400 to-sky-600" },
                { value: "$0", label: "Cost", icon: Zap, color: "from-emerald-400 to-emerald-600" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="relative rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-6 shadow-clay-card hover:-translate-y-2 hover:shadow-clay-card-hover transition-all duration-500 group text-center"
                >
                  <div className={`mx-auto mb-3 h-10 w-10 rounded-full bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-clay-button animate-clay-breathe`}>
                    <stat.icon className="h-5 w-5 text-white" />
                  </div>
                  <div
                    className="text-3xl sm:text-4xl font-black text-foreground"
                    style={{ fontFamily: "var(--font-brand), sans-serif" }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium tracking-wide uppercase mt-1">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Features Grid (Bento) ────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <div className="text-center mb-12">
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight"
              style={{ fontFamily: "var(--font-brand), sans-serif" }}
            >
              Built to be{" "}
              <span className="text-primary">frictionless</span>
            </h2>
            <p
              className="text-base sm:text-lg text-muted-foreground mt-3 max-w-xl mx-auto leading-relaxed"
              style={{ fontFamily: "var(--font-body), sans-serif" }}
            >
              Everything you&apos;d want from a free AI endpoint, with none of the usual gates or gotchas.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, idx) => (
              <div
                key={f.title}
                className={`group relative overflow-hidden rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-6 sm:p-8 shadow-clay-card hover:-translate-y-2 hover:shadow-clay-card-hover transition-all duration-500 ${idx === 0 ? 'sm:col-span-2 lg:col-span-1' : ''}`}
              >
                <div className="relative z-10 flex h-full flex-col">
                  <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-5 shadow-clay-button group-hover:scale-110 transition-transform duration-300`}>
                    <f.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3
                    className="text-xl font-bold mb-2"
                    style={{ fontFamily: "var(--font-brand), sans-serif" }}
                  >
                    {f.title}
                  </h3>
                  <p
                    className="text-sm text-muted-foreground leading-relaxed"
                    style={{ fontFamily: "var(--font-body), sans-serif" }}
                  >
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Quickstart Section ──────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-8 items-start">
            <div>
              <Badge variant="outline" className="mb-4 border-primary/20 text-primary bg-primary/5 rounded-[20px] px-3 py-1 gap-1.5">
                <Terminal className="h-3 w-3" /> Quickstart
              </Badge>
              <h2
                className="text-3xl sm:text-4xl font-extrabold tracking-tight"
                style={{ fontFamily: "var(--font-brand), sans-serif" }}
              >
                Drop-in for any{" "}
                <span className="text-primary">OpenAI</span> client
              </h2>
              <p
                className="text-base text-muted-foreground mt-3 leading-relaxed"
                style={{ fontFamily: "var(--font-body), sans-serif" }}
              >
                The gateway exposes a fully OpenAI-compatible Chat Completions API.
                Set the base URL to{" "}
                <code className="text-primary text-sm font-semibold">/api/v1</code>{" "}
                and use any dummy string as the API key — authentication is disabled.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "POST /api/v1/chat/completions",
                  "GET /api/v1/models",
                  "Supports stream: true (SSE)",
                  "Supports tools & tool_calls",
                  "Returns OpenAI-shaped usage stats",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                    <code className="text-xs font-semibold" style={{ fontFamily: "var(--font-code), monospace" }}>{t}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl shadow-clay-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-primary/10 bg-primary/5">
                <Terminal className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground font-medium" style={{ fontFamily: "var(--font-code), monospace" }}>quickstart</span>
              </div>
              <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed text-foreground/80 font-mono" style={{ fontFamily: "var(--font-code), monospace" }}>
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
      </main>

      {/* ─── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-primary/5 bg-white/40 dark:bg-[#1A1625]/40 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-clay-button">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm text-muted-foreground">
              <span
                className="font-bold text-foreground"
                style={{ fontFamily: "var(--font-brand), sans-serif" }}
              >
                FreeAI<span className="text-primary">4All</span>
              </span>{" "}
              · Free AI Inference · OpenAI-compatible
            </span>
          </div>
          <div className="flex items-center gap-5 text-sm text-muted-foreground font-medium">
            <a href="/chat" className="hover:text-primary hover:-translate-y-0.5 transition-all duration-200">Playground</a>
            <a href="/models" className="hover:text-primary hover:-translate-y-0.5 transition-all duration-200">Models</a>
            <a href="/image" className="hover:text-primary hover:-translate-y-0.5 transition-all duration-200">Image Studio</a>
            <a href="/docs" className="hover:text-primary hover:-translate-y-0.5 transition-all duration-200">Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
