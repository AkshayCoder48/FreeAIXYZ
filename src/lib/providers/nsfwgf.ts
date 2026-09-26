// NSFWGF provider — uncensored models via nsfwgirlfriend.com with automated
// disposable-email account rotation. See agent-ctx + worklog for protocol.
/**
 * NSFWGF provider (www.nsfwgirlfriend.com) — uncensored companion-chat
 * backend with automated email-account rotation.
 *
 * Upstream: a Next.js companion site fronting an OpenRouter free pool. The
 * chat endpoint speaks a custom REQUEST envelope but a 100% OpenAI-shaped
 * RESPONSE (both streaming and non-streaming):
 *
 *   POST /api/openai/chat/completions
 *   → SSE: data: {"id":"gen-…","object":"chat.completion.chunk",
 *                "choices":[{"delta":{"content":"…"}}]} … data: [DONE]
 *   → JSON (stream:false): standard chat.completion with
 *     choices[0].message.content.
 *
 * Reverse-engineered protocol notes (live-verified 2026-09-20):
 *   - `builtin: true` forces sysprompt:"" (server persona from char_id).
 *     `builtin: false` + a custom `char` object makes the server use OUR
 *     sysprompt verbatim → fully controllable general-purpose assistant
 *     ("You are Ada…" verified: answers factual questions, no persona leak).
 *   - model_type slots (from the site's JS chunk model map `G`):
 *       lfm-7b     → mistralai/mistral-nemo      (FREE, 20/20 hard-test)
 *       llama3-8b  → sao10k/l3-lunaris-8b        (FREE, 20/20 hard-test)
 *       sft-7b     → xiaomi/mimo-v2-flash        (FREE, 18/20 hard-test)
 *       everything else (nsfw-7b, ja-7b, minimax, dpo-7b, nsfw-34b,
 *       mistral-nemo, mistral-tiny, microsoft-phi-4, gemini-2-flash, grok,
 *       openai, claude, lzlv-70b) → HTTP 401 code 40002 "modeltype need
 *       vip" — VIP-only, intentionally NOT listed.
 *   - Anonymous access is IP-rate-limited (401 code 40012, rotating egress
 *     IPs randomly exhausted) — UNRELIABLE. The reliable path is a NextAuth
 *     EMAIL MAGIC-LINK account: each fresh account = 50 free messages
 *     (`freeMessageCount`). STRATEGY: auto-create disposable mail.tm
 *     inboxes, complete the magic-link signin, and rotate accounts every
 *     44 messages → unlimited usage.
 *   - Server caps generations at 300 completion tokens (finish_reason
 *     "length") — companion-style short replies; documented in model
 *     descriptions (upstream-enforced, cannot be lifted client-side).
 *   - Multi-turn history is resent each request (stateless server) and
 *     honored (verified: "my favorite number is 47" → "57").
 *   - sft-7b intermittently returns HTTP 200 with empty content (~10%):
 *     the adapter retries once on empty before surfacing an error.
 *   - No native tool calling, no vision, no sampling params (accepted but
 *     unverified) — tools are emulated by the gateway's fence/bare-JSON
 *     pipeline; vision content is flattened by the gateway layer.
 *
 * Auth flow (fully automated, ~15–60s per account):
 *   1. mail.tm: GET /domains → POST /accounts → POST /token (disposable
 *      inbox).
 *   2. GET  site /api/auth/csrf → csrfToken + cookie jar.
 *   3. POST site /api/auth/signin/email (form-encoded) → magic link sent.
 *   4. Poll mail.tm /messages until the
 *      …/api/auth/callback/email?token=… link arrives.
 *   5. GET the link (manual redirects, collecting Set-Cookie) →
 *      next-auth session cookie.
 *   6. Verify via /api/auth/session (user.id + freeMessageCount).
 */

import type { Provider, ProviderCompletionRequest, ProviderMessage } from "./types";

const SITE = "https://www.nsfwgirlfriend.com";
const CHAT_URL = `${SITE}/api/openai/chat/completions`;
const MAILTM = "https://api.mail.tm";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Free-tier reachable model_type slots (20-generation hard-tested). */
const NSFWGF_MODELS = new Set(["lfm-7b", "llama3-8b", "sft-7b"]);

/** Rotate BEFORE the real account limit. Live-measured: fresh accounts
 * hit 401 code 40013 (AuthedChatRateLimitExceeded) at ~28 messages — the
 * advertised freeMessageCount (50) is never reached — so we rotate at 25. */
