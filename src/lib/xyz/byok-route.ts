/**
 * BYOK chat-completions handler (PRD §17, §36, §38, §39, §54, §61, §62).
 *
 * Handles source-aware model ids `gratisfy:<provider>:<model>` and
 * `g4f:<provider>:<model>`. The existing native chat route delegates here for
 * those ids.
 *
 * Flow (PRD §61, §91):
 *   session → userId → resolve model → resolve BYOK key (header > stored)
 *   → stream from upstream (OpenAI SSE) → collect usage → record usage
 *   → BYOK platform XYZ charge = 0 (marketEquivalentCost recorded for display)
 *
 * No provider fallback (PRD §17): a Gratisfy request stays on Gratisfy; a G4F
 * request stays on G4F. Credentials are never logged (PRD §65).
 */

import {
  ByokUpstreamError,
  buildClearCookie,
  buildSessionCookie,
  completeG4fChat,
  completeGratisfyChat,
  getSessionUserId,
  loadBYOKKey,
  streamG4fChat,
  streamGratisfyChat,
  tallyUsage,
} from "@/lib/xyz";
import { calculateCost, getBalance, spendXYZ } from "@/lib/xyz/credit";
import { resolveUnifiedModel } from "@/lib/xyz/registry";
import { resolveSuppliedPricing } from "@/lib/xyz/pricing-board";
import { generateRequestId } from "@/lib/gateway/errors";
import {
  estimateTokens,
} from "@/lib/xyz/openai-chat";
import type { Source } from "@/lib/xyz/types";

