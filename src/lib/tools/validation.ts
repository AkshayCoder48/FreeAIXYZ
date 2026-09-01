/**
 * Tool schema validation (Tool PRD §6).
 *
 * Validates + NORMALIZES the OpenAI `tools`, `tool_choice` and
 * `parallel_tool_calls` request fields BEFORE any provider request is
 * built. Malformed tools are rejected with a TOOL_SCHEMA_INVALID
 * GatewayError — never forwarded upstream, never silently dropped.
 *
 * Also exposes the NATIVE_TOOL_PROVIDERS set (§16/§17) — providers whose
 * upstream API accepts OpenAI `tools` / `tool_choice` /
 * `parallel_tool_calls` directly. Every other provider uses the prompt
 * emulation path (tool definitions serialized into a system prompt).
 */

import { GatewayError } from "@/lib/gateway/errors";
import type { OAITool, OAIToolChoice } from "@/lib/openai-types";

/** Tool name rule (OpenAI): 1-64 chars of [a-zA-Z0-9_-]. */
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_TOOLS_PER_REQUEST = 128;
const MAX_TOOL_DESCRIPTION_CHARS = 4096;

/** Validated + normalized tool request parameters. */
export interface ValidatedToolParams {
  /** Normalized tools (definition order preserved). */
  tools: OAITool[];
  /** Preserved verbatim — string OR forced-function object form (PRD §9). */
  toolChoice: OAIToolChoice | undefined;
  /** Preserved when provided (PRD §5). */
  parallelToolCalls: boolean | undefined;
}

/** Whether the request carries a non-empty tools array. */
export function hasToolField(tools: unknown): tools is OAITool[] {
  return Array.isArray(tools) && tools.length > 0;
}

/**
 * Validate + normalize the tool request fields (PRD §6).
 *
 * Returns normalized params, or throws GatewayError TOOL_SCHEMA_INVALID
 * (HTTP 400) describing the first problem found. An EMPTY tools array is
 * treated as "no tools" (OpenAI SDKs send `[]` when a tools list empties).
 */
export function validateToolParams(body: {
  tools?: unknown;
  tool_choice?: unknown;
  parallel_tool_calls?: unknown;
}): ValidatedToolParams {
  // ─── tools ────────────────────────────────────────────────────────────────
  let tools: OAITool[] = [];
  if (hasToolField(body.tools)) {
    if (body.tools.length > MAX_TOOLS_PER_REQUEST) {
      throw new GatewayError({
        type: "TOOL_SCHEMA_INVALID",
        message: `Too many tools: ${body.tools.length} (max ${MAX_TOOLS_PER_REQUEST}).`,
      });
    }
    tools = body.tools.map((raw, i) => {
      const err = (message: string) =>
        new GatewayError({
          type: "TOOL_SCHEMA_INVALID",
          message: `tools[${i}]: ${message}`,
        });
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw err("must be an object");
      }
      const t = raw as unknown as Record<string, unknown>;
      if (t.type !== "function") {
        throw err(`type must be "function" (got ${JSON.stringify(t.type)})`);
      }
      const fn = t.function;
      if (!fn || typeof fn !== "object" || Array.isArray(fn)) {
        throw err("missing required field \"function\"");
      }
      const f = fn as Record<string, unknown>;
      if (typeof f.name !== "string" || !TOOL_NAME_RE.test(f.name)) {
        throw err(
          `function.name must match ${TOOL_NAME_RE} (got ${JSON.stringify(f.name)})`,
        );
      }
      if (
        f.description !== undefined &&
        (typeof f.description !== "string" ||
          f.description.length > MAX_TOOL_DESCRIPTION_CHARS)
      ) {
        throw err("function.description must be a string ≤ 4096 chars");
      }
      if (
        f.parameters !== undefined &&
        (typeof f.parameters !== "object" ||
          f.parameters === null ||
          Array.isArray(f.parameters))
      ) {
        throw err("function.parameters must be a JSON Schema object");
      }
      return {
        type: "function",
        function: {
          name: f.name,
          description: typeof f.description === "string" ? f.description : "",
          parameters:
            f.parameters && typeof f.parameters === "object"
              ? (f.parameters as Record<string, unknown>)
              : { type: "object", properties: {}, required: [] },
        },
      };
    });
  }

  // ─── tool_choice ─────────────────────────────────────────────────────────
  let toolChoice: OAIToolChoice | undefined;
  if (body.tool_choice !== undefined && body.tool_choice !== null) {
    const tc = body.tool_choice;
    if (tc === "auto" || tc === "none" || tc === "required") {
      toolChoice = tc;
    } else if (
      tc &&
      typeof tc === "object" &&
      !Array.isArray(tc) &&
      (tc as { type?: unknown }).type === "function" &&
      typeof (tc as { function?: { name?: unknown } }).function?.name === "string" &&
      TOOL_NAME_RE.test((tc as { function: { name: string } }).function.name)
    ) {
      toolChoice = {
        type: "function",
        function: { name: (tc as { function: { name: string } }).function.name },
      };
    } else {
      throw new GatewayError({
        type: "TOOL_SCHEMA_INVALID",
        message:
          "tool_choice must be \"auto\" | \"none\" | \"required\" or {type:\"function\",function:{name}}",
      });
    }
  }

  // ─── parallel_tool_calls ─────────────────────────────────────────────────
  let parallelToolCalls: boolean | undefined;
  if (
    body.parallel_tool_calls !== undefined &&
    body.parallel_tool_calls !== null
  ) {
    if (typeof body.parallel_tool_calls !== "boolean") {
      throw new GatewayError({
        type: "TOOL_SCHEMA_INVALID",
        message: "parallel_tool_calls must be a boolean",
      });
    }
    parallelToolCalls = body.parallel_tool_calls;
  }

  return { tools, toolChoice, parallelToolCalls };
}

/**
 * Providers whose upstream API natively accepts OpenAI tools/tool_choice/
 * parallel_tool_calls (PRD §16, §17). These get the REAL API fields — never
 * the prompt emulation. Every provider NOT in this set gets the fenced
 * ```tool_call prompt emulation (their upstreams have no tools API).
 */
export const NATIVE_TOOL_PROVIDERS: ReadonlySet<string> = new Set([
  "opencode", // opencode.ai/zen/v1 — OpenAI-compatible
  "kilocode", // kilocode.dev (OpenRouter-compatible)
  "llm7", // llm7.io
  "gptoss", // gpt-oss
  "swarm", // g4f swarm
  "uncloseai", // uncloseai.com
  "freegpt", // freegpt.tech (currently delisted, kept for parity)
]);

/** Whether a provider id gets real API tools (vs prompt emulation). */
export function isNativeToolProvider(providerId: string): boolean {
  return NATIVE_TOOL_PROVIDERS.has(providerId);
}

/**
 * Tool availability system line for NATIVE-tools providers (PRD §8).
 * The actual tool definitions still travel in the API `tools` field —
 * this line only reinforces availability, it is NEVER a substitute.
 */
export const TOOL_AVAILABILITY_SYSTEM_PROMPT =
  "You have access to the tools provided in this request. Use an appropriate tool when the user's request requires it. Do not claim that tools are unavailable when a relevant tool is provided.";
