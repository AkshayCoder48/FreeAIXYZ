/**
 * POST /api/sync/refresh — trigger provider discovery sync (Task 11-backend, PRD §8, §47).
 *
 * Body (optional):
 *   { provider?: string }   — limit sync to one provider id (or short id)
 *
 * Without a `provider` field: runs `syncAll()` across every enabled
 * provider in parallel (per-provider timeout, removal safety, retries).
 * With a `provider` field: runs `syncProvider(providerId)` only.
 *
 * Returns a `FullSyncResult` (or single-provider `SyncResult`) with counts
 * of added / updated / removed / free models — PRD §8.
 *
 * Runs server-side (z-ai-web-dev-sdk and provider fetches happen here,
 * not in the browser — PRD §47).
 */

import { ensureGateway } from "@/lib/gateway/route-helpers";
import { ensureProvidersRegistered, getAdapter, syncAll, syncProvider } from "@/providers";
import { getProviderConfig } from "@/providers/config";
import { getByShortId } from "@/lib/gateway/ids";
import type { FullSyncResult, SyncResult } from "@/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RefreshBody {
  provider?: string;
}

function resolveProviderId(arg: string): string | undefined {
  // Direct match → done.
  if (getAdapter(arg)) return arg;
  // Try short-id resolution (e.g. "sw" → "spicywriter").
  const entry = getByShortId(arg);
  if (entry) return entry.id;
  return undefined;
}

/** POST /api/sync/refresh. */
export async function POST(request: Request) {
  await ensureGateway();
  ensureProvidersRegistered();

  let body: RefreshBody = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as RefreshBody;
  } catch {
    // empty/invalid body → defaults to syncAll
  }

  const providerArg = body.provider?.trim();
  if (providerArg) {
    const providerId = resolveProviderId(providerArg);
    if (!providerId) {
      return Response.json(
        {
          ok: false,
          error: `Unknown provider "${providerArg}". Try one of: po, kc, l7, oc, sw, sm, vx, go, au, ss, jg, ua, fc, mk, fx, fg, tb.`,
        },
        { status: 404 },
      );
    }
    const cfg = getProviderConfig(providerId);
    if (!cfg.enabled) {
      return Response.json(
        { ok: false, error: `Provider "${providerId}" is disabled.` },
        { status: 503 },
      );
    }
    const result = await syncProvider(providerId);
    const payload: { ok: true; result: SyncResult } = {
      ok: true,
      result,
    };
    return Response.json(payload);
  }

  const result: FullSyncResult = await syncAll();
  return Response.json({ ok: true, result });
}

/** GET /api/sync/refresh — quick health check. */
export async function GET() {
  await ensureGateway();
  ensureProvidersRegistered();
  return Response.json({
    ok: true,
    message: "POST { provider?: 'po|kc|l7|oc|sw|sm|vx|go|au|ss|jg|ua|fc|mk|fx|fg|tb' } to trigger sync.",
  });
}
