/**
 * Bare-JSON tool-call detection + truncated-JSON repair tests
 * (the Open WebUI "full raw tool call not in tool call deltas" fix).
 *
 *   B1  bare JSON array tool call in ONE delta → delta.tool_calls
 *   B2  bare JSON split across MANY char-level deltas (mid-key split) →
 *       still detected, text before it streams as content
 *   B3  THE USER CASE — bare array with long nested arguments, cut off
 *       mid-string at end-of-stream → repaired → partial tool call fires
 *       (never leaks as raw text)
 *   B4  ordinary JSON object (name but NO arguments) → re-emitted as text
 *   B5  valid JSON is repaired to itself (identity)
 *   B6  repairTruncatedJson closes strings/brackets correctly
 *   B7  fence path still works (regression)
 *   B8  disabled normalizer → verbatim passthrough
 *   B9  multiple calls in bare array
 *  B10  __tool_calls marker object in text
 *  B11  prefix-holdback: text keeps flowing while a partial `[{"na` tail
 *       is held, released at flush
 *  ─── ESCAPED / CURLY QUOTE FLEET LEAK (raw tool-call JSON in all
 *      models — fixed with the string-style scanner + lenient parser) ──
 *  B12  fully-escaped bare JSON array in ONE delta
 *  B13  escaped bare JSON split across CHAR-LEVEL deltas
 *  B14  escaped single-OBJECT tool call
 *  B15  THE AFTERDARK LIVE CASE — fenced body mixing escaped quotes,
 *       curly quotes, stray `?` and a missing `]` → lenient salvage
 *  B16  curly-quoted bare tool call
 *  B17  ordinary escaped JSON (no tool keys) stays text
 *  B18  escaped array + trailing prose (container isolation)
 *  B19  feedBalance completes escaped/curly bodies at the right index
 *  B20  lenientJsonParse salvage matrix
 */

