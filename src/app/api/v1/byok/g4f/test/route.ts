/**
 * POST /api/v1/byok/g4f/test — validate a G4F key (PRD §63, §54).
 * Body `{ key?: string }`. ANONYMOUS BROWSER MODE (X-Browser-Id header).
 * If `key` provided, test THAT; else test the stored key.
 */

import { loadBrowserByokKey, setBrowserByokValidation } from "@/lib/xyz";
import { validateG4fKey } from "@/lib/xyz/g4f";
import { getBrowserId } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const browserId = getBrowserId(request);
  if (browserId === "anonymous") {
    return Response.json(
      {
        ok: false,
        error: "Browser ID is required. Send it as the X-Browser-Id header.",
      },
      { status: 400 },
    );
  }
  let body: { key?: string } = {};
  try {
    body = (await request.json()) as { key?: string };
  } catch {
    // empty body is fine — fall through to stored key
  }
  const bodyKey = (body.key ?? "").trim();
  const stored = (await loadBrowserByokKey(browserId, "g4f")) ?? "";
  const key = bodyKey || stored;
  if (!key) {
    return Response.json(
      { ok: false, error: "No key to test. Save a key first." },
      { status: 400 },
    );
  }
  const result = await validateG4fKey(key);
  await setBrowserByokValidation(browserId, "g4f", result.ok);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
