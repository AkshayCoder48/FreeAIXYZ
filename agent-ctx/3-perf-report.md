# Task 3-perf — Performance Overhaul Report

Full-codebase audit + optimization of the FreeAIXYZ gateway UI (HyperDimension
crimson theme preserved exactly — zero visual changes). Dev server was running
throughout; restarted ONCE at the end per the task constraints. All gates green:
`bunx tsc --noEmit` CLEAN, `bun run lint` CLEAN, `bun tests/run-tests.mjs` 10/10 PASS.

Phase-1 audit details: see `agent-ctx/3-perf-audit.md` (this report is the
summary + outcome).

---

## 1. Confirmed bottlenecks → FIXED

### F1. Per-delta setState → O(n²) markdown re-parse (THE lag source) — FIXED
**Where:** `src/components/playground/chat-playground-client.tsx`
**Was:** every SSE delta called `setMessages` (≈100×/s on fast streams; a long
Three.js-style answer = 2,000–3,000 re-renders). Each re-render re-parsed the
ENTIRE accumulated content with ReactMarkdown, re-rendered EVERY message bubble,
and — because the `components={{ code: … }}` prop was an inline object — gave
React a new `code` component TYPE per render, so every code block subtree was
unmounted + remounted (full Prism re-tokenize) per delta.
**Now:** streaming render throttle:
- Deltas append to generation-scoped local mirrors (`assistantContent` —
  pre-existing, still the fence detector's source of truth — + new
  `assistantReasoning`) immediately; state updates flush on an 80 ms cadence
  (`STREAM_FLUSH_MS`, setTimeout deduped via a pending flag) → ≤ ~12 setState
  and ≤ ~12 markdown re-parses per second regardless of delta rate.
- `flushNow()` (synchronous, cancels any pending timer) runs at every terminal
  transition: immediately after `readSseStream` returns (covers abort / error /
  tool-round boundary / completion), from `replaceContent` (fence strip), and
  from the `finally` block — the finished/cancelled/failed message is ALWAYS
  byte-exact; verified by aborting mid-stream in the browser (2,345 chars kept,
  mid-sentence, "stopped" state).
- SSE logic, abort, retry, tool-call accumulation/execution, and the emulated
  fence pipeline are untouched (they read the local mirror, not React state).
**UX unchanged:** text still appears live (~12 frames/s batch — the same cadence
ChatGPT-class UIs stream at).

### F2. Inline `components` prop → code-block remount churn — FIXED
`MARKDOWN_COMPONENTS` is now a module-level constant (`Components` from
react-markdown): stable `code` type identity → React updates code blocks in
place instead of unmount/remount per render. (Part of the same file.)

### F3. Every bubble re-rendered per delta/flush — FIXED
Per-message rendering extracted into `ChatMessageItem` (`React.memo`), with
stable props: the message object (identity preserved by the `prev.map` updates),
precomputed `copied` / `reasoningOpen` booleans, and stable callbacks
(`copyMessage` was already useCallback; new `toggleReasoningFor` useCallback).
During a stream ONLY the streaming bubble re-renders; in long conversations the
earlier turns' markdown is never re-parsed.

### F4. ~1 MB of Prism languages in the /chat client bundle — FIXED
`Prism` → `PrismAsyncLight` (same react-syntax-highlighter package — no new
dependency): ships `refractor/core` (~8 KB) instead of all ~300 language
definitions (~1.2 MB unminified / ≈250–300 KB gzipped out of the initial
payload). Each language lazy-loads as its own webpack chunk on first use and is
then cached — ALL languages still highlight (feature preserved). An idle-time
warm-up (requestIdleCallback, fallback setTimeout) preloads the core + 16 common
languages so the typical first code block is highlighted immediately.
Verified live: streamed TS code block rendered 58 Prism token spans, zero
console errors.

### F5. /models: all 87 cards re-rendered per search keystroke — FIXED
`ModelCard` (`React.memo`) in `src/components/explorer/models-catalog.tsx` with
stable model-object identities (static catalog → memoized `groups`) and stable
`copyId` callback. Keystrokes now re-render only the list containers.

### F6. Dead hello-world server function — REMOVED
`src/app/api/route.ts` (GET /api → `{"message":"Hello, world!"}`) deleted after
grep confirmed zero references anywhere (src, docs content, README, tests).
`GET /api` now 404s (with CORS headers, from the routing layer). This was the
only route removal — everything else on the inventory below truly exists.

### F7. next.config.ts gaps — FIXED
- `reactStrictMode: true` (was false) — dev-only double-effect invocation; all
  playground effects verified idempotent (guards + functional setState); zero
  production bundle impact.
