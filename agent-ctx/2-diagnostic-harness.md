# Task ID 2 — Diagnostic Harness

> Cross-reference: full work record appended to `/home/z/my-project/worklog.md` under "Task ID: 2 / Agent: diagnostic-harness".

## Files
- `scripts/provider-diagnose.mjs` (NEW, ~830 LOC) — 10-run standalone Node-only diagnostic harness.
- `src/app/api/debug/provider/route.ts` (NEW, ~620 LOC) — `GET /api/debug/provider` live dashboard route.
- `package.json` — added `"diagnose": "node scripts/provider-diagnose.mjs"`.

## Command
```bash
node scripts/provider-diagnose.mjs --provider kilocode --model kc/kilo-auto/free --runs 10 --target both
```

## Lint
- 0 errors in my 2 files.
- 5 pre-existing errors in untouched server files (`freeaixyz-proxy/route.ts`, `freegpt-signer.cjs`, `freegpt-wasm.js` — all `@typescript-eslint/no-require-imports`).

## Smoke test sample
Two runs against prod gateway, Test A "Hello", both succeeded: 5 SSE events each, content-type `text/event-stream`, finish_reason=stop + `[DONE]`. Regression status: PASS (no leak observed in non-tool test).
