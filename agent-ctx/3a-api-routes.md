# Task 3-a — API routes (refactored + new)

## Files modified
- `src/app/api/v1/models/route.ts` — dynamic catalog from `catalogStore.getCatalog().models`; supports `?health=true` (capabilities + status + context_window + last_verified + discovery metadata) and `?all=true` (include offline models — PRD §54). OpenAI-shaped `{object:"list", data:[{id, object:"model", created, owned_by}]}` (PRD §49, §166).
- `src/app/api/v1/chat/completions/route.ts` — **THE STREAMING FIX** (PRD §137, §238). NEW gateway path for canonical ids (`fg/gpt-5`, `tb/gpt-5`, `l7/gpt-oss-20b`) via `resolveAdapterForModel()` → `streamChat(req, adapter)` (Phase 2a streaming-proxy) OR `adapter.complete(req)`. LEGACY fallback for old-style ids (`fgpt-gpt-5-5`, `oc-big-pickle`) via `resolveGatewayModel()` + `getProvider()`. **REMOVED**: `streamText()`, `tokenizeForStream()`, `chunkString()`, `sleep()`, the `isRealStreamProvider()` non-real-stream branch's re-pacing, and the `setInterval(heartbeat, 500)` (it could buffer). **REPLACED** the non-real-stream branch with: collect full text from `provider.stream()`, emit ONE content chunk + stop chunk (PRD §137 — honest, not fake-streamed). Real-stream providers (auroraai/surfsense/jollygen/unlimitedai/pollinations/kilocode/llm7/spicywriter/opencode/freechat/swarm/gptoss/vexa) — kept the immediate-delta-forwarding. Errors now via `gatewayErrorResponse(GatewayError)` + `sseErrorEvent(GatewayError)` (structured envelope PRD §146). Legacy freegpt/freeaixyz special-proxy branch kept for legacy ids (Phase 2b freegpt fix surfaces 403 as GatewayError through the proxy).

## Files created
- `src/lib/gateway/route-helpers.ts` — `ensureGateway()` (idempotent `initGateway()`), `resolveAdapterForModel(publicId)` (catalog + registry lookup → `{model, adapter} | null`), `parseModelParam(param)`.
- `src/app/api/providers/route.ts` — GET `{providers: [{id, shortId, name, status, models, streamingModels, imageModels, lastDiscovery, lastHealthCheck, latencyMs}]}` (PRD §88, §218).
- `src/app/api/models/route.ts` — GET `{lastUpdated, catalogStale, models: [<full DiscoveredModel>]}` + `?provider=`, `?capability=`, `?status=`, `?q=` filters (PRD §50, §217).
- `src/app/api/models/[...id]/route.ts` — catch-all (canonical ids contain `/` so `[...id]` accepts both `tb/gpt-5` and `tb%2Fgpt-5`). Returns full DiscoveredModel + health + provider info; 404 MODEL_NOT_FOUND if not found (PRD §90).
- `src/app/api/debug/stream/route.ts` — GET 4 SSE events ~1s apart + `[DONE]`. Headers disable all known SSE-buffering layers (PRD §15, §16). Confirms NO buffering at any layer between runtime and client (verified via timestamped curl).
- `src/app/api/metrics/route.ts` — GET `{metrics: <ApiMetrics>, streamTimings: <StreamTimings[]>}` (PRD §115).
- `src/app/api/discovery/refresh/route.ts` — POST `{provider?: "fg"|"freegpt"}` → `discoverAll()` or `discoverProvider(id)`; resolves shortId → providerId; returns `{ok: true, results: <DiscoveryResult[]>}` (PRD §113, §173).
- `src/app/health/route.ts` — GET `{application, database, providers:{healthy,degraded,offline,total}, discovery, ready}` (PRD §86).
- `src/app/ready/route.ts` — GET `{ready: true}` 200 if catalog loaded even partially, else 503 (PRD §87).

