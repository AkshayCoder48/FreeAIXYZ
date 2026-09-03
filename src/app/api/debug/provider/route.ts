/**
 * GET /api/debug/provider — Live provider diagnostic dashboard endpoint
 * (PRD §22).
 *
 * Runs ONE live diagnostic (NOT 10 — keep it light) against the gateway
 * itself (loopback to `/api/v1/chat/completions` with the given model +
 * a tool-enabled request). Captures:
 *   - the raw upstream stream (every `data:` frame as received)
 *   - the parsed stream (typed: TEXT_DELTA | TOOL_CALL_DELTA | DONE | ERROR)
 *   - the normalized stream (sequence of normalized event types)
 *   - the final diagnosis: failure layer + root cause + regression status
 *
 * Returns a JSON envelope (PRD §22):
 *   {
 *     provider, model, requestId,
 *     network: { httpStatus, responseHeaders, streamingEnabled, firstByteMs,
 *                streamDurationMs },
 *     rawStream: ["data: {...}", "data: {...}", "data: [DONE]"],
 *     parsedStream: [{type:"TEXT_DELTA", content:"..."}, {…tool_call…}],
 *     normalizedStream: ["TEXT_DELTA", "TOOL_CALL_DELTA", "DONE"],
 *     finalDiagnosis: { failureLayer, rootCause, evidence, regressionStatus }
 *   }
 *
 * Forbidden (PRD §2): NO provider fallback, NO model fallback, NO silent
 * switching, NO retry-another-provider, NO generic error message, NO
 * non-streaming substitution, NO hiding failures.
 */

import { NextResponse } from "next/server";
import { withCors, corsPreflight } from "@/lib/api/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Default model + provider for the diagnostic (kilocode is the canary). */
const DEFAULT_PROVIDER = "kilocode";
const DEFAULT_MODEL = "kc/kilo-auto-free";

/** Build the loopback URL for the gateway's chat completions route. */
function gatewayChatUrl(req: Request): string {
  // `req.url` is the absolute URL of THIS request
  // (e.g. http://localhost:3000/api/debug/provider?…). We derive the gateway
  // chat URL from it so the loopback works in dev, on Vercel preview, and
  // in prod without any hardcoded host.
  const base = new URL(req.url);
  return `${base.origin}/api/v1/chat/completions`;
}

/**
 * Minimal inline SSE splitter (PRD §17-§20). A network chunk ≠ an SSE
 * event. Maintains an incomplete-event buffer across chunks; correctly
 * handles UTF-8 split across byte boundaries, multi-line `data:` fields,
 * CRLF/LF, and `[DONE]` termination.
 *
 * Inlined (rather than imported from `@/lib/gateway/sse-parser`) so this
 * route stays a pure wire-level observer — independent of any internal
 * helper that might itself be the layer under test.
 */
class SseSplitter {
  private decoder = new TextDecoder("utf-8");
  private buffer = "";
  private currentData: string[] = [];
  private currentEvent: string | undefined;
  private currentId: string | undefined;
  private currentRetry: number | undefined;
  private doneSeen = false;

  feed(chunk: Uint8Array): SseEvent[] {
    if (this.doneSeen) return [];
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  end(): SseEvent[] {
    this.buffer += this.decoder.decode();
    const events = this.drain();
    if (!this.doneSeen && (this.currentData.length > 0 || this.currentEvent || this.currentId)) {
      events.push(this.buildEvent());
      this.resetCurrent();
    }
    this.doneSeen = true;
    return events;
  }

  private drain(): SseEvent[] {
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;
      this.processLine(stripped, events);
      if (this.doneSeen) break;
    }
    return events;
  }

  private processLine(line: string, events: SseEvent[]): void {
    if (line === "") {
      if (this.currentData.length > 0 || this.currentEvent || this.currentId) {
        events.push(this.buildEvent());
        this.resetCurrent();
      }
      return;
    }
    if (line.startsWith(":")) return; // heartbeat / comment
    const colonIdx = line.indexOf(":");
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        this.currentData.push(value);
        break;
      case "event":
        this.currentEvent = value;
        break;
      case "id":
        this.currentId = value;
        break;
      case "retry": {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) this.currentRetry = n;
        break;
      }
      default:
        break;
    }
  }

  private buildEvent(): SseEvent {
    const data = this.currentData.join("\n");
    if (data === "[DONE]") {
      this.doneSeen = true;
      return { data, event: undefined, id: undefined, retry: undefined, done: true };
    }
    return {
      data,
      event: this.currentEvent,
      id: this.currentId,
      retry: this.currentRetry,
      done: false,
    };
  }

  private resetCurrent(): void {
    this.currentData = [];
    this.currentEvent = undefined;
    this.currentId = undefined;
    this.currentRetry = undefined;
  }
}

