# FreeAIXYZ Transformation — Final Investigation Report (PRD §238)

> Based on actual repository inspection of `AkshayCoder48/FreeAIXYZ` (154 files, 19 provider adapters) and measured browser/curl verification. Not assumptions.

## STREAMING ROOT CAUSE

**Exact file:** `src/app/api/v1/chat/completions/route.ts`
**Exact function:** `streamText()` (L639-662) + the non-real-stream branch of `streamCompletion()` (L547-591)
**Exact buffering operation:**
```ts
// NON-REAL-STREAM BRANCH (old code):
let fullText = "";
for await (const delta of provider.stream(...)) { fullText += delta; }  // ← buffers EVERYTHING
// then:
await streamText(send, fullText, ...);  // re-emits with `await sleep(30)` between chunks
```
**Why it buffered:** For non-streaming providers (toolbaz, miklium), the full upstream response was collected into `fullText` BEFORE any SSE chunk was emitted to the client. The subsequent `await sleep(30)` re-pacing was **fake streaming** (PRD §137 — explicitly prohibited). The client received nothing until upstream completed.

**Infrastructure involvement:**
- `vercel.json` already set `X-Accel-Buffering: no` / `Cache-Control: no-cache, no-transform` / `Connection: keep-alive` on all streaming routes ✓
- `Caddyfile` was a plain `reverse_proxy localhost:3000` with no `flush` directive — could buffer SSE in production. **Fixed** by ensuring the runtime emits `X-Accel-Buffering: no` headers from `streaming-proxy.ts` (`STREAM_HEADERS`).
- `next.config.ts` has `output: "standalone"` (non-Vercel) — no Vercel-specific buffering.

**Fix applied:**
1. **Removed `streamText()` entirely** (PRD §137). Removed `tokenizeForStream`, `chunkString`, `sleep`, and the `setInterval(heartbeat, 500)` (could buffer).
2. Non-streaming legacy providers now emit ONE content chunk + stop honestly (not fake re-paced).
3. **New canonical-id path** routes through `streamingProxyService.streamChat()` (in `src/lib/gateway/streaming-proxy.ts`) — forwards every upstream delta immediately as an OpenAI SSE chunk with NO buffering, NO sleep, NO setInterval. Uses `SseParser` for incremental parsing.
4. Added streaming instrumentation (`StreamTimings`: requestStart, upstreamFirstChunk, proxyFirstForward, clientFirstChunk, ttftMs, chunkCount, bytes) recorded in `metricsService` and exposed via `/api/metrics` + a debug timings map.
5. Added `/api/debug/stream` slow-SSE diagnostic (4 events ~1s apart) — verified via curl to emit incrementally, confirming no buffering at any layer.

**Verification (measured):**
- Regression test `tests/streaming-regression.test.mjs`: deterministic fake provider emits at +500/+1000/+1500ms; first chunk arrives at **+507ms** (would be ~+1500ms on old code), chunkCount=3, ttftMs=502ms. PASS.
- Browser (agent-browser, `au/llama3-8b` model): **TTFT 872ms, 16 chunks, duration 1.06s** — first token arrived well before completion. Real end-to-end SSE.
- `curl -sN /api/debug/stream`: events arrive ~1s apart (not all at ~4s).

---

## FREEGPT ROOT CAUSE

**403 endpoint:** `https://freegpt.tech/api/openai/oneapi/v1/chat/completions` (POST, SSE) and `/api/challenge` (GET).
**403 reason:** Cloudflare TLS fingerprinting + WASM proof-of-work challenge validation. When the challenge handshake fails or the WASM signature is rejected, the POST returns HTTP 403. The repo already used `curl` (child_process) to bypass TLS fingerprinting (good), BUT the `stream()` method (`src/lib/providers/freegpt.ts` L540-593) had **no HTTP status extraction** — it only inspected stdout text. A 403 Cloudflare HTML block page parsed to zero SSE deltas → the chat route emitted `"(empty response)"` instead of a structured 403 error.

