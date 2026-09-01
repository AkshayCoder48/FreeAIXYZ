import Link from "next/link";
import {
  Zap,
  Wrench,
  Search,
  Layers,
  Terminal,
  Globe,
  ShieldOff,
  Activity,
  ArrowRight,
  Bot,
  Cpu,
} from "lucide-react";
import { NATIVE_PROVIDERS, OFFERED_MODELS } from "@/lib/native-catalog";

/**
 * Landing page — WARM AURORA hero (cinematic dark developer-tool style).
 *
 * The hero's signature is a LIVING animated aurora: several soft-focus
 * diagonal light-blades (crimson #ff2f3a → coral #ff6b4a → amber #ffb347)
 * drifting + breathing on staggered pure-CSS keyframes over the #07080a
 * ground, layered under an SVG feTurbulence film-grain + vignette. The 0%
 * keyframe is full bloom so a single still is the richest frame. Strictly
 * WARM — no purple/indigo/violet.
 *
 * Type: ONE sans (Inter via --font-body) with hierarchy from SIZE+WEIGHT;
 * mono (JetBrains Mono via --font-mono) ONLY for the install caption,
 * shortcut chips, and code. Shape language: flat except two tactile
 * exceptions — the KEYCAP-RAISED download-style buttons and the dark-glass
 * COMMAND-BAR mockup. All other elements strictly neutral
 * (#ffffff / #9c9c9d / #07080a).
 */

const MODEL_COUNT = OFFERED_MODELS.length;
const PROVIDER_COUNT = NATIVE_PROVIDERS.length;
const STREAMING_COUNT = OFFERED_MODELS.filter((m) => m.capabilities.streaming).length;
const TOOLS_COUNT = OFFERED_MODELS.filter((m) => m.capabilities.tools).length;

/** Command-bar result rows (product-real commands + shortcut chips). */
const COMMAND_ROWS = [
  {
    icon: Search,
    label: "web_search",
    arg: 'query: "latest next.js release notes"',
    kbd: "Cmd+Enter",
    active: true,
  },
  {
    icon: Bot,
    label: "oc/gpt-5.6",
    arg: "reasoning + tools · 61 models on OpenCode",
    kbd: "Cmd+B",
    active: false,
  },
  {
    icon: Zap,
    label: "stream: true",
    arg: "real SSE deltas — no gateway re-pacing",
    kbd: "Cmd+O",
    active: false,
  },
  {
    icon: Globe,
    label: "GET /api/v1/models",
    arg: `${MODEL_COUNT} free models · no key required`,
    kbd: "Cmd+K",
    active: false,
  },
];

/** Chat glyph (inline SVG — keycap button 1). */
function ChatGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        stroke="#2f3031"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/** Grid/layers glyph (inline SVG — keycap button 2). */
function GridGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#2f3031" strokeWidth="2" fill="none" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#2f3031" strokeWidth="2" fill="none" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#2f3031" strokeWidth="2" fill="none" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#2f3031" strokeWidth="2" fill="none" />
    </svg>
  );
}

/** Search glyph (inline SVG — command bar input row). */
function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="#9c9c9d" strokeWidth="2" fill="none" />
      <path d="m20 20-3.5-3.5" stroke="#9c9c9d" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

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
    icon: ShieldOff,
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

