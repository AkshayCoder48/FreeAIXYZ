# Task 2-uikit — HyperDimension AI "Crimson Orb" UI kit application

Agent: full-stack-developer (UI kit)
Scope: UI only — src/app/**, src/components/**, tailwind.config.ts. No src/lib, prisma, scripts, package.json, next.config changes.

## What was done

Rebuilt the entire public UI into the "HyperDimension AI" design system extracted
from /home/z/my-project/download/uikit/stitch_3d_ai_interface_system (all 3
code.html files read fully).

### Design tokens (tailwind.config.ts — additive, shadcn vars untouched)
- `crimson` #ff2a55 (+deep #b80028, +glow rgba(255,42,85,.85), +soft)
- `ember` #ff850d (+soft #ffb68a, +deep)
- `gold` #ffba27 (+soft #ffdea9), `blush` #ffb68a, `rosy` #ffb3b6
- `hd.*` surface scale: ground #111319 · deep #0c0e13 · low #191c21 ·
  container #1d2025 · high #282a30 · highest #33353b · line #5d3f40
- boxShadow: crimson-glow / crimson-glow-lg / panel
- font-display fallback Georgia → sans (Space Grotesk is a sans display)

### globals.css
- :root/.dark remapped: background #111319, foreground #e2e2ea, primary
  #ff2a55, muted-foreground #e6bcbd (kit on-surface-variant), borders crimson
  hairlines, charts crimson/ember/gold.
- h1–h3 → Space Grotesk; crimson selection + scrollbars.
- ALL fxz-* classes restyled in place (names kept as the component API):
  panel→obsidian+crimson rim, chip→mono w/ crimson active, badge→pill +
  new `fxz-badge-ember`, code→crimson pill, keycap/nav-cta/send→crimson glow
  buttons (ember hover bloom), stop→dark slab, bubbles, tool chips, dots,
  icon tiles (+`fxz-icon-tile-ember`), docs set.
- Aurora blades REMOVED → new `.fxz-orb` CSS underpaint, `.fxz-glow-a/b`
  hero blobs, `.fxz-hd-backdrop` fixed ambient field + `.fxz-hd-backdrop-orb`
  (content pages, CSS-only, no canvas).

### New components
- `src/components/aurora/crimson-orb.tsx` — the orb motif. CSS gradient
  underpaint (works w/o JS) + tiny 2D canvas (5 radial gradients + 3 additive
  ember arcs + breathing core per frame). rAF gated on IntersectionObserver
  visibility + document visibility; prefers-reduced-motion → one static
  frame; DPR ≤1.5; ResizeObserver. No WebGL/deps.
- `src/components/aurora/quickstart-terminal.tsx` — hero terminal island:
  cURL/Python/Node tabs, kit syntax tints, copy button, real endpoint.

### Rebuilt pages
- `/` homepage: hero (ping badge, Space Grotesk headline + crimson gradient
  word, crimson CTA + frosted CTA, micro-spec checks), orb-crowned terminal,
  telemetry stats bar, Featured free models (4 obsidian cards, alternating
  crimson/ember rims), provider strip, features bento, deep quickstart
  (curl+tools), CTA banner, footer. Data source unchanged.
- `/chat`: playground RESTYLE ONLY (all SSE/tool/state logic untouched) +
  "STREAMING LIVE / READY FOR DISPATCH / STREAM COMPLETE" telemetry banner
  with live token counters; code theme oneDark → HYPERDIMENSION_THEME
  (no blue/indigo).
  **DONE-strip fix**: `stripTrailingDone()` = `replace(/\n+[ \t]*DONE[ \t\r\n]*$/, "")`
  applied in the ReactMarkdown render + copy button (display-only). 9/9 cases.
- `/models`, `/models/[provider]`, `/models/[provider]/[model]`: obsidian
  cards w/ alternating rims, mono crimson id pills, h-10 Try/copy targets.
- `/docs`: blocks/browser accents (crimson traffic lights, HyperDimension
  tokenizer: wine comments / blush strings / ember numbers / crimson keywords).
- shell.tsx: orb glyph + "HyperDimensionAI" wordmark + "Crimson Core Matrix"
  tagline, crimson-glass pill nav (structure + mobile menu preserved),
  sticky footer (min-h-screen flex flex-col + mt-auto) preserved.

## Verification
- `bunx tsc --noEmit` CLEAN · `bun run lint` CLEAN
- All routes 200 (/, /chat, /models, /models/[provider], /models/[provider]/[model], /docs)
- Zero browser console errors (agent-browser)
- VLM visual checks: desktop home (orb + terminal + nav OK), chat + models
  (banner/badges/cards/pills OK), 375px mobile full-page (stacked, readable,
  no overflow) — no white backgrounds, no blue/purple anywhere
- Live E2E: model select → send → SSE stream → "PONG" → STREAM COMPLETE;
  upstream-400 error path renders inline banner + Retry
- Orb canvas confirmed painting; rAF only-when-visible

## Notes for the next agent (perf pass)
- The orb canvas paints ≤8 draw ops/frame at ≤1.5 DPR; loop fully pauses when
  offscreen/hidden/reduced-motion — see crimson-orb.tsx.
- Content pages use CSS-only backdrop (`.fxz-hd-backdrop`) — the only canvas
  on the site is the homepage hero orb.
- `fxz-*` class names are the stable styling API — restyle values in
  globals.css, not the class names used across components.
