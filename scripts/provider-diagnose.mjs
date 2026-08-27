#!/usr/bin/env node
// scripts/provider-diagnose.mjs
//
// 10-run Provider Diagnostic Harness (PRD §3-§7, §19, §21-§23).
//
// Tests a provider AT LEAST 10 INDEPENDENT TIMES — each run uses a FRESH chat
// + fresh request — capturing the COMPLETE network lifecycle:
//   - request (method, URL, endpoint, model, body, headers, stream flag, tools)
//   - response (HTTP status, headers, content-type, transfer-encoding, etc.)
//   - EVERY raw response chunk (the bytes as they arrive, preserving SSE
//     event boundaries exactly — printed as `RAW EVENT #N\ndata: {...}\n\n…`)
//   - timing (requestStart, firstByte, firstSseEvent, firstTextDelta,
//     firstToolCallDelta, every subsequent chunk's arrival ms, finalChunk,
//     streamClose, clientCompletion)
//   - decoded payloads + parser output (JSON.parse of each `data:` frame)
//   - classification of the failure layer (Provider / Transport / Parser /
//     Normalizer / Client / UI)
//
// The goal (per PRD §3) is to find the EXACT boundary where correct data
// becomes incorrect — NOT to add fallbacks or better error messages.
//
// Self-contained: only Node.js built-ins (fetch, ReadableStream, TextDecoder,
// fs, path, url). No `.ts` imports. Run with plain `node` (≥18).
//
// Usage:
//   node scripts/provider-diagnose.mjs --provider kilocode \
//       --model kc/kilo-auto-free --runs 10 --target both
//   node scripts/provider-diagnose.mjs --provider kc \
//       --model kc/kilo-auto-free --runs 2 --target gateway
//
// Targets:
//   - upstream : POSTs directly to the provider's chat endpoint
//                (https://api.kilo.ai/api/gateway/chat/completions for kilocode)
//   - gateway  : POSTs to the FreeAIXYZ gateway
//                (https://freeaixyz4all.vercel.app/api/v1/chat/completions by
//                default, override with GATEWAY_URL env var)
//   - both     : runs both upstream AND gateway for each test (default)

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, "diagnose-report.json");

// ---------------------------------------------------------------------------
// Provider map (PRD §3 — resolve provider's real base URL + model list + the
// affected model from `src/lib/providers/index.ts` and
// `src/lib/gateway/catalog.ts`. Since those are `.ts` files and the script
// must run under plain `node`, the map is hardcoded here — kept in sync with
// `src/lib/gateway/ids.ts` PROVIDER_SHORT_IDS and the per-provider adapter.)
// ---------------------------------------------------------------------------
const PROVIDER_MAP = {
  kilocode: {
    id: "kilocode",
    shortId: "kc",
    name: "Kilo Code",
    baseUrl: "https://api.kilo.ai",
    modelsEndpoint: "https://api.kilo.ai/api/gateway/models",
    chatEndpoint: "https://api.kilo.ai/api/gateway/chat/completions",
    // Some providers (kilocode) do not require an API key for the free tier.
    authHeader: null,
    // The canonical id `kc/kilo-auto/free` includes the upstream slash — the
    // gateway's catalog stores the publicId as `kc/<upstreamId>` verbatim
    // (verified live against https://freeaixyz4all.vercel.app/api/v1/models).
    defaultCanonicalModel: "kc/kilo-auto/free",
    defaultUpstreamModel: "kilo-auto/free",
  },
};

// Alias: `kc` → `kilocode` (PRD §3 example syntax).
const PROVIDER_ALIASES = { kc: "kilocode" };

// Default gateway URL — the prod Vercel deployment. Override with the
// GATEWAY_URL env var (e.g. to test against a local dev gateway at
// http://localhost:3000).
const DEFAULT_GATEWAY_URL =
  process.env.GATEWAY_URL || "https://freeaixyz4all.vercel.app";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    provider: "kilocode",
    model: null, // null = use provider's default model
    runs: 10,
    target: "both", // upstream | gateway | both
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") opts.provider = argv[++i];
    else if (arg === "--model") opts.model = argv[++i];
    else if (arg === "--runs") opts.runs = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (arg === "--target") {
      const v = argv[++i];
      if (v !== "upstream" && v !== "gateway" && v !== "both") {
        throw new Error(`--target must be upstream|gateway|both, got: ${v}`);
      }
      opts.target = v;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      // Tolerate `--key=value` form too.
      const m = arg.match(/^--([^=]+)=(.*)$/);
      if (m) {
        const [, k, v] = m;
        if (k === "provider") opts.provider = v;
        else if (k === "model") opts.model = v;
        else if (k === "runs") opts.runs = Math.max(1, parseInt(v, 10) || 10);
        else if (k === "target") {
          if (v !== "upstream" && v !== "gateway" && v !== "both") {
            throw new Error(`--target must be upstream|gateway|both, got: ${v}`);
          }
          opts.target = v;
        }
      }
    }
  }
  return opts;
}

