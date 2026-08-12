# Task: Fix Streaming Issues and Add New Providers

## Summary of Changes

### Task 1: Fix Streaming Bug
**File**: `src/app/api/v1/chat/completions/route.ts`

**Root cause**: The `enqueue` function used a synchronous `try/catch` that only caught sync errors from `writer.write()`, but `writer.write()` returns a Promise. This meant:
1. No proper backpressure handling — `writer.write()` could resolve before data was actually flushed
2. No `await writer.ready` before writes, so multiple small writes could be coalesced by the runtime into a single TCP packet
3. The `STREAM_DELAY` of 20ms was too short for reliable network flushing on some runtimes

**Fixes applied**:
1. **Made `enqueue` async** with proper `await writer.ready` before each `writer.write()` — ensures backpressure and individual chunk flushing
2. **Increased `STREAM_DELAY` from 20ms to 30ms** — gives the network layer more time to flush each chunk individually
3. **Cleaned up `isRealStreamProvider()` list** — removed `freegpt` and `freeaixyz` since they're handled via proxy routes before reaching the streaming logic; added new providers `gptoss` and `vexa`
4. **Added comprehensive doc comments** explaining the streaming architecture and provider list

### Task 2: Add GPT-OSS Provider
**File**: `src/lib/providers/gptoss.ts` (new)

- OpenAI-compatible API at `https://broken-water-d859.junioralive.workers.dev/v1/chat/completions`
- Models: `gpt-oss-120b` (reasoning, medium effort), `gpt-oss-20b` (fast, low effort)
- Supports `reasoning_content` in delta (yielded as inline text)
- Supports `X-Reasoning-Effort` header (auto-set based on model size)
- No API key required
- Real SSE streaming (added to `isRealStreamProvider`)

### Task 3: Add Vexa AI Provider
**File**: `src/lib/providers/vexa.ts` (new)

- Base URL: `https://vexa-ai.pages.dev`
- `/chat` endpoint: POST with messages — always streams via OpenAI-shaped SSE
- `/query` endpoint: POST for single-turn JSON responses
- Models: `vexa` (default), `gpt-4.1-nano`, and 13+ more
- No API key, no account, CORS enabled
- Handles inline stream errors (`data: {"error":{"message":"..."}}`)
- Real SSE streaming (added to `isRealStreamProvider`)

### Task 4: Remove Music/Search from Registry
**Files changed**:
- `src/lib/providers/registry.ts`:
  - Removed `"search"` and `"music"` from `ProviderId` type
  - Removed `svc()` helper function and the two `svc()` model entries
  - Removed `"search"` and `"music"` entries from `PROVIDER_INFO`
  - Added `"gptoss"` and `"vexa"` to `ProviderId` type
  - Added `go()` and `vx()` model helpers
  - Added GPT-OSS models: `go-120b`, `go-20b`
  - Added Vexa models: `vx-vexa`, `vx-gpt-4-1-nano`
  - Added `"gptoss"` and `"vexa"` to `PROVIDER_INFO`
- `src/lib/providers/index.ts`:
  - Removed `stubProvider` and its `search`/`music` entries from `PROVIDERS`
  - Added `gptOssProvider` and `vexaProvider` imports and entries
- `src/app/api/v1/models/route.ts`:
  - Updated comment for the search/music filter (kept as safety check)
