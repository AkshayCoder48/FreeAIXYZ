# Task 3-perf — Phase 1 Audit Findings (performance overhaul)

Scope: every directory under `src/`, `next.config.ts`, `package.json`, `vercel.json`,
`tailwind.config.ts`. Dev server kept running throughout (verified `/health` 200 before audit).
Catalog state at audit time: 87 live models (`GET /api/v1/models` → 87), 25 providers.

## A. Client runtime — the lag sources (CONFIRMED)

### A1. `chat-playground-client.tsx` streaming hot path — THE #1 lag source
`onDelta` / `onReasoning` call `setMessages` **once per SSE delta** (a long stream is
2,000–3,000 deltas ≈ 100/s). Every delta triggers a full re-render of the whole
component, and per re-render:

1. **ReactMarkdown re-parses the ENTIRE accumulated content** for the streaming
   message → O(n) work per delta → **O(n²) total** over the stream. On a 12k-char
   code-heavy response this is seconds of main-thread time on low-end Android.
2. **ALL previous messages re-render too** (no memo on message bubbles) — every old
   message's markdown is re-parsed on every delta of the newest one.
3. **`components={{ code: … }}` is an inline object** (new function type per render).
   React sees a *different component type* for `code` on every render → it **unmounts
   and remounts the entire code-block subtree** per delta instead of updating in place.
   With `SyntaxHighlighter` inside (Prism re-tokenizes the full block), this multiplies
   cost per code block per delta.
4. `onReasoning` does the same per-delta `setMessages` for the reasoning field.

Fix design (Phase 2): accumulate deltas in the existing local mirror
(`assistantContent`) + a new `assistantReasoning` mirror; flush BOTH to state on a
~80 ms cadence (setTimeout, dedup via a pending flag) → ~12 setState/s instead of
~100/s; forced synchronous flush at every terminal transition (round end, abort,
error, complete) so final state is always full-fidelity. Markdown `components` prop
moves to module scope (stable type identity → in-place updates of code blocks).
Message bubbles extracted into a `React.memo` child so only the *streaming* bubble
re-renders per flush.

### A2. Full Prism bundle ships to /chat — ~1.2 MB of languages
`import { Prism } from "react-syntax-highlighter"` pulls `refractor` FULL
(`refractor/core` + **all ~300 language definitions**, 1.2 MB unminified in
node_modules, ≈250–300 KB gzipped) into the /chat client bundle.
`node_modules/react-syntax-highlighter/dist/esm/languages/prism/` = 300 files / 1.2 MB.
Switch to `PrismAsyncLight` (same package — zero new deps): ships `refractor/core`
(8 KB) and lazy-loads each language as its own webpack chunk on first use.
Unloaded/unknown languages render as plain code with the theme (graceful — verified
`getCodeTree` falls back to `defaultCodeValue`), and once a language chunk loads it is
cached and highlighted. **All 300 languages still highlight** — feature preserved,
initial payload cut by ~1 MB (min) / ~250 KB (gzip).

### A3. `/models` catalog — 87 cards re-render per keystroke
`ModelsCatalog` has no memo on the card tree: every keystroke in the search box
re-renders all 87 cards. Filter itself is memoized (cheap); the DOM diff is the cost.
Fix: `React.memo` the card component (model object identities are stable — they come
from the static catalog via memoized `groups`), stable `copyId` callback already
`useCallback`. Initial mount of 87 cards is one bounded pass (~2,200 DOM nodes) —
acceptable, no pagination needed (per-provider pages already paginate at 24 + Show
more). `provider-models-client` already bounds rendering — left as is.

### A4. `crimson-orb.tsx` — VERIFIED GOOD (no fix needed)
rAF runs only while `IntersectionObserver`-visible AND `document.visibilityState ===
"visible"` (`visibilitychange` listener); `prefers-reduced-motion` → single static
frame; DPR capped 1.5; ResizeObserver syncs the buffer. No WebGL, no deps.

### A5. CSS animation hygiene — VERIFIED GOOD
All continuous keyframes have `@media (prefers-reduced-motion: reduce)` overrides
(globals.css lines 260, 625, 1094). `animate-ping` (hero badge + streaming dot) is a
2 px element; browsers throttle CSS animation work on hidden tabs (no paint). The
`.animate-float/.animate-spin-slow/.animate-pulse-dot/.fxz-caret` classes are unused
in TSX (only `fxz-dot-pulse` is used) — dead CSS, ~15 lines, negligible; flagged, not
removed (design-system classes).

