# Provider & Model Documentation

> **Free AI API Gateway** — Aggregates 14+ free upstream providers behind an OpenAI-compatible API surface. No API keys, no signup, no billing. Just send OpenAI-format requests and get OpenAI-format responses.

**Stats:** 89 chat/text models + 16 text-to-image models across 14 text providers + 5 image providers.

---

## Table of Contents

1. [Overview](#overview)
2. [API Endpoints](#api-endpoints)
3. [Provider Catalog](#provider-catalog)
4. [Streaming Architecture](#streaming-architecture)
5. [Tool Calling / Function Calling](#tool-calling--function-calling)
6. [AIAnime Image Generation](#aianime-image-generation)
7. [Health Filtering](#health-filtering)
8. [Code Examples](#code-examples)

---

## Overview

This gateway is a Next.js API that aggregates multiple **free, no-auth AI providers** behind standard OpenAI-compatible endpoints. Any client that speaks the OpenAI chat completions API (curl, the OpenAI SDK, LangChain, etc.) can use this gateway without modification — just change the `base_url`.

### Key Design Principles

| Principle | Implementation |
|---|---|
| **OpenAI-compatible** | Standard `/v1/chat/completions` and `/v1/models` endpoints |
| **Zero auth** | No API keys required — providers use identity rotation, challenge handshakes, or are genuinely free |
| **Real streaming** | 12 of 14 text providers stream genuine upstream token deltas via SSE |
| **Tool calling for all** | Even non-native providers support tools via prompt-injection adapter |
| **Health filtering** | Known-broken models are hidden from `/models` by default |
| **IP rotation** | X-Forwarded-For spoofing + proxy pool rotation to bypass per-IP rate limits |

### Default Model

`oc-big-pickle` (OpenCode.ai auto-router) — falls back to Pollinations on 503.

---

## API Endpoints

### POST `/api/v1/chat/completions`

OpenAI-compatible chat completions with streaming and tool calling support.

**Request body** (OpenAI format):

```json
{
  "model": "oc-big-pickle",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": true,
  "tools": [],
  "tool_choice": "auto",
  "web_search": false
}
```

| Field | Type | Description |
|---|---|---|
| `model` | string | Gateway model ID (see `/models`) or any upstream model ID (passed through to OpenCode) |
| `messages` | array | OpenAI-format message array |
| `stream` | boolean | `true` = SSE stream, `false` = JSON response |
| `tools` | array | OpenAI-format tool definitions (optional) |
| `tool_choice` | string/object | `"auto"`, `"none"`, `"required"`, or `{function: {name}}` |
| `web_search` | boolean | Enable web-informed answers (models with `webSearch` capability use it natively) |

**Non-streaming response:**

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1723456789,
  "model": "oc-big-pickle",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "Hello! How can I help?"},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18}
}
```

**Streaming response:** SSE events (`text/event-stream`):

```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"oc-big-pickle","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"oc-big-pickle","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"oc-big-pickle","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Runtime:** `nodejs` | **Max duration:** 60s | **Force-dynamic**

---

### GET `/api/v1/models`

OpenAI-compatible model listing with optional health metadata.

| Parameter | Description |
|---|---|
| `?all=true` | Include known-unhealthy models (default: filtered) |
| `?health=true` | Include `health`, `capabilities`, `category`, `context_window`, `modality` fields |

**Response:**

```json
{
  "object": "list",
  "data": [
    {"id": "oc-big-pickle", "object": "model", "created": 1723456789, "owned_by": "opencode"},
    {"id": "fgpt-gpt-4o-mini", "object": "model", "created": 1723456789, "owned_by": "freegpt"}
  ]
}
```

With `?health=true`:

```json
{
  "id": "fxyz-claude",
  "health": "healthy",
  "capabilities": {"streaming": true, "tools": true, "systemPrompt": true, "multiTurn": true, "vision": true, "webSearch": true},
  "category": "professional",
  "context_window": 200000,
  "modality": "text"
}
```

---

### POST `/api/image-generate/text2image`

AIAnime text-to-image generation (accepts JSON, converts to form-urlencoded upstream).

**Request body:**

```json
{
  "prompt": "anime girl with blue hair",
  "negative_prompt": "blurry, low quality",
  "model_type": "anime_io",
  "aspect_ratio": "1:1"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | (required) | Text description of the image |
| `negative_prompt` | string | — | What to avoid in the image |
| `model_type` | string | `"anime_io"` | `"standard"`, `"pro"`, or `"anime_io"` |
| `aspect_ratio` | string | `"1:1"` | `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"` |

**Response** (async — includes job polling):

```json
{
  "code": 200,
  "result": {
    "job_id": "abc123",
    "free_limit_value": 1,
    "image_url": "https://...",
    "status": "completed"
  },
  "message": {}
}
```

---

### POST `/api/v1/search`

DuckDuckGo web search — returns titles, URLs, and snippets.

**Request body:**

```json
{
  "query": "latest AI news",
  "num": 8
}
```

**Response:**

```json
{
  "results": [
    {"title": "...", "url": "https://...", "snippet": "..."}
  ],
  "query": "latest AI news",
  "count": 8
}
```

Also supports `GET /api/v1/search?q=...&num=...`.

---

### POST `/api/v1/music/generate`

ACE-Step 1.5 AI music generation.

**Request body:**

```json
{
  "prompt": "Upbeat electronic dance track",
  "lyrics": "Dancing through the night...",
  "duration": 30,
  "language": "en",
  "instrumental": false,
  "bpm": 128
}
```

**Response:**

```json
{
  "success": true,
  "audios": [{"audio_base64": "...", "format": "mp3"}],
  "metadata": {...}
}
```

---

## Provider Catalog

### AuroraAI

| Property | Value |
|---|---|
| **Endpoint** | `POST https://www.nsfwlover.com/api/openai/chat/completions` |
| **Auth** | Per-request random `x-local-id` header (60-char alphanumeric) + random `session_id` |
| **Streaming** | Real upstream SSE — OpenAI-shaped `delta.content` chunks |
| **SSE Format** | `data: {"choices":[{"delta":{"content":"token"}}]}` — no explicit `[DONE]`, stream ends when connection closes |
| **Identity Rotation** | Fresh `x-local-id` and `session_id` per request — identities never accumulate state |
| **Rate Limits** | None observed with rotation |
| **Free Access** | Random identity per request — no signup, no quota |

**Models (1):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `aurora-l3-lunaris` | `llama3-8b` | unrestricted | 8K | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** The upstream expects a custom payload with `input_messages`, `char_id`, `session_id`, `sysprompt`, and `model_type`. System messages are collapsed into the `sysprompt` field. The `char_id`/`charname` must match (set to `"Linda"` for neutral behavior).

---

### SurfSense

| Property | Value |
|---|---|
| **Endpoint** | `POST https://api.surfsense.com/api/v1/public/anon-chat/stream` |
| **Auth** | None — anonymous, no login |
| **Streaming** | Real upstream SSE — custom format (NOT OpenAI-shaped) |
| **SSE Format** | `data: {"type":"text-delta","delta":"token"}` — also emits `start`, `data-thinking-step`, `text-start`, `text-end`, `finish` events |
| **Identity Rotation** | Not needed — fully anonymous |
| **Rate Limits** | Anonymous quota (generous, no observed limits) |
| **Free Access** | No signup, no login — anonymous endpoint |

**Models (2):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `gpt-5.4-mini` | `gpt-5.4-mini-no-login` | professional | 128K | streaming, tools, systemPrompt, multiTurn |
| `gpt-o4-mini` | `gpt-o4-mini-no-login` | reasoning | 128K | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** Custom SSE format — extracts `text-delta` events and yields their `delta` field. Error events (`type: "error"`) throw exceptions.

---

### JollyGen

| Property | Value |
|---|---|
| **Endpoint** | `POST https://jollygenapi.space/ai/chat-guest` |
| **Auth** | Per-request `guest_hash` (SHA-256 of random bytes + timestamp) |
| **Streaming** | Real upstream SSE — `{"delta": "token"}` format |
| **SSE Format** | `data: {"delta": "token"}` — ends with `data: {"done": true}` |
| **Identity Rotation** | Fresh SHA-256 `guest_hash` per request — each hash gets 3 free messages, rotation = unlimited |
| **Rate Limits** | 3 messages per guest hash — bypassed by generating a new hash every request |
| **Free Access** | Rotated guest identity — effectively unlimited |

**Models (1):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `jollygen-rp` | `jollygen` | unrestricted | 8K | streaming, systemPrompt, multiTurn |

**Implementation Details:** Takes a single `message` string — conversation history is folded into `[User]`/`[Assistant]` format. System messages are prepended. Handles 429 (quota on this hash) with retry using fresh identity.

---

### UnlimitedAI

| Property | Value |
|---|---|
| **Endpoint** | `POST https://app.unlimitedai.chat/api/chat` |
| **Auth** | None — no auth required |
| **Streaming** | Real upstream NDJSON — one JSON object per line |
| **SSE Format** | NDJSON: `{"type":"delta","delta":"token"}` — errors: `{"type":"error","error":"..."}` — no `[DONE]` marker |
| **Identity Rotation** | Fresh `chatId`, `deviceId`, and per-message `id` UUIDs per request |
| **Rate Limits** | None observed |
| **Free Access** | No signup, no auth, unrestricted |

**Models (2):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `unlimited-lustre-reasoning` | `chat-model-reasoning` | unrestricted | 128K | streaming, tools, systemPrompt, multiTurn |
| `unlimited-lustre-search` | `chat-model-reasoning-with-search` | unrestricted | 128K | streaming, tools, systemPrompt, multiTurn, webSearch |

**Implementation Details:** Messages are wrapped with `id`, `parts`, and `createdAt` fields. The payload includes `selectedChatModel`, `chatId`, and `deviceId` (all random UUIDs).

---

### Pollinations

| Property | Value |
|---|---|
| **Endpoint** | `POST https://text.pollinations.ai/v1/chat/completions` |
| **Models URL** | `GET https://text.pollinations.ai/models` |
| **Auth** | None — genuinely free, no-auth |
| **Streaming** | Real upstream SSE — standard OpenAI format |
| **SSE Format** | Standard OpenAI: `data: {"choices":[{"delta":{"content":"token"}}]}` → `data: [DONE]` |
| **Identity Rotation** | Not needed — genuinely free |
| **Rate Limits** | ~1 concurrent request per IP (queue) — includes retry logic with 2s/4s/6s backoff |
| **Free Access** | Unlimited, no signup, no key, instant (~0.3-1s TTFT) |

**Models (1):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `openai-fast` | `openai-fast` | reasoning | 128K | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** Passes `tools` and `tool_choice` natively. Retry logic: on 429 (queue full), retries up to 3 times with `2000 * (attempt + 1)` ms delay. Reasoning content (chain-of-thought) is ignored — only `delta.content` is yielded.

---

### Kilo Code

| Property | Value |
|---|---|
| **Endpoint** | `POST https://api.kilo.ai/api/gateway/chat/completions` |
| **Models URL** | `GET https://api.kilo.ai/api/gateway/models` |
| **Auth** | None — free tier, no key |
| **Streaming** | Real upstream SSE — OpenAI format via OpenRouter |
| **SSE Format** | OpenAI SSE with `: OPENROUTER PROCESSING` keep-alive comments before first token |
| **Identity Rotation** | Not needed — free tier |
| **Rate Limits** | Some models require paid auth (401) — retry on 429 with 2s/4s backoff |
| **Free Access** | 16 free models via OpenRouter free pool, no signup |

**Models (16):**

| Gateway ID | Upstream ID | Category | Context Window |
|---|---|---|---|
| `tencent-hy3` | `tencent/hy3:free` | professional | 262K |
| `nemotron-ultra` | `nvidia/nemotron-3-ultra-550b-a55b:free` | reasoning | 1M |
| `nemotron-super` | `nvidia/nemotron-3-super-120b-a12b:free` | professional | 1M |
| `nemotron-nano-omni` | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | reasoning | 256K |
| `nemotron-safety` | `nvidia/nemotron-3.5-content-safety:free` | sfw | 128K |
| `laguna-xs` | `poolside/laguna-xs-2.1:free` | professional | 262K |
| `laguna-m` | `poolside/laguna-m.1:free` | professional | 262K |
| `laguna-s` | `poolside/laguna-s-2.1:free` | professional | 262K |
| `cohere-north-code` | `cohere/north-mini-code:free` | professional | 256K |
| `kilo-auto-free` | `kilo-auto/free` | professional | 262K |
| `kilo-auto-frontier` | `kilo-auto/frontier` | professional | 262K |
| `kilo-auto-balanced` | `kilo-auto/balanced` | professional | 262K |
| `kilo-auto-efficient` | `kilo-auto/efficient` | professional | 262K |
| `kilo-auto-small` | `kilo-auto/small` | professional | 262K |
| `stepfun-step-37-flash` | `stepfun/step-3.7-flash:free` | professional | 262K |
| `ling-30-flash` | `inclusionai/ling-3.0-flash:free` | professional | 262K |

**All models have:** streaming, tools, systemPrompt, multiTurn

**Implementation Details:** Passes `tools` and `tool_choice` natively to OpenRouter. Native `tool_calls` deltas in SSE are converted to `{"__tool_calls": [...]}` JSON markers for gateway parsing.

---

### LLM7.io

| Property | Value |
|---|---|
| **Endpoint** | `POST https://api.llm7.io/v1/chat/completions` |
| **Auth** | None for free models (gpt-oss:20b, minimax-m2.7, codestral-latest); some models require token from dash.llm7.io |
| **Streaming** | Real upstream SSE — standard OpenAI format |
| **SSE Format** | OpenAI: `data: {"choices":[{"delta":{"content":"token"}}]}` → `data: [DONE]` |
| **Identity Rotation** | Not needed — anonymous access |
| **Rate Limits** | None observed for free models |
| **Free Access** | 3 models work anonymously, no key |

**Models (5):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `l7-gpt-oss-20b` | `gpt-oss:20b` | professional | 131K | streaming, tools, systemPrompt, multiTurn |
| `l7-codestral` | `codestral-latest` | professional | 256K | streaming, tools, systemPrompt, multiTurn |
| `l7-deepseek-v4-flash` | `deepseek-v4-flash:0731` | professional | 64K | streaming, tools, systemPrompt, multiTurn |
| `l7-gemini-3-1-flash-lite` | `gemini-3.1-flash-lite` | professional | 1M | streaming, tools, systemPrompt, multiTurn |
| `l7-minimax-m2-7` | `minimax-m2.7` | professional | 1M | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** Passes `tools` and `tool_choice` natively. Native `tool_calls` deltas are converted to `__tool_calls` JSON markers like Kilo Code.

---

### SpicyWriter

| Property | Value |
|---|---|
| **Endpoint** | `POST https://spicywriter.com/api/conversations/new` |
| **Auth** | Per-request `X-Anonymous-User-Id` header (format: `anon_XXXXXX`, 6 hex chars) |
| **Streaming** | Real upstream SSE — plain text deltas (NOT JSON) |
| **SSE Format** | `data:  text delta` (plain text after `data: `) — control events are JSON: `{"done":true}`, `{"conversationId":...}`, `{"type":"context_start"}` |
| **Identity Rotation** | Fresh anonymous user ID per call — each anon ID gets 5 free requests, rotation = unlimited |
| **Rate Limits** | 5 requests per anon ID — bypassed by generating new `anon_XXXXXX` every call |
| **Free Access** | Rotated anonymous identity — effectively unlimited, uncensored |

**Models (2):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `spicy-ling-2-6-flash` | `Ling 2.6 Flash` | unrestricted | 128K | streaming, tools, systemPrompt, multiTurn |
| `spicy-nemo` | `Nemo` | unrestricted | 128K | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** Messages are chained via `parent` field (message ID chain). System message has `id: 0`, subsequent messages use negative IDs (`-1`, `-2`, ...). The `submitMessageId` identifies the last message to respond to. Also sends `traceparent` (W3C trace) and `X-Client-Diag` headers. Leading spaces in SSE deltas are significant (word separators) — must not be trimmed. Literal `\n` in deltas is converted to actual newlines.

---

### FreeGPT.tech

| Property | Value |
|---|---|
| **Endpoint** | `POST https://standalone.freegpt.win:3001/api/openai/oneapi/v1/chat/completions` |
| **Challenge URL** | `GET https://standalone.freegpt.win:3001/api/challenge` |
| **Auth** | WASM-secured proof-of-work challenge handshake per request |
| **Streaming** | Real upstream SSE — standard OpenAI format |
| **SSE Format** | OpenAI: `data: {"choices":[{"delta":{"content":"token"}}]}` → `data: [DONE]` |
| **Identity Rotation** | Fresh UUID per request + WASM-signed proof-of-work |
| **Rate Limits** | 8 requests/minute per client IP (in-memory rate limiter) — many models also hit upstream rate limits or subscription walls |
| **Free Access** | WASM challenge handshake + UUID rotation — no API key, but strict upstream rate limits |
| **Runtime** | Node.js only (WASM signer requires `fs`, `path`, `jsdom`) — proxied via `/api/v1/chat/freegpt-proxy` |

**Challenge Handshake (per request):**

1. Generate fresh UUID
2. `GET /api/challenge` with `uuid` header → server returns challenge + difficulty
3. Run WASM signer (`wasm_signer_bg.wasm` + `freegpt-signer.cjs`) to compute signature, nonce, timestamp bound to (uuid, challenge, clientIp, difficulty)
4. `POST /api/openai/oneapi/v1/chat/completions` with all `x-secure-*` headers + empty `cf-turnstile-token`
5. Parse OpenAI-format response (streaming or non-streaming)

**Models (27 text + 3 image):**

| Gateway ID | Upstream ID | Category | Context Window |
|---|---|---|---|
| `fgpt-gpt-4o-mini` | `gpt-4o-mini` | professional | 128K |
| `fgpt-gpt-5-4-mini` | `gpt-5.4-mini` | professional | 128K |
| `fgpt-gpt-5-4-nano` | `gpt-5.4-nano` | professional | 128K |
| `fgpt-gpt-5-3-free` | `gpt-5.3-free` | professional | 128K |
| `fgpt-gpt-5-3-thinking-free` | `gpt-5.3-thinking-free` | reasoning | 128K |
| `fgpt-gpt-5-free` | `gpt-5-free` | professional | 128K |
| `fgpt-deepseek-v4-flash` | `deepseek-v4-flash` | professional | 64K |
| `fgpt-gpt-5-mini` | `gpt-5-mini` | professional | 128K |
| `fgpt-gpt-5-nano` | `gpt-5-nano` | professional | 128K |
| `fgpt-gemini-3-1-flash-lite` | `gemini-3.1-flash-lite-preview` | professional | 1M |
| `fgpt-grok-4-20-fast` | `grok-4.20-fast` | professional | 131K |
| `fgpt-llama-3-3-70b` | `Meta-Llama-3.3-70B-Instruct` | professional | 128K |
| `fgpt-qwen-3-5-397b` | `Qwen/Qwen3.5-397B-A17B` | professional | 262K |
| `fgpt-qwen-3-6-plus` | `qwen3.6-plus` | professional | 262K |
| `fgpt-grok-4` | `grok-4` | professional | 131K |
| `fgpt-deepseek-reasoner` | `deepseek-reasoner` | reasoning | 64K |
| `fgpt-gemini-2-5-flash` | `gemini-2.5-flash` | professional | 1M |
| `fgpt-gpt-4-1-mini` | `gpt-4.1-mini` | professional | 128K |
| `fgpt-gpt-4-1-nano` | `gpt-4.1-nano` | professional | 128K |
| `fgpt-deepseek-chat` | `deepseek-chat` | professional | 64K |
| `fgpt-gpt-3-5-turbo` | `gpt-3.5-turbo` | professional | 16K |
| `fgpt-grok-3` | `grok-3` | professional | 131K |
| `fgpt-grok-3-mini` | `grok-3-mini` | professional | 131K |
| `fgpt-gpt-5-4` | `gpt-5.4` | professional | 128K |
| `fgpt-gemini-2-5-pro` | `gemini-2.5-pro` | professional | 2M |
| `fgpt-grok-4-3` | `grok-4.3` | professional | 131K |
| `fgpt-gemini-3-1-flash-image` | `gemini-3.1-flash-image` | professional | 1M |

*Plus additional models that are marked KNOWN_UNHEALTHY (see [Health Filtering](#health-filtering)).*

**All text models have:** streaming, tools, systemPrompt, multiTurn

**Native tool calling:** Models `fgpt-gpt-5-4-mini`, `fgpt-llama-3-3-70b`, and `fgpt-qwen-3-6-plus` have native tool calling support. All others support tools via prompt injection.

**Implementation Details:** The WASM signer is loaded lazily on first request via `eval("require")` (to prevent webpack from bundling it into client code). The signer path is resolved absolutely using `process.cwd()` because Next.js bundles route handlers into chunks under `.next/dev/server/chunks/`. The FreeGPT provider is NOT in the Edge runtime PROVIDERS map — it's handled exclusively via the Node.js proxy route `/api/v1/chat/freegpt-proxy`.

---

### OpenCode.ai

| Property | Value |
|---|---|
| **Endpoint** | `POST https://opencode.ai/zen/v1/chat/completions` |
| **Models URL** | `GET https://opencode.ai/zen/v1/models` |
| **Auth** | None — free, no-auth, OpenAI-compatible |
| **Streaming** | Real upstream SSE — standard OpenAI format |
| **SSE Format** | OpenAI: `data: {"choices":[{"delta":{"content":"token"}}]}` → `data: [DONE]` |
| **Identity Rotation** | Not needed — genuinely free |
| **Rate Limits** | None observed |
| **Free Access** | No signup, no key, no rate limits |
| **Fallback** | On persistent 503 (up to 2 retries with 1s delay), falls back to Pollinations |

**Models (8):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `oc-big-pickle` | `big-pickle` | professional | 128K | streaming, tools, systemPrompt, multiTurn |
| `oc-deepseek-v4-flash-free` | `deepseek-v4-flash-free` | professional | 64K | streaming, tools, systemPrompt, multiTurn |
| `oc-mimo-v2-5-free` | `mimo-v2.5-free` | professional | 128K | streaming, tools, systemPrompt, multiTurn |
| `oc-ling-3-0-flash-free` | `ling-3.0-flash-free` | professional | 262K | streaming, tools, systemPrompt, multiTurn |
| `oc-ling-3-0-tiny-free` | `ling-3.0-tiny-free` | professional | 262K | streaming, tools, systemPrompt, multiTurn |
| `oc-nemotron-3-ultra-free` | `nemotron-3-ultra-free` | reasoning | 1M | streaming, tools, systemPrompt, multiTurn |
| `oc-laguna-s-2-1-free` | `laguna-s-2.1-free` | professional | 262K | streaming, tools, systemPrompt, multiTurn |
| `oc-longcat-2-0-free` | `longcat-2.0-free` | professional | 128K | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** Passes `tools` and `tool_choice` natively. On 503, retries up to 2 times with 1-second delay. If all retries fail, falls back to Pollinations `openai` model with a `[OpenCode unavailable — using Pollinations fallback]` prefix. Native `tool_calls` deltas are converted to `__tool_calls` JSON markers. Unknown model IDs are passed through to OpenCode (broadest model support).

---

### FreeChat

| Property | Value |
|---|---|
| **Endpoint** | `POST https://llmproxy.org/api/chat.php` |
| **Origin/Referer** | `https://freechat.org` |
| **Auth** | None — free, no-auth |
| **Streaming** | Real upstream SSE — OpenAI-shaped chunks |
| **SSE Format** | OpenAI: `data: {"choices":[{"delta":{"content":"token"}}]}` — includes credit info events (skipped) |
| **Identity Rotation** | Not needed — credits regenerate |
| **Rate Limits** | 29 free credits (decrements per request, regenerates) |
| **Free Access** | No signup, regenerating credits |

**Models (1):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `fc-v3` | `v3` | professional | 8K | streaming, systemPrompt, multiTurn |

**Implementation Details:** Non-streaming returns `{content, credits}`. Streaming yields OpenAI-shaped SSE chunks. Credit info and keep-alive comments are skipped during parsing.

---

### Miklium

| Property | Value |
|---|---|
| **Endpoint** | `POST https://miklium.vercel.app/api/chatbot` |
| **Auth** | None — free, no-auth |
| **Streaming** | **No** — non-streaming only (gateway re-paces full text) |
| **Identity Rotation** | Not needed |
| **Rate Limits** | None observed |
| **Free Access** | No signup, no key |

**Models (5):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `mk-miklium` | `miklium` | sfw | 8K | *(none — no streaming, no tools, no systemPrompt, no multiTurn)* |
| `mk-personalityless` | `personalityless` | sfw | 8K | *(none)* |
| `mk-male` | `male` | sfw | 8K | *(none)* |
| `mk-female` | `female` | sfw | 8K | *(none)* |
| `mk-all` | `all` | sfw | 8K | *(none)* |

**Implementation Details:** Takes `{message, model}` — only the last user message is sent (no conversation history). Response is `{success, response}`. The `stream()` method just yields the full text at once — the gateway re-paces it with simulated streaming.

---

### Swarm

| Property | Value |
|---|---|
| **Endpoint** | `POST https://swarm.g4f-dev.workers.dev/v1/chat/completions` |
| **Models URL** | `GET https://swarm.g4f-dev.workers.dev/v1/models` |
| **Auth** | None — community-hosted, no-auth |
| **Streaming** | Real upstream SSE — standard OpenAI format |
| **SSE Format** | OpenAI: `data: {"choices":[{"delta":{"content":"token"}}]}` → `data: [DONE]` |
| **Identity Rotation** | Not needed — free community service |
| **Rate Limits** | Some models are unreliable (500/503 timeouts) |
| **Free Access** | Community-hosted llama.cpp swarm, no signup |

**Models (7):**

| Gateway ID | Upstream ID | Category | Context Window | Capabilities |
|---|---|---|---|---|
| `sw-qwen3-6-35b-iq3` | `Qwen3.6-35B-A3B-UD-IQ3_S.gguf` | professional | 131K | streaming, tools, systemPrompt, multiTurn |
| `sw-qwen3-6-35b-iq4` | `Qwen3.6-35B-A3B-UD-IQ4_XS.gguf` | professional | 131K | streaming, tools, systemPrompt, multiTurn |
| `sw-qwen3-6-35b-q4` | `Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf` | professional | 131K | streaming, tools, systemPrompt, multiTurn |
| `sw-qwen3-6-35b-uncensored` | `Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf` | unrestricted | 131K | streaming, tools, systemPrompt, multiTurn |
| `sw-qwen3-5-9b` | `Qwen3.5-9B-Q4_K_M.gguf` | professional | 131K | streaming, tools, systemPrompt, multiTurn |
| `sw-qwen3-5-35b-uncensored` | `Qwen3.5-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf` | unrestricted | 131K | streaming, tools, systemPrompt, multiTurn |
| `sw-qwen2-5-7b` | `Qwen2.5-7B-Instruct-Q4_K_M.gguf` | professional | 131K | streaming, tools, systemPrompt, multiTurn |

**Implementation Details:** Passes `tools` and `tool_choice` natively. Native `tool_calls` deltas are converted to `__tool_calls` JSON markers. **Note:** The tool system prompt is skipped for Swarm (causes template errors) — tool calling works but without the injection preamble; only native tool_calls from upstream are parsed.

---

### FreeAIXYZ

| Property | Value |
|---|---|
| **Cache URL** | `POST https://unlimitedai.org/wp-admin/admin-ajax.php` (action: `aipkit_cache_sse_message`) |
| **Stream URL** | `GET https://unlimitedai.org/wp-admin/admin-ajax.php` (action: `aipkit_frontend_chat_stream`) |
| **Chat Page** | `https://unlimitedai.org/chat/?uai_mode=chat&uai_model=claude` |
| **Auth** | WordPress nonce (self-healing — fetched from chat page HTML, cached 10 min, auto-refreshed on 400/403) |
| **Streaming** | Real upstream SSE — custom format via curl spawn (Node.js runtime only) |
| **SSE Format** | Custom: `data: {"delta":"token"}` — also `{"content":"..."}`, `{"text":"..."}`, OpenAI-shaped `{"choices":[{"delta":{"content":"..."}}]}` |
| **Identity Rotation** | Fresh `conversation_uuid` and `session_id` per request |
| **Rate Limits** | Cloudflare TLS fingerprinting blocks Node.js `fetch` — uses `curl` via `child_process` as workaround |
| **Free Access** | Self-healing nonce synchronization + curl proxy bypass |
| **Runtime** | Node.js only — proxied via `/api/v1/chat/freeaixyz-proxy` |

**Protocol (two-step):**

1. **Cache step:** POST form-urlencoded to `admin-ajax.php` with `action=aipkit_cache_sse_message`, `message`, `_ajax_nonce`, `bot_id`, `session_id`, `conversation_uuid` → returns `cache_key`
2. **Stream step:** GET from `admin-ajax.php` with `action=aipkit_frontend_chat_stream`, `cache_key`, `bot_id`, `session_id`, `conversation_uuid`, `_ajax_nonce` → SSE stream with text deltas

**Models (16):**

| Gateway ID | Upstream ID | Category | Context Window | Web Search | Vision |
|---|---|---|---|---|---|
| `fxyz-chatgpt` | `chatgpt` | professional | 128K | ✅ | ✅ |
| `fxyz-gemini` | `gemini` | professional | 1M | ✅ | ✅ |
| `fxyz-deepseek` | `deepseek` | professional | 64K | ✅ | ✅ |
| `fxyz-claude` | `claude` | professional | 200K | ✅ | ✅ |
| `fxyz-grok` | `grok` | professional | 131K | ✅ | ✅ |
| `fxyz-perplexity` | `perplexity` | professional | 128K | ✅ | ✅ |
| `fxyz-meta` | `meta` | professional | 128K | ✅ | ✅ |
| `fxyz-qwen` | `qwen` | professional | 262K | ✅ | ✅ |
| `fxyz-chatgpt-search` | `chatgpt-search` | professional | 128K | ✅ | ✅ |
| `fxyz-gemini-search` | `gemini-search` | professional | 1M | ✅ | ✅ |
| `fxyz-deepseek-search` | `deepseek-search` | professional | 64K | ✅ | ✅ |
| `fxyz-claude-search` | `claude-search` | professional | 200K | ✅ | ✅ |
| `fxyz-grok-search` | `grok-search` | professional | 131K | ✅ | ✅ |
| `fxyz-perplexity-search` | `perplexity-search` | professional | 128K | ✅ | ✅ |
| `fxyz-meta-search` | `meta-search` | professional | 128K | ✅ | ✅ |
| `fxyz-qwen-search` | `qwen-search` | professional | 262K | ✅ | ✅ |

**All models have:** streaming, tools, systemPrompt, multiTurn, webSearch, vision

**Bot ID mapping:** `chatgpt→25871`, `gemini→25874`, `deepseek→25873`, `claude→25875`, `grok→25872`, `perplexity→29624`, `meta→25870`, `qwen→25869`

**Implementation Details:** Nonce is scraped from the chat page HTML (tries HTML-entity format `&quot;nonce&quot;` first, then plain JSON). On 400/403, nonce is invalidated and re-fetched. Vision support: base64 `data:image/...;base64,...` in message content is extracted and sent as `image_inputs` JSON. Web search: `-search` suffix on upstream model key or `frontend_web_search_active=true` parameter. The Edge runtime provider uses Node.js `fetch`, but the proxy route uses `curl` via `child_process.spawn` to bypass Cloudflare TLS fingerprinting.

---

### Image Providers

#### Pollinations (Image)

| Property | Value |
|---|---|
| **Endpoint** | `https://image.pollinations.ai/prompt/{prompt}?model={model}` |
| **Auth** | None — free, no signup |
| **Speed** | ~0.3-1s per image |
| **Rate Limits** | Unlimited |

**Models (5):**

| Gateway ID | Upstream Model | Category | Resolution | NSFW |
|---|---|---|---|---|
| `poll-flux` | `flux` | mixed | 1024×1024 | No |
| `poll-turbo` | `turbo` | mixed | 1024×1024 | No |
| `poll-dreamshaper` | `dreamshaper` | mixed | 1024×1024 | No |
| `poll-gptimage` | `gptimage` | general | 1024×1024 | No |
| `poll-qwen-image` | `qwen-image` | mixed | 1024×1024 | No |

#### FreeGPT (Image)

| Property | Value |
|---|---|
| **Auth** | WASM-secured (same as text) |
| **Rate Limits** | Same as FreeGPT text (8 req/min) |

**Models (4):**

| Gateway ID | Upstream Model | Category | Resolution | NSFW |
|---|---|---|---|---|
| `freegpt-gpt-image-2` | `gpt-image-2` | general | 1024×1024 | No |
| `freegpt-nano-banana-2` | `nano-banana-2` | realism | 1024×1024 | No |
| `freegpt-flux-2-flex` | `flux-2-flex` | realism | 1024×1024 | No |
| `freegpt-gemini-flash-image` | `gemini-3.1-flash-image` | general | 1024×1024 | No |

#### FreepikAI

| Property | Value |
|---|---|
| **Auth** | Cloudflare Turnstile verification + UUID-per-request session |
| **Resolution** | 4MP ultra-HD |
| **Rate Limits** | UUID rotation for high rate limits |

**Models (6):**

| Gateway ID | Upstream Model | Category | Resolution | NSFW |
|---|---|---|---|---|
| `fpk-photorealistic` | `Photorealistic` | realism | 1024×1024 | No |
| `fpk-digital-art` | `Digital Art` | mixed | 1024×1024 | No |
| `fpk-oil-painting` | `Oil Painting` | mixed | 1024×1024 | No |
| `fpk-anime` | `Anime` | anime | 1024×1024 | No |
| `fpk-3d-render` | `3D Render` | mixed | 1024×1024 | No |
| `fpk-watercolor` | `Watercolor` | mixed | 1024×1024 | No |

#### FreeGen

| Property | Value |
|---|---|
| **Auth** | None — WebSocket task queue |
| **Features** | Prompt signing, multiple aspect ratios |

**Models (1):**

| Gateway ID | Upstream Model | Category | Resolution | NSFW |
|---|---|---|---|---|
| `freegen-default` | `default` | mixed | 1024×1024 | No |

#### AIAnime

| Property | Value |
|---|---|
| **Endpoint** | `https://api.aianime.io/api/image-generate/text2image` |
| **Auth** | None — IP rotation for rate limit bypass |
| **Format** | `application/x-www-form-urlencoded` (NOT JSON) |
| **Flow** | Async: POST → `job_id` → poll for result |

**Models (1):**

| Gateway ID | Upstream Model | Category | Resolution | NSFW |
|---|---|---|---|---|
| `aianime-text2image` | `text2image` | anime | 1024×1024 | No |

---

### Standalone Services

#### Web Search

| Property | Value |
|---|---|
| **Endpoint** | `POST /api/v1/search` or `GET /api/v1/search?q=...` |
| **Backend** | DuckDuckGo HTML endpoint |
| **Auth** | None |

#### Music Generation

| Property | Value |
|---|---|
| **Endpoint** | `POST /api/v1/music/generate` |
| **Backend** | ACE-Step 1.5 via `api.acemusic.ai` |
| **Auth** | Real API key (embedded) |
| **Max Duration** | 120s |

---

## Streaming Architecture

### Real Upstream Streaming vs Simulated Re-Pacing

The gateway supports two streaming modes determined by `isRealStreamProvider()`:

```typescript
function isRealStreamProvider(provider: string): boolean {
  return [
    "auroraai", "surfsense", "jollygen", "unlimitedai",
    "pollinations", "kilocode", "llm7", "spicywriter",
    "freegpt", "opencode", "freechat", "swarm", "freeaixyz",
  ].includes(provider);
}
```

| Mode | Providers | Behavior |
|---|---|---|
| **Real streaming** | auroraai, surfsense, jollygen, unlimitedai, pollinations, kilocode, llm7, spicywriter, freegpt, opencode, freechat, swarm, freeaixyz | Each upstream SSE delta is emitted as its own SSE event immediately — genuine token-by-token streaming |
| **Simulated re-pacing** | miklium | Full text arrives at once, then is re-paced into word-level chunks (3 words per chunk) with 20ms inter-chunk delay for smooth appearance |

### How `isRealStreamProvider()` Determines Streaming Type

Only providers whose `stream()` method yields **genuine token-by-token deltas from an SSE upstream** are listed. Providers that buffer the full response and yield it once (like Miklium) are excluded — they get the simulated re-pacing path instead.

### SSE Event Format (OpenAI-Compatible Chunks)

**Initial role chunk:**
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}
```

**Content delta chunks:**
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{"content":"token"},"finish_reason":null}]}
```

**Finish chunk:**
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":...,"model":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
```

**Stream end:**
```
data: [DONE]
```

### Structured Error Events

Errors during streaming are sent as structured SSE events (not embedded in content):

```
event: error
data: {"error":{"message":"...","type":"upstream_error","code":"upstream_error"}}
```

Error types:
| Type | Code | Condition |
|---|---|---|
| `authentication_required` | `authentication_required` | HTTP 401/403 or "unauthorized"/"forbidden" in message |
| `rate_limit_exceeded` | `rate_limit_exceeded` | "quota", "rate limit", or "429" in message |
| `upstream_error` | `upstream_error` | All other errors |

### TransformStream + Backpressure for Vercel

The streaming implementation uses `TransformStream` instead of `ReadableStream` with async `start()`:

```typescript
const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
const writer = writable.getWriter();

// Don't await — start writing in the background so the Response
// can be returned immediately with the readable stream.
(async () => {
  // ... write chunks to writer ...
})();

return new Response(readable, { headers: {...} });
```

**Why TransformStream?** On Vercel Node.js runtime, `ReadableStream`'s async `start()` buffers ALL data until the function completes. `TransformStream` has proper backpressure and flushes data to the network as chunks are written to the writer. The IIFE writes chunks in the background while the `Response` is returned immediately — this is the KEY to real-time streaming on Vercel.

**Heartbeat comments** (`: keep-alive\n\n`) are sent every 500ms to keep the connection alive during upstream wait.

### Re-Pacing Algorithm

For non-streaming providers, the full text is split into word-level tokens (preserving whitespace) and emitted in 3-word chunks with 20ms inter-chunk delay:

```typescript
function tokenizeForStream(text: string): string[] {
  const raw = text.match(/(\s+|\S+)/g);
  const CHUNK_SIZE = 3;
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    tokens.push(raw.slice(i, i + CHUNK_SIZE).join(""));
  }
  return tokens;
}
```

---

## Tool Calling / Function Calling

### OpenAI Tool Format Support

The gateway supports the standard OpenAI tool format:

```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get current weather",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {"type": "string", "description": "City name"},
          "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
        },
        "required": ["location"]
      }
    }
  }],
  "tool_choice": "auto"
}
```

### Two Implementation Paths

#### 1. Prompt-Injection Approach (ALL Models)

The gateway injects a **tool system prompt** into the conversation for every model when tools are active. This teaches the model to emit tool calls in a parseable format:

```
You are a tool-calling assistant. You have tools available. When a request needs one, you MUST respond with ONLY a tool_call block and NOTHING else:
```tool_call
[{"name":"<tool_name>","arguments":{"<param>":"<value>"}}]
```
CRITICAL RULES:
1. When you need to call a tool, output ONLY the tool_call block — no explanation, no preamble, no text before or after.
2. The tool_call block must be a valid JSON array inside triple backticks labeled tool_call.
3. Use ONLY tool names from the list below. Arguments must match the params shown (* = required).
4. If multiple tools are needed, include multiple objects in the array.
5. If no tool is needed, answer normally without the tool_call block.