- `poweredByHeader: false` — drops `X-Powered-By` from every response.
- `compress: true`, `productionBrowserSourceMaps: false` — pinned explicitly.
- NOT added (deliberate, documented): `output:'export'` (would kill the API
  routes — the gateway is the product), `experimental.staleTimes` (pages are
  already static; defaults already cache client navigations — no measured
  benefit), `optimizePackageImports` (lucide-react is already in Next 16's
  default optimized list; no other barrel imports in app code).
- Kept intact: standalone output (non-Vercel), /v1 rewrites, routing-layer CORS
  headers, webpack dev rationale comment, vercel.json semantics.

### F8. Static pages made explicitly static
`export const dynamic = "force-static"` added to `/` (`src/app/page.tsx`) and
`/models` (`src/app/models/page.tsx`) — they use no dynamic APIs; every page
route is now honestly static (chat/docs/provider/model pages already were).
Pages are prerendered at build → served from the CDN edge → zero Vercel
function invocations for page views.

---

## 2. Mission items investigated → confirmed NON-issues (nothing to do)

- **"Do /, /chat, /models each fetch /api/v1/models?"** — NO. Zero client-side
  model fetches exist in the app (grep-verified). All pages hydrate from the
  static RSC catalog (`src/lib/native-catalog.ts`) serialized as props. The only
  client fetches in the entire app are `POST /api/v1/chat/completions` and
  `POST /api/tools/execute` (both in the playground, both by design). A
  `models-cache.ts` dedup module would be dead code — not implemented.
- **The "typo'd duplicate route `src/app/models/[provider]/odel]/`"** — does
  NOT exist. It is a display artifact of the tooling (renders `[model]` as
  `odel]`; the task brief and the 2-uikit worklog both inherited it). Verified
  with `find | od -c`: the real directory is `[model]` — the legitimate
  model-detail page, linked from the catalog. Nothing removed.
- **Crimson orb animation hygiene** — verified good as-built: rAF only while
  IntersectionObserver-visible AND page visible (visibilitychange), reduced
  motion → single static frame, DPR capped 1.5. No WebGL/deps.
- **CSS animations** — all continuous keyframes have prefers-reduced-motion
  overrides; the only always-on animation is a 2 px `animate-ping` dot
  (compositor-only, negligible). Unused keyframe classes (~15 lines of CSS)
  flagged, left in place (design-system classes).
- **Long lists** — models catalog is one bounded mount pass (87 cards ≈ 2,200
  DOM nodes; per-provider pages already paginate at 24 + "Show more"); docs
  renders one page at a time; the playground Select caps at 30 items/group.
  After F5, keystroke cost is O(filter), not O(cards).

---

## 3. Suspected / flagged but NOT fixed (with reasons)

- **47 of 49 shadcn/ui components unused** (only button, card, select, sonner,
  textarea used): tree-shaken out of every production bundle (verified —
  webpack only bundles imported modules); they cost repo bytes only. Left in
  place per the standard-library policy (deleting would break future
  `shadcn add` flows).
- **Heavy package.json deps never imported by app code** (`framer-motion`,
  `recharts`, `@mdxeditor/editor`, `@dnd-kit/*`, `embla-carousel-react`,
  `react-day-picker`, `input-otp`, `vaul`, `@reactuses/core`, `date-fns`,
  `@tanstack/*`, `zod`, `react-hook-form`, `playwright`, …): never enter the
  client bundle (no importer → no bundle entry). Removal from package.json would
  shrink installs but risks breaking the unused shadcn components and dev
  tooling — flagged, not removed.
