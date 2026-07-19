# Task ID: docs-route
**Agent:** main
**Task:** Build comprehensive /docs route for FreeGPT Gateway

## Summary
Created `src/app/docs/page.tsx` — a client component with a sticky sidebar + scrollable
content area, covering all 4 endpoints (chat, models, search, music) with 8-language
code examples (cURL, Python, JavaScript, Node.js, PHP, Go, Ruby, HTML).

## What was built

### File created
- `src/app/docs/page.tsx` (~1,200 lines, single client component)

### Structure

**Sidebar (sticky, left)** — collapses to a mobile overlay drawer under `lg:` breakpoint.
Nav tree:
1. Overview
2. Authentication
3. Chat Completions (with nested children)
   - Basic (non-streaming)
   - Streaming
   - Tool Calling (non-streaming)
   - Tool Calling (streaming)
4. Models
   - List all models
   - Filter by provider
5. Web Search
6. Music Generation
7. Code Examples (all languages)

**Content area (right)** — every section uses `<section id="..." className="scroll-mt-20">`
so anchor links land below the sticky header.

### Reusable components (defined inline in the file)
- `useOrigin()` — `useSyncExternalStore` hook reading `window.location.origin` on
  the client only (SSR-safe, no hydration mismatch). Reused pattern from
  `src/components/landing/code-examples.tsx`.
- `CopyButton` — ghost button with copy-to-clipboard + sonner toast + check/copy icons.
- `CodeBlock` — single-code block with terminal-window chrome (red/yellow/green dots),
  filename label, dark `bg-zinc-950` background, `max-h-[520px] overflow-y-auto`,
  and a `CopyButton` positioned top-right.
- `CodeTabs` — wraps 8-language snippets in shadcn `Tabs` (with `flex-wrap h-auto`
  on `TabsList` so all 8 fit on mobile).
- `Sidebar` — recursive render of `NAV` array with nested children indented under
  a left border line.

### Snippets (8 functions, one per section)
Each is a `(origin: string) => Record<Lang, string>` so the live origin is injected
into every URL. Languages covered in every section: cURL, Python, JavaScript (browser
or openai SDK), Node.js (native fetch), PHP, Go, Ruby, HTML (browser widget).

Sections with code:
1. **chatBasic** — non-streaming chat (`stream: false`)
2. **chatStreaming** — SSE parsing with `stream: true`. Each language implements
   its own SSE parser:
   - cURL: `curl -N` + `data:` line format documented
   - Python/JS: OpenAI SDK `stream=True` iterator
   - Node.js: native fetch + `getReader()` + buffer-split-on-`\n`
   - PHP: `CURLOPT_WRITEFUNCTION` callback
   - Go: `bufio.Scanner` + `strings.HasPrefix(line, "data:")`
   - Ruby: `Net::HTTP.start { http.request(req) { res.read_body } }` streaming
   - HTML: browser `ReadableStream` reader
3. **chatTools** — non-streaming tool calling with `get_weather` example; response
   shape documented (`finish_reason: "tool_calls"`, `message.tool_calls[]`)
4. **chatToolsStreaming** — streaming tool calls. Each language accumulates
   `tool_calls[idx].function.arguments` across deltas by `index` (the canonical
   OpenAI pattern for streaming tool calls)
5. **modelsList** — `GET /api/v1/models` in all 8 languages + response JSON shape
6. **modelsFilter** — group by `owned_by` field; shows `jq`, dict grouping in each
   language, plus an HTML provider-filter dropdown widget
7. **webSearch** — `POST /api/v1/search` with `{query, num}` body and documented
   `{results, query, count}` response shape
8. **music** — `POST /api/v1/music/generate` with full body (`prompt, lyrics,
   duration, instrumental, bpm, key, language`). Each language decodes the
   returned `audios[0].audio_base64` to an MP3 file — except the JavaScript tab,
   which plays audio directly via `new Audio("data:audio/mp3;base64,...")`.

### Design / styling
- App color scheme respected: dark `bg-background` (`#042330`), white text,
  green accent `#2ce080` (used for code dots, badge borders, hover states,
  code spans, endpoint highlights, etc.)
- Sticky header with "Back to home" `next/link` + logo + "API Docs" title
- Mobile menu toggle (`Menu`/`X` icons) reveals a full-screen overlay sidebar
  below the header
- Ambient radial gradient background matching other pages
- Sticky footer with `mt-auto` (per layout requirement — sticks to bottom on
  short content, gets pushed down on long content)
- All cards use `rounded-xl border border-border bg-card/40` consistent with
  the rest of the app

## Verification

| Check | Result |
|---|---|
| `bun run lint` | ✅ 0 errors |
| `npx tsc --noEmit` | ✅ 0 errors |
| `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/docs` | ✅ 200 in ~1s |
| Dev server log: `GET /docs 200 in 977ms (compile: 742ms, render: 236ms)` | ✅ |
| Page content verified via curl — contains "FreeGPT API Docs", "Chat Completions", "Tool Calling (streaming)", "Web Search", "Music Generation", "On this page" | ✅ |

## Notes / decisions
- Used `useSyncExternalStore(emptySubscribe, () => window.location.origin, () => "https://your-host")`
  pattern from the existing `code-examples.tsx` — guarantees the origin string
  hydrates cleanly on the server (falls back to the placeholder) and resolves
  to the real origin on the client.
- Reused the `CopyButton` and terminal-window code block chrome pattern from
  `code-examples.tsx` for visual consistency with the landing page.
- Did NOT use `framer-motion` here (settings page does) — kept the docs page
  lightweight and pure-Tailwind for fast initial render.
- Mobile sidebar is a simple conditional overlay (`fixed inset-0 top-16`) rather
  than the shadcn `Sheet` — avoids an extra radix dependency and works identically.
- Each code section is its own `<Tabs>` instance so users can switch languages
  independently per section (basic vs streaming vs tools, etc.).
- The "Code Examples (All Languages)" section at the bottom is a navigation
  grid linking back to `#chat-basic` — anchor links to the existing tabs rather
  than re-rendering duplicate code.

## Files touched
- `src/app/docs/page.tsx` (NEW — ~1,200 lines)
