#!/usr/bin/env node
// scripts/test-models-10x.mjs
//
// Tests every model exposed by the FreeAIXYZ gateway (`/api/v1/models?health=true`)
// `--attempts` times (default 10) and records pass/fail counts. Models that
// fail every attempt are logged for the operator to decide whether to delist.
//
// Uses ONLY Node.js built-ins (fetch, AbortController, fs, path, url). No npm
// packages. Requires Node 18+ (native fetch + ReadableStream).
//
// Usage:
//   node scripts/test-models-10x.mjs
//   node scripts/test-models-10x.mjs --base-url=http://localhost:3000 \
//       --concurrency=5 --attempts=10 [--limit=0]
//   BASE_URL=http://localhost:3000 node scripts/test-models-10x.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, 'test-report.json');

// ---------------------------------------------------------------- CLI parsing
const DEFAULTS = {
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  concurrency: 5,
  attempts: 10,
  limit: 0, // 0 = no limit (test every model fetched)
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'base-url') opts.baseUrl = v.replace(/\/$/, '');
    else if (k === 'concurrency') opts.concurrency = Math.max(1, parseInt(v, 10) || 5);
    else if (k === 'attempts') opts.attempts = Math.max(1, parseInt(v, 10) || 10);
    else if (k === 'limit') opts.limit = Math.max(0, parseInt(v, 10) || 0);
  }
  return opts;
}

// --------------------------------------------------------------- shared state
const state = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  totalModels: 0,
  totalRequests: 0,
  results: [],
  aborted: false,
};

function writeReport(reason) {
  state.finishedAt = new Date().toISOString();
  const out = {
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalModels: state.totalModels,
    totalRequests: state.totalRequests,
    results: state.results,
  };
  if (reason) out.abortReason = reason;
  try {
    writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('[report] failed to write report:', e.message);
  }
}

let sigintReceived = false;
process.on('SIGINT', () => {
  if (sigintReceived) {
    // Second Ctrl-C: hard exit
    process.exit(130);
  }
  sigintReceived = true;
  state.aborted = true;
  console.error('\n[SIGINT] flushing partial report then exiting…');
  writeReport('SIGINT');
  // Give stdio a tick to flush, then exit.
  setTimeout(() => process.exit(130), 50).unref();
});

