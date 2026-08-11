/**
 * Direct Chat Stream & Context API Route.
 *
 * Implements the genuine UnlimitedAI chat protocol with:
 *   - Self-healing live nonce synchronization
 *   - Context tracking via standardized UUID validations
 *   - Streaming EventSource pipeline forwarding
 *   - Web search grounding
 *   - Vision (image) inputs
 *   - Multi-turn conversation with context retention
 *
 * Endpoint: POST /api/chat
 *
 * Body: {
 *   model_key: "chatgpt"|"gemini"|"deepseek"|"claude"|"grok"|"perplexity"|"meta"|"qwen",
 *   prompt: string,
 *   image_inputs?: Array<{type:"image_url",image_url:{url:string}}>,
 *   web_search_active?: boolean,
 *   conversation_uuid?: string,
 *   session_id?: string,
 *   previous_openai_response_id?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Local memory cache for parsed nonces to reduce overhead
let cachedNonce: string | null = null;
let lastCacheTime = 0;
const CACHE_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

const AJAX_URL = "https://unlimitedai.org/wp-admin/admin-ajax.php";
const CHAT_URL = "https://unlimitedai.org/chat/?uai_mode=chat&uai_model=claude";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Model key → WordPress bot_id mapping. */
const BOT_IDS: Record<string, string> = {
  chatgpt: "25871",
  gemini: "25874",
  deepseek: "25873",
  claude: "25875",
  grok: "25872",
  perplexity: "29624",
  meta: "25870",
  qwen: "25869",
};

/**
 * Dynamically synchronizes with the UnlimitedAI chat interface to load the
 * latest active nonces. Self-healing: guarantees our API routes never break
 * due to nonce expirations.
 */
async function getLiveChatNonce(): Promise<string> {
  const now = Date.now();
  if (cachedNonce && now - lastCacheTime < CACHE_EXPIRATION_MS) {
    return cachedNonce;
  }

  try {
    const res = await fetch(CHAT_URL, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`Fetcher status failed with status ${res.status}`);

    const html = await res.text();

    const nonceMatch =
      html.match(/&quot;nonce&quot;\s*:\s*&quot;([a-zA-Z0-9]+)&quot;/i) ||
      html.match(/"nonce"\s*:\s*"([a-zA-Z0-9]+)"/i);

    if (nonceMatch?.[1]) {
      cachedNonce = nonceMatch[1];
      lastCacheTime = now;
      console.log("Dynamic Nonce Loaded Successfully:", cachedNonce);
      return cachedNonce;
    }
  } catch (err) {
    console.error("Failed to synchronize fresh nonce, using backup fallback:", err);
  }

  return cachedNonce || "a2ff06d039";
}