## Public API surface for Phase 4 frontend
- `GET /api/v1/models` — OpenAI-shaped list (works with OpenAI client libraries as-is)
- `GET /api/v1/models?health=true` — adds capabilities/status/context_window/last_verified
- `GET /api/v1/models?all=true` — include degraded/offline models
- `POST /api/v1/chat/completions` — accepts BOTH canonical (`fg/gpt-5`) and legacy (`fgpt-gpt-5-5`) ids
- `GET /api/models` — richer listing with capabilities + health + lastVerified
- `GET /api/models/{shortId}/{upstreamId}` — catch-all, returns full DiscoveredModel
- `GET /api/providers` — provider grid (model counts + statuses + latencies)
- `GET /api/metrics` — admin/debug dashboard (TTFT, error rate, recent errors, stream timings)
- `GET /api/debug/stream` — slow-SSE buffering diagnostic
- `GET /health` + `GET /ready` — status page / orchestrator probes
- `POST /api/discovery/refresh` with `{provider?}` — admin "refresh now" button

## Structured error envelope (PRD §146)
`{error: {type, message, provider, model, request_id, code, status, upstreamStatus?}}` — emitted by:
- `gatewayErrorResponse(GatewayError)` for HTTP-level errors (route entry / non-stream path)
- `sseErrorEvent(GatewayError)` for in-stream errors (canonical-id streaming path goes through streaming-proxy; legacy-id streaming path's catch block now uses `sseErrorEvent`)

Note: legacy freegpt-proxy route (`/api/v1/chat/freegpt-proxy`) still emits the OLD shape `{error: {message, type, code}}`. Out of scope per spec — don't touch it.

## Lint / TypeScript status
- `bun run lint`: 5 errors ALL in PRE-EXISTING files I do NOT own (freeaixyz-proxy route, freegpt-signer.cjs, freegpt-wasm.js — `require()` style imports). My files: ZERO lint errors.
- `npx tsc --noEmit`: ZERO TypeScript errors in my files (after fixing one `ModelHealthEntry | undefined → | null` mismatch in `/api/models/[...id]`).

## curl verification results
- `GET /health` → 200 `{"application":"ok","database":"ok","providers":{"healthy":0,"degraded":0,"offline":0,"total":17},"discovery":"ok","ready":true}`
- `GET /ready` → 200 `{"ready":true}`
- `GET /api/debug/stream` (timestamped curl -sN) → events arrive INCREMENTALLY: `05:25:55.582 [event 1]` → `56.582 [2]` → `57.582 [3]` → `58.584 [4]` → `59.584 [DONE]`. NO buffering at any layer.
- `GET /api/v1/models` → OpenAI-shaped list with canonical ids (`tb/toolbaz-v4.5-fast`, etc.)
- `GET /api/v1/models?health=true` → adds capabilities/status/context_window/last_verified
- `GET /api/models` → extended catalog with full DiscoveredModel objects
- `GET /api/models/tb/gpt-5` (catch-all) → 200 full model detail JSON
- `GET /api/models/nonexistent` → 404 structured `{error:{type:"MODEL_NOT_FOUND",...}}`
- `GET /api/providers` → provider listing with model counts + statuses
- `GET /api/metrics` → `{metrics: {...}, streamTimings: []}`
- `POST /api/discovery/refresh {}` → `{ok:true, results:[<DiscoveryResult[]>]}`
- `POST /api/v1/chat/completions` (canonical `tb/gpt-5` stream:true) → ONE content chunk + stop + [DONE] (no fake re-pacing — PRD §137 fix verified)
- `POST /api/v1/chat/completions` (canonical `l7/gpt-oss-20b` stream:true, upstream 401) → role chunk + structured SSE error event + [DONE] — streaming-proxy surfaces the upstream error immediately
- `POST /api/v1/chat/completions` (legacy `fgpt-gpt-5-5` stream:true) → goes through freegpt-proxy, returns the legacy OAI error envelope — backward-compat preserved
