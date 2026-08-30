/**
 * SseParser unit tests (PRD §17-20, §128).
 *
 * A network chunk ≠ an SSE event. A chunk may contain half an event, one
 * event, or twenty events. The parser must:
 *   - assemble split events across chunks,
 *   - handle CRLF and LF line endings uniformly,
 *   - reassemble multi-line `data:` fields (joined with "\n"),
 *   - handle `event:` / `id:` / `retry:` fields,
 *   - ignore `:` comment lines,
 *   - terminate on `data: [DONE]`,
 *   - decode UTF-8 split across byte boundaries (TextDecoder {stream:true}).
 *
 * Plus the convenience helpers:
 *   - extractOpenAiDelta — content/reasoning/tool_calls
 *   - extractSseError — inline provider error object
 *   - isFinishEvent — finish_reason sentinel
 */

import assert from "node:assert/strict";
import { SseParser, extractOpenAiDelta, extractSseError, isFinishEvent } from "../src/lib/gateway/sse-parser.ts";

const enc = (s) => new TextEncoder().encode(s);

export async function run() {
  // 1. Single event in one chunk.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: {"hello":"world"}\n\n`));
    assert.equal(ev.length, 1, "one event");
    assert.equal(ev[0].data, `{"hello":"world"}`);
    assert.equal(ev[0].done, false);
  }

  // 2. Multiple events in one chunk.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: a\n\ndata: b\n\n`));
    assert.equal(ev.length, 2);
    assert.equal(ev[0].data, "a");
    assert.equal(ev[1].data, "b");
  }

  // 3. Event split across two chunks (PRD §19).
  {
    const p = new SseParser();
    const e1 = p.feed(enc(`data: {"choices":[{"delta":{"conte`));
    assert.equal(e1.length, 0, "first partial chunk yields no event");
    const e2 = p.feed(enc(`nt":"hi"}}]}\n\n`));
    assert.equal(e2.length, 1, "second chunk completes the event");
    assert.equal(e2[0].data, `{"choices":[{"delta":{"content":"hi"}}]}`);
  }

  // 4. CRLF line endings.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: hi\r\n\r\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data, "hi");
  }

  // 5. LF line endings (covered above, sanity re-check with trailing data).
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: hi\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data, "hi");
  }

  // 6. UTF-8 split across byte boundary (PRD §18).
  //    The emoji 👍 is U+1F44D, UTF-8 bytes: F0 9F 91 8D (4 bytes).
  //    Split it between byte 2 and byte 3 across two Uint8Arrays.
  {
    const p = new SseParser();
    const full = `data: 👍\n\n`;
    const bytes = new TextEncoder().encode(full);
    // Find the emoji's start byte — `data: ` is 6 chars (all ASCII) = 6 bytes.
    const emojiStart = 6;
    const split = emojiStart + 2;
    const c1 = bytes.slice(0, split);
    const c2 = bytes.slice(split);
    const e1 = p.feed(c1);
    assert.equal(e1.length, 0, "partial UTF-8 yields no event");
    const e2 = p.feed(c2);
    assert.equal(e2.length, 1, "second half completes event");
    assert.equal(e2[0].data, "👍", "emoji reassembled across byte boundary");
  }

  // 7. data: [DONE] → event.done === true, parser stops emitting.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: [DONE]\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].done, true, "[DONE] sets done=true");
    // After [DONE], feed() returns [].
    const more = p.feed(enc(`data: should-be-ignored\n\n`));
    assert.equal(more.length, 0, "parser stops emitting after [DONE]");
    assert.equal(p.isDone, true);
  }

  // 8. Empty data line.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data:\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data, "", "empty data line yields empty data string");
    assert.equal(ev[0].done, false);
  }

  // 9. Invalid JSON in data → extractOpenAiDelta returns null, no throw.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: not-json\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(extractOpenAiDelta(ev[0]), null, "invalid JSON → null, no throw");
  }

  // 10. Multi-line data (PRD §20).
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: line1\ndata: line2\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].data, "line1\nline2", "multi-line data joined with \\n");
  }

  // 11. event: field.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`event: error\ndata: {"error":{"message":"x"}}\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event, "error");
    assert.equal(ev[0].data, `{"error":{"message":"x"}}`);
  }

  // 12. Comment lines (`: heartbeat`) ignored.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`: heartbeat\n\ndata: hi\n\n`));
    assert.equal(ev.length, 1, "comment line ignored — only one real event");
    assert.equal(ev[0].data, "hi");
  }

  // 13. Provider error inline (PRD §61).
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: {"error":{"message":"rate limited"}}\n\n`));
    assert.equal(ev.length, 1);
    const err = extractSseError(ev[0]);
    assert.ok(err, "extractSseError returns the error object");
    assert.equal(err.message, "rate limited");
    // extractOpenAiDelta returns null on error events.
    assert.equal(extractOpenAiDelta(ev[0]), null);
  }

  // 14. isFinishEvent — finish_reason sentinel.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: {"choices":[{"finish_reason":"stop"}]}\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(isFinishEvent(ev[0]), true);
  }

  // 15. extractOpenAiDelta — content.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`));
    assert.equal(extractOpenAiDelta(ev[0]), "hi");
  }

  // 16. extractOpenAiDelta — reasoning_content.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n`));
    assert.equal(extractOpenAiDelta(ev[0]), "thinking...");
  }

  // 17. end() flushes a trailing buffered event (event with no trailing
  //     blank line — `data: hi\n` is processed by drain() but the event
  //     boundary (blank line) never arrives, so end() must flush it).
  {
    const p = new SseParser();
    const e1 = p.feed(enc(`data: hi\n`));
    assert.equal(e1.length, 0, "no event boundary yet — partial event");
    const e2 = p.end();
    assert.equal(e2.length, 1, "end() flushes trailing event without blank line");
    assert.equal(e2[0].data, "hi");
  }

  // 18. id: + retry: fields.
  {
    const p = new SseParser();
    const ev = p.feed(enc(`id: 42\nretry: 5000\ndata: hi\n\n`));
    assert.equal(ev.length, 1);
    assert.equal(ev[0].id, "42");
    assert.equal(ev[0].retry, 5000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("sse-parser.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("sse-parser.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
