# Task: api-key-feature — BYOK (Bring Your Own Key) for Z.AI / OpenRouter / Groq

**Agent:** main
**Date:** 2025-01
**Project:** FreeAIXYZ gateway (Next.js 16)

## Summary

Added a "BYOK" (Bring Your Own Key) feature: users can supply their own API
keys (Z.AI JWT, OpenRouter key, Groq key) on `/settings` to unlock 9
powerful gated models. Keys are stored only in the browser's localStorage
and proxied through the gateway to the upstream API.

## What was done

### 1. `src/lib/providers/registry.ts`
- Added 3 new provider ids to `ProviderId` union: `"zai"`, `"openrouter-key"`, `"groq-key"`.
- Extended `GatewayModel` interface with two optional fields:
  - `requiresKey?: boolean`
  - `keyHeader?: string`
- Added a new `gated()` helper (similar to existing `tb`, `sw`, etc.) that
  stamps `requiresKey: true` and the appropriate `keyHeader`.
- Registered 9 new gated models:
  - Z.AI: `zai-glm-5-2`, `zai-glm-5-1`, `zai-glm-5-turbo`, `zai-glm-4-7`
    (upstream `glm-5.2`, `GLM-5.1`, `GLM-5-Turbo`, `glm-4.7`)
  - OpenRouter: `or-gpt-5`, `or-claude-sonnet-5`, `or-gemini-3-5-flash`
    (upstream `openai/gpt-5`, `anthropic/claude-sonnet-5`, `google/gemini-3.5-flash`)
  - Groq: `groq-llama-3-3-70b`, `groq-gpt-oss-120b`
    (upstream `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`)
- Added 3 new entries to `PROVIDER_INFO` for `zai`, `openrouter-key`, `groq-key`.

### 2. `src/lib/providers/gated.ts` (new file)
- `GATED_PROVIDERS` config object with `baseUrl`, `name`, `keyHeader` for each
  of the three gated backends (Z.AI → `https://chat.z.ai/api/v2`,
  OpenRouter → `https://openrouter.ai/api/v1`, Groq → `https://api.groq.com/openai/v1`).
- `GatedKeyMissingError` custom error class that bubbles up a clear message
  ("This model requires an API key. Go to /settings to add your {ProviderName} key.").
- `makeGatedProvider()` factory that:
  - Throws `GatedKeyMissingError` if `req.authToken` is empty.
  - Otherwise POSTs to the upstream `/chat/completions` endpoint with
    `Authorization: Bearer <key>` (and OpenRouter's recommended
    `X-Title` / `HTTP-Referer` headers).
  - Supports both non-streaming (JSON body, `choices[0].message.content`)
    and streaming (OpenAI SSE with `data:` lines and `[DONE]` terminator).
  - All three backends use the same OpenAI-compatible request/response shape;
    Z.AI's `/api/v2/chat/completions` is OpenAI-compatible at the wire level.
- Exports `zaiProvider`, `openRouterKeyProvider`, `groqKeyProvider` and a
  helper `isGatedProvider(id)`.

### 3. `src/lib/providers/index.ts`
- Imported and registered the three gated providers in the `PROVIDERS` map.
- Re-exported `isGatedProvider`, `GatedKeyMissingError`, `GATED_PROVIDERS`
  for the API route to use.

### 4. `src/app/api/v1/chat/completions/route.ts`
- In `POST`: after model resolution, if `isGatedProvider(model.provider)` is
  true, read the appropriate header (from `GATED_PROVIDERS[model.provider].keyHeader`).
  If absent/empty → return HTTP 401 with:
  ```json
  {"error":{"message":"This model requires an API key. Please go to /settings to add your {ProviderName} token.","type":"authentication_required","param":null,"code":"authentication_required"}}
  ```
- Pass the extracted key as `authToken` to both `jsonCompletion` and
  `streamCompletion`, which forward it to `provider.complete` /
  `provider.stream`.
- Added `"zai"`, `"openrouter-key"`, `"groq-key"` to the `realStream` allowlist
  so the streaming path calls `provider.stream()` (real SSE) instead of the
  re-paced non-streaming fallback.
- Updated `upstreamErrorResponse()` to:
  - Surface `GatedKeyMissingError` as a 401 (defense-in-depth — the route
    already short-circuits earlier).
  - Detect upstream HTTP 401/403 from gated providers and return them as
    `authentication_required` 401s with the upstream error text (so users
    get a meaningful "Z.AI returned HTTP 401: ..." message instead of a
    generic 502).

### 5. `src/app/settings/page.tsx`
Rewrote to add an "API Keys" section at the top with:
- 3 input fields (Z.AI JWT, OpenRouter key, Groq key), each with:
  - Show/hide password toggle (Eye / EyeOff icons).
  - "configured" / "not set" status badge.
  - Per-provider instructions:
    - Z.AI: "Go to chat.z.ai, log in, open DevTools → Application → Local Storage → token"
    - OpenRouter: "Go to openrouter.ai/keys and create a key"
    - Groq: "Go to console.groq.com/keys and create a key"
  - External link chip to the provider's key page.
  - "Test" button that sends a real chat-completion request through the
    gateway using the user's key + a fast model (`zai-glm-5-turbo`,
    `or-gemini-3-5-flash`, `groq-llama-3-3-70b`) and shows a toast with
    the response or the upstream error.
  - "Clear" button (shown when key is set).
- "Save keys" button writes to `localStorage["freeaixyz_api_keys"]` as
  `{zai, openrouter, groq}` JSON.
- The "Provider Status" overview was updated to include Z.AI (4 models, BYOK),
  OpenRouter (3 models, BYOK), Groq (2 models, BYOK).
