/**
 * OpenAI tool/function-calling adapter for text-only models.
 *
 * Toolbaz exposes a plain text-in/text-out interface — it has no native
 * function-calling support. To honor the OpenAI `tools` API we:
 *
 *   1. Inject a system directive describing each tool and the exact JSON
 *      envelope the model should emit when it wants to call one.
 *   2. Reconstruct prior `assistant.tool_calls` and `tool` results as plain
 *      text in the conversation so the model sees the full history.
 *   3. Parse the model's text output for that JSON envelope and, if found,
 *      convert it into a proper OpenAI `tool_calls` response.
 *
 * The envelope is a fenced JSON block so it survives markdown rendering and
 * is unambiguous to extract:
 *
 *   ```tool_call
 *   [{"name":"get_weather","arguments":{"location":"Boston"}}]
 *   ```
 */

import type {
  OAIChatMessage,
  OAITool,
  OAIToolCall,
  OAIToolChoice,
} from "@/lib/openai-types";

const TOOL_CALL_FENCE_OPEN = "```tool_call";
const TOOL_CALL_FENCE_CLOSE = "```";

/**
 * Compactify a JSON Schema parameter spec into a short signature string.
 * e.g. { userId: string*, amount: number, items: string[] }
 *   where * marks required params.
 */
function compactParams(parameters: unknown): string {
  if (!parameters || typeof parameters !== "object") return "{}";
  const schema = parameters as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>((schema.required as string[]) ?? []);
  const parts: string[] = [];
  for (const [key, val] of Object.entries(props)) {
    let type = "any";
    if (val && typeof val === "object") {
      const t = (val as Record<string, unknown>).type;
      if (t === "array") {
        const items = (val as Record<string, unknown>).items as
          | Record<string, unknown>
          | undefined;
        const itemType = (items?.type as string) ?? "any";
        type = `${itemType}[]`;
      } else if (typeof t === "string") {
        type = t;
      } else if ((val as Record<string, unknown>).enum) {
        const opts = ((val as Record<string, unknown>).enum as unknown[]) ?? [];
        type = opts.slice(0, 4).map(String).join("|");
        if (opts.length > 4) type += "|...";
      }
    }
    parts.push(`${key}: ${type}${required.has(key) ? "*" : ""}`);
  }
  return `{ ${parts.join(", ")} }`;
}