## B. Network / duplicate requests — NO DUPLICATES FOUND (mission assumption false)

The mission asked whether `/`, `/chat`, `/models` each fetch `/api/v1/models` —
**none of them do**. Verified by grep over all `.tsx`: the ONLY client-side `fetch`
calls in the entire app are
`POST /api/v1/chat/completions` and `POST /api/tools/execute` (both in
chat-playground-client.tsx, both by design). Every page hydrates from the **static
RSC catalog** (`src/lib/native-catalog.ts`) serialized as props at prerender time:
- `/` homepage: server component, zero fetch, static data.
- `/chat`: RSC passes `OFFERED_MODELS` → client island; "no network fetch" (its own
  header comment).
- `/models` + `/models/[provider]` + `/models/[provider]/[model]`: same static
  catalog via props.
- `/docs`: static content tree (`src/lib/docs/content.ts`).

→ A `models-cache.ts` dedup module would be **dead code** — nothing to dedupe.
Not implemented; documented here as the honest audit outcome.

## C. Server functions (Vercel) — full inventory + verdict

| Route | Verdict | Reason to exist (or not) |
|---|---|---|
| `/api/v1/chat/completions` | KEEP | The product — upstream proxying, CORS bypass, account rotation, auto-continuation. Cannot be static. |
| `/api/v1/chat/freegpt-proxy` | KEEP | Internal hop used by the main route (child_process curl for freegpt, 1800 s budget); referenced at completions/route.ts:1173. |
| `/api/v1/chat/freeaixyz-proxy` | KEEP | Internal hop (curl for freeaixyz upstream); referenced at completions/route.ts:678. |
| `/api/v1/models` | KEEP | OpenAI-compatible listing (product API surface; documented in docs content). |
| `/api/v1/status` | KEEP | Per-model/provider health snapshot (R-12, documented product surface). |
| `/api/tools/execute` | KEEP | Called by the playground's tool pipeline (client fetch verified). |
| `/api/debug/provider` | KEEP | Live wire-level diagnostic (PRD §22); documented product surface (docs content.ts:1174). |
| `/api/debug/stream` | KEEP | SSE buffering diagnostic; documented (docs content.ts:1175). |
| `/api/debug/tools` | KEEP | Tool-trace ring buffer; documented (docs content.ts:631,1173,1184). |
| `/api/metrics` | KEEP | Gateway metrics snapshot; documented (docs content.ts:1172). |
| `/api/providers` | KEEP | Extended provider listing (PRD §88/§218, public API surface for admin UIs). |
| `/health` | KEEP | App health probe — used by the sandbox keepalive script (.zscripts curls /health). |
| `/ready` | KEEP | Readiness probe for orchestrators (503 semantics). |
| **`/api` (api/route.ts)** | **REMOVE** | Hello-world JSON. Referenced NOWHERE (grep over README, docs content, src, tests). Pure scaffold. Removed. |

All remaining routes are honestly `dynamic` (they read in-memory gateway state or
proxy upstreams); no static-able API route exists.

## D. The `src/app/models/[provider]/odel]/` "typo'd route" — DOES NOT EXIST

The directory listing tools render `[model]` as `odel]` (display artifact — the
task brief and the 2-uikit worklog both inherited it). Verified with
`find … | od -c`: the real directory is `src/app/models/[provider]/[model]/` — a
**legitimate dynamic model-detail page** (`force-static`, prerendered, 266 lines,
linked from the catalog cards). Nothing removed. (Probe evidence: `od -c` shows
`[ m o d e l ]`.)

## E. Dead code / unused deps / unused shadcn components — FLAGGED ONLY

- **shadcn/ui**: 47 of 49 components under `src/components/ui/` are unimported
  (only `button`, `card`, `select`, `sonner`, `textarea` used; `toast` used only by
  the equally-unused `toaster.tsx`; `sidebar.tsx` is the only importer of
  `use-mobile`). They are tree-shaken out of every production bundle (verified:
  webpack only bundles what a page imports) — they cost repo bytes only. NOT deleted
  (standard shadcn library policy per task constraints; deleting would break future
  `shadcn add` flows).