import assert from "node:assert/strict";
import { FenceNormalizer } from "../src/lib/gateway/fence-normalizer.ts";
import {
  repairTruncatedJson,
  feedBalance,
  freshBalance,
  lenientJsonParse,
} from "../src/lib/json-repair.ts";

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
  // B1 — bare JSON array tool call in one delta.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '[{"name":"ask_user","arguments":{"questions":["What file name?"]}}]',
    ]);
    assert.equal(calls.length, 1, "B1: one call");
    assert.equal(calls[0].function.name, "ask_user", "B1: name");
    assert.deepEqual(
      JSON.parse(calls[0].function.arguments),
      { questions: ["What file name?"] },
      "B1: arguments",
    );
    assert.equal(text, "", "B1: no text leak");
  }

  // B2 — split across char-level deltas; prefix text streams as content.
  {
    const n = new FenceNormalizer(true);
    const json = '[{"name":"get_weather","arguments":{"location":"Tokyo"}}]';
    const chunks = ["Sure, let me check.\n\n"];
    for (const ch of json) chunks.push(ch);
    const { text, calls } = collect(n, chunks);
    assert.ok(text.startsWith("Sure, let me check."), "B2: prefix text streamed: " + JSON.stringify(text));
    assert.equal(calls.length, 1, "B2: call detected");
    assert.equal(calls[0].function.name, "get_weather", "B2: name");
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { location: "Tokyo" }, "B2: args");
    assert.ok(!text.includes('"name"'), "B2: no raw JSON leak");
  }

  // B3 — THE USER CASE: truncated mid-string at EOF → repaired partial call.
  {
    const truncated =
      '[{"name":"ask_user","arguments":{"questions":[{"text":"What should the file be named?"},{"text":"What content should go into the file?"},{"text":"Do you want me to';
    const n = new FenceNormalizer(true);
    // split into small deltas to exercise the state machine
    const chunks = [];
    for (let i = 0; i < truncated.length; i += 7) chunks.push(truncated.slice(i, i + 7));
    const { text, calls } = collect(n, chunks);
    assert.equal(calls.length, 1, "B3: partial call salvaged (got " + calls.length + ")");
    assert.equal(calls[0].function.name, "ask_user", "B3: name");
    const args = JSON.parse(calls[0].function.arguments); // must parse = repaired
    assert.ok(Array.isArray(args.questions), "B3: repaired questions array");
    assert.ok(args.questions.length >= 2, "B3: kept the completed questions");
    assert.ok(!text.includes('"name"'), "B3: no raw JSON leak");
  }

  // B4 — ordinary JSON (no arguments key) is NOT hijacked.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, ['{"name":"config.json","content":"hello"}']);
    assert.equal(calls.length, 0, "B4: no calls");
    assert.ok(text.includes("config.json"), "B4: re-emitted as text");
  }

  // B5 — repair is identity on valid JSON.
  {
    const valid = '[{"name":"x","arguments":{"a":1}}]';
    assert.equal(repairTruncatedJson(valid), valid, "B5: identity");
    const valid2 = '{"a":[1,2,{"b":"c"}]}';
    assert.equal(repairTruncatedJson(valid2), valid2, "B5: identity 2");
  }

  // B6 — repair closes strings/brackets.
  {
    const r = repairTruncatedJson('{"questions":[{"text":"Do you want me to');
    const parsed = JSON.parse(r);
    assert.equal(parsed.questions[0].text, "Do you want me to", "B6: string closed");
    const r2 = repairTruncatedJson('[{"name":"x","arguments":{"q":[{"text":"a"},');
    const p2 = JSON.parse(r2);
    assert.deepEqual(p2[0].arguments.q[0], { text: "a" }, "B6: comma + brackets closed");
  }

  // B7 — fence path regression.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      "```tool_call\n[{\"name\":\"get_weather\",\"arguments\":{\"city\":\"Tokyo\"}}]\n```",
    ]);
    assert.equal(calls.length, 1, "B7: fence call");
    assert.equal(calls[0].function.name, "get_weather", "B7: fence name");
    assert.equal(text, "", "B7: no leak");
  }

  // B8 — disabled → verbatim.
  {
    const n = new FenceNormalizer(false);
    const { text, calls } = collect(n, ['[{"name":"x","arguments":{}}]']);
    assert.equal(calls.length, 0, "B8: no calls when disabled");
    assert.ok(text.includes('"name"'), "B8: verbatim passthrough");
  }

  // B9 — multiple calls in a bare array.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '[{"name":"a","arguments":{"x":1}},{"name":"b","arguments":{"y":2}}]',
    ]);
    assert.equal(calls.length, 2, "B9: two calls");
    assert.equal(calls[0].function.name, "a", "B9: first");
    assert.equal(calls[1].function.name, "b", "B9: second");
    assert.equal(text, "", "B9: no leak");
  }

  // B10 — __tool_calls marker object in text.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, ['{"__tool_calls":[{"name":"ls","arguments":"{\\"path\\":\\"/\\"}"}]}']);
    assert.equal(calls.length, 1, "B10: marker call");
    assert.equal(calls[0].function.name, "ls", "B10: marker name");
    assert.equal(text, "", "B10: no leak");
  }

  // B11 — feedBalance completion index.
  {
    const st = freshBalance();
    assert.equal(feedBalance(st, "not json"), -1, "B11: no container");
    const st2 = freshBalance();
    const idx = feedBalance(st2, '{"a":{"b":1}} trailing');
    assert.equal(idx, '{"a":{"b":1}}'.length - 1, "B11: completion index");
  }

  // ─── ESCAPED / CURLY QUOTE FLEET LEAK (the "raw tool call JSON in all
  // models" fix) — observed live: onyx-amora streams the tool call as
  // backslash-escaped bare JSON; onyx-amora-afterdark fences it with
  // curly quotes, stray punctuation and missing brackets. ───────────────

  // B12 — fully-escaped bare JSON array in ONE delta.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '[{\\"name\\":\\"ask_user\\",\\"arguments\\":{\\"questions\\":[{\\"question\\":\\"Gender?\\",\\"type\\":\\"input\\"}]}}]',
    ]);
    assert.equal(calls.length, 1, "B12: escaped bare detected");
    assert.equal(calls[0].function.name, "ask_user", "B12: name");
    assert.deepEqual(
      JSON.parse(calls[0].function.arguments),
      { questions: [{ question: "Gender?", type: "input" }] },
      "B12: args",
    );
    assert.equal(text, "", "B12: no raw JSON leak");
  }

  // B13 — escaped bare JSON split across char-level deltas.
  {
    const n = new FenceNormalizer(true);
    const body = '[{\\"name\\":\\"ask_user\\",\\"arguments\\":{\\"questions\\":[\\"Q1?\\",\\"Q2?\\"]}}]';
    const chunks = ["Sure! ", ...body.split("")];
    const { text, calls } = collect(n, chunks);
    assert.equal(calls.length, 1, "B13: split escaped detected");
    assert.equal(calls[0].function.name, "ask_user", "B13: name");
    assert.deepEqual(
      JSON.parse(calls[0].function.arguments),
      { questions: ["Q1?", "Q2?"] },
      "B13: args",
    );
    assert.equal(text.trim(), "Sure!", "B13: prefix text kept, nothing else leaked");
  }

  // B14 — escaped SINGLE-OBJECT tool call.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '{\\"name\\":\\"ask_user\\",\\"arguments\\":{\\"questions\\":[\\"Q1?\\"]}}',
    ]);
    assert.equal(calls.length, 1, "B14: escaped object detected");
    assert.equal(calls[0].function.name, "ask_user", "B14: name");
    assert.equal(text, "", "B14: no leak");
  }

  // B15 — THE AFTERDARK LIVE CASE: fenced body mixing escaped quotes,
  // curly quotes, a stray `?` between elements and a missing `]` — the
  // lenient parser salvages all three questions.
  {
    const n = new FenceNormalizer(true);
    const body =
      '[{\\"name\\":\\"ask_user\\",\\"arguments\\":{\\"questions\\":[\\"Hard NSFW content?”,,”Fictional characters and scenarios”?,“Graphic, explicit detail?\\"}}]'.replace(
        /,,/g,
        ",",
      );
    const { text, calls } = collect(n, [
      "```tool_call\n",
      body,
      "\n```",
      "Please answer yes or no.",
    ]);
    assert.equal(calls.length, 1, "B15: malformed fence salvaged (got " + calls.length + ")");
    assert.equal(calls[0].function.name, "ask_user", "B15: name");
    const args = JSON.parse(calls[0].function.arguments);
    assert.equal(args.questions.length, 3, "B15: all three questions recovered");
    assert.ok(args.questions[0].includes("Hard NSFW content"), "B15: q1 content");
    assert.ok(text.includes("Please answer yes or no."), "B15: post-fence prose kept");
    assert.ok(!text.includes("ask_user"), "B15: no raw JSON leak");
  }

  // B16 — curly-quoted bare tool call (no fence, no escapes).
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '[{"name":"ask_user","arguments":{"questions":["Q1?”,”Q2"]}}]',
    ]);
    assert.equal(calls.length, 1, "B16: curly bare detected");
    assert.equal(calls[0].function.name, "ask_user", "B16: name");
    assert.equal(text, "", "B16: no leak");
  }

  // B17 — ordinary escaped JSON (no tool keys) stays text.
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      'config: [{\\"path\\":\\"/usr/bin\\",\\"size\\":42}] done',
    ]);
    assert.equal(calls.length, 0, "B17: not hijacked");
    assert.ok(text.includes("/usr/bin"), "B17: re-emitted as text");
  }

  // B18 — escaped array with trailing prose (container extraction +
  // unescape variants must isolate the array).
  {
    const n = new FenceNormalizer(true);
    const { text, calls } = collect(n, [
      '[{\\"name\\":\\"f\\",\\"arguments\\":{\\"x\\":1}}] and then some prose',
    ]);
    assert.equal(calls.length, 1, "B18: escaped + prose detected");
    assert.equal(calls[0].function.name, "f", "B18: name");
    assert.ok(text.includes("and then some prose"), "B18: prose preserved");
    assert.ok(!text.includes('\\"name\\"'), "B18: no raw JSON leak");
  }

  // B19 — feedBalance completes escaped + curly bodies at the right index.
  {
    const st = freshBalance();
    const escaped = '[{\\"name\\":\\"x\\",\\"arguments\\":{}}]';
    const atEsc = feedBalance(st, escaped);
    assert.equal(atEsc, escaped.length - 1, "B19: escaped completion index");
    // Curly-OPEN value strings inside a plain-JSON skeleton (the observed
    // afterdark pattern: escaped/plain keys, curly value delimiters).
    const st2 = freshBalance();
    const curly = '[{"name":"x","arguments":{"q":["a”,”b"]}}]';
    const atCur = feedBalance(st2, curly);
    assert.equal(atCur, curly.length - 1, "B19: curly completion index");
  }

  // B20 — lenientJsonParse salvage matrix.
  {
    const lp = lenientJsonParse;
    // missing bracket: `}` closes array then object
    const v1 = lp('[{"name":"f","arguments":{"q":["a","b"}}]');
    assert.equal(v1[0].arguments.q.length, 2, "B20: missing ] salvaged");
    // trailing prose ignored
    const v2 = lp('[{"name":"f","arguments":{}}] some prose');
    assert.equal(v2[0].name, "f", "B20: trailing prose ignored");
    // truncated
    const v3 = lp('[{"name":"ask_user","arguments":{"questions":["What should the');
    assert.equal(v3[0].name, "ask_user", "B20: truncated salvaged");
    // junk between elements
    const v4 = lp('["a" ? , "b"]');
    assert.equal(v4.length, 2, "B20: junk between elements skipped");
    // valid strict JSON passes through unchanged
    const v5 = lp('{"a":1,"b":[true,false,null],"c":"x\\"y\\""}');
    assert.equal(v5.a, 1, "B20: valid json a");
    assert.equal(v5.c, 'x"y"', "B20: valid json escapes");
    // no JSON at all → null
    assert.equal(lp("hello world"), null, "B20: no json → null");
  }

  console.log("bare-json-tools: 20/20 PASS");
}

export { run };
