/**
 * Canonical model id tests (PRD §23, §25, §26, §66, §99, §168).
 *
 * Each provider has a SHORT, STABLE, UNIQUE id (`tb`, `fg`, `po`, etc.)
 * declared in PROVIDER_SHORT_IDS. The canonical public model id is
 * `<shortId>/<originalUpstreamId>` — ids are NEVER generated from
 * random strings or model names (PRD §26).
 *
 * Duplicate provider namespaces
 * must have DISTINCT short ids so the same upstream id from each is
 * addressable as `po/model-x` vs `pi/model-x`.
 *
 * Parsing an id with an unknown short namespace must return null
 * (PRD §99 → invalid_model_namespace).
 */

import assert from "node:assert/strict";
import {
  canonicalModelId,
  parseCanonicalModelId,
  shortIdFor,
  PROVIDER_SHORT_IDS,
  getProviderEntry,
  getByShortId,
} from "../src/lib/gateway/ids.ts";

export async function run() {
  // 1. canonicalModelId composes "<shortId>/<upstreamId>" (PRD §25).
  assert.equal(
    canonicalModelId("freegpt", "gpt-5"),
    "fg/gpt-5",
    `freegpt/gpt-5 → fg/gpt-5`,
  );

  // 2. parseCanonicalModelId round-trips.
  {
    const r = parseCanonicalModelId("fg/gpt-5");
    assert.ok(r, "fg/gpt-5 parses");
    assert.equal(r.providerId, "freegpt");
    assert.equal(r.upstreamId, "gpt-5");
  }

  // 3. Unknown namespace → null (PRD §99 → invalid_model_namespace).
  assert.equal(
    parseCanonicalModelId("unknown/model"),
    null,
    "unknown short id → null",
  );

  // 4. No slash → null.
  assert.equal(
    parseCanonicalModelId("no-slash"),
    null,
    "no-slash → null",
  );

  // 5. Empty upstream → still parses (providerId valid, upstreamId="").
  //    (This is not strictly forbidden by the spec; just verify it doesn't throw.)
  {
    const r = parseCanonicalModelId("fg/");
    assert.ok(r, "fg/ parses");
    assert.equal(r.providerId, "freegpt");
    assert.equal(r.upstreamId, "", "upstreamId is empty string");
  }

  // 6. Distinct providers — both valid, distinct.
  assert.equal(
    canonicalModelId("uncloseai", "model-x"),
    "un/model-x",
    "uncloseai → un",
  );
  assert.equal(
    canonicalModelId("free2gpt", "model-x"),
    "f2/model-x",
    "free2gpt → f2",
  );
  assert.notEqual(
    canonicalModelId("uncloseai", "model-x"),
    canonicalModelId("free2gpt", "model-x"),
    "same upstream id under different providers → distinct canonical ids",
  );

  // 7. shortIdFor throws for unregistered providers (PRD §26).
  assert.throws(
    () => shortIdFor("nonexistent"),
    /no registered short id/,
    "shortIdFor throws on unknown provider",
  );

  // 8. getProviderEntry / getByShortId round-trip.
  assert.ok(getProviderEntry("freegpt"));
  assert.equal(getProviderEntry("freegpt").shortId, "fg");
  assert.ok(getByShortId("fg"));
  assert.equal(getByShortId("fg").id, "freegpt");
  assert.equal(getProviderEntry("nonexistent"), undefined);
  assert.equal(getByShortId("zz"), undefined);

  // 9. PROVIDER_SHORT_IDS is non-empty and all entries have unique shortIds.
  {
    const shortIds = PROVIDER_SHORT_IDS.map((e) => e.shortId);
    const unique = new Set(shortIds);
    assert.equal(
      shortIds.length,
      unique.size,
      "all short ids are unique (PRD §26)",
    );
    const ids = PROVIDER_SHORT_IDS.map((e) => e.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, "all provider ids are unique");
  }

  // 10. parseCanonicalModelId handles upstreamId containing slashes
  //     (e.g. `vx/some/nested/path` — only the FIRST slash is the separator).
  {
    const r = parseCanonicalModelId("fg/some/nested/path");
    assert.ok(r);
    assert.equal(r.providerId, "freegpt");
    assert.equal(r.upstreamId, "some/nested/path");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("ids.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("ids.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
