/**
 * THINKING-MODEL PHASE (two-round completions).
 *
 * Some fleet models are designated THINKING models. For those, every
 * completion fires TWO upstream rounds by default:
 *
 *   ROUND 1 — THE THINKING ROUND ("sent to the API differently"):
 *     A separate request with its own planning directive, a cooler
 *     temperature and NO tools. Its output is never shown as chat content —
 *     the gateway re-emits it as OpenAI-style `delta.reasoning_content`
 *     chunks ("the thinking delta"), which every OnyxAgent runtime (fg
 *     streamRound + bg runner extractDeltas) renders in the THINKING panel.
 *
 *   ROUND 2 — THE FINAL ROUND:
 *     The ORIGINAL request (tools included) with the round-1 thinking
 *     EMBEDDED as a system note right before the last message. Its response
 *     is the real answer: content deltas + structured `delta.tool_calls`
 *     when the model decides to call tools.
 *
 * Failure policy: the thinking round is best-effort. If it fails (upstream
 * error, timeout, empty), the final round still runs WITHOUT the embedded
 * note — a thinking-model request degrades to a normal completion instead
 * of erroring.
 *
 * Language: both phases are instructed to work in ENGLISH only (planning in
 * English, final answer in English) — matching the app-wide English-only
 * response contract.
 */

import type { ChatRequest, ProviderAdapter, StreamTimings } from "@/lib/gateway/types";
import { sanitizeVisibleContent } from "@/lib/gateway/output-sanitizer";
import type { FailoverCandidate } from "@/lib/gateway/streaming-proxy";
import { STREAM_HEADERS } from "@/lib/gateway/streaming-proxy";

/** Fleet ids that fire the two-round thinking flow by default. */
export const THINKING_FLEET_IDS: ReadonlySet<string> = new Set([
  "onyx-logos",
  "onyx-logos-research",
]);

/** Request-level trigger: body.reasoning_effort / body.thinking forces the
 *  two-round flow on ANY model (thinking models don't need it — they fire
 *  by default). Accepts any request-ish object (OpenAI bodies are
 *  `[key: string]: unknown`). */
export function requestWantsThinking(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (typeof b.reasoning_effort === "string" && b.reasoning_effort.trim()) return true;
  if (b.thinking === true) return true;
  if (
    b.thinking &&
    typeof b.thinking === "object" &&
    (b.thinking as { type?: unknown }).type === "enabled"
  ) {
    return true;
  }
  return false;
}

/** Round-1 planning directive (the "different" way the thinking request is
 *  sent upstream). Deliberately compact — the serialized upstream budget is
 *  ~9K chars and the real conversation still has to fit. */
const THINKING_DIRECTIVE = `You are the internal THINKING phase of an AI assistant. Your job: read the conversation and produce a SHORT private plan for the assistant's next reply.

Rules:
- Think in ENGLISH only.
- Maximum 150 words. Plain text, no markdown headers.
- Cover: what the user actually wants, how to answer (style, structure, length), whether a TOOL should be used (file creation, search, code, etc.) and which one, and any pitfalls to avoid.
- Do NOT write the answer itself. Do NOT address the user. This plan is private scaffolding, never shown to the user.
- Never invent features, products, buttons or step-by-step documentation you are not certain exist. If knowledge is missing, say "unknown" in the plan.`;

/** The embedded note for round 2 (system position, right before the last
 *  message). Round 2 is the request the caller actually made — tools stay
 *  attached so the final response may carry structured tool_calls. */
const THINKING_EMBED_HEADER =
  "Your private thinking from the planning phase follows. The user cannot see it. Use it to write a better answer, but never mention, quote or repeat it. Reply in English.";

/** Hard cap on the embedded thinking (protects the upstream prompt budget —
 *  the serialized budget is ~9K chars; a plan must never eat it). */
const THINKING_MAX_CHARS = 1600;

/** Build the round-1 request: directive + the user/assistant spine of the
 *  conversation (tool roles dropped — the planning phase plans, it does not
 *  need wire tool results verbatim), NO tools, cooler temperature. */
function buildThinkingRequest(req: ChatRequest): ChatRequest {
  const conversation = req.messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-8); // last 8 turns max — planning only needs recent context
  return {
    ...req,
    stream: false,
    tools: undefined,
    toolChoice: undefined,
    parallelToolCalls: undefined,
    temperature: 0.3,
    maxTokens: Math.min(req.maxTokens ?? 400, 400),
    messages: [
      { role: "system", content: THINKING_DIRECTIVE },
      ...conversation,
    ],
  };
}