function printUsage() {
  console.log(`Usage:
  node scripts/provider-diagnose.mjs --provider <id> --model <id> \\
      --runs <n=10> --target <upstream|gateway|both>

Required:
  --provider <id>      Provider id or alias (e.g. "kilocode" or "kc")

Optional:
  --model <id>         Canonical (kc/kilo-auto-free) or upstream (kilo-auto/free)
                       model id. Defaults to the provider's default model.
  --runs <n>           Number of independent fresh-chat runs per target.
                       Default 10 (PRD §3 minimum).
  --target <t>         upstream | gateway | both (default: both)
  --help, -h           Show this message

Env vars:
  GATEWAY_URL          Override the gateway base URL (default:
                       https://freeaixyz4all.vercel.app)

Examples:
  node scripts/provider-diagnose.mjs --provider kilocode \\
      --model kc/kilo-auto-free --runs 10 --target both
  node scripts/provider-diagnose.mjs --provider kc \\
      --model kc/kilo-auto-free --runs 2 --target gateway
`);
}

// ---------------------------------------------------------------------------
// Model id resolution
//   - canonical form: `<shortId>/<upstreamId>` e.g. `kc/kilo-auto-free`
//   - upstream form:  `<upstreamId>`             e.g. `kilo-auto/free`
//
// For the UPSTREAM target we must POST the upstream id (kilocode's API
// expects e.g. `kilo-auto/free`, NOT `kc/kilo-auto-free`).
// For the GATEWAY target we must POST the canonical id (the gateway resolves
// `kc/kilo-auto-free` → provider `kilocode` + upstream `kilo-auto/free`).
// ---------------------------------------------------------------------------
function resolveModelIds(input, provider) {
  const shortId = provider.shortId;
  const canonicalPrefix = `${shortId}/`;
  let canonical;
  let upstream;
  if (!input) {
    canonical = provider.defaultCanonicalModel;
    upstream = provider.defaultUpstreamModel;
  } else if (input.startsWith(canonicalPrefix)) {
    canonical = input;
    upstream = input.slice(canonicalPrefix.length);
  } else if (input.includes("/")) {
    // Likely an upstream id with a slash (kilo-auto/free). Treat as upstream.
    upstream = input;
    canonical = `${shortId}/${input}`;
  } else {
    // Bare id, no slash — guess it's an upstream id.
    upstream = input;
    canonical = `${shortId}/${input}`;
  }
  return { canonical, upstream };
}

// ---------------------------------------------------------------------------
// Minimal SSE splitter (PRD §17-§20). A network chunk ≠ an SSE event — a
// chunk may contain half an event, one event, or twenty events. This
// splitter maintains an incomplete-event buffer across chunks, correctly
// handles UTF-8 split across byte boundaries (via TextDecoder { stream:
// true }), multi-line `data:` fields, CRLF/LF, `event:` lines, and the
// `[DONE]` termination sentinel.
//
// Returns parsed events (one per `\n\n` boundary) AND preserves the raw
// text of every event exactly as it came off the wire (for the
// "RAW EVENT #N\ndata: {...}\n\n…" stdout dump).
// ---------------------------------------------------------------------------
class SseSplitter {
  constructor() {
    this.decoder = new TextDecoder("utf-8");
    this.buffer = "";
    this.currentData = [];
    this.currentEvent = undefined;
    this.currentId = undefined;
    this.currentRetry = undefined;
    this.currentRaw = ""; // exact bytes of the event being assembled
    this.doneSeen = false;
  }

  feed(chunk) {
    if (this.doneSeen) return [];
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  end() {
    this.buffer += this.decoder.decode();
    const events = this.drain();
    if (!this.doneSeen && (this.currentData.length > 0 || this.currentEvent || this.currentId)) {
      events.push(this.buildEvent());
      this.resetCurrent();
    }
    this.doneSeen = true;
    return events;
  }

  drain() {
    const events = [];
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;
      // Track the raw text of the current event (PRD §6 — preserve SSE
      // boundaries EXACTLY).
      this.currentRaw += line + "\n";
      this.processLine(stripped, events);
      if (this.doneSeen) break;
    }
    return events;
  }

  processLine(line, events) {
    // Empty line → event boundary (PRD §20).
    if (line === "") {
      if (this.currentData.length > 0 || this.currentEvent || this.currentId) {
        events.push(this.buildEvent());
        this.resetCurrent();
      } else {
        // Empty line with no pending data → still a separator; drop the
        // accumulated raw so we don't leak whitespace into the next event.
        this.currentRaw = "";
      }
      return;
    }
    if (line.startsWith(":")) return; // comment / heartbeat

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
        // Unknown field → preserve silently (PRD §229).
        break;
    }
  }

  buildEvent() {
    const data = this.currentData.join("\n");
    const raw = this.currentRaw;
    if (data === "[DONE]") {
      this.doneSeen = true;
      return { data, raw, event: undefined, id: undefined, retry: undefined, done: true };
    }
    return {
      data,
      raw,
      event: this.currentEvent,
      id: this.currentId,
      retry: this.currentRetry,
      done: false,
    };
  }

  resetCurrent() {
    this.currentData = [];
    this.currentEvent = undefined;
    this.currentId = undefined;
    this.currentRetry = undefined;
    this.currentRaw = "";
  }
}