Tools (2 available):
- get_weather({ location: string*, unit: string|fahrenheit }) — Get current weather
- search_web({ query: string* }) — Search the web
```

**Design:** Compact one-line-per-tool format keeps the prompt small (36 tools ≈ 3KB vs 25KB with full JSON schemas), so the model actually retains the entire tool list.

**Exception:** Swarm provider skips the system prompt injection (causes template errors) — relies on native tool calling only.

#### 2. Native Tool Calling (OpenAI-Compatible Providers)

Providers that speak the OpenAI API natively pass `tools` and `tool_choice` directly to upstream. When the upstream returns `tool_calls` deltas in SSE, they're converted to `{"__tool_calls": [...]}` JSON markers that the gateway's `parseToolCalls()` recognizes.

**Providers with native tool support:**
- FreeGPT (all models — OpenAI OneAPI format)
- Kilo Code (via OpenRouter)
- LLM7
- OpenCode
- Swarm
- Pollinations

### Parsing Tool Call Outputs

`parseToolCalls()` handles multiple output formats:

| Pattern | Description | Example |
|---|---|---|
| ` ```tool_call [...] ``` ` | Fenced JSON block (primary) | ` ```tool_call [{"name":"get_weather","arguments":{"location":"Boston"}}] ``` ` |
| ` ```json [...] ``` ` | Generic fenced block with tool-call-shaped JSON | Any fenced block with `name` and `arguments` keys |
| `{"__tool_calls": [...]}` | Native tool calls from OpenAI-compatible providers | `{"__tool_calls":[{"name":"get_weather","arguments":"..."}]}` |
| Bare JSON | Unfenced JSON array/object with `name` + `arguments` keys | `[{"name":"get_weather","arguments":{...}}]` |

The parser also handles common model quirks: missing fence, single object instead of array, stringified arguments, escaped quotes, double-escaped quotes.

### Streaming with Tools

When tools are active in streaming mode, the full response is **buffered silently** before emitting any SSE events. This ensures a complete tool-call envelope can be parsed before deciding between content deltas and `tool_calls` deltas:

1. Buffer entire response (either from `provider.stream()` or `provider.complete()`)
2. Parse with `parseToolCalls()`
3. If tool calls found: emit `tool_calls` delta chunks → `finish_reason: "tool_calls"`
4. If no tool calls: emit content as re-paced deltas → `finish_reason: "stop"`

### Example Request with Tools

```bash
curl -X POST http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "oc-big-pickle",
    "messages": [
      {"role": "user", "content": "What is the weather in Boston?"}
    ],
    "stream": false,
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }],
    "tool_choice": "auto"
  }'
