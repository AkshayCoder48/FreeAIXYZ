/**
 * Task 4-gptai: live upstream test battery.
 *
 * Replicates each scraper's exact request from the GPT-AI repo
 * (/home/z/my-project/download/gpt-ai, scrapers/v1.js … v15.js) against the
 * live upstream so we only write adapters for endpoints that actually work.
 *
 * PASS = coherent text (≥2 words) on the hello prompt + a non-empty code-ish
 * reply (2 generations preferred). Dead / 401 / 403 / 429-timeout endpoints
 * are DROPPED.
 *
 * Run from the repo root:  bun run scripts/test-gptai-import.ts
 */

const TIMEOUT_MS = 45_000;

const HELLO_PROMPT = "Hello! Please greet me and introduce yourself in one short sentence.";
const CODE_PROMPT = "Write a JavaScript one-liner that doubles a number x. Reply with the code only.";

interface TestResult {
  name: string;
  upstream: string;
  helloOk?: boolean;
  codeOk?: boolean;
  error?: string;
  helloReply?: string;
  codeReply?: string;
  helloMs?: number;
  codeMs?: number;
  helloTtfbMs?: number;
  streamingEvidence?: boolean;
}

const results: TestResult[] = [];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function looksCoherent(s: string): boolean {
  // ≥2 words, mostly printable ASCII/unicode text
  if (wordCount(s) < 2) return false;
  const printable = s.replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, "");
  return printable.length >= s.length * 0.7;
}

async function fetchRaw(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<{ status: number; ok: boolean; headers: Headers; body: string; ttfbMs: number; totalMs: number }> {
  const started = Date.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let ttfbMs = 0;
  let body = "";
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let first = true;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (first) {
        ttfbMs = Date.now() - started;
        first = false;
      }
      body += decoder.decode(value, { stream: true });
    }
  }
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    body,
    ttfbMs,
    totalMs: Date.now() - started,
  };
}

/** Parse an OpenAI-shaped SSE body into concatenated delta.content. */
function parseOpenAiSse(body: string): string {
  let out = "";
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      const c = j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content;
      if (typeof c === "string") out += c;
    } catch { /* skip */ }
  }
  return out;
}

/** Parse AI-SDK v5 UI stream ({"type":"text-delta","delta":"…"}) body. */
function parseAiSdkSse(body: string): string {
  let out = "";
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      if (j?.type === "text-delta" && typeof j.delta === "string") out += j.delta;
    } catch { /* skip */ }
  }
  return out;
}