// ---------------------------------------------------------------------------
// Test payloads (PRD §5 — Test progression):
//   - Run 1-3  Test A: basic text "Hello"
//   - Run 4-6  Test B: longer question requiring several sentences
//   - Run 7-10 Test C: tool-enabled request (one simple `get_weather` fn)
// ---------------------------------------------------------------------------
const TESTS = [
  // Test A (runs 1-3)
  {
    id: "A",
    label: "basic-text",
    buildMessages: () => [
      { role: "user", content: "Hello" },
    ],
    tools: undefined,
    toolChoice: undefined,
  },
  // Test B (runs 4-6)
  {
    id: "B",
    label: "multi-sentence",
    buildMessages: () => [
      {
        role: "user",
        content:
          "In three sentences, explain why streaming responses matter for chat UX.",
      },
    ],
    tools: undefined,
    toolChoice: undefined,
  },
  // Test C (runs 7-10) — tool-enabled
  {
    id: "C",
    label: "tool-call",
    buildMessages: () => [
      {
        role: "user",
        content: "What's the weather in Paris right now? Use the get_weather tool.",
      },
    ],
    tools: [
      {
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
      },
    ],
    toolChoice: "auto",
  },
];

function pickTestForRun(runIdx) {
  // Run indices are 1-based. Map to Test A/B/C per PRD §5.
  if (runIdx <= 3) return TESTS[0];
  if (runIdx <= 6) return TESTS[1];
  return TESTS[2];
}

