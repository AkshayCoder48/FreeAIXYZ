import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * GradientText — accent span with `bg-clip-text text-transparent`.
 *
 * Use to highlight accent words in headlines (e.g. "Open
 * <GradientText>playground</GradientText>").
 */
interface GradientTextProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export function GradientText({
  children,
  className,
  ...props
}: GradientTextProps) {
  return (
    <span
      className={cn(
        "bg-clip-text text-transparent bg-gradient-to-r from-[#0052FF] to-[#4D7CFF]",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
