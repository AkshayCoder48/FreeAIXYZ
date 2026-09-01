/**
 * Tool-pipeline regression tests (Tool PRD §28 matrix, §29 acceptance).
 *
 * Validates the pure pipeline stages end-to-end WITHOUT network:
 *
 *  T1   Tool schema validation      — valid tools pass; malformed rejected
 *  T2   tool_choice preservation    — string + forced-function object survive
 *  T3   Provider payload forwarding — tools/tool_choice/parallel_tool_calls
 *                                     land in the serialized payload (§5, §17)
 *  T4   Silent tool-loss assertion  — dropped tools throw TOOL_FORWARDING_ERROR (§20)
 *  T5   Streaming accumulation      — delta.tool_calls fragments accumulate by
 *                                     index; args parsed ONLY after completion (§11/§12)
 *  T6   Multiple parallel tool calls (§12/§24)
 *  T7   Follow-up history           — assistant.tool_calls + tool messages
 *                                     serialize to the OpenAI shape (§14)
 *  T8   Emulated fence round-trip   — ```tool_call fence in content → parsed
 *                                     structured calls + cleaned text (§13)
 *  T9   Calculator executor         — exact arithmetic incl. the PRD
 *                                     acceptance example 12345 × 6789 (§29 T1)
 *  T10  Tool result clamping        — oversized results truncate to a
 *                                     structured error (§25)
 */

import assert from "node:assert/strict";
import { validateToolParams } from "../src/lib/tools/validation.ts";
import { assertToolsForwarded, applyToolParamsToPayload } from "../src/lib/tools/forwarding.ts";
import { ToolCallNormalizer } from "../src/lib/gateway/tool-call-normalizer.ts";
import { parseToolCalls } from "../src/lib/tool-calls.ts";
import { clampToolResult, executeRegisteredTool } from "../src/lib/tools/registry.ts";
import { GatewayError } from "../src/lib/gateway/errors.ts";

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the live web",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