- **package.json heavy deps never imported by app code**: `framer-motion`,
  `recharts`, `@mdxeditor/editor`, `@dnd-kit/*`, `embla-carousel-react`,
  `react-day-picker`, `input-otp`, `vaul`, `@reactuses/core`, `date-fns`,
  `@tanstack/*`, `zod`, `react-hook-form`, `@hookform/resolvers`, `next-intl`,
  `uuid`, `ws`, `cmdk`, `playwright`, `sharp` — none imported by `src/` (grep
  verified; several are imported ONLY by the unused shadcn components). They never
  enter the client bundle (no importer → no bundle entry). Left in place (removal
  risks breaking the shadcn standard library and dev tooling; documented here).
- `models.json` (repo root, 16 KB): live-gateway snapshot generated by
  `scripts/fetch-models.mjs`; not imported by the app (grep verified). Dev artifact.

## F. Pages — static-ability audit

| Page | `dynamic` export | State after fix |
|---|---|---|
| `/` | none (defaults to static — no dynamic APIs) | `force-static` added for honesty |
| `/chat` | `force-static` ✅ | unchanged |
| `/models` | none | `force-static` added |
| `/models/[provider]` | `force-static` ✅ | unchanged |
| `/models/[provider]/[model]` | `force-static` ✅ | unchanged |
| `/docs` | `force-static` ✅ | unchanged |

`output: 'export'` NOT enabled (API routes cannot be statically exported — the
gateway IS server functions). Vercel semantics in `vercel.json` untouched.

## G. `next.config.ts` — gaps found

- `reactStrictMode: false` → turn on (task directive; catches effect bugs, no prod
  bundle impact).
- No `poweredByHeader` (defaults true) → set false (header + bytes).
- `compress` / `productionBrowserSourceMaps` → make explicit (true / false).
- `optimizePackageImports`: `lucide-react` already in Next 16's default optimized
  list; no other barrel imports in app code → nothing to add (documented, not
  speculative).
- `experimental.staleTimes`: pages are already static; defaults already cache
  client-side navigations → skipped (no measured benefit, avoid untested knobs).
- Keep: standalone output (non-Vercel), rewrites (/v1 aliases), CORS headers,
  devIndicators:false, webpack dev (4 GB box rationale documented in file).

## H. Streaming trace (end-to-end, as requested)

`readSseStream` (persistent buffer + single TextDecoder, multi-event chunks, CRLF,
comments, `[DONE]` sentinel, graceful EOF) → handlers `onDelta/onReasoning/
onToolCall/onUsage/onError/onDone` → per-delta setState (A1) → `ReactMarkdown`
re-parse (A1.1) → inline `components` prop remount churn (A1.3) → `SyntaxHighlighter`
full-Prism re-tokenize per render (A2). Tool pipeline (`ToolCallAccumulator` by
index, fence detection on the local mirror, parallel execution, follow-up rounds)
is correct and untouched by the throttle (it reads the local mirror, not React
state). Abort/retry/stop paths finalize state synchronously — the throttle adds a
forced flush at each of those transitions so no text is ever lost.

## I. Long lists

- Models catalog: 87 cards, one bounded mount pass; re-render per keystroke fixed
  via memo (A3). No pagination needed (see A3).
- Conversation history: unbounded messages array — but only the last bubble mutates
  during a stream (post-fix), and old bubbles are memoized. Chat scroll area is
  `max-h-[60vh]` with overflow — bounded DOM visible at once.
- Playground model `Select`: capped at 30 items/group (`MAX_ITEMS_PER_GROUP`),
  opens on demand (Radix unmounts closed content). Fine.
- Docs: renders ONE page at a time; search filter memoized. Fine.

## J. What I deliberately did NOT do (and why)

- No `models-cache.ts` (B: zero client model fetches to dedupe — would be dead code).
- No deletion of unused shadcn components or package.json deps (E: tree-shaken, and
  deletion risks the standard library / future `shadcn add`).
- No pagination on /models (I3: single bounded mount; memo fixes the keystroke cost).
- No `output:'export'` (API routes can't be static-exported — the gateway is the product).
- No speculative `staleTimes` / `optimizePackageImports` additions (G).
- No visual/design changes (2-uikit crimson theme preserved exactly).
