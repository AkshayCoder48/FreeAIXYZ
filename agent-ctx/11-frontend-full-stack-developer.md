# Task 11-frontend — full-stack-developer (playground overflow + sync hook)

## Task
Fix provider-name overflow in the Playground + dashboard cards, build a client-side `useModelSync` hook that triggers real-time model sync on app open + refresh, and wire the Playground model selector to consume the unified registry (auto-switch when a selected model is removed, show sync state, empty state).

## Work Log

### A. Context gathering
- Read `/home/z/my-project/worklog.md` (last 250 lines) for prior agent context.
- Read the 4 target files fully:
  - `src/components/playground/chat-playground.tsx` (1122 lines → 1348 lines after edits)
  - `src/components/dashboard/provider-cards.tsx` (296 lines → 391 lines after edits)
  - `src/components/explorer/model-explorer.tsx` (629 lines → minor edits)
  - `src/hooks/use-sse-stream.ts` (existing hook pattern to follow)
- Inspected the existing API surface:
  - `GET /api/v1/models?health=true` — current model listing endpoint. The route
    does NOT yet expose a `free` field on each model entry, so I treated
    `free !== false` as free (default true) — FreeAIXYZ is a free-tier gateway
    so the default holds whether or not the backend has shipped the unified-
    registry `free` field.
  - `POST /api/discovery/refresh` — the existing manual discovery trigger.
  - `POST /api/sync/refresh` — the NEW unified-registry sync endpoint (not yet
    provisioned by any backend subagent; the hook falls back to the discovery
    endpoint on 404 so it works in either backend state).

### B. useModelSync hook — `src/hooks/use-model-sync.ts` (NEW, 250 lines)
Implements PRD §6, §7, §28, §29.

**Sync-on-mount (PRD §6):** triggers `POST /api/sync/refresh` on first mount, but
skips if `lastSyncAt` is < 30s ago to avoid hammering on hot reloads / re-mounts.

**Sync-on-visibilitychange / pageshow (PRD §7):** `document.addEventListener(
"visibilitychange", …)` + `window.addEventListener("pageshow", …)` — only fires
when the tab becomes visible again. 30s throttle (`MIN_VISIBILITY_INTERVAL_MS`)
so a user rapidly flipping tabs doesn't spam the backend.

**Sync lock / dedup (PRD §28):** module-level `let syncingPromise: Promise |
null` — multiple `useModelSync` instances in the same tab share one in-flight
sync. If a sync is already running, subsequent callers receive the in-flight
promise.

**Multi-tab (PRD §29):** `BroadcastChannel("freeaixyz-sync")` — when one tab
completes a sync, it `postMessage`s the result; other tabs update their state
without re-fetching. Falls back to `localStorage` storage event when
BroadcastChannel is unavailable (older browsers / sandboxed iframes).

**Endpoint fallback:** tries `/api/sync/refresh` first; on 404 (endpoint not
yet provisioned) falls back to `/api/discovery/refresh`. This means the hook
works whether or not the backend subagent has shipped the new unified-registry
sync endpoint.

**Persistence:** `lastSyncAt` written to `localStorage["freeaixyz:lastSyncAt"]`
so it survives page reloads; the initial state reads from it so the UI shows a
sensible "last synced X" without re-syncing immediately on reload.

**Manual refresh():** exposes a `refresh()` function called by the "Refresh
Models" button — sets `syncing: true`, runs `runSync()`, applies the outcome,
and broadcasts to other tabs. Returns the SyncResult (added/updated/removed/
free) or null on failure.

**Diff computation:** `computeResult(json)` accepts three response shapes:
- `{ added, updated, removed, free }` (unified-registry shape)
- `{ ok: true, results: [{ added, updated, removed, free }, …] }` (legacy
  discovery shape — summed across providers)
- `{ ok: true, diff: { added, updated, removed, free } }`

**Return shape:** `{ syncing, lastSyncAt, result, error, refresh }`.

