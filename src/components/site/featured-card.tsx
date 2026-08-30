import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FeaturedCard — gradient-border card.
 *
 * Outer: `bg-gradient-to-br p-[2px] from-[#0052FF] via-[#4D7CFF] to-[#0052FF]`
 * Inner: `bg-card rounded-[calc(12px-2px)]`
 */
interface FeaturedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Optional: padding inside the inner card. Default p-6. */
  innerClassName?: string;
}

export function FeaturedCard({
  children,
  className,
  innerClassName,
  ...props
}: FeaturedCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl bg-gradient-to-br p-[2px] from-[#0052FF] via-[#4D7CFF] to-[#0052FF]",
        "shadow-accent",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "relative rounded-[calc(12px-2px)] bg-card p-6",
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
