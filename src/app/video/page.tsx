"use client";

/**
 * Video Studio — Coming Soon (providers removed).
 */

import Link from "next/link";
import { VideoIcon, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Nav } from "@/components/nav";

export default function VideoStudioPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F5F0FA] dark:bg-[#1A1225]">
      <Nav />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center space-y-6">
          {/* Icon */}
          <div className="mx-auto w-20 h-20 rounded-[28px] bg-gradient-to-br from-amber-400/20 to-amber-600/10 flex items-center justify-center shadow-clay-card border border-amber-500/20">
            <VideoIcon className="h-10 w-10 text-amber-500" />
          </div>

          {/* Title */}
          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
              Video Studio
            </h1>
            <p className="text-muted-foreground text-base">
              AI Video Generation is temporarily unavailable
            </p>
          </div>

          {/* Status Card */}
          <div className="rounded-[24px] bg-white/70 dark:bg-[#2D2440]/70 backdrop-blur-xl p-6 shadow-clay-card border border-amber-500/15 space-y-4">
            <div className="flex items-center justify-center gap-2 text-amber-500">
              <Clock className="h-5 w-5" />
              <span className="font-bold text-sm uppercase tracking-wider">Coming Soon</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Previously supported video providers (Dreemy.ai and NSFW Gateway) have been removed.
              Dreemy guests no longer receive free credits. We&apos;re working on adding new free video generation providers.
            </p>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span>Dreemy.ai — removed (guests have 0 credits)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span>NSFW Gateway — removed (BYOK-only, unreliable)</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/image">
              <Button className="rounded-[20px] bg-gradient-to-br from-amber-400 to-amber-600 text-white font-bold shadow-clay-button hover:-translate-y-1 hover:shadow-clay-button-hover transition-all duration-200">
                <VideoIcon className="h-4 w-4 mr-2" />
                Try Image Studio
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="rounded-[20px] font-bold shadow-clay-button hover:-translate-y-1 transition-all duration-200">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back Home
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-4 text-center text-xs text-muted-foreground border-t border-border/30">
        FreeAI4All — Free AI Inference Platform
      </footer>
    </div>
  );
}