const CALCULATOR_TOOL = {
  type: "function",
  function: {
    name: "calculator",
    description: "Evaluate arithmetic",
    parameters: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
};

export async function run() {
  // ─── T1: tool schema validation (§6) ─────────────────────────────────────
  {
    const ok = validateToolParams({
      tools: [WEB_SEARCH_TOOL, CALCULATOR_TOOL],
      tool_choice: "auto",
      parallel_tool_calls: true,
    });
    assert.equal(ok.tools.length, 2, "T1: both tools validated");
    assert.equal(ok.toolChoice, "auto", "T1: tool_choice preserved");
    assert.equal(ok.parallelToolCalls, true, "T1: parallel_tool_calls preserved");

    // Empty array = no tools (not an error).
    const empty = validateToolParams({ tools: [] });
    assert.equal(empty.tools.length, 0, "T1: empty tools array is a no-op");

    // Malformed tools rejected.
    for (const bad of [
      { tools: [{ type: "function" }] }, // missing function
      { tools: [{ type: "json_schema", function: { name: "x" } }] }, // wrong type
      { tools: [{ type: "function", function: { name: "bad name!" } }] }, // bad name
      { tools: [{ type: "function", function: { name: "x", parameters: "nope" } }] }, // bad params
      { tools: [{ type: "function", function: { name: "x" } }], tool_choice: "banana" }, // bad tool_choice
      { tools: [{ type: "function", function: { name: "x" } }], parallel_tool_calls: "yes" }, // bad parallel
    ]) {
      let threw = null;
      try {
        validateToolParams(bad);
      } catch (err) {
        threw = err;
      }
      assert.ok(threw instanceof GatewayError, "T1: malformed tool input throws GatewayError");
      assert.equal(threw.type, "TOOL_SCHEMA_INVALID", "T1: error is TOOL_SCHEMA_INVALID");
    }
    console.log("tool-pipeline T1 (schema validation): ok");
  }

  // ─── T2: tool_choice object form preserved (§9) ──────────────────────────
  {
    const forced = validateToolParams({
      tools: [WEB_SEARCH_TOOL],
      tool_choice: { type: "function", function: { name: "web_search" } },
    });
    assert.deepEqual(
      forced.toolChoice,
      { type: "function", function: { name: "web_search" } },
      "T2: forced-function tool_choice preserved verbatim",
    );
    console.log("tool-pipeline T2 (tool_choice object form): ok");
  }

  // ─── T3: provider payload forwarding (§5, §17) ───────────────────────────
  {
    const payload = applyToolParamsToPayload(
      {
        model: "gpt-5.6",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
      [WEB_SEARCH_TOOL, CALCULATOR_TOOL],
      "auto",
      true,
      "opencode",
      "gpt-5.6",
    );
    assert.equal(payload.tools.length, 2, "T3: tools forwarded");
    assert.equal(payload.tool_choice, "auto", "T3: tool_choice forwarded");
    assert.equal(payload.parallel_tool_calls, true, "T3: parallel_tool_calls forwarded");
    // Fields actually survive JSON serialization (the wire format).
    const wire = JSON.parse(JSON.stringify(payload));
    assert.equal(wire.tools.length, 2, "T3: tools survive serialization");
    assert.equal(wire.tool_choice, "auto", "T3: tool_choice survives serialization");
    console.log("tool-pipeline T3 (provider payload forwarding): ok");
  }

  // ─── T4: silent tool-loss detection (§20) ────────────────────────────────
  {
    // A payload that DROPPED the tools must throw TOOL_FORWARDING_ERROR.
    let threw = null;
    try {
      assertToolsForwarded(
        { model: "x", messages: [] }, // tools missing!
        [WEB_SEARCH_TOOL],
        "opencode",
        "x",
      );
    } catch (err) {
      threw = err;
    }
    assert.ok(threw instanceof GatewayError, "T4: dropped tools throw");
    assert.equal(threw.type, "TOOL_FORWARDING_ERROR", "T4: type is TOOL_FORWARDING_ERROR");

    // No tools requested → no assertion, no throw.
    assert.doesNotThrow(() => assertToolsForwarded({ model: "x" }, undefined, "opencode"));
    console.log("tool-pipeline T4 (silent tool-loss assertion): ok");
  }

  // ─── T5 + T6: streaming accumulation (§11, §12) ──────────────────────────
  {
    const normalizer = new ToolCallNormalizer();
    // Simulate an OpenAI-compatible upstream emitting tool-call deltas as
    // __tool_calls markers (the adapter contract): first delta carries the
    // name, subsequent deltas carry argument fragments — INCLUDING a
    // fragment that splits a JSON object across chunks.
    const markers = [
      { __tool_calls: [{ name: "calculator", arguments: "" }] },
      { __tool_calls: [{ name: "", arguments: '{"expr' }] },
      { __tool_calls: [{ name: "", arguments: 'ession": "12345 * 6789"}' }] },
    ];
    let emitted = [];
    for (const m of markers) {
      const out = normalizer.consume(JSON.stringify(m));
      if (out.toolCalls) emitted = emitted.concat(out.toolCalls);
    }
    assert.ok(normalizer.didEmitToolCalls, "T5: tool calls detected");
    assert.equal(emitted.length, 3, "T5: three incremental fragments emitted");

    // Accumulate like the CLIENT does (index-keyed).
    const acc = new Map();
    for (const frag of emitted) {
      const idx = frag.index ?? 0;
      let e = acc.get(idx);
      if (!e) {
        e = { id: "", name: "", arguments: "" };
        acc.set(idx, e);
      }
      if (frag.id) e.id = frag.id;
      if (frag.function?.name) e.name = e.name || frag.function.name;
      if (typeof frag.function?.arguments === "string") e.arguments += frag.function.arguments;
    }
    const final = Array.from(acc.values());
    assert.equal(final.length, 1, "T5: one accumulated tool call");
    assert.equal(final[0].name, "calculator", "T5: name accumulated");
    // Arguments parsed ONLY after completion (§12) — and they're valid JSON.
    const args = JSON.parse(final[0].arguments);
    assert.equal(args.expression, "12345 * 6789", "T5: arguments assembled correctly");

    // T6: multiple parallel tool calls (§12, §24) — two indices at once.
    const multi = new ToolCallNormalizer();
    const out = multi.consume(
      JSON.stringify({
        __tool_calls: [
          { name: "web_search", arguments: '{"query":"a"}' },
          { name: "calculator", arguments: '{"expression":"1+1"}' },
        ],
      }),
    );
    assert.equal(out.toolCalls?.length, 2, "T6: two parallel tool calls emitted");
    const snap = multi.snapshot();
    assert.equal(snap.length, 2, "T6: snapshot has two accumulators");
    assert.deepEqual(
      snap.map((s) => s.name).sort(),
      ["calculator", "web_search"],
      "T6: both names captured",
    );
    console.log("tool-pipeline T5+T6 (streaming accumulation, parallel calls): ok");
  }

  // ─── T7: follow-up history shape (§14) ───────────────────────────────────
  {
    const history = [
      { role: "user", content: "Calculate 12345 × 6789." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "calculator", arguments: '{"expression":"12345 * 6789"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"result":"83810205"}' },
    ];
    const wire = JSON.parse(JSON.stringify(history));
    assert.equal(wire[1].tool_calls[0].function.name, "calculator", "T7: assistant.tool_calls shape");
    assert.equal(wire[2].tool_call_id, "call_1", "T7: tool result carries tool_call_id");
    assert.equal(wire[2].role, "tool", "T7: tool role preserved");
    console.log("tool-pipeline T7 (follow-up history shape): ok");
  }

  // ─── T8: emulated fence round-trip (§13) ─────────────────────────────────
  {
    const content =
      'Let me compute that.\n```tool_call\n[{"name":"calculator","arguments":{"expression":"12345 * 6789"}}]\n```';
    const parsed = parseToolCalls(content, () => "call_x");
    assert.equal(parsed.toolCalls.length, 1, "T8: fence produced one tool call");
    assert.equal(parsed.toolCalls[0].function.name, "calculator", "T8: name extracted");
    assert.equal(parsed.text.trim(), "Let me compute that.", "T8: fence stripped from text");
    const args = JSON.parse(parsed.toolCalls[0].function.arguments);
    assert.equal(args.expression, "12345 * 6789", "T8: arguments object parsed");
    console.log("tool-pipeline T8 (fence round-trip): ok");
  }

  // ─── T9: calculator executor (§29 Test 1 — 12345 × 6789) ─────────────────
  {
    const res = await executeRegisteredTool("calculator", {
      expression: "12345 * 6789",
    });
    assert.equal(res.result, "83810205", "T9: calculator computes 12345 × 6789");

    // Parser hardening: functions, constants, precedence, parentheses.
    // (Values pass through toPrecision(12) formatting — see formatNumber.)
    const fmt = (n) => String(Number(n.toPrecision(12)));
    const cases = [
      ["sqrt(2) * 2", fmt(Math.sqrt(2) * 2)],
      ["2 + 3 * 4", "14"],
      ["(2 + 3) * 4", "20"],
      ["-2^2", "-4"],
      ["2^3^2", "512"],
      ["min(3, 1, 2)", "1"],
      ["pi", fmt(Math.PI)],
      ["1,234,567 + 1", "1234568"],
    ];
    for (const [expr, expected] of cases) {
      const r = await executeRegisteredTool("calculator", { expression: expr });
      assert.equal(
        r.result,
        expected,
        `T9: calculator ${expr} = ${expected} (got ${r.result})`,
      );
    }
    // Malformed input → structured error (never a crash).
    let err = null;
    try {
      await executeRegisteredTool("calculator", { expression: "2 +* 3" });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error, "T9: malformed expression throws (structured)");
    console.log("tool-pipeline T9 (calculator executor): ok");
  }

  // ─── T10: tool result clamping (§25) ─────────────────────────────────────
  {
    const huge = "x".repeat(30_000);
    const { result, truncated, chars } = clampToolResult("web_search", { blob: huge });
    assert.ok(truncated, "T10: oversized result flagged truncated");
    assert.ok(chars > 20_000, "T10: original size recorded");
    assert.equal(result.success, false, "T10: structured error result");
    assert.equal(result.error, "Tool result exceeded context limit.");
    const small = clampToolResult("calculator", { result: "42" });
    assert.equal(small.truncated, false, "T10: small result untouched");
    console.log("tool-pipeline T10 (result clamping): ok");
  }
}

