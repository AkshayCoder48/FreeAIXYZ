/**
 * POST /api/tools/execute — built-in tool executor (Tool PRD §7, §24, §25).
 *
 * Executes a registry tool server-side on behalf of the playground's
 * tool-calling loop. The registry pairs every model-facing definition
 * with an application-side executor — a tool the model can see ALWAYS
 * has an executor here.
 *
 * Body:   { "name": "web_search", "arguments": { "query": "..." } }
 * Reply:  { "ok": true,  "result": <payload>, "durationMs": 12, "chars": 340, "truncated": false }
 *      or { "ok": false, "error": "...", "durationMs": 4 }
 *
 * Errors are STRUCTURED, never thrown as blank 500s (PRD §22, §25):
 *   - unknown tool / bad arguments → HTTP 400
 *   - execution failure            → HTTP 200 { ok:false, error } (the
 *     result still flows back to the MODEL as a tool message so the
 *     generation can continue instead of crashing the whole turn).
 */

import { NextResponse } from "next/server";
import {
  clampToolResult,
  executeRegisteredTool,
  hasToolExecutor,
} from "@/lib/tools/registry";
import { toolDiagnostics } from "@/lib/tools/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: { name?: unknown; arguments?: unknown } | undefined;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: { type: "INVALID_REQUEST", message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const name = body?.name;
  if (typeof name !== "string" || name.length === 0) {
    return NextResponse.json(
      {
        error: {
          type: "INVALID_REQUEST",
          message: '"name" is required and must be a string.',
        },
      },
      { status: 400 },
    );
  }
  if (!hasToolExecutor(name)) {
    return NextResponse.json(
      {
        error: {
          type: "TOOL_SCHEMA_INVALID",
          message: `Unknown tool "${name}". No executor is registered for it.`,
        },
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const raw = await executeRegisteredTool(
      name,
      body?.arguments,
      request.signal,
    );
    const durationMs = Date.now() - startedAt;
    const { result, truncated, chars } = clampToolResult(name, raw);
    toolDiagnostics.record({
      id: `exec-${name}-${startedAt}`,
      kind: "execution",
      at: new Date().toISOString(),
      execution: {
        name,
        ok: true,
        ms: durationMs,
        resultChars: chars,
        truncated,
      },
    });
    return NextResponse.json({
      ok: true,
      result,
      durationMs,
      chars,
      truncated,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    toolDiagnostics.record({
      id: `exec-${name}-${startedAt}`,
      kind: "execution",
      at: new Date().toISOString(),
      execution: {
        name,
        ok: false,
        ms: durationMs,
        resultChars: 0,
        truncated: false,
        error: message.slice(0, 200),
      },
    });
    // Execution failure → structured error result. HTTP 200 so the client's
    // tool loop can still return SOMETHING to the model (PRD §25: structured
    // errors instead of crashing the generation).
    return NextResponse.json({
      ok: false,
      error: message.slice(0, 500),
      durationMs,
    });
  }
}
