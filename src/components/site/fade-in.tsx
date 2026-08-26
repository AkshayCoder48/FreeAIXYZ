"use client";

/**
 * FadeIn — client-side wrapper around framer-motion's `whileInView` that
 * applies the `fadeInUp` variant + `stagger` from the design system.
 *
 * Use to wrap server-rendered children when a server component can't render
 * `motion.div` directly.
 */
import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

interface FadeInProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  /** Delay in seconds before the entrance animation runs. */
  delay?: number;
  /** Stagger between repeated items, in seconds. */
  stagger?: number;
  /** Index of this item within a staggered list (multiplied by stagger). */
  index?: number;
}

export function FadeIn({
  children,
  delay = 0,
  stagger = 0,
  index = 0,
  ...props
}: FadeInProps) {
  const computedDelay = delay + stagger * index;
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: "-60px" }}
      transition={{
        duration: 0.7,
        delay: computedDelay,
        ease: [0.16, 1, 0.3, 1],
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
