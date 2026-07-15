/**
 * TheOldLLM Browser Proxy Service
 *
 * Keeps a headless Playwright browser open with the Vercel security challenge
 * solved, then proxies API calls through the browser's cleared context.
 *
 * Port: 3004
 * POST /  — body: { model, messages, stream }
 *   Returns the full SSE response text (collected inside the browser).
 */

import { chromium, type Page, type BrowserContext } from "playwright";

// Prevent crashes from killing the process
process.on("uncaughtException", (e) => {
  console.error("[theoldllm] uncaughtException:", e?.message?.slice(0, 200));
});
process.on("unhandledRejection", (e) => {
  console.error("[theoldllm] unhandledRejection:", String(e).slice(0, 200));
});

const PORT = 3004;
const TARGET = "https://theoldllm.vercel.app/";

const MODEL_MAP: Record<string, string> = {
  "claude-opus-4-5": "Claude_Opus_4_5",
  "gpt-5.1": "GPT_5_1",
  "gpt-5-mini": "GPT_5_MINI",
  "gpt-4o": "GPT_4O",
  "o4-mini": "O4_MINI",
  "gemini-3-pro-preview": "Gemini_3_Pro_Preview",
  "grok-4": "Grok_4",
  "kimi-k2": "Kimi_K2",
  "qwen3-235b-a22b": "Qwen3_235B",
  "glm-4.7": "GLM_4_7",
  "mistral-large-2512": "Mistral_Large_2512",
  "minimax-m2": "Minimax_M2",
  "llama-3.3-70b-instruct": "Llama_3_3_70B",
  "deepseek-v3.2": "DeepSeek_V3_2",
};

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let ready = false;
let solving = false;
let requestLock = false; // serialize requests to avoid page.evaluate conflicts

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureBrowser() {
  if (ready && page && !page.isClosed()) return;

  if (solving) {
    while (solving) await sleep(500);
    return;
  }

  solving = true;
  try {
    console.log("[theoldllm] launching browser + solving Vercel challenge...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      locale: "en-US",
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      window.chrome = { runtime: {} };
    });
    page = await context.newPage();

    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const title = await page.title().catch(() => "");
      if (!title.includes("Vercel") && !title.includes("Security") && !title.includes("Loading")) {
        console.log("[theoldllm] challenge solved:", title.slice(0, 50));
        ready = true;
        return;
      }
    }
    console.log("[theoldllm] WARNING: challenge may not have fully resolved");
    ready = true;
  } catch (e) {
    console.error("[theoldllm] browser setup error:", e);
    ready = false;
  } finally {
    solving = false;
  }
}

interface ChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === "GET") {
      return new Response(JSON.stringify({ ready, solving }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = (await req.json()) as ChatRequest;
      const model = MODEL_MAP[body.model] ?? body.model;

      await ensureBrowser();
      if (!page || page.isClosed()) {
        return new Response(JSON.stringify({ error: "Browser not ready" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Serialize requests — page.evaluate can't run concurrently
      while (requestLock) await sleep(100);
      requestLock = true;

      try {
        // Recreate the page between requests to avoid state buildup that
        // crashes Chromium. The new page inherits the context's cookies
        // (including the Vercel clearance), so no re-solve needed.
        if (page && !page.isClosed()) {
          try { await page.close(); } catch { /* ignore */ }
        }
        if (context) {
          page = await context.newPage();
          // Navigate to the app — cookies bypass the challenge
          await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          // Quick check that we're past the challenge
          await sleep(2000);
          const title = await page.title().catch(() => "");
          if (title.includes("Vercel") || title.includes("Security")) {
            // Challenge re-appeared — need full re-solve
            ready = false;
            await ensureBrowser();
          }
        }

        // Simple approach: collect the FULL response inside the browser
        const result = await page!.evaluate(
          async (p: { model: string; messages: unknown[] }) => {
            try {
              const res = await fetch("/api/chatgpt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: p.model,
                  messages: p.messages,
                  stream: true,
                  temperature: 0.7,
                }),
              });
              if (!res.ok) {
                const errText = await res.text();
                return { status: res.status, body: errText.slice(0, 500) };
              }
              const text = await res.text();
              return { status: res.status, body: text };
            } catch (e: any) {
              return { status: 0, body: e?.message ?? "Unknown error" };
            }
          },
          { model, messages: body.messages },
        );

        if (result.status === 0) {
          return new Response(JSON.stringify({ error: result.body }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Return the raw SSE text — the provider will parse it
        return new Response(result.body, {
          status: result.status,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      } finally {
        requestLock = false;
      }
    } catch (e) {
      console.error("[theoldllm] request error:", e);
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
});

console.log(`[theoldllm-browser] listening on port ${PORT}`);

// Keep browser warm
setInterval(async () => {
  if (!page || page.isClosed()) {
    console.log("[theoldllm] page closed, re-solving challenge...");
    ready = false;
    await ensureBrowser().catch(() => {});
  }
}, 30000);
