/**
 * BYOK generation forwarding — image / audio / video.
 *
 * Routes OpenAI-compatible generation requests to the upstream Gratisfy
 * BYOK endpoint (`https://api.gratisfy.xyz/v1/{images|audio|videos}/…`)
 * using the user's Gratisfy key from the request header (PRIVACY-MODE —
 * the server never persists the key).
 *
 * The model id arriving here is the public canonical id, e.g.
 * `gratisfy:cloudflare:@cf/meta/llama-image-…`. We split it into
 * (source, provider, upstreamId) and reconstruct the prefixed upstream
 * model id (`cloudflare/@cf/meta/llama-image-…`) that Gratisfy's upstream
 * generation endpoints expect (same convention as the chat route — see
 * `buildUpstreamModelId` in byok-route.ts and the gratisfy-prices-routing-fix-1
 * worklog entry).
 *
 * POLLINATIONS POLLEN GATE (user directive: "pollen models required
 * pollination connection"): pollen-denominated models additionally require
 * the X-Pollinations-API-Key header so the gateway can attribute pollen
 * usage to the user's wallet.
 */

import { GRATISFY_BASE_URL } from "./gratisfy";

export interface ByokGenContext {
  /** Public canonical model id, e.g. "gratisfy:cloudflare:@cf/...". */
  modelId: string;
  /** The BYOK key from the request header (X-Gratisfy-API-Key). */
  apiKey: string;
  /** Optional Pollinations token (X-Pollinations-API-Key) for pollen gate. */
  pollinationsToken?: string;
  /** Upstream Gratisfy endpoint path, e.g. "/images/generations". */
  upstreamPath: string;
  /** JSON body to POST upstream (caller fills model + generation params). */
  body: Record<string, unknown>;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

/** Parse a public canonical id into (source, provider, upstreamId). */
export function parseByokModelId(
  id: string,
): { source: string; provider: string; model: string } | null {
  const parts = id.split(":");
  if (parts.length < 3) return null;
  const source = parts[0]!;
  const provider = parts[1]!;
  const model = parts.slice(2).join(":");
  if (!source || !provider || !model) return null;
  return { source, provider, model };
}

/** Reconstruct the prefixed upstream model id the Gratisfy API expects. */
export function buildUpstreamModelId(provider: string, upstreamId: string): string {
  const p = (provider ?? "").trim();
  const u = (upstreamId ?? "").trim();
  if (!p || !u) return u || p;
  if (u.startsWith(`${p}/`)) return u;
  return `${p}/${u}`;
}

/**
 * Forward a generation request to the upstream Gratisfy BYOK endpoint.
 * Returns the raw upstream Response so the caller can stream / parse as
 * appropriate for the modality (image = JSON, audio = binary, video = JSON).
 */
export async function forwardByokGeneration(
  ctx: ByokGenContext,
): Promise<Response> {
  const parsed = parseByokModelId(ctx.modelId);
  if (!parsed || parsed.source !== "gratisfy") {
    return new Response(
      JSON.stringify({
        error: {
          type: "invalid_request",
          message: `Model "${ctx.modelId}" is not a Gratisfy BYOK model. Generation endpoints only route to gratisfy-source models.`,
        },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  if (!ctx.apiKey) {
    return new Response(
      JSON.stringify({
        error: {
          type: "authentication",
          message: "A Gratisfy BYOK key is required (X-Gratisfy-API-Key header). Connect yours on the Providers page.",
        },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  const upstreamModel = buildUpstreamModelId(parsed.provider, parsed.model);
  const upstreamBody = { ...ctx.body, model: upstreamModel };
  const upstreamUrl = `${GRATISFY_BASE_URL}${ctx.upstreamPath}`;
  const upstreamRes = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(upstreamBody),
    signal: ctx.signal,
  });
  // Return the upstream response directly (stream-through). The caller
  // decides how to consume it (JSON for images/videos, binary for audio).
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
    },
  });
}
