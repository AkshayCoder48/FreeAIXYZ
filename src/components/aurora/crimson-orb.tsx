"use client";

/**
 * CrimsonOrb — the HyperDimension AI hero motif (Stitch "Crimson Orb" kit).
 *
 * A LIGHTWEIGHT living orb: layered CSS radial gradients (static underpaint
 * that renders even without JS) + a tiny 2D <canvas> that paints the animated
 * incandescent core, breathing halo, and orbiting ember arcs.
 *
 * Performance contract (a perf pass follows this task):
 *   - NO WebGL, NO shaders, NO dependencies — ~5 radial gradients + 3 arcs
 *     per frame on a 2D context.
 *   - requestAnimationFrame runs ONLY while the canvas is intersecting the
 *     viewport (IntersectionObserver) AND the page is visible
 *     (visibilitychange) — idle otherwise (0 frames painted).
 *   - prefers-reduced-motion → one static frame, never loops.
 *   - devicePixelRatio capped at 1.5; buffer synced via ResizeObserver.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface EmberArc {
  r: number;
  speed: number;
  span: number;
  phase: number;
  color: string;
  width: number;
}

const EMBER_ARCS: EmberArc[] = [
  { r: 0.88, speed: 0.22, span: 2.1, phase: 0.0, color: "rgba(255,133,13,0.16)", width: 0.22 },
  { r: 0.94, speed: -0.15, span: 1.4, phase: 2.2, color: "rgba(255,42,85,0.14)", width: 0.16 },
  { r: 0.78, speed: 0.09, span: 0.9, phase: 4.0, color: "rgba(255,186,39,0.10)", width: 0.10 },
];

/** Paint one frame of the orb (all cheap radial gradients + 3 stroked arcs). */
function paintOrb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = (Math.min(w, h) / 2) * 0.82;
  if (R <= 1) return;
  const tt = t / 1000;

  // Slow breathing + gentle wobble of the light source.
  const breathe = 1 + 0.025 * Math.sin(tt * 0.7);
  const wobX = Math.sin(tt * 0.5) * R * 0.03;
  const wobY = Math.cos(tt * 0.38) * R * 0.03;

  // 1) Crimson halo bloom behind the body.
  let g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.65);
  g.addColorStop(0, "rgba(255,42,85,0.34)");
  g.addColorStop(0.45, "rgba(255,133,13,0.12)");
  g.addColorStop(0.75, "rgba(92,0,26,0.10)");
  g.addColorStop(1, "rgba(92,0,26,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 2) Orb body — incandescent core → crimson → wine → void.
  const lx = cx - R * 0.3 + wobX;
  const ly = cy - R * 0.34 + wobY;
  g = ctx.createRadialGradient(lx, ly, 0, cx, cy, R * breathe);
  g.addColorStop(0, "rgba(255,244,226,0.95)");
  g.addColorStop(0.1, "rgba(255,204,150,0.92)");
  g.addColorStop(0.24, "rgba(255,133,13,0.88)");
  g.addColorStop(0.48, "rgba(255,42,85,0.92)");
  g.addColorStop(0.72, "rgba(146,0,42,0.88)");
  g.addColorStop(0.92, "rgba(44,2,11,0.75)");
  g.addColorStop(1, "rgba(12,14,19,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.02 * breathe, 0, Math.PI * 2);
  ctx.fill();

  // 3) Orbiting ember arcs (additive blend).
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const a of EMBER_ARCS) {
    const start = a.phase + tt * a.speed;
    ctx.beginPath();
    ctx.arc(cx, cy, a.r * R * breathe, start, start + a.span);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.width * R;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();

  // 4) Breathing incandescent core highlight.
  const pulse = 0.5 + 0.5 * Math.sin(tt * 1.1);
  g = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 0.34 * (0.9 + 0.14 * pulse));
  g.addColorStop(0, `rgba(255,248,238,${(0.5 + 0.25 * pulse).toFixed(3)})`);
  g.addColorStop(0.5, "rgba(255,190,120,0.22)");
  g.addColorStop(1, "rgba(255,133,13,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(lx, ly, R * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

export function CrimsonOrb({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let raf = 0;
    let running = false;
    let inView = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      if (reduced) paintOrb(ctx, canvas.width, canvas.height, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const loop = (t: number) => {
      if (!running) return;
      paintOrb(ctx, canvas.width, canvas.height, t);
      raf = requestAnimationFrame(loop);
    };

    /** Start the rAF loop only when visible + not reduced-motion. */
    const sync = () => {
      const shouldRun = inView && !document.hidden && !reduced;
      if (shouldRun && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };

    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          inView = entries.some((e) => e.isIntersecting);
          sync();
        })
      : null;
    io?.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div className={cn("fxz-orb", className)} aria-hidden="true">
      <div className="fxz-orb-halo" />
      <div className="fxz-orb-body" />
      <canvas ref={canvasRef} />
    </div>
  );
}