/** Truncate a description to a single short line. */
function shortDesc(desc: string | undefined, max = 100): string {
  if (!desc) return "";
  const one = desc.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Build a COMPACT system directive that teaches the model how to call tools.
 *
 * Each tool is ONE line: `name({ params }) - description`. This keeps the
 * prompt small even with many tools (36 tools ≈ 3KB vs 25KB with full JSON
 * schemas), so the model actually retains the entire tool list instead of
 * hallucinating.
 */
export function buildToolSystemPrompt(
  tools: OAITool[],
  toolChoice?: OAIToolChoice,
): string {
  const fnTools = tools.filter((t) => t.type === "function" && t.function);
  // Shorter descriptions when there are many tools, to keep the prompt compact.
  const descMax = fnTools.length > 20 ? 60 : fnTools.length > 10 ? 80 : 120;

  const lines: string[] = [
    "You are a tool-calling assistant. You have tools available. When a request needs one, respond with ONLY a tool_call block (no other text):",
    "```tool_call",
    '[{"name":"<tool_name>","arguments":{"<param>":"<value>"}}]',
    "```",
    "Rules: emit the block with no text before/after. Use ONLY tool names from the list below. Arguments must match the params shown (* = required). If no tool is needed, answer normally.",
    "",
    `Tools (${fnTools.length} available):`,
  ];

  for (const t of fnTools) {
    const f = t.function;
    const params = compactParams(f.parameters);
    const desc = shortDesc(f.description, descMax);
    lines.push(`- ${f.name}(${params})${desc ? " — " + desc : ""}`);
  }

  if (toolChoice && typeof toolChoice === "object" && toolChoice.function) {
    lines.push(
      `\nYou MUST call "${toolChoice.function.name}". Emit only its tool_call block.`,
    );
  } else if (toolChoice === "required") {
    lines.push("\nYou MUST call at least one tool for this request.");
  } else if (toolChoice === "none") {
    lines.push("\nDo NOT call any tools. Answer directly.");
  }

  return lines.join("\n");
}

/**
 * Serialize a single message to plain text for the upstream prompt.
 * Handles assistant tool_calls and tool-result messages by rendering them as
 * readable text the model can reason over.
 */
export function messageToText(m: OAIChatMessage): string | null {
  switch (m.role) {
    case "system":
      return m.content ?? null;
    case "user":
      return m.content ?? null;
    case "assistant": {
      const parts: string[] = [];
      if (m.content) parts.push(m.content);
      if (m.tool_calls && m.tool_calls.length > 0) {
        const calls = m.tool_calls.map((tc) => ({
          name: tc.function.name,
          arguments: safeParseArgs(tc.function.arguments),
        }));
        parts.push(`${TOOL_CALL_FENCE_OPEN}\n${JSON.stringify(calls)}\n${TOOL_CALL_FENCE_CLOSE}`);
      }
      return parts.length > 0 ? parts.join("\n\n") : null;
    }
    case "tool": {
      const name = m.name ?? "tool";
      return `[tool result for ${name}${m.tool_call_id ? ` (${m.tool_call_id})` : ""}]\n${m.content ?? ""}`;
    }
    case "function": {
      return `[function result]\n${m.content ?? ""}`;
    }
    default:
      return m.content ?? null;
  }
}

/** Safely parse tool-call arguments that OpenAI passes as a JSON string. */
function safeParseArgs(args: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { _raw: args };
  }
}

export interface ParsedToolCalls {
  /** The tool calls extracted from the model output (may be empty). */
  toolCalls: OAIToolCall[];
  /** Remaining text after removing the tool-call block(s). */
  text: string;
  /** Raw envelope JSON objects, before id assignment. */
  raw: { name: string; arguments: unknown }[];
}

/**
 * Parse the model's text output for tool-call blocks. Returns the extracted
 * calls (with generated ids) plus any leftover text.
 *
 * Handles a few common model quirks: missing fence, single object instead of
 * array, arguments as a stringified JSON, etc.
 */
export function parseToolCalls(
  output: string,
  idGenerator: () => string,
): ParsedToolCalls {
  const raw: { name: string; arguments: unknown }[] = [];
  let text = output;

  // Pattern 1: fenced ```tool_call ... ``` block(s)
  const fenceRe = new RegExp(
    `${escapeRe(TOOL_CALL_FENCE_OPEN)}\\s*([\\s\\S]*?)${escapeRe(TOOL_CALL_FENCE_CLOSE)}`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(output)) !== null) {
    const parsed = extractCallsFromJson(match[1]);
    raw.push(...parsed);
  }
  text = text.replace(fenceRe, "").trim();

  // Pattern 1b: some models use ```json or ``` (generic) for the fence.
  // Accept any fenced block whose content parses to a tool call.
  if (raw.length === 0) {
    const genericFenceRe = /```[a-z]*\s*\n?([\s\S]*?)```/g;
    while ((match = genericFenceRe.exec(output)) !== null) {
      const inner = match[1].trim();
      if (/(\\*)"?name"?\s*:/.test(inner) && /(\\*)"?arguments"?\s*:/.test(inner)) {
        const parsed = extractCallsFromJson(inner);
        raw.push(...parsed);
      }
    }
    text = text.replace(genericFenceRe, "").trim();
  }

  // Pattern 2: if no fenced block found, look for a bare JSON array/object
  // that looks like a tool call (has "name" and "arguments" keys).
  if (raw.length === 0) {
    const bare = tryBareToolCall(output);
    if (bare) {
      raw.push(...bare.calls);
      text = bare.text;
    }
  }

  const toolCalls: OAIToolCall[] = raw.map((r) => ({
    id: idGenerator(),
    type: "function" as const,
    function: {
      name: r.name,
      arguments:
        typeof r.arguments === "string"
          ? r.arguments
          : JSON.stringify(r.arguments ?? {}),
    },
  }));

  return { toolCalls, text, raw };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Attempt to JSON.parse a string using several unescaping strategies.
 * Models are inconsistent: some emit clean JSON (`{"name":"x"}`), others
 * emit escaped quotes (`{\"name\":\"x\"}`) or even double-escaped
 * (`{\\\"name\\\":\\\"x\\\"}`). We try each variant until one parses.
 */