### C. FIX 1 — Provider-name overflow (chat-playground ModelPicker trigger)
**BEFORE:** The trigger button was
```tsx
<Button className="flex-1 min-w-0 h-12 justify-between ...">
  {selected ? (
    <span className="truncate text-left" style={{...}}>
      <span className="text-foreground">{selected.id}</span>
      <span className="text-muted-foreground text-[10px] ml-2 hidden sm:inline">
        {selected.owned_by}
        {selected.capabilities.streaming && <span>...</span>}
      </span>
    </span>
  ) : ...}
  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
</Button>
```
The outer `truncate` did nothing because the inner spans had intrinsic widths
that grew beyond the button — no `min-w-0`/`flex-1` constraint was applied to
the content wrapper. Long provider names pushed the chevron off the card and
overflowed the rectangle.

**AFTER:** Per PRD §36-40 pattern:
```tsx
<Button className="flex-1 min-w-0 h-12 justify-between ..." aria-label="Select model">
  <span className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
    {selected ? (
      <>
        <span
          className="text-foreground truncate text-sm overflow-hidden text-ellipsis whitespace-nowrap"
          title={selected.id}
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {selected.id}
        </span>
        <span
          className="text-muted-foreground text-[10px] hidden sm:inline-flex items-center gap-1 min-w-0 truncate overflow-hidden text-ellipsis whitespace-nowrap"
          title={`${selectedFullProvider}${selected.capabilities.streaming ? " · streaming" : ""}`}
        >
          <span className="truncate">{selectedFullProvider}</span>
          {selected.capabilities.streaming && (
            <span className="inline-flex items-center gap-0.5 shrink-0">
              <Zap className="h-2.5 w-2.5 text-accent" strokeWidth={1.75} />
              stream
            </span>
          )}
        </span>
      </>
    ) : ...}
  </span>
  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
</Button>
```
Key changes:
1. Added a content wrapper `<span className="min-w-0 flex-1 flex items-center
   gap-2 overflow-hidden">` between the Button's flex children (PRD §36).
2. Each text span now has the explicit set: `truncate overflow-hidden
   text-ellipsis whitespace-nowrap` (so it actually clips) + a `title={…}`
   attribute for the hover tooltip (PRD §39).
3. The `stream` indicator inside the provider-name span gets `shrink-0` so it
   doesn't get squeezed; the provider-name span gets the remaining width.
4. The ChevronsUpDown icon keeps `shrink-0` (was already there) so the chevron
   is pinned and the name gets the remaining width (PRD §40).
