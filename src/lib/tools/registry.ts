/**
 * Built-in tool REGISTRY — server-side executors (Tool PRD §7).
 *
 * Pairs every definition from `definitions.ts` with an application-side
 * executor. The executor is NEVER sent to the model; the definition is
 * NEVER used without an executor. Import this module ONLY from server
 * code (API routes / route handlers) — it pulls in z-ai-web-dev-sdk.
 */

import {
  BUILTIN_TOOL_DEFINITIONS,
  findBuiltinToolDefinition,
} from "@/lib/tools/definitions";
import type { OAITool } from "@/lib/openai-types";

export interface RegisteredTool {
  definition: OAITool;
  execute(
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

/** Hard cap on a serialized tool result before truncation kicks in (PRD §25). */
export const MAX_TOOL_RESULT_CHARS = 20_000;

// ─── calculator: safe recursive-descent evaluator ────────────────────────────

interface CalcToken {
  kind: "num" | "ident" | "op";
  value: string;
}

/** Tokenize an arithmetic expression. Throws on illegal characters. */
function tokenizeExpr(src: string): CalcToken[] {
  // Normalize common unicode math characters.
  let s = src
    .replace(/[×✕]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-");
  // Thousands separators: "1,234,567" → "1234567". ONLY strip a comma that
  // sits DIRECTLY between digits with a 3-digit group after it (repeatedly,
  // so multi-group numbers collapse). Function-argument commas ("min(3, 1, 2)")
  // have a space after the comma and are never touched.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/(\d),(\d{3})(?=\D|$)/g, "$1$2");
  } while (s !== prev);
  const tokens: CalcToken[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9._]/.test(s[j])) j++;
      const raw = s.slice(i, j).replace(/_/g, "");
      if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(raw)) {
        throw new Error(`Malformed number "${raw}"`);
      }
      tokens.push({ kind: "num", value: raw });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[a-zA-Z_0-9]/.test(s[j])) j++;
      tokens.push({ kind: "ident", value: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return tokens;
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

const FUNCTIONS: Record<string, (...xs: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  pow: (a, b) => Math.pow(a, b),
  log: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
};

/** Recursive-descent parser → number. NO eval, NO Function() — safe by construction. */
function evaluateExpression(src: string): number {
  const tokens = tokenizeExpr(src);
  let pos = 0;
  const peek = (): CalcToken | undefined => tokens[pos];
  const eat = (kind: CalcToken["kind"], value?: string): CalcToken => {
    const t = tokens[pos];
    if (!t || t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(
        `Expected ${value ?? kind} but found ${t ? `"${t.value}"` : "end of expression"}`,
      );
    }
    pos++;
    return t;
  };

  // expr := term (('+' | '-') term)*
  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek()?.kind === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = eat("op").value;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  // term := factor (('*' | '/' | '%') factor)*
  const parseTerm = (): number => {
    let left = parseFactor();
    while (peek()?.kind === "op" && ["*", "/", "%"].includes(peek()!.value)) {
      const op = eat("op").value;
      const right = parseFactor();
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  };

  // unary := ('-' | '+') unary | power — unary binds LOOSER than '^' so
  // -2^2 = -(2^2) = -4 (standard math convention).
  // factor := unary ('^' factor)?   (right-associative power)
  const parseFactor = (): number => {
    if (peek()?.kind === "op" && (peek()!.value === "-" || peek()!.value === "+")) {
      const op = eat("op").value;
      const value = parseFactor();
      return op === "-" ? -value : value;
    }
    return parsePower();
  };

  // power := primary ('^' factor)?   (right-associative)
  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek()?.kind === "op" && peek()!.value === "^") {
      eat("op");
      const exponent = parseFactor();
      return Math.pow(base, exponent);
    }
    return base;
  };

  // primary := number | constant | function '(' expr (',' expr)* ')' | '(' expr ')'
  const parsePrimary = (): number => {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.kind === "num") {
      eat("num");
      return Number(t.value);
    }
    if (t.kind === "ident") {
      eat("ident");
      if (peek()?.kind === "op" && peek()!.value === "(") {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new Error(`Unknown function "${t.value}"`);
        eat("op", "(");
        const args: number[] = [parseExpr()];
        while (peek()?.kind === "op" && peek()!.value === ",") {
          eat("op", ",");
          args.push(parseExpr());
        }
        eat("op", ")");
        return fn(...args);
      }
      if (t.value in CONSTANTS) return CONSTANTS[t.value];
      throw new Error(`Unknown identifier "${t.value}"`);
    }
    if (t.kind === "op" && t.value === "(") {
      eat("op", "(");
      const value = parseExpr();
      eat("op", ")");
      return value;
    }
    throw new Error(`Unexpected token "${t.value}"`);
  };

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new Error(`Unexpected trailing input "${tokens[pos]?.value ?? ""}"`);
  }
  if (!Number.isFinite(result)) {
    throw new Error("Expression evaluated to a non-finite number");
  }
  return result;
}

