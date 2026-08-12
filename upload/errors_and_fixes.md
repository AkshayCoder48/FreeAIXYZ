# Errors found while testing FreeGPT models + JS/TS fix patterns

Endpoint tested: `https://freeaixyz4all.vercel.app/api/v1`

I tested every ID returned by `GET /api/v1/models` using `stream: true` and parsed the SSE `data:` JSON chunks. I also downloaded the public Next/Turbopack JS chunks from `/docs`; those chunks contain client/docs/runtime code only, not the private API-route/provider code, so the fixes below are inferred from the streamed JSON chunks and upstream error text.

## High-level problems

- `/models` returned **147** models, but many were not usable chat models.
- Provider failures were often sent as normal assistant text inside SSE chunks while HTTP status stayed `200`.
- Some models opened SSE and sent only keep-alives until timeout.
- Several IDs were non-chat tools/services but still appeared as chat models.
- Several working models showed delayed-first-content behavior consistent with simulated streaming.

---

## Error categories and fixes

| # | Error category | Count | Affected models | Likely root cause | Fix |
|---:|---|---:|---|---|---|
| 1 | Model listed but upstream does not recognize it | 2 | `codestral-latest`, `gpt-oss-20b` | `/models` registry is stale or maps to wrong upstream IDs | Validate models against provider registry before listing; return `400 invalid_model` before opening SSE |
| 2 | SSE opened but no content before timeout | 10 | `gpt-5`, `gpt-5.2`, `o3-mini`, `claude-sonnet-4`, `deepseek-r1`, `deepseek-v3`, `deepseek-v3.1`, `grok-4-fast`, `sw-qwen3-6-35b-iq3`, `sw-qwen3-6-35b-uncensored` | Gateway opens SSE first, then waits too long on dead/slow upstream | Add upstream timeout with `AbortController`; send structured error and close stream |
| 3 | Pollinations returned HTTP 500 wrapping `402 Payment Required` | 1 | `openai-fast` | Deprecated/payment-required Pollinations endpoint/model | Update provider endpoint/model or remove from free no-auth chat list |
| 4 | Kilo Code unavailable model, HTTP 404 | 2 | `laguna-m`, `ling-30-flash` | Listed Kilo model unavailable upstream | Health-check Kilo models and suppress unavailable ones |
| 5 | Kilo Code paid model auth required, HTTP 401 | 3 | `kilo-auto-frontier`, `kilo-auto-balanced`, `kilo-auto-efficient` | Paid models exposed in no-auth API | Remove from no-auth list or require configured Kilo auth |
| 6 | LLM7 missing API key, HTTP 401 | 2 | `l7-deepseek-v4-flash`, `l7-gemini-3-1-flash-lite` | Provider requires API key but gateway call lacks it | Configure key or hide models when key is missing |
| 7 | LLM7 rate/concurrency limit, HTTP 429 | 2 | `l7-codestral`, `l7-minimax-m2-7` | Upstream concurrency/rate limit | Add provider-level concurrency limit and `Retry-After` handling |
| 8 | FreeGPT challenge blocked, HTTP 403 | 16 | `fgpt-gpt-4o-mini`, `fgpt-gpt-5-3-free`, `fgpt-gpt-5-4-mini`, `fgpt-gpt-5-4-nano`, `fgpt-gpt-5-3-thinking-free`, `fgpt-gpt-5-free`, `fgpt-gpt-5-mini`, `fgpt-deepseek-v4-flash`, `fgpt-grok-3-mini`, `fgpt-grok-3`, `fgpt-gemini-2-5-pro`, `fgpt-grok-4-3`, `fgpt-gpt-4-1-nano`, `fgpt-nano-banana-2`, `fgpt-gpt-image-2`, `fgpt-gpt-5-4` | Anti-bot/challenge endpoint blocked | Mark provider unhealthy; don't list affected IDs until challenge flow is solved legally/reliably |
| 9 | FreeGPT rate limit exceeded, `8 req/min` | 40 | Many `fgpt-*` IDs | Docs say no rate limit, but upstream enforces one | Add limiter/queue/backoff and update docs; don't claim no rate limits |
| 10 | Miklium IDs return docs/generic API text instead of chat | 5 | `mk-miklium`, `mk-personalityless`, `mk-male`, `mk-female`, `mk-all` | Wrong provider endpoint mapping or non-chat APIs exposed as chat models | Exclude or add correct Miklium chat adapter |
| 11 | Swarm returned HTTP 500/HTML | 1 | `sw-qwen3-6-35b-q4` | Upstream returned HTML error page, not JSON/SSE | Detect non-JSON/non-SSE upstream errors and convert to structured API error |
| 12 | Swarm TTFT timeout/all servers failed, HTTP 503 | 1 | `sw-qwen3-6-35b-iq4` | Model did not start generating within upstream TTFT deadline | Retry/fallback; suppress model until healthy |
| 13 | Safety classifier exposed as chat model | 1 | `nemotron-safety` | Classification endpoint exposed as chat model | Mark capability as `safety`, not `chat` |
| 14 | Standalone services exposed as chat models | 2 | `web-search`, `music-generate` | Tool/service IDs included in chat model list | Remove from `GET /models` or add capabilities metadata; reject at chat endpoint |
| 15 | Model did not follow prompt / unexpected content | 1 | `fxyz-deepseek` | Model behavior/prompt following issue, not necessarily gateway crash | Optional retry or don't classify as gateway error |
| 16 | Likely simulated streaming | 31 prompt-following models | e.g. `toolbaz-v4.5-fast`, `toolbaz_v4`, `gemini-3-flash`, `fxyz-chatgpt`, `fxyz-grok`, etc. | Gateway probably waits for full upstream output, then splits it into SSE chunks | Proxy true upstream stream; if upstream cannot stream, send one chunk and don't claim token streaming |