- **`ResponseAborted` unhandledRejection in dev.log** when a client aborts a
  stream (Stop button): reproduced with a raw curl abort — pre-existing Next
  16.1.3 dev-server artifact on client disconnect mid-stream, unrelated to this
  pass (the server route's proxy semantics are outside the change scope).
- **Radix Select uncontrolled→controlled dev warning** on first model
  auto-selection: pre-existing (value starts undefined until the auto-select
  effect runs), cosmetic, dev-only.

---

## 4. Vercel function inventory — every remaining route with its reason to exist

All API routes are honestly `dynamic` (they read in-memory gateway state or
proxy upstreams); no static-able API route exists. `runtime: "nodejs"` on all.

| Route | Exists because |
|---|---|
| `POST/OPTIONS /api/v1/chat/completions` | THE PRODUCT — OpenAI-compatible proxy over 25 upstream providers: CORS bypass, account rotation, auto-continuation, failover. Cannot run in the browser. `maxDuration: 300`. |
| `POST/OPTIONS /api/v1/chat/freegpt-proxy` | Internal streaming hop for the freegpt provider (child_process curl with 1800 s budget — Vercel clamps at 300). Called only by the completions route. |
| `POST/OPTIONS /api/v1/chat/freeaixyz-proxy` | Same for the freeaixyz provider (curl-based upstream; bypasses fetch/encoding issues). Internal hop. |
| `GET/OPTIONS /api/v1/models` | OpenAI-compatible model listing (documented product surface; `capabilities` array on every entry). |
| `GET/OPTIONS /api/v1/status` | Per-model/per-provider health snapshot (R-12, documented). |
| `POST/OPTIONS /api/tools/execute` | Tool executor for the playground's tool-calling pipeline (client fetches it; §7/§24/§25). |
| `GET/OPTIONS /api/metrics` | Gateway metrics snapshot (PRD §115; documented in docs). |
| `GET/OPTIONS /api/providers` | Extended provider listing (PRD §88/§218, public API surface). |
| `GET/OPTIONS /api/debug/provider` | Live wire-level provider diagnostic (PRD §22; documented at docs content). |
| `GET/OPTIONS /api/debug/stream` | SSE buffering diagnostic (PRD §15/§16; documented). |
| `GET/OPTIONS /api/debug/tools` | Tool-trace ring buffer (Tool PRD §19/§27; documented; names/counts only). |
| `GET/OPTIONS /health` | Health probe — used by the sandbox keepalive infrastructure and orchestrators. |
| `GET/OPTIONS /ready` | Readiness probe (503 semantics for k8s-style gating). |
| ~~`GET /api`~~ | REMOVED (hello-world scaffold, referenced nowhere). |

Page routes (`/`, `/chat`, `/models`, `/models/[provider]`,
`/models/[provider]/[model]`, `/docs`) are ALL `force-static` → prerendered at
build time → served from Vercel's CDN edge with **zero function invocations**
for page views. Vercel functions are invoked only by the API surface above —
which is the product itself.

**Honest statement on full static export:** `output: 'export'` cannot be enabled
because the gateway API routes are server functions by design (upstream
proxying, CORS, rotation, continuation). The maximum achievable static posture
is what this pass delivers: every page prerendered, every remaining function on
the inventory with a documented product reason.

---

## 5. Measurable / verifiable improvements

| Metric | Before | After |
|---|---|---|
| setState calls during a 3,000-delta stream | ≈3,000 | ≈ stream_seconds × 12.5 |
| ReactMarkdown parses of the streaming message per second | ≈ delta rate (up to ~100/s), each over the FULL accumulated text | ≤ 12.5/s (80 ms throttle) |
| Code-block subtree behavior per render | unmount + remount + full Prism re-tokenize (inline component type) | in-place update, stable type |
| Old bubbles re-rendered during streaming | all, every delta | none (React.memo, stable props) |
| /models cards re-rendered per keystroke | 87 | 0 (memo) |
| Prism languages in the /chat initial bundle | ~300 (≈1.2 MB min / ≈250–300 KB gzip) | core only (~8 KB) + lazy per-language chunks (all languages still highlight) |
| Vercel functions | 14 API routes + hello-world | 14 API routes (hello-world removed); all pages static |
| `X-Powered-By` header | present | dropped |

## 6. Verification performed (post-restart, on the live gateway)

- `bunx tsc --noEmit` CLEAN; `bun run lint` CLEAN; `bun tests/run-tests.mjs` 10/10 PASS.
- Gateway restarted once (`pkill -f "next dev"` → keepalive respawn ~8 s; `/health` 200).
- `GET /` 200 · `GET /chat` 200 · `GET /models` 200 · `GET /docs` 200.
- `GET /api/v1/models` → **87 models**; `GET /v1/models` alias → 200.
- Streaming chat `POST /api/v1/chat/completions` (`tb/gpt-5.2`, "Say OK",
  `stream: true`) → delta `OK` → `finish_reason: stop` → `data: [DONE]`.
- Browser E2E (agent-browser): /chat loads with auto-selected model; streamed
  TypeScript code block renders with 58 Prism tokens (async highlighter working);
  STREAM COMPLETE banner; Stop mid-stream preserves the full partial text
  (2,345 chars, mid-sentence) with "stopped" status; inline upstream-400 error
  renders with Retry; /models renders all 87 cards; homepage orb canvas
  painting (208 px buffer); zero browser console errors on every page checked.
- StrictMode double-mount verified harmless in the running dev server.

## 7. Files touched (this pass only)

- `src/components/playground/chat-playground-client.tsx` — throttle, stable
  markdown components, PrismAsyncLight + idle warm-up, memoized ChatMessageItem,
  stable toggleReasoningFor.
- `src/components/explorer/models-catalog.tsx` — memoized ModelCard.
- `next.config.ts` — strictMode + poweredByHeader/compress/sourceMaps.
- `src/app/page.tsx`, `src/app/models/page.tsx` — `force-static`.
- `src/app/api/route.ts` — DELETED (dead hello-world).
- `agent-ctx/3-perf-audit.md`, `agent-ctx/3-perf-report.md` — this documentation.
