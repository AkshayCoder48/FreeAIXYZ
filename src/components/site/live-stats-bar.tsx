"use client";

/**
 * LiveStatsBar — KPI row rendered inside an InvertedSection on the landing page.
 *
 * Receives static counts via props (from the native catalog — no fetch).
 * Renders 4 KPIs with gradient accent on the numbers:
 *   - Providers count
 *   - Models count
 *   - Streaming models
 *   - Free access
 */
import { motion } from "framer-motion";
import { Server, Cpu, Zap, BadgeCheck } from "lucide-react";

export interface LiveStats {
  providers: number;
  models: number;
  streamingModels: number;
}

interface Stat {
  label: string;
  value: string;
  icon: typeof Server;
  hint?: string;
}

export function LiveStatsBar({ stats: s }: { stats: LiveStats }) {
  const stats: Stat[] = [
    {
      label: "Providers",
      value: String(s.providers || "—"),
      icon: Server,
      hint: "native adapters",
    },
    {
      label: "Models",
      value: String(s.models || "—"),
      icon: Cpu,
      hint: "canonical ids",
    },
    {
      label: "Streaming",
      value: String(s.streamingModels || "—"),
      icon: Zap,
      hint: "token-by-token",
    },
    {
      label: "Access",
      value: "100%",
      icon: BadgeCheck,
      hint: "free · no API key",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 sm:py-16">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15, margin: "-60px" }}
            transition={{
              duration: 0.5,
              delay: i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="flex flex-col"
          >
            <div className="flex items-center gap-2 text-white/60 mb-2">
              <stat.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span
                className="text-[10px] font-medium uppercase tracking-[0.15em]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {stat.label}
              </span>
            </div>
            <div
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-[#4D7CFF] to-[#0052FF]"
              style={{ fontFamily: "var(--font-display), Georgia, serif" }}
            >
              {stat.value}
            </div>
            {stat.hint && (
              <div
                className="text-[10px] text-white/40 mt-1"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {stat.hint}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