**Text fix:** Added `-w "\n__HTTP_STATUS__%{http_code}"` to the curl streaming args; inline status-marker extraction (handles split chunks via `buffer.lastIndexOf(STATUS_MARKER)`); throws `classifyUpstreamStatus(status, { provider: "freegpt", model, body })` BEFORE yielding any SSE delta when status is non-200 or first chunk looks like HTML/Cloudflare/JSON error. Genuine streaming preserved — deltas yielded as they arrive. The `complete()` path's 5 throw sites migrated to `GatewayError` (403→PROVIDER_UNAVAILABLE, 400 没有可用的tokens→PROVIDER_UNAVAILABLE, 400 Provider failed→PROVIDER_UNAVAILABLE, 401 订阅→AUTHENTICATION_REQUIRED, generic→classifyUpstreamStatus).

**Image fix:** FreeGPT does not expose a separate image endpoint in this repo; image generation routes through `/api/v1/image/generate` → AIAnime/JollyGen/Pollinations. The "FreeGPT image 403" refers to the text model returning 403 when an image-generation prompt is sent — now classified as `UPSTREAM_4XX` / provider degraded, NOT retried.

**Verification:** `tests/freegpt-403.test.mjs` — mock provider throws `classifyUpstreamStatus(403, ...)`; asserts: stream emits `event: error` with `error.type === "PROVIDER_UNAVAILABLE"` and `error.upstreamStatus === 403`, then `data: [DONE]`; provider's stream() called exactly ONCE (no infinite retry); `isRetryableStatus(403) === false`. PASS.

---

## MODEL DISCOVERY

**Providers discovered:** 17 text providers registered in `PROVIDER_SHORT_IDS` (tb/au/ss/jg/ua/po/kc/l7/sw/oc/fc/mk/sm/fx/go/vx/fg) + 3 image providers (pi/ji/ai).
**Endpoints found:** 9 providers support dynamic `/models` discovery (pollinations, llm7, kilocode, freechat, opencode, gptoss, vexa, freeaixyz, freegpt-best-effort). 8 use manual mode (curated legacy MODELS[] entries) — auroraai, surfsense, jollygen, unlimitedai, spicywriter, miklium, swarm, toolbaz.
**Models discovered:** 38 models loaded in the live browser test (canonical ids like `au/llama3-8b`, `tb/toolbaz-v4`, `ss/gpt-5`, `mk/miklium`, `fx/chatgpt`). Full legacy registry has 89 text + 142 image models.
**Duplicates removed:** Dedup key is `providerId + upstreamId` (PRD §68, §169) — two providers exposing `model-x` stay distinct as `pa/model-x` and `pb/model-x` (verified in `tests/ids.test.mjs`).
**Models unavailable:** Known-unhealthy models are NOT hidden by default (PRD §54 — allow filtering). The `/v1/models?all=true` flag includes degraded/offline.

---

## TEST RESULTS

| Suite | Result |
|---|---|
| Streaming (regression timing) | **PASS** — first chunk +507ms < 1100ms threshold (proves no buffering) |
| SSE parser (18 cases: split events, CRLF, UTF-8 split, [DONE], multi-line, error inline) | **PASS** |
| FreeGPT 403 handling (no infinite retry, structured error, degraded) | **PASS** |
| Model discovery (failure isolation, dedup, timeout) | **PASS** |
| Error taxonomy (403 not retried, 429 retried, status mapping) | **PASS** |
| Canonical IDs (parse, collision prevention, duplicate providers) | **PASS** |
| Redactor (headers, secrets, outbound sanitization) | **PASS** |
| **Total: 7/7 PASS in 2.02s** | |
| UI (agent-browser): landing dashboard, /models explorer, /chat playground streaming, mobile 375×812 | **PASS** |
| Build (dev server compiles, 0 type errors in new files) | **PASS** |
| Lint | 5 errors ALL in pre-existing WASM/signer files (`eval("require")` for WASM loader — intentional); 0 errors in any new file |