// ----------------------------------------------------------------- fetch models
async function fetchModels(baseUrl) {
  const url = `${baseUrl}/api/v1/models?health=true`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GET ${url} → HTTP ${resp.status} ${resp.statusText}${body ? ': ' + body.slice(0, 200) : ''}`);
  }
  const json = await resp.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  return data.filter((m) => m && typeof m.id === 'string' && m.id.length > 0);
}

// ----------------------------------------------------------------- single probe
const PROMPT = 'Reply with the single word hello.';
const TIMEOUT_MS = 30_000;
const MAX_ERR_LEN = 200;

function clamp(s) {
  if (s == null) return '(no message)';
  const str = String(s).replace(/\s+/g, ' ').trim();
  return str.length > MAX_ERR_LEN ? str.slice(0, MAX_ERR_LEN) : str;
}

// Parse one SSE `data:` payload line. Mutates ctx (sets gotContent, lastErr, doneSeen).
function handleDataLine(data, ctx) {
  if (!data) return;
  if (data === '[DONE]') {
    ctx.doneSeen = true;
    return;
  }
  let obj;
  try {
    obj = JSON.parse(data);
  } catch {
    // Non-JSON data line (e.g. upstream informational). Ignore.
    return;
  }
  try {
    const delta = obj?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) ctx.gotContent = true;
    if (obj.error) {
      const e = obj.error;
      const code = e.code || e.type || 'unknown';
      const msg = e.message || (typeof e === 'string' ? e : '');
      ctx.lastErr = clamp(`upstream error [${code}]${msg ? ': ' + msg : ''}`);
    }
  } catch {
    /* ignore */
  }
}

async function attemptModelOnce(baseUrl, modelId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const url = `${baseUrl}/api/v1/chat/completions`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: PROMPT }],
        stream: true,
        max_tokens: 50,
      }),
      signal: ctrl.signal,
    });

    if (resp.status >= 400) {
      let body = '';
      try { body = await resp.text(); } catch {}
      const errStr = clamp(`HTTP ${resp.status} ${resp.statusText || ''}${body ? ': ' + body : ''}`);
      return { pass: false, error: errStr };
    }

    if (!resp.body) {
      return { pass: false, error: 'no response body (stream unavailable)' };
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    const ctx = { gotContent: false, lastErr: null, doneSeen: false };

    const processBuffer = (final) => {
      while (true) {
        const nl = buf.indexOf('\n');
        if (nl < 0) {
          if (final && buf.trim()) {
            const line = buf.replace(/\r$/, '').trim();
            if (line.startsWith('data:')) handleDataLine(line.slice(5).trim(), ctx);
            buf = '';
          }
          break;
        }
        const line = buf.slice(0, nl).replace(/\r$/, '').trim();
        buf = buf.slice(nl + 1);
        if (!line || line.startsWith(':')) continue; // SSE comment / heartbeat
        if (line.startsWith('data:')) {
          handleDataLine(line.slice(5).trim(), ctx);
        }
        // Ignore non-data SSE field lines (event:, id:, retry:).
      }
    };

    // Read the SSE stream. Break out as soon as we see [DONE] so the gateway
    // (which keeps the underlying HTTP body open after emitting [DONE]) can't
    // keep us hanging until the 30s timeout fires.
    while (true) {
      let read;
      try {
        read = await reader.read();
      } catch (e) {
        if (e?.name === 'AbortError') break;
        throw e;
      }
      const { value, done } = read;
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      processBuffer(false);
      if (ctx.doneSeen) {
        // [DONE] sentinel received — release the reader and stop reading.
        try { await reader.cancel(); } catch {}
        break;
      }
    }
    if (!ctx.doneSeen) {
      buf += decoder.decode(); // flush decoder
      processBuffer(true);
    }

    if (ctx.gotContent) return { pass: true };
    return { pass: false, error: ctx.lastErr || 'no content delta before stream ended' };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { pass: false, error: `timeout after ${TIMEOUT_MS / 1000}s` };
    }
    const msg = e?.message ? `${e.name}: ${e.message}` : String(e || 'unknown error');
    return { pass: false, error: clamp(msg) };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------- per-model test sequence
async function testModel(opts, model, idx, total) {
  const modelId = model.id;
  let passCount = 0;
  let failCount = 0;
  const errSet = new Set();

  for (let i = 0; i < opts.attempts; i++) {
    if (state.aborted) break;
    const res = await attemptModelOnce(opts.baseUrl, modelId);
    state.totalRequests++;
    if (res.pass) {
      passCount++;
    } else {
      failCount++;
      if (errSet.size < 3 && res.error) errSet.add(clamp(res.error));
    }
  }

  const result = {
    modelId,
    ownedBy: model.owned_by || null,
    passCount,
    failCount,
    errorSamples: [...errSet],
  };
  state.results.push(result);

  const label = failCount === opts.attempts
    ? 'FAIL'
    : passCount > failCount
      ? 'PASS'
      : 'FAIL';
  const idPad = modelId.length > 40 ? modelId.slice(0, 37) + '...' : modelId.padEnd(40);
  console.log(`[${String(idx).padStart(3)}/${total}] ${idPad} ... ${label} ${passCount}/${opts.attempts}`);
  return result;
}

// ----------------------------------------------------------- bounded concurrency
async function runPool(items, limit, worker) {
  let cursor = 0;
  const total = items.length;
  async function spawn() {
    while (!state.aborted) {
      const idx = cursor++;
      if (idx >= total) return;
      try {
        await worker(items[idx], idx + 1, total);
      } catch (e) {
        // Defensive: worker shouldn't throw, but never let one failure
        // tear down the whole pool.
        console.error(
          `[runPool] worker threw for ${items[idx]?.id || '?'}: ${e?.message || e}`
        );
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(limit, items.length) || 1 },
    () => spawn()
  );
  await Promise.all(workers);
}

// ------------------------------------------------------------- progress heartbeat
function startHeartbeat(total, opts) {
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (state.aborted) return;
    const done = state.results.length;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const rate = done > 0 ? (state.totalRequests / ((Date.now() - t0) / 1000)).toFixed(1) : '0';
    process.stdout.write(
      `\r… ${done}/${total} models, ${state.totalRequests}/${total * opts.attempts} reqs, ${elapsed}s @ ${rate} req/s   `
    );
  }, 2000).unref();
  return () => clearInterval(tick);
}

// ------------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv);
  console.log(
    `# test-models-10x → ${opts.baseUrl}  (concurrency=${opts.concurrency}, attempts=${opts.attempts}${opts.limit ? ', limit=' + opts.limit : ''})`
  );

  let models;
  try {
    models = await fetchModels(opts.baseUrl);
  } catch (e) {
    console.error(`fatal: could not fetch model list: ${e.message}`);
    writeReport('fatal: ' + e.message);
    process.exit(1);
  }
  if (opts.limit > 0) models = models.slice(0, opts.limit);
  state.totalModels = models.length;
  console.log(`# fetched ${models.length} models — starting probes…`);

  const stopHB = startHeartbeat(models.length, opts);
  await runPool(models, opts.concurrency, (m, idx, total) => testModel(opts, m, idx, total));
  stopHB();
  process.stdout.write('\r' + ' '.repeat(80) + '\r'); // clear heartbeat line

  writeReport(null);

  // ------------------------------------------------------------ summary
  const passTotal = state.results.reduce((a, r) => a + r.passCount, 0);
  const failTotal = state.results.reduce((a, r) => a + r.failCount, 0);
  const dead = state.results.filter((r) => r.failCount === opts.attempts);
  const allPass = state.results.filter((r) => r.passCount === opts.attempts);

  console.log('─'.repeat(72));
  console.log(
    `totalModels=${state.totalModels}  totalRequests=${state.totalRequests}  ` +
    `pass=${passTotal}  fail=${failTotal}`
  );
  console.log(
    `models fully passing (${opts.attempts}/${opts.attempts}): ${allPass.length}   ` +
    `models fully failing (${opts.attempts}/${opts.attempts}): ${dead.length}`
  );
  if (dead.length) {
    console.log(`\nModels that failed ${opts.attempts}/${opts.attempts} (operator decides whether to delist):`);
    for (const d of dead) {
      const errs = d.errorSamples.length ? d.errorSamples.join(' | ') : '(no error samples)';
      console.log(`  ${d.modelId}  →  ${errs}`);
    }
  }
  console.log(`\nreport → ${REPORT_PATH}`);
  if (state.aborted) console.log('(run was aborted — report contains partial results)');
}

main().catch((e) => {
  console.error('fatal:', e?.stack || e?.message || String(e));
  writeReport('fatal: ' + (e?.message || String(e)));
  process.exit(1);
});