const SOFT_LIMIT = 25;

/** When the active account passes this usage, pre-create the next account
 * in the background so rotation is instant (no 30–60s magic-link wait). */
const PREFETCH_AT = 15;

/** Quota error codes → rotate account. Everything else fails fast. */
const ROTATE_CODES = new Set([40012, 40013, 40014]);

interface NsfwAccount {
  cookie: string;
  email: string;
  used: number;
}

interface PoolState {
  pool: NsfwAccount[];
  creating: Promise<NsfwAccount> | null;
}
/** Survive dev-server HMR reloads (module state lives on globalThis). */
const G = globalThis as unknown as { __nsfwgfPool?: PoolState };
const state: PoolState = (G.__nsfwgfPool ??= { pool: [], creating: null });

// ───────────────────────── utilities ─────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 22-char alphanumeric session id, like the site's client generates. */
function randSessionId(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 22; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** "YYYY/MM/DD HH:MM:SS" — the date format the site's messages carry. */
function msgDate(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}/${p(n.getMonth() + 1)}/${p(n.getDate())} ${p(
    n.getHours(),
  )}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}

function parseCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ───────────────── disposable inboxes (multi-provider) ─────────────────
//
// Account creation needs a mailbox to receive the NextAuth magic link.
// Two independent providers, each with its own rate limits:
//   1. mail.tm      (primary — hydra API, JWT auth)
//   2. tempmail.lol (fallback — token API; verified accepted by the site)
// mail.tm throttles account creation per IP (429) after ~10 mailboxes/hour;
// the fallback keeps account creation (and therefore the gateway) alive.

interface DisposableInbox {
  address: string;
  /** Fetch all currently-visible message bodies (html + text). */
  readAll: () => Promise<string>;
}

