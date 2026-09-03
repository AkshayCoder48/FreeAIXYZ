<div align="center">

# FreeAIXYZ Gateway

**A free, keyless, OpenAI-compatible API gateway.**

75+ models · 17 upstream providers · streaming · tool calling · no auth · no keys · no rate limits · CORS-open for every browser app

[![API Status](https://img.shields.io/website?url=https%3A%2F%2Ffreeaixyz4all.vercel.app%2Fapi%2Fv1%2Fmodels&label=API%20status&up_message=live&down_message=down)](https://freeaixyz4all.vercel.app/api/v1/models)
[![Models](https://img.shields.io/badge/models-75-ff6b4a)](https://freeaixyz4all.vercel.app/api/v1/models)
[![Auth](https://img.shields.io/badge/auth-none-ffb347)](https://freeaixyz4all.vercel.app)
[![CORS](https://img.shields.io/badge/CORS-%2A%20open-2ea44f)](src/lib/api/cors.ts)
[![Streaming](https://img.shields.io/badge/streaming-SSE-ff2f3a)](src/lib/gateway/streaming-proxy.ts)
[![Tool calling](https://img.shields.io/badge/tools-OpenAI%20compatible-ff6b4a)](src/lib/tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-9c9c9d)](#license)
[![Deploy on Vercel](https://img.shields.io/badge/deploy-Vercel-07080a)](#deploy-your-own)

`https://freeaixyz4all.vercel.app` · [Docs site](https://freeaixyz4all.vercel.app/docs) · [Playground](https://freeaixyz4all.vercel.app/chat) · [Model catalog](https://freeaixyz4all.vercel.app/models)

</div>

---

## Table of contents

- [What is FreeAIXYZ?](#what-is-freeaixyz)
- [Base URLs — all conventions work](#base-urls--all-conventions-work)
- [Quick start (30 seconds)](#quick-start-30-seconds)
- [Auto model fetch script](#auto-model-fetch-script)
- [Authentication](#authentication)
- [Models](#models)
- [Chat completions](#chat-completions)
- [Streaming](#streaming)
- [Tool calling](#tool-calling)
- [Built-in tools](#built-in-tools)
- [Errors](#errors)
- [Providers](#providers)
- [Observability](#observability)
- [CORS policy](#cors-policy)
- [OpenAI SDK compatibility](#openai-sdk-compatibility)
- [Deploy your own](#deploy-your-own)
- [Self-hosting](#self-hosting)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Testing](#testing)
- [FAQ](#faq)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [License](#license)

---

## What is FreeAIXYZ?

FreeAIXYZ is a **public, keyless API gateway** that aggregates 17 free upstream LLM providers behind **one OpenAI-compatible REST surface**. Point any OpenAI SDK, agent framework, or plain `curl` at it and you get:

- **75+ models** across GPT, Claude, DeepSeek, Qwen, Llama, Mistral, Grok, Gemini-class and more — all free, all without accounts or API keys.
- **Real streaming** — every upstream delta forwarded immediately as a standard `chat.completion.chunk` SSE frame. No buffering, no fake re-pacing, no heartbeats.
- **Real tool calling** — `tools` / `tool_choice` / `parallel_tool_calls` are forwarded upstream with a forwarding assertion, streamed `delta.tool_calls` chunks are accumulated, **text-embedded tool-call fences are normalized into standard `delta.tool_calls`** (so clients that can't parse fences still work), and a built-in tool executor is included.
- **Honest capabilities** — every model entry advertises `capabilities: ["tools", "streaming", …]`, and requests carrying `tools` against a non-tools model are rejected with a clean `TOOL_UNSUPPORTED` error instead of silently dropping them.
- **Resilience by design** — transient upstream failures (5xx / 429 / network blips / upstream edge crashes) are retried with backoff and failed over to an alternative provider serving the same model; circuit breakers per model *and* per provider stop cascades.
- **Open to every browser** — full CORS: any origin can call the API directly from a web app (the preflight `OPTIONS` handlers + `Access-Control-*` headers are built in). No more `TypeError: Failed to fetch` from your gateway.
- **Zero state** — no database, no user accounts, no API keys, no request logs. Deployable as a single stateless function.

> **Note:** Free upstreams come and go. The catalog is curated + health-checked; degraded or dead models are delisted automatically and re-added when they recover. `GET /api/v1/models` always reflects what actually works *right now*.

---

## Base URLs — all conventions work

Pick whatever your SDK expects — every convention hits the same handlers (compatibility rewrites are built in):

| Base URL | Convention | Works with |
| --- | --- | --- |
| `https://freeaixyz4all.vercel.app` | bare domain | `curl`, custom clients |
| `https://freeaixyz4all.vercel.app/v1` | OpenAI SDK default | `openai` (JS/Python), LangChain, LlamaIndex, autogen, … |
| `https://freeaixyz4all.vercel.app/api/v1` | canonical | FreeAIXYZ docs examples |

```bash
# All three of these return the same JSON:
curl -s https://freeaixyz4all.vercel.app/api/v1/models
curl -s https://freeaixyz4all.vercel.app/v1/models
curl -s https://freeaixyz4all.vercel.app/models   # ← alias route
```

---

## Quick start (30 seconds)

### 1. List models

```bash
curl -s https://freeaixyz4all.vercel.app/api/v1/models | jq '.data[].id'
```

### 2. Chat (non-streaming)

```bash
curl -s -X POST https://freeaixyz4all.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tb/gpt-4o-latest",
    "messages": [{"role": "user", "content": "Reply with exactly: PONG"}],
    "max_tokens": 20
  }'
```

```json
{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "model": "tb/gpt-4o-latest",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "PONG"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14}
}
```

### 3. Stream it

```bash
curl -sN -X POST https://freeaixyz4all.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "model": "tb/gpt-4o-latest",
    "stream": true,
    "messages": [{"role": "user", "content": "Count to five."}]
  }'
```

```text
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","model":"tb/gpt-4o-latest","choices":[{"index":0,"delta":{"content":"One"},"finish_reason":null}]}
data: {"choices":[{"index":0,"delta":{"content":", two"},"finish_reason":null}]}
...
data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

### 4. Call a tool

```bash
curl -sN -X POST https://freeaixyz4all.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tb/gpt-4o-latest",
    "stream": true,
    "messages": [{"role": "user", "content": "What is 12345 * 6789? Use the calculator."}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Evaluate an arithmetic expression.",
        "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}
      }
    }],
    "tool_choice": "auto"
  }'
```

The stream delivers **standard `delta.tool_calls` chunks** and ends with `finish_reason: "tool_calls"` — see [Tool calling](#tool-calling) for the full loop.

---

## Auto model fetch script

The repository ships **`scripts/fetch-models.mjs`** — a zero-dependency Node script that pulls the live model list from any FreeAIXYZ gateway and writes a normalized, diff-friendly `models.json`. Use it to keep your app's model registry in sync with what the gateway actually serves.

```bash
# Fetch from production → ./models.json
node scripts/fetch-models.mjs

# Fetch from your own deployment / local dev
node scripts/fetch-models.mjs --url http://localhost:3000

# Bare ids only (great for shell pipelines)
node scripts/fetch-models.mjs --format ids | head

# Only models that support BOTH tool calling and streaming
node scripts/fetch-models.mjs --capabilities tools,streaming

# One provider's models
node scripts/fetch-models.mjs --provider tb --format ids

# Extended payload: status + context windows (?health=true)
node scripts/fetch-models.mjs --health --out models-health.json
```

Example output:

```text
  FreeAIXYZ model fetch — https://freeaixyz4all.vercel.app/api/v1/models
  75 models · generated 2026-09-03T10:18:28Z

   21  Toolbaz
   16  FreeAIXYZ Text API
   12  Kilo Code
    5  Miklium
   ...

  tools: 68 · streaming: 71 · both: 67

  sample ids:
    au/llama3-8b
    f2/free2gpt-auto
    ...
```

The written `models.json` is **sorted and stable** — commit it and let CI open a PR when the catalog drifts:

```json
{
  "$schema": "https://freeaixyz4all.vercel.app/api/v1/models",
  "generatedAt": "2026-09-03T10:18:28.793Z",
  "source": "https://freeaixyz4all.vercel.app/api/v1/models",
  "count": 75,
  "models": [
    {
      "id": "au/llama3-8b",
      "object": "model",
      "created": 1756896000,
      "owned_by": "AuroraAI",
      "capabilities": ["text", "streaming"]
    }
  ]
}
```

### Flags

| Flag | Meaning |
| --- | --- |
| `--url <base>` | Gateway base URL — bare domain, `/v1`, or `/api/v1` all work. Default: production. |
| `--out <file>` | Output file. `-` = stdout only (no file written). Default `models.json`. |
| `--health` | Fetch the extended payload (`?health=true`): status, context windows, last-checked. |
| `--capabilities a,b` | Keep only models advertising every listed capability (e.g. `tools,streaming`). |
| `--provider <id>` | Filter to one provider prefix (e.g. `tb`). |
| `--format <mode>` | `table` (default) · `ids` · `json` · `count`. |

### One-liners without the script

```bash
# Bare ids with jq
curl -s https://freeaixyz4all.vercel.app/api/v1/models | jq -r '.data[].id'

# Tool-capable models only
curl -s https://freeaixyz4all.vercel.app/api/v1/models \
  | jq -r '.data[] | select(.capabilities | index("tools")) | .id'

# Just the count
curl -s https://freeaixyz4all.vercel.app/api/v1/models | jq '.data | length'

# Python
python3 -c "import json,urllib.request; print('\n'.join(m['id'] for m in json.load(urllib.request.urlopen('https://freeaixyz4all.vercel.app/api/v1/models'))['data']))"
```

---

## Authentication

**None.** There are no API keys, no accounts, no tokens, no headers to set. Send requests exactly like the examples above. If your SDK *requires* an API key, pass any non-empty placeholder:

```ts
new OpenAI({ baseURL: "https://freeaixyz4all.vercel.app/v1", apiKey: "none" });
```

The gateway is fully stateless: no database, no per-user state, no request logging beyond in-memory metrics for the last 5 minutes (see [Observability](#observability)).

---

## Models

### `GET /api/v1/models`

OpenAI-compatible model listing. **Capability tags are always present** so clients can filter before sending a request.

```bash
curl -s https://freeaixyz4all.vercel.app/api/v1/models | jq '.data[0]'
```

```json
{
  "id": "tb/gpt-4o-latest",
  "object": "model",
  "created": 1756896000,
  "owned_by": "Toolbaz",
  "capabilities": ["text", "vision", "tools", "streaming"],
  "free": true
}
```

### Query parameters

| Param | Effect |
| --- | --- |
| *(none)* | Healthy, non-delisted models with capability arrays. |
| `?health=true` | Adds `status`, `capability_flags` (full object), `context_window`, `last_checked`, `discovery_mode`. |
| `?all=true` | Includes degraded + offline (delisted) models too. |

### Capability values

`text` · `streaming` · `tools` · `vision` · `image` · `image_edit` · `audio_input` · `audio_output`

### Model id convention

`{provider-prefix}/{upstream-model-id}` — e.g. `tb/gpt-4o-latest` (Toolbaz), `kc/kilo-auto/free` (Kilo Code), `l7/minimax-m2.7` (LLM7.io), `fx/chatgpt` (FreeAIXYZ/UnlimitedAI). The prefix routes the request to the matching provider adapter.

### `GET /api/v1/status`

Per-model + per-provider health snapshot (success rates, latencies, breaker state) — useful for routing around outages. Cheap: no upstream traffic.

---

## Chat completions

### `POST /api/v1/chat/completions`

**Aliases:** `POST /v1/chat/completions` · `POST /chat/completions` · `POST /api/chat/completions`

#### Request parameters

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `model` | `string` | *required* | Canonical id from `GET /api/v1/models`. |
| `messages` | `array` | *required* | OpenAI message list (`system`/`user`/`assistant`/`tool`). Array-form (vision) content is accepted and normalized — non-vision models never see `image_url` parts. |
| `stream` | `boolean` | `false` | Enable SSE streaming. |
| `stream_options` | `object` | — | `{ "include_usage": true }` emits a final usage chunk before `[DONE]`. |
| `tools` | `array` | — | OpenAI function definitions. Validated up front (`TOOL_SCHEMA_INVALID` on malformed). |
| `tool_choice` | `string \| object` | `"auto"` | `"none"`, `"auto"`, or `{type:"function", function:{name}}` — the object form is forwarded intact. |
| `parallel_tool_calls` | `boolean` | — | Forwarded to tools-capable upstreams. |
| `temperature` | `number` 0–2 | provider default | |
| `max_tokens` | `integer` | provider default | `max_completion_tokens` also accepted. |
| `top_p` | `number` 0–1 | provider default | |
| `stop` | `string \| string[]` | — | |
| `seed` | `integer` | — | |
| `presence_penalty` / `frequency_penalty` | `number` | — | Forwarded to OpenAI-compatible upstreams. |
| `n` | `integer` | 1 | |
| `web_search` | `boolean` | `false` | FreeAIXYZ extra: nudges web-informed answers. |

Unknown parameters are ignored (OpenAI SDK compatibility).

#### Response (non-streaming)

```json
{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "created": 1756896000,
  "model": "tb/gpt-4o-latest",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "…"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 12, "completion_tokens": 88, "total_tokens": 100}
}
```

`finish_reason` is `"tool_calls"` when the model wants to call tools (the message then carries a `tool_calls` array — including on models that emit tool calls as text fences; the gateway normalizes them, see below).

#### Error envelope

Every failure — 4xx, 5xx, pre-flight and mid-stream — returns the same JSON shape:

```json
{
  "error": {
    "type": "MODEL_NOT_FOUND",
    "message": "Model \"…\" was not found in the catalog. …",
    "code": "model_not_found",
    "status": 404,
    "provider": "toolbaz",
    "model": "tb/unknown-model",
    "request_id": "req_…"
  }
}
```

---

## Streaming

Set `"stream": true` and read `text/event-stream`.

### Wire format

```text
data: {"id":"chatcmpl-…","object":"chat.completion.chunk","created":…,"model":"…","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_…","type":"function","function":{"name":"calculator"}}]},"finish_reason":null}]}

data: {"…","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### Behavior guarantees

- **Immediate forwarding.** Each upstream delta becomes its own SSE chunk as soon as it arrives — no buffering, no re-pacing, no artificial delays. Non-streaming upstreams honestly emit **one** content chunk + `stop` (never a fake token-by-token stream).
- **Real HTTP statuses for pre-first-token errors.** The gateway pre-flights every stream: if the upstream fails *before* the first token, you get a real `404/429/502/…` JSON error — not a `200 OK` stream that dies with an in-band error frame. Mid-stream failures emit `event: error` + a terminal chunk with `finish_reason: "error"` + `[DONE]`.
- **Usage chunk.** `stream_options: {include_usage: true}` → a final `choices: []` chunk carrying `usage` before `[DONE]`.
- **Client disconnects.** `AbortSignal`/connection loss cancels the upstream request immediately (`499 STREAM_ABORTED` in metrics).
- **Transient-failure retry + failover.** Pre-flight failures classified as transient (network, 5xx, 429, upstream edge crashes) are retried once with linear backoff, then failed over to another provider serving the same model — with an `: X-Failover …` SSE comment marking it.

### Minimal SSE reader (Node)

```js
const res = await fetch("https://freeaixyz4all.vercel.app/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "tb/gpt-4o-latest", stream: true, messages: [{ role: "user", content: "Hi" }] }),
});
for await (const chunk of res.body) {
  const text = new TextDecoder().decode(chunk);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") process.exit(0);
    const delta = JSON.parse(data).choices[0]?.delta;
    if (delta?.content) process.stdout.write(delta.content);
    if (delta?.tool_calls) console.error("tool call:", delta.tool_calls);
  }
}
```

---

## Tool calling

FreeAIXYZ speaks the **full OpenAI tool-calling protocol** — and fixes the two classic gateway failure modes:

1. **Tools dropped from the request.** Here `tools` / `tool_choice` (string *and* object form) / `parallel_tool_calls` are preserved through every transformation layer, with a runtime **forwarding assertion** (`TOOL_FORWARDING_ERROR` if the outgoing provider payload's tool count ≠ the request's).
2. **Tool calls hidden in the text.** Some upstreams cannot emit `delta.tool_calls` and write the call as a fenced block inside `delta.content`:

   ```text
   ```tool_call
   [{"name":"get_weather","arguments":{"city":"Tokyo"}}]
   ```
   ```

   The gateway's streaming normalizer detects the fence mid-stream, **stops forwarding it as text**, parses the body, and re-emits it as **standard `delta.tool_calls` chunks** with `finish_reason: "tool_calls"`. DeepSeek-style DSML `<｜｜DSML｜｜tool_calls>` tags are handled the same way. Every OpenAI-compatible client gets executable tool calls — not a rendered code block and an "I don't have tools" answer.

### Streaming wire format for tool calls

```text
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_…","type":"function","function":{"name":"calculator"}}]},"finish_reason":null}]}
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"expression\":\"12345*6789\"}"}}]},"finish_reason":null}]}
data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}
data: [DONE]
```

Accumulate argument fragments per `tool_calls[].index` (concatenate `function.arguments`, first non-empty `id`/`name` wins), JSON-parse **only after** the stream completes, then execute and send the follow-up request.

### The complete agent loop (TypeScript)

```ts
const BASE = "https://freeaixyz4all.vercel.app/api/v1";
const MAX_TOOL_ROUNDS = 10;

const tools = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate an arithmetic expression",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
  },
];

async function runAgent(userMessage: string) {
  const messages: any[] = [{ role: "user", content: userMessage }];
  let final = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // 1. Request with tools (tool_choice auto + parallel calls on).
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tb/gpt-4o-latest",
        stream: true,
        messages,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
      }),
    });
    if (!res.ok) throw new Error(await res.text());

    // 2. Read the SSE stream, accumulating tool-call fragments by index.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const acc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason = "stop";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        const choice = JSON.parse(data).choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        for (const tc of choice.delta?.tool_calls ?? []) {
          const a = acc.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) a.id = tc.id;
          if (tc.function?.name) a.name = tc.function.name;
          if (tc.function?.arguments) a.args += tc.function.arguments;
          acc.set(tc.index, a);
        }
        if (choice.delta?.content) final += choice.delta.content;
      }
    }

    // 3. No tool calls → the streamed content IS the final answer.
    if (finishReason !== "tool_calls" || acc.size === 0) return final;

    // 4. Record the assistant's tool_calls message (required by the protocol).
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [...acc.entries()].map(([index, a]) => ({
        id: a.id, type: "function",
        function: { name: a.name, arguments: a.args },
        index,
      })),
    });

    // 5. Execute every tool call (parallel) and append the results.
    await Promise.all([...acc.values()].map(async (a) => {
      let result: string;
      try {
        const exec = await fetch(`${BASE}/../tools/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: a.name, arguments: JSON.parse(a.args || "{}") }),
        });
        result = JSON.stringify((await exec.json()).result ?? { ok: false });
      } catch (err: any) {
        result = JSON.stringify({ ok: false, error: String(err?.message ?? err) });
      }
      messages.push({ role: "tool", tool_call_id: a.id, content: result });
    }));
    // Loop → the follow-up request carries the original messages +
    // assistant.tool_calls + tool results, so the model can answer.
  }
  return final;
}

console.log(await runAgent("What is 12345 times 6789? Use the calculator."));
// → "The result of 12345 multiplied by 6789 is 83,810,205."
```

> The loop is **client-driven** by design — the gateway is stateless, so *your* client controls rounds, timeouts, and tool execution. Cap rounds (the FreeAIXYZ playground uses `MAX_TOOL_ROUNDS = 10`) to avoid runaway loops.

### Built-in tools + `/api/tools/execute`

Don't have your own tool runtime? Execute the three built-in tools server-side:

```bash
curl -s -X POST https://freeaixyz4all.vercel.app/api/tools/execute \
  -H "Content-Type: application/json" \
  -d '{"name": "calculator", "arguments": {"expression": "12345 * 6789"}}'
# → {"ok":true,"result":83810205,"durationMs":1,"chars":8,"truncated":false}
```

See [Built-in tools](#built-in-tools).

### Capability gate

Sending `tools` to a model that can't call tools returns **HTTP 400 `TOOL_UNSUPPORTED`** — an honest, actionable error instead of a model hallucinating "I don't have access to tools":

```json
{"error": {"type": "TOOL_UNSUPPORTED", "message": "Model \"…\" does not support tool calling. Remove the \"tools\" field for this model.", "status": 400}}
```

Filter up front with the capability tags:

```bash
curl -s https://freeaixyz4all.vercel.app/api/v1/models \
  | jq -r '.data[] | select(.capabilities | index("tools")) | .id'
```

---

## Built-in tools

Server-side executors registered in `src/lib/tools/registry.ts` — each pairs a model-facing JSON-schema definition with an app-side `execute`.

### `calculator`

Safe arithmetic (no `eval`) — `+ - * / % ^`, parentheses, unary minus, `sqrt min max log pi e`, thousands separators.

```json
{"name": "calculator", "arguments": {"expression": "12 * (3 + 4)"}}
```

```json
{"ok": true, "result": 84, "durationMs": 1, "chars": 2, "truncated": false}
```

### `web_search`

Live web search with a resilient provider chain (rich search where available, Wikipedia API fallback everywhere — results carry an honest `provider` field).

```json
{"name": "web_search", "arguments": {"query": "next.js latest version", "max_results": 5}}
```

### `get_current_time`

Current date/time with timezone.

```json
{"name": "get_current_time", "arguments": {"timezone": "Asia/Calcutta"}}
```

### `POST /api/tools/execute` contract

```json
// request
{"name": "web_search", "arguments": {"query": "…"}}
// response — success
{"ok": true, "result": {...}, "durationMs": 1180, "chars": 3421, "truncated": false}
// response — execution failure (HTTP 200 so the model still gets a result)
{"ok": false, "error": "…", "durationMs": 42}
```

Results are clamped to 20 000 chars (`truncated: true`) so tool output can never blow the context window. Unknown tool → HTTP 400 `TOOL_SCHEMA_INVALID`.

---

## Errors

One JSON envelope everywhere (`4xx` and `5xx`, streaming pre-flight included):

```json
{"error": {"type": "…", "message": "…", "code": "…", "status": 400, "provider": "…", "model": "…", "request_id": "…"}}
```

| `type` | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `INVALID_REQUEST` | 400 | no | Malformed request body / params / JSON. |
| `TOOL_SCHEMA_INVALID` | 400 | no | Malformed `tools` / `tool_choice` / `parallel_tool_calls`. |
| `TOOL_UNSUPPORTED` | 400 | no | Model can't call tools — filter with capability tags. |
| `TOOL_FORWARDING_ERROR` | 500 | no | Internal: provider payload lost tools (assertion tripped). |
| `MODEL_NOT_FOUND` | 404 | no | Unknown model id — check `GET /api/v1/models`. |
| `AUTHENTICATION_REQUIRED` | 401 | no | Upstream started requiring auth (rare). |
| `RATE_LIMITED` | 429 | yes | Upstream quota — `Retry-After` honored. |
| `UPSTREAM_4XX` | 4xx | no | Upstream rejected the request (message preserved). |
| `UPSTREAM_5XX` | 502 | yes | Upstream 5xx — already retried + failed over before you see it. |
| `UPSTREAM_UNAVAILABLE` / `PROVIDER_UNAVAILABLE` | 503 | yes | Provider down or circuit breaker open. |
| `UPSTREAM_TIMEOUT` | 504 | yes | Upstream timeout. |
| `EMPTY_UPSTREAM_RESPONSE` | 502 | yes | 200-but-empty completions are refused, not passed on. |
| `STREAM_ERROR` | 502 | yes | Mid-stream upstream failure (`event: error` + terminal chunk). |
| `STREAM_ABORTED` | 499 | — | Client disconnected. |

Retryable types are safe to retry with backoff — the gateway already did one retry + one provider failover internally before surfacing them.

---

## Providers

17 upstreams behind one API (counts reflect a healthy catalog — `GET /api/v1/models` is the source of truth):

| Provider | Prefix | Models | Notes |
| --- | --- | --- | --- |
| Toolbaz | `tb/` | ~21 | GPT-5/4o, Claude, DeepSeek, Qwen, Grok, o3-mini… Text-only upstream; **tool calls arrive as fences and are normalized**. |
| FreeAIXYZ (UnlimitedAI) | `fx/` | ~16 | Cloudflare-fingerprinted upstream — routed through a curl-based proxy. Claude-class models. |
| Kilo Code | `kc/` | ~12 | OpenAI-native SSE — **standard `delta.tool_calls` streaming**. |
| Miklium | `mk/` | ~5 | Streaming text models. |
| LLM7.io | `l7/` | ~4 | OpenAI-compatible; tool-call markers normalized. |
| OpenCode.ai | `oc/` | ~4 | OpenAI-native streaming + tools. |
| SurfSense | `ss/` | ~2 | |
| UnlimitedAI | `ua/` | ~2 | Reasoning models; fence-normalized tool calls. |
| GPT-OSS | `go/` | 1 | Open-weight gpt-oss. |
| Swarm | `sw/` | 1 | |
| UncloseAI | `uc/` | 1 | |
| AuroraAI | `au/` | 1 | Llama3-8b. |
| Free2GPT | `f2/` | 1 | |
| FreeChat | `fc/` | 1 | |
| JollyGen | `jg/` | 1 | No tool support (capability-gated). |
| SpicyWriter | `sp/` | 1 | |
| Vexa AI | `vx/` | 1 | |

Same-model failover pairs exist across prefixes (e.g. `tb/gpt-5.2` ⇄ `oc/gpt-5.2`) — when one provider dies pre-flight, the gateway transparently retries another and marks the stream with an `: X-Failover` comment.

---

## Observability

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | App health probe: provider aggregate counts, catalog freshness, readiness. |
| `GET /ready` | Readiness for load balancers / orchestrators. |
| `GET /api/v1/status` | Per-model + per-provider health: success rates, latencies, breaker state. |
| `GET /api/metrics` | In-memory request metrics (last 5 min) — statuses, latencies, TTFT. |
| `GET /api/providers` | Registered provider adapters + their capability surfaces. |
| `GET /api/debug/tools` | Tool registry + recent tool-pipeline traces (names/counts only — never arguments or credentials). |
| `GET /api/debug/stream` | Recent stream timings (chunk counts, TTFB/TTFT). |
| `GET /api/debug/provider?provider=tb&model=…` | Single live upstream probe. |

Diagnostics follow a strict no-secrets policy: tool traces record tool *names* and *counts*, never arguments; request ids are ephemeral; nothing is persisted.

---

## CORS policy

**Fully open — by design.** FreeAIXYZ is a public, keyless API; browser apps on any origin (`https://onyxagent-lac.vercel.app`, `http://localhost:5173`, notebooks, …) can call it directly:

- `Access-Control-Allow-Origin: *` (safe: no credentials, no cookies, no auth)
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD`
- Generous `Access-Control-Allow-Headers` (incl. `Authorization`, `X-API-Key`, `OpenAI-*`, `X-Requested-With`)
- `OPTIONS` preflight handlers on **every** API route (204 No Content + 24h `Access-Control-Max-Age`)
- Headers applied at three layers: route handlers (`src/lib/api/cors.ts`), Next.js routing headers, and Vercel edge `vercel.json`

```js
// Works from ANY browser origin:
const res = await fetch("https://freeaixyz4all.vercel.app/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "tb/gpt-4o-latest", messages: [...] }),
});
```

---

## OpenAI SDK compatibility

### JavaScript / TypeScript

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://freeaixyz4all.vercel.app/v1",
  apiKey: "none", // any placeholder — the gateway is keyless
});

const stream = await client.chat.completions.create({
  model: "tb/gpt-4o-latest",
  messages: [{ role: "user", content: "Reply with exactly: PONG" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://freeaixyz4all.vercel.app/v1",
    api_key="none",
)

stream = client.chat.completions.create(
    model="tb/gpt-4o-latest",
    messages=[{"role": "user", "content": "Reply with exactly: PONG"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

The OpenAI SDKs' tool-calling helpers (`tools=…`, `stream=True`) work out of the box — the streamed `delta.tool_calls` chunks and `finish_reason: "tool_calls"` are byte-for-byte the standard shapes.

Also works: LangChain `ChatOpenAI`, LlamaIndex, autogen, any HTTP client. See `examples/` in this repo for runnable snippets.

---

## Deploy your own

### Vercel (one command)

```bash
git clone https://github.com/AkshayCoder48/FreeAIXYZ.git
cd FreeAIXYZ
npm i -g vercel
vercel        # preview
vercel --prod # production
```

No environment variables are required for the core API. Optional:

| Env var | Purpose |
| --- | --- |
| `ZAI_BASE_URL` / `ZAI_API_KEY` | Enables the rich web_search provider in `scripts`/sandbox environments (Wikipedia fallback always works without them). |

The app is 100% stateless — no database to provision. `vercel.json` ships the streaming + CORS headers.

### Docker / any Node host

```bash
git clone https://github.com/AkshayCoder48/FreeAIXYZ.git
cd FreeAIXYZ
npm install
npm run build          # standalone output
npm start              # serves .next/standalone/server.js
```

`Dockerfile` sketch:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
```

---

## Self-hosting notes

- **Port:** the server binds `$PORT` (default 3000).
- **Memory:** runs comfortably in ~512 MB; the catalog + metrics are in-process and self-pruning.
- **Streaming proxies:** if you front the gateway with nginx/Caddy, disable response buffering for `/api/v1/chat/completions` (`proxy_buffering off;` / `flush_x -` resp. `X-Accel-Buffering: no` is already sent).
- **Upstream health:** providers are probed at startup and continuously via the circuit breakers; a provider that hard-dies is delisted from `/api/v1/models` automatically.

---

## Architecture

```text
                       ┌─────────────────────────────────────────────────┐
 Client (browser/app)  │  POST /api/v1/chat/completions                  │
 ─────────────────────▶│  (+ /v1, /chat, /api aliases · CORS + OPTIONS)  │
                       └───────────────┬─────────────────────────────────┘
                                       │  1. validate body + tool schemas
                                       │  2. resolve model → adapter (catalog)
                                       │  3. capability gate (tools? streaming?)
                                       ▼
                       ┌─────────────────────────────────────────────────┐
                       │  REQUEST BUILDER                                 │
                       │  messages normalized · tools/tool_choice/        │
                       │  parallel_tool_calls preserved + asserted        │
                       │  (native tools → API fields · emulated →         │
                       │   ```tool_call system directive)                 │
                       └───────────────┬─────────────────────────────────┘
                                       ▼
                       ┌─────────────────────────────────────────────────┐
                       │  PROVIDER ADAPTER (17)                           │
                       │  fetch with transient retry + failover           │
                       └───────────────┬─────────────────────────────────┘
                                       ▼
                       ┌─────────────────────────────────────────────────┐
                       │  STREAMING PROXY                                 │
                       │  pre-flight (real HTTP errors) · SSE re-emit     │
                       │  ├─ ToolCallNormalizer (delta.tool_calls markers)│
                       │  └─ FenceNormalizer (```tool_call fences + DSML  │
                       │      → standard delta.tool_calls)                │
                       │  finish_reason "tool_calls" · usage chunk        │
                       └───────────────┬─────────────────────────────────┘
                                       ▼
                              Client-driven agent loop
                       (execute tools → append {role:"tool"} results →
                        re-request with original tools → final answer)
```

Key modules:

| Module | Role |
| --- | --- |
| `src/app/api/v1/chat/completions/route.ts` | The OpenAI-compatible endpoint — validation, capability gates, failover, tool plumbing. |
| `src/lib/gateway/streaming-proxy.ts` | The heart of streaming — pre-flight, immediate delta forwarding, retries, failover markers. |
| `src/lib/gateway/tool-call-normalizer.ts` | Converts provider `__tool_calls` markers into incremental `delta.tool_calls`. |
| `src/lib/gateway/fence-normalizer.ts` | Converts text-embedded ```tool_call fences + DSML tags into `delta.tool_calls` (FIX B). |
| `src/lib/gateway/retry.ts` | Transient-error classification + backoff helpers (FIX A). |
| `src/lib/api/cors.ts` | CORS policy + preflight handlers. |
| `src/lib/tools/` | Tool definitions, validation, forwarding assertion, executor registry, diagnostics. |
| `src/lib/gateway/catalog.ts` | Static curated model catalog + health state (75 models, 17 providers). |
| `scripts/fetch-models.mjs` | Auto model fetch (see above). |

---

## Project structure

```text
freeaixyz/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Landing (warm-aurora design)
│   │   ├── chat/                     # Streaming playground
│   │   ├── models/                   # Model catalog UI
│   │   ├── docs/                     # 21-page documentation section
│   │   └── api/
│   │       ├── v1/chat/completions/  # ★ OpenAI-compatible endpoint
│   │       ├── v1/models/            # ★ model listing (+capabilities)
│   │       ├── v1/status/            # health snapshot
│   │       ├── tools/execute/        # ★ built-in tool executor
│   │       ├── v1/chat/*-proxy/      # freegpt / freeaixyz curl proxies
│   │       ├── debug/                # tools / stream / provider diagnostics
│   │       └── metrics/
│   ├── lib/
│   │   ├── api/cors.ts               # ★ CORS policy
│   │   ├── gateway/                  # streaming, normalizers, catalog, retry
│   │   ├── tools/                    # tool pipeline (validate/forward/execute)
│   │   └── providers/                # legacy provider registry
│   └── components/                   # aurora design system + docs kit
├── scripts/fetch-models.mjs          # ★ auto model fetch
├── tests/tool-pipeline.test.mjs      # tool pipeline test suite
├── examples/                         # runnable client snippets
├── vercel.json                       # streaming + CORS headers
└── next.config.ts                    # /v1 rewrites + CORS headers
```

---

## Testing

```bash
npm run lint             # eslint
npx tsc --noEmit         # strict typecheck
npm test                 # tool-pipeline suite (validation, forwarding,
                         #   streaming accumulation, follow-up shape,
                         #   fence round-trip, calculator, clamping)
node scripts/fetch-models.mjs   # live smoke test against prod
```

Live regression one-liners:

```bash
# tools arrive as STANDARD chunks (≥3 matches: name + arguments + finish_reason)
curl -sN -X POST https://freeaixyz4all.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"tb/gpt-4o-latest","stream":true,"messages":[{"role":"user","content":"Call get_weather for Tokyo."}],"tools":[{"type":"function","function":{"name":"get_weather","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],"tool_choice":"auto"}' \
  | grep -c '"tool_calls"'

# /v1 alias responds JSON, not HTML
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://freeaixyz4all.vercel.app/v1/models

# CORS preflight
curl -s -i -X OPTIONS https://freeaixyz4all.vercel.app/api/v1/chat/completions \
  -H "Origin: https://example.com" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | head -12
```

---

## FAQ

**Do I need an API key?**
No. Send nothing — or any placeholder if your SDK insists.

**Is it really free?**
Yes — the gateway rides on free community upstreams. They can rate-limit or vanish; the health system + failover keeps the surface stable, and `/api/v1/models` reflects reality.

**Why does a model say it "has no tools"?**
It shouldn't anymore. Two root causes were fixed at the gateway: (1) tools silently dropped from provider payloads — now asserted; (2) tool calls arriving as ```tool_call text fences — now normalized into standard `delta.tool_calls`. If a model genuinely can't call tools, you get a clean `TOOL_UNSUPPORTED` 400 instead.

**Which models support tool calling?**
`GET /api/v1/models` → filter `capabilities` for `"tools"` (add `"streaming"` for streaming tool calls). Or `node scripts/fetch-models.mjs --capabilities tools,streaming`.

**My browser app gets "Failed to fetch".**
That was CORS — now fully open (`*` origin, preflight `OPTIONS` on every route). If you still see it, check you're hitting an HTTPS deployment (mixed-content blocks) and that the base URL has no trailing path.

**OpenAI SDK says 404 on the default base URL?**
Any convention works now: bare domain, `/v1`, `/api/v1`. If you self-host an older build, add the rewrites from `next.config.ts`.

**How do I pick a model?**
`tb/*` for the widest GPT/Claude/DeepSeek coverage, `kc/*`/`oc/*` for native OpenAI-style tool streaming, `fx/*` for Claude-class text, `ua/*` for reasoning. Check `/api/v1/status` for current health.

**Is there a rate limit?**
No gateway-side limit. Upstream quotas surface as `RATE_LIMITED` 429 (retryable, `Retry-After` honored). Be nice — this is a shared free resource.

**Do you log my requests?**
No persistence. In-memory metrics (5-minute window) hold statuses/latencies only; tool diagnostics hold tool names/counts, never arguments.

**Streaming stops after `[DONE]`?**
That's the sentinel — end of stream. `finish_reason: "tool_calls"` means *you* should execute tools and send the follow-up request (see the agent loop above).

---

## Changelog

- **2026-09-03 — CORS-open + diagnosis fixes**
  - Full CORS: `Access-Control-Allow-Origin: *`, preflight `OPTIONS` on every API route, headers at route / routing / edge layers.
  - FIX A: transient upstream failures (incl. the intermittent "edge runtime crypto" 502) retried with backoff + provider failover on every path.
  - FIX B: text-embedded tool-call fences (```tool_call and DSML) normalized into standard `delta.tool_calls` streaming chunks + `finish_reason: "tool_calls"`; capability arrays always present on `/api/v1/models`.
  - FIX C: `/v1/chat/completions`, `/v1/models`, `/chat/completions`, `/api/models`, … compatibility aliases (JSON, never HTML 404s).
  - `scripts/fetch-models.mjs` auto model fetch script + this README.
- **2026-09-01 — warm-aurora app redesign** across landing / playground / models + a 21-page docs section.
- **2026-08-31 — tool-calling pipeline** (the "AI says it has no tools" fix): forwarding assertions, streamed `delta.tool_calls` accumulation, executor registry, client-driven agent loop, TOOL_* error taxonomy, diagnostics.
- **2026-08-30 — native-only refactor**: external providers / auth / BYOK / pricing infrastructure removed.

---

## Contributing

1. Fork & branch (`feat/…`).
2. `npm run lint && npx tsc --noEmit && npm test` must pass.
3. Keep the contracts: OpenAI wire shapes, error envelope, capability honesty, no secrets in logs.
4. PRs welcome — especially new provider adapters and fence-format coverage.

---

## License

[MIT](LICENSE) — use it, ship it, self-host it.

<div align="center">

**[freeaixyz4all.vercel.app](https://freeaixyz4all.vercel.app)** · 75 models · 17 providers · no keys · just ask.

</div>
