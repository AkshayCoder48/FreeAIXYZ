import {
  Zap,
  ShieldOff,
  RefreshCw,
  Plug,
  Infinity as InfinityIcon,
  Github,
  ArrowRight,
  Terminal,
  KeyRound,
  Server,
  Cpu,
  CheckCircle2,
  Activity,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Playground } from "@/components/landing/playground";
import { CodeExamples } from "@/components/landing/code-examples";
import { TOOLBAZ_MODELS } from "@/lib/toolbaz";

const FEATURES = [
  {
    icon: InfinityIcon,
    title: "Unlimited & Free",
    desc: "No quotas, no credits, no signup. Send as many requests as you want — the gateway keeps serving.",
    accent: "text-emerald-400",
  },
  {
    icon: RefreshCw,
    title: "Auto Token Rotation",
    desc: "Every single request mints a fresh session id and browser fingerprint, fetches a new captcha token, then fires the completion. Nothing is reused.",
    accent: "text-emerald-400",
  },
  {
    icon: Plug,
    title: "OpenAI-Compatible",
    desc: "Drop-in for /v1/chat/completions and /v1/models. Point any OpenAI SDK at the base URL and it just works.",
    accent: "text-emerald-400",
  },
  {
    icon: ShieldOff,
    title: "No Auth Required",
    desc: "No API keys, no bearer tokens, no rate-limit headers to juggle. The gateway is wide open by design.",
    accent: "text-emerald-400",
  },
  {
    icon: Zap,
    title: "Streaming Support",
    desc: "Set stream: true and get standard SSE chunks — token-by-token deltas identical to OpenAI's streaming format.",
    accent: "text-emerald-400",
  },
  {
    icon: Server,
    title: "Serverless",
    desc: "Runs entirely on Next.js edge-friendly route handlers. Stateless, horizontally scalable, no persistent session store.",
    accent: "text-emerald-400",
  },
  {
    icon: Wrench,
    title: "Tool / Function Calling",
    desc: "Full OpenAI tools API support — pass tools, get back tool_calls with finish_reason. Prior assistant tool_calls and tool-result messages round-trip correctly through the conversation.",
    accent: "text-emerald-400",
  },
];

const ROTATION_STEPS = [
  {
    n: "01",
    icon: KeyRound,
    title: "Mint identity",
    desc: "Generate a random 36-char session id and a synthetic browser-fingerprint token (6 random base64 chars + base64 JSON payload).",
  },
  {
    n: "02",
    icon: Cpu,
    title: "Fetch captcha token",
    desc: "POST to token.php with the fresh identity. The server validates the fingerprint and returns a one-time captcha token.",
  },
  {
    n: "03",
    icon: Terminal,
    title: "Run completion",
    desc: "POST to writing.php with the captcha, model, session id and prompt. The response is cleaned and re-shaped into the OpenAI schema.",
  },
];