/** Run the thinking round. Returns the sanitized plan, or null when the
 *  phase should be skipped (failure, empty, aborted — never fatal). */
export async function runThinkingRound(
  adapter: ProviderAdapter,
  req: ChatRequest,
): Promise<string | null> {
  if (req.signal?.aborted) return null;
  try {
    const thinkingReq = buildThinkingRequest(req);
    const result = await adapter.complete(thinkingReq);
    const text = sanitizeVisibleContent(result.text ?? "").trim();
    if (!text) return null;
    return text.length > THINKING_MAX_CHARS
      ? `${text.slice(0, THINKING_MAX_CHARS)}…`
      : text;
  } catch {
    // Best-effort phase — a thinking failure must never kill the request.
    return null;
  }
}

/** Embed the thinking into the original messages for round 2 (a system note
 *  inserted right before the LAST message so it reads as freshest context). */
export function embedThinking<T extends { role: string; content: string }>(
  messages: readonly T[],
  thinking: string,
): T[] {
  if (!thinking || messages.length === 0) return [...messages];
  const insertAt = Math.max(messages.length - 1, 0);
  const note = {
    role: "system",
    content: `${THINKING_EMBED_HEADER}\n\n<thinking>\n${thinking}\n</thinking>`,
  } as unknown as T;
  return [...messages.slice(0, insertAt), note, ...messages.slice(insertAt)];
}

// ─── Streaming composition ──────────────────────────────────────────────────

/** Chunk size for re-emitting the thinking text as reasoning deltas. Small
 *  enough that the thinking panel grows visibly, large enough not to spam
 *  (≈ a short sentence). */
const REASONING_CHUNK_SIZE = 96;

function reasoningChunk(
  sseId: string,
  created: number,
  model: string,
  fragment: string,
): string {
  return (
    `data: ${JSON.stringify({
      id: sseId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { reasoning_content: fragment }, finish_reason: null }],
    })}\n\n`
  );
}

/**
 * Two-round streaming for thinking models:
 *   1. run the thinking round (non-streaming upstream call, best-effort);
 *   2. if a plan was produced, open the SSE response with role +
 *      `reasoning_content` chunks for it;
 *   3. run the ORIGINAL request (thinking embedded) through streamChat and
 *      pipe its SSE body through unchanged — its own normalizers (tool-call
 *      fences, visible-content sanitizer, finish reasons, usage) all apply.
 *
 * When the thinking round yields nothing, this degrades to the plain
 * streamChat response (zero behavioral difference).
 */
export async function streamThinkingChat(
  req: ChatRequest,
  adapter: ProviderAdapter,
  fallbacks: FailoverCandidate[],
  streamChat: (
    r: ChatRequest,
    a: ProviderAdapter,
    f: FailoverCandidate[],
  ) => Promise<{ response: Response; timings: StreamTimings }>,
): Promise<{ response: Response; timings: StreamTimings }> {
  const thinking = await runThinkingRound(adapter, req);
  const finalReq: ChatRequest = thinking
    ? { ...req, messages: embedThinking(req.messages, thinking) }
    : req;
  const inner = await streamChat(finalReq, adapter, fallbacks);
  if (!thinking || inner.response.status !== 200) {
    // No plan (degraded) or a real HTTP error from the pre-flight — pass
    // the inner response through untouched.
    return inner;
  }

  const sseId = `chatcmpl-thinking-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Role chunk first (OpenAI convention), then the thinking deltas.
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: sseId,
              object: "chat.completion.chunk",
              created,
              model: req.modelId,
              choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
            })}\n\n`,
          ),
        );
        for (let i = 0; i < thinking.length; i += REASONING_CHUNK_SIZE) {
          controller.enqueue(
            encoder.encode(
              reasoningChunk(sseId, created, req.modelId, thinking.slice(i, i + REASONING_CHUNK_SIZE)),
            ),
          );
        }
        // Pipe the final-round SSE through unchanged (content + tool_calls
        // + finish + usage + [DONE] all come from the inner stream).
        if (inner.response.body) {
          const reader = inner.response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          } finally {
            try {
              reader.releaseLock();
            } catch {
              /* already released */
            }
          }
        }
      } catch {
        // The inner stream's own error handling already emitted its terminal
        // frames; nothing more to add here.
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      try {
        inner.response.body?.cancel();
      } catch {
        /* best-effort */
      }
    },
  });

  return {
    response: new Response(stream, { status: 200, headers: STREAM_HEADERS }),
    timings: inner.timings,
  };
}
