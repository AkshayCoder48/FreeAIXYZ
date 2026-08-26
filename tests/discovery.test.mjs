/**
 * Discovery service tests (PRD §27-34, §68-70, §132, §168, §169, §203, §205, §235).
 *
 * Replicates the ModelDiscoveryService pattern IN-TEST (does not use the
 * singleton — it requires the Prisma DB and would call real provider
 * endpoints). Tests:
 *   - Promise.allSettled with per-task timeout → failure isolation
 *     (PRD §70, §205, §235). One provider hanging does NOT block the
 *     others — its task fails with timeout but the other tasks complete.
 *   - Dedup by providerId+upstreamId (PRD §68, §169): a provider
 *     returning duplicate upstreamIds → only one model kept.
 *   - Two providers returning the same upstreamId → both kept (PRD §168):
 *     `canonicalModelId("a","x") !== canonicalModelId("b","x")`.
 */

import assert from "node:assert/strict";
import { canonicalModelId, parseCanonicalModelId } from "../src/lib/gateway/ids.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Race a promise against a timeout — rejects with a timeout error if it
 * doesn't resolve in `ms`. Mirrors the discovery service's `withTimeout`.
 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`discovery timed out after ${ms}ms for ${label}`));
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Dedup models by providerId+upstreamId (PRD §68, §169) — mirrors
 * the discovery service's dedup loop.
 */
function dedupModels(models) {
  const seen = new Set();
  const out = [];
  for (const m of models) {
    const key = `${m.providerId}|${m.upstreamId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * Replicates `discoverProviderWithTimeout` for a list of discoverers:
 * Promise.allSettled with per-task timeout, returns a results array.
 */
async function discoverAllWithTimeout(tasks, timeoutMs) {
  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      const models = await withTimeout(t.discover(), timeoutMs, t.providerId);
      return {
        providerId: t.providerId,
        models: dedupModels(models),
        mode: "dynamic",
        modelsFound: dedupModels(models).length,
      };
    }),
  );
  return results.map((r, i) => ({
    providerId: tasks[i].providerId,
    status: r.status,
    models: r.status === "fulfilled" ? r.value.models : [],
    error: r.status === "rejected" ? r.reason.message : undefined,
  }));
}

export async function run() {
  // ─── 1. Failure isolation (PRD §70, §205, §235) ──────────────────
  // A returns 2 models in ~50ms, B returns 3 models in ~100ms, C hangs
  // forever — should timeout at 500ms but A and B still complete.
  const taskA = {
    providerId: "providerA",
    discover: async () => {
      await sleep(50);
      return [
        { providerId: "providerA", upstreamId: "a-1" },
        { providerId: "providerA", upstreamId: "a-2" },
      ];
    },
  };
  const taskB = {
    providerId: "providerB",
    discover: async () => {
      await sleep(100);
      return [
        { providerId: "providerB", upstreamId: "b-1" },
        { providerId: "providerB", upstreamId: "b-2" },
        { providerId: "providerB", upstreamId: "b-3" },
      ];
    },
  };
  const taskC = {
    providerId: "providerC",
    discover: async () => {
      // Hangs forever — should timeout.
      await new Promise(() => {}); // never resolves
      return [];
    },
  };

  const t0 = Date.now();
  const results = await discoverAllWithTimeout([taskA, taskB, taskC], 500);
  const elapsed = Date.now() - t0;

  // A: 2 models fulfilled
  const rA = results.find((r) => r.providerId === "providerA");
  assert.ok(rA, "result A present");
  assert.equal(rA.status, "fulfilled", "A fulfilled");
  assert.equal(rA.models.length, 2, "A has 2 models");
  assert.ok(!rA.error, "A has no error");

  // B: 3 models fulfilled
  const rB = results.find((r) => r.providerId === "providerB");
  assert.ok(rB);
  assert.equal(rB.status, "fulfilled", "B fulfilled");
  assert.equal(rB.models.length, 3, "B has 3 models");
  assert.ok(!rB.error);

  // C: timed out (rejected)
  const rC = results.find((r) => r.providerId === "providerC");
  assert.ok(rC);
  assert.equal(rC.status, "rejected", "C rejected (timeout)");
  assert.equal(rC.models.length, 0, "C produced 0 models");
  assert.ok(rC.error && rC.error.includes("timed out"), `C error mentions timeout (got ${rC.error})`);

  // The whole run completes in roughly the timeout window (~500ms, not
  // the sum of all task durations). The fact that A + B finished first
  // AND C timed out means Promise.allSettled returned promptly after C's
  // timeout (PRD §70 — failure isolation).
  assert.ok(
    elapsed >= 450 && elapsed < 1500,
    `discovery ran in ~timeout window (${elapsed}ms — should be 500-1000ms)`,
  );

  // ─── 2. Dedup by providerId+upstreamId (PRD §68, §169) ───────────
  // Provider A returns duplicate upstreamIds → dedup to one.
  const duped = [
    { providerId: "providerA", upstreamId: "x" },
    { providerId: "providerA", upstreamId: "x" }, // dup
    { providerId: "providerA", upstreamId: "y" },
  ];
  const deduped = dedupModels(duped);
  assert.equal(deduped.length, 2, "dedup drops the duplicate upstreamId");
  assert.equal(deduped[0].upstreamId, "x");
  assert.equal(deduped[1].upstreamId, "y");

  // ─── 3. Two providers, same upstreamId → both kept (PRD §168) ─────
  // canonicalModelId disambiguates them via the shortId prefix.
  assert.notEqual(
    canonicalModelId("pollinations", "model-x"),
    canonicalModelId("pollinations-image", "model-x"),
    "two providers with same upstreamId must produce distinct canonical ids",
  );
  assert.equal(canonicalModelId("pollinations", "model-x"), "po/model-x");
  assert.equal(canonicalModelId("pollinations-image", "model-x"), "pi/model-x");

  // Dedup across providers preserves both — keys are provider-scoped.
  const multiProvider = [
    { providerId: "pollinations", upstreamId: "model-x" },
    { providerId: "pollinations-image", upstreamId: "model-x" },
  ];
  const multiDeduped = dedupModels(multiProvider);
  assert.equal(multiDeduped.length, 2, "same upstreamId under different providers NOT deduped");

  // ─── 4. parseCanonicalModelId round-trips ────────────────────────
  {
    const r1 = parseCanonicalModelId("po/model-x");
    assert.ok(r1);
    assert.equal(r1.providerId, "pollinations");
    assert.equal(r1.upstreamId, "model-x");
    const r2 = parseCanonicalModelId("pi/model-x");
    assert.ok(r2);
    assert.equal(r2.providerId, "pollinations-image");
    assert.equal(r2.upstreamId, "model-x");
  }

  // ─── 5. Failure isolation preserves already-completed results ────
  // Even if C fails, A and B are still loaded into the catalog. The
  // discovery service's contract (PRD §203) is: discovery errors mark
  // the catalog stale but DO NOT delete existing models.
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  // Total models discovered: 2 (A) + 3 (B) + 0 (C) = 5.
  const totalModels = results.reduce((sum, r) => sum + r.models.length, 0);
  assert.equal(totalModels, 5, "5 models discovered in total (2+3+0)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => {
    console.log("discovery.test.mjs: PASS");
    process.exit(0);
  }).catch((err) => {
    console.error("discovery.test.mjs: FAIL");
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}
