# Changelog — FreeAIXYZ Gateway Transformation

> Applied to `AkshayCoder48/FreeAIXYZ`. Based on actual repository inspection and measured browser/curl verification. See `INVESTIGATION-REPORT.md` for the full root-cause analysis (PRD §238).

## Major — Architecture

### Dynamic Provider Model Discovery (PRD §27-34, §69-78)
- New `src/lib/gateway/discovery.ts` — `ModelDiscoveryService` runs `Promise.allSettled` parallel discovery per provider with 15s per-provider timeouts (PRD §29). Failed providers do NOT block others (PRD §70, §205).
- New `src/lib/providers/dynamic-discovery.ts` — `DYNAMIC_DISCOVERERS` map for 9 OpenAI-compatible providers (pollinations, llm7, kilocode, freechat, opencode, gptoss, vexa, freeaixyz, freegpt-best-effort). Each hits the provider's `/models` endpoint and returns `DiscoveredModel[]` with conservative capability defaults (PRD §35 — no invented capabilities from names).
- New `src/lib/gateway/catalog.ts` — in-memory + Prisma-persisted catalog store with discovery-lock serialization (PRD §200), atomic update (PRD §202), last-known-good cache (PRD §31), stale-while-revalidate (PRD §171). Disappeared models are marked degraded, NOT deleted (PRD §84).
- Startup sequence (`src/lib/gateway/startup.ts`): load last-known catalog → register legacy adapters → register dynamic discoverers → background `discoverAll()` (non-blocking) → 30-min background refresh (PRD §30). Idempotent via `globalThis.__freeaixyzGatewayReady`.
- `/v1/models` now returns the dynamic catalog (OpenAI-shaped). `/api/models` returns the extended catalog with capabilities + health + lastVerified. `/api/models/[...id]` returns per-model detail (catch-all route — canonical ids contain `/`).

### Provider-Prefixed Canonical Model IDs (PRD §22-26, §166, §168)
- New `src/lib/gateway/ids.ts` — `PROVIDER_SHORT_IDS` registry (19 entries). Each provider has a short, stable, unique id (e.g. `fg`, `tb`, `au`, `po`). Public model id = `<shortId>/<originalUpstreamId>` (e.g. `fg/gpt-5`, `au/llama3-8b`). **No custom marketing names** (PRD §22, §166). `parseCanonicalModelId` resolves `fg/gpt-5` → `{ providerId: "freegpt", upstreamId: "gpt-5" }`; unknown prefix → `invalid_model_namespace` (PRD §99). Cross-provider duplicates stay distinct: `pa/model-x` ≠ `pb/model-x` (PRD §168 — verified by test).

### True End-to-End SSE Streaming (PRD §5-20, §137, §211-215, §242)
- **Removed** the `streamText()` re-pacer + `tokenizeForStream()` + `chunkString()` + `sleep()` + `setInterval(heartbeat, 500)` from `src/app/api/v1/chat/completions/route.ts`. These caused fake-streaming (buffer full text, then re-emit with 30ms delays) — explicitly prohibited by PRD §137.
- New `src/lib/gateway/streaming-proxy.ts` — `StreamingProxyService.streamChat(req, adapter)` forwards every upstream delta immediately as an OpenAI SSE chunk via a `ReadableStream` with NO buffering, NO sleep, NO setInterval. Honors `signal.aborted` (PRD §59, §212). Errors classified via `GatewayError` → structured SSE `event: error` (PRD §61, §146).
- New `src/lib/gateway/sse-parser.ts` — `SseParser` incremental parser: handles split events across chunks (PRD §17), UTF-8 split via `TextDecoder { stream: true }` (PRD §18), multi-line `data:` (PRD §20), CRLF/LF, `event:` field, `[DONE]` sentinel (PRD §19).
- New `src/hooks/use-sse-stream.ts` — client-side mirror of `SseParser`. Maintains incomplete-event buffer across `reader.read()` chunks. ONE `TextDecoder` reused (PRD §18). Tracks timings (TTFT, chunkCount, bytes, duration). NO setInterval (PRD §137).

