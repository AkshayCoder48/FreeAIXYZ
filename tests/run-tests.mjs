/**
 * Test runner (PRD §75, §76, §151 — no test framework dependency).
 *
 * Dynamically imports every `*.test.mjs` in this directory, runs its
 * `run` (or default-exported async function), counts PASS/FAIL, prints
 * a summary table, and exits 0 (all pass) or 1 (any fail).
 *
 * Each test file:
 *   - exports `async function run(): Promise<void|result>`
 *   - uses `node:assert` internally (throws AssertionError on failure)
 *
 * Usage:
 *   node tests/run-tests.mjs            # run all tests
 *   bun tests/run-tests.mjs             # run with bun (recommended — can
 *                                       #   import .ts source files natively)
 *   bun tests/run-tests.mjs foo         # filter by substring
 */

import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function loadTests() {
  const files = await readdir(here);
  // Sort for deterministic order — the streaming-regression test FIRST
  // (it's the key regression test, PRD §130).
  const sorted = files
    .filter((f) => f.endsWith(".test.mjs") && f !== "run-tests.mjs")
    .sort((a, b) => {
      if (a.startsWith("streaming-regression")) return -1;
      if (b.startsWith("streaming-regression")) return 1;
      return a.localeCompare(b);
    });
  const tests = [];
  for (const f of sorted) {
    const path = join(here, f);
    const mod = await import(`file://${path}`);
    const runner = mod.run ?? mod.default;
    if (typeof runner !== "function") {
      throw new Error(`${f} exports neither \`run\` nor a default async function`);
    }
    const name = f.replace(/\.test\.mjs$/, "");
    tests.push({ name, file: f, run: runner });
  }
  return tests;
}

async function main() {
  const filter = process.argv.slice(2).find((a) => !a.startsWith("-"));
  let tests = await loadTests();
  if (filter) {
    tests = tests.filter((t) => t.name.includes(filter) || t.file.includes(filter));
    if (tests.length === 0) {
      console.error(`No tests matched filter "${filter}"`);
      process.exit(1);
    }
  }

  console.log("=".repeat(72));
  console.log(`Running ${tests.length} test${tests.length === 1 ? "" : "s"} (bun runtime)`);
  console.log("=".repeat(72));

  const results = [];
  let pass = 0;
  let fail = 0;

  for (const t of tests) {
    const start = Date.now();
    let status = "PASS";
    let errMsg = "";
    let stdout = "";
    let stderr = "";
    // Capture stdout/stderr during the test so the summary table stays clean.
    const origLog = console.log;
    const origErr = console.error;
    const origWarn = console.warn;
    console.log = (...args) => { stdout += args.map(String).join(" ") + "\n"; };
    console.error = (...args) => { stderr += args.map(String).join(" ") + "\n"; };
    console.warn = (...args) => { stderr += args.map(String).join(" ") + "\n"; };
    try {
      await t.run();
    } catch (err) {
      status = "FAIL";
      errMsg = err && err.message ? err.message.split("\n")[0] : String(err);
    } finally {
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
    }
    const dur = Date.now() - start;
    if (status === "PASS") pass++;
    else fail++;
    results.push({ name: t.name, status, dur, errMsg, stdout, stderr });
  }

  // Print per-test captured output (so individual test logs surface).
  for (const r of results) {
    if (r.stdout || r.stderr) {
      console.log(`\n--- ${r.name} output ---`);
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
    }
  }

  // Summary table (PRD §76 style).
  console.log("\n" + "=".repeat(72));
  console.log("Test Summary");
  console.log("=".repeat(72));
  const nameWidth = Math.max(8, ...results.map((r) => r.name.length));
  const statusWidth = 6;
  const durWidth = 10;
  const header =
    `TEST`.padEnd(nameWidth) +
    "  " + "RESULT".padEnd(statusWidth) +
    "  " + "DURATION".padEnd(durWidth);
  console.log(header);
  console.log("-".repeat(nameWidth + statusWidth + durWidth + 4));
  for (const r of results) {
    const row =
      r.name.padEnd(nameWidth) +
      "  " + (r.status === "PASS" ? "PASS".padEnd(statusWidth) : "FAIL".padEnd(statusWidth)) +
      "  " + fmtDuration(r.dur).padEnd(durWidth);
    console.log(row);
    if (r.status === "FAIL" && r.errMsg) {
      console.log("    → " + r.errMsg);
    }
  }
  console.log("-".repeat(nameWidth + statusWidth + durWidth + 4));
  console.log(
    `Total: ${results.length}   PASS: ${pass}   FAIL: ${fail}` +
    `   (${fmtDuration(results.reduce((s, r) => s + r.dur, 0))})`,
  );
  console.log("=".repeat(72));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
