# Task 2-a — Gateway services

## Files created (all under `src/lib/gateway/`)
- `adapters/legacy.ts` — legacy Provider → ProviderAdapter wrapper
- `catalog.ts` — ModelCatalogStore singleton
- `registry.ts` — ProviderRegistry singleton
- `discovery.ts` — ModelDiscoveryService singleton
- `health.ts` — ProviderHealthService singleton (circuit breaker)
- `verification.ts` — ModelVerificationService singleton
- `streaming-proxy.ts` — StreamingProxyService singleton + `streamChat()` functional entry-point
- `metrics.ts` — MetricsService singleton
- `startup.ts` — `initGateway()` + `isGatewayReady()`
- `index.ts` — barrel

## Public singletons (all exported from `@/lib/gateway`)
- `initGateway()` — idempotent; call at top of route module or in `app/api/v1/.../route.ts` before any catalog access
- `isGatewayReady()` — boolean
- `catalogStore.getCatalog()` / `.getModel(publicId)` / `.resolveModel(publicId)` / `.getProviderModels(providerId)` / `.getProviderHealth(providerId)` / `.getModelHealth(publicId)`
- `providerRegistry.get(providerId)` / `.getByShortId(shortId)` / `.list()` / `.resolveShortId(shortId)`
- `streamChat(req, adapter)` → `{ response: Response, timings: StreamTimings }`
- `streamingProxyService.getTimings(requestId)` / `.listTimings()` (debug UI)
- `metricsService.getMetrics()` / `.getStreamTimings()` / `.recordRequest(metric)`
- `providerHealthService.checkProvider(providerId)` / `.isOpen(providerId)` / `.recordProviderSuccess(id)` / `.recordProviderFailure(id, err)` / `.recordModelSuccess(publicId)` / `.recordModelFailure(publicId, err)` / `.getModelHealth(publicId)`
- `modelDiscoveryService.discoverAll()` / `.discoverProvider(providerId)`
- `modelVerificationService.verifyModel(publicId)` / `.verifyProviderModels(providerId)`

## Helpers / constants (also exported from barrel)
- `STREAM_HEADERS` — SSE response headers (Content-Type, Cache-Control, Connection, X-Accel-Buffering:no, X-No-Buffer:true)
- `canonicalModelId(providerId, upstreamId)` — builds `<shortId>/<upstreamId>`
- `parseCanonicalModelId(publicId)` — returns `{ providerId, upstreamId } | null`
- `classifyUpstreamStatus(status, ctx)` — maps HTTP status → GatewayError
- `errorResponse(err)` — JSON Response from a GatewayError
- `sseErrorEvent(err)` — `event: error\ndata: {...}\n\n` string

## Lint / TypeScript status
- `bun run lint` — gateway files PASS. 5 pre-existing errors are in files I do NOT own: `src/app/api/v1/chat/freeaixyz-proxy/route.ts` (require() import), `src/lib/freegpt-signer.cjs` (require x2), `src/lib/freegpt-wasm.js` (require x2). Those are Phase 2b / Phase 3a territory.
- `npx tsc --noEmit` — gateway files ZERO errors after indirecting the dynamic-import path for `src/lib/providers/dynamic-discovery.ts` (Phase 2b will create it) through a runtime variable so TypeScript and Turbopack both treat it as truly optional.

## Hand-off notes for Phase 3a (API routes)
- For `POST /api/v1/chat/completions`:
  1. `await initGateway();`
  2. `const model = catalogStore.resolveModel(body.model);` → if null, `throw new GatewayError({ type: "MODEL_NOT_FOUND", ... })` and return `errorResponse(err)`.
  3. `const adapter = providerRegistry.get(model.providerId);` → if missing, throw PROVIDER_NOT_FOUND.
  4. If `providerHealthService.isOpen(model.providerId)` → return 503 with a structured error.
  5. Build `ChatRequest`: `modelId: model.id, upstreamId: model.upstreamId, messages, stream: body.stream ?? false, signal: req.signal, temperature: body.temperature, maxTokens: body.max_tokens, tools: body.tools, toolChoice: body.tool_choice`.
  6. If `body.stream` → `const { response } = streamChat(chatReq, adapter); return response;` (already an SSE Response with correct headers).
  7. Else → `const { text } = await adapter.complete(chatReq);` and shape into OpenAI non-stream JSON `{ id, object: "chat.completion", choices: [{...}] }`.
- For `GET /api/v1/models`:
  - `await initGateway(); const { models } = catalogStore.getCatalog(); return Response.json({ object: "list", data: models.map(m => ({ id: m.id, object: "model", created: ..., owned_by: m.providerId })) });`
- For `GET /api/debug/stream`:
  - Return `{ metrics: metricsService.getMetrics(), timings: streamingProxyService.listTimings(), streams: metricsService.getStreamTimings() }` for the slow-SSE diagnostic UI.
- For admin refresh routes (`POST /api/admin/discover`, `POST /api/admin/discover/:providerId`):
  - `await modelDiscoveryService.discoverAll()` (or `discoverProvider(id)`), return the results.

## Phase 2b hand-off (FreeGPT adapter)
- Phase 2b should either:
  - call `providerRegistry.registerDynamicDiscoverer("freegpt", async (id) => { ... return ProviderAdapter; })` from anywhere it imports `@/lib/gateway`, OR
  - create `src/lib/providers/dynamic-discovery.ts` exporting `registerDynamicDiscoverers(registry)` which does the same thing — startup.ts will pick it up automatically via dynamic import.
- The discoverer must return a `ProviderAdapter` whose `stream()` yields genuine upstream deltas (PRD §137) and `discoverModels()` returns DiscoveredModel[] for FreeGPT's MODELS[] entries.