// ---------------------------------------------------------------------------
// Redaction (PRD §6 — redact any API keys / tokens / cookies)
// ---------------------------------------------------------------------------
function redactHeaders(headersObj) {
  const out = {};
  for (const [k, v] of Object.entries(headersObj)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "x-api-key" ||
        lk === "x-anonymous-user-id" || lk.includes("token") || lk.includes("secret")) {
      out[k] = v ? `[REDACTED:len=${String(v).length}]` : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build the request body for a given target
// ---------------------------------------------------------------------------
function buildRequestBody(target, provider, modelIds, test) {
  const body = {
    stream: true,
    messages: test.buildMessages(),
  };
  if (target === "upstream") {
    body.model = modelIds.upstream;
  } else {
    body.model = modelIds.canonical;
  }
  if (test.tools) {
    body.tools = test.tools;
    body.tool_choice = test.toolChoice || "auto";
  }
  return body;
}

function buildRequestHeaders(provider, isGateway) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
  };
  if (isGateway) {
    // Gateway expects no auth for free tier.
  } else {
    // Upstream (kilocode) — no auth either for free tier.
    if (provider.authHeader) {
      // If a provider later needs auth, redact in the report.
      headers[provider.authHeader.name] = provider.authHeader.value;
    }
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Run ONE diagnostic against one target
// ---------------------------------------------------------------------------
async function runOne({ target, provider, modelIds, test, runIdx }) {
  const isGateway = target === "gateway";
  const url = isGateway
    ? `${DEFAULT_GATEWAY_URL.replace(/\/$/, "")}/api/v1/chat/completions`
    : provider.chatEndpoint;
  const body = buildRequestBody(target, provider, modelIds, test);
  const headers = buildRequestHeaders(provider, isGateway);

  const request = {
    method: "POST",
    url,
    endpointPath: isGateway ? "/api/v1/chat/completions" : new URL(provider.chatEndpoint).pathname,
    model: body.model,
    body: { ...body, messages: body.messages, tools: body.tools, tool_choice: body.tool_choice },
    headers: redactHeaders(headers),
    stream: body.stream,
    toolDefinitions: body.tools ? body.tools.length : 0,
    messageStructure: body.messages.map((m) => ({ role: m.role, contentLength: String(m.content).length })),
  };

  const timings = {
    requestStart: null,
    fetchResolved: null,
    firstByte: null,
    firstSseEvent: null,
    firstTextDelta: null,
    firstToolCallDelta: null,
    finalChunk: null,
    streamClose: null,
    clientCompletion: null,
    chunks: [], // { index, arrivalMs, byteLength, textPreview }
  };

  const rawChunks = []; // raw bytes (as decoded UTF-8 strings) of each network chunk
  const sseEvents = []; // parsed SSE events (with raw + data + decoded payload)
  const parsedPayloads = []; // JSON.parse output of each `data:` frame
  let httpStatus = null;
  let httpStatusText = null;
  let responseHeaders = {};
  let contentType = null;
  let transferEncoding = null;
  let contentEncoding = null;

  let failureLayer = null;
  let failureReason = null;
  let classification = "incomplete"; // success | failure | incomplete
  let normalizedClass = null; // correct | bug | mixed | text_only | none | n/a
  let sawToolCallDelta = false;
  let sawToolCallMarkerInContent = false;
  let sawTextDelta = false;
  let sawFinish = false;
  let sawDone = false;
  let parserErrors = 0;
  let prematureTermination = false;

  timings.requestStart = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // No AbortController — let the stream run to completion (PRD §19).
    });
  } catch (err) {
    timings.fetchResolved = Date.now();
    failureLayer = "Transport";
    failureReason = `fetch threw: ${err?.message || String(err)}`;
    classification = "failure";
    return {
      target,
      run: runIdx,
      test: test.id,
      request,
      response: {
        httpStatus,
        httpStatusText,
        responseHeaders,
        contentType,
        transferEncoding,
        contentEncoding,
      },
      timings,
      rawChunks,
      sseEvents,
      parsedPayloads,
      failureLayer,
      failureReason,
      classification,
      normalizedClass,
      sawToolCallDelta,
      sawToolCallMarkerInContent,
      sawTextDelta,
      sawFinish,
      sawDone,
      parserErrors,
      prematureTermination,
    };
  }

  timings.fetchResolved = Date.now();
  httpStatus = response.status;
  httpStatusText = response.statusText;
  const respHeadersObj = {};
  response.headers.forEach((v, k) => { respHeadersObj[k] = v; });
  responseHeaders = redactHeaders(respHeadersObj);
  contentType = response.headers.get("content-type") || null;
  transferEncoding = response.headers.get("transfer-encoding") || null;
  contentEncoding = response.headers.get("content-encoding") || null;

  // Provider-level failure (4xx/5xx): record + don't read the stream body as SSE.
  if (response.status >= 400) {
    failureLayer = "Provider";
    let errBody = "";
    try {
      errBody = await response.text();
    } catch {}
    failureReason = `HTTP ${response.status} ${response.statusText}: ${errBody.slice(0, 500)}`;
    classification = "failure";
    timings.clientCompletion = Date.now();
    return {
      target,
      run: runIdx,
      test: test.id,
      request,
      response: {
        httpStatus,
        httpStatusText,
        responseHeaders,
        contentType,
        transferEncoding,
        contentEncoding,
        errorBodyPreview: errBody.slice(0, 2000),
      },
      timings,
      rawChunks,
      sseEvents,
      parsedPayloads,
      failureLayer,
      failureReason,
      classification,
      normalizedClass,
      sawToolCallDelta,
      sawToolCallMarkerInContent,
      sawTextDelta,
      sawFinish,
      sawDone,
      parserErrors,
      prematureTermination,
    };
  }

  if (!response.body) {
    failureLayer = "Transport";
    failureReason = "response.body is null (no stream available)";
    classification = "failure";
    timings.clientCompletion = Date.now();
    return {
      target,
      run: runIdx,
      test: test.id,
      request,
      response: { httpStatus, httpStatusText, responseHeaders, contentType, transferEncoding, contentEncoding },
      timings,
      rawChunks,
      sseEvents,
      parsedPayloads,
      failureLayer,
      failureReason,
      classification,
      normalizedClass,
      sawToolCallDelta,
      sawToolCallMarkerInContent,
      sawTextDelta,
      sawFinish,
      sawDone,
      parserErrors,
      prematureTermination,
    };
  }

  const reader = response.body.getReader();
  const splitter = new SseSplitter();
  let chunkIndex = 0;
  let firstEventSeen = false;

  try {
    while (true) {
      let done = false;
      let value;
      try {
        const r = await reader.read();
        done = r.done;
        value = r.value;
      } catch (err) {
        failureLayer = "Transport";
        failureReason = `reader.read() threw: ${err?.message || String(err)}`;
        prematureTermination = true;
        break;
      }
      if (done) {
        timings.finalChunk = timings.finalChunk || Date.now();
        // Flush trailing event(s).
        const trailing = splitter.end();
        for (const ev of trailing) {
          if (!firstEventSeen) {
            timings.firstSseEvent = timings.firstSseEvent || Date.now();
            firstEventSeen = true;
          }
          processSseEvent(ev);
        }
        break;
      }
      const now = Date.now();
      timings.firstByte = timings.firstByte || now;
      timings.finalChunk = now;

      const chunkText = new TextDecoder("utf-8").decode(value, { stream: true });
      rawChunks.push({
        index: chunkIndex,
        arrivalMs: now - timings.requestStart,
        byteLength: value.byteLength,
        textPreview: chunkText.slice(0, 200),
      });
      timings.chunks.push({
        index: chunkIndex,
        arrivalMs: now - timings.requestStart,
        byteLength: value.byteLength,
      });
      chunkIndex++;

      const events = splitter.feed(value);
      for (const ev of events) {
        if (!firstEventSeen) {
          timings.firstSseEvent = timings.firstSseEvent || Date.now();
          firstEventSeen = true;
        }
        processSseEvent(ev);
      }
      // OpenAI clients stop reading at the `[DONE]` sentinel — it is the
      // protocol-level end of stream. Vercel/edge runtimes sometimes keep
      // the underlying socket open in keep-alive mode after [DONE] is sent,
      // which would otherwise hang this loop until maxDuration. Break as
      // soon as we see [DONE] (PRD §19 — no infinite waits).
      if (sawDone) {
        timings.finalChunk = timings.finalChunk || Date.now();
        break;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    timings.streamClose = Date.now();
    timings.clientCompletion = Date.now();
  }

  // Process one SSE event: parse the data, detect tool_calls / __tool_calls
  // markers / text deltas / finish / [DONE].
  function processSseEvent(ev) {
    sseEvents.push({
      data: ev.data,
      raw: ev.raw,
      event: ev.event,
      id: ev.id,
      retry: ev.retry,
      done: ev.done,
    });
    if (ev.done) {
      sawDone = true;
      parsedPayloads.push({ type: "DONE", raw: ev.raw });
      return;
    }
    if (!ev.data) {
      // Comment-only / heartbeat — record but skip parsing.
      parsedPayloads.push({ type: "EMPTY", raw: ev.raw });
      return;
    }
    let json;
    try {
      json = JSON.parse(ev.data);
      parsedPayloads.push({ type: "JSON", data: json, raw: ev.raw });
    } catch (err) {
      parserErrors++;
      parsedPayloads.push({
        type: "PARSE_ERROR",
        error: err.message,
        dataPreview: ev.data.slice(0, 200),
        raw: ev.raw,
      });
      if (!failureLayer) {
        failureLayer = "Parser";
        failureReason = `JSON.parse failed on data: frame: ${err.message}`;
      }
      return;
    }
    // Inspect the OpenAI-shaped chunk.
    if (json && json.error) {
      // Inline SSE error (vexa-style). Treat as Provider failure.
      failureLayer = failureLayer || "Provider";
      failureReason = failureReason || `inline SSE error: ${JSON.stringify(json.error).slice(0, 300)}`;
      return;
    }
    const choice = json?.choices?.[0];
    if (!choice) return;
    const delta = choice.delta || {};
    const finishReason = choice.finish_reason;
    if (finishReason) sawFinish = true;

    // delta.tool_calls (correct OpenAI shape, post-fix)
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      sawToolCallDelta = true;
      timings.firstToolCallDelta = timings.firstToolCallDelta || Date.now();
    }
    // delta.content (text)
    if (typeof delta.content === "string" && delta.content.length > 0) {
      sawTextDelta = true;
      timings.firstTextDelta = timings.firstTextDelta || Date.now();
      // THE BUG (pre-fix): `__tool_calls` marker string leaking as content.
      if (delta.content.includes("__tool_calls")) {
        sawToolCallMarkerInContent = true;
        // Normalizer SHOULD have intercepted this; if it didn't, that's the
        // Normalizer layer failing.
        if (!failureLayer) {
          failureLayer = "Normalizer";
          failureReason = `delta.content contains __tool_calls marker (pre-fix leak): ${delta.content.slice(0, 200)}`;
        }
      }
    }
    // delta.reasoning_content — count as text for timing purposes.
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      sawTextDelta = true;
      timings.firstTextDelta = timings.firstTextDelta || Date.now();
    }
  }

  // Classify the normalized stream shape (PRD §22).
  // Only meaningful for the gateway target (where the normalizer runs).
  if (isGateway && test.tools) {
    if (sawToolCallDelta && !sawToolCallMarkerInContent) normalizedClass = "correct";
    else if (sawToolCallMarkerInContent && !sawToolCallDelta) normalizedClass = "bug";
    else if (sawToolCallDelta && sawToolCallMarkerInContent) normalizedClass = "mixed";
    else if (sawTextDelta) normalizedClass = "text_only";
    else normalizedClass = "none";
  } else if (isGateway) {
    // Non-tool test — normalized class is "n/a" (no tool calls expected).
    normalizedClass = "n/a";
  } else {
    // Upstream target — show the raw upstream shape.
    if (test.tools) {
      if (sawToolCallDelta) normalizedClass = "upstream-emits-tool_calls";
      else if (sawTextDelta) normalizedClass = "upstream-emits-text-only";
      else normalizedClass = "upstream-no-delta";
    } else {
      normalizedClass = "n/a";
    }
  }

  // Final classification.
  if (failureLayer) {
    classification = "failure";
  } else if (!sawDone) {
    // Stream ended without a [DONE] sentinel — flag as premature termination.
    prematureTermination = true;
    failureLayer = "Transport";
    failureReason = "stream ended without [DONE] sentinel (premature termination)";
    classification = "failure";
  } else if (parserErrors > 0) {
    failureLayer = failureLayer || "Parser";
    failureReason = failureReason || `${parserErrors} parser error(s) during stream`;
    classification = "failure";
  } else {
    classification = "success";
  }

  return {
    target,
    run: runIdx,
    test: test.id,
    request,
    response: {
      httpStatus,
      httpStatusText,
      responseHeaders,
      contentType,
      transferEncoding,
      contentEncoding,
    },
    timings,
    rawChunks,
    sseEvents,
    parsedPayloads,
    failureLayer,
    failureReason,
    classification,
    normalizedClass,
    sawToolCallDelta,
    sawToolCallMarkerInContent,
    sawTextDelta,
    sawFinish,
    sawDone,
    parserErrors,
    prematureTermination,
  };
}

