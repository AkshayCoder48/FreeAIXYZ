"use client";

/**
 * ChatPlaygroundClient — interactive chat surface.
 *
 * Data is hydrated via the `models` prop (RSC-serialized from the STATIC
 * native catalog — no network fetch, no discovery, no credentials).
 *
 * Streaming contract (highest-priority requirement):
 *   - POST /api/v1/chat/completions with `{model, messages, stream: true}`.
 *   - The SSE stream is parsed with a PERSISTENT buffer: one network chunk
 *     can contain zero, one, or many events; one event can span many
 *     network chunks. Partial UTF-8 sequences are handled by a single
 *     TextDecoder({stream:true}) reused across chunks.
 *   - Every content delta appends to the SAME assistant message object —
 *     one generation NEVER produces multiple assistant messages.
 *   - Reasoning deltas (delta.reasoning / delta.reasoning_content) also
 *     accumulate into the same message's `reasoning` field.
 *   - `data: [DONE]` finalises the message; `event: error` frames and
 *     terminal error chunks (finish_reason:"error") surface inline.
 *   - Stop aborts the in-flight request (AbortController), cancels the
 *     reader, and finalises the message as cancelled — the UI never stays
 *     stuck in "Generating".
 *
 * TOOL-CALLING PIPELINE (Tool PRD §9-§26):
 *   - Built-in tools (calculator / web_search / get_current_time) can be
 *     toggled per model — the DEFINITIONS are sent in the request payload
 *     (`tools` + `tool_choice:"auto"` + `parallel_tool_calls:true`) for
 *     models whose capabilities.tools is true. Non-tools models never
 *     see the toggle (and the gateway rejects tools for them).
 *   - `delta.tool_calls` fragments are accumulated by INDEX across chunks
 *     (§11/§12): first delta carries id+name, later deltas carry argument
 *     fragments. Arguments are parsed ONLY after the stream completes.
 *   - Emulated providers (no upstream tools API) stream the fenced
 *     ```tool_call block as text — a complete fence is detected after the
 *     round ends and converted into structured tool calls (§13).
 *   - When a round ends with tool calls: the tools EXECUTE (via
 *     /api/tools/execute, in parallel, §24), the results are appended to
 *     the conversation as a proper `assistant.tool_calls` + `tool` message
 *     sequence (§14), and the model is re-requested with the SAME tools —
 *     the final answer continues streaming into the SAME assistant bubble.
 *   - MAX_TOOL_ROUNDS caps the loop (§23). Tool activity renders as
 *     compact status chips (§26): "Using web_search…" → "✓ web_search".
 *
 * State machine:
 *   idle → preparing → routing → generating → completed
 *   (any of preparing/routing/generating) → error on failure
 *   generating → cancelled on user Stop
 *   error | cancelled → idle on Retry or Clear
 */

