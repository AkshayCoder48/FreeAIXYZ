/**
 * GET /api/v1/byok — PRIVACY-MODE: returns empty BYOK metadata.
 *
 * PRIVACY-MODE BYOK (2026-08-30): the user's private BYOK credentials
 * (Gratisfy gxyz-…, Pollinations token) live in their browser
 * localStorage. They are NEVER persisted server-side. So this endpoint
 * returns `{ connected: false }` for every provider — the client reads
 * the real state from localStorage on mount.
 *
 * The endpoint still requires a signed-in user so we know the caller is
 * authenticated (the ByokProviders UI only shows the BYOK cards after
 * sign-in; the client gates them too). Anonymous callers get a 401.
 */

import { requireAuth } from "@/lib/xyz/route-auth";
import type { BYOKCredentialMeta, BYOKProvider } from "@/lib/xyz/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: BYOKProvider[] = ["gratisfy", "pollinations"];

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;

  // Empty meta — the client populates this from localStorage on mount.
  const meta = {} as Record<BYOKProvider, BYOKCredentialMeta>;
  for (const p of PROVIDERS) {
    meta[p] = {
      provider: p,
      connected: false,
      masked: "",
      addedAt: "",
    };
  }
  return Response.json({ ok: true, meta });
}
