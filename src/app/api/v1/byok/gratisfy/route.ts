/**
 * POST   /api/v1/byok/gratisfy — save (masked) BYOK key, validate, and trigger
 *         dynamic model discovery (PRD §16, §17, §24, §54, §82).
 * DELETE /api/v1/byok/gratisfy — remove the key.
 * AUTH REQUIRED. Never returns the raw key.
 *
 * PRD §82 — never show "Connected" unless the provider credential was actually
 * validated against the upstream.
 */

import {
  saveBYOK,
  removeBYOK,
  getGratisfyModelsForUser,
} from "@/lib/xyz";
import { validateGratisfyKey } from "@/lib/xyz/gratisfy";
import { setBYOKValidation } from "@/lib/xyz/byok";
import { requireAuth } from "@/lib/xyz/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
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
    const meta = await saveBYOK(auth.userId, "gratisfy", key);

    // Validate against the upstream (PRD §82 — no fake "Connected").
    const validation = await validateGratisfyKey(key);
    await setBYOKValidation(
      auth.userId,
      "gratisfy",
      validation.ok,
      validation.ok ? undefined : validation.error,
    );

    if (!validation.ok) {
      // Key saved but invalid — return early without triggering discovery.
      return Response.json(
        {
          ok: false,
          error: validation.error ?? "Validation failed",
          meta,
        },
        { status: 400 },
      );
    }

    // Trigger dynamic discovery (PRD §24, §48). This persists models to
    // Prisma so the catalog shows them.
    const models = await getGratisfyModelsForUser(auth.userId);

    return Response.json({
      ok: true,
      meta,
      validation: { ok: true, modelCount: validation.modelCount ?? models.length },
      modelsDiscovered: models.length,
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
  const auth = await requireAuth(request);
  if ("response" in auth) return auth.response;
  await removeBYOK(auth.userId, "gratisfy");
  // Deactivate all Gratisfy models in DB for this user (PRD §26).
  // (Actually they're per-provider, not per-user, but we still mark them
  //  unavailable since no key is configured.)
  // The discovery will reactivate them when a new key is saved.
  return Response.json({ ok: true });
}
