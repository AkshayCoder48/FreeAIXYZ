/**
 * Tool-Call Normalizer regression tests (PRD §20).
 *
 * These prove the streaming ToolCallNormalizer (the root-cause fix for the
 * raw `{"__tool_calls":[...]}` leak) correctly:
 *
 *  §20.1  Normal text stream            → passes through as content
 *  §20.2  Tool name + argument fragments → accumulate into one tool call
 *  §20.3  Empty name deltas             → do NOT erase the tool name
 *  §20.4  Partial JSON arguments        → accumulated, not prematurely parsed
 *  §20.5  Multiple tool calls           → independent per-index state
 *  §20.6  Mixed text/tool stream       → tool data never leaks into content
 *  §20.7  `__tool_calls` normalization  → never appears as assistant content
 *
 * Plus an INTEGRATION test (§20.8) that drives the full `streamChat` path
 * with a fake provider emitting the exact fragment sequence the user reported:
 *
 *   {"__tool_calls":[{"name":"ls","arguments":""}]}
 *   {"__tool_calls":[{"name":"","arguments":"{"}]}
 *   {"__tool_calls":[{"name":"","arguments":"\"path\": \"."}]}
 *   {"__tool_calls":[{"name":"","arguments":"\"}"}]}
 *
 * Expected: the SSE the client receives contains proper `delta.tool_calls`
 * chunks (with stable per-index id, incremental argument fragments) and
 * `finish_reason:"tool_calls"` — and the raw `__tool_calls` JSON NEVER
 * appears inside any `delta.content`.
 */

import assert from "node:assert/strict";
import { ToolCallNormalizer } from "../src/lib/gateway/tool-call-normalizer.ts";
import { streamChat } from "../src/lib/gateway/streaming-proxy.ts";
import { SseParser, extractOpenAiDelta } from "../src/lib/gateway/sse-parser.ts";

/** Build a fake provider that yields an arbitrary list of delta strings. */
function createFakeMarkerProvider(deltas) {
  return {
    id: "fakemarker",
    shortId: "fm",
    name: "FakeMarker",
    discoveryMode: "dynamic",
    async complete() {
      return { text: deltas.join("") };
    },
    async *stream() {
      for (const d of deltas) yield d;
    },
    async discoverModels() {
      return [];
    },
    async healthCheck() {
      return { status: "healthy", providerId: "fakemarker", lastChecked: new Date().toISOString(), latencyMs: 0 };
    },
  };
}

/** Read a streamChat Response fully into parsed SSE events. */
async function readStream(response) {
  const reader = response.body.getReader();
  const parser = new SseParser();
  const events = [];
  let sawDone = false;
  while (!sawDone) {
    const read = await Promise.race([
      reader.read(),
      new Promise((r) => setTimeout(() => r({ __timeout: true }), 5000)),
    ]);
    if (read.__timeout) break;
    if (read.done) break;
    for (const ev of parser.feed(read.value)) {
      events.push(ev);
      if (ev.done) { sawDone = true; break; }
    }
  }
  for (const ev of parser.end()) {
    events.push(ev);
    if (ev.done) sawDone = true;
  }
  try { await reader.cancel(); } catch { /* best-effort */ }
  return events;
}