import * as React from "react";
import {
  Bot,
  User as UserIcon,
  Send,
  Square,
  Copy,
  Check,
  Loader2,
  RotateCcw,
  Trash2,
  AlertCircle,
  RefreshCw,
  Cpu,
  Zap,
  Brain,
  ChevronDown,
  ArrowDown,
  Wrench,
  Search,
  Calculator,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
// PrismAsyncLight ships ONLY the refractor core (~8 KB) and lazy-loads each
// language as its own webpack chunk on first use — the full `Prism` export
// bundles ALL ~300 language definitions (~1.2 MB min / ~250 KB gzip) into
// the /chat client bundle. Same package, same props, same theme; unknown
// languages render as plain code until (and unless) their chunk loads.
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
import type { PrismTheme } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { NativeModelCapabilities } from "@/lib/native-catalog";
import type { OAITool, OAIToolCall } from "@/lib/openai-types";
import {
  BUILTIN_TOOL_DEFINITIONS,
  BUILTIN_TOOL_META,
  DEFAULT_TOOL_CHOICE,
  MAX_TOOL_ROUNDS,
} from "@/lib/tools/definitions";
import { parseToolCalls } from "@/lib/tool-calls";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlaygroundModel {
  id: string;
  name: string;
  /** One-line fleet brief (picker / info card subtitle). */
  brief: string;
  /** Longer description (detail pages). */
  description: string;
  /** Fleet line — the picker groups by this. */
  group: "uncensored" | "general" | "creative";
  /** 18+ badge — hard-test-verified uncensored slots only. */
  uncensored: boolean;
  /** Always "Onyx AI" — the fleet's public provider label. */
  providerName: string;
  capabilities: NativeModelCapabilities;
  contextWindow: number;
}

export interface ChatPlaygroundData {
  models: PlaygroundModel[];
  /** Server-validated ?model= deep link (fallback already applied). */
  initialModelId?: string;
}

type Phase =
  | "idle"
  | "preparing"
  | "routing"
  | "generating"
  | "completed"
  | "error"
  | "cancelled";

type AssistantStatus = "streaming" | "completed" | "error" | "cancelled";

/** One tool execution shown as a compact chip in the assistant message (§26). */
interface ToolEvent {
  /** Unique key — the tool_call id (stable across state updates). */
  key: string;
  name: string;
  status: "running" | "ok" | "error";
  ms?: number;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /** Model id used for this assistant turn. */
  model?: string;
  /** Provider name resolved from the catalog. */
  providerLabel?: string;
  /** Assistant message status (user messages are always "completed"). */
  status?: AssistantStatus;
  /** Accumulated reasoning tokens for this turn (same message, never split). */
  reasoning?: string;
  /** Inline error message (when status === "error"). */
  error?: string;
  errorType?: string;
  /** Final usage block (when captured from the last SSE chunk). */
  usage?: Usage;
  /** Tool executions performed during this generation (§26). */
  toolEvents?: ToolEvent[];
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface SseError {
  type?: string;
  message: string;
  http_status?: number;
  provider?: string;
  model?: string;
  request_id?: string;
  code?: string;
}

/** One `delta.tool_calls` fragment from an SSE chunk (Tool PRD §10). */
interface SseToolCallFragment {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** OpenAI-shaped message used when building the request payload (§14). */
interface RequestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROMPT_SUGGESTIONS = [
  "Calculate 12345 × 6789 using the calculator tool.",
  "Search the web for the latest Next.js release notes.",
  "Explain quantum computing in three sentences.",
  "Write a TypeScript function to debounce another function.",
];

// Phase palette — HyperDimension crimson orb (crimson / ember / gold on #111319).
const PHASE_META: Record<Phase, { label: string; dot: string; text: string; pulse?: boolean }> = {
  idle: { label: "Idle", dot: "fxz-dot-idle", text: "text-muted-foreground" },
  preparing: { label: "Preparing", dot: "fxz-dot-amber", text: "text-gold", pulse: true },
  routing: { label: "Routing", dot: "fxz-dot-amber", text: "text-gold", pulse: true },
  generating: { label: "Generating", dot: "fxz-dot-coral", text: "text-ember", pulse: true },
  completed: { label: "Completed", dot: "fxz-dot-amber", text: "text-ember" },
  error: { label: "Error", dot: "fxz-dot-crimson", text: "text-[#ff8a92]" },
  cancelled: { label: "Cancelled", dot: "fxz-dot-idle", text: "text-muted-foreground/70" },
};

/** Icon per built-in tool (matches BUILTIN_TOOL_META order). */
const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  calculator: Calculator,
  web_search: Search,
  get_current_time: Clock,
};

/** Fleet-line order + labels for the picker groups (provider = Onyx AI). */
const FLEET_GROUP_ORDER: Array<PlaygroundModel["group"]> = [
  "uncensored",
  "general",
  "creative",
];
const FLEET_GROUP_LABELS: Record<PlaygroundModel["group"], string> = {
  uncensored: "Onyx AI · Uncensored — 18+",
  general: "Onyx AI · General",
  creative: "Onyx AI · Creative",
};

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Cheap unique id (crypto.randomUUID when available, fallback to Math.random). */
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Parse a tool-call arguments JSON string → object ({} on failure, §22). */
function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/** Group the fleet by its line (fixed display order, catalog order within). */
function groupModels(
  models: PlaygroundModel[],
): Array<{ group: PlaygroundModel["group"]; label: string; items: PlaygroundModel[] }> {
  return FLEET_GROUP_ORDER.map((group) => ({
    group,
    label: FLEET_GROUP_LABELS[group],
    items: models.filter((m) => m.group === group),
  })).filter((g) => g.items.length > 0);
}

/** Format a token count compactly. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format tool duration compactly. */
function formatMs(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Strip a trailing standalone "DONE" line from assistant text before it is
 * rendered or copied — a cosmetic artifact of the gateway's auto-continuation
 * rounds (text arriving as "...\n\nDONE" or "``` \n\nDONE"). Display-only
 * cleanup; the raw message state is never altered.
 */
function stripTrailingDone(text: string): string {
  return text.replace(/\n+[ \t]*DONE[ \t\r\n]*$/, "");
}

/**
 * HyperDimension syntax theme for code blocks — warm crimson/ember/gold on
 * obsidian (derived from oneDark's shape, NO blue/indigo hues).
 */
const HYPERDIMENSION_THEME: PrismTheme = {
  ...oneDark,
  "code[class*=\"language-\"]": {
    ...oneDark["code[class*=\"language-\"]"],
    color: "#e2e2ea",
    fontSize: "12px",
  },
  "pre[class*=\"language-\"]": {
    ...oneDark["pre[class*=\"language-\"]"],
    color: "#e2e2ea",
    background: "rgba(12, 14, 19, 0.96)",
  },
  "token.comment": { color: "#8a5a5e", fontStyle: "italic" },
  "token.keyword": { color: "#ff2a55", fontWeight: "600" },
  "token.string": { color: "#ffb68a" },
  "token.number": { color: "#ff850d" },
  "token.function": { color: "#ff850d" },
  "token.class-name": { color: "#ffba27" },
  "token.operator": { color: "#e6bcbd" },
  "token.punctuation": { color: "#e6bcbd" },
  "token.property": { color: "#ffb3b6" },
  "token.builtin": { color: "#ffba27" },
  "token.boolean": { color: "#ff850d" },
  "token.constant": { color: "#ff850d" },
  "token.tag": { color: "#ff2a55" },
  "token.attr-name": { color: "#ffb68a" },
  "token.attr-value": { color: "#ffba27" },
  "token.variable": { color: "#e2e2ea" },
};

// ─── Stable markdown component mapping ──────────────────────────────────────

/**
 * Module-level `components` map for ReactMarkdown. An inline object (as this
 * used to be) creates a NEW `code` component type on every render, so React
 * unmounts and remounts the entire code-block subtree per delta instead of
 * updating it in place. A stable identity lets React reconcile code blocks
 * across the throttled re-renders — the single biggest render-path fix here.
 */
const MARKDOWN_COMPONENTS: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const inline = !match && !String(children).includes("\n");
    return !inline && match ? (
      <SyntaxHighlighter
        {...props}
        style={HYPERDIMENSION_THEME}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: "0.5rem",
          fontSize: "12px",
          border: "1px solid rgba(255, 42, 85, 0.2)",
        }}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    ) : (
      <code
        {...props}
        className={cn(
          "font-mono text-[12px] rounded px-1 py-0.5 bg-crimson/10 text-blush",
          className,
        )}
      >
        {children}
      </code>
    );
  },
};

// ─── Streaming render throttle ──────────────────────────────────────────────

/**
 * Deltas accumulate in the send() closure's local mirror strings and flush
 * into React state on this cadence (ms). ~12 markdown re-parses/s is
 * indistinguishable from per-token rendering but turns the O(n²) total
 * re-parse cost of a long stream into ~n²/80ms — the difference between a
 * 3k-delta stream being smooth and freezing a low-end phone. Terminal
 * transitions (round end / abort / error / complete) force a synchronous
 * flush so the final render is always full-fidelity.
 */
const STREAM_FLUSH_MS = 80;

/** Common languages warmed during idle time so the first code block in a
 *  chat doesn't flash unhighlighted while its lazy chunk loads. */
const WARM_LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "bash",
  "json",
  "yaml",
  "markdown",
  "css",
  "sql",
  "rust",
  "go",
  "java",
  "cpp",
  "c",
];

// ─── SSE stream reader ──────────────────────────────────────────────────────

interface SseHandlers {
  onDelta: (content: string) => void;
  onReasoning: (content: string) => void;
  /** Tool-call delta fragments — accumulate by index, NEVER drop (§10-§12). */
  onToolCall: (fragments: SseToolCallFragment[]) => void;
  onUsage: (usage: Usage) => void;
  onError: (error: SseError) => void;
  /** Fires on the [DONE] sentinel with the stream's final finish_reason. */
  onDone: (finishReason: string | null | undefined) => void;
}

/**
 * Read an SSE stream frame-by-frame with a PERSISTENT buffer.
 *
 * Never assumes one network chunk = one event. A chunk may contain half an
 * event, one event, or twenty events; an event may be split across chunks.
 * Partial UTF-8 sequences are decoded by a single TextDecoder reused in
 * streaming mode. Multi-line `data:` fields are joined with "\n" per the
 * SSE spec; `event:` fields route frames; comments (`:` lines) and
 * `id:`/`retry:` lines are ignored. `[DONE]` fires onDone exactly once
 * (carrying the observed finish_reason).
 */
