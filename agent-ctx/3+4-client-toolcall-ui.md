# Task 3+4 — Client Tool-Call UI (accumulator + ToolCallCard)

**Agent**: client-toolcall-ui
**Date**: this session
**Status**: ✅ complete, lint-clean, TS-clean for the 3 edited files

## Files changed (3, all under `/home/z/my-project/freeaixyz/`)

### 1. `src/hooks/use-sse-stream.ts`
- **`ToolCallDelta` exported interface** — mirrors the server normalizer's
  `NormalizedDelta.toolCalls` shape exactly: `{ index, id?, type:"function",
  function: { name?, arguments? } }`. The `id`/`name`/`arguments` are
  optional precisely because they appear only on specific deltas (PRD §11).
- **`onToolCallDelta?: (tc: ToolCallDelta[]) => void`** added to `StartOpts`.
- **`extractToolCallDelta(data)`** — parses `choices[0].delta.tool_calls[]`,
  drops entries without numeric `index`, treats empty `id`/`name`/`arguments`
  as `undefined` so the client accumulator can distinguish "absent" from
  "empty fragment". Returns `null` if no tool_calls array or empty.
- **`RAW_TOOL_CALL_MARKER_RE = /^\s*\{"__tool_calls"\s*:/`** — defense-in-depth
  backstop in `extractContentDelta` (PRD §8). Any `delta.content` starting
  with the canonical marker shape is suppressed (returns `null`). The
  server-side `ToolCallNormalizer` should already have stripped these, but
  this guards any legacy path.
- **Wired `extractToolCallDelta`** into BOTH event-processing loops (live
  read loop + trailing-flush loop) — calls `opts.onToolCallDelta?.(tcDelta)`
  immediately after `opts.onDelta(delta)`.
- **Idle-watchdog hardening (PRD §A5)** — added `finalizedRef =
  useRef<boolean>(false)` (reset in both `reset()` and head of `start()`).
  Added a `finalizeDone(streamEndAt)` closure inside `start()` that is
  idempotent (checks+sets `finalizedRef`, then `setTimings` +
  `setState("done")` + `opts.onDone?.()`). Watchdog's idle-timeout path now
  calls `finalizeDone(Date.now())`. End-of-stream path collapsed from a
  3-way branch to `capturedError ? setState("error") : finalizeDone(streamEndAt)`.
  Error branch deliberately does NOT use `finalizeDone` (errors are terminal).
  User-abort path's existing behavior preserved (no Stop-button regression).

### 2. `src/components/playground/tool-call-card.tsx` (NEW)
- Named export `ToolCallCard`. Props: `{ name: string; argumentsRaw: string;
  status: "streaming" | "ready" | "executing" | "result"; result?: string }`.
- Uses shadcn `Card`/`CardHeader`/`CardTitle`/`CardContent` (with `py-0 gap-0`
  override for compactness) + `Badge` (outline variant) + Lucide icons
  `Wrench`, `Loader2`, `Check`, `PlayCircle`, `Terminal`.
- **`tryPrettyPrint(raw)`** — lazily `JSON.parse`s the arguments buffer ONLY
  when it parses to a complete object/array. Partial buffers (mid-stream)
  return raw verbatim (PRD §12 — never JSON.parse partials). Non-object
  primitives return raw.
- **Status visuals**: streaming = amber spinner+border; ready = emerald
  check; executing = muted PlayCircle; result = emerald Terminal.
  **NO indigo/blue** (Tailwind built-in vars + amber/emerald only). Dark-mode
  variants included.
- **Responsive** (mobile-first): `w-full max-w-full`, `truncate min-w-0` on
  the name, `overflow-x-auto whitespace-pre-wrap break-all max-h-64` on the
  args `<pre>`. ARIA labels on the card, args block, and result block.

### 3. `src/components/playground/chat-playground.tsx`
- Imported `ToolCallCard` and `type ToolCallDelta` from `@/hooks/use-sse-stream`.
- Added **`ToolCallState`** interface (`index, id, name, argumentsBuffer,
  status: "streaming"|"ready"`) and **`toolCalls?: ToolCallState[]`** field
  on `ChatMessage`.
