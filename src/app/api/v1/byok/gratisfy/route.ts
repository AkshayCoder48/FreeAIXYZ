/**
 * POST   /api/v1/byok/gratisfy — save (masked) BYOK key, validate, and trigger
 *         dynamic model discovery (PRD §16, §17, §24, §54, §82).
 * DELETE /api/v1/byok/gratisfy — remove the key.
 *
 * ANONYMOUS BROWSER MODE (no sign-in required):
 *   The browser sends an `X-Browser-Id` header (a random UUID stored in
 *   localStorage). We use it as the key for OnyxBase-backed credential
 *   storage. If the header is missing, we return 400 asking the caller to
 *   generate one.
 *
 * Never returns the raw key. Marks validation state on the stored
 * credential (PRD §82 — never show "Connected" unless the provider
 * credential was actually validated against the upstream).
 */

import {
  saveBrowserByok,
  removeBrowserByok,
} from "@/lib/xyz";
import { validateGratisfyKey } from "@/lib/xyz/gratisfy";
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
          message:
            "Browser ID is required. Generate one client-side and send it as the X-Browser-Id header.",
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
    const meta = await saveBrowserByok(browserId, "gratisfy", key);

    // Validate against the upstream (PRD §82 — no fake "Connected").
    const validation = await validateGratisfyKey(key);
    await setBrowserByokValidation(
      browserId,
      "gratisfy",
      validation.ok,
      validation.ok ? undefined : validation.error,
    );

    if (!validation.ok) {
      // Key saved but invalid — return early.
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
  await removeBrowserByok(browserId, "gratisfy");
  return Response.json({ ok: true });
}