---

## Fix 1: validate model and capability before opening SSE

Do this before creating a `text/event-stream` response. If the model is invalid/non-chat/unhealthy, return normal OpenAI-compatible JSON error with correct HTTP status.

```ts
const registry = new Map([
  // Example entries. Generate these from provider health/capability checks.
  ["toolbaz-v4.5-fast", { provider: "toolbaz", upstreamModel: "toolbaz-v4.5-fast", capabilities: ["chat"], healthy: true }],
  ["web-search", { provider: "search", upstreamModel: "web-search", capabilities: ["search"], healthy: true }],
  ["music-generate", { provider: "music", upstreamModel: "music-generate", capabilities: ["music"], healthy: true }]
]);

function openAIError(message: string, status = 400, code = "invalid_request_error") {
  return Response.json(
    {
      error: {
        message,
        type: status === 429 ? "rate_limit_error" : "invalid_request_error",
        code
      }
    },
    { status }
  );
}

export async function POST(req: Request) {
  const body = await req.json();
  const model = registry.get(body.model);

  if (!model) {
    return openAIError(`Model '${body.model}' is not supported`, 400, "invalid_model");
  }

  if (!model.capabilities.includes("chat")) {
    return openAIError(
      `Model '${body.model}' is a ${model.capabilities.join("/")} service, not a chat model`,
      400,
      "wrong_endpoint"
    );
  }

  if (!model.healthy) {
    return openAIError(`Model '${body.model}' is temporarily unavailable`, 503, "model_unavailable");
  }

  return callProvider(model, body);
}
```

---

## Fix 2: filter `/models` so it only lists usable chat models

This fixes errors like unsupported IDs, standalone services, safety classifiers, paid models, and missing-key models appearing as normal chat models.

```ts
export async function GET() {
  const chatModels = [...registry.entries()]
    .filter(([_, m]) => m.capabilities.includes("chat"))
    .filter(([_, m]) => m.healthy)
    .filter(([_, m]) => !m.requiresAuth || Boolean(process.env[m.authEnv ?? ""]))
    .filter(([_, m]) => !m.requiresPaidAccount)
    .map(([id, m]) => ({
      id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider
    }));

  return Response.json({ object: "list", data: chatModels });
}
```

If you want to expose search/music/image IDs, expose them separately:

```ts
return Response.json({
  object: "list",
  data: chatModels,
  services: {
    search: ["web-search"],
    music: ["music-generate"]
  }
});
```

---

## Fix 3: stop sending provider errors as assistant text