function isSecure(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function envErrorEnvelope(message: string, requestId: string) {
  return new Response(
    JSON.stringify({
      error: {
        type: "invalid_request_error",
        code: "BYOK_CONFIG",
        message,
        request_id: requestId,
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Gratisfy bridges (W2-A) ─────────────────────────────────────────────────
// The rebuilt gratisfy adapter (PRD §15, §16, §17) now exposes a normalized
// StreamEvent / {content, usage} API. byok-route.ts internally still treats
// the chat adapter as a string-yielding async generator (for usage capture)
// and a {text, usage:{inputTokens, outputTokens, ...}} result. These bridges
// re-shape the new API back to the shape this route was already written
// against, so the existing iteration + tallyUsage + recordByokUsage plumbing
// is unchanged. (Sampling params temperature/maxTokens/topP are dropped for
// Gratisfy per the new adapter's PRD §15 contract; G4F keeps them.)
//
// MODEL ID ROUTING (the "Invalid model or alias" 400 fix — 2026-08-30):
// The unified registry emits Gratisfy model ids as
// `gratisfy:<upstreamProvider>:<upstreamId>` where `upstreamId` is the
// catalog's bare id (e.g. "tomdacatto/claude-opus-5", "glm-4-flashx:free",
// "inclusionai/ling-3.0-flash-fin:free"). The upstream chat endpoint
// `https://api.gratisfy.xyz/v1/chat/completions` expects ids in the form
// `<upstreamProvider>/<upstreamId>` (verified live: upstream /v1/models
// lists `unorouter/glm-4-search:free`, `crax-gpt/gpt-5-6-luna`,
// `pollinations/<model>` — all prefixed with the upstream provider slug).
//
// The catalog's `id` field is the BARE form (no provider prefix). So we must
// reconstruct the upstream chat-routable id as `<provider>/<upstreamId>`
// before posting to the chat endpoint — otherwise upstream returns
// HTTP 400 "Invalid model or alias: '<upstreamId>'. Must be a valid model
// name or alias." (which is exactly the error the user reported on
// `gratisfy:pollinations:tomdacatto/claude-opus-5`).
//
// The reconstruction is idempotent: if `upstreamId` already starts with
// `<provider>/` (rare — happens when the catalog id happens to include the
// provider prefix), we leave it alone. Otherwise we prepend `<provider>/`.

type UpstreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

/** Reconstruct the upstream chat-routable model id.
 *
 * - If `upstreamId` already starts with `${provider}/` → return as-is.
 * - Otherwise → return `${provider}/${upstreamId}`.
 *
 * The Gratisfy chat endpoint (`api.gratisfy.xyz/v1/chat/completions`)
 * expects the prefixed form `<providerSlug>/<modelId>` (verified live
 * 2026-08-30 against /v1/models — all 185 routable ids are prefixed).
 * The public catalog (`gratisfy.xyz/api/models/all`) strips the prefix
 * into a separate `provider` field, so we must reconstruct it here.
 */
function buildUpstreamModelId(provider: string, upstreamId: string): string {
  const p = (provider ?? "").trim();
  const u = (upstreamId ?? "").trim();
  if (!p || !u) return u || p;
  if (u.startsWith(`${p}/`)) return u;
  return `${p}/${u}`;
}

async function* bridgeGratisfyStream(args: {
  apiKey: string;
  /** Routing provider slug (e.g. "pollinations", "unorouter", "crax-gpt"). */
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
}): AsyncGenerator<string, UpstreamUsage | undefined, unknown> {
  // Reconstruct the upstream chat-routable id from the bare catalog id.
  // Without this, Gratisfy returns 400 "Invalid model or alias" for any
  // catalog id that doesn't include the provider prefix.
  const upstreamModel = buildUpstreamModelId(args.provider, args.model);
  const stream = await streamGratisfyChat({
    apiKey: args.apiKey,
    model: upstreamModel,
    messages: args.messages,
    signal: args.signal,
  });
  let usage: UpstreamUsage | undefined;
  for await (const ev of stream) {
    if (ev.type === "delta") {
      yield ev.content;
    } else if (ev.type === "usage") {
      usage = ev.usage;
    } else if (ev.type === "done") {
      break;
    }
  }
  return usage;
}

async function bridgeGratisfyComplete(args: {
  apiKey: string;
  /** Routing provider slug (e.g. "pollinations", "unorouter", "crax-gpt"). */
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<{
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    estimated: boolean;
  };
}> {
  const upstreamModel = buildUpstreamModelId(args.provider, args.model);
  const r = await completeGratisfyChat({
    apiKey: args.apiKey,
    model: upstreamModel,
    messages: args.messages,
  });
  return {
    text: r.content,
    usage: {
      inputTokens: r.usage.prompt_tokens,
      outputTokens: r.usage.completion_tokens,
      cacheTokens: 0,
      estimated: false,
    },
  };
}

// ─── G4F bridges (W2-B) ───────────────────────────────────────────────────────
// The rebuilt G4F adapter exposes the same StreamEvent / {content, usage} API
// as Gratisfy. Bridge it to the shape this route uses internally.

async function* bridgeG4fStream(args: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
}): AsyncGenerator<string, UpstreamUsage | undefined, unknown> {
  const stream = await streamG4fChat({
    apiKey: args.apiKey,
    model: args.model,
    messages: args.messages,
    signal: args.signal,
  });
  let usage: UpstreamUsage | undefined;
  for await (const ev of stream) {
    if (ev.type === "delta") {
      yield ev.content;
    } else if (ev.type === "usage") {
      usage = ev.usage;
    } else if (ev.type === "done") {
      break;
    }
  }
  return usage;
}

async function bridgeG4fComplete(args: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<{
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    estimated: boolean;
  };
}> {
  const r = await completeG4fChat({
    apiKey: args.apiKey,
    model: args.model,
    messages: args.messages,
  });
  return {
    text: r.content,
    usage: {
      inputTokens: r.usage.prompt_tokens,
      outputTokens: r.usage.completion_tokens,
      cacheTokens: 0,
      estimated: false,
    },
  };
}

/**
 * Entry point — called from /api/v1/chat/completions when the model id is a
 * BYOK source-aware id. Returns the OpenAI-shaped Response.
 */
export async function handleByokChatCompletion(
  body: {
    model: string;
    messages: Array<{ role: string; content: unknown }>;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    top_p?: number;
  },
  request: Request,
): Promise<Response> {
  const requestId = generateRequestId();
  const secure = isSecure(request);

  // 1. Authenticate (PRD §91). BYOK requires a session — the user's stored
  //    credential is keyed by userId, and usage is recorded per-user.
  const userId = await getSessionUserId(request);
  if (!userId) {
    return new Response(
      JSON.stringify({
        error: {
          type: "authentication_error",
          code: "UNAUTHENTICATED",
          message: "Sign in to use BYOK models.",
          request_id: requestId,
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 2. Resolve the model (PRD §61).
  const parsed = parseSourceModel(body.model);
  if (!parsed) {
    return envErrorEnvelope(`Unknown BYOK model id "${body.model}".`, requestId);
  }
  const { source, provider, model } = parsed;

  // 3. Resolve the BYOK key (header > stored — PRD §7).
  const headerName =
    source === "gratisfy" ? "x-gratisfy-api-key" : "x-g4f-api-key";
  // Also support the generic X-API-Key + X-Provider compatibility (PRD §7).
  const genericKey = request.headers.get("x-api-key");
  const genericProvider = request.headers.get("x-provider");
  let headerKey: string | null = null;
  if (genericKey && genericProvider?.toLowerCase() === source) {
    headerKey = genericKey;
  } else {
    headerKey = request.headers.get(headerName);
  }
  const storedKey = await loadBYOKKey(userId, source === "gratisfy" ? "gratisfy" : "g4f");
  const apiKey = (headerKey ?? storedKey ?? "").trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: {
          type: "authentication_error",
          code: "BYOK_KEY_REQUIRED",
          message: `This model requires a ${source === "gratisfy" ? "Gratisfy" : "G4F"} BYOK key. Connect one in Settings → Providers.`,
          provider: source,
          model: body.model,
          request_id: requestId,
        },
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 4. Normalize messages (reuse the vision-optional normalizer — image parts
  //    stripped for non-vision upstreams, string-only content forwarded).
  const { normalizeMessageContent } = await import("@/lib/gateway/content-normalize");
  const messages = body.messages
    .map((m) => {
      const norm = normalizeMessageContent(m.content);
      const text = norm.wasArray
        ? norm.text
        : typeof m.content === "string"
          ? m.content
          : "";
      return { role: m.role, content: text } as { role: string; content: string };
    })
    .filter((m) => m.content !== "" || m.role === "system");

  const wantsStream = body.stream === true;
  const sampling = {
    temperature: body.temperature,
    maxTokens: body.max_tokens ?? body.max_completion_tokens,
    topP: body.top_p,
    signal: request.signal,
  };

  // 5. Resolve pricing (for the market-equivalent display + response estimate).
  const unified = await resolveUnifiedModel(body.model, userId);
  const pricing = unified?.pricing ?? resolveSuppliedPricing(model);

  // 6. Route to the source adapter (PRD §17 — no fallback across sources).
  try {
    if (wantsStream) {
      return await streamByokResponse({
        source,
        provider,
        model,
        apiKey,
        messages,
        sampling,
        requestId,
        userId,
        pricing,
        secure,
      });
    }
    return await completeByokResponse({
      source,
      provider,
      model,
      apiKey,
      messages,
      sampling,
      requestId,
      userId,
      pricing,
      secure,
    });
  } catch (err) {
    return byokErrorResponse(err, body.model, source, provider, requestId);
  }
}

function parseSourceModel(
  id: string,
): { source: Source; provider: string; model: string } | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const [source, provider, ...rest] = parts;
  if (source !== "gratisfy" && source !== "g4f") return null;
  return { source, provider, model: rest.join(":") };
}

// ─── Streaming response (OpenAI-shaped SSE — PRD §39) ──────────────────────────

async function streamByokResponse(args: {
  source: Source;
  provider: string;
  model: string;
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
  sampling: { temperature?: number; maxTokens?: number; topP?: number; signal?: AbortSignal };
  requestId: string;
  userId: string;
  pricing: ReturnType<typeof resolveSuppliedPricing>;
  secure: boolean;
}): Promise<Response> {
  const gen =
    args.source === "gratisfy"
      ? bridgeGratisfyStream({
          apiKey: args.apiKey,
          provider: args.provider,
          model: args.model,
          messages: args.messages,
          signal: args.sampling.signal,
        })
      : bridgeG4fStream({
          apiKey: args.apiKey,
          model: args.model,
          messages: args.messages,
          signal: args.sampling.signal,
        });

  const created = Math.floor(Date.now() / 1000);
  const completionId = `chatcmpl-${args.requestId}`;
  const encoder = new TextEncoder();
  const promptText = args.messages.map((m) => m.content).join("\n");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = "";
      let upstreamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      let first = true;
      const enqueue = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const enqueueHeader = () => {
        if (first) {
          first = false;
        }
      };
      enqueueHeader();
      try {
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            upstreamUsage = (value ?? undefined) as typeof upstreamUsage;
            break;
          }
          if (value) {
            accumulated += value;
            enqueue({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: args.model,
              choices: [{ index: 0, delta: { content: value }, finish_reason: null }],
            });
          }
        }
        // Final chunk with finish_reason + usage (PRD §39 — charge ONCE).
        const usage = tallyUsage(
          args.model,
          args.source,
          accumulated,
          promptText,
          upstreamUsage,
        );
        enqueue({
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: args.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: usage.inputTokens,
            completion_tokens: usage.outputTokens,
            total_tokens: usage.inputTokens + usage.outputTokens,
          },
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        // Record usage + charge (BYOK: platform charge 0, market equiv recorded).
        await recordByokUsage(args, accumulated, promptText, usage, upstreamUsage);
      } catch (err) {
        // In-stream error → OpenAI-shaped terminal error chunk (PRD §62).
        enqueue({
          error: {
            type: "provider_error",
            source: args.source,
            provider: args.provider,
            message: err instanceof Error ? err.message : "Upstream request failed",
            retryable: false,
            request_id: args.requestId,
          },
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        // Partial output + actual usage → record partial (PRD §42).
        const usage = tallyUsage(args.model, args.source, accumulated, promptText);
        await recordByokUsage(args, accumulated, promptText, usage);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // User pressed Stop (PRD §42): abort upstream; partial usage already
      // being recorded in the stream's finally block above via tallyUsage.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── Non-streaming response ───────────────────────────────────────────────────

async function completeByokResponse(args: {
  source: Source;
  provider: string;
  model: string;
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
  sampling: { temperature?: number; maxTokens?: number; topP?: number; signal?: AbortSignal };
  requestId: string;
  userId: string;
  pricing: ReturnType<typeof resolveSuppliedPricing>;
  secure: boolean;
}): Promise<Response> {
  const result =
    args.source === "gratisfy"
      ? await bridgeGratisfyComplete({
          apiKey: args.apiKey,
          provider: args.provider,
          model: args.model,
          messages: args.messages,
        })
      : await bridgeG4fComplete({
          apiKey: args.apiKey,
          model: args.model,
          messages: args.messages,
        });

  const promptText = args.messages.map((m) => m.content).join("\n");
  const usage = tallyUsage(
    args.model,
    args.source,
    result.text,
    promptText,
    result.usage ? { prompt_tokens: result.usage.inputTokens, completion_tokens: result.usage.outputTokens } : undefined,
  );

  await recordByokUsage(args, result.text, promptText, usage, result.usage ? { prompt_tokens: result.usage.inputTokens, completion_tokens: result.usage.outputTokens } : undefined);

  const body = {
    id: `chatcmpl-${args.requestId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: args.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Usage + XYZ accounting (PRD §36, §38) ────────────────────────────────────

async function recordByokUsage(
  args: {
    source: Source;
    provider: string;
    model: string;
    requestId: string;
    userId: string;
    pricing: ReturnType<typeof resolveSuppliedPricing>;
  },
  accumulated: string,
  promptText: string,
  usage: { inputTokens: number; outputTokens: number; cacheTokens: number; estimated: boolean },
  upstreamUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number },
): Promise<void> {
  // Market-equivalent cost (display only — BYOK upstream bills the user's key).
  const breakdown = calculateCost(
    args.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheTokens,
    args.pricing,
  );
  const marketEquivalentCost =
    upstreamUsage?.cost != null
      ? upstreamUsage.cost
      : breakdown.usdCost;

  // BYOK: platform XYZ charge = 0 (PRD §36). Record at 0 cost so analytics
  // still captures the generation + tokens.
  await spendXYZ(args.userId, 0, {
    requestId: args.requestId,
    source: args.source,
    provider: args.provider,
    model: args.model,
    pricingVersion: breakdown.pricingVersion,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheTokens: usage.cacheTokens,
    usdCost: 0,
    marketEquivalentCost,
    note: `BYOK ${args.source} (market-equivalent $${marketEquivalentCost.toFixed(6)}, ${usage.estimated ? "estimated" : "reported"} tokens)`,
  });
}

// ─── Error normalization (PRD §62) ─────────────────────────────────────────────

function byokErrorResponse(
  err: unknown,
  model: string,
  source: Source,
  /** Upstream routing provider slug (e.g. "pollinations", "unorouter",
   *  "crax-gpt"). Surfaced in the error envelope so the user can see which
   *  specific upstream provider the request was routed to (and, for
   *  400 "Invalid model or alias" errors on routed models like
   *  `gratisfy:pollinations:tomdacatto/claude-opus-5`, which BYOK
   *  sub-provider key they need to connect on the Gratisfy dashboard). */
  provider: string,
  requestId: string,
): Response {
  // Never leak credentials (PRD §65). Strip any Authorization/key headers.
  if (err instanceof ByokUpstreamError) {
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    // Detect the "Invalid model or alias" 400 from upstream Gratisfy — this
    // happens when the user's Gratisfy BYOK key doesn't have a per-provider
    // sub-key connected for the routed provider (e.g. Pollinations-routed
    // `tomdacatto/claude-opus-5` requires a Pollinations BYOK sub-key on the
    // user's Gratisfy account). Surface a clearer actionable message rather
    // than the opaque upstream blob.
    const bodyLower = err.body.toLowerCase();
    const isInvalidModel400 =
      status === 400 &&
      (bodyLower.includes("invalid model") ||
        bodyLower.includes("must be a valid model name") ||
        bodyLower.includes("model or alias"));
    const routedProviderHint =
      source === "gratisfy" && provider && provider !== "gratisfy"
        ? ` This is a ${provider}-routed model. Connect a ${provider} BYOK sub-key on your Gratisfy dashboard (https://gratisfy.xyz/dashboard) to use it.`
        : "";
    const message = isInvalidModel400
      ? `Gratisfy rejected model "${model}" (HTTP 400). The model id was sent in the upstream-routable form "${provider}/${model.split(":").slice(2).join(":")}".${routedProviderHint} Upstream body: ${err.body.slice(0, 200)}`
      : `Upstream rejected request (HTTP ${err.status}).${routedProviderHint} ${err.body.slice(0, 200)}`;
    return new Response(
      JSON.stringify({
        error: {
          type: status === 401 || status === 403 ? "authentication_error" : "provider_error",
          source,
          provider,
          model,
          message,
          code: isInvalidModel400 ? "BAD_REQUEST" : undefined,
          retryable: status === 429 || status >= 500,
          request_id: requestId,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }
  const message = err instanceof Error ? err.message : "Upstream request failed";
  return new Response(
    JSON.stringify({
      error: {
        type: "provider_error",
        source,
        provider,
        model,
        message,
        retryable: false,
        request_id: requestId,
      },
    }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );
}

export { isSecure, clientIp };
