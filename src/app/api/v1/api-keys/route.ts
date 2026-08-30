/**
 * FreeAIXYZ API key management (PRD §12).
 *
 * POST   /api/v1/api-keys        — create a new key (returns full key ONCE)
 * GET    /api/v1/api-keys        — list all keys for the authenticated user (masked)
 * DELETE /api/v1/api-keys/{id}  — revoke a key (see [id]/route.ts)
 */

import { NextRequest } from "next/server";
import {
  createApiKey,
  listApiKeys,
} from "@/lib/xyz/api-keys";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  const keys = await listApiKeys(auth.userId);
  return Response.json({ keys });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;

  let body: { name?: string; scopes?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // fall through with empty body — defaults will be used
  }
  const name = (body.name ?? "default").trim().slice(0, 64);
  const scopes = Array.isArray(body.scopes) && body.scopes.length
    ? body.scopes.filter((s) => typeof s === "string").map((s) => s.trim()).slice(0, 16)
    : ["chat", "models"];

  const created = await createApiKey(auth.userId, name, scopes);
  return Response.json({ key: created }, { status: 201 });
}
