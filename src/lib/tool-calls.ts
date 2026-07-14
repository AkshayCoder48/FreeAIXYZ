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

/** Build the system directive that teaches the model how to call tools. */
export function buildToolSystemPrompt(
  tools: OAITool[],
  toolChoice?: OAIToolChoice,
): string {
  const lines: string[] = [
    "You have access to external tools. When you need to use one, output ONLY a tool-call block and nothing else. Do not explain, do not narrate — emit the block so the system can execute the tool and return the result.",
    "",
    "Tool-call format (output EXACTLY this, with no text before or after):",
    "```tool_call",
    '[{"name": "<function_name>", "arguments": {<json object>}}]',
    "```",
    "",
    "Rules:",
    "- The block contains a JSON array. Each element has `name` and `arguments`.",
    "- `arguments` MUST be a JSON object matching the function's parameters.",
    "- If you can answer without a tool, answer normally with no block.",
    "- Strings inside arguments must be properly escaped JSON.",
    "",
    "Available tools:",
  ];

  for (const t of tools) {
    if (t.type !== "function" || !t.function) continue;
    const f = t.function;
    const params = f.parameters
      ? JSON.stringify(f.parameters)
      : '{"type":"object","properties":{}}';
    lines.push(
      `- name: ${f.name}`,
      `  description: ${f.description ?? "(no description)"}`,
      `  parameters: ${params}`,
      "",
    );
  }

  if (toolChoice && typeof toolChoice === "object" && toolChoice.function) {
    lines.push(
      `You MUST call the tool "${toolChoice.function.name}" for this request. Emit only its tool_call block.`,
    );
  } else if (toolChoice === "required") {
    lines.push("You MUST call at least one tool for this request.");
  } else if (toolChoice === "none") {
    lines.push("Do NOT call any tools for this request. Answer directly.");
  } else {
    // "auto" — model decides
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

/** Parse a JSON string that should be a tool-call array or single object. */
function extractCallsFromJson(jsonStr: string): { name: string; arguments: unknown }[] {
  const trimmed = jsonStr.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return normalizeCalls(parsed);
  } catch {
    // Try to locate the first JSON array/object substring.
    const arrMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        return normalizeCalls(JSON.parse(arrMatch[0]));
      } catch {
        /* ignore */
      }
    }
    const objMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return normalizeCalls(JSON.parse(objMatch[0]));
      } catch {
        /* ignore */
      }
    }
    return [];
  }
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
  // Must contain both keys to be considered a tool call.
  if (!/"name"\s*:/.test(output) || !/"arguments"\s*:/.test(output)) {
    return null;
  }
  const arrMatch = output.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const calls = normalizeCalls(JSON.parse(arrMatch[0]));
      if (calls.length > 0) {
        return {
          calls,
          text: output.replace(arrMatch[0], "").trim(),
        };
      }
    } catch {
      /* ignore */
    }
  }
  const objMatch = output.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const calls = normalizeCalls(JSON.parse(objMatch[0]));
      if (calls.length > 0) {
        return {
          calls,
          text: output.replace(objMatch[0], "").trim(),
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Whether a request is asking us to do tool-calling. */
export function hasTools(tools?: OAITool[] | null): tools is OAITool[] {
  return Array.isArray(tools) && tools.length > 0;
}
