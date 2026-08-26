import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * GradientButton — primary CTA.
 *
 * - Gradient bg `from-[#0052FF] to-[#4D7CFF]`, white text
 * - shadow-accent on hover, -translate-y-0.5 lift, active:scale-[0.98]
 * - Minimum h-12 touch target, h-14 for size lg
 */
const gradientButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-medium text-white transition-all duration-200",
  {
    variants: {
      size: {
        default: "h-12 px-6 text-sm",
        lg: "h-14 px-8 text-base",
        sm: "h-10 px-4 text-sm",
        icon: "h-12 w-12",
      },
      variant: {
        default:
          "bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] shadow-[0_2px_8px_rgba(0,82,255,0.18)] hover:shadow-accent hover:-translate-y-0.5 active:scale-[0.98]",
        outline:
          "border-2 border-accent bg-transparent text-accent hover:bg-accent hover:text-white hover:shadow-accent hover:-translate-y-0.5 active:scale-[0.98]",
        ghost:
          "bg-transparent text-accent hover:bg-accent/10 active:scale-[0.98]",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  },
);

interface GradientButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof gradientButtonVariants> {
  asChild?: boolean;
}

export function GradientButton({
  className,
  size,
  variant,
  asChild = false,
  ...props
}: GradientButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="gradient-button"
      className={cn(
        gradientButtonVariants({ size, variant }),
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export { gradientButtonVariants };
