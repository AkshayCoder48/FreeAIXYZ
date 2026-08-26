/**
 * Redactor tests (PRD §126, §209, §210, §40).
 *
 * Sensitive data must NEVER leak to the client or to the dev log:
 *   - Authorization / Cookie / API-Key / Bearer / tokens / secrets
 *   - sk-* keys, long hex strings
 *
 * `sanitizeOutboundHeaders` drops client-controlled unsafe headers before
 * forwarding upstream (PRD §209): Authorization, Cookie, Host,
 * Content-Length, Connection, X-Forwarded-*, etc. are stripped.
 *
 * `bodyPreview` truncates a long body for diagnostic display.
 */

import assert from "node:assert/strict";
import {
  redactHeader,
  redactHeaders,
  redactText,
  sanitizeOutboundHeaders,
  bodyPreview,
  safeResponseHeaders,
} from "../src/lib/gateway/redact.ts";

export async function run() {
  // 1. redactHeader redacts Authorization.
  assert.equal(
    redactHeader("authorization", "Bearer sk-abc"),
    "<redacted>",
    "Authorization header is fully redacted",
  );
  // 2. redactHeader redacts Cookie.
  assert.equal(
    redactHeader("Cookie", "session=xyz"),
    "<redacted>",
    "Cookie header is fully redacted",
  );
  // 3. redactHeader passes through non-sensitive headers.
  assert.equal(
    redactHeader("Content-Type", "application/json"),
    "application/json",
    "Content-Type is not redacted",
  );
  // 4. redactHeader is case-insensitive on header name.
  assert.equal(
    redactHeader("AUTHORIZATION", "Bearer x"),
    "<redacted>",
  );
  // 5. redactHeader still scans the value for secret patterns even on
  //    non-sensitive header names (e.g. a leaked Bearer token in a custom header).
  assert.equal(
    redactHeader("X-Custom", "Bearer sk-abc123"),
    "Bearer <redacted>",
    "Bearer value is redacted even in non-sensitive header",
  );

  // 6. sanitizeOutboundHeaders drops Authorization + Cookie + Host,
  //    keeps Content-Type (PRD §209).
  {
    const out = sanitizeOutboundHeaders({
      Authorization: "x",
      Cookie: "y",
      "Content-Type": "z",
      Host: "h",
    });
    assert.equal(out.Authorization, undefined, "Authorization dropped");
    assert.equal(out.Cookie, undefined, "Cookie dropped");
    assert.equal(out.Host, undefined, "Host dropped");
    assert.equal(out["Content-Type"], "z", "Content-Type kept");
  }

  // 7. sanitizeOutboundHeaders drops X-Forwarded-* + Content-Length.
  {
    const out = sanitizeOutboundHeaders({
      "X-Forwarded-For": "1.2.3.4",
      "X-Real-Ip": "1.2.3.4",
      "Content-Length": "100",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
      "Content-Encoding": "gzip",
      Accept: "application/json",
    });
    assert.equal(out["X-Forwarded-For"], undefined);
    assert.equal(out["X-Real-Ip"], undefined);
    assert.equal(out["Content-Length"], undefined);
    assert.equal(out.Connection, undefined);
    assert.equal(out["Transfer-Encoding"], undefined);
    assert.equal(out["Content-Encoding"], undefined);
    assert.equal(out.Accept, "application/json");
  }

  // 8. bodyPreview truncates long bodies (PRD §40).
  {
    const long = "a".repeat(500);
    const preview = bodyPreview(long, 100);
    assert.ok(
      preview.length <= 101,
      `preview.length (${preview.length}) <= max + 1 (100 + "…")`,
    );
    assert.ok(preview.endsWith("…"), "preview ends with ellipsis");
  }

  // 9. bodyPreview does NOT truncate short bodies.
  {
    assert.equal(bodyPreview("hello", 100), "hello");
    assert.equal(bodyPreview("hello", 5), "hello");
    assert.equal(bodyPreview("hello", 4), "hell…");
  }

  // 10. bodyPreview redacts secrets in the preview.
  {
    const preview = bodyPreview("Authorization=Bearer sk-1234567890abcdefghij", 200);
    assert.ok(!preview.includes("sk-1234"), "sk- key redacted in preview");
    assert.ok(preview.includes("<redacted"), "preview contains <redacted>");
  }

  // 11. redactText redacts token= query param.
  {
    const out = redactText("token=secret123");
    assert.ok(out.includes("<redacted>"), `redactText contains <redacted> (got ${out})`);
    assert.ok(!out.includes("secret123"), "secret value redacted");
  }

  // 12. redactText redacts Bearer + api_key + sk-* keys.
  {
    const out = redactText("Bearer sk-1234567890abcdefghijklm");
    assert.ok(out.includes("Bearer "));
    assert.ok(out.includes("<redacted"), "Bearer redacted");
  }
  {
    const out = redactText("api_key=ABC123XYZ&other=foo");
    assert.ok(out.includes("api_key="), "api_key= prefix preserved");
    assert.ok(out.includes("<redacted>"), "api_key value redacted");
    assert.ok(!out.includes("ABC123XYZ"));
  }

  // 13. redactHeaders — full headers object.
  {
    const out = redactHeaders({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
      "X-Api-Key": "abc",
    });
    assert.equal(out.Authorization, "<redacted>");
    assert.equal(out["Content-Type"], "application/json");
    assert.equal(out["X-Api-Key"], "<redacted>");
  }

  // 14. safeResponseHeaders — only allow safe response headers (PRD §210).
  {
    const headers = new Headers();
    headers.set("content-type", "text/event-stream");
    headers.set("set-cookie", "session=xyz");
    headers.set("x-custom", "nope");
    const out = safeResponseHeaders(headers, { "X-Override": "yes" });
    assert.equal(out["X-Override"], "yes");
    assert.equal(out["content-type"], "text/event-stream");
    assert.equal(out["set-cookie"], undefined, "Set-Cookie stripped");
    assert.equal(out["x-custom"], undefined, "custom header stripped");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("redact.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("redact.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
