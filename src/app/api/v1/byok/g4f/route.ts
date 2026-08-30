/**
 * POST   /api/v1/byok/g4f — save (masked) BYOK key, validate (PRD §18, §54, §82).
 * DELETE /api/v1/byok/g4f — remove the key.
 *
 * ANONYMOUS BROWSER MODE: uses `X-Browser-Id` header + OnyxBase storage.
 * No sign-in required. Never returns the raw key.
 *
 * PRD §82 — never show "Connected" unless the provider credential was
 * actually validated against the upstream.
 */

import {
  saveBrowserByok,
  removeBrowserByok,
} from "@/lib/xyz";
import { validateG4fKey } from "@/lib/xyz/g4f";
import { setBrowserByokValidation } from "@/lib/xyz/byok";
import { getBrowserId } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const browserId = getBrowserId(request);
  if (browserId === "anonymous") {
    return Response.json(
      {
        error: {
          type: "invalid_request_error",
          code: "MISSING_BROWSER_ID",
          message: "Browser ID is required. Send it as the X-Browser-Id header.",
        },
      },
      { status: 400 },
    );
  }
  try {
    const body = (await request.json()) as { key?: string };
    const key = (body.key ?? "").trim();
    if (!key) {
      return Response.json(
        { error: { type: "invalid_request_error", code: "EMPTY_KEY", message: "API key is required." } },
        { status: 400 },
      );
    }

    // Save first (encrypted) — we'll update validation state next.
    const meta = await saveBrowserByok(browserId, "g4f", key);

    // Validate against the upstream (PRD §82 — no fake "Connected").
    const validation = await validateG4fKey(key);
    await setBrowserByokValidation(
      browserId,
      "g4f",
      validation.ok,
      validation.ok ? undefined : validation.error,
    );

    if (!validation.ok) {
      return Response.json(
        {
          ok: false,
          error: validation.error ?? "Validation failed",
          meta,
        },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      meta,
      validation: { ok: true, modelCount: validation.modelCount ?? 0 },
      modelsDiscovered: validation.modelCount ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request.";
    return Response.json(
      { error: { type: "invalid_request_error", code: "BAD_REQUEST", message } },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const browserId = getBrowserId(request);
  if (browserId === "anonymous") {
    return Response.json(
      {
        error: {
          type: "invalid_request_error",
          code: "MISSING_BROWSER_ID",
          message: "Browser ID is required.",
        },
      },
      { status: 400 },
    );
  }
  await removeBrowserByok(browserId, "g4f");
  return Response.json({ ok: true });
}
