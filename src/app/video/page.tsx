"use client";

/**
 * Video Studio — Coming Soon (providers removed).
 * Minimalist Monochrome design system.
 */

import Link from "next/link";
import { VideoIcon, ArrowLeft, Clock } from "lucide-react";
import { Nav } from "@/components/nav";

export default function VideoStudioPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Nav />

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center space-y-6">
          {/* Icon */}
          <div className="mx-auto w-20 h-20 border border-foreground flex items-center justify-center">
            <VideoIcon className="h-10 w-10" />
          </div>

          {/* Title */}
          <div className="space-y-2">
            <h1
              className="text-3xl font-black tracking-tight"
              style={{ fontFamily: "var(--font-brand), serif" }}
            >
              Video Studio
            </h1>
            <p
              className="text-base"
              style={{ fontFamily: "var(--font-body), serif", color: "#525252" }}
            >
              AI Video Generation is temporarily unavailable
            </p>
          </div>

          {/* Status Card */}
          <div className="border border-foreground p-6 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Clock className="h-5 w-5" />
              <span
                className="text-sm uppercase tracking-widest"
                style={{ fontFamily: "var(--font-code), monospace" }}
              >
                Coming Soon
              </span>
            </div>
            <p
              className="text-sm leading-relaxed"
              style={{ fontFamily: "var(--font-body), serif", color: "#525252" }}
            >
              Previously supported video providers (Dreemy.ai and NSFW Gateway)
              have been removed. Dreemy guests no longer receive free credits.
              We&apos;re working on adding new free video generation providers.
            </p>
            <div
              className="flex flex-col gap-2 text-xs"
              style={{ fontFamily: "var(--font-code), monospace", color: "#525252" }}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-foreground" />
                <span>Dreemy.ai — removed (guests have 0 credits)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-foreground" />
                <span>NSFW Gateway — removed (BYOK-only, unreliable)</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/image"
              className="inline-flex items-center justify-center px-6 py-3 bg-foreground text-background uppercase tracking-widest text-sm hover:bg-background hover:text-foreground hover:border-2 hover:border-foreground transition-colors duration-100"
            >
              <VideoIcon className="h-4 w-4 mr-2" />
              Try Image Studio
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 border-2 border-foreground text-foreground hover:bg-foreground hover:text-background transition-colors duration-100"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back Home
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="mt-auto py-4 text-center text-xs border-t border-foreground"
        style={{ fontFamily: "var(--font-code), monospace", color: "#525252" }}
      >
        FreeAI4All — Free AI Inference Platform
      </footer>
    </div>
  );
}