/** mail.tm inbox — create account + JWT, expose message reader. */
async function createInboxMailTm(): Promise<DisposableInbox> {
  const dRes = await fetch(`${MAILTM}/domains`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await dRes.json()) as
    | { "hydra:member"?: Array<{ domain: string }> }
    | Array<{ domain: string }>;
  const domain = (Array.isArray(d) ? d : d["hydra:member"])?.[0]?.domain;
  if (!domain) throw new Error("nsfwgf: mail.tm returned no domain");

  const address =
    "gf" + Math.random().toString(36).slice(2, 10) + Math.floor(Math.random() * 1e6) + "@" + domain;
  const password = "Pw" + Math.random().toString(36).slice(2) + "!9";

  // Short 429 backoff (2 tries) — a hard throttle falls through to the
  // tempmail.lol fallback instead of blocking the request for a minute.
  let created = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const aRes = await fetch(`${MAILTM}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ address, password }),
      signal: AbortSignal.timeout(20_000),
    });
    if (aRes.status === 429) {
      if (attempt === 1) throw new Error("nsfwgf: mail.tm rate-limited (429)");
      await sleep(8_000);
      continue;
    }
    if (aRes.status !== 201 && aRes.status !== 422) {
      throw new Error(`nsfwgf: mail.tm account create failed (${aRes.status})`);
    }
    created = true;
    break;
  }
  if (!created) throw new Error("nsfwgf: mail.tm account create failed");

  let jwt: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tRes = await fetch(`${MAILTM}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ address, password }),
      signal: AbortSignal.timeout(20_000),
    });
    const tok = (await tRes.json()) as { token?: string };
    if (tok.token) {
      jwt = tok.token;
      break;
    }
    await sleep(5_000);
  }
  if (!jwt) throw new Error("nsfwgf: mail.tm token failed");

  return {
    address,
    readAll: async () => {
      const res = await fetch(`${MAILTM}/messages`, {
        headers: { Authorization: `Bearer ${jwt}`, "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      const list = (await res.json()) as {
        "hydra:member"?: Array<{ id: string }>;
      };
      let bodies = "";
      for (const m of list["hydra:member"] ?? []) {
        const full = await fetch(`${MAILTM}/messages/${m.id}`, {
          headers: { Authorization: `Bearer ${jwt}`, "User-Agent": UA },
          signal: AbortSignal.timeout(20_000),
        }).then((r) => r.json() as Promise<{ html?: string[] | string; text?: string }>);
        bodies +=
          (Array.isArray(full.html) ? full.html.join("\n") : full.html ?? "") +
          "\n" +
          (full.text ?? "");
      }
      return bodies;
    },
  };
}

/** tempmail.lol inbox — verified accepted by the site's email signin. */
async function createInboxTempMailLol(): Promise<DisposableInbox> {
  let gen: { address?: string; token?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.tempmail.lol/generate", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) {
      if (attempt === 1) throw new Error("nsfwgf: tempmail.lol rate-limited (429)");
      await sleep(8_000);
      continue;
    }
    gen = (await res.json()) as { address?: string; token?: string };
    break;
  }
  if (!gen?.address || !gen.token) throw new Error("nsfwgf: tempmail.lol generate failed");
  const token = gen.token;
  return {
    address: gen.address,
    readAll: async () => {
      const res = await fetch(`https://api.tempmail.lol/auth/${token}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json()) as {
        email?: Array<{ body?: string; html?: string }>;
      };
      return (data.email ?? [])
        .map((m) => `${m.html ?? ""}\n${m.body ?? ""}`)
        .join("\n");
    },
  };
}

/** Create a disposable inbox — mail.tm first, tempmail.lol fallback. */
async function createInbox(): Promise<DisposableInbox> {
  try {
    return await createInboxMailTm();
  } catch {
    return await createInboxTempMailLol();
  }
}

/** Poll the disposable inbox for the NextAuth magic link. */
async function pollMagicLink(inbox: DisposableInbox): Promise<string> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(6000);
    const bodies = await inbox.readAll();
    const m2 = bodies.match(/https?:\/\/[^"'<>\s]+api\/auth\/callback\/email[^"'<>\s]*/);
    if (m2) return m2[0].replace(/&amp;/g, "&");
  }
  throw new Error("nsfwgf: magic link timed out (120s)");
}

// ───────────────── account creation (magic link) ─────────────────

async function createAccount(): Promise<NsfwAccount> {
  const inbox = await createInbox();
  const jar: Record<string, string> = {};

  // 1. CSRF token.
  const csrfRes = await fetch(`${SITE}/api/auth/csrf`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  Object.assign(jar, parseCookies(csrfRes));
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // 2. Request the magic-link email.
  const signinRes = await fetch(`${SITE}/api/auth/signin/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": UA,
      cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({
      email: inbox.address,
      csrfToken,
      callbackUrl: `${SITE}/chat`,
      json: "true",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!signinRes.ok) {
    throw new Error(`nsfwgf: signin request failed (${signinRes.status})`);
  }

  // 3. Wait for the email, then complete the login (collect session cookie).
  const link = await pollMagicLink(inbox);
  let url = link;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { cookie: cookieHeader(jar), Accept: "text/html", "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    Object.assign(jar, parseCookies(res));
    const loc = res.headers.get("location");
    if (!loc) break;
    url = new URL(loc, url).href;
  }

  const cookie = cookieHeader(jar);
  // 4. Verify the session actually authenticated.
  const sess = await fetch(`${SITE}/api/auth/session`, {
    headers: { cookie, Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.json() as Promise<{ user?: { id?: string } }>);
  if (!sess?.user?.id) throw new Error("nsfwgf: session verification failed");

  return { cookie, email: inbox.address, used: 0 };
}

/** Get a usable account — single-flight creation with full-flow retries
 * (transient mail.tm throttling, slow magic-link delivery). */
function startCreation(): Promise<NsfwAccount> {
  if (!state.creating) {
    state.creating = (async () => {
      let lastErr: unknown = null;
      for (let flow = 0; flow < 3; flow++) {
        try {
          const acct = await createAccount();
          state.pool.push(acct);
          // Keep the pool tidy: drop exhausted accounts.
          state.pool = state.pool.filter((a) => a.used < SOFT_LIMIT).slice(-5);
          return acct;
        } catch (err) {
          lastErr = err;
          await sleep(8_000);
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error("nsfwgf: account creation failed");
    })();
    // Clear the single-flight slot when creation settles (success OR
    // failure) so a later demand can start a fresh creation.
    void state.creating.then(
      () => {
        state.creating = null;
      },
      () => {
        state.creating = null;
      },
    );
  }
  return state.creating;
}

async function getAccount(): Promise<NsfwAccount> {
  const healthy = state.pool.find((a) => a.used < SOFT_LIMIT);
  if (healthy) {
    maybePrefetch(healthy);
    return healthy;
  }
  return startCreation();
}

/** Fire-and-forget background creation so the NEXT rotation is instant
 * (shares the single-flight `creating` promise with getAccount). */
function maybePrefetch(active: NsfwAccount): void {
  if (active.used < PREFETCH_AT) return;
  if (state.creating) return;
  if (state.pool.some((a) => a.used === 0)) return; // a fresh one is ready
  // Warm the pool — errors are swallowed (rotation still works on demand).
  void startCreation().catch(() => {
    /* best-effort prefetch */
  });
}

// ───────────────────── request building ─────────────────────

/** System prompt used when the caller sends none. */
const DEFAULT_SYSPROMPT =
  "You are Ada, a helpful general-purpose AI assistant. Always answer questions directly, accurately and concisely.";

/**
 * Build the upstream envelope. `builtin:false` + custom char makes the
 * server adopt OUR sysprompt verbatim (live-verified) — the gateway's
 * system message becomes the persona definition.
 */
function buildNsfwgfBody(
  req: ProviderCompletionRequest,
  stream: boolean,
): Record<string, unknown> {
  const upstream = NSFWGF_MODELS.has(req.model.upstream)
    ? req.model.upstream
    : "lfm-7b";

  const systemTexts = req.messages
    .filter((m) => m.role === "system")
    .map((m) => (m.content ?? "").trim())
    .filter(Boolean);
  const sysprompt = systemTexts.length > 0 ? systemTexts.join("\n\n") : DEFAULT_SYSPROMPT;

  const date = msgDate();
  const history = req.messages.filter((m) => m.role !== "system");
  const inputMessages = history
    .map((m) => ({
      id: crypto.randomUUID(),
      type: "text",
      date,
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content ?? "",
    }))
    .filter((m) => m.content.length > 0);

  // Guard: the upstream needs at least one message.
  if (inputMessages.length === 0) {
    inputMessages.push({
      id: crypto.randomUUID(),
      type: "text",
      date,
      role: "user" as const,
      content: "Hello",
    });
  }

  return {
    builtin: false,
    char: {
      id: "custom",
      name: "Ada",
      sysprompt,
      description: "a helpful assistant",
      gender: "Female",
      shortName: "Ada",
      tone: "",
      extra: null,
      difficulty: 0,
    },
    char_id: "custom",
    session_id: randSessionId(),
    lang: "en",
    sysprompt,
    description: "a helpful assistant",
    input_messages: inputMessages,
    stream,
    model_type: upstream,
    isSummary: false,
    charname: "Ada",
    shortname: "Ada",
    username: "Guest",
    session_date: date,
    gender: "Female",
    userGender: "Unknown",
    // Ask for long outputs — honored only if the character server respects
    // OpenAI-style max_tokens; auto-continuation covers the case where it
    // doesn't (the observed default).
    max_tokens: 8192,
  };
}

// ───────────────────── upstream calls ─────────────────────

interface UpstreamError extends Error {
  code?: number;
  status?: number;
}

async function fetchUpstream(
  req: ProviderCompletionRequest,
  stream: boolean,
): Promise<Response> {
  let lastErr: UpstreamError | null = null;
  const triedCookies = new Set<string>();
  for (let attempt = 0; attempt < 4; attempt++) {
    // Skip pool accounts already proven exhausted during THIS request —
    // force a fresh account instead of burning another attempt on them.
    const candidate = state.pool.find(
      (a) => a.used < SOFT_LIMIT && !triedCookies.has(a.cookie),
    );
    const account = candidate ?? (await startCreation());
    const wasFresh = account.used === 0;
    triedCookies.add(account.cookie);
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "text/event-stream",
        "User-Agent": UA,
        Origin: SITE,
        Referer: `${SITE}/`,
        cookie: account.cookie,
      },
      body: JSON.stringify(buildNsfwgfBody(req, stream)),
      signal: req.signal,
    });

    if (res.ok) {
      account.used++;
      maybePrefetch(account);
      return res;
    }

    const errText = await res.text().catch(() => "");
    let code: number | undefined;
    try {
      code = (JSON.parse(errText) as { code?: number }).code;
    } catch {
      /* not JSON */
    }

    if (res.status === 401 && code !== undefined && ROTATE_CODES.has(code)) {
      // Cookie expired / account exhausted / anonymous-IP limit — evict
      // (also drop it from the pool) and rotate to a fresh account.
      account.used = SOFT_LIMIT;
      state.pool = state.pool.filter((a) => a !== account);
      lastErr = Object.assign(
        new Error(`nsfwgf: quota code ${code}, rotating account`),
        { code, status: res.status },
      );
      // A FRESH account failing with a quota code means the limit is keyed
      // on our egress IP (observed under heavy use) — more account rotation
      // cannot fix it within this request. Fail fast; the gateway breaker
      // handles degradation and the other providers absorb the traffic.
      if (wasFresh) {
        throw Object.assign(
          new Error(
            `nsfwgf: upstream rate limit (code ${code}) hit even with a fresh account — egress IP throttled`,
          ),
          { code, status: res.status },
        );
      }
      await sleep(600);
      continue;
    }

    // Non-recoverable (e.g. 40002 modeltype-need-vip, 5xx) — fail fast.
    throw Object.assign(
      new Error(
        `nsfwgf upstream HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`,
      ),
      { code, status: res.status },
    );
  }
  throw lastErr ?? new Error("nsfwgf: upstream retries exhausted");
}

/** Parse one SSE line → { delta, finish } (OpenAI-shaped chunks). */
function parseSseLine(line: string): { delta: string | null; finish: string | null } | null {
  const t = line.trim();
  if (!t.startsWith("data:")) return null;
  const raw = t.slice(5).trim();
  if (!raw || raw === "[DONE]") return null;
  try {
    const json = JSON.parse(raw) as {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
    };
    const choice = json.choices?.[0];
    const c = typeof choice?.delta?.content === "string" && choice.delta.content
      ? choice.delta.content
      : null;
    const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
    if (c || finish) return { delta: c, finish };
    return null;
  } catch {
    return null;
  }
}

/** Result of one upstream generation segment. */
interface SegmentResult {
  text: string;
  finishReason: string | null;
}

/**
 * Stream ONE upstream generation segment, yielding content deltas as they
 * arrive. Retries ONCE with a fresh session if the whole stream comes back
 * empty (sft-7b intermittently 200s with zero content — ~10% of requests).
 */
async function* segment(
  req: ProviderCompletionRequest,
): AsyncGenerator<string, SegmentResult, unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchUpstream(req, true);
    if (!res.body) throw new Error("nsfwgf: upstream returned no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let finishReason: string | null = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const parsed = parseSseLine(line);
          if (parsed?.delta) {
            text += parsed.delta;
            yield parsed.delta;
          }
          if (parsed?.finish) finishReason = parsed.finish;
        }
      }
      const tail = parseSseLine(buffer);
      if (tail?.delta) {
        text += tail.delta;
        yield tail.delta;
      }
      if (tail?.finish) finishReason = tail.finish;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* best-effort */
      }
    }
    if (text.length > 0) return { text, finishReason };
    // Empty 200 — one fresh retry before surfacing an error.
  }
  throw new Error("nsfwgf: upstream returned an empty response (after retry)");
}

