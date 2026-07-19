"use client";

import { useState, useSyncExternalStore } from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Check,
  ExternalLink,
  ArrowLeft,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { toast } from "sonner";

export default function SettingsPage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(44,224,128,0.10), transparent 70%)",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[#2ce080]/10 border border-[#2ce080]/30 flex items-center justify-center">
                <SettingsIcon className="h-4 w-4 text-[#2ce080]" />
              </div>
              <span className="text-sm font-semibold">Settings</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-4xl w-full px-4 sm:px-6 py-10 space-y-8">
        {/* No keys needed banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-[#2ce080]/30 bg-[#2ce080]/5 p-6 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-[#2ce080]" />
            <h2 className="text-lg font-semibold">No API keys needed!</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            All 45 models across 10 providers work without any user authentication.
            The gateway handles all token rotation, identity generation, and API key
            management automatically. Just pick a model and start chatting.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="outline" className="border-[#2ce080]/30 text-[#2ce080] bg-[#2ce080]/5">
              Web Search: automatic
            </Badge>
            <Badge variant="outline" className="border-[#2ce080]/30 text-[#2ce080] bg-[#2ce080]/5">
              Music Gen: automatic
            </Badge>
            <Badge variant="outline" className="border-[#2ce080]/30 text-[#2ce080] bg-[#2ce080]/5">
              All LLM models: no signup
            </Badge>
          </div>
        </motion.div>

        {/* Provider Status Overview */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-3"
        >
          <h2 className="text-lg font-semibold">Provider Status</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { name: "Toolbaz", models: 18, auth: "Token rotation" },
              { name: "HeckAI", models: 7, auth: "None" },
              { name: "Kilo Code", models: 9, auth: "None" },
              { name: "Web Search", models: 2, auth: "Auto (Google)" },
              { name: "SurfSense", models: 2, auth: "None" },
              { name: "UnlimitedAI", models: 2, auth: "None" },
              { name: "LLM7.io", models: 2, auth: "None" },
              { name: "NSFWLover", models: 1, auth: "Random x-local-id" },
              { name: "JollyGen", models: 1, auth: "Random guest_hash" },
              { name: "Pollinations", models: 1, auth: "None" },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2">
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground block">{p.auth}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{p.models} models</span>
                  <Badge
                    variant="outline"
                    className="border-[#2ce080]/30 text-[#2ce080] bg-[#2ce080]/5 text-[9px]"
                  >
                    active
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Music Generation Info */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-border bg-card/50 backdrop-blur p-6 space-y-3"
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="h-5 w-5 text-[#2ce080]" /> Music Generation
          </h2>
          <p className="text-sm text-muted-foreground">
            AI music generation via ACE-Step 1.5 is available at:
          </p>
          <code className="block text-xs text-[#2ce080] bg-[#2ce080]/5 border border-[#2ce080]/15 rounded-md px-3 py-2">
            POST /api/v1/music/generate
          </code>
          <p className="text-xs text-muted-foreground">
            Params: prompt, lyrics, duration, language, instrumental, bpm, key, seed, sampleMode, batchSize.
            The API key is auto-fetched per request — no user input needed.
          </p>
        </motion.div>

        <div className="flex justify-center">
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/models">
              View all models <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6">
          <span className="text-xs text-muted-foreground">
            FreeGPT Gateway · 45 models · 10 providers · No signup required
          </span>
        </div>
      </footer>
    </div>
  );
}