Observed bad behavior looked like this inside the SSE content:

```txt
data: {"choices":[{"delta":{"content":"\n\n[error: FreeGPT rate limit exceeded (8 req/min). Try again shortly.]"}}]}
```

That makes client apps think the assistant said the error. Send proper errors instead.

```ts
const encoder = new TextEncoder();

function sseJSON(obj: unknown) {
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function sseError(message: string, code = "upstream_error", status = 502) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { message, code, status } })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    }
  );
}
```

Better: if the upstream error is known before streaming starts, return HTTP `4xx/5xx` JSON instead of SSE.

---

## Fix 4: true streaming pass-through, not simulated streaming

Avoid this pattern:

```ts
// Bad: waits for full response, then fake-streams it.
const upstream = await fetch(providerUrl, opts);
const json = await upstream.json();
const full = json.choices[0].message.content;

for (const piece of splitIntoPieces(full)) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(makeDelta(piece))}\n\n`));
  await sleep(20);
}
```

Use direct upstream streaming when the provider supports it:

```ts
export const runtime = "edge";

async function callOpenAICompatibleProvider(model: any, body: any) {
  const upstream = await fetch(model.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    },
    body: JSON.stringify({
      ...body,
      model: model.upstreamModel,
      stream: true
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return openAIError(
      `${model.provider} returned HTTP ${upstream.status}: ${text.slice(0, 500)}`,
      upstream.status === 429 ? 429 : 502,
      "upstream_error"
    );
  }

  if (!upstream.body) {
    return openAIError(`${model.provider} returned no stream body`, 502, "empty_stream");
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
```

If a provider does **not** support real streaming, be honest and send one chunk:

```ts
function singleChunkResponse(text: string, model: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(sseJSON({
          id: `chatcmpl_${crypto.randomUUID()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
        }));
        controller.enqueue(sseJSON({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
  );
}
```

---

## Fix 5: provider timeout instead of endless keep-alives

This fixes models that opened SSE but never sent content.

```ts
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 25_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(`Upstream timeout after ${timeoutMs}ms`), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

Use it before or during provider call:

```ts
try {
  const upstream = await fetchWithTimeout(model.endpoint, requestOptions, 25_000);
  // handle upstream normally
} catch (err: any) {
  return openAIError(`Upstream timeout for ${model.provider}: ${err?.message ?? err}`, 504, "upstream_timeout");
}
```

---

## Fix 6: rate-limit/backoff provider adapters

This fixes FreeGPT `8 req/min`, LLM7 `429`, and concurrency-limit errors.

```ts
class ProviderLimiter {
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(private minGapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const waitMs = Math.max(0, this.lastStart + this.minGapMs - Date.now());
      if (waitMs) await new Promise(r => setTimeout(r, waitMs));
      this.lastStart = Date.now();
      return fn();
    });

    this.queue = next.catch(() => undefined);
    return next;
  }
}

const freeGptLimiter = new ProviderLimiter(8_000); // about 7.5 req/min, below observed 8 req/min

async function callFreeGPT(model: any, body: any) {
  return freeGptLimiter.run(() => callOpenAICompatibleProvider(model, body));
}
```

For `429` responses, honor `Retry-After`:

```ts
if (upstream.status === 429) {
  const retryAfter = upstream.headers.get("retry-after");
  return new Response(
    JSON.stringify({
      error: {
        message: `Upstream rate limit. Retry after ${retryAfter ?? "a few"} seconds.`,
        type: "rate_limit_error",
        code: "upstream_rate_limit"
      }
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...(retryAfter ? { "Retry-After": retryAfter } : {})
      }
    }
  );
}
```

---

## Fix 7: normalize provider error parsing

This handles JSON errors, plain text errors, and HTML pages like the Swarm HTTP 500 response.

```ts
async function readUpstreamError(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text().catch(() => "");

  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(raw);
      return json?.error?.message || json?.message || raw.slice(0, 500);
    } catch {
      return raw.slice(0, 500);
    }
  }

  // Strip HTML tags for provider HTML error pages.
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 500) || `HTTP ${res.status}`;
}

async function handleBadUpstream(res: Response, provider: string) {
  const msg = await readUpstreamError(res);

  const status =
    res.status === 401 ? 502 :
    res.status === 403 ? 503 :
    res.status === 404 ? 503 :
    res.status === 429 ? 429 :
    res.status >= 500 ? 502 : 400;

  return openAIError(`${provider} upstream error ${res.status}: ${msg}`, status, "upstream_error");
}
```

---

## Fix 8: capability-aware registry for non-chat tools

This fixes `web-search`, `music-generate`, image endpoints, and safety classifiers appearing as chat models.

```ts
type Capability = "chat" | "search" | "music" | "image" | "safety";

type ModelEntry = {
  id: string;
  provider: string;
  upstreamModel?: string;
  endpoint: string;
  capabilities: Capability[];
  healthy: boolean;
  requiresAuth?: boolean;
  requiresPaidAccount?: boolean;
};

const entries: ModelEntry[] = [
  {
    id: "aurora-l3-lunaris",
    provider: "auroraai",
    upstreamModel: "aurora-l3-lunaris",
    endpoint: "https://provider.example/chat/completions",
    capabilities: ["chat"],
    healthy: true
  },
  {
    id: "web-search",
    provider: "search",
    endpoint: "/api/v1/search",
    capabilities: ["search"],
    healthy: true
  },
  {
    id: "nemotron-safety",
    provider: "kilocode",
    endpoint: "https://provider.example/safety",
    capabilities: ["safety"],
    healthy: true
  }
];
```

Then `/api/v1/chat/completions` accepts only `capabilities.includes("chat")`.

---

## Fix 9: model health check before publishing `/models`

```ts
async function healthCheckModel(m: ModelEntry) {
  if (!m.capabilities.includes("chat")) return { ...m, healthy: false };
  if (m.requiresAuth && !process.env[`${m.provider.toUpperCase()}_API_KEY`]) {
    return { ...m, healthy: false };
  }

  try {
    const res = await fetchWithTimeout(m.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: m.requiresAuth ? `Bearer ${process.env[`${m.provider.toUpperCase()}_API_KEY`]}` : "" },
      body: JSON.stringify({
        model: m.upstreamModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      })
    }, 8_000);

    return { ...m, healthy: res.ok };
  } catch {
    return { ...m, healthy: false };
  }
}
```

Run this periodically and cache results. Do not list unhealthy models as available.

---

## Minimal corrected chat route skeleton

```ts
export const runtime = "edge";

