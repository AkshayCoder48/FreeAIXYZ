#!/usr/bin/env node
/**
 * FreeAIXYZ — auto model fetch script.
 *
 * Fetches the LIVE model list from any FreeAIXYZ gateway (defaults to the
 * production deployment) and writes it to a normalized, diff-friendly
 * `models.json`. Run it whenever you want your app's model registry to
 * mirror what the gateway currently serves — new models appear automatically,
 * delisted models disappear, capability flags stay honest.
 *
 * USAGE
 *   node scripts/fetch-models.mjs
 *   node scripts/fetch-models.mjs --url http://localhost:3000
 *   node scripts/fetch-models.mjs --out src/lib/models.json
 *   node scripts/fetch-models.mjs --capabilities          # tools/streaming only filter
 *   node scripts/fetch-models.mjs --provider tb           # single provider
 *   node scripts/fetch-models.mjs --format ids            # print bare ids only
 *
 * FLAGS
 *   --url <base>       Gateway base URL. Accepts ANY convention:
 *                      bare domain, .../v1, .../api/v1 — all resolve.
 *                      (default: https://freeaixyz4all.vercel.app)
 *   --out <file>       Output JSON file (default: models.json, use
 *                      --out - for stdout only, nothing written)
 *   --health           Ask for the extended health payload
 *                      (?health=true) and keep status/context window.
 *   --capabilities a,b Keep ONLY models whose capabilities array contains
 *                      every listed capability (e.g. "tools,streaming").
 *   --provider <id>    Keep only models from one provider prefix (e.g. tb).
 *   --format <mode>    table (default) | ids | json | count
 *
 * EXIT CODES
 *   0 success · 1 fetch/network failure · 2 unexpected payload shape
 *
 * CI tip: commit the script, run it in CI, and open a PR when the model list
 * drifts — the normalized output is sorted + stable so `git diff` is minimal.
 */

import { writeFileSync } from "node:fs";

const DEFAULT_URL = "https://freeaixyz4all.vercel.app";

// ─── tiny arg parser ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" || a === "--out" || a === "--capabilities" ||
        a === "--provider" || a === "--format") {
      out[a] = argv[++i];
    } else if (a === "--health") {
      out[a] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// ─── resolve the models endpoint from ANY base-url convention ───────────────
function modelsEndpoint(base) {
  let b = String(base || DEFAULT_URL).trim().replace(/\/+$/, "");
  // Accept: bare domain, /v1, /api, /api/v1 — normalize to the canonical route.
  b = b
    .replace(/\/v1$/i, "")
    .replace(/\/api$/i, "")
    .replace(/\/v1$/i, "");
  return `${b}/api/v1/models`;
}

// ─── fetch with one transient retry ─────────────────────────────────────────
async function fetchModels(endpoint, withHealth) {
  const url = withHealth ? `${endpoint}?health=true` : endpoint;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
      }
      const json = await res.json();
      if (json?.object !== "list" || !Array.isArray(json?.data)) {
        throw new Error(
          `Unexpected payload (expected OpenAI-style {object:"list", data:[…]}). ` +
            `Got keys: ${Object.keys(json ?? {}).join(", ")}`,
        );
      }
      return json;
    } catch (err) {
      lastErr = err;
      const transient =
        err instanceof Error &&
        /fetch failed|network|timeout|timed out|ECONN|HTTP 5\d\d/i.test(err.message);
      if (!transient || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const endpoint = modelsEndpoint(args["--url"] ?? DEFAULT_URL);
  const withHealth = args["--health"] === true;

  let payload;
  try {
    payload = await fetchModels(endpoint, withHealth);
  } catch (err) {
    console.error(`✗ model fetch failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  let models = payload.data ?? [];

  // capability filter
  const capFilter = args["--capabilities"];
  if (capFilter) {
    const wanted = String(capFilter)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    models = models.filter((m) => {
      const caps = (m.capabilities ?? []).map((c) => String(c).toLowerCase());
      return wanted.every((w) => caps.includes(w));
    });
  }

  // provider filter (by id prefix or owned_by name)
  const provFilter = args["--provider"];
  if (provFilter) {
    const p = String(provFilter).toLowerCase();
    models = models.filter(
      (m) =>
        String(m.id).toLowerCase().startsWith(`${p}/`) ||
        String(m.owned_by ?? "").toLowerCase().includes(p),
    );
  }

  // sort for stable diffs
  models = [...models].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const normalized = {
    $schema: "https://freeaixyz4all.vercel.app/api/v1/models",
    generatedAt: new Date().toISOString(),
    source: endpoint,
    count: models.length,
    models: models.map((m) => {
      const entry = {
        id: m.id,
        object: "model",
        created: m.created,
        owned_by: m.owned_by,
        capabilities: m.capabilities ?? [],
      };
      if (withHealth) {
        entry.status = m.status ?? null;
        entry.context_window = m.context_window ?? null;
      }
      return entry;
    }),
  };

  // output
  const format = args["--format"] ?? "table";
  if (format === "ids") {
    for (const m of normalized.models) console.log(m.id);
  } else if (format === "count") {
    console.log(normalized.count);
  } else if (format === "json") {
    console.log(JSON.stringify(normalized, null, 2));
  } else {
    console.log(`\n  FreeAIXYZ model fetch — ${normalized.source}`);
    console.log(`  ${normalized.count} models · generated ${normalized.generatedAt}\n`);
    const byProvider = new Map();
    for (const m of normalized.models) {
      byProvider.set(m.owned_by, (byProvider.get(m.owned_by) ?? 0) + 1);
    }
    for (const [p, c] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(c).padStart(3)}  ${p}`);
    }
    const tools = normalized.models.filter((m) => m.capabilities.includes("tools"));
    const streaming = normalized.models.filter((m) => m.capabilities.includes("streaming"));
    console.log(`\n  tools: ${tools.length} · streaming: ${streaming.length} · both: ${
      normalized.models.filter((m) => m.capabilities.includes("tools") && m.capabilities.includes("streaming")).length
    }`);
    console.log(`\n  sample ids:`);
    for (const m of normalized.models.slice(0, 10)) console.log(`    ${m.id}`);
    if (normalized.count > 10) console.log(`    … +${normalized.count - 10} more (use --format ids)\n`);
    else console.log();
  }

  // write file
  const out = args["--out"] ?? "models.json";
  if (out && out !== "-") {
    writeFileSync(out, JSON.stringify(normalized, null, 2) + "\n");
    console.error(`✓ wrote ${out} (${normalized.count} models)`);
  }
}

main().catch((err) => {
  console.error(`✗ unexpected failure: ${err?.message ?? err}`);
  process.exit(2);
});