- Kept the existing free-models / music-generation / "view all models"
  sections (the original "No API keys needed!" banner was rewritten to
  "No key required for free models" since some models now DO require keys).
- All visuals match the existing design (white bg, black text, orange
  `#ff9a3c` accent, framer-motion entrance animations, rounded-2xl cards).

### 6. `src/app/chat/page.tsx`
- Imported `findModel` from `@/lib/providers` and added the helpers
  `loadApiKeys()`, `buildKeyHeaders(modelId)`, `missingKeyName(modelId)`
  that read `localStorage["freeaixyz_api_keys"]` and map gated provider ids
  → their respective header names (`x-zai-token`, `x-openrouter-key`,
  `x-groq-key`).
- `sendChat` now spreads the result of `buildKeyHeaders(model)` into the
  request headers — so the user's key is sent on every chat request to the
  gateway, and the gateway proxies it upstream.
- Error handling: `sendChat` now parses the JSON error body when `!res.ok`
  and surfaces `error.message` (e.g. "This model requires an API key...")
  in the thrown Error / toast.
- `send()` blocks early with a toast if `missingKeyName(model)` is truthy
  (no point sending a request that's guaranteed to 401).
- Added a clickable banner (renders between the model selector bar and the
  messages list) shown only when `mounted && missingKeyName(model)`:
  orange-tinted, with Key + AlertCircle icons, linking to `/settings` with
  the call-to-action "Click here to add one."
- Added `Key` and `AlertCircle` to the lucide-react import list.

### 7. `src/components/landing/models-showcase.tsx`
- Added `Key` to the lucide-react import list.
- Added 3 entries to `PROVIDER_COLORS`:
  - `zai: "text-emerald-500"`
  - `"openrouter-key": "text-indigo-500"`
  - `"groq-key": "text-teal-500"`
- Restructured the model-card header to stack the category badge above a
  new "BYOK" badge (orange-tinted, with Key icon) shown only when
  `m.requiresKey === true`. Hovering the BYOK badge shows a tooltip with
  the provider name and the expected header name.

## Verification

- `bun run lint` → 0 errors, 0 warnings.
- `npx tsc --noEmit` → exit 0, 0 errors.
- Dev server compiles cleanly (`✓ Compiled in …` repeated in `dev.log`).
- Live HTTP smoke tests against `http://localhost:3000`:
  - `GET /` → 200
  - `GET /settings` → 200 (renders API Keys section, BYOK badge)
  - `GET /chat` → 200
  - `GET /models` → 200
  - `GET /api/v1/models` → 200, 60 models, including all 9 new gated ids.
  - `POST /api/v1/chat/completions` with `model="zai-glm-5-turbo"` and no
    key header → HTTP 401 with:
    `{"error":{"message":"This model requires an API key. Please go to /settings to add your Z.AI token.","type":"authentication_required","param":null,"code":"authentication_required"}}`
  - Same with `model="or-gpt-5"` and no key → 401 with OpenRouter message.
  - Same with a fake `x-zai-token` header → 401 with the upstream rejection
    message (`Z.AI returned HTTP 401: {"detail":"401 Unauthorized"}`).
  - Free model `toolbaz-v4.5-fast` still returns 200 (no regression).

## Files changed

1. `src/lib/providers/registry.ts` — added 3 provider ids, 9 gated models,
   `gated()` helper, `requiresKey`/`keyHeader` fields on `GatewayModel`,
   3 new `PROVIDER_INFO` entries.
2. `src/lib/providers/gated.ts` — **new file**. Gated provider with
   `GATED_PROVIDERS` config, `GatedKeyMissingError`, and a
   `makeGatedProvider()` factory producing the 3 provider instances.
3. `src/lib/providers/index.ts` — registered the 3 gated providers in
   `PROVIDERS` and re-exported gated helpers.
4. `src/app/api/v1/chat/completions/route.ts` — extract API-key header,
   return 401 if missing, pass `authToken` through, added gated ids to
   `realStream`, enhanced `upstreamErrorResponse()` to handle
   `GatedKeyMissingError` + upstream 401/403.
5. `src/app/settings/page.tsx` — added "API Keys" section with 3 inputs,
   show/hide toggle, Test button, Save button, Clear button, instructions
   for each provider, and updated Provider Status table.
6. `src/app/chat/page.tsx` — `loadApiKeys` / `buildKeyHeaders` /
   `missingKeyName` helpers, key headers added to chat request, early
   block + toast when key missing, clickable BYOK banner above messages.
7. `src/components/landing/models-showcase.tsx` — added 3 new provider
   colors + BYOK badge on gated model cards.

## Security / privacy notes

- API keys are stored **only** in the user's browser localStorage under the
  key `freeaixyz_api_keys`. They are never persisted to any server-side
  database or log.
- The gateway acts as a proxy: it forwards the key directly to the upstream
  provider's API (Z.AI / OpenRouter / Groq) as `Authorization: Bearer <key>`.
  The key is not stored, cached, or routed to any third party.
- The chat page never sends a key header for a non-gated model —
  `buildKeyHeaders()` returns `{}` unless `model.requiresKey && model.keyHeader`
  match a known gated provider.

Stage Summary:
- 9 new gated models across 3 new providers (Z.AI, OpenRouter, Groq).
- Full BYOK UX: settings page entry, chat page banner + header injection,
  gateway-side 401 with clear actionable error, upstream error surfacing.
- `bun run lint` clean, `npx tsc --noEmit` clean, dev server compiles
  cleanly, all routes return 200, gated endpoints return 401 as designed.