export async function run() {
  // ─── §20.1 Normal text stream ───────────────────────────────────────
  {
    const n = new ToolCallNormalizer();
    const a = n.consume("Hello ");
    const b = n.consume("world!");
    assert.equal(a.content, "Hello ", "§20.1 first text delta → content");
    assert.equal(b.content, "world!", "§20.1 second text delta → content");
    assert.equal(a.toolCalls, undefined, "§20.1 no toolCalls on text");
    assert.equal(n.didEmitToolCalls, false, "§20.1 didEmitToolCalls=false");
  }

  // ─── §20.2 Tool name + argument fragments (the user's exact sequence) ─
  // The source markers are JSON strings; we JSON.parse each to derive the
  // EXPECTED decoded argument fragment so escaping is unambiguous.
  {
    const m1 = '{"__tool_calls":[{"name":"ls","arguments":""}]}';
    const m2 = '{"__tool_calls":[{"name":"","arguments":"{"}]}';
    const m3 = '{"__tool_calls":[{"name":"","arguments":"\\"path\\": \\"."}]}';
    const m4 = '{"__tool_calls":[{"name":"","arguments":"\\"}"}]}';
    const exp = (m) => JSON.parse(m).__tool_calls[0].arguments;

    const n = new ToolCallNormalizer();
    const d1 = n.consume(m1);
    const d2 = n.consume(m2);
    const d3 = n.consume(m3);
    const d4 = n.consume(m4);

    // d1 must introduce id + name + (empty) arguments fragment
    assert.ok(d1.toolCalls && d1.toolCalls.length === 1, "§20.2 d1 → 1 toolCall");
    assert.equal(d1.toolCalls[0].index, 0, "§20.2 d1 index=0");
    assert.ok(d1.toolCalls[0].id, "§20.2 d1 emits stable id");
    assert.equal(d1.toolCalls[0].function.name, "ls", "§20.2 d1 name=ls");
    assert.equal(d1.toolCalls[0].function.arguments, exp(m1), "§20.2 d1 arguments fragment matches decoded marker");

    // d2 must NOT re-emit id (stable) and must NOT re-emit name (empty frag)
    assert.ok(d2.toolCalls && d2.toolCalls.length === 1, "§20.2 d2 → 1 toolCall");
    assert.equal(d2.toolCalls[0].id, undefined, "§20.2 d2 does NOT re-emit id");
    assert.equal(d2.toolCalls[0].function.name, undefined, "§20.2 d2 does NOT re-emit name");
    assert.equal(d2.toolCalls[0].function.arguments, exp(m2), "§20.2 d2 arguments fragment matches decoded marker");

    // d3, d4 carry further argument fragments
    assert.equal(d3.toolCalls[0].function.arguments, exp(m3), "§20.2 d3 arguments fragment matches decoded marker");
    assert.equal(d4.toolCalls[0].function.arguments, exp(m4), "§20.2 d4 arguments fragment matches decoded marker");

    // Accumulated buffer must reconstruct the full JSON object.
    const snap = n.snapshot();
    assert.equal(snap.length, 1, "§20.2 one accumulator");
    assert.equal(snap[0].name, "ls", "§20.2 accumulated name=ls");
    assert.equal(
      snap[0].argBuffer,
      '{"path": "."}',
      `§20.2 accumulated arguments buffer must be {"path": "."} — got ${JSON.stringify(snap[0].argBuffer)}`,
    );
    assert.ok(n.didEmitToolCalls, "§20.2 didEmitToolCalls=true");
  }

  // ─── §20.3 Empty name deltas do not erase the name ──────────────────
  {
    const n = new ToolCallNormalizer();
    n.consume('{"__tool_calls":[{"name":"get_weather","arguments":""}]}');
    n.consume('{"__tool_calls":[{"name":"","arguments":"{"}]}');
    n.consume('{"__tool_calls":[{"name":"","arguments":"}"}]}');
    const snap = n.snapshot();
    assert.equal(snap[0].name, "get_weather", "§20.3 empty-name deltas do NOT erase name");
    assert.equal(snap[0].argBuffer, "{}", "§20.3 arguments accumulated");
  }

  // ─── §20.4 Partial JSON is accumulated, not prematurely parsed ─────
  // The normalizer must NEVER JSON.parse the accumulated argument buffer
  // mid-stream. Each INCOMING marker is complete JSON (parsed individually),
  // but the accumulator just concatenates fragments. We feed the §20.2
  // markers ONE AT A TIME and assert: after the first 3 (incomplete JSON)
  // the buffer is the RAW concatenation and JSON.parse would throw; only
  // after the 4th (complete) does it parse to an object.
  {
    const m1 = '{"__tool_calls":[{"name":"ls","arguments":""}]}';
    const m2 = '{"__tool_calls":[{"name":"","arguments":"{"}]}';
    const m3 = '{"__tool_calls":[{"name":"","arguments":"\\"path\\": \\"."}]}';
    const m4 = '{"__tool_calls":[{"name":"","arguments":"\\"}"}]}';
    const exp = (m) => JSON.parse(m).__tool_calls[0].arguments;

    const n = new ToolCallNormalizer();
    n.consume(m1);
    n.consume(m2);
    // After m1+m2: buffer = "" + "{" = "{" — incomplete, must NOT have thrown.
    let snap = n.snapshot();
    assert.equal(snap[0].name, "ls");
    assert.equal(snap[0].argBuffer, exp(m1) + exp(m2), "§20.4 buffer is raw concatenation after 2 fragments");
    assert.throws(() => JSON.parse(snap[0].argBuffer), "§20.4 incomplete buffer is NOT valid JSON (proves no premature parse)");

    n.consume(m3);
    snap = n.snapshot();
    assert.equal(snap[0].argBuffer, exp(m1) + exp(m2) + exp(m3), "§20.4 buffer is raw concatenation after 3 fragments");
    assert.throws(() => JSON.parse(snap[0].argBuffer), "§20.4 still-incomplete buffer is NOT valid JSON");

    n.consume(m4);
    snap = n.snapshot();
    // Now complete — a CLIENT would parse here (the normalizer itself never does).
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(snap[0].argBuffer); }, "§20.4 final complete buffer is valid JSON");
    assert.equal(parsed.path, ".", "§20.4 final parsed args {path:'.'}");
  }

  // ─── §20.5 Multiple tool calls stay independent (per index) ─────────
  // Markers built via JSON.stringify so escaping is unambiguous.
  {
    const marker = (calls) => JSON.stringify({ __tool_calls: calls });
    const n = new ToolCallNormalizer();
    n.consume(marker([
      { name: "ls", arguments: "" },
      { name: "pwd", arguments: "" },
    ]));
    n.consume(marker([
      { name: "", arguments: '{"a":1}' },
      { name: "", arguments: '{"b":2}' },
    ]));
    const snap = n.snapshot();
    assert.equal(snap.length, 2, "§20.5 two independent accumulators");
    assert.equal(snap[0].name, "ls");
    assert.equal(snap[0].argBuffer, '{"a":1}');
    assert.equal(snap[1].name, "pwd");
    assert.equal(snap[1].argBuffer, '{"b":2}');
    // ids must be distinct + stable
    assert.notEqual(snap[0].id, snap[1].id, "§20.5 distinct ids per index");
  }

  // ─── §20.6 Mixed text + tool stream: tool data never leaks as content ─
  {
    const marker = (calls) => JSON.stringify({ __tool_calls: calls });
    const n = new ToolCallNormalizer();
    const t1 = n.consume("Sure, I'll list the directory.");
    const m1 = n.consume(marker([{ name: "ls", arguments: '{"path": "."}' }]));
    const t2 = n.consume(" Done.");
    assert.equal(t1.content, "Sure, I'll list the directory.", "§20.6 text before marker → content");
    assert.ok(m1.toolCalls && m1.toolCalls.length === 1, "§20.6 marker → toolCall");
    assert.equal(m1.content, undefined, "§20.6 marker yields NO content (no leak)");
    assert.equal(t2.content, " Done.", "§20.6 text after marker → content");
    // CRITICAL: at no point did the __tool_calls JSON appear in content.
  }

  // ─── §20.7 __tool_calls never appears as assistant content ──────────
  {
    const n = new ToolCallNormalizer();
    const deltas = [
      'plain text 1 ',
      '{"__tool_calls":[{"name":"ls","arguments":""}]}',
      '{"__tool_calls":[{"name":"","arguments":"{}"}]}',
      ' plain text 2',
    ];
    let combinedContent = "";
    for (const d of deltas) {
      const out = n.consume(d);
      if (out.content) combinedContent += out.content;
    }
    assert.ok(
      !combinedContent.includes("__tool_calls"),
      `§20.7 raw __tool_calls must NEVER appear in content — got ${JSON.stringify(combinedContent)}`,
    );
    assert.ok(combinedContent.includes("plain text 1"), "§20.7 plain text preserved");
    assert.ok(combinedContent.includes("plain text 2"), "§20.7 plain text preserved");
  }

  // ─── §20.8 INTEGRATION: streamChat emits delta.tool_calls, not content ─
  // Drives the full streaming-proxy path with the EXACT fragment sequence
  // the user reported, asserting the client-facing SSE contains proper
  // `delta.tool_calls` chunks + `finish_reason:"tool_calls"` and that the
  // raw `__tool_calls` JSON NEVER appears inside any `delta.content`.
  {
    const fake = createFakeMarkerProvider([
      '{"__tool_calls":[{"name":"ls","arguments":""}]}',
      '{"__tool_calls":[{"name":"","arguments":"{"}]}',
      '{"__tool_calls":[{"name":"","arguments":"\\"path\\": \\"."}]}',
      '{"__tool_calls":[{"name":"","arguments":"\\"}"}]}',
    ]);
    const req = {
      modelId: "fm/test",
      upstreamId: "test",
      messages: [{ role: "user", content: "list the directory" }],
      stream: true,
    };
    const { response, timings } = await streamChat(req, fake);
    assert.equal(response.status, 200, "§20.8 stream status 200");
    const events = await readStream(response);

    // Collect every content string + every tool_calls array that appeared.
    let anyContentHasMarker = false;
    let combinedContent = "";
    const toolCallDeltas = []; // [{index, id?, name?, arguments?}]
    let finishReason = null;
    let sawDone = false;
    for (const ev of events) {
      if (ev.done) { sawDone = true; continue; }
      if (!ev.data) continue;
      try {
        const j = JSON.parse(ev.data);
        const choice = j.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta;
        if (!d) continue;
        if (typeof d.content === "string" && d.content) {
          combinedContent += d.content;
          if (d.content.includes("__tool_calls")) anyContentHasMarker = true;
        }
        if (Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) toolCallDeltas.push(tc);
        }
      } catch { /* non-JSON (e.g. comment line) — ignore */ }
    }

    assert.ok(sawDone, "§20.8 [DONE] sentinel present");
    assert.equal(finishReason, "tool_calls", `§20.8 finish_reason must be "tool_calls" — got ${finishReason}`);
    assert.ok(
      toolCallDeltas.length >= 4,
      `§20.8 must emit >=4 delta.tool_calls chunks (one per fragment) — got ${toolCallDeltas.length}`,
    );
    assert.ok(
      !anyContentHasMarker && !combinedContent.includes("__tool_calls"),
      `§20.8 raw __tool_calls MUST NOT leak into delta.content — combined content was ${JSON.stringify(combinedContent)}`,
    );
    // The first tool_calls chunk must carry the stable id + name=ls.
    const firstWithId = toolCallDeltas.find((tc) => tc.id);
    assert.ok(firstWithId, "§20.8 at least one delta carries a stable id");
    assert.equal(firstWithId.index, 0, "§20.8 first id is for index 0");
    const nameDelta = toolCallDeltas.find((tc) => tc.function?.name);
    assert.equal(nameDelta.function.name, "ls", "§20.8 name delta = ls");
    // Concatenated argument fragments must reconstruct {"path": "."}
    const argConcat = toolCallDeltas
      .map((tc) => tc.function?.arguments ?? "")
      .join("");
    assert.equal(argConcat, '{"path": "."}', `§20.8 concatenated argument fragments = {"path": "."} — got ${JSON.stringify(argConcat)}`);

    console.log(
      `[normalizer] §20.8 integration: ${toolCallDeltas.length} delta.tool_calls chunks, ` +
      `finish=${finishReason}, contentLeak=false, args="${argConcat}"`,
    );
  }

  console.log("tool-call-normalizer.test.mjs: all scenarios PASS (§20.1-§20.8)");
}

// Allow direct invocation.
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => { console.log("tool-call-normalizer.test.mjs: PASS"); process.exit(0); })
    .catch((err) => { console.error("tool-call-normalizer.test.mjs: FAIL"); console.error(err); process.exit(1); });
}