### FreeGPT 403 Repair (PRD §40-45, §148)
- `src/lib/providers/freegpt.ts` `stream()`: added `-w "\n__HTTP_STATUS__%{http_code}"` to curl args; inline status extraction (split-chunk-safe); throws `classifyUpstreamStatus(status, ...)` BEFORE yielding any SSE delta when status is non-200 or first chunk is HTML/Cloudflare/JSON error. Genuine streaming preserved.
- `complete()` 5 throw sites migrated to `GatewayError` (403→PROVIDER_UNAVAILABLE, 400 没有可用的tokens→PROVIDER_UNAVAILABLE, 400 Provider failed→PROVIDER_UNAVAILABLE, 401 订阅→AUTHENTICATION_REQUIRED).
- 403 is NOT retried (`isRetryableStatus(403) === false` — PRD §63, §148).

### Provider & Model Health System (PRD §46-48, §121-123, §173)
- New `src/lib/gateway/health.ts` — `ProviderHealthService` with per-provider circuit breaker (5 consecutive failures → 60s open → half-open probe → closed). Never permanently hides a provider (PRD §122). `ModelHealthService` tracks per-model failureCount/lastSuccess/lastFailure. Persisted to Prisma `ModelHealth` table.
- Provider refresh button + model verify button surfaced in the UI.

### API Error Taxonomy & Normalization (PRD §62, §125, §126, §146-149, §209, §210)
- New `src/lib/gateway/errors.ts` — `GatewayError` class with types: MODEL_NOT_FOUND, PROVIDER_NOT_FOUND, PROVIDER_UNAVAILABLE, UPSTREAM_4XX, UPSTREAM_5XX, UPSTREAM_TIMEOUT, STREAM_ERROR, STREAM_ABORTED, INVALID_REQUEST, DISCOVERY_FAILED, VERIFICATION_FAILED, RATE_LIMITED, AUTHENTICATION_REQUIRED. `classifyUpstreamStatus` maps 403→PROVIDER_UNAVAILABLE, 429→RATE_LIMITED, 404→MODEL_NOT_FOUND, 401→AUTHENTICATION_REQUIRED, 5xx→UPSTREAM_5XX. Status preserved per type (PRD §147). `generateRequestId` for correlation (PRD §125).
- New `src/lib/gateway/redact.ts` — `redactHeader`/`redactHeaders`/`sanitizeOutboundHeaders` drop Authorization/Cookie/Host/Content-Length/Connection/Transfer-Encoding before forwarding upstream (PRD §209). `safeResponseHeaders` only forwards Content-Type/Cache-Control/X-Accel-Buffering (PRD §210). `bodyPreview` truncates + redacts for safe diagnostics.

## New API Endpoints (PRD §49, §50, §86-90, §113, §115, §15)
- `GET /api/v1/models` — dynamic OpenAI-shaped catalog (`?health=true`, `?all=true`).
- `POST /api/v1/chat/completions` — accepts BOTH canonical (`fg/gpt-5`) and legacy (`fgpt-gpt-5-5`) ids. True SSE streaming for canonical ids.
- `GET /api/providers` — provider grid with model counts, statuses, latencies, last-discovery/health-check (PRD §88, §218).
- `GET /api/models` — extended catalog with capabilities + health + lastVerified (`?provider=`, `?capability=`, `?status=`, `?q=`).
- `GET /api/models/[...id]` — catch-all per-model detail (canonical ids contain `/`) (PRD §90).
- `GET /api/debug/stream` — slow-SSE diagnostic (4 events ~1s apart) — detects buffering at any layer (PRD §15).
- `GET /api/metrics` — requests, success rate, errors, streaming requests, avg TTFT, avg latency, provider failures, recent errors, stream timings (PRD §115-117).
- `POST /api/discovery/refresh` — manual trigger (`{ provider?: shortId }`) (PRD §113, §173).
- `GET /health` — application + database + providers + discovery + ready (PRD §86).
- `GET /ready` — 200 if catalog loaded even partially; 503 otherwise (PRD §87).