```

**Response:**

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_...",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\":\"Boston\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

---

## AIAnime Image Generation

### API Format: Form-Urlencoded (NOT JSON)

The upstream AIAnime API uses `application/x-www-form-urlencoded`. The gateway accepts JSON for convenience and converts automatically:

```
prompt=anime+girl&model_type=anime_io&negative_prompt=blurry&aspect_ratio=1%3A1
```

### Async Job Flow

AIAnime image generation is asynchronous:

```
┌──────────┐     POST /text2image     ┌──────────────┐
│  Gateway  │ ──────────────────────► │  api.aianime  │
│  (our API)│ ◄────────────────────── │     .io       │
└──────────┘     {job_id: "abc123"}   └──────────────┘
      │                                       │
      │  GET /text2image/result?job_id=abc123  │
      └──────────────────────────────────────► │
                   {image_url: "https://..."}  │
      ◄──────────────────────────────────────┘
```

1. **POST** to `/api/image-generate/text2image` with prompt → returns `{code: 200, result: {job_id: "..."}}`
2. **Poll** `/api/image-generate/text2image/result?job_id=...` every 2s (max 15 attempts) → returns `{image_url: "https://..."}`

### IP Rotation for Rate Limit Bypass

AIAnime enforces per-IP rate limits. The gateway uses multiple strategies:

#### Strategy 1: Multi-Header IP Spoofing (Primary)

Each request gets random IPs injected into multiple headers:

```typescript
const ip = generateRandomIp();  // Random from diverse country/ASN ranges
const ip2 = generateRandomIp();
headers = {
  "X-Forwarded-For": `${ip}, ${ip2}`,
  "X-Real-IP": ip,
  "X-Client-IP": ip,
  "CF-Connecting-IP": ip,
  "X-Originating-IP": ip,
  "X-Cluster-Client-IP": ip,
  "Forwarded": `for=${ip}`,
};
```

The random IP generator selects first octets from 120+ diverse ranges (North America, Europe, Asia, South America, Oceania) to appear as legitimate traffic from varied ASNs.

#### Strategy 2: Public Proxy Pool (Secondary)

A pool of 40+ seed HTTP proxies (plus API-fetched proxies from ProxyScrape, TheSpeedX, clarketm, ShiftyTR) with round-robin rotation, health scoring (100=fresh, 0=dead), and automatic pool refresh every 5 minutes.

#### Strategy 3: Proxy Mini-Service (Vercel Deployment)

On Vercel, the gateway routes through the aianime-proxy mini-service on the sandbox server (port 3031), which runs on a different IP that isn't blocked:

```
┌──────────┐     POST /text2image     ┌──────────────┐     POST /text2image     ┌──────────────┐
│  Gateway  │ ──────────────────────► │ aianime-proxy │ ──────────────────────► │  api.aianime  │
│  (Vercel) │ ◄────────────────────── │   (port 3031) │ ◄────────────────────── │     .io       │
└──────────┘     {image_url: ...}     └──────────────┘     {image_url: ...}     └──────────────┘
```

#### Strategy 4: Client-SEide Fallback

If all server-side strategies fail (Vercel IP blocked), the gateway returns `direct_call` instructions. Since AIAnime has `access-control-allow-origin: *`, the client can call the API directly from the browser:

```json
{
  "direct_call": {
    "url": "https://api.aianime.io/api/image-generate/text2image",
    "method": "POST",
    "headers": {"Content-Type": "application/x-www-form-urlencoded"},
    "body": "prompt=...&model_type=anime_io",
    "poll": {
      "url_template": "https://api.aianime.io/api/image-generate/text2image/result?job_id={job_id}",
      "interval_ms": 2000,
      "max_attempts": 15
    }
  }
}
```

### Proxy Service Architecture

The aianime-proxy mini-service (Bun runtime, port 3031) provides:

| Endpoint | Method | Description |
|---|---|---|
| `/api/image-generate/text2image` | POST | Proxy text2image requests with IP rotation + retry |
| `/api/image-generate/text2image/result` | GET | Poll for job result |
| `/health` | GET | Health check |
| `/stats` | GET | Request stats (total, success, failure, by model) |

**Retry logic:** Up to 8 attempts with 300-1000ms jitter delay. Each attempt uses fresh rotated IP headers. Detects disguised "Parameter error" blocks (code 400 with "parameter" in message = IP blocked).

---

## Health Filtering

### KNOWN_UNHEALTHY Models

Based on retest 2025-08-12, these models are consistently broken upstream and hidden from `/models` by default:

**FreeGPT (rate-limited / challenge-blocked):**

```
fgpt-gpt-5-5, fgpt-gpt-5-6-luna, fgpt-gpt-5-6-sol,
fgpt-deepseek-v4-pro, fgpt-gemini-3-pro-preview,
fgpt-gemini-3-5-flash, fgpt-gemini-3-flash-preview,
fgpt-gemini-3-1-pro-preview, fgpt-claude-fable-5,
fgpt-claude-sonnet-5, fgpt-claude-opus-5, fgpt-claude-opus-4-8,
fgpt-claude-opus-4-7, fgpt-claude-opus-4-6, fgpt-claude-sonnet-4-6,
fgpt-grok-4-20, fgpt-grok-4-20-non-reasoning, fgpt-gpt-4o,
fgpt-gpt-4-1, fgpt-o3, fgpt-o4-mini, fgpt-gpt-oss-120b,
fgpt-baidu-eb50, fgpt-baidu-eb45t, fgpt-mimo-v2-5, fgpt-mimo-v2-5-pro,
fgpt-gemini-3-1-flash-image
```

**Kilo Code (paid auth / unavailable):**

```
nemotron-safety  (safety classifier exposed as chat model)
```

**Swarm (persistent 500/503):**

```
sw-qwen2-5-7b  (often times out)
```

**Standalone services (not chat models):**

```
web-search, music-generate
```

### How /models Filters Broken Models

```typescript
function isModelVisible(m: GatewayModel): boolean {
  if (m.provider === "search" || m.provider === "music") return false;
  if (KNOWN_UNHEALTHY.has(m.id)) return false;
  if (m.modality === "text-to-image") return false;
  return true;
}
```

- Default: only visible models are listed
- `?all=true`: includes all models (including unhealthy)
- Image generation models are hidden from chat model list (they have `modality: "text-to-image"`)

### Provider Health Status

```typescript
function providerHealth(provider: string): "healthy" | "degraded" | "unhealthy" {
  if (provider === "freegpt") return "degraded";  // high rate-limit + challenge block rate
  return "healthy";
}
```

With `?health=true`, each model includes a `health` field:
- `"unhealthy"` — in KNOWN_UNHEALTHY set
- `"degraded"` — provider has known issues (FreeGPT)
- `"healthy"` — no known issues

---

## Code Examples

### Chat Completion (Streaming)

```bash
curl -N http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "oc-big-pickle",
    "messages": [
      {"role": "user", "content": "Explain quantum computing in 3 sentences."}
    ],
    "stream": true
  }'