/**
 * POST Handler: Starts the chat pipeline.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      model_key,
      prompt,
      image_inputs,
      web_search_active,
      conversation_uuid,
      session_id,
      previous_openai_response_id,
    } = body as {
      model_key?: string;
      prompt?: string;
      image_inputs?: Array<{ type: string; image_url: { url: string } }>;
      web_search_active?: boolean;
      conversation_uuid?: string;
      session_id?: string;
      previous_openai_response_id?: string;
    };

    if (!model_key || !prompt) {
      return NextResponse.json(
        { error: "Missing model_key or prompt" },
        { status: 400 },
      );
    }

    const botId = BOT_IDS[model_key];
    if (!botId) {
      return NextResponse.json(
        {
          error: `Unsupported model key "${model_key}". Supported: ${Object.keys(BOT_IDS).join(", ")}`,
        },
        { status: 400 },
      );
    }

    // CRITICAL CONTEXT FIX: Standard UUID format is MANDATORY for WordPress
    // backend database matching.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validConvUuid =
      conversation_uuid && UUID_RE.test(conversation_uuid)
        ? conversation_uuid
        : uuidv4();
    const validSessionId =
      session_id && UUID_RE.test(session_id) ? session_id : uuidv4();

    // Fetch dynamic nonce
    const nonce = await getLiveChatNonce();

    const requestHeaders: Record<string, string> = {
      "User-Agent": UA,
      Referer: CHAT_URL,
      Origin: "https://unlimitedai.org",
    };

    // ==========================================
    // STEP 1: PRE-CACHE PROMPT ON THE WP SERVER
    // ==========================================
    const cacheFormData = new URLSearchParams();
    cacheFormData.append("action", "aipkit_cache_sse_message");
    cacheFormData.append("message", prompt);
    cacheFormData.append("_ajax_nonce", nonce);
    cacheFormData.append("bot_id", botId);
    cacheFormData.append("session_id", validSessionId);
    cacheFormData.append("conversation_uuid", validConvUuid);

    // Context variable for OpenAI providers
    if (model_key === "chatgpt" && previous_openai_response_id) {
      cacheFormData.append(
        "previous_openai_response_id",
        previous_openai_response_id,
      );
    }

    // Vision Support: pass base64 details inside image_inputs payload
    if (image_inputs && Array.isArray(image_inputs)) {
      cacheFormData.append("image_inputs", JSON.stringify(image_inputs));
    }

    const cacheRes = await fetch(AJAX_URL, {
      method: "POST",
      headers: {
        ...requestHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: cacheFormData.toString(),
    });

    if (!cacheRes.ok) {
      throw new Error(`Preparation POST failed with status ${cacheRes.status}`);
    }

    const cacheJson = (await cacheRes.json()) as {
      success?: boolean;
      data?: { cache_key?: string; message?: string };
    };
    if (!cacheJson.success) {
      throw new Error(
        cacheJson.data?.message || "Preparation rejected by original server",
      );
    }

    const cacheKey = cacheJson.data?.cache_key;
    if (!cacheKey) {
      throw new Error("No cache_key returned from server");
    }

    // ==========================================
    // STEP 2: OPEN UP THE SSE STREAM PIPELINE
    // ==========================================
    let streamParams =
      `action=aipkit_frontend_chat_stream` +
      `&cache_key=${cacheKey}` +
      `&bot_id=${botId}` +
      `&session_id=${validSessionId}` +
      `&conversation_uuid=${validConvUuid}` +
      `&_ajax_nonce=${nonce}` +
      `&_ts=${Date.now()}`;

    if (model_key === "chatgpt" && previous_openai_response_id) {
      streamParams += `&previous_openai_response_id=${previous_openai_response_id}`;
    }
    if (web_search_active) {
      streamParams += `&frontend_web_search_active=true`;
    }

    const streamUrl = `${AJAX_URL}?${streamParams}`;
    const sseResponse = await fetch(streamUrl, {
      headers: {
        ...requestHeaders,
        Accept: "text/event-stream",
      },
    });

    if (!sseResponse.ok) {
      throw new Error(
        `SSE EventStream pipeline failed with status ${sseResponse.status}`,
      );
    }

    // Forward the stream body directly as-is to our client.
    // X-Accel-Buffering: no is CRITICAL — without it Vercel's nginx proxy
    // buffers the entire SSE body before sending anything to the client,
    // killing real-time streaming.
    return new Response(sseResponse.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: unknown) {
    console.error("Chat stream proxy error:", error);
    const message = error instanceof Error ? error.message : "Stream processing failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET endpoint returning usage documentation. */
export async function GET() {
  return NextResponse.json({
    service: "FreeAIXYZ Chat Stream API",
    endpoint: "POST /api/chat",
    params: {
      model_key: `One of: ${Object.keys(BOT_IDS).join(", ")}`,
      prompt: "The user message text (required)",
      image_inputs: "Array of {type:'image_url', image_url:{url:'base64...'}} for vision (optional)",
      web_search_active: "Boolean — enable web search grounding (optional)",
      conversation_uuid: "UUID for context retention across messages (optional, auto-generated)",
      session_id: "UUID for session tracking (optional, auto-generated)",
      previous_openai_response_id: "OpenAI response ID for ChatGPT context (optional)",
    },
    models: Object.entries(BOT_IDS).map(([key, botId]) => ({ key, bot_id: botId })),
    note: "Returns text/event-stream SSE. Each data: line contains JSON with delta content.",
  });
}
