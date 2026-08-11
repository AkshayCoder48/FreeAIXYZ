/** OpenAI-compatible type definitions shared by the API routes. */

export interface OAIToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OAITool {
  type: "function";
  function: OAIToolFunction;
}

export interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OAIChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OAIToolCall[];
}

export type OAIToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface OAIChatCompletionRequest {
  model: string;
  messages: OAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number | null;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  n?: number | null;
  user?: string;
  tools?: OAITool[];
  tool_choice?: OAIToolChoice;
  /** Enable live web search for grounded, up-to-date answers. */
  web_search?: boolean;
  [key: string]: unknown;
}

export interface OAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OAIToolCall[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface OAIModelList {
  object: "list";
  data: OAIModel[];
}

export interface OAIError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

/** Very rough token estimate (~4 chars/token) — good enough for usage stats. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

let counter = 0;
/** Generate an OpenAI-style completion id. */
export function generateCompletionId(): string {
  counter = (counter + 1) % 1_000_000;
  return `chatcmpl-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

let toolCounter = 0;
/** Generate an OpenAI-style tool call id. */
export function generateToolCallId(): string {
  toolCounter = (toolCounter + 1) % 1_000_000;
  return `call_${Date.now().toString(36)}${toolCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
