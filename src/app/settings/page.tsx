"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Settings as SettingsIcon,
  Check,
  ExternalLink,
  Server,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  ShieldCheck,
  Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { useTheme } from "next-themes";

const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export default function SettingsPage() {
  const mounted = useMounted();
  const { theme, setTheme } = useTheme();

  return (
    <div className="relative min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute h-[55vh] w-[55vh] -top-[10%] -left-[10%] rounded-full bg-[#8B5CF6]/10 blur-3xl animate-clay-float" />
        <div className="absolute h-[45vh] w-[45vh] -right-[10%] bottom-[10%] rounded-full bg-[#EC4899]/10 blur-3xl animate-clay-float-delayed animation-delay-2000" />
      </div>

      <Nav />

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 space-y-8">
        {/* Appearance */}
        <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-6 sm:p-8 shadow-clay-card space-y-5 border border-primary/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-clay-button">
              <SettingsIcon className="h-5 w-5 text-white" />
            </div>
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: "var(--font-brand), sans-serif" }}
            >
              Appearance
            </h2>
          </div>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Choose how the platform looks and feels.</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { value: "light", icon: Sun, label: "Light", color: "from-amber-400 to-amber-600" },
                { value: "dark", icon: Moon, label: "Dark", color: "from-indigo-400 to-indigo-600" },
                { value: "system", icon: Monitor, label: "System", color: "from-sky-400 to-sky-600" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex flex-col items-center gap-3 rounded-[24px] p-5 transition-all duration-300 ${
                    theme === opt.value
                      ? "bg-gradient-to-br from-purple-400/15 to-purple-600/10 text-primary shadow-clay-pressed border border-primary/20"
                      : "bg-white/40 dark:bg-[#2D2440]/40 text-muted-foreground shadow-clay-card hover:-translate-y-1 hover:shadow-clay-card-hover border border-primary/5"
                  }`}
                >
                  <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${opt.color} flex items-center justify-center shadow-clay-button`}>
                    <opt.icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Free models info */}
        <div className="rounded-[32px] bg-gradient-to-br from-purple-400/10 to-purple-600/5 p-6 sm:p-8 shadow-clay-card space-y-4 border border-primary/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-clay-button">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: "var(--font-brand), sans-serif" }}
            >
              All models are free
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every model on this platform works without any API key or signup.
            The gateway handles token rotation, identity generation, and API
            key management automatically behind the scenes.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5 rounded-[20px] px-3">
              Web Search: automatic
            </Badge>
            <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5 rounded-[20px] px-3">
              Music Gen: automatic
            </Badge>
            <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5 rounded-[20px] px-3">
              Free LLMs: no signup
            </Badge>
          </div>
        </div>

        {/* Provider Status Overview */}
        <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-6 sm:p-8 shadow-clay-card space-y-4 border border-primary/5">
          <h2
            className="text-xl font-bold flex items-center gap-3"
            style={{ fontFamily: "var(--font-brand), sans-serif" }}
          >
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-clay-button">
              <Server className="h-5 w-5 text-white" />
            </div>
            Provider Status
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { name: "Toolbaz", models: 18, auth: "Token rotation", color: "from-purple-400 to-purple-600" },
              { name: "FreeGPT.tech", models: 50, auth: "WASM + PoW", color: "from-pink-400 to-pink-600" },
              { name: "OpenCode.ai", models: 8, auth: "None", color: "from-sky-400 to-sky-600" },
              { name: "Kilo Code", models: 16, auth: "None", color: "from-emerald-400 to-emerald-600" },
              { name: "SurfSense", models: 2, auth: "None", color: "from-amber-400 to-amber-600" },
              { name: "UnlimitedAI", models: 2, auth: "None", color: "from-cyan-400 to-cyan-600" },
              { name: "LLM7.io", models: 5, auth: "None", color: "from-indigo-400 to-indigo-600" },
              { name: "AuroraAI", models: 1, auth: "Random x-local-id", color: "from-violet-400 to-violet-600" },
              { name: "JollyGen", models: 1, auth: "Random guest_hash", color: "from-rose-400 to-rose-600" },
              { name: "Pollinations", models: 1, auth: "None", color: "from-fuchsia-400 to-fuchsia-600" },
              { name: "SpicyWriter", models: 2, auth: "Random anon id", color: "from-orange-400 to-orange-600" },
              { name: "FreeAI4All", models: 8, auth: "Self-healing nonces", color: "from-teal-400 to-teal-600" },
              { name: "Swarm", models: 7, auth: "None", color: "from-lime-400 to-lime-600" },
              { name: "FreeChat", models: 1, auth: "None", color: "from-pink-400 to-pink-600" },
              { name: "Miklium", models: 5, auth: "None", color: "from-sky-400 to-sky-600" },
            ].map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between rounded-[24px] bg-white/40 dark:bg-[#2D2440]/40 px-4 py-3 shadow-clay-card hover:-translate-y-1 hover:shadow-clay-card-hover transition-all duration-300 border border-primary/5"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${p.color} flex items-center justify-center shadow-clay-button shrink-0`}>
                    <Server className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div>
                    <span className="text-sm font-bold" style={{ fontFamily: "var(--font-brand), sans-serif" }}>{p.name}</span>
                    <span className="text-[10px] text-muted-foreground block">{p.auth}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{p.models}</span>
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/5 text-[9px] rounded-[16px]">
                    active
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Music Generation Info */}
        <div className="rounded-[32px] bg-white/60 dark:bg-[#2D2440]/60 backdrop-blur-xl p-6 sm:p-8 shadow-clay-card space-y-4 border border-primary/5">
          <h2
            className="text-xl font-bold flex items-center gap-3"
            style={{ fontFamily: "var(--font-brand), sans-serif" }}
          >
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-pink-400 to-pink-600 flex items-center justify-center shadow-clay-button">
              <Music className="h-5 w-5 text-white" />
            </div>
            Music Generation
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            AI music generation via ACE-Step 1.5 is available at:
          </p>
          <code className="block text-sm text-primary bg-primary/5 border border-primary/10 rounded-[20px] px-4 py-3 font-semibold" style={{ fontFamily: "var(--font-code), monospace" }}>
            POST /api/v1/music/generate
          </code>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Params: prompt, lyrics, duration, language, instrumental, bpm, key, seed, sampleMode, batchSize.
            The API key is auto-fetched per request — no user input needed.
          </p>
        </div>

        <div className="flex justify-center">
          <a
            href="/models"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-[20px] bg-gradient-to-br from-[#A78BFA] to-[#7C3AED] text-white font-bold tracking-wide shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover active:scale-[0.92] active:shadow-clay-pressed transition-all duration-200"
          >
            View all models <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </main>

      <footer className="mt-auto border-t border-primary/5 bg-white/40 dark:bg-[#1A1625]/40 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6">
          <span className="text-xs text-muted-foreground font-medium">
            FreeAI4All Gateway · All models free, no key required
          </span>
        </div>
      </footer>
    </div>
  );
}
