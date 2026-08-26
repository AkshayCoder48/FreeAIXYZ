"use client";

/**
 * HeroGraphic — animated abstract hero illustration (right column).
 *
 * Pure CSS + framer-motion continuous animations:
 *  - rotating dashed ring (`animate-spin-slow` = 60s linear infinite)
 *  - floating cards (`animate-float` 5s ease-in-out ±10px)
 *  - geometric shapes (square + triangle accents)
 *  - dot grid 3×3
 *  - corner accent block
 *
 * Respects `prefers-reduced-motion: reduce` via the global CSS rule that
 * disables the continuous animations when reduced motion is requested.
 */
import * as React from "react";
import { motion } from "framer-motion";
import { Activity, Server, Zap } from "lucide-react";

export function HeroGraphic() {
  return (
    <div
      aria-hidden
      className="relative aspect-square w-full max-w-[480px] mx-auto hidden lg:block"
    >
      {/* Outer rotating dashed ring */}
      <motion.div
        className="absolute inset-0 rounded-full border-2 border-dashed border-accent/40"
        animate={{ rotate: 360 }}
        transition={{
          duration: 60,
          repeat: Infinity,
          ease: "linear",
        }}
        style={{ willChange: "transform" }}
      />

      {/* Inner static ring */}
      <div className="absolute inset-[10%] rounded-full border border-border bg-card/40 backdrop-blur-sm" />

      {/* Center pulsing core */}
      <motion.div
        className="absolute inset-[35%] rounded-full bg-gradient-to-br from-[#0052FF] to-[#4D7CFF] shadow-accent-lg flex items-center justify-center"
        animate={{
          scale: [1, 1.05, 1],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <Activity className="h-8 w-8 text-white" strokeWidth={2} />
      </motion.div>

      {/* Floating card 1 — top left */}
      <motion.div
        className="absolute top-[8%] left-[2%] rounded-xl border border-border bg-card p-3 shadow-accent"
        animate={{ y: [0, -10, 0] }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Server className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <div
              className="text-[10px] uppercase tracking-wider text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              providers
            </div>
            <div
              className="text-sm font-bold text-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              17
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating card 2 — bottom right */}
      <motion.div
        className="absolute bottom-[10%] right-[2%] rounded-xl border border-border bg-card p-3 shadow-accent"
        animate={{ y: [0, -14, 0] }}
        transition={{
          duration: 7,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Zap className="h-4 w-4" strokeWidth={2} />
          </span>
          <div>
            <div
              className="text-[10px] uppercase tracking-wider text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              ttft
            </div>
            <div
              className="text-sm font-bold text-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              872ms
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating card 3 — top right (small) */}
      <motion.div
        className="absolute top-[18%] right-[12%] rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5"
        animate={{ y: [0, -8, 0] }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      >
        <span
          className="text-[10px] font-medium text-accent"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          au/llama3-8b
        </span>
      </motion.div>

      {/* Dot grid 3×3 — bottom left */}
      <div className="absolute bottom-[15%] left-[12%] grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-accent/50"
          />
        ))}
      </div>

      {/* Corner accent block — top right */}
      <div className="absolute top-[2%] right-[5%] h-10 w-10 rounded-md bg-gradient-to-br from-[#0052FF] to-[#4D7CFF] opacity-80 shadow-accent" />

      {/* Triangle accent — bottom left */}
      <div
        className="absolute bottom-[2%] left-[20%] h-0 w-0"
        style={{
          borderLeft: "8px solid transparent",
          borderRight: "8px solid transparent",
          borderBottom: "12px solid var(--accent)",
          opacity: 0.7,
        }}
      />
    </div>
  );
}