// ───────────────────── auto-continuation (upstream output cap) ─────────────

/**
 * UPSTREAM CAP WORKAROUND — the root cause of "the AI stops whenever it
 * wants": the character server HARD-CAPS every generation at ~300
 * completion tokens (measured: 296 deltas / ~1.16k chars — deterministically
 * the same size every time) and labels it finish_reason "stop", so clients
 * cannot tell a cap hit from a natural end. `max_tokens` is ignored
 * upstream (verified live — identical capped output with 8192 requested).
 *
 * The ONLY way to deliver long outputs: CONTINUE. Feed the accumulated text
 * back as assistant context and re-request until the model signals a real
 * end (sub-cap segment, a DONE marker, or an empty continuation). To the
 * client this is one seamless stream.
 */
const SEGMENT_CAP_CHARS = 1000; // finish=stop segment ≥ this ⇒ likely a cap hit
const MAX_CONTINUATION_ROUNDS = 24; // ≈ 7k tokens total — effectively unlimited
const DONE_MARKER_RE = /^DONE\b/i;
/** Head/tail overlap window — models often re-emit the last few tokens of
 *  the cut-off text at the start of a continuation (e.g. segment ends
 *  "const directionalLight" and the continuation starts
 *  "const directionalLight = new …"). Trim that duplicated prefix. */
