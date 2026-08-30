/**
 * Message-content normalization (the "image is OPTIONAL, never mandatory" fix).
 *
 * ─── ROOT CAUSE (reproduced 2026-08-27 against https://api.llm7.io) ───────────
 *
 * Several upstream providers reject — with HTTP 400
 *   {"error":{"message":"Model 'X' does not support vision input.",
 *    "type":"invalid_request_error","code":"unsupported_model_feature"}}
 * — ANY request whose `messages[].content` is an ARRAY containing an
 * `image_url` part, EVEN when that image_url is empty/null/phantom.
 *
 * Verified with two cURL probes against LLM7.io `codestral-latest`:
 *   - TEST A  (string content)              → 200 OK ✓
 *   - TEST B  (array content + image_url:{url:""}) → 400 ✗ (exact user error)
 *
 * The OpenAI Chat Completions spec lets `content` be EITHER a plain string
 * OR an array of typed parts (`{type:"text",text}` / `{type:"image_url",...}`).
 * Many SDKs and UIs always send the array form, appending an empty image_url
 * part even when the user attached no image. For non-vision upstreams that is
 * a hard 400.
 *
 * ─── CONTRACT ───────────────────────────────────────────────────────────────
 *
 * The gateway MUST normalize every incoming message to PLAIN STRING content
 * for non-vision models, and only ever surface image attachments (as a text
 * annotation `[image attached xN]`) for models the catalog marks
 * vision-capable. Real image forwarding to vision upstreams is a separate,
 * future capability — the current gateway never forwards raw image bytes.
 *
 * This helper centralizes the contract so BOTH the canonical path
 * (`normalizeMessagesForGateway`) and the legacy path (`buildLegacyMessages`)
 * enforce it identically. Image input is OPTIONAL, never mandatory.
 */

/** A single OpenAI content-part (text or image_url). */
export interface OAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url?: string; detail?: string };
}

/** The full union of shapes `content` can take at runtime. */
export type OAIMessageContent = string | null | OAIContentPart[] | unknown;

/** Result of normalizing one message's content into the gateway contract. */
export interface NormalizedContent {
  /** Joined text from text-parts (or the raw string). Empty when nothing usable. */
  text: string;
  /** Number of `image_url` parts found (0 for plain strings). */
  imageCount: number;
  /** Whether the original content was array-form (i.e. carried parts). */
  wasArray: boolean;
}

/**
 * Normalize an OpenAI message `content` field into the gateway's string-only
 * contract. NEVER throws — malformed parts are silently skipped (the
 * caller's validation layer is responsible for surfacing structural errors).
 *
 * Behaviour:
 *   - string  → returned verbatim (imageCount=0, wasArray=false)
 *   - null    → "" (imageCount=0, wasArray=false)
 *   - array   → text parts joined with "\n" (empty parts dropped);
 *                image_url parts counted (NOT forwarded — see contract above);
 *                wasArray=true
 *   - other   → "" (defensive — unknown shapes produce empty text)
 */
export function normalizeMessageContent(
  content: OAIMessageContent,
): NormalizedContent {
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    let imageCount = 0;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      if (p.type === "text") {
        if (typeof p.text === "string" && p.text !== "") {
          textParts.push(p.text);
        }
      } else if (p.type === "image_url") {
        imageCount++;
      }
      // Unknown part types (audio, etc.) are dropped — the gateway's contract
      // is text-only today; forwarding them would 400 non-vision upstreams.
    }
    return {
      text: textParts.join("\n"),
      imageCount,
      wasArray: true,
    };
  }
  return {
    text: typeof content === "string" ? content : "",
    imageCount: 0,
    wasArray: false,
  };
}

/**
 * Build the `[image attached xN]` text annotation appended to vision-model
 * messages so the model is aware an image was attached (even though the raw
 * bytes are not forwarded — see contract above). Returns "" when no image.
 */
export function imageAnnotation(imageCount: number): string {
  return imageCount > 0 ? `\n[image attached x${imageCount}]` : "";
}