export async function POST(req: Request) {
  let body: any;

  try {
    body = await req.json();
  } catch {
    return openAIError("Invalid JSON body", 400, "invalid_json");
  }

  const model = registry.get(body.model);

  if (!model) return openAIError(`Unknown model '${body.model}'`, 400, "invalid_model");
  if (!model.capabilities.includes("chat")) {
    return openAIError(`Use the dedicated ${model.capabilities[0]} endpoint for '${body.model}'`, 400, "wrong_endpoint");
  }
  if (!model.healthy) return openAIError(`Model '${body.model}' is unavailable`, 503, "model_unavailable");

  try {
    const upstream = await fetchWithTimeout(model.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {})
      },
      body: JSON.stringify({
        ...body,
        model: model.upstreamModel,
        stream: Boolean(body.stream)
      })
    }, 25_000);

    if (!upstream.ok) return handleBadUpstream(upstream, model.provider);

    if (body.stream) {
      if (!upstream.body) return openAIError("Upstream returned empty stream", 502, "empty_stream");

      return new Response(upstream.body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        }
      });
    }

    return new Response(upstream.body, {
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json" }
    });
  } catch (err: any) {
    return openAIError(`Gateway error: ${err?.message ?? err}`, 502, "gateway_error");
  }
}
```

---

## Main conclusion

The issue is not just frontend/client buffering. The SSE chunks show backend/provider problems:

1. `/models` includes stale, non-chat, paid, blocked, or unhealthy IDs.
2. Errors are wrapped as assistant text instead of structured API errors.
3. Some routes open SSE before knowing whether upstream works.
4. Some streams are likely simulated by splitting a completed response.

The most important fixes are: **capability-aware model registry, provider health checks, correct HTTP/SSE error handling, provider rate limiting, upstream timeouts, and true streaming pass-through.**