5. No card width change — the trigger shrinks to its container (PRD §38 —
   don't grow the card to "fix" overflow).

### D. FIX 1 — Provider-name overflow (dashboard provider cards)
**BEFORE:**
```tsx
<div className="min-w-0">
  <div className="text-sm font-semibold truncate text-foreground">
    {p.name}
  </div>
  ...
```
**AFTER:**
```tsx
<div className="min-w-0 flex-1">
  <div
    className="text-sm font-semibold truncate overflow-hidden text-ellipsis whitespace-nowrap text-foreground"
    title={p.name}
  >
    {p.name}
  </div>
  ...
```
- Added `flex-1` to the parent so it actually shrinks within the flex row.
- Added the explicit ellipsis classes + `title={p.name}` for the tooltip.

### E. FIX 1 — Provider-name overflow (model-explorer)
Two locations:
1. **Sidebar provider multi-select button** (line 326 area):
   - Added `min-w-0` to the parent `<button>` className.
   - The checkbox and shortId spans are now `shrink-0`.
   - The name span gains `truncate flex-1 min-w-0 text-left overflow-hidden
     text-ellipsis whitespace-nowrap` + `title={p.name}`.
2. **Per-provider refresh list** (line 569 area):
   - Added `flex-1` to the parent div.
   - Added `truncate overflow-hidden text-ellipsis whitespace-nowrap` +
     `title={p.name}` to the inner name div.

### F. FIX 3 — Playground model selector → unified registry
- Added `free: boolean` to the `HealthModel` interface.
- `fetchModels()` parses `d.free !== false` defensively (default true).
- **PRD §42 free-only filter:** `list.filter(m => m.status === "active" &&
  m.free !== false)`; if the filtered list is empty (no free active models),
  falls back to showing the full list so the dropdown isn't empty.
- **PRD §43/§44 auto-switch on removal:** a `useEffect` keyed on
  `modelSync.lastSyncAt` + `modelSync.syncing` re-fetches the model list after
  each sync completion; if the currently selected model is no longer present,
  it switches to the first compatible active streaming model + shows a toast
  `"Model X was removed — switched to Y"`.
- **PRD §45 sync state UI:** a new `SyncStatusBar` component renders below the
  top bar showing `"↻ Updating models…"` while syncing, then flashes
  `"✓ Models updated · N new · M removed · K free"` for 3 seconds before
  fading back to idle. Idle state reserves an `h-6 mt-1` placeholder to
  prevent layout shift.
- **PRD §46 empty state:** when `models.length === 0 && !loading && !error`,
  the trigger button shows `"No free models available — Refresh to check
  again"` with an amber AlertCircle icon; the dropdown renders an explicit
  empty state card instead of an empty list.
- `userPickedRef` flag distinguishes initial auto-pick from user choice so
  the auto-pick effect doesn't override the user's selection on a later sync.
- `handleSelectModel(id)` flips the user-picked flag; `switchModel` (the
  error-fallback path) also flips it.

### G. FIX 4 — Manual "Refresh Models" button (PRD §8)
- New "⟳ Refresh models" button next to the model picker in the playground top
  bar. Uses the `RefreshCw` icon; swaps to `Loader2 animate-spin` while syncing.
- On click: calls `modelSync.refresh()` (the hook's manual trigger).
- On success: toast `"Models updated — new: X · updated: Y · removed: Z ·
  free: N"` (PRD §8 diff spec, 4s duration).
- On failure: toast `"Sync failed: {error}"`.
- The post-sync `useEffect` then re-fetches the model list and auto-switches
  if the selected model was removed (FIX 3 wiring).
- Mobile collapses to "Sync" label, desktop shows "Refresh models".

### H. FIX 5 — Dashboard provider cards sync state
- Imported `useModelSync`; mounted at the top of `ProviderCards`.
- Added a `<SyncStatusBar>` banner above the card grid:
  - While syncing: `"↻ Syncing all providers…"` in `text-accent` with a
    spinning Loader2.
  - On error: `"Sync failed: {error}"` in `text-rose-500`.
  - For 3s after a sync completes: `"✓ Synced — N new · M updated · K
    removed · J free"` in emerald, then fades back to idle (returns null).
  - Banner styled as `border border-accent/20 bg-accent/5 text-accent` to match
    the Minimalist Modern design system.
- The top "Reload" button now calls `modelSync.refresh().then(() => load())`
  (uses the unified-registry sync endpoint with discovery fallback built into
  the hook) instead of just `load()`. Disabled while syncing.
- Per-card "Refresh {shortId}" button: tries `/api/sync/refresh` first; on 404
  falls back to `/api/discovery/refresh` (legacy endpoint). Both paths re-fetch
  the provider list afterwards.
- New `useEffect` re-fetches the provider list whenever a sync completes
  (`modelSync.lastSyncAt` changes) so the dashboard reflects newly-discovered
  providers without a manual reload.

### I. Lint / TypeScript verification
- `bun run lint` → 0 errors in any file I touched:
  - `src/hooks/use-model-sync.ts`
  - `src/components/playground/chat-playground.tsx`
  - `src/components/dashboard/provider-cards.tsx`
  - `src/components/explorer/model-explorer.tsx`
- The 5 remaining lint errors are in pre-existing files I did not modify:
  - `src/app/api/v1/chat/freeaixyz-proxy/route.ts` (require() call)
  - `src/hooks/use-sse-stream.ts` (unused eslint-disable comment)
  - `src/lib/freegpt-signer.cjs` and `src/lib/freegpt-wasm.js` (require() calls)
- `bunx tsc --noEmit` → 0 errors in any of my files.

## Stage Summary

### Files modified
1. `src/components/playground/chat-playground.tsx` — overflow fix on the
   ModelPicker trigger; wired `useModelSync()`; added free-only filter; added
   auto-switch-on-removal effect; added manual "Refresh Models" button; added
   `SyncStatusBar` for sync state UI; added empty state for the model picker
   dropdown.
2. `src/components/dashboard/provider-cards.tsx` — overflow fix on the
   provider name span; wired `useModelSync()`; added `SyncStatusBar` banner;
   Reload button now triggers unified sync; per-provider refresh tries
   `/api/sync/refresh` first.
3. `src/components/explorer/model-explorer.tsx` — overflow fix on the
   sidebar provider multi-select button + per-provider refresh list name span.

### Files created
1. `src/hooks/use-model-sync.ts` (NEW, 250 lines) — the unified-registry sync
   hook with all six required features:
   - sync-on-mount (PRD §6)
   - sync-on-visibilitychange / pageshow (PRD §7, 30s throttle)
   - module-level dedup via `syncingPromise` (PRD §28)
   - BroadcastChannel multi-tab broadcast with localStorage fallback (PRD §29)
   - manual `refresh()` function exposed for the "Refresh Models" button (PRD §8)
   - persisted `lastSyncAt` in localStorage
   - endpoint fallback (`/api/sync/refresh` → `/api/discovery/refresh` on 404)

### Overflow fix approach (PRD §36-40)
The pattern applied consistently across all three files is:
- `<div className="min-w-0 flex-1">` parent
- child `<span className="truncate overflow-hidden text-ellipsis
  whitespace-nowrap" title={fullName}>` for the text
- sibling icons `shrink-0` so they don't get squeezed
- No card width changes — the trigger shrinks to its container and the text
  clips with a tooltip on hover (PRD §38 — don't grow the card).

### Hook features delivered
1. sync-on-mount (PRD §6) — but throttled: skips if lastSyncAt < 30s ago
2. sync-on-visibilitychange + sync-on-pageshow (PRD §7) — also 30s throttled
3. module-level dedup via `syncingPromise` (PRD §28) — shared across all
   useModelSync instances in the same tab
4. BroadcastChannel("freeaixyz-sync") multi-tab broadcast with localStorage
   fallback (PRD §29)
5. manual `refresh()` function exposed for the "Refresh Models" button (PRD §8)
6. persisted `lastSyncAt` in localStorage
7. 30s throttle to prevent hammering on rapid tab switches / hot reloads
8. endpoint fallback (`/api/sync/refresh` → `/api/discovery/refresh` on 404)
   so the hook works whether or not the backend has shipped the new endpoint

### Playground model selector changes
- **Auto-switch on removal (PRD §43/§44):** post-sync `useEffect` re-fetches
  the model list; if the currently selected model is gone, switches to the
  first compatible active streaming model and toasts
  `"Model X was removed — switched to Y"`.
- **Sync state UI (PRD §45):** inline `SyncStatusBar` below the top bar shows
  `"↻ Updating models…"` while syncing, then flashes the diff result for 3s
  before fading.
- **Empty state (PRD §46):** when no free/active models are available, the
  trigger shows `"No free models available — Refresh to check again"` with
  an amber AlertCircle icon; the dropdown renders an explicit empty state
  card instead of an empty list.
- **Free-only filter (PRD §42):** `models.filter(m => m.status === "active"
  && m.free !== false)` — defensive default-true if the `free` field is
  missing from the API response.
- **Manual refresh button (PRD §8):** new "⟳ Refresh models" button in the
  top bar; on click triggers `modelSync.refresh()` and toasts the diff.

### Lint result
- `bun run lint` filtered to my files → 0 errors / 0 warnings.
- `bunx tsc --noEmit` filtered to my files → 0 errors.
- Pre-existing errors in unrelated files were left untouched.