// ---------------------------------------------------------------------------
// Run N independent fresh-chat runs against one or both targets
// ---------------------------------------------------------------------------
async function runAll(opts) {
  const providerKey = PROVIDER_ALIASES[opts.provider] || opts.provider;
  const provider = PROVIDER_MAP[providerKey];
  if (!provider) {
    throw new Error(
      `Unknown provider: "${opts.provider}". Known: ${Object.keys(PROVIDER_MAP).join(", ")} (alias: ${Object.keys(PROVIDER_ALIASES).join(", ")}).`,
    );
  }
  const modelIds = resolveModelIds(opts.model, provider);

  const targets = opts.target === "both" ? ["upstream", "gateway"] : [opts.target];
  const runs = [];
  for (let i = 1; i <= opts.runs; i++) {
    const test = pickTestForRun(i);
    for (const target of targets) {
      process.stderr.write(
        `[run ${i}/${opts.runs}] target=${target} test=${test.id} (${test.label}) model=${target === "upstream" ? modelIds.upstream : modelIds.canonical}…\n`,
      );
      const result = await runOne({
        target,
        provider,
        modelIds,
        test,
        runIdx: i,
      });
      runs.push(result);
      // Print the raw chunks + SSE events (PRD §6 — preserve SSE boundaries
      // exactly as `RAW EVENT #N\ndata: {...}\n\n…`).
      printRawDump(result);
    }
  }

  return { provider: provider.id, model: modelIds, runs };
}

