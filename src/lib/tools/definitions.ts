/**
 * Built-in tool DEFINITIONS (Tool PRD §7).
 *
 * This module is CLIENT-SAFE: it contains only the OpenAI-format tool
 * definitions + UI metadata — no SDK imports, no executors. The client
 * imports these to (a) render the tools toggle row and (b) include the
 * definitions in the request payload. The server-side executors live in
 * `src/lib/tools/registry.ts`.
 *
 * Keeping definitions and executors in separate modules guarantees:
 *   - the model-facing definition (this file) is importable anywhere;
 *   - the application-side executor never leaks into a client bundle;
 *   - a tool can NEVER be advertised to the model without an executor
 *     existing server-side (registry.ts imports this file and pairs
 *     each definition with its execute()).
 */

import type { OAITool } from "@/lib/openai-types";

export interface BuiltinToolMeta {
  /** Tool name (matches definition.function.name). */
  name: string;
  /** Human label for UI chips. */
  label: string;
  /** Short description shown in tooltips. */
  hint: string;
}

/** The maximum number of tool execution rounds per generation (PRD §23). */
export const MAX_TOOL_ROUNDS = 10;

/** Default tool_choice when tools are enabled (PRD §9 — never force). */
export const DEFAULT_TOOL_CHOICE = "auto" as const;

// ─── calculator ─────────────────────────────────────────────────────────────

const CALCULATOR_DEFINITION: OAITool = {
  type: "function",
  function: {
    name: "calculator",
    description:
      "Evaluate a mathematical expression with exact arithmetic. Supports + - * / % ^, parentheses, unary minus, and the functions sqrt, abs, round, floor, ceil, min, max, pow, log (base 10), ln, exp, sin, cos, tan, plus the constants pi and e. Use this for ANY numeric computation instead of computing by hand.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "The expression to evaluate, e.g. \"12345 * 6789\" or \"sqrt(2) * sin(pi/6)\".",
        },
      },
      required: ["expression"],
    },
  },
};

// ─── web_search ─────────────────────────────────────────────────────────────

const WEB_SEARCH_DEFINITION: OAITool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current information. Returns ranked results with title, url, host, date, and a snippet. Use this whenever the user asks about recent events, current facts, prices, releases, news, or anything you are not certain is up to date.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (keywords work better than sentences).",
        },
        num: {
          type: "number",
          description: "Number of results to return (1-8, default 5).",
        },
        recency_days: {
          type: "number",
          description:
            "Restrict results to the last N days (omit for no restriction).",
        },
      },
      required: ["query"],
    },
  },
};

// ─── get_current_time ───────────────────────────────────────────────────────

const GET_CURRENT_TIME_DEFINITION: OAITool = {
  type: "function",
  function: {
    name: "get_current_time",
    description:
      "Get the current date and time. Use this whenever the answer depends on 'now', 'today', or the current date/time.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

// ─── Registry surface (client-safe) ─────────────────────────────────────────

/** All built-in tool definitions in stable order. */
export const BUILTIN_TOOL_DEFINITIONS: readonly OAITool[] = [
  CALCULATOR_DEFINITION,
  WEB_SEARCH_DEFINITION,
  GET_CURRENT_TIME_DEFINITION,
];

/** UI metadata for the tools toggle row (same order as definitions). */
export const BUILTIN_TOOL_META: readonly BuiltinToolMeta[] = [
  {
    name: "calculator",
    label: "Calculator",
    hint: "Exact arithmetic for any numeric computation",
  },
  {
    name: "web_search",
    label: "Web search",
    hint: "Live web results for current information",
  },
  {
    name: "get_current_time",
    label: "Time",
    hint: "Current date and time",
  },
];

/** Look up a built-in definition by tool name. */
export function findBuiltinToolDefinition(
  name: string,
): OAITool | undefined {
  return BUILTIN_TOOL_DEFINITIONS.find((t) => t.function.name === name);
}
