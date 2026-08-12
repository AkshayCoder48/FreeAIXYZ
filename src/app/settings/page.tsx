"use client";

import { useState, useSyncExternalStore } from "react";
import {
  Settings as SettingsIcon,
  ExternalLink,
  Server,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  Music,
  VideoIcon,
} from "lucide-react";
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
      <Nav />

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 space-y-8">
        {/* Appearance */}
        <div className="border border-foreground p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <SettingsIcon className="h-5 w-5 text-foreground" />
            </div>
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              Appearance
            </h2>
          </div>
          <div className="space-y-3">
            <p
              className="text-sm text-foreground/50"
              style={{ fontFamily: "var(--font-body), serif" }}
            >
              Choose how the platform looks and feels.
            </p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { value: "light", icon: Sun, label: "Light" },
                { value: "dark", icon: Moon, label: "Dark" },
                { value: "system", icon: Monitor, label: "System" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex flex-col items-center gap-3 p-5 transition-colors duration-100 ${
                    theme === opt.value
                      ? "bg-foreground text-background border-2 border-foreground"
                      : "bg-background text-foreground border border-foreground hover:bg-foreground/5"
                  }`}
                >
                  <div className="h-10 w-10 border border-current flex items-center justify-center">
                    <opt.icon className="h-5 w-5" />
                  </div>
                  <span
                    className="text-sm font-bold"
                    style={{ fontFamily: "var(--font-brand), serif" }}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Free models info */}
        <div className="border border-foreground p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-foreground" />
            </div>
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              All models are free
            </h2>
          </div>
          <p
            className="text-sm text-foreground/50 leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            Every model on this platform works without any API key or signup.
            The gateway handles token rotation, identity generation, and API
            key management automatically behind the scenes.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <span
              className="border border-foreground/30 text-foreground/70 text-[9px] uppercase tracking-widest px-3 py-1"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              Web Search: automatic
            </span>
            <span
              className="border border-foreground/30 text-foreground/70 text-[9px] uppercase tracking-widest px-3 py-1"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              Music Gen: automatic
            </span>
            <span
              className="border border-foreground/30 text-foreground/70 text-[9px] uppercase tracking-widest px-3 py-1"
              style={{ fontFamily: "var(--font-code), monospace" }}
            >
              Free LLMs: no signup
            </span>
          </div>
        </div>

        {/* Provider Status Overview */}
        <div className="border border-foreground p-6 sm:p-8 space-y-4">
          <h2
            className="text-xl font-bold flex items-center gap-3"
            style={{ fontFamily: "var(--font-brand), serif" }}
          >
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <Server className="h-5 w-5 text-foreground" />
            </div>
            Provider Status
          </h2>
          <div className="divide-y divide-foreground/10">
            {[
              { name: "Toolbaz", models: 18, auth: "Token rotation" },
              { name: "FreeGPT.tech", models: 50, auth: "WASM + PoW" },
              { name: "OpenCode.ai", models: 8, auth: "None" },
              { name: "Kilo Code", models: 16, auth: "None" },
              { name: "SurfSense", models: 2, auth: "None" },
              { name: "UnlimitedAI", models: 2, auth: "None" },
              { name: "LLM7.io", models: 5, auth: "None" },
              { name: "AuroraAI", models: 1, auth: "Random x-local-id" },
              { name: "JollyGen", models: 1, auth: "Random guest_hash" },
              { name: "Pollinations", models: 1, auth: "None" },
              { name: "SpicyWriter", models: 2, auth: "Random anon id" },
              { name: "FreeAI4All", models: 8, auth: "Self-healing nonces" },
              { name: "Swarm", models: 7, auth: "None" },
              { name: "FreeChat", models: 1, auth: "None" },
              { name: "Miklium", models: 5, auth: "None" },
              { name: "GPT-OSS", models: 2, auth: "None" },
              { name: "Vexa AI", models: 2, auth: "None" },
              { name: "Casper Tech", models: 2, auth: "None" },
            ].map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between py-3 transition-colors duration-100 hover:bg-foreground/5"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 border border-foreground flex items-center justify-center shrink-0">
                    <Server className="h-3.5 w-3.5 text-foreground" />
                  </div>
                  <div>
                    <span
                      className="text-sm font-bold"
                      style={{ fontFamily: "var(--font-brand), serif" }}
                    >
                      {p.name}
                    </span>
                    <span
                      className="text-[10px] text-foreground/50 block"
                      style={{ fontFamily: "var(--font-code), monospace" }}
                    >
                      {p.auth}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs text-foreground/50"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    {p.models}
                  </span>
                  <span
                    className="border border-foreground/30 text-foreground/70 text-[9px] uppercase tracking-widest px-2 py-0.5"
                    style={{ fontFamily: "var(--font-code), monospace" }}
                  >
                    active
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Music Generation Info */}
        <div className="border border-foreground p-6 sm:p-8 space-y-4">
          <h2
            className="text-xl font-bold flex items-center gap-3"
            style={{ fontFamily: "var(--font-brand), serif" }}
          >
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <Music className="h-5 w-5 text-foreground" />
            </div>
            Music Generation
          </h2>
          <p
            className="text-sm text-foreground/50 leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            AI music generation via ACE-Step 1.5 is available at:
          </p>
          <code
            className="block text-sm text-foreground border border-foreground/20 px-4 py-3 font-semibold"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
            POST /api/v1/music/generate
          </code>
          <p
            className="text-xs text-foreground/50 leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            Params: prompt, lyrics, duration, language, instrumental, bpm, key, seed, sampleMode, batchSize.
            The API key is auto-fetched per request — no user input needed.
          </p>
        </div>

        {/* Video Generation Info */}
        <div className="border border-foreground p-6 sm:p-8 space-y-4">
          <h2
            className="text-xl font-bold flex items-center gap-3"
            style={{ fontFamily: "var(--font-brand), serif" }}
          >
            <div className="h-10 w-10 border border-foreground flex items-center justify-center">
              <VideoIcon className="h-5 w-5 text-foreground" />
            </div>
            Video Generation
          </h2>
          <p
            className="text-sm text-foreground/50 leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            Video generation is currently unavailable. Previously supported providers have been removed. We&apos;re working on adding new free video generation providers.
          </p>
          <code
            className="block text-sm text-foreground border border-foreground/20 px-4 py-3 font-semibold"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
            POST /api/v1/video/generate
          </code>
          <p
            className="text-xs text-foreground/50 leading-relaxed"
            style={{ fontFamily: "var(--font-body), serif" }}
          >
            This endpoint currently returns 503 (Service Unavailable). Check back later for updates.
          </p>
        </div>

        <div className="flex justify-center">
          <a
            href="/models"
            className="inline-flex items-center gap-2 h-12 px-6 bg-foreground text-background uppercase tracking-widest text-sm hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground transition-colors duration-100"
          >
            View all models <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </main>

      <footer className="mt-auto border-t border-foreground/10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6">
          <span
            className="text-xs text-foreground/50 font-medium"
            style={{ fontFamily: "var(--font-code), monospace" }}
          >
            FreeAI4All Gateway · All models free, no key required
          </span>
        </div>
      </footer>
    </div>
  );
}