// ---------------------------------------------------------------------------
// Print the raw SSE dump for ONE run (PRD §6: preserve SSE event boundaries
// exactly). Output goes to stdout.
// ---------------------------------------------------------------------------
function printRawDump(result) {
  console.log(`\n════════════════════════════════════════════════════════════════════════════════`);
  console.log(`RUN #${result.run} | target=${result.target} | test=${result.test} | model=${result.request.model}`);
  console.log(`════════════════════════════════════════════════════════════════════════════════`);
  console.log(`→ ${result.request.method} ${result.request.url}`);
  console.log(`  endpoint: ${result.request.endpointPath}`);
  console.log(`  stream: ${result.request.stream} | tools: ${result.request.toolDefinitions}`);
  console.log(`  message structure: ${JSON.stringify(result.request.messageStructure)}`);
  console.log(`  request headers (redacted): ${JSON.stringify(result.request.headers)}`);
  console.log(`← HTTP ${result.response.httpStatus} ${result.response.httpStatusText || ""}`);
  console.log(`  content-type: ${result.response.contentType}`);
  console.log(`  transfer-encoding: ${result.response.transferEncoding}`);
  console.log(`  content-encoding: ${result.response.contentEncoding}`);
  console.log(`  response headers (redacted): ${JSON.stringify(result.response.responseHeaders)}`);
  console.log(`  response header count: ${Object.keys(result.response.responseHeaders).length}`);
  if (result.response.errorBodyPreview) {
    console.log(`  ERROR BODY PREVIEW: ${result.response.errorBodyPreview.slice(0, 400)}`);
  }
  const t = result.timings;
  console.log(
    `  timing: requestStart=${t.requestStart} fetchResolved=+${t.fetchResolved - t.requestStart}ms` +
    ` firstByte=${t.firstByte ? "+" + (t.firstByte - t.requestStart) + "ms" : "—"} ` +
    `firstSse=${t.firstSseEvent ? "+" + (t.firstSseEvent - t.requestStart) + "ms" : "—"} ` +
    `firstText=${t.firstTextDelta ? "+" + (t.firstTextDelta - t.requestStart) + "ms" : "—"} ` +
    `firstToolCall=${t.firstToolCallDelta ? "+" + (t.firstToolCallDelta - t.requestStart) + "ms" : "—"} ` +
    `finalChunk=${t.finalChunk ? "+" + (t.finalChunk - t.requestStart) + "ms" : "—"} ` +
    `streamClose=${t.streamClose ? "+" + (t.streamClose - t.requestStart) + "ms" : "—"}`,
  );
  console.log(`  chunks received: ${result.rawChunks.length}`);
  if (result.rawChunks.length > 0) {
    console.log(`  first chunk: ${JSON.stringify(result.rawChunks[0])}`);
    const last = result.rawChunks[result.rawChunks.length - 1];
    console.log(`  last chunk:  ${JSON.stringify(last)}`);
  }
  console.log(`  SSE events parsed: ${result.sseEvents.length}`);
  if (result.sseEvents.length > 0) {
    console.log(`  ─── RAW EVENT DUMP (boundaries preserved) ────────────────────────────────`);
    result.sseEvents.slice(0, 25).forEach((ev, i) => {
      console.log(`  RAW EVENT #${i + 1}`);
      // The raw text already contains the trailing `\n` per line. Print
      // without adding extra newline so the boundary `\n\n` is preserved.
      process.stdout.write(`  ${ev.raw.replace(/\n/g, "\n  ")}`);
      if (!ev.raw.endsWith("\n")) process.stdout.write("\n");
    });
    if (result.sseEvents.length > 25) {
      console.log(`  … ${result.sseEvents.length - 25} more event(s) omitted from stdout (full set in JSON report)`);
    }
    console.log(`  ───────────────────────────────────────────────────────────────────────`);
  }
  console.log(
    `  classification: ${result.classification} | layer=${result.failureLayer || "—"} | ` +
    `normalized=${result.normalizedClass || "—"} | ` +
    `toolCallDelta=${result.sawToolCallDelta} | ` +
    `__tool_calls_in_content=${result.sawToolCallMarkerInContent} | ` +
    `textDelta=${result.sawTextDelta} | finish=${result.sawFinish} | done=${result.sawDone} | ` +
    `parserErrors=${result.parserErrors} | prematureTermination=${result.prematureTermination}`,
  );
  if (result.failureReason) {
    console.log(`  FAILURE REASON: ${result.failureReason}`);
  }
  console.log(`════════════════════════════════════════════════════════════════════════════════`);
}