export default function Home() {
  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-x-hidden">
      {/* ambient background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(16,185,129,0.12), transparent 70%), radial-gradient(40% 40% at 100% 100%, rgba(16,185,129,0.06), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative h-9 w-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Zap className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">
                FreeGPT<span className="text-emerald-400"> Gateway</span>
              </span>
              <span className="block text-[10px] text-muted-foreground">
                OpenAI-compatible · Serverless
              </span>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {[
              ["Playground", "#playground"],
              ["Features", "#features"],
              ["Rotation", "#rotation"],
              ["Models", "#models"],
              ["Docs", "#docs"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="hidden sm:inline-flex gap-1.5 border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Online
            </Badge>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <Github className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 sm:pt-24 pb-12">
          <div className="flex flex-col items-center text-center gap-6">
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-500/30 text-emerald-400 bg-emerald-500/5 px-3 py-1"
            >
              <RefreshCw className="h-3 w-3" />
              Automatic per-request token rotation
            </Badge>
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-balance max-w-4xl">
              Unlimited free AI,{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                no key required
              </span>
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl text-balance">
              A serverless OpenAI-compatible API gateway. Each request quietly
              mints a fresh identity, rotates a new token, and returns a clean
              chat completion. Point any OpenAI SDK at it and go.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Button
                asChild
                size="lg"
                className="bg-emerald-600 hover:bg-emerald-500 text-white h-12 px-6"
              >
                <a href="#playground">
                  Try it now <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 px-6"
              >
                <a href="#docs">
                  <Terminal className="h-4 w-4" /> View docs
                </a>
              </Button>
            </div>

            {/* stat row */}
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-3xl">
              {[
                ["$0", "Cost per request"],
                ["0", "API keys needed"],
                ["∞", "Daily request limit"],
                ["100%", "OpenAI-compatible"],
              ].map(([big, small]) => (
                <div
                  key={small}
                  className="rounded-xl border border-border bg-card/40 backdrop-blur px-4 py-3"
                >
                  <div className="text-2xl font-bold text-emerald-400">
                    {big}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {small}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Playground */}
        <section
          id="playground"
          className="mx-auto max-w-6xl px-4 sm:px-6 py-12 scroll-mt-20"
        >
          <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Live Playground
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                A real chat UI hitting{" "}
                <code className="text-emerald-400 text-xs">
                  /api/v1/chat/completions
                </code>{" "}
                — streaming optional.
              </p>
            </div>
            <Badge variant="secondary" className="gap-1">
              <Activity className="h-3 w-3" /> No auth
            </Badge>
          </div>
          <Playground />
        </section>

        {/* Features */}
        <section
          id="features"
          className="mx-auto max-w-6xl px-4 sm:px-6 py-12 scroll-mt-20"
        >
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Built to be frictionless
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
              Everything you'd want from a free AI endpoint, with none of the
              usual gates.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-card/40 backdrop-blur p-5 hover:border-emerald-500/40 hover:bg-card/60 transition-colors"
              >
                <div className="h-11 w-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                  <f.icon className={`h-5 w-5 ${f.accent}`} />
                </div>
                <h3 className="font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Token rotation */}
        <section
          id="rotation"
          className="mx-auto max-w-6xl px-4 sm:px-6 py-12 scroll-mt-20"
        >
          <div className="rounded-3xl border border-border bg-gradient-to-b from-emerald-500/[0.04] to-transparent p-6 sm:p-10">
            <div className="text-center mb-10">
              <Badge
                variant="outline"
                className="mb-3 border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
              >
                <RefreshCw className="h-3 w-3" /> How it works
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Per-request token rotation
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl mx-auto">
                Most “free AI” proxies reuse a single token until it burns out.
                This gateway never does — every call starts from a blank slate.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {ROTATION_STEPS.map((s, i) => (
                <div key={s.n} className="relative">
                  <div className="rounded-2xl border border-border bg-card/60 backdrop-blur p-6 h-full">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-3xl font-bold text-emerald-500/30">
                        {s.n}
                      </span>
                      <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <s.icon className="h-5 w-5 text-emerald-400" />
                      </div>
                    </div>
                    <h3 className="font-semibold mb-2">{s.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {s.desc}
                    </p>
                  </div>
                  {i < ROTATION_STEPS.length - 1 && (
                    <ArrowRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-500/40 z-10" />
                  )}
                </div>
              ))}
            </div>

            {/* request lifecycle mini diagram */}
            <div className="mt-8 rounded-2xl border border-border bg-zinc-950/60 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-zinc-900/40">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-[11px] text-muted-foreground font-mono">
                  request lifecycle
                </span>
              </div>
              <pre className="overflow-x-auto p-4 text-[12px] leading-relaxed text-zinc-300 font-mono">
                <code>{`client ──▶ POST /api/v1/chat/completions
            │  { model, messages, stream }
            ▼
   ┌─ gateway (stateless) ─────────────────────────┐
   │  1. sessionId   = random(36)                   │
   │  2. fingerprint = rand(6) + base64(json)       │
   │  3. captcha     = POST token.php  ─▶  token    │
   │  4. completion  = POST writing.php ─▶  text    │
   │  5. reshape     = text  ─▶  OpenAI schema      │
   └────────────────────────────────────────────────┘
            ▼
client ◀── { choices, usage }  · or SSE stream`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Models */}
        <section
          id="models"
          className="mx-auto max-w-6xl px-4 sm:px-6 py-12 scroll-mt-20"
        >
          <div className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Available models
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Fetch them live from{" "}
              <code className="text-emerald-400 text-xs">GET /api/v1/models</code>
              .
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/40 backdrop-blur overflow-hidden">
            <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_2fr_1fr] gap-4 px-5 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
              <span>Model ID</span>
              <span className="hidden sm:block">Upstream</span>
              <span className="text-right">Status</span>
            </div>
            {TOOLBAZ_MODELS.map((m) => (
              <div
                key={m.id}
                className="grid grid-cols-[1fr_auto] sm:grid-cols-[2fr_2fr_1fr] gap-4 px-5 py-4 border-b border-border/60 last:border-0 items-center hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Cpu className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div>
                    <code className="text-sm font-medium">{m.id}</code>
                    <p className="text-[11px] text-muted-foreground">
                      {m.description}
                    </p>
                  </div>
                </div>
                <code className="hidden sm:block text-xs text-muted-foreground">
                  {m.upstream}
                </code>
                <div className="flex justify-end">
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                  >
                    <CheckCircle2 className="h-3 w-3" /> ready
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Docs */}
        <section
          id="docs"
          className="mx-auto max-w-6xl px-4 sm:px-6 py-12 scroll-mt-20"
        >
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-8 items-start">
            <div className="lg:sticky lg:top-24">
              <Badge variant="outline" className="mb-3 border-emerald-500/30 text-emerald-400 bg-emerald-500/5">
                <Terminal className="h-3 w-3" /> Quickstart
              </Badge>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Drop-in for any OpenAI client
              </h2>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                The gateway exposes a fully OpenAI-compatible Chat Completions
                API. Set the base URL to{" "}
                <code className="text-emerald-400 text-xs">
                  /api/v1
                </code>{" "}
                and use any dummy string as the API key — authentication is
                disabled.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {[
                  "POST /api/v1/chat/completions",
                  "GET /api/v1/models",
                  "Supports stream: true (SSE)",
                  "Supports system / user / assistant / tool roles",
                  "Supports tools & tool_calls (function calling)",
                  "Returns OpenAI-shaped usage stats",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <code className="text-xs">{t}</code>
                  </li>
                ))}
              </ul>
            </div>
            <CodeExamples />
          </div>
        </section>
      </main>

      {/* Footer (sticky to bottom) */}
      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Zap className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                FreeGPT Gateway
              </span>{" "}
              · Unlimited free AI · OpenAI-compatible
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="#playground" className="hover:text-foreground transition-colors">
              Playground
            </a>
            <a href="#docs" className="hover:text-foreground transition-colors">
              Docs
            </a>
            <a href="#models" className="hover:text-foreground transition-colors">
              Models
            </a>
            <span className="flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              All systems operational
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