async function readSseStream(
  response: Response,
  handlers: SseHandlers,
  signal: AbortSignal,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  // ONE decoder reused across chunks with stream:true — this is what makes
  // multi-byte UTF-8 characters split across chunk boundaries safe.
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingEvent = "";
  let dataLines: string[] = [];
  let done = false;
  /** Last finish_reason observed on a choice (arrives on the final chunk). */
  let finishReason: string | null | undefined;

  /** Returns true when the [DONE] sentinel has been processed. */
  const flush = (): boolean => {
    if (dataLines.length === 0) {
      pendingEvent = "";
      return false;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    const ev = pendingEvent || "message";
    pendingEvent = "";

    if (ev === "error") {
      try {
        const parsed = JSON.parse(data);
        const err = parsed?.error ?? parsed;
        handlers.onError({
          type: err?.type,
          message: err?.message ?? "Stream error",
          http_status: parsed?.http_status ?? err?.status,
          provider: err?.provider,
          model: err?.model,
          request_id: err?.request_id,
          code: err?.code,
        });
      } catch {
        handlers.onError({ message: data || "Stream error" });
      }
      return false;
    }

    if (data === "[DONE]") {
      if (!done) {
        done = true;
        handlers.onDone(finishReason);
      }
      return true;
    }

    try {
      const chunk = JSON.parse(data);
      const choice = chunk?.choices?.[0];
      // Terminal error chunk (finish_reason: "error") — surface inline.
      if (choice?.finish_reason === "error" || chunk?.error) {
        const err = chunk?.error;
        handlers.onError({
          type: err?.type,
          message: err?.message ?? "Upstream stream error",
          http_status: err?.status,
          provider: err?.provider,
          model: err?.model ?? chunk?.model,
          request_id: err?.request_id,
          code: err?.code,
        });
        return false;
      }
      // Append reasoning delta (accumulates into the same message's
      // reasoning field — never a separate message).
      const reasoning =
        choice?.delta?.reasoning ??
        choice?.delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        handlers.onReasoning(reasoning);
      }
      // Tool-call delta fragments (Tool PRD §10) — forwarded to the
      // index-keyed accumulator. NEVER parsed as JSON per-chunk (§12).
      const toolCallFrags = choice?.delta?.tool_calls;
      if (Array.isArray(toolCallFrags) && toolCallFrags.length > 0) {
        handlers.onToolCall(toolCallFrags as SseToolCallFragment[]);
      }
      // Append content delta.
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        handlers.onDelta(content);
      }
      // Track the final finish_reason (e.g. "stop" | "tool_calls").
      if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      // Capture usage (some upstreams send it on the final chunk).
      if (chunk?.usage) {
        handlers.onUsage({
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
          total_tokens: chunk.usage.total_tokens ?? 0,
        });
      }
    } catch {
      // Not JSON — ignore the frame (some servers send comment frames).
    }
    return false;
  };

  try {
    while (true) {
      if (signal.aborted) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        return;
      }
      const { done: readerDone, value } = await reader.read();
      if (readerDone) {
        // Stream closed — flush any pending complete frame that hadn't yet
        // hit a blank-line boundary. (Partial frames without a trailing
        // newline are discarded — that's correct SSE behaviour.)
        if (dataLines.length > 0) {
          flush();
        }
        // EOF without [DONE] — still report the observed finish_reason.
        if (!done) {
          done = true;
          handlers.onDone(finishReason);
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      // Split on newlines — keep the last partial line in the buffer.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      let sawDone = false;
      for (const line of lines) {
        if (line === "") {
          if (flush()) sawDone = true;
          continue;
        }
        if (line.startsWith(":")) continue; // SSE comment / heartbeat
        const colonIdx = line.indexOf(":");
        const field = colonIdx > 0 ? line.slice(0, colonIdx) : line;
        const val = colonIdx > 0 ? line.slice(colonIdx + 1).replace(/^ /, "") : "";
        if (field === "event") {
          pendingEvent = val;
        } else if (field === "data") {
          dataLines.push(val);
        }
        // Ignore id:, retry: for this playground.
      }
      // [DONE] is the logical end of the stream — finalize immediately
      // instead of waiting for the reader to signal EOF (some proxies /
      // compression layers hold the body open after the sentinel).
      if (sawDone) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        return;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best-effort */ }
  }
}

// ─── Tool-call accumulator (Tool PRD §11, §12) ──────────────────────────────

/**
 * Streaming tool-call accumulator — ONE instance per round.
 *
 * Accumulates `delta.tool_calls` fragments by INDEX:
 *   - id:      first non-empty id wins (OpenAI sends it on the first delta)
 *   - name:    first non-empty name fragment wins
 *   - arguments: CONCATENATED fragments — never overwritten, and
 *                JSON.parse happens ONLY after the stream completes (§12).
 */
class ToolCallAccumulator {
  private map = new Map<number, { id: string; name: string; arguments: string }>();

  consume(fragments: SseToolCallFragment[]): void {
    for (const frag of fragments) {
      if (!frag || typeof frag !== "object") continue;
      const index = typeof frag.index === "number" ? frag.index : 0;
      let entry = this.map.get(index);
      if (!entry) {
        entry = { id: "", name: "", arguments: "" };
        this.map.set(index, entry);
      }
      if (typeof frag.id === "string" && frag.id && !entry.id) {
        entry.id = frag.id;
      }
      const name = frag.function?.name;
      if (typeof name === "string" && name && !entry.name) {
        entry.name = name;
      }
      const args = frag.function?.arguments;
      if (typeof args === "string") {
        entry.arguments += args;
      }
    }
  }

  get size(): number {
    return this.map.size;
  }

  /** Finalize — parse arguments ONLY now (§12/§13). */
  finalize(): OAIToolCall[] {
    return Array.from(this.map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, e]) => ({
        id: e.id || `call_${index}_${Math.random().toString(36).slice(2, 10)}`,
        type: "function" as const,
        function: {
          name: e.name,
          arguments: e.arguments || "{}",
        },
      }))
      .filter((c) => c.function.name);
  }
}

// ─── Message bubble (memoized) ───────────────────────────────────────────

interface ChatMessageItemProps {
  message: ChatMessage;
  idx: number;
  copied: boolean;
  reasoningOpen: boolean;
  onToggleReasoning: (id: string) => void;
  onCopy: (idx: number, text: string) => void;
}