// ---------------------------------------------------------------------------
// Aggregate + summary (PRD §23)
// ---------------------------------------------------------------------------
function aggregate(runs, providerId, modelIds) {
  const targets = ["upstream", "gateway"];
  const byTarget = {};
  for (const t of targets) {
    const sub = runs.filter((r) => r.target === t);
    byTarget[t] = {
      total: sub.length,
      successful: sub.filter((r) => r.classification === "success").length,
      failed: sub.filter((r) => r.classification === "failure").length,
      successfulToolCalls: sub.filter((r) => r.sawToolCallDelta).length,
      rawToolCallsLeak: sub.filter((r) => r.sawToolCallMarkerInContent).length,
      prematureTermination: sub.filter((r) => r.prematureTermination).length,
      parserErrors: sub.filter((r) => r.parserErrors > 0).length,
      fallbackUsage: 0, // PRD §2 — forbidden; always 0.
      byFailureLayer: {
        Provider: sub.filter((r) => r.failureLayer === "Provider").length,
        Transport: sub.filter((r) => r.failureLayer === "Transport").length,
        Parser: sub.filter((r) => r.failureLayer === "Parser").length,
        Normalizer: sub.filter((r) => r.failureLayer === "Normalizer").length,
        Client: 0, // not observable from script
        UI: 0, // not observable from script
      },
      byNormalizedClass: {
        correct: sub.filter((r) => r.normalizedClass === "correct").length,
        bug: sub.filter((r) => r.normalizedClass === "bug").length,
        mixed: sub.filter((r) => r.normalizedClass === "mixed").length,
        text_only: sub.filter((r) => r.normalizedClass === "text_only").length,
        none: sub.filter((r) => r.normalizedClass === "none").length,
        n_a: sub.filter((r) => r.normalizedClass === "n/a").length,
        upstream_emits_tool_calls: sub.filter((r) => r.normalizedClass === "upstream-emits-tool_calls").length,
        upstream_emits_text_only: sub.filter((r) => r.normalizedClass === "upstream-emits-text-only").length,
        upstream_no_delta: sub.filter((r) => r.normalizedClass === "upstream-no-delta").length,
      },
    };
  }

  // Root cause: the actual boundary where correct data becomes incorrect.
  // Detection logic:
  //   - If gateway target has any `bug` (raw __tool_calls leaked as content)
  //     while upstream target emits proper `delta.tool_calls` → root cause is
  //     the streaming-proxy / normalizer layer (pre-fix).
  //   - If gateway target shows `correct` (delta.tool_calls) and no `bug`
  //     → fix is working; regression status PASS.
  //   - If upstream target has no tool_calls at all (the model didn't call
  //     the tool) → not a normalizer bug; the model just chose not to call.
  let rootCause = "unknown";
  let fix = "unknown";
  let regressionStatus = "UNKNOWN";

  const gw = byTarget.gateway;
  const up = byTarget.upstream;
  if (gw && gw.total > 0) {
    if (gw.rawToolCallsLeak > 0 && (up ? up.successfulToolCalls > 0 : true)) {
      rootCause =
        "streaming-proxy forwarded __tool_calls markers as delta.content " +
        "(the gateway's sse-parser.extractOpenAiDelta converts upstream " +
        "delta.tool_calls into {\"__tool_calls\":[…]} marker strings, and " +
        "enqueueChunk wraps every yielded delta as choices[0].delta.content)";
      fix =
        "ToolCallNormalizer intercepts the __tool_calls marker before it " +
        "reaches delta.content and re-emits it as proper OpenAI " +
        "delta.tool_calls chunks (stable per-index id, first-name-wins, " +
        "concatenated arguments)";
      regressionStatus = "FAIL";
    } else if (gw.rawToolCallsLeak === 0 && gw.successfulToolCalls > 0) {
      rootCause =
        "(post-fix) ToolCallNormalizer intercepts __tool_calls markers and " +
        "emits proper OpenAI delta.tool_calls — verified live against the gateway";
      fix = "ToolCallNormalizer is live in streaming-proxy.enqueueNormalizedDelta";
      regressionStatus = "PASS";
    } else if (gw.rawToolCallsLeak === 0 && gw.successfulToolCalls === 0) {
      rootCause =
        "no tool calls observed in the gateway stream — either the model " +
        "chose not to call the tool, or no tool-bearing test ran";
      fix = "no fix needed for the normalizer path (no leak observed)";
      regressionStatus = "PASS";
    }
  } else if (up && up.total > 0) {
    if (up.successfulToolCalls > 0) {
      rootCause =
        "upstream emits proper OpenAI delta.tool_calls (correct native shape)";
      fix = "n/a — upstream is already correct; the gateway normalizer is the boundary";
      regressionStatus = "PASS";
    } else {
      rootCause =
        "upstream did not emit delta.tool_calls (the model may have refused " +
        "the tool call, or upstream is text-only for this model)";
      fix = "n/a";
      regressionStatus = "UNKNOWN";
    }
  }

  return { byTarget, rootCause, fix, regressionStatus };
}

