import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * InvertedSection — `bg-[#0F172A] text-white` with subtle dot pattern overlay
 * (`radial-gradient(circle, white 1px, transparent 1px)` at 32px intervals,
 * `opacity: 0.03`) and corner radial glow.
 *
 * Use for the STATS BAR on the landing page and any other dramatic inverted
 * accent section.
 */
interface InvertedSectionProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  /** Use `as` to render as a different element (default `section`). */
  as?: keyof React.JSX.IntrinsicElements;
  /** Disable the corner radial glow. */
  noGlow?: boolean;
  /** Disable the dot pattern overlay. */
  noDots?: boolean;
}

export function InvertedSection({
  children,
  className,
  as = "section",
  noGlow,
  noDots,
  ...props
}: InvertedSectionProps) {
  const Comp = as as React.ElementType;
  return (
    <Comp
      className={cn(
        "relative overflow-hidden bg-[#0F172A] text-white",
        !noGlow && "glow-corner",
        className,
      )}
      {...props}
    >
      {!noDots && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 dot-pattern opacity-[0.03]"
        />
      )}
      <div className="relative z-10">{children}</div>
    </Comp>
  );
}