interface SseEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
  done: boolean;
}

/** Redact any auth-bearing headers (PRD §6 — no credentials in the dump). */
function redactHeaderSet(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "x-api-key" ||
        lk.includes("token") || lk.includes("secret")) {
      out[k] = v ? `[REDACTED:len=${v.length}]` : v;
    } else {
      out[k] = v;
    }
  });
  return out;
}

/** A simple weather function tool definition (PRD §5 Test C). */
const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city name, e.g. 'Paris'.",
        },
      },
      required: ["location"],
    },
  },
};

/**
 * Build the OpenAI-shaped request body for the gateway loopback.
 * The model id is the CANONICAL form (`kc/kilo-auto-free`) — the gateway
 * resolves it via the catalog.
 */
function buildLoopbackBody(model: string) {
  return {
    model,
    stream: true,
    messages: [
      {
        role: "user",
        content: "What's the weather in Paris right now? Use the get_weather tool.",
      },
    ],
    tools: [WEATHER_TOOL],
    tool_choice: "auto",
  };
}

/**
 * Classify one SSE event into a typed parsed-stream entry (PRD §22).
 * Detects:
 *   - DONE             → `data: [DONE]`
 *   - TEXT_DELTA       → `choices[0].delta.content` (plain text)
 *   - TOOL_CALL_DELTA  → `choices[0].delta.tool_calls` (CORRECT, post-fix)
 *   - RAW_TOOL_CALL_LEAK → `choices[0].delta.content` contains the
 *                          `__tool_calls` marker substring (THE BUG, pre-fix)
 *   - REASONING_DELTA  → `choices[0].delta.reasoning_content`
 *   - FINISH           → `choices[0].finish_reason` set
 *   - ERROR            → top-level `error` field (vexa-style)
 *   - USAGE            → `choices: []` + `usage` block (audit E2)
 *   - EMPTY            → comment-only / heartbeat / no usable data
 *   - PARSE_ERROR      → `data:` frame failed JSON.parse
 */
interface ParsedEntry {
  type:
    | "DONE"
    | "TEXT_DELTA"
    | "TOOL_CALL_DELTA"
    | "RAW_TOOL_CALL_LEAK"
    | "REASONING_DELTA"
    | "FINISH"
    | "ERROR"
    | "USAGE"
    | "EMPTY"
    | "PARSE_ERROR";
  content?: string;
  index?: number;
  name?: string;
  fragment?: string;
  finishReason?: string;
  errorMessage?: string;
  parseError?: string;
  rawPreview?: string;
}

function classifyEvent(ev: SseEvent): ParsedEntry {
  if (ev.done) return { type: "DONE" };
  if (!ev.data) return { type: "EMPTY" };
  let json: { choices?: Array<Record<string, unknown>>; error?: unknown; usage?: unknown };
  let parseErr: string | undefined;
  try {
    json = JSON.parse(ev.data);
  } catch (err) {
    parseErr = err instanceof Error ? err.message : String(err);
    return {
      type: "PARSE_ERROR",
      parseError: parseErr,
      rawPreview: ev.data.slice(0, 200),
    };
  }
  if (json && json.error) {
    const errObj = json.error;
    return {
      type: "ERROR",
      errorMessage:
        typeof errObj === "string"
          ? errObj
          : (errObj as { message?: string })?.message ||
            JSON.stringify(errObj).slice(0, 300),
    };
  }
  const choice = json?.choices?.[0];
  if (!choice) {
    if (json && json.usage) return { type: "USAGE" };
    return { type: "EMPTY" };
  }
  const delta = (choice.delta as Record<string, unknown> | undefined) || {};
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    const tc = delta.tool_calls[0] as {
      index?: number;
      function?: { name?: string; arguments?: string };
    };
    return {
      type: "TOOL_CALL_DELTA",
      index: typeof tc.index === "number" ? tc.index : 0,
      name: tc?.function?.name,
      fragment: tc?.function?.arguments,
    };
  }
  if (typeof delta.content === "string" && delta.content.length > 0) {
    // THE BUG (pre-fix): `__tool_calls` marker leaked as content.
    if (delta.content.includes("__tool_calls")) {
      return {
        type: "RAW_TOOL_CALL_LEAK",
        content: delta.content,
      };
    }
    return { type: "TEXT_DELTA", content: delta.content };
  }
  if (
    typeof delta.reasoning_content === "string" &&
    delta.reasoning_content.length > 0
  ) {
    return { type: "REASONING_DELTA", content: delta.reasoning_content };
  }
  const finishReason = choice.finish_reason;
  if (finishReason) {
    return { type: "FINISH", finishReason: String(finishReason) };
  }
  return { type: "EMPTY" };
}