/** Format a calculator result compactly (up to 12 significant digits). */
function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toString();
  const rounded = Number(n.toPrecision(12));
  return String(rounded);
}

async function executeCalculator(
  args: Record<string, unknown>,
): Promise<unknown> {
  const expression = args.expression;
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("calculator requires a non-empty string \"expression\"");
  }
  const value = evaluateExpression(expression);
  return {
    expression,
    result: formatNumber(value),
  };
}

// ─── get_current_time ───────────────────────────────────────────────────────

async function executeGetCurrentTime(): Promise<unknown> {
  const now = new Date();
  return {
    utc: now.toISOString(),
    unix_seconds: Math.floor(now.getTime() / 1000),
    note: "UTC timestamp; convert to the user's timezone when the answer mentions local time.",
  };
}

// ─── web_search (z-ai-web-dev-sdk — server-side only) ──────────────────────

interface SearchItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
  date: string;
  favicon: string;
}

interface ZaiClient {
  functions: {
    invoke: (
      name: "web_search",
      args: { query: string; num?: number; recency_days?: number },
    ) => Promise<SearchItem[]>;
  };
}

let zaiPromise: Promise<ZaiClient> | null = null;

/**
 * Lazily construct the ZAI client. The SDK reads `.z-ai-config` from
 * cwd / $HOME / /etc. On serverless hosts (Vercel) none of those exist or
 * are writable, so we support ZAI_BASE_URL + ZAI_API_KEY env vars by
 * materializing a throwaway config file — trying the cwd first, then
 * /tmp with a temporary process.chdir (the SDK resolves process.cwd()
 * at call time; serverless roots are read-only but /tmp is writable).
 */
async function getZai(): Promise<ZaiClient> {
  if (!zaiPromise) {
    zaiPromise = (async (): Promise<ZaiClient> => {
      const mod = (await import("z-ai-web-dev-sdk")) as {
        default: { create: () => Promise<ZaiClient> };
      };
      try {
        return await mod.default.create();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/config/i.test(msg) && process.env.ZAI_BASE_URL && process.env.ZAI_API_KEY) {
          const fs = await import("node:fs/promises");
          const os = await import("node:os");
          const path = await import("node:path");
          const config = JSON.stringify({
            baseUrl: process.env.ZAI_BASE_URL,
            apiKey: process.env.ZAI_API_KEY,
          });
          // Writable candidates: the project cwd (sandbox/dev) then /tmp
          // (Vercel serverless — the root filesystem is EROFS).
          const candidates = [
            path.join(process.cwd(), ".z-ai-config"),
            path.join(os.tmpdir(), ".z-ai-config"),
          ];
          let written: string | null = null;
          for (const p of candidates) {
            try {
              await fs.writeFile(p, config, "utf8");
              written = p;
              break;
            } catch {
              /* read-only fs — try the next candidate */
            }
          }
          if (written) {
            const dir = path.dirname(written);
            const prevCwd = process.cwd();
            let changedDir = false;
            try {
              if (dir !== prevCwd) {
                process.chdir(dir);
                changedDir = true;
              }
              return await mod.default.create();
            } finally {
              if (changedDir) {
                try {
                  process.chdir(prevCwd);
                } catch {
                  /* best-effort restore */
                }
              }
            }
          }
        }
        throw err;
      }
    })();
  }
  return zaiPromise;
}

/** Strip HTML tags + decode common entities (for the DDG-lite fallback). */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DuckDuckGo fallback for hosts where the ZAI SDK endpoint is unreachable
 * (e.g. Vercel serverless → the internal API is network-blocked). Uses the
 * keyless lite.duckduckgo.com HTML page — anchor/snippet pairs parsed in
 * document order. Returns REAL live results so the web_search tool keeps
 * working outside the sandbox.
 */
async function duckDuckGoSearch(
  query: string,
  num: number,
  signal?: AbortSignal,
): Promise<Array<{ title: string; url: string; host: string; snippet: string }>> {
  const res = await fetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
      signal,
    },
  );
  if (!res.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  }
  const html = await res.text();
  const links: Array<{ url: string; title: string }> = [];
  const snippets: string[] = [];
  const linkRe = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const title = htmlToText(m[2]);
    if (title && m[1].startsWith("http")) links.push({ url: m[1], title });
  }
  while ((m = snipRe.exec(html)) !== null) {
    snippets.push(htmlToText(m[1]));
  }
  return links.slice(0, num).map((l, i) => {
    let host = "";
    try {
      host = new URL(l.url).hostname;
    } catch {
      host = "";
    }
    return { title: l.title, url: l.url, host, snippet: snippets[i] ?? "" };
  });
}

/**
 * Wikipedia search fallback — the MediaWiki API is keyless and reliably
 * reachable from serverless hosts. Real live results (encyclopedic).
 */