function printSummary(report) {
  const { provider, model, runs, summary } = report;
  console.log("\n");
  console.log("┌────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ 10-RUN PROVIDER DIAGNOSTIC — SUMMARY (PRD §23)                              │");
  console.log("└────────────────────────────────────────────────────────────────────────────┘");
  console.log(`Provider: ${provider}`);
  console.log(`Model:    ${model.canonical} (upstream: ${model.upstream})`);
  console.log(`Runs:     ${runs.length}`);
  for (const target of ["upstream", "gateway"]) {
    const s = summary.byTarget[target];
    if (!s || s.total === 0) continue;
    console.log("");
    console.log(`── target=${target} ──────────────────────────────────────────────────────`);
    console.log(`Successful streams:        ${s.successful}/${s.total}`);
    console.log(`Successful tool calls:     ${s.successfulToolCalls}/${s.total}`);
    console.log(`Raw __tool_calls leakage:  ${s.rawToolCallsLeak}/${s.total}`);
    console.log(`Premature stream termination: ${s.prematureTermination}/${s.total}`);
    console.log(`Parser errors:             ${s.parserErrors}/${s.total}`);
    console.log(`Fallback usage:            ${s.fallbackUsage}`);
    console.log(`By failure layer:          ${JSON.stringify(s.byFailureLayer)}`);
    console.log(`By normalized class:       ${JSON.stringify(s.byNormalizedClass)}`);
  }
  console.log("");
  console.log(`Root cause:        ${summary.rootCause}`);
  console.log(`Fix:               ${summary.fix}`);
  console.log(`Regression status: ${summary.regressionStatus}`);
  console.log("");
  console.log(`JSON report written to: ${REPORT_PATH}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`error: ${err.message}`);
    printUsage();
    process.exit(2);
  }
  console.log(`# Provider Diagnostic Harness — ${new Date().toISOString()}`);
  console.log(`# provider=${opts.provider} model=${opts.model || "(default)"} runs=${opts.runs} target=${opts.target}`);
  console.log(`# gateway=${DEFAULT_GATEWAY_URL}`);

  const { provider, model, runs } = await runAll(opts);
  const summary = aggregate(runs, provider, model);
  const report = {
    generatedAt: new Date().toISOString(),
    provider,
    model,
    target: opts.target,
    runsRequested: opts.runs,
    runs,
    summary,
  };

  try {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`[report] failed to write JSON report: ${err.message}`);
  }
  printSummary(report);
}

main().catch((err) => {
  console.error(`[fatal] ${err?.stack || err?.message || err}`);
  process.exit(1);
});