/**
 * One chat bubble. Memoized so a streaming update (throttled to
 * ~STREAM_FLUSH_MS) re-renders ONLY the bubble whose message object
 * changed — every earlier turn (stable object identity + stable callback
 * props) skips React and its markdown re-parse entirely. Before this, a
 * long conversation re-parsed EVERY message's markdown on every delta.
 */
const ChatMessageItem = React.memo(function ChatMessageItem({
  message: m,
  idx,
  copied,
  reasoningOpen,
  onToggleReasoning,
  onCopy,
}: ChatMessageItemProps) {
  return (
    <div
      className={cn(
        "flex gap-3",
        m.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {m.role === "assistant" && (
        <div className="fxz-avatar-bot h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[75%] rounded-xl px-3.5 py-2.5",
          m.role === "user"
            ? "fxz-bubble-user"
            : "fxz-bubble-assistant",
          m.status === "error" && "border-crimson/60",
        )}
      >
        {/* Tool execution chips (§26) — compact, no arguments shown. */}
        {m.role === "assistant" && (m.toolEvents?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {m.toolEvents!.map((ev) => (
              <span
                key={ev.key}
                className={cn(
                  "fxz-tool-chip",
                  ev.status === "running" && "fxz-tool-running",
                  ev.status === "ok" && "fxz-tool-ok",
                  ev.status === "error" && "fxz-tool-error",
                )}
                title={ev.error ?? undefined}
              >
                {ev.status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : ev.status === "ok" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <AlertCircle className="h-3 w-3" />
                )}
                {ev.name}
                {ev.status === "ok" && ev.ms !== undefined && (
                  <span className="opacity-70">{formatMs(ev.ms)}</span>
                )}
                {ev.status === "error" && <span>failed</span>}
              </span>
            ))}
          </div>
        )}

        {/* Reasoning block — collapses under the same message. */}
        {m.reasoning && m.role === "assistant" && (
          <div className="fxz-reasoning mb-2 overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleReasoning(m.id)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gold hover:bg-gold/10 transition-colors"
              aria-expanded={reasoningOpen}
            >
              <Brain className="h-3 w-3" />
              Thinking
              {m.status === "streaming" && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              <ChevronDown
                className={cn(
                  "h-3 w-3 ml-auto transition-transform",
                  !reasoningOpen && "-rotate-90",
                )}
              />
            </button>
            {reasoningOpen && (
              <pre className="px-3 pb-2.5 text-[11px] leading-relaxed whitespace-pre-wrap text-blush/80 font-mono max-h-56 overflow-y-auto custom-scroll">
                {m.reasoning}
              </pre>
            )}
          </div>
        )}

        {m.role === "user" ? (
          <p className="text-sm whitespace-pre-wrap">{m.content}</p>
        ) : m.status === "error" && !m.content ? (
          <div className="flex items-start gap-2 text-sm text-[#ff8a92]">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{m.error ?? "Generation failed."}</span>
          </div>
        ) : m.content ? (
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-headings:my-2">
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>
              {/* Strip the gateway auto-continuation "DONE" artifact
                  (display-only; raw state is untouched). */}
              {stripTrailingDone(m.content)}
            </ReactMarkdown>
          </div>
        ) : m.status === "streaming" && (m.toolEvents?.length ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {m.toolEvents!.some((ev) => ev.status === "running")
              ? "Executing tools…"
              : "Waiting for the model…"}
          </span>
        ) : m.status === "streaming" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for first token…
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">(empty response)</span>
        )}

        {/* Footer: model + status + copy. */}
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
          {m.role === "assistant" && m.providerLabel && (
            <span className="uppercase tracking-wide">{m.providerLabel}</span>
          )}
          {m.status === "streaming" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              streaming
            </span>
          )}
          {m.status === "cancelled" && <span>stopped</span>}
          {m.usage && m.status === "completed" && (
            <span className="font-mono">
              {m.usage.completion_tokens} tok
            </span>
          )}
          {m.role === "assistant" && m.content && (
            <button
              type="button"
              onClick={() =>
                void onCopy(
                  idx,
                  m.role === "assistant" ? stripTrailingDone(m.content) : m.content,
                )
              }
              className="ml-auto inline-flex items-center gap-1 hover:text-foreground transition-colors"
              aria-label="Copy message"
            >
              {copied ? (
                <Check className="h-3 w-3 text-gold" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>
      {m.role === "user" && (
        <div className="fxz-avatar-user h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
});

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatPlaygroundClient({ data }: { data: ChatPlaygroundData }) {
  const { models } = data;
  const groups = React.useMemo(() => groupModels(models), [models]);

  // Selected model + messages. The initial selection comes from the
  // server-resolved ?model= deep link (validated against FLEET_CATALOG with
  // the default fleet model as fallback).
  const [selectedModelId, setSelectedModelId] = React.useState<string>(
    data.initialModelId && models.some((m) => m.id === data.initialModelId)
      ? data.initialModelId
      : "",
  );
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>("");
  const [system, setSystem] = React.useState<string>("");
  const [showSystem, setShowSystem] = React.useState<boolean>(false);
  const [openReasoning, setOpenReasoning] = React.useState<Record<string, boolean>>({});

  // Built-in tools toggles (only rendered for tools-capable models).
  const [enabledTools, setEnabledTools] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(BUILTIN_TOOL_META.map((t) => [t.name, false])),
  );

  // State machine.
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [usage, setUsage] = React.useState<Usage | null>(null);
  /** Compact tool-activity status line (§26): "Using web_search…". */
  const [toolStatus, setToolStatus] = React.useState<string | null>(null);

  // Live token tracking during streaming (cumulative across the current turn).
  const [streamTokens, setStreamTokens] = React.useState<{ in: number; out: number } | null>(null);

  // Misc UI state.
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState<boolean>(false);

  // Refs.
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>([]);
  const selectedModelRef = React.useRef<string>("");
  const systemRef = React.useRef<string>("");
  const enabledToolsRef = React.useRef<Record<string, boolean>>(enabledTools);
  // Guard against duplicate in-flight generations: while a generation is
  // running (INCLUDING all tool rounds), additional send() calls are
  // rejected — re-renders, model switches, or rapid double-clicks can
  // never start a second one.
  const generatingRef = React.useRef<boolean>(false);

  // Mirror state into refs so the `send` closure (memoized with useCallback)
  // always sees fresh values without needing the state deps to be listed
  // (which would re-create the callback on every keystroke).
  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  React.useEffect(() => {
    selectedModelRef.current = selectedModelId;
  }, [selectedModelId]);
  React.useEffect(() => {
    systemRef.current = system;
  }, [system]);
  React.useEffect(() => {
    enabledToolsRef.current = enabledTools;
  }, [enabledTools]);

  // Safety net: if the initial selection is missing from the catalog (e.g.
  // a stale deep link), fall back to the first fleet model.
  React.useEffect(() => {
    if (selectedModelId && models.some((m) => m.id === selectedModelId)) return;
    if (models.length > 0) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  // Auto-scroll the messages list to the bottom when new content arrives
  // (unless the user has scrolled up — then show a "Jump to latest" pill).
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [messages]);

  // Cancel any in-flight stream on unmount (component cleanup — a
  // generation can never remain stuck after the island unmounts).
  React.useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      generatingRef.current = false;
    };
  }, []);

  // Warm the async syntax highlighter during idle time: preload the
  // refractor core + the common languages (each a few-KB chunk) so the
  // first streamed code block doesn't render unhighlighted while its
  // language chunk loads. Everything else lazy-loads on demand.
  React.useEffect(() => {
    const api = SyntaxHighlighter as {
      preload?: () => Promise<unknown>;
      loadLanguage?: (lang: string) => Promise<unknown>;
    };
    const warm = () => {
      try {
        void api.preload?.()?.catch(() => {});
        for (const lang of WARM_LANGUAGES) {
          void api.loadLanguage?.(lang)?.catch(() => {});
        }
      } catch {
        /* best-effort — languages lazy-load on first code block anyway */
      }
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
        cancelIdleCallback?: (h: number) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      const handle = ric(warm, { timeout: 2500 });
      return () =>
        (
          window as unknown as { cancelIdleCallback?: (h: number) => void }
        ).cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(t);
  }, []);

  // ─── Derived ────────────────────────────────────────────────────────────

  const selectedModel = React.useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  /** Tools to include in the request payload (only for tools-capable models). */
  const activeTools: OAITool[] = React.useMemo(() => {
    if (!selectedModel?.capabilities.tools) return [];
    return BUILTIN_TOOL_DEFINITIONS.filter((t) => enabledTools[t.function.name]);
  }, [selectedModel, enabledTools]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleSelectModel = React.useCallback((id: string) => {
    setSelectedModelId(id);
    setUsage(null);
    setStreamTokens(null);
  }, []);

  const toggleTool = React.useCallback((name: string) => {
    setEnabledTools((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const stop = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      // The fetch promise will reject with AbortError; the streaming try/catch
      // finalises the message state with status="cancelled".
    }
  }, []);

  const clear = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    generatingRef.current = false;
    setMessages([]);
    setUsage(null);
    setStreamTokens(null);
    setErrorMessage(null);
    setToolStatus(null);
    setPhase("idle");
    toast("Chat cleared");
  }, []);

  /**
   * Execute ONE registry tool via the backend executor endpoint (§7, §24).
   * Always resolves with a structured payload — failures become
   * `{ success:false, error }` so the MODEL still receives a tool result
   * and the generation continues (§25).
   */
  const executeToolViaApi = React.useCallback(
    async (
      call: OAIToolCall,
      signal: AbortSignal,
    ): Promise<{ id: string; ok: boolean; payload: unknown; ms?: number }> => {
      const started = Date.now();
      try {
        const res = await fetch("/api/tools/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: call.function.name,
            arguments: parseToolArgs(call.function.arguments),
          }),
          signal,
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: { message?: string } };
            msg = j?.error?.message ?? msg;
          } catch {
            /* body wasn't JSON */
          }
          return {
            id: call.id,
            ok: false,
            payload: { success: false, error: msg },
            ms: Date.now() - started,
          };
        }
        const j = (await res.json()) as {
          ok: boolean;
          result?: unknown;
          error?: string;
          durationMs?: number;
        };
        return {
          id: call.id,
          ok: j.ok,
          payload: j.ok ? (j.result ?? {}) : { success: false, error: j.error ?? "Tool failed" },
          ms: j.durationMs ?? Date.now() - started,
        };
      } catch (err) {
        if (signal.aborted) throw err;
        return {
          id: call.id,
          ok: false,
          payload: {
            success: false,
            error: err instanceof Error ? err.message : "Tool execution request failed.",
          },
          ms: Date.now() - started,
        };
      }
    },
    [],
  );

  const send = React.useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text) return;
      // Duplicate-request guard: one user message → exactly one generation
      // (the generation INCLUDES every tool round — see the loop below).
      if (generatingRef.current) return;
      if (!selectedModelRef.current) {
        toast.error("Pick a model first.");
        return;
      }
      generatingRef.current = true;
      setPhase("preparing");
      setErrorMessage(null);
      setUsage(null);
      setStreamTokens(null);
      setToolStatus(null);

      const modelInfo =
        models.find((m) => m.id === selectedModelRef.current) ?? null;
      const toolsForRequest: OAITool[] =
        modelInfo?.capabilities.tools
          ? BUILTIN_TOOL_DEFINITIONS.filter(
              (t) => enabledToolsRef.current[t.function.name],
            )
          : [];
      const useTools = toolsForRequest.length > 0;

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      // The SINGLE assistant message for this generation. Every subsequent
      // delta / reasoning chunk / tool event / usage block updates THIS
      // object — chunks are never split into separate messages, across ALL
      // tool rounds.
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: selectedModelRef.current,
        providerLabel: selectedModel?.providerName,
        status: "streaming",
        toolEvents: [],
      };
      const priorMessages = messagesRef.current;
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");

      // The request message list: system + every prior turn + the new user
      // turn (NOT the empty assistant placeholder). Tool rounds APPEND the
      // assistant tool_calls + tool results to this list (§14).
      const requestMessages: RequestMessage[] = [];
      if (systemRef.current.trim()) {
        requestMessages.push({ role: "system", content: systemRef.current.trim() });
      }
      for (const m of priorMessages) {
        requestMessages.push({ role: m.role, content: m.content });
      }
      requestMessages.push({ role: "user", content: text });

      // Local mirror of the assistant content — the single source of truth
      // for the fence detector inside the loop (React state is async).
      // ── STREAMING RENDER THROTTLE ─────────────────────────────────────
      // Deltas mutate the local mirrors IMMEDIATELY but reach React state
      // on a ~STREAM_FLUSH_MS cadence (scheduleFlush), so the markdown
      // tree re-parses at most ~12×/s instead of once per SSE delta (the
      // per-delta re-parse was O(n²) over a long stream — the #1 source of
      // UI lag). flushNow() forces a synchronous full-fidelity flush at
      // every terminal transition (round end / abort / error / complete),
      // so no text is ever lost and the finished message is always exact.
      let assistantContent = "";
      let assistantReasoning = "";
      let contentDirty = false;
      let reasoningDirty = false;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushNow = () => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!contentDirty && !reasoningDirty) return;
        contentDirty = false;
        reasoningDirty = false;
        const content = assistantContent;
        const reasoning = assistantReasoning;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content, reasoning } : m,
          ),
        );
      };
      const scheduleFlush = () => {
        if (flushTimer !== null) return; // a flush is already scheduled
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushNow();
        }, STREAM_FLUSH_MS);
      };

      const appendContent = (delta: string) => {
        assistantContent += delta;
        contentDirty = true;
        scheduleFlush();
      };
      const appendReasoning = (delta: string) => {
        assistantReasoning += delta;
        reasoningDirty = true;
        scheduleFlush();
      };
      const replaceContent = (next: string) => {
        // Completion-time rewrite (fence strip) — flush synchronously.
        assistantContent = next;
        contentDirty = true;
        flushNow();
      };

      const ac = new AbortController();
      abortRef.current = ac;

      setPhase("routing");

      // Generation-scoped holders.
      let finalUsage: Usage | null = null;

      // Helper — append tool event chips (status: running).
      const pushToolEvents = (calls: OAIToolCall[]) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  toolEvents: [
                    ...(m.toolEvents ?? []),
                    ...calls.map((c) => ({
                      key: c.id,
                      name: c.function.name,
                      status: "running" as const,
                    })),
                  ],
                }
              : m,
          ),
        );
      };
      // Helper — settle tool event chips (status: ok | error).
      const settleToolEvents = (
        results: Array<{ id: string; ok: boolean; payload: unknown; ms?: number }>,
      ) => {
        const byId = new Map(results.map((r) => [r.id, r]));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  toolEvents: (m.toolEvents ?? []).map((ev) => {
                    const r = byId.get(ev.key);
                    if (!r) return ev;
                    const errText =
                      !r.ok &&
                      r.payload &&
                      typeof r.payload === "object" &&
                      "error" in (r.payload as Record<string, unknown>)
                        ? String((r.payload as Record<string, unknown>).error)
                        : undefined;
                    return {
                      ...ev,
                      status: r.ok ? ("ok" as const) : ("error" as const),
                      ms: r.ms,
                      error: errText,
                    };
                  }),
                }
              : m,
          ),
        );
      };

      try {
        // ─── TOOL EXECUTION LOOP (Tool PRD §23) ────────────────────────────
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          setPhase("generating");
          setToolStatus(round === 0 ? null : "Generating final response…");

          const holder: {
            usage: Usage | null;
            error: SseError | null;
            finishReason: string | null | undefined;
          } = { usage: null, error: null, finishReason: undefined };
          const toolAcc = new ToolCallAccumulator();

          const response = await fetch("/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: selectedModelRef.current,
              messages: requestMessages,
              stream: true,
              // Tool PRD §5/§9 — tools + tool_choice + parallel_tool_calls
              // are preserved in the request payload (never stripped).
              ...(useTools
                ? {
                    tools: toolsForRequest,
                    tool_choice: DEFAULT_TOOL_CHOICE,
                    parallel_tool_calls: true,
                  }
                : {}),
            }),
            signal: ac.signal,
          });

          // Non-2xx — server didn't even open the stream. Surface the JSON
          // error envelope inline.
          if (!response.ok) {
            let msg = `HTTP ${response.status}`;
            let errType: string | undefined;
            try {
              const errJson = await response.json();
              msg = errJson?.error?.message ?? msg;
              errType = errJson?.error?.type;
            } catch {
              // response body wasn't JSON — keep the HTTP status message.
            }
            setPhase("error");
            setErrorMessage(msg);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, status: "error", error: msg, errorType: errType }
                  : m,
              ),
            );
            return;
          }

          if (!response.body) {
            setPhase("error");
            setErrorMessage("No response body from server.");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, status: "error", error: "No response body from server." }
                  : m,
              ),
            );
            return;
          }

          await readSseStream(
            response,
            {
              onDelta: appendContent,
              onReasoning: appendReasoning,
              onToolCall: (fragments) => {
                toolAcc.consume(fragments);
              },
              onUsage: (u) => {
                holder.usage = u;
                setStreamTokens({
                  in: u.prompt_tokens,
                  out: u.completion_tokens,
                });
              },
              onError: (e: SseError) => {
                holder.error = e;
              },
              onDone: (finishReason) => {
                holder.finishReason = finishReason ?? undefined;
              },
            },
            ac.signal,
          );

          // The stream (round) is over — force a full-fidelity flush BEFORE
          // any terminal state transition (abort / error / tool detection /
          // completion) so `m.content` in those setMessages calls is exact.
          flushNow();

          if (holder.usage) finalUsage = holder.usage;

          // User-aborted — finalize as cancelled (exits the whole loop).
          if (ac.signal.aborted) {
            setPhase("cancelled");
            setToolStatus(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      status: "cancelled",
                      content: m.content || "(stopped)",
                    }
                  : m,
              ),
            );
            return;
          }

          // Mid-stream error — surface inline and stop the generation.
          if (holder.error) {
            const finalErr = holder.error;
            setPhase("error");
            setToolStatus(null);
            setErrorMessage(finalErr.message);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? {
                      ...m,
                      status: "error",
                      error: finalErr.message,
                      errorType: finalErr.type,
                    }
                  : m,
              ),
            );
            return;
          }

          // ─── TOOL CALL DETECTION (§13) ───────────────────────────────────
          // (a) Structured `delta.tool_calls` fragments (native providers).
          let calls: OAIToolCall[] =
            toolAcc.size > 0 ? toolAcc.finalize() : [];

          // (b) Emulated providers stream the fenced ```tool_call block as
          //     CONTENT — detect a COMPLETE fence now (after the stream
          //     ended) and strip it from the displayed text.
          if (calls.length === 0 && useTools) {
            const parsed = parseToolCalls(
              assistantContent,
              () => `call_fence_${round}_${Math.random().toString(36).slice(2, 10)}`,
            );
            if (parsed.toolCalls.length > 0) {
              calls = parsed.toolCalls;
              replaceContent(parsed.text);
            }
          }

          if (calls.length === 0) {
            // Normal completion — no tool calls this round. Done.
            break;
          }

          // ─── TOOL EXECUTION (§24 — parallel, structured results) ────────
          setToolStatus(
            calls.length === 1
              ? `Using ${calls[0].function.name}…`
              : `Running ${calls.length} tools…`,
          );
          pushToolEvents(calls);

          const results: Array<{
            id: string;
            ok: boolean;
            payload: unknown;
            ms?: number;
          }> = [];
          let abortedDuringTools = false;
          await Promise.all(
            calls.map(async (c) => {
              try {
                results.push(await executeToolViaApi(c, ac.signal));
              } catch {
                // Aborted mid-execution — handled below.
                abortedDuringTools = true;
              }
            }),
          );

          settleToolEvents(results);

          if (abortedDuringTools || ac.signal.aborted) {
            setPhase("cancelled");
            setToolStatus(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, status: "cancelled", content: m.content || "(stopped)" }
                  : m,
              ),
            );
            return;
          }

          // ─── FOLLOW-UP REQUEST HISTORY (§14) ────────────────────────────
          // assistant (with tool_calls) + tool results — then loop so the
          // model resumes generation WITH the same tools.
          requestMessages.push({
            role: "assistant",
            content: assistantContent || null,
            tool_calls: calls,
          });
          for (const r of results) {
            requestMessages.push({
              role: "tool",
              tool_call_id: r.id,
              content: JSON.stringify(r.payload),
            });
          }
          // Loop continues — next round streams the model's continuation
          // into the SAME assistant message.
        }

        // generating → completed (all rounds done, no tool calls left).
        setPhase("completed");
        setToolStatus(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  status: "completed",
                  usage: finalUsage ?? undefined,
                }
              : m,
          ),
        );
        if (finalUsage) {
          setUsage(finalUsage);
        }
      } catch (err) {
        // Two cases: AbortError (user-initiated) or network failure.
        if (ac.signal.aborted) {
          setPhase("cancelled");
          setToolStatus(null);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? {
                    ...m,
                    status: "cancelled",
                    content: m.content || "(stopped)",
                  }
                : m,
            ),
          );
          return;
        }
        // Network failure.
        const friendlyMsg =
          err instanceof TypeError
            ? "Network error — please try again."
            : err instanceof Error
              ? err.message
              : "Generation failed.";
        setPhase("error");
        setToolStatus(null);
        setErrorMessage(friendlyMsg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, status: "error", error: friendlyMsg }
              : m,
          ),
        );
      } finally {
        // ALWAYS executes — completed, cancelled, failed. No generation can
        // remain stuck in "Generating". Also drains any pending throttled
        // flush (no-op when the round-end flush already ran).
        flushNow();
        abortRef.current = null;
        generatingRef.current = false;
      }
    },
    // Refs (selectedModelRef / messagesRef / systemRef / enabledToolsRef)
    // carry fresh values across renders so they don't need to be in the
    // dep array.
    [input, selectedModel, models, executeToolViaApi],
  );

  const retry = React.useCallback(() => {
    // error | cancelled → idle on Retry.
    setErrorMessage(null);
    setPhase("idle");
    // Re-send the last user message if present.
    const lastUser = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUser) {
      // Strip the trailing user message + the failed assistant placeholder so
      // the retry actually re-sends it.
      const idx = messagesRef.current.lastIndexOf(lastUser);
      setMessages(messagesRef.current.slice(0, idx));
      // Defer send so state settles before we re-enter the streaming loop.
      setTimeout(() => {
        void send(lastUser.content);
      }, 0);
    }
  }, [send]);

  const copyMessage = React.useCallback(async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      toast.error("Copy failed");
    }
  }, []);

  // Stable per-message callbacks for the memoized bubbles (identity must not
  // change across renders or React.memo would re-render every bubble).
  const toggleReasoningFor = React.useCallback((id: string) => {
    setOpenReasoning((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  const isStreaming = phase === "preparing" || phase === "routing" || phase === "generating";
  const phaseMeta = PHASE_META[phase];

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Error banner (request-level failures) — crimson glass. */}
      {errorMessage && (
        <div
          role="alert"
          className="fxz-panel flex items-center gap-3 px-4 py-3 rounded-xl border-crimson/45"
          style={{ boxShadow: "0 16px 50px -20px rgba(255,42,85,0.35), inset 0 1px 0 rgba(255,255,255,0.05)" }}
        >
          <AlertCircle className="h-4 w-4 text-crimson shrink-0" />
          <span className="text-sm text-[#ff9aa0] flex-1 min-w-0">{errorMessage}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={retry}
            className="h-8 shrink-0 border-crimson/45 text-[#ff9aa0] hover:bg-crimson/10 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      {/* Top control bar: model selector + model info card. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-3">
        <Card className="fxz-panel p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cpu className="h-3.5 w-3.5 text-crimson" />
            <span className="uppercase tracking-wider font-medium font-mono">Model</span>
            {selectedModel?.capabilities.streaming && (
              <span className="fxz-badge fxz-badge-warm ml-auto gap-1">
                <Zap className="h-3 w-3" /> streaming
              </span>
            )}
          </div>
          <Select
            value={selectedModelId || undefined}
            onValueChange={handleSelectModel}
            disabled={isStreaming}
          >
            <SelectTrigger className="fxz-input w-full font-medium" aria-label="Select model">
              <SelectValue placeholder={models.length ? "Pick a model" : "No models"} />
            </SelectTrigger>
            <SelectContent className="max-h-[340px]">
              {groups.map((g, gi) => (
                <React.Fragment key={g.group}>
                  {gi > 0 && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel className="text-xs">
                      {g.label}
                      <span className="ml-1 text-muted-foreground">
                        ({g.items.length})
                      </span>
                    </SelectLabel>
                    {g.items.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-sm">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{m.name}</span>
                          {m.uncensored && (
                            <span
                              className="fxz-badge-nsfw shrink-0"
                              title="Hard-test verified uncensored · 18+"
                            >
                              18+
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </React.Fragment>
              ))}
            </SelectContent>
          </Select>
          {selectedModel && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {selectedModel.brief}
            </p>
          )}
        </Card>

        {/* Model capability card. */}
        <Card className="fxz-panel p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="uppercase tracking-wider font-medium truncate">
              {selectedModel?.providerName ?? "Model info"}
            </span>
            {selectedModel?.uncensored && (
              <span
                className="fxz-badge-nsfw shrink-0"
                title="Hard-test verified uncensored · 18+"
              >
                18+ uncensored
              </span>
            )}
          </div>
          {selectedModel ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {selectedModel.capabilities.streaming && (
                  <span className="fxz-badge fxz-badge-ember gap-1">
                    <Zap className="h-3 w-3" /> streaming
                  </span>
                )}
                {selectedModel.capabilities.reasoning && (
                  <span className="fxz-badge fxz-badge-warm gap-1">
                    <Brain className="h-3 w-3" /> reasoning
                  </span>
                )}
                {selectedModel.capabilities.vision && (
                  <span className="fxz-badge">vision</span>
                )}
                {selectedModel.capabilities.tools && (
                  <span className="fxz-badge fxz-badge-warm gap-1">
                    <Wrench className="h-3 w-3" /> tools
                  </span>
                )}
                {selectedModel.capabilities.webSearch && (
                  <span className="fxz-badge">web search</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="fxz-code truncate">{selectedModel.id}</span>
                {selectedModel.contextWindow > 0 && (
                  <span className="shrink-0">{formatTokens(selectedModel.contextWindow)} ctx</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No model selected.</p>
          )}
          {/* Live token counter while streaming. */}
          {streamTokens && (
            <div className="fxz-code border-0 bg-transparent text-[10.5px] text-muted-foreground">
              in {streamTokens.in} · out {streamTokens.out}
            </div>
          )}
          {usage && !isStreaming && (
            <div className="fxz-code border-0 bg-transparent text-[10.5px] text-muted-foreground">
              tokens: {usage.prompt_tokens} in · {usage.completion_tokens} out
            </div>
          )}
        </Card>
      </div>

      {/* Built-in tools toggle row (only for tools-capable models). */}
      {selectedModel?.capabilities.tools ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Wrench className="h-3.5 w-3.5" /> Tools
          </span>
          {BUILTIN_TOOL_META.map((t) => {
            const Icon = TOOL_ICONS[t.name] ?? Wrench;
            const active = enabledTools[t.name];
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => toggleTool(t.name)}
                disabled={isStreaming}
                title={t.hint}
                aria-pressed={active}
                className={cn(
                  "fxz-chip",
                  active && "fxz-chip-active",
                  isStreaming && "opacity-60 cursor-not-allowed",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
          <span className="text-[11px] text-muted-foreground">
            {activeTools.length > 0
              ? "Sent with every request; the model calls them when needed."
              : "Enable a tool to let the model use it."}
          </span>
        </div>
      ) : selectedModel ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Wrench className="h-3.5 w-3.5 opacity-50" />
          This model does not support tool calling.
        </div>
      ) : null}

      {/* Messages panel. */}
      <Card className="fxz-panel p-0 flex flex-col min-h-[420px] relative overflow-hidden">
        {/* Streaming telemetry banner (kit "STREAMING LIVE" strip). */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-hd-highest/50"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {isStreaming && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-crimson opacity-80" />
              )}
              <span
                className={cn(
                  "relative inline-flex rounded-full h-2.5 w-2.5 transition-colors",
                  isStreaming
                    ? "bg-crimson shadow-[0_0_8px_rgba(255,42,85,0.9)]"
                    : "bg-hd-line",
                )}
              />
            </span>
            <span
              className={cn(
                "font-mono text-[11px] font-bold tracking-wider truncate",
                isStreaming ? "text-crimson" : "text-muted-foreground",
              )}
            >
              {phase === "generating"
                ? "STREAMING LIVE"
                : phase === "routing"
                  ? "ROUTING THROUGH GATEWAY"
                  : phase === "preparing"
                    ? "PREPARING PAYLOAD"
                    : phase === "error"
                      ? "STREAM ERROR"
                      : messages.length > 0
                        ? "STREAM COMPLETE"
                        : "READY FOR DISPATCH"}
            </span>
            {toolStatus && (
              <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground truncate">
                {toolStatus}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] shrink-0">
            {streamTokens ? (
              <>
                <span className="text-muted-foreground">
                  TOKENS <span className="text-ember font-bold">{streamTokens.out}</span>
                </span>
                <span className="hidden md:inline text-muted-foreground">
                  IN <span className="text-blush font-bold">{streamTokens.in}</span>
                </span>
              </>
            ) : usage && !isStreaming ? (
              <span className="text-muted-foreground">
                TOKENS <span className="text-ember font-bold">{usage.completion_tokens}</span>
              </span>
            ) : (
              <span className="hidden sm:inline text-muted-foreground/70">
                SSE · /api/v1/chat/completions
              </span>
            )}
          </div>
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 max-h-[60vh] min-h-[380px]"
        >
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8 text-center">
              <div className="fxz-icon-tile h-12 w-12">
                <Bot className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  Pick a model and send a message
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Real token-by-token SSE streaming with tool calling. The free
                  Onyx fleet — no key required.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                {PROMPT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                    }}
                    className="fxz-chip text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => (
              <ChatMessageItem
                key={m.id}
                message={m}
                idx={idx}
                copied={copiedIdx === idx}
                reasoningOpen={openReasoning[m.id] ?? true}
                onToggleReasoning={toggleReasoningFor}
                onCopy={copyMessage}
              />
            ))
          )}
        </div>

        {/* Jump to latest pill. */}
        {showJumpToLatest && messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const el = scrollRef.current;
              if (el) {
                el.scrollTop = el.scrollHeight;
                setShowJumpToLatest(false);
              }
            }}
            className="absolute bottom-3 right-4 z-10 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-crimson/30 bg-hd-deep/85 backdrop-blur-md text-[#e2e2ea] hover:text-white hover:border-crimson/60 transition-colors"
          >
            <ArrowDown className="h-3 w-3" /> Latest
          </button>
        )}
      </Card>

      {/* System prompt (collapsible). */}
      <div>
        <button
          type="button"
          onClick={() => setShowSystem((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
          aria-expanded={showSystem}
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", !showSystem && "-rotate-90")}
          />
          System prompt
        </button>
        {showSystem && (
          <Textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            placeholder="Optional system prompt — applied to every request."
            className="fxz-input mt-2 min-h-[70px] text-sm"
            aria-label="System prompt"
          />
        )}
      </div>

      {/* Composer. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Send a message…"
          rows={2}
          className="fxz-input flex-1 resize-none min-h-[52px] max-h-[200px] text-sm"
          aria-label="Message"
        />
        {isStreaming ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={stop}
              className="fxz-stop h-[52px] px-4"
              aria-label="Stop generation"
            >
              <Square className="h-4 w-4" fill="currentColor" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || !selectedModelId}
            className="fxz-send h-[52px] px-5"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        )}
      </form>

      {/* Footer row: phase indicator + tool status + clear. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className={cn("inline-flex items-center gap-1.5 shrink-0", phaseMeta.text)}>
            <span className={cn("h-2 w-2 rounded-full", phaseMeta.dot, phaseMeta.pulse && "fxz-dot-pulse")} />
            {phaseMeta.label}
          </span>
          {toolStatus && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground truncate">
              <Wrench className="h-3 w-3 shrink-0" />
              <span className="truncate">{toolStatus}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <>
              {isStreaming && (
                <Button variant="outline" size="sm" onClick={stop} className="h-7">
                  <Square className="h-3.5 w-3.5 mr-1" /> Stop
                </Button>
              )}
              {!isStreaming && (
                <Button variant="outline" size="sm" onClick={retry} className="h-7">
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={clear} className="h-7">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