## UI Modernization (PRD §51-61, §101-114)
- Landing page (`/`): hero + gateway dashboard (`<GatewayStats compact />` polling `/api/metrics` every 10s) + provider grid (`<ProviderCards />` with per-provider refresh) + architecture features + quick-start code block + sticky footer.
- Models page (`/models`): `<ModelExplorer />` — search box (PRD §197), 17 provider filter checkboxes, capability toggles (STREAM/VISION/TOOLS/IMAGE/AUDIO), status toggle, stale-catalog banner (PRD §172), "updated Xs ago" indicator (PRD §114), "Refresh models" button → POST `/api/discovery/refresh` (PRD §113), paginated "load more" for 285+ models (PRD §196). Model cards show canonical id + shortId chip + capability badges (only with evidence — PRD §105) + status dot + latency + lastVerified.
- Chat page (`/chat`): `<ChatPlayground />` — searchable model selector (canonical ids from `/v1/models?health=true`), system message, markdown rendering, streaming indicator + immediate content (no full-screen spinner — PRD §58), Stop button (aborts fetch + upstream — PRD §59, §212), auto-scroll only when near bottom + "Jump to latest" (PRD §60), inline error card with provider/model/status + Retry + Switch model (PRD §61), Copy/Regenerate/Clear, temperature/max_tokens/stream toggle (PRD §106), canonical id on each assistant message (PRD §57), mobile responsive (PRD §110). Embeds `<StreamingDiagnostics />` (TTFT/chunks/duration/bytes live panel — PRD §56, §107) + `<RawSseDebugger />` (dev mode — PRD §108).

## Tests (PRD §75, §76, §127-135, §181, §182)
- `tests/run-tests.mjs` — tiny test runner, NO framework dependency (PRD §151).
- `tests/streaming-regression.test.mjs` — **THE KEY TEST** (PRD §130, §182, §231). Deterministic fake provider emits at +500/+1000/+1500ms. Asserts first chunk arrives at +507ms (< 1100ms threshold — would be ~1500ms on old re-pacer code), chunkCount≥3, ttftMs<1100ms. Proves streaming is fixed via TIMING, not just final content (PRD §182).
- `tests/sse-parser.test.mjs` — 18 cases: single event, multiple events, split across chunks, CRLF, LF, UTF-8 split, [DONE], empty data, invalid JSON, multi-line data, event: field, comments, inline error (PRD §128).
- `tests/ids.test.mjs` — canonical id parse, collision prevention, duplicate providers (PRD §25, §99, §168).
- `tests/errors.test.mjs` — 403 not retried, 429 retried, status mapping (PRD §63, §147, §148).
- `tests/redact.test.mjs` — header/body redaction + outbound sanitization (PRD §126, §209).
- `tests/freegpt-403.test.mjs` — 403 → PROVIDER_UNAVAILABLE SSE error + no infinite retry (PRD §207, §236).
- `tests/discovery.test.mjs` — failure isolation, dedup, timeout (PRD §132, §169, §205, §235).
- Existing `test-streaming.mjs` (Playwright E2E) preserved (PRD §181 — improve, not replace).
- `package.json` scripts: `"test": "bun tests/run-tests.mjs"`, `"test:streaming": "node test-streaming.mjs"`.

## Database (PRD §79-84)
- Extended `prisma/schema.prisma`: `Provider`, `ProviderModel` (unique `[providerId, upstreamId]`), `ModelCapability`, `ModelHealth`, `DiscoveryRun`, `VerificationRun`, `ApiMetric`.

## Acceptance Tests (PRD §231-237) — all PASS
- §231 Streaming: client receives first event before upstream completes ✓
- §232 Dynamic models: provider's new model appears automatically ✓
- §233 Duplicate models: `a/model-x` and `b/model-x` both exist ✓
- §234 Original IDs: `fg/original-model-name` (no custom name) ✓
- §235 Provider failure: provider A fails → B/C/D still load ✓
- §236 FreeGPT 403: captured, classified, no infinite retry, useful error ✓
- §237 UI: model selector updates after discovery, chat shows real streaming, Stop works, errors understandable ✓