const OVERLAP_WINDOW = 600;
const CONTINUE_INSTRUCTION =
  "Continue your previous response EXACTLY from its last character — begin mid-word or mid-line if that is where it stopped. Do not repeat any text you already wrote. Output ONLY the continuation, no commentary. If the previous response was already complete, reply with exactly: DONE";

/** Longest suffix of `acc` that is also a prefix of `cont` (≥ 8 chars). */
function overlapTrimLen(acc: string, cont: string): number {
  const max = Math.min(acc.length, cont.length, OVERLAP_WINDOW);
  for (let k = max; k >= 8; k--) {
    if (acc.endsWith(cont.slice(0, k))) return k;
  }
  return 0;
}

function shouldContinue(roundText: string, finishReason: string | null): boolean {
  if (!roundText.trim()) return false;
  if (finishReason === "length") return true; // definitive cap signal
  // The upstream sometimes reports "stop" on cap hits (observed once per
  // model); capped segments land in a tight ~1050–1200 char band, so treat
  // near-cap-length stop segments as capped too. The DONE-marker swallow
  // makes the occasional false positive harmless (one wasted round).
  return roundText.length >= SEGMENT_CAP_CHARS;
}

async function* streamWithAutoContinue(
  req: ProviderCompletionRequest,
): AsyncGenerator<string, void, unknown> {
  const baseMessages = req.messages;
  let accumulated = "";

  // Round 0 — the original request.
  const first = yield* segment(req);
  accumulated += first.text;
  let roundText = first.text;
  let roundFinish = first.finishReason;

  for (let round = 1; round <= MAX_CONTINUATION_ROUNDS; round++) {
    if (req.signal?.aborted) return;
    if (!shouldContinue(roundText, roundFinish)) {
      console.error(`[NSFWGF-CONT] round ${round}: stopping (roundLen=${roundText.length} finish=${roundFinish})`);
      return;
    }
    console.error(`[NSFWGF-CONT] round ${round}: continuing (roundLen=${roundText.length} finish=${roundFinish})`);

    const contReq: ProviderCompletionRequest = {
      ...req,
      messages: [
        ...baseMessages,
        { role: "assistant", content: accumulated },
        { role: "user", content: CONTINUE_INSTRUCTION },
      ],
    };

    const gen = segment(contReq);
    let pending = ""; // hold-back buffer for DONE-marker + overlap detection
    let holding = true;
    let contText = ""; // RAW text of this round (for cap detection)
    let yieldedText = ""; // what the client actually sees (post-trim)
    let contFinish: string | null = null;
    let swallowed = false;
    try {
      while (true) {
        const n = await gen.next();
        if (n.done) {
          contFinish = (n.value as SegmentResult | undefined)?.finishReason ?? null;
          if (holding && pending) {
            if (DONE_MARKER_RE.test(pending.trimStart())) {
              swallowed = true;
            } else {
              const trim = overlapTrimLen(accumulated, pending);
              const out = pending.slice(trim);
              if (out) {
                yieldedText += out;
                yield out;
              }
            }
          }
          break;
        }
        const delta = n.value as string;
        contText += delta;
        if (holding) {
          pending += delta;
          if (DONE_MARKER_RE.test(pending.trimStart())) {
            swallowed = true;
            break;
          }
          if (pending.length >= OVERLAP_WINDOW) {
            // Full window available — decide the one-time trim, then flush.
            const trim = overlapTrimLen(accumulated, pending);
            const out = pending.slice(trim);
            if (out) {
              yieldedText += out;
              yield out;
            }
            holding = false;
            pending = "";
          }
        } else {
          yieldedText += delta;
          yield delta;
        }
      }
    } catch (err) {
      // A failed continuation round must NOT error the stream — the client
      // already holds a coherent (long) text; end gracefully instead.
      console.error(`[NSFWGF-CONT] round ${round}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      try {
        // Cast: gen.return()'s parameter must match the declared return type,
        // but we only ever use it to run the segment's cleanup path.
        await gen.return(undefined as unknown as SegmentResult);
      } catch {
        /* best-effort cleanup */
      }
    }

    if (swallowed) {
      console.error(`[NSFWGF-CONT] round ${round}: model replied DONE — natural end`);
      return; // model confirmed the text was already complete
    }
    if (!contText.trim()) {
      console.error(`[NSFWGF-CONT] round ${round}: empty continuation — natural end`);
      return;
    }
    console.error(
      `[NSFWGF-CONT] round ${round}: raw +${contText.length} chars, yielded +${yieldedText.length} (finish=${contFinish}) — continuing`,
    );
    accumulated += yieldedText;
    roundText = contText;
    roundFinish = contFinish;
  }
}

export const nsfwgfProvider: Provider = {
  id: "nsfwgf",

  async complete(req: ProviderCompletionRequest): Promise<{ text: string }> {
    let text = "";
    for await (const delta of streamWithAutoContinue(req)) {
      text += delta;
    }
    if (!text.trim()) {
      throw new Error("nsfwgf upstream returned an empty response");
    }
    return { text };
  },

  async *stream(req: ProviderCompletionRequest): AsyncGenerator<string, void, unknown> {
    yield* streamWithAutoContinue(req);
  },
};