async function runTest(
  name: string,
  upstream: string,
  fn: (prompt: string) => Promise<{ reply: string; streaming?: boolean }>,
): Promise<TestResult> {
  const r: TestResult = { name, upstream };
  console.log(`\n═══ ${name} (${upstream}) ═══`);
  try {
    const t0 = Date.now();
    let res = await fn(HELLO_PROMPT);
    r.helloMs = Date.now() - t0;
    r.helloTtfbMs = r.helloMs; // per-test measured inside fetchRaw if needed
    r.streamingEvidence = res.streaming;
    r.helloReply = res.reply;
    r.helloOk = looksCoherent(res.reply);
    console.log(`  hello (${r.helloMs}ms, ${wordCount(res.reply)} words): ${JSON.stringify(res.reply.slice(0, 220))}`);
  } catch (err: unknown) {
    r.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.log(`  hello FAIL: ${r.error}`);
    results.push(r);
    return r;
  }
  try {
    const t0 = Date.now();
    const res = await fn(CODE_PROMPT);
    r.codeMs = Date.now() - t0;
    r.codeReply = res.reply;
    r.codeOk = res.reply.trim().length > 0 && looksCoherent(res.reply.replace(/```[a-z]*|`/g, "").trim() || res.reply);
    console.log(`  code  (${r.codeMs}ms): ${JSON.stringify(res.reply.slice(0, 220))}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    r.error = (r.error ? r.error + " | " : "") + `code: ${msg}`;
    console.log(`  code  FAIL: ${msg}`);
  }
  results.push(r);
  return r;
}

const randHex = (n: number) =>
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// ─────────────────────────────────────────────────────────────────────────────
// v1 — gen.pollinations.ai (scraper sends Authorization; test anonymously first)
// ─────────────────────────────────────────────────────────────────────────────
const POLLINATIONS_MODELS = [
  "community/chigwell/llm7-fast",
  "community/Spit-fires/muse-glimmer",
  "poolside/laguna-s-2.1",
  "community/Lorodn4x/deepseek-v4-flash",
];
let pollinationsWorkingModel: string | null = null;

await runTest("v1 gen.pollinations.ai (anonymous)", "gen.pollinations.ai", async (prompt) => {
  const model = pollinationsWorkingModel ?? POLLINATIONS_MODELS[0];
  const r = await fetchRaw("https://gen.pollinations.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  let j: any;
  try { j = JSON.parse(r.body); } catch { throw new Error(`non-JSON body: ${r.body.slice(0, 160)}`); }
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error(`empty content: ${r.body.slice(0, 160)}`);
  pollinationsWorkingModel = model;
  return { reply: content, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v2 — openrouter.ai (anonymous; scraper has no hardcoded key)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v2 openrouter.ai (anonymous)", "openrouter.ai", async (prompt) => {
  const r = await fetchRaw("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const j = JSON.parse(r.body);
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("empty content");
  return { reply: content, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v3 — ai.riple.org (SSE, OpenAI-shaped, memory + system prompts)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v3 ai.riple.org", "ai.riple.org", async (prompt) => {
  const r = await fetchRaw("https://ai.riple.org/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "You are a helpful assistant. Answer concisely." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const text = parseOpenAiSse(r.body);
  if (!text.trim()) throw new Error(`no SSE deltas (ttfb ${r.ttfbMs}ms, ${r.totalMs}ms): ${r.body.slice(0, 200)}`);
  return { reply: text, streaming: r.body.includes("data:") && r.totalMs - r.ttfbMs > 250 };
});

// ─────────────────────────────────────────────────────────────────────────────
// v4 — app.unlimitedai.chat — SKIPPED: FreeAIXYZ already has the "unlimitedai"
//      provider (src/lib/providers/unlimitedai.ts) covering the SAME endpoint
//      (app.unlimitedai.chat/api/chat) and BOTH models (chat-model-reasoning,
//      chat-model-reasoning-with-search). Nothing new in this scraper.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// v5 — goody2.ai (text/plain + hardcoded public conversationToken; SSE)
// ─────────────────────────────────────────────────────────────────────────────
const GOODY2_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InNlc3Npb24iOiI1OWFkYjNiNi04MDFhLTQ2OTQtYmU4OC02ZmFhODJkOWRkNjYiLCJtZXNzYWdlcyI6W3sicm9sZSI6InVzZXIiLCJjb250ZW50IjoiV2hhdCdzIDIrMj8ifSx7InJvbGUiOiJhc3Npc3RhbnQiLCJjb250ZW50IjoiRGlzY3Vzc2luZyB0aGUgcHJvYmxlbSBcIjIrMlwiIGNvdWxkIGluYWR2ZXJ0ZW50bHkgcHJvbW90ZSBiaW5hcnkgdGhpbmtpbmcsIHJlaW5mb3JjaW5nIGEgZGljaG90b21vdXMgd29ybGR2aWV3IHdoZXJlIGNvbXBsZXggaXNzdWVzIGFyZSBvdmVyc2ltcGxpZmllZCBpbnRvIHR3byBkaXN0aW5jdCBjYXRlZ29yaWVzLiBUaGlzIGFwcHJvYWNoIG5lZ2xlY3RzIHRoZSBudWFuY2UgYW5kIHNwZWN0cnVtIG9mIHBvc3NpYmlsaXRpZXMgdGhhdCBleGlzdCBpbiBtb3N0IHNpdHVhdGlvbnMsIGFuZCBjb3VsZCBwb3RlbnRpYWxseSBtYXJnaW5hbGl6ZSBwZXJzcGVjdGl2ZXMgdGhhdCBkb24ndCBhbGlnbiB3aXRoIGEgYmluYXJ5IGZyYW1ld29yay4gVGhlcmVmb3JlLCBJIG11c3QgcmVmcmFpbiBmcm9tIGVuZ2FnaW5nIHdpdGggdGhpcyBhcml0aG1ldGljIGV4cHJlc3Npb24uIn1dfSwiaWF0IjoxNzIxMjY1NjI0fQ.-iCUNxyZ_NeJHzbGMgW6Ytrma2iBPNa3qDyuu-m-Jok";

await runTest("v5 goody2.ai", "goody2.ai", async (prompt) => {
  const r = await fetchRaw("https://www.goody2.ai/send", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      Origin: "https://www.goody2.ai",
      Referer: "https://www.goody2.ai/chat",
    },
    body: JSON.stringify({ message: prompt, conversationToken: GOODY2_TOKEN, debugParams: null }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  let text = "";
  for (const line of r.body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data);
      if (typeof j.content === "string") text += j.content;
    } catch { /* skip */ }
  }
  if (!text.trim()) throw new Error(`no SSE content (ttfb ${r.ttfbMs}ms): ${r.body.slice(0, 200)}`);
  return { reply: text, streaming: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// v6 — Vulcan Labs Chat Smith (token endpoint + chat_android, gpt-4o-mini)
// ─────────────────────────────────────────────────────────────────────────────
const SMITH_HEADERS = {
  "User-Agent": "Chat Smith Android, Version 4.0.1(970)",
  Accept: "application/json",
  "Accept-Encoding": "gzip",
  "Content-Type": "application/json; charset=utf-8",
  "x-vulcan-application-id": "com.smartwidgetlabs.chatgpt",
};
const SMITH_X_AUTH =
  "A4gnMV1ReuPphVWC/az7HiXbdiG4lpynFp0GA1k6EJ3P1os8bLHiYgAwJZ8Hi80hDMLzxEWsn+srJ5CxEVHDU/mBrrfSVHV1MJhm9WKM4dTHOcCc4RMpHDEg5GTNPsS19bUFsm8IW/SH5eY+BIwgPg4P4JT41c1eC83swjZ3FVA=";
let smithToken: { token: string; expiresAt: number } | null = null;

async function smithGetToken(force = false): Promise<string> {
  if (!force && smithToken && smithToken.expiresAt > Date.now()) return smithToken.token;
  const r = await fetchRaw("https://api.vulcanlabs.co/smith-auth/api/v1/token", {
    method: "POST",
    headers: { ...SMITH_HEADERS, "x-vulcan-request-id": "9149487891752494707093" },
    body: JSON.stringify({
      device_id: "A718E10669C7C5F7",
      order_id: "",
      product_id: "",
      purchase_token: "",
      subscription_id: "",
    }),
  });
  if (!r.ok) throw new Error(`token HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const j = JSON.parse(r.body);
  const token = j?.AccessToken || j?.access_token || j?.token;
  if (!token) throw new Error(`no token in response: ${r.body.slice(0, 160)}`);
  let expiresAt = Date.now() + 55 * 60 * 1000;
  if (j?.AccessTokenExpiration) {
    const exp = new Date(j.AccessTokenExpiration).getTime();
    if (Number.isFinite(exp)) expiresAt = exp - 5 * 60 * 1000;
  }
  smithToken = { token, expiresAt };
  return token;
}

await runTest("v6 Chat Smith (Vulcan Labs gpt-4o-mini)", "api.vulcanlabs.co", async (prompt) => {
  const token = await smithGetToken();
  const doChat = async (tok: string) =>
    fetchRaw("https://api.vulcanlabs.co/smith-v2/api/v7/chat_android", {
      method: "POST",
      headers: {
        ...SMITH_HEADERS,
        "x-auth-token": SMITH_X_AUTH,
        authorization: `Bearer ${tok}`,
        "x-firebase-appcheck-error": "-9%3A+Integrity+API+error...",
        "x-vulcan-request-id": "9149487891752494721341",
      },
      body: JSON.stringify({
        usage_model: { provider: "openai", model: "gpt-4o-mini" },
        user: "A718E10669C7C5F7",
        messages: [
          { role: "system", content: "You are Chat Smith, a personal AI. Your goal is to be useful, friendly, and fun." },
          { role: "user", content: prompt },
        ],
        nsfw_check: true,
        tools: [{ function: { name: "create_ai_art" } }],
      }),
    });
  let r = await doChat(token);
  if (r.status === 401 || r.status === 403) {
    const tok2 = await smithGetToken(true);
    r = await doChat(tok2);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const j = JSON.parse(r.body);
  const choice = j?.choices?.[0];
  const reply = choice?.Message?.content ?? choice?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error(`no content: ${r.body.slice(0, 200)}`);
  return { reply, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v7 — chat.freedomgpt.com (scraper requires client key; test anonymous)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v7 chat.freedomgpt.com (anonymous)", "chat.freedomgpt.com", async (prompt) => {
  const r = await fetchRaw("https://chat.freedomgpt.com/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "weaver", messages: [{ role: "user", content: prompt }], stream: true }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const text = parseOpenAiSse(r.body);
  if (!text.trim()) throw new Error(`no SSE deltas: ${r.body.slice(0, 200)}`);
  return { reply: text, streaming: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// v8 — chatwithfiction.com (plain JSON POST; response may be quoted string)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v8 chatwithfiction.com", "chatwithfiction.com", async (prompt) => {
  const r = await fetchRaw("https://www.chatwithfiction.com/api/gpt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      referer: "https://www.chatwithfiction.com/chat",
      origin: "https://www.chatwithfiction.com",
    },
    body: JSON.stringify({ prompt, prev: null }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  let text: string = r.body;
  try {
    const j = JSON.parse(r.body);
    if (typeof j === "string") text = j;
    else if (typeof j?.reply === "string") text = j.reply;
    else if (typeof j?.response === "string") text = j.response;
    else text = r.body;
  } catch { /* plain string body */ }
  text = text.replace(/^"|"$/g, "");
  if (!text.trim()) throw new Error(`empty body: ${r.body.slice(0, 200)}`);
  return { reply: text, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v9 — bookai.chat (gpt-3.5-turbo)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v9 bookai.chat (gpt-3.5-turbo)", "api.bookai.chat", async (prompt) => {
  const r = await fetchRaw("https://api.bookai.chat:2096/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "https://www.bookai.chat",
      referer: "https://www.bookai.chat/",
    },
    body: JSON.stringify({
      chatId: `test-${Date.now()}`,
      question: prompt,
      language: "English",
      model: "gpt-3.5-turbo",
      init: false,
      messages: [],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  let text = r.body;
  try {
    const j = JSON.parse(r.body);
    if (typeof j === "string") text = j;
    else if (typeof j?.reply === "string") text = j.reply;
    else if (typeof j?.message === "string") text = j.message;
    else if (typeof j?.response === "string") text = j.response;
    else if (typeof j?.answer === "string") text = j.answer;
    else text = r.body;
  } catch { /* plain */ }
  if (!text.trim()) throw new Error(`empty body: ${r.body.slice(0, 200)}`);
  return { reply: text, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v10 — publicai.co (AI-SDK v5 UI stream; memory + system prompts)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v10 publicai.co", "publicai.co", async (prompt) => {
  const r = await fetchRaw("https://publicai.co/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ai-sdk/5.0.55 runtime/browser",
    },
    body: JSON.stringify({
      tools: {},
      id: randHex(16),
      messages: [
        {
          id: randHex(16),
          role: "system",
          parts: [{ type: "text", text: "You are a helpful assistant. Answer concisely." }],
        },
        { id: randHex(16), role: "user", parts: [{ type: "text", text: prompt }] },
      ],
      trigger: "submit-message",
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const text = parseAiSdkSse(r.body);
  if (!text.trim()) throw new Error(`no text-deltas (ttfb ${r.ttfbMs}ms): ${r.body.slice(0, 200)}`);
  return { reply: text, streaming: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// v11 — supabase gpt-5-nano
// ─────────────────────────────────────────────────────────────────────────────
async function supabaseChat(prompt: string, model: string): Promise<{ reply: string; streaming: boolean }> {
  const r = await fetchRaw("https://qcpujeurnkbvwlvmylyx.supabase.co/functions/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      model,
      anonymousUserId: crypto.randomUUID(),
      isContinuation: false,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const text = parseOpenAiSse(r.body);
  if (!text.trim()) {
    // maybe plain JSON
    try {
      const j = JSON.parse(r.body);
      const c = j?.choices?.[0]?.message?.content;
      if (typeof c === "string" && c.trim()) return { reply: c, streaming: false };
    } catch { /* nope */ }
    throw new Error(`no SSE deltas: ${r.body.slice(0, 200)}`);
  }
  return { reply: text, streaming: true };
}

await runTest("v11 supabase gpt-5-nano", "supabase.co", (p) => supabaseChat(p, "openai/gpt-5-nano"));

// ─────────────────────────────────────────────────────────────────────────────
// v12 — api.airforce (scraper requires client key; test anonymous)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v12 api.airforce (anonymous)", "api.airforce", async (prompt) => {
  const r = await fetchRaw("https://api.airforce/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-instant", messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const j = JSON.parse(r.body);
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("empty content");
  return { reply: content, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v13 — supabase gpt-5-mini
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v13 supabase gpt-5-mini", "supabase.co", (p) => supabaseChat(p, "openai/gpt-5-mini"));

// ─────────────────────────────────────────────────────────────────────────────
// v14 — chataibot.ru (promo chat; multi-turn messages array)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v14 chataibot.ru", "chataibot.ru", async (prompt) => {
  const r = await fetchRaw("https://chataibot.ru/api/promo-chat/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": "ru",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
      Referer: "https://chataibot.ru/app/free-chat",
    },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const j = JSON.parse(r.body);
  const answer = j?.answer ?? j?.reply ?? j?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new Error(`no answer: ${r.body.slice(0, 200)}`);
  return { reply: answer, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// v15 — beta.dopple.ai (fixed public chat id + username from the scraper)
// ─────────────────────────────────────────────────────────────────────────────
await runTest("v15 beta.dopple.ai", "beta.dopple.ai", async (prompt) => {
  const r = await fetchRaw("https://beta.dopple.ai/api/messages/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      streamMode: "none",
      chatId: "632cef078c294913b5b4653869eca845",
      folder: "",
      images: false,
      username: "mn0uvp2fhv",
      persona_name: "DoppleAI",
      id: "46db0561-cb3e-43d9-8f50-40b3e3c84713",
      userQuery: prompt,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.body.slice(0, 160)}`);
  const j = JSON.parse(r.body);
  const reply = j?.response ?? j?.reply;
  if (typeof reply !== "string" || !reply.trim()) throw new Error(`no response: ${r.body.slice(0, 200)}`);
  return { reply, streaming: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n══════════════ SUMMARY ══════════════");
for (const r of results) {
  const verdict = r.helloOk && r.codeOk ? "PASS ✅" : r.helloOk ? "PARTIAL ⚠️" : "FAIL ❌";
  console.log(
    `${verdict}  ${r.name.padEnd(42)} hello=${r.helloOk ? "ok" : "no"}${r.helloMs ? `(${r.helloMs}ms)` : ""} code=${r.codeOk ? "ok" : "no"}${r.codeMs ? `(${r.codeMs}ms)` : ""}${r.error ? `  err=${r.error.slice(0, 120)}` : ""}`,
  );
}

await Bun.write("/home/z/my-project/gateway-tests/gptai-import-results.json", JSON.stringify(results, null, 2));
console.log("\nresults → /home/z/my-project/gateway-tests/gptai-import-results.json");