/** GET /api/debug/provider — single-run live diagnostic. */
export async function GET(req: Request): Promise<Response> {
  return withCors(await providerDebug(req));
}

/** CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function providerDebug(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") || DEFAULT_PROVIDER;
  const model = url.searchParams.get("model") || DEFAULT_MODEL;
  const runsParam = url.searchParams.get("runs");
  // PRD §22: keep it light — 1 run, regardless of `runs` param (param is
  // accepted for API symmetry with the script but capped at 1 here).
  void runsParam;

  const requestId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `diag_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const loopbackUrl = gatewayChatUrl(req);
  const body = buildLoopbackBody(model);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };

  // Network + timing collectors
  const network = {
    httpStatus: null as number | null,
    responseHeaders: {} as Record<string, string>,
    streamingEnabled: true,
    firstByteMs: null as number | null,
    streamDurationMs: null as number | null,
  };
  const rawStream: string[] = [];
  const parsedStream: ParsedEntry[] = [];
  const normalizedStream: string[] = [];

  let failureLayer: "Provider" | "Transport" | "Parser" | "Normalizer" | "none" = "none";
  let rootCause = "";
  const evidence: string[] = [];
  let sawToolCallDelta = false;
  let sawRawLeak = false;
  let sawTextDelta = false;
  let sawFinish = false;
  let sawDone = false;
  let parserErrorCount = 0;
  let prematureTermination = false;

  const t0 = Date.now();
  let firstByteAt: number | null = null;

  let response: Response;
  try {
    response = await fetch(loopbackUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    failureLayer = "Transport";
    rootCause = `loopback fetch threw: ${err instanceof Error ? err.message : String(err)}`;
    return NextResponse.json(
      {
        provider,
        model,
        requestId,
        network: {
          ...network,
          streamingEnabled: false,
        },
        rawStream,
        parsedStream,
        normalizedStream,
        finalDiagnosis: {
          failureLayer,
          rootCause,
          evidence: evidence.length ? evidence : ["loopback fetch rejected"],
          regressionStatus: "FAIL",
        },
      },
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  network.httpStatus = response.status;
  network.responseHeaders = redactHeaderSet(response.headers);
  const contentType = response.headers.get("content-type") || "";
  network.streamingEnabled = contentType.includes("text/event-stream");

  if (response.status >= 400) {
    failureLayer = "Provider";
    let errBody = "";
    try {
      errBody = await response.text();
    } catch {
      /* best-effort */
    }
    rootCause = `gateway returned HTTP ${response.status} ${response.statusText}`;
    evidence.push(`errorBody=${errBody.slice(0, 500)}`);
    return NextResponse.json(
      {
        provider,
        model,
        requestId,
        network,
        rawStream,
        parsedStream,
        normalizedStream,
        finalDiagnosis: {
          failureLayer,
          rootCause,
          evidence,
          regressionStatus: "FAIL",
        },
      },
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!response.body) {
    failureLayer = "Transport";
    rootCause = "gateway returned no response body";
    return NextResponse.json(
      {
        provider,
        model,
        requestId,
        network: { ...network, streamingEnabled: false },
        rawStream,
        parsedStream,
        normalizedStream,
        finalDiagnosis: {
          failureLayer,
          rootCause,
          evidence,
          regressionStatus: "FAIL",
        },
      },
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const reader = response.body.getReader();
  const splitter = new SseSplitter();

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        failureLayer = "Transport";
        rootCause = `reader.read() threw: ${err instanceof Error ? err.message : String(err)}`;
        prematureTermination = true;
        break;
      }
      const { done, value } = readResult;
      if (done || !value) break;
      if (firstByteAt === null) {
        firstByteAt = Date.now();
        network.firstByteMs = firstByteAt - t0;
      }
      const events = splitter.feed(value);
      for (const ev of events) {
        rawStream.push(ev.data ? `data: ${ev.data}` : "(empty)");
        const parsed = classifyEvent(ev);
        parsedStream.push(parsed);
        normalizedStream.push(parsed.type);

        switch (parsed.type) {
          case "DONE":
            sawDone = true;
            break;
          case "TEXT_DELTA":
            sawTextDelta = true;
            break;
          case "TOOL_CALL_DELTA":
            sawToolCallDelta = true;
            evidence.push(
              `TOOL_CALL_DELTA index=${parsed.index} name=${parsed.name ?? ""} fragLen=${parsed.fragment?.length ?? 0}`,
            );
            break;
          case "RAW_TOOL_CALL_LEAK":
            sawRawLeak = true;
            evidence.push(
              `RAW_TOOL_CALL_LEAK content=${(parsed.content ?? "").slice(0, 200)}`,
            );
            break;
          case "FINISH":
            sawFinish = true;
            evidence.push(`FINISH reason=${parsed.finishReason}`);
            break;
          case "ERROR":
            failureLayer = "Provider";
            evidence.push(`ERROR msg=${parsed.errorMessage}`);
            break;
          case "PARSE_ERROR":
            parserErrorCount++;
            if (failureLayer === "none") failureLayer = "Parser";
            evidence.push(`PARSE_ERROR err=${parsed.parseError}`);
            break;
          case "USAGE":
          case "EMPTY":
          case "REASONING_DELTA":
            // no-op for diagnosis
            break;
        }
      }
      // OpenAI clients stop reading at the `[DONE]` sentinel — it is the
      // protocol-level end of stream. Vercel/edge runtimes sometimes keep
      // the underlying socket open in keep-alive mode after [DONE] is sent,
      // which would otherwise hang this loop until maxDuration. Break as
      // soon as we see [DONE] (PRD §19 — no infinite waits).
      if (sawDone) {
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* best-effort */
    }
    network.streamDurationMs = Date.now() - t0;
  }

  // Final classification (PRD §22).
  if (!sawDone && failureLayer === "none") {
    prematureTermination = true;
    failureLayer = "Transport";
    rootCause = "stream ended without [DONE] sentinel (premature termination)";
  }
  if (failureLayer === "none" && sawRawLeak) {
    failureLayer = "Normalizer";
    rootCause =
      "streaming-proxy forwarded __tool_calls markers as delta.content — the ToolCallNormalizer missed them (regression)";
  }
  if (failureLayer === "none" && sawToolCallDelta && !sawRawLeak) {
    rootCause =
      "(post-fix) ToolCallNormalizer intercepts __tool_calls markers and emits proper OpenAI delta.tool_calls chunks";
  }
  if (
    failureLayer === "none" &&
    !sawToolCallDelta &&
    !sawRawLeak &&
    sawTextDelta
  ) {
    rootCause =
      "no tool calls in stream — model produced text only (no leak, no tool_call_delta). The tool was either not invoked or the upstream returned prose.";
  }
  if (
    failureLayer === "none" &&
    !sawToolCallDelta &&
    !sawRawLeak &&
    !sawTextDelta
  ) {
    rootCause = "no deltas observed — stream may be empty";
  }
  if (!rootCause) rootCause = "no specific root cause identified";

  // Regression status:
  //   - PASS = the normalizer is doing its job (saw proper delta.tool_calls OR
  //     the model just chose not to call the tool — no leak either way).
  //   - FAIL  = raw __tool_calls leak detected (Normalizer regression), OR
  //     a non-Normalizer failure (Provider/Transport/Parser) was observed.
  let regressionStatus: "PASS" | "FAIL" | "UNKNOWN";
  if (sawRawLeak || prematureTermination || failureLayer !== "none") {
    regressionStatus = "FAIL";
  } else if (sawToolCallDelta) {
    regressionStatus = "PASS";
  } else {
    // No tool calls observed either way — can't confirm PASS or FAIL.
    regressionStatus = "UNKNOWN";
  }

  return NextResponse.json(
    {
      provider,
      model,
      requestId,
      network,
      rawStream,
      parsedStream,
      normalizedStream,
      finalDiagnosis: {
        failureLayer,
        rootCause,
        evidence,
        regressionStatus,
        sawToolCallDelta,
        sawRawToolCallLeak: sawRawLeak,
        sawTextDelta,
        sawFinish,
        sawDone,
        parserErrorCount,
        prematureTermination,
      },
    },
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** ReadableStreamReadResult alias for type clarity (TS lib may not export it). */
type ReadableStreamReadResult<T> = { done: boolean; value?: T };