- Added **`onToolCallDelta`** callback to the `stream.start({...})` call in
  `send()`. For each incoming `ToolCallDelta[]`: deep-copies the existing
  `toolCalls` array (so React sees a new ref), then for each fragment either
  initializes a new entry (first delta for this index) OR mutates the
  existing entry by index:
  - **stable id**: `if (!cur.id && tc.id) cur.id = tc.id` — keep first
    non-empty id (PRD §11).
  - **first-non-empty name wins**: `if (!cur.name && tc.function.name)
    cur.name = tc.function.name` — empty name deltas do NOT erase (PRD §11).
  - **arguments CONCATENATED**: `cur.argumentsBuffer += tc.function.arguments`
    — never overwritten, never JSON.parsed mid-stream (PRD §12).
  - **status stays "streaming"** until stream ends.
- Updated **`onDone`** to set `status: "ready"` on every accumulated tool
  call when the stream ends (the `ToolCallCard` lazily pretty-prints the
  now-complete buffer on render).
- Updated **`MessageBubble`**: added `hasToolCalls` derived flag; renders a
  `<div className="w-full flex flex-col gap-2">` of `<ToolCallCard>`s (keyed
  by `tc.id || tc.index`) ABOVE the bubble when `hasToolCalls`. The bubble
  itself is now conditionally skipped for the `assistant + empty content +
  has tool calls` case (cards stand alone). Bubble render condition:
  `isUser || message.content || (!hasToolCalls && (isStreaming || isError))`.
  The copy/regenerate button row condition expanded to
  `(message.content || hasToolCalls)` so tool-call-only assistant messages
  can be regenerated.
- Raw `__tool_calls` JSON never reaches the bubble — filtered upstream by
  `extractContentDelta`'s regex backstop + the server-side normalizer.

## Server contract (from Task 1's `src/lib/gateway/tool-call-normalizer.ts` — NOT touched)
The normalizer emits proper OpenAI-shaped SSE chunks:
- Text: `data: {"choices":[{"delta":{"content":"text"}}]}`
- Tool calls (first delta for an index):
  `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_0_0","type":"function","function":{"name":"ls","arguments":""}}]}]}}`
- Subsequent argument fragments (same index, no id, no name — just args):
  `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}]}}`
- Final: `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`
  then `data: [DONE]`.

The client accumulator handles this exact shape correctly:
- `id` appears only on the FIRST delta for an index → kept via
  `if (!cur.id && tc.id)`.
- `function.name` appears only on the name-introducing delta → kept via
  `if (!cur.name && tc.function.name)`.
- `function.arguments` is the incremental fragment → CONCATENATED.
- The `ToolCallCard` only pretty-parses when the buffer is complete (i.e.
  on `status:"ready"` after `onDone`).

## Lint / TypeScript result
- `cd /home/z/my-project/freeaixyz && bun run lint` → 5 errors, ALL in
  pre-existing server-side files I was forbidden to touch
  (`src/app/api/v1/chat/freeaixyz-proxy/route.ts`,
  `src/lib/freegpt-signer.cjs`, `src/lib/freegpt-wasm.js` —
  `@typescript-eslint/no-require-imports`). **MY 3 files are lint-clean.**
- `bunx tsc --noEmit` → all remaining TS errors are in pre-existing
  server-side files (`freegpt-proxy/route.ts`, `models-showcase.tsx`,
  `catalog.ts`, `discovery.ts`, `health.ts`, `verification.ts`, `sync.ts`
  — Prisma schema drift + provider model typing). **MY 3 files have
  ZERO TS errors.**

## Constraints honored
- ✅ TypeScript strict, `'use client'` on the hook + new component + playground.
- ✅ Reused existing shadcn/ui components (`Card`, `CardHeader`, `CardTitle`,
  `CardContent`, `Badge`) — no new packages installed.
- ✅ Did NOT touch any server files (`src/lib/gateway/*`, `src/app/api/*`).
- ✅ No provider fallback, no model fallback, no disabling tools.
- ✅ No non-streaming substitution — the existing real SSE stream is
  preserved; only the delta interpretation changed.
- ✅ No indigo/blue colors in the new `ToolCallCard`.
- ✅ Responsive (mobile-first) design.
- ✅ One card per index, NEVER per delta (PRD §17).
- ✅ Raw `__tool_calls` JSON never appears in the markdown bubble (PRD §8).