```

### Chat Completion (Non-Streaming)

```bash
curl http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fxyz-claude",
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user", "content": "What is 2+2?"}
    ],
    "stream": false
  }'
```

### Chat Completion with Tools

```bash
curl http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fgpt-gpt-5-4-mini",
    "messages": [
      {"role": "user", "content": "Search for the latest news about AI and summarize it."}
    ],
    "stream": false,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "search_web",
          "description": "Search the web for information",
          "parameters": {
            "type": "object",
            "properties": {
              "query": {"type": "string", "description": "Search query"}
            },
            "required": ["query"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "summarize",
          "description": "Summarize text content",
          "parameters": {
            "type": "object",
            "properties": {
              "text": {"type": "string", "description": "Text to summarize"},
              "max_words": {"type": "number", "description": "Maximum words"}
            },
            "required": ["text"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

### Image Generation

```bash
curl http://localhost:3000/api/image-generate/text2image \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "beautiful anime girl with flowing blue hair, cherry blossoms, sunset",
    "negative_prompt": "blurry, low quality, deformed",
    "model_type": "anime_io",
    "aspect_ratio": "16:9"
  }'
```

### Model Listing

```bash
# Default (healthy models only)
curl http://localhost:3000/api/v1/models

# All models including unhealthy
curl "http://localhost:3000/api/v1/models?all=true"

# With health metadata
curl "http://localhost:3000/api/v1/models?health=true"

# All models with full metadata
curl "http://localhost:3000/api/v1/models?all=true&health=true"
```

### Web Search

```bash
curl http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "latest developments in AI 2025",
    "num": 5
  }'

# Or via GET
curl "http://localhost:3000/api/v1/search?q=latest+AI+news&num=5"
```

### Music Generation

```bash
curl http://localhost:3000/api/v1/music/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Relaxing lo-fi hip hop beat",
    "duration": 30,
    "instrumental": true,
    "bpm": 85
  }'
```

### Multi-Turn Conversation

```bash
curl http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "spicy-ling-2-6-flash",
    "messages": [
      {"role": "system", "content": "You are a creative storyteller."},
      {"role": "user", "content": "Start a story about a space explorer."},
      {"role": "assistant", "content": "Captain Zara stepped onto the bridge of the Meridian..."},
      {"role": "user", "content": "What happens when they reach the nebula?"}
    ],
    "stream": true
  }'
```

### Vision (FreeAIXYZ with Image Input)

```bash
curl http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fxyz-claude",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is in this image?"},
          {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBOR..."}}
        ]
      }
    ],
    "stream": false
  }'
```

---

*Last updated: 2025-08-12 | Total: 89 chat/text models + 16 image models across 14 text providers + 5 image providers*