async function wikipediaSearch(
  query: string,
  num: number,
  signal?: AbortSignal,
): Promise<Array<{ title: string; url: string; host: string; snippet: string }>> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${num}`,
    {
      headers: {
        "User-Agent": "FreeAIXYZ-gateway/2.0 (tool: web_search)",
        Accept: "application/json",
      },
      signal,
    },
  );
  if (!res.ok) {
    throw new Error(`Wikipedia returned HTTP ${res.status}`);
  }
  const j = (await res.json()) as {
    query?: { search?: Array<{ title: string; snippet?: string }> };
  };
  return (j.query?.search ?? []).slice(0, num).map((s) => ({
    title: s.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
    host: "en.wikipedia.org",
    snippet: htmlToText(s.snippet ?? ""),
  }));
}

async function executeWebSearch(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const query = args.query;
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("web_search requires a non-empty string \"query\"");
  }
  const num = typeof args.num === "number" && args.num > 0
    ? Math.min(Math.floor(args.num), 8)
    : 5;
  const recencyDays =
    typeof args.recency_days === "number" && args.recency_days > 0
      ? Math.floor(args.recency_days)
      : undefined;

  // Primary: the ZAI search function (sandbox / hosts that can reach it).
  try {
    const zai = await getZai();
    const results = await zai.functions.invoke("web_search", {
      query: query.trim(),
      num,
      ...(recencyDays !== undefined ? { recency_days: recencyDays } : {}),
    });
    const items = (Array.isArray(results) ? results : []).slice(0, num).map((r) => ({
      title: r.name,
      url: r.url,
      host: r.host_name,
      date: r.date || undefined,
      snippet: r.snippet,
    }));
    if (items.length > 0) {
      return {
        query: query.trim(),
        result_count: items.length,
        provider: "zai",
        results: items,
      };
    }
  } catch {
    // ZAI unavailable (e.g. serverless network policy) — fall through to
    // the public fallback chain below. Never a silent failure: if every
    // provider fails the caller surfaces the structured error (PRD §25).
  }

  // Fallback chain: DuckDuckGo lite → Wikipedia API.
  let ddgErr: unknown = null;
  try {
    const items = await duckDuckGoSearch(query.trim(), num, signal);
    if (items.length > 0) {
      return {
        query: query.trim(),
        result_count: items.length,
        provider: "duckduckgo",
        results: items,
      };
    }
  } catch (err) {
    ddgErr = err;
  }
  try {
    const items = await wikipediaSearch(query.trim(), num, signal);
    if (items.length > 0) {
      return {
        query: query.trim(),
        result_count: items.length,
        provider: "wikipedia",
        results: items,
      };
    }
  } catch {
    /* fall through to the structured error */
  }
  throw ddgErr instanceof Error
    ? ddgErr
    : new Error("web_search failed: no search provider returned results.");
}

// ─── Registry ───────────────────────────────────────────────────────────────

const EXECUTORS: Record<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>> = {
  calculator: executeCalculator,
  web_search: executeWebSearch,
  get_current_time: executeGetCurrentTime,
};

/** The complete registry: definition + executor, per tool name. */
export const toolRegistry: Record<string, RegisteredTool> =
  Object.fromEntries(
    BUILTIN_TOOL_DEFINITIONS.map((definition) => {
      const name = definition.function.name;
      const executor = EXECUTORS[name];
      if (!executor) {
        throw new Error(`Tool "${name}" has a definition but no executor`);
      }
      return [name, { definition, execute: executor }];
    }),
  );

/** Whether a tool name exists in the registry (definition + executor). */
export function hasToolExecutor(name: string): boolean {
  return name in toolRegistry;
}

/** Execute a registry tool by name. Throws on unknown tool / invalid args. */
export async function executeRegisteredTool(
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const tool = toolRegistry[name];
  if (!tool) {
    throw new Error(`Unknown tool "${name}"`);
  }
  const parsedArgs: Record<string, unknown> =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  if (signal?.aborted) throw new Error("Tool execution aborted");
  return tool.execute(parsedArgs, signal);
}

/** Truncate a serialized tool result to protect the model context (PRD §25). */
export function clampToolResult(
  name: string,
  payload: unknown,
): { result: unknown; truncated: boolean; chars: number } {
  const serialized = JSON.stringify(payload) ?? "null";
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) {
    return { result: payload, truncated: false, chars: serialized.length };
  }
  return {
    result: {
      success: false,
      error: "Tool result exceeded context limit.",
      tool: name,
      original_chars: serialized.length,
      limit: MAX_TOOL_RESULT_CHARS,
      partial: serialized.slice(0, MAX_TOOL_RESULT_CHARS),
    },
    truncated: true,
    chars: serialized.length,
  };
}

// Re-export for callers that only need the definition side.
export { findBuiltinToolDefinition };