function tryParseJsonLoose(s: string): unknown | null {
  const candidates: string[] = [s];

  // Strategy 1: unescape literal \" → "
  if (s.includes('\\"')) {
    candidates.push(s.replace(/\\"/g, '"'));
  }
  // Strategy 2: unescape \\\" → " (double-escaped)
  if (s.includes('\\\\"')) {
    candidates.push(s.replace(/\\"/g, '"'));
  }
  // Strategy 3: remove all backslashes before quotes
  if (/\\+"/.test(s)) {
    candidates.push(s.replace(/\\+"/g, '"'));
  }

  for (const candidate of candidates) {
    // Try the full string first
    try {
      return JSON.parse(candidate);
    } catch {
      /* try sub-match */
    }
    // Try extracting the first JSON array
    const arrMatch = candidate.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return JSON.parse(arrMatch[0]);
      } catch {
        /* try next */
      }
    }
    // Try extracting the first JSON object
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

/** Parse a JSON string that should be a tool-call array or single object. */
function extractCallsFromJson(jsonStr: string): { name: string; arguments: unknown }[] {
  const trimmed = jsonStr.trim();
  if (!trimmed) return [];
  const parsed = tryParseJsonLoose(trimmed);
  if (parsed !== null) {
    return normalizeCalls(parsed);
  }
  return [];
}

function normalizeCalls(parsed: unknown): { name: string; arguments: unknown }[] {
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: { name: string; arguments: unknown }[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = obj.name ?? obj.function_name ?? obj.tool;
    if (typeof name !== "string") continue;
    let args = obj.arguments ?? obj.args ?? obj.parameters ?? {};
    // Some models stringify arguments. Keep as object; we re-stringify later.
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // leave as string, will be passed through verbatim
      }
    }
    out.push({ name, arguments: args });
  }
  return out;
}

/** Look for a bare JSON tool-call object/array not wrapped in a fence. */
function tryBareToolCall(
  output: string,
): { calls: { name: string; arguments: unknown }[]; text: string } | null {
  // Must contain both keys (allowing escaped quotes) to be considered a tool call.
  if (!/(\\*)"?name"?\s*:/.test(output) || !/(\\*)"?arguments"?\s*:/.test(output)) {
    return null;
  }
  const arrMatch = output.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const parsed = tryParseJsonLoose(arrMatch[0]);
    if (parsed) {
      const calls = normalizeCalls(parsed);
      if (calls.length > 0) {
        return {
          calls,
          text: output.replace(arrMatch[0], "").trim(),
        };
      }
    }
  }
  const objMatch = output.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const parsed = tryParseJsonLoose(objMatch[0]);
    if (parsed) {
      const calls = normalizeCalls(parsed);
      if (calls.length > 0) {
        return {
          calls,
          text: output.replace(objMatch[0], "").trim(),
        };
      }
    }
  }
  return null;
}

/** Whether a request is asking us to do tool-calling. */
export function hasTools(tools?: OAITool[] | null): tools is OAITool[] {
  return Array.isArray(tools) && tools.length > 0;
}
