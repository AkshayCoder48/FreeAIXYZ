/**
 * GET /api/debug/tools — tool pipeline diagnostics (Tool PRD §19, §27).
 *
 * Dumps the recorded tool lifecycle traces (newest first):
 *   request   — a chat request carrying tools hit the gateway
 *   forward   — the §20 forwarding assertion result per provider payload
 *   stream    — the streaming parser detected tool_calls upstream
 *   execution — a registry tool executed via /api/tools/execute
 *   final     — the generation finished
 *
 * SAFETY (PRD §19): traces contain tool NAMES, counts, booleans and byte
 * sizes only — never arguments, results, credentials, or headers.
 */

import { NextResponse } from "next/server";
import { toolDiagnostics } from "@/lib/tools/diagnostics";
import { BUILTIN_TOOL_DEFINITIONS } from "@/lib/tools/definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    registry: BUILTIN_TOOL_DEFINITIONS.map((t) => t.function.name),
    traces: toolDiagnostics.list(),
  });
}
