import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SectionLabel — rounded pill badge with pulsing dot + uppercase mono text.
 *
 * Use above section headings to mark a section ("LIVE METRICS", "PROVIDERS",
 * "QUICK START", etc.) with a subtle electric-blue accent.
 */
interface SectionLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional label text. If omitted, children is used. */
  children?: React.ReactNode;
  /** Color of the pulsing dot — defaults to accent. */
  dotColor?: string;
}

export function SectionLabel({
  children,
  className,
  dotColor,
  ...props
}: SectionLabelProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1",
        "text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground",
        "shadow-sm",
        className,
      )}
      style={{ fontFamily: "var(--font-mono), monospace" }}
      {...props}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full animate-pulse-dot"
        style={{ backgroundColor: dotColor ?? "var(--accent)" }}
      />
      {children}
    </span>
  );
}