export default function Home() {
  return (
    <div className="fxz-aurora-root min-h-screen flex flex-col text-white">
      {/* ───────────────────────────────────────────────────────────────────
          HERO — living warm aurora + floating pill nav + headline + keycaps
          + command-bar mockup + ghost pill + product badge.
          ─────────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen overflow-hidden flex flex-col">
        {/* Aurora light-blades (pure CSS keyframes — see globals.css). */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="fxz-blade fxz-blade-1" />
          <div className="fxz-blade fxz-blade-2" />
          <div className="fxz-blade fxz-blade-3" />
          <div className="fxz-blade fxz-blade-4" />
          <div className="fxz-aurora-core" />
        </div>
        {/* Film grain + vignette. */}
        <div aria-hidden className="fxz-grain absolute inset-0 pointer-events-none" />
        <div aria-hidden className="fxz-vignette absolute inset-0 pointer-events-none" />

        {/* ── Floating pill nav (top-center, NOT a full-width bar) ── */}
        <header className="relative z-20 pt-6 px-4 flex justify-center">
          <nav
            className="w-full max-w-3xl flex items-center justify-between rounded-full border border-white/10 bg-black/55 backdrop-blur-xl px-5 py-2.5"
            style={{ boxShadow: "0 18px 50px -18px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.07)" }}
            aria-label="Main navigation"
          >
            <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
              <span
                className="inline-block h-3.5 w-3.5 rotate-45 rounded-[3px]"
                style={{
                  background: "linear-gradient(135deg, #ff2f3a 0%, #ff6b4a 60%, #ffb347 100%)",
                  boxShadow: "0 0 12px rgba(255,47,58,0.55)",
                }}
                aria-hidden="true"
              />
              <span
                className="text-[15px] font-semibold tracking-tight text-white"
                style={{ fontFamily: "var(--font-body), sans-serif" }}
              >
                FreeAI<span className="text-zinc-500">XYZ</span>
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-7">
              <Link href="/chat" className="text-sm font-medium text-[#9c9c9d] hover:text-white transition-colors">
                Playground
              </Link>
              <Link href="/models" className="text-sm font-medium text-[#9c9c9d] hover:text-white transition-colors">
                Models
              </Link>
              <Link href="/docs" className="text-sm font-medium text-[#9c9c9d] hover:text-white transition-colors">
                Docs
              </Link>
              <a href="#quickstart" className="text-sm font-medium text-[#9c9c9d] hover:text-white transition-colors">
                API
              </a>
              <a href="#features" className="text-sm font-medium text-[#9c9c9d] hover:text-white transition-colors">
                Features
              </a>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/models"
                className="hidden sm:block text-sm font-medium text-zinc-300 hover:text-white transition-colors"
              >
                Browse
              </Link>
              <Link href="/chat" className="fxz-nav-cta">
                Open Playground
                <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
              </Link>
            </div>
          </nav>
        </header>

        {/* ── Hero content ── */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 pt-10 pb-6 gap-4">
          <div className="fxz-fade-up">
            <span className="fxz-eyebrow">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff6b4a] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff2f3a]" />
              </span>
              v2.0 — now with native tool calling
              <ArrowRight className="h-3 w-3 text-[#ff8a6b]" />
            </span>
          </div>

          <h1
            className="fxz-hero-title max-w-3xl fxz-fade-up"
            style={{ fontFamily: "var(--font-body), sans-serif", animationDelay: "80ms" }}
          >
            Free intelligence,
            <span className="block">
              one <span className="fxz-gradient-word">keystroke</span> away.
            </span>
          </h1>

          <p
            className="max-w-[620px] text-[15px] md:text-base font-normal leading-relaxed text-[#b9b9bc] fxz-fade-up"
            style={{ fontFamily: "var(--font-body), sans-serif", letterSpacing: "0.01em", animationDelay: "160ms" }}
          >
            {MODEL_COUNT} native models across {PROVIDER_COUNT} providers, streamed
            through one OpenAI-compatible API — with real tool calling, live web
            search, and zero keys or accounts.
          </p>

          {/* Keycap-raised tactile buttons (two, side by side). */}
          <div
            className="flex flex-col sm:flex-row items-center justify-center gap-4 fxz-fade-up"
            style={{ animationDelay: "240ms" }}
          >
            <Link href="/chat" className="fxz-keycap w-full sm:w-auto">
              <ChatGlyph />
              Open the Playground
            </Link>
            <Link href="/models" className="fxz-keycap w-full sm:w-auto">
              <GridGlyph />
              Browse {MODEL_COUNT} Models
            </Link>
          </div>

          {/* Mono install caption. */}
          <p
            className="text-xs text-[#9c9c9d] fxz-fade-up"
            style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", animationDelay: "300ms" }}
          >
            POST /api/v1/chat/completions — no key · no account · SSE streaming
          </p>

          {/* ── Dark-glass command-bar / launcher mockup ── */}
          <div
            className="w-full max-w-2xl fxz-fade-up"
            style={{ animationDelay: "360ms" }}
            aria-label="Command bar preview"
          >
            <div className="fxz-cmdbar overflow-hidden">
              {/* Input row */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.07]">
                <SearchGlyph />
                <span
                  className="text-sm text-zinc-200 truncate"
                  style={{ fontFamily: "var(--font-body), sans-serif" }}
                >
                  summarize the latest next.js release
                  <span className="fxz-caret" aria-hidden="true" />
                </span>
                <span
                  className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[#ff8a6b] border border-[#ff6b4a]/30 bg-[#ff2f3a]/10 rounded-full px-2.5 py-1"
                >
                  Command
                </span>
              </div>

              {/* Result rows */}
              <div className="py-1.5">
                {COMMAND_ROWS.map((row) => (
                  <div
                    key={row.label}
                    className={`flex items-center gap-3 mx-2 my-1 px-3 py-2 rounded-lg border border-transparent transition-colors ${
                      row.active ? "fxz-cmd-row-active" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <row.icon
                      className={`h-4 w-4 shrink-0 ${row.active ? "text-[#ff6b4a]" : "text-[#8a8a8d]"}`}
                      strokeWidth={1.75}
                    />
                    <span
                      className="text-[13px] text-zinc-200 truncate"
                      style={{ fontFamily: "var(--font-body), sans-serif" }}
                    >
                      <span className={row.active ? "text-white" : "text-zinc-300"}>
                        {row.label}
                      </span>
                      <span
                        className="text-[#8a8a8d] ml-2.5 hidden sm:inline"
                        style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "11px" }}
                      >
                        {row.arg}
                      </span>
                    </span>
                    <span className="fxz-kbd ml-auto shrink-0">{row.kbd}</span>
                  </div>
                ))}
              </div>

              {/* Footer strip */}
              <div
                className="flex items-center justify-between px-4 py-2.5 border-t border-white/[0.07] text-[10.5px] text-[#7c7c7f]"
                style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
              >
                <span>up/down navigate · enter open · esc dismiss</span>
                <span className="text-[#9c9c9d]">FreeAIXYZ</span>
              </div>
            </div>
          </div>

          {/* Single ghost pill (exactly one — low-emphasis secondary path). */}
          <div className="fxz-fade-up" style={{ animationDelay: "420ms" }}>
            <a href="#features" className="fxz-ghost-pill">
              Learn more
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* ── Floating product badge (bottom-right) ── */}
        <div className="absolute bottom-6 right-6 z-10 hidden md:block">
          <div
            className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl px-4 py-3 max-w-[260px]"
            style={{ boxShadow: "0 18px 50px -18px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-3 w-3 rotate-45 rounded-[2.5px] shrink-0"
                style={{
                  background: "linear-gradient(135deg, #ff2f3a 0%, #ff6b4a 60%, #ffb347 100%)",
                  boxShadow: "0 0 10px rgba(255,47,58,0.5)",
                }}
                aria-hidden="true"
              />
              <div>
                <p className="text-[12.5px] font-semibold text-white leading-tight">
                  {MODEL_COUNT} models · {PROVIDER_COUNT} providers
                </p>
                <p className="text-[10.5px] text-[#9c9c9d] leading-tight mt-0.5">
                  no key · no account · {TOOLS_COUNT} with tool calling
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          PROVIDERS STRIP (muted, like a logo strip)
          ─────────────────────────────────────────────────────────────────── */}
      <section className="relative border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col md:flex-row items-center gap-6 md:gap-10">
          <p className="text-xs font-semibold tracking-[0.18em] uppercase text-zinc-500 shrink-0">
            Native providers
          </p>
          <div className="flex flex-wrap justify-center gap-x-7 gap-y-3 items-center w-full">
            {NATIVE_PROVIDERS.slice(0, 12).map((p) => (
              <span key={p.id} className="text-sm font-medium text-zinc-400">
                {p.name}
              </span>
            ))}
            {NATIVE_PROVIDERS.length > 12 && (
              <span className="text-sm text-zinc-600">+{NATIVE_PROVIDERS.length - 12} more</span>
            )}
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          STATS
          ─────────────────────────────────────────────────────────────────── */}
      <section id="features" className="relative py-20 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-[#ff6b4a] mb-4">
              The free gateway
            </p>
            <h2
              className="text-3xl md:text-[42px] font-semibold text-white tracking-tight leading-tight"
              style={{ fontFamily: "var(--font-body), sans-serif" }}
            >
              Every adapter implements chat,
              <br />
              streaming, and <span className="fxz-gradient-word">tools</span>.
            </h2>
            <p className="mt-4 text-[15px] text-[#9c9c9d] leading-relaxed">
              A lean OpenAI-compatible gateway over free native providers.
              Canonical model IDs, structured errors, per-provider health —
              and now a complete tool-calling pipeline.
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-14">
            {[
              { value: String(MODEL_COUNT), label: "free models" },
              { value: String(PROVIDER_COUNT), label: "native providers" },
              { value: String(STREAMING_COUNT), label: "true streaming" },
              { value: String(TOOLS_COUNT), label: "tool-calling models" },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-5 py-6 text-center"
              >
                <p
                  className="text-3xl font-semibold text-white"
                  style={{ fontFamily: "var(--font-body), sans-serif" }}
                >
                  {s.value}
                </p>
                <p className="text-xs text-[#9c9c9d] mt-1.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Bento features */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 lg:auto-rows-fr">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className={`group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 hover:border-[#ff6b4a]/30 transition-colors ${
                  f.wide ? "md:col-span-2" : ""
                }`}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.08] text-[#ff6b4a] mb-4">
                  <f.icon className="h-4.5 w-4.5" strokeWidth={1.75} style={{ width: 18, height: 18 }} />
                </span>
                <h3
                  className="text-base font-semibold text-white mb-2 tracking-tight"
                  style={{ fontFamily: "var(--font-body), sans-serif" }}
                >
                  {f.title}
                </h3>
                <p className="text-[13px] text-[#9c9c9d] leading-relaxed">{f.desc}</p>
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(circle at top right, rgba(255,47,58,0.09), transparent 70%)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────────────────────────────────────────────────────
          QUICK START (curl, mono, warm-tinted panel)
          ─────────────────────────────────────────────────────────────────── */}
      <section id="quickstart" className="relative py-20 px-6 border-t border-white/[0.05]">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-10">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-[#ff6b4a] mb-3">
              Quick start
            </p>
            <h2
              className="text-3xl font-semibold text-white tracking-tight"
              style={{ fontFamily: "var(--font-body), sans-serif" }}
            >
              Point any OpenAI client at the gateway.
            </h2>
            <p className="mt-3 text-sm text-[#9c9c9d]">
              Streaming + tools, exactly like the spec you already use.
            </p>
          </div>

          <div className="fxz-cmdbar overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff2f3a]/70" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff6b4a]/70" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ffb347]/70" />
              </div>
              <span
                className="text-[10px] uppercase tracking-[0.15em] text-[#9c9c9d]"
                style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
              >
                curl · bash
              </span>
            </div>
            <pre
              className="overflow-x-auto px-5 py-5 text-[12px] leading-relaxed text-zinc-200"
              style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
            >
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
          CTA + FOOTER (sticky bottom via mt-auto)
          ─────────────────────────────────────────────────────────────────── */}
      <section className="relative py-20 px-6 text-center border-t border-white/[0.05]">
        <div className="mx-auto max-w-2xl">
          <h2
            className="text-4xl md:text-5xl font-semibold tracking-tight text-white mb-5"
            style={{ fontFamily: "var(--font-body), sans-serif" }}
          >
            Ready to <span className="fxz-gradient-word">build?</span>
          </h2>
          <p className="text-[15px] text-[#9c9c9d] mb-8">
            {MODEL_COUNT} models are waiting. No key, no account, no setup.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/chat" className="fxz-keycap">
              <ChatGlyph />
              Start chatting
            </Link>
            <a href="#quickstart" className="fxz-ghost-pill">
              View the API
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-white/[0.06] bg-black/40">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#7c7c7f]">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px]"
              style={{ background: "linear-gradient(135deg, #ff2f3a 0%, #ff6b4a 60%, #ffb347 100%)" }}
              aria-hidden="true"
            />
            <span className="text-zinc-400">FreeAIXYZ — free AI gateway</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/chat" className="hover:text-zinc-200 transition-colors">Playground</Link>
            <Link href="/models" className="hover:text-zinc-200 transition-colors">Models</Link>
            <Link href="/docs" className="hover:text-zinc-200 transition-colors">Docs</Link>
            <a href="/api/v1/models" className="hover:text-zinc-200 transition-colors">API</a>
          </div>
          <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
            GET /health · GET /ready
          </span>
        </div>
      </footer>
    </div>
  );
}
