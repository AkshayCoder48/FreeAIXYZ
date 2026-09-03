/**
 * FenceNormalizer tests (FIX B — text-embedded tool calls).
 *
 * Covers the streaming state machine that converts ```tool_call fences
 * (and DSML tags) embedded in delta.content into standard delta.tool_calls:
 *   T1  whole fence in one delta
 *   T2  fence split across MANY deltas (opener split mid-backtick)
 *   T3  text before + after the fence is preserved as content
 *   T4  multiple calls in one fence (array form)
 *   T5  OpenAI-style nested function {name, arguments} shape + object args
 *   T6  loosely-escaped JSON body (\" variants)
 *   T7  unterminated fence at flush() still parses
 *   T8  unparseable fence re-emitted as text (nothing lost)
 *   T9  DSML invoke/parameter tags
 *   T10 disabled (no tools in request) → text passes through verbatim
 *   T11 a plain ```typescript code block is NOT hijacked
 *   T12 fence variants: tool_calls / tool-call / function_call / function_calls
 */

import assert from "node:assert/strict";
import { FenceNormalizer } from "../src/lib/gateway/fence-normalizer.ts";

function collect(n, chunks) {
  let text = "";
  const calls = [];
  for (const c of chunks) {
    const out = n.push(c);
    if (out.content) text += out.content;
    if (out.toolCalls) calls.push(...out.toolCalls);
  }
  const fin = n.flush();
  if (fin.content) text += fin.content;
  if (fin.toolCalls) calls.push(...fin.toolCalls);
  return { text, calls };
}

async function run() {
  // T1 — whole fence in one delta.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '```tool_call\n[{"name":"get_weather","arguments":{"city":"Tokyo"}}]\n```',
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, "get_weather");
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { city: "Tokyo" });
    assert.equal(text, "");
    assert.ok(calls[0].id.startsWith("call_"));
  }

  // T2 — fence split across deltas, opener split mid-backtick.
  {
    const n = new FenceNormalizer(true);
    const chunks = [
      "Sure! ",
      "Let me check. ``",
      "`to",
      "ol_call\n[{\"name\":\"calc\",\"arg",
      "uments\":{\"expression\":\"1+1\"}}]\n",
      "```",
      " Done.",
    ];
    const { text, calls } = collect(n, chunks);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, "calc");
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { expression: "1+1" });
    assert.equal(text.trim(), "Sure! Let me check.  Done.".trim());
  }

  // T3 — pre- and post-fence text preserved.
  {
    const n = new FenceNormalizer(true);
    const { text } = collect(n, [
      "Before. ```tool_call\n{\"name\":\"f\",\"arguments\":{}}\n``` After.",
    ]);
    assert.equal(text.trim(), "Before.  After.");
  }

  // T4 — multiple calls in one array fence.
  {
    const n = new FenceNormalizer(true);
    const { calls } = collect(n, [
      '```tool_call\n[{"name":"a","arguments":{"x":1}},{"name":"b","arguments":{"y":2}}]\n```',
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].function.name, "a");
    assert.equal(calls[1].function.name, "b");
    assert.equal(calls[0].index, 0);
    assert.equal(calls[1].index, 1);
    assert.notEqual(calls[0].id, calls[1].id);
  }

  // T5 — OpenAI nested shape + object arguments stringified.
  {
    const n = new FenceNormalizer(true);
    const { calls } = collect(n, [
      '```tool_call\n{"function":{"name":"nested","arguments":{"k":"v"}}}\n```',
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, "nested");
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { k: "v" });
  }

  // T6 — loosely-escaped JSON (\" inside the body).
  {
    const n = new FenceNormalizer(true);
    const { calls } = collect(n, [
      '```tool_call\n[{\"name\":\"esc\",\"arguments\":{\"q\":\"hi there\"}}]\n```',
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, "esc");
  }

  // T7 — unterminated fence at flush still parses.
  {
    const n = new FenceNormalizer(true);
    const out1 = n.push('```tool_call\n{"name":"open","arguments":{"z":9}}');
    assert.equal(out1.content, undefined); // buffered, not leaked
    const fin = n.flush();
    assert.equal(fin.toolCalls.length, 1);
    assert.equal(fin.toolCalls[0].function.name, "open");
  }

  // T8 — unparseable fence re-emitted as text.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, ["```tool_call\nthis is not json\n```"]);
    assert.equal(calls.length, 0);
    assert.ok(text.includes("```tool_call"));
    assert.ok(text.includes("this is not json"));
  }

  // T9 — DSML tags.
  {
    const n = new FenceNormalizer(true);
    const dsml =
      "<｜｜DSML｜｜tool_calls>\n" +
      '<｜｜DSML｜｜invoke name="get_weather">\n' +
      '<｜｜DSML｜｜parameter name="city">Tokyo<｜｜DSML｜｜/parameter>\n' +
      "<｜｜DSML｜｜/invoke>\n" +
      "</｜｜DSML｜｜tool_calls>";
    const { text, calls } = collect(n, [dsml]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, "get_weather");
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { city: "Tokyo" });
    assert.equal(text.trim(), "");
  }

  // T10 — disabled: text passes through verbatim, fences untouched.
  {
    const n = new FenceNormalizer(false);
    const { text, calls } = collect(n, [
      "```tool_call\n[{\"name\":\"x\",\"arguments\":{}}]\n```",
    ]);
    assert.equal(calls.length, 0);
    assert.ok(text.includes("```tool_call"));
  }

  // T11 — plain code fences are NOT hijacked.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      "```typescript\nconst x: number = 1;\n```",
    ]);
    assert.equal(calls.length, 0);
    assert.ok(text.includes("const x: number = 1;"));
  }

  // T12 — fence opener variants.
  for (const opener of [
    "```tool_calls",
    "```tool-call",
    "```tool-calls",
    "```function_call",
    "```function_calls",
    "```function call",
  ]) {
    const n = new FenceNormalizer(true);
    const { calls } = collect(n, [
      `${opener}\n[{"name":"v","arguments":{}}]\n\`\`\``,
    ]);
    assert.equal(calls.length, 1, `opener ${opener} should parse`);
    assert.equal(calls[0].function.name, "v");
  }

  console.log("fence-normalizer: 12 assertions groups passed");
}

export { run };
