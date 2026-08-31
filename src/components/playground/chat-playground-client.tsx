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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type {
  NativeModel,
  NativeModelCapabilities,
} from "@/lib/native-catalog";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlaygroundModel {
  id: string;
  name: string;
  providerId: string;
  providerShortId: string;
  providerName: string;
  description: string;
  category: "professional" | "sfw" | "unrestricted" | "reasoning";
  capabilities: NativeModelCapabilities;
  contextWindow: number;
}

export interface ChatPlaygroundData {
  models: PlaygroundModel[];
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

// ─── Constants ──────────────────────────────────────────────────────────────

const PROMPT_SUGGESTIONS = [
  "Explain quantum computing in three sentences.",
  "Write a TypeScript function to debounce another function.",
  "Draft a one-paragraph cover letter for a frontend role.",
  "Give me five project ideas using SSE streaming.",
];

// Phase palette — emerald/amber/rose/slate.
const PHASE_META: Record<Phase, { label: string; dot: string; text: string; pulse?: boolean }> = {
  idle: { label: "Idle", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-400" },
  preparing: { label: "Preparing", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", pulse: true },
  routing: { label: "Routing", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", pulse: true },
  generating: { label: "Generating", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", pulse: true },
  completed: { label: "Completed", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  error: { label: "Error", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" },
  cancelled: { label: "Cancelled", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-400" },
};

/** Maximum items per provider group in the dropdown (Radix Select doesn't
 *  virtualize — capping keeps the DOM manageable; the full list lives at /models). */
const MAX_ITEMS_PER_GROUP = 30;

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Cheap unique id (crypto.randomUUID when available, fallback to Math.random). */
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function groupModels(
  models: PlaygroundModel[],
): Array<{ providerId: string; providerName: string; items: PlaygroundModel[]; hidden: number }> {
  const buckets = new Map<string, { providerId: string; providerName: string; items: PlaygroundModel[] }>();
  for (const m of models) {
    const entry = buckets.get(m.providerId);
    if (entry) {
      entry.items.push(m);
    } else {
      buckets.set(m.providerId, {
        providerId: m.providerId,
        providerName: m.providerName,
        items: [m],
      });
    }
  }
  return Array.from(buckets.values())
    .map((b) => {
      // Sort: streaming + reasoning models first, then by name. Cap per group.
      const sorted = [...b.items].sort((a, b2) => {
        const aScore = (a.capabilities.streaming ? 2 : 0) + (a.capabilities.reasoning ? 1 : 0);
        const bScore = (b2.capabilities.streaming ? 2 : 0) + (b2.capabilities.reasoning ? 1 : 0);
        if (aScore !== bScore) return bScore - aScore;
        return (a.name || a.id).localeCompare(b2.name || b2.id);
      });
      const visible = sorted.slice(0, MAX_ITEMS_PER_GROUP);
      return {
        providerId: b.providerId,
        providerName: b.providerName,
        items: visible,
        hidden: Math.max(0, sorted.length - visible.length),
      };
    })
    .sort((a, b) => a.providerName.localeCompare(b.providerName));
}

/** Format a token count compactly. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── SSE stream reader ──────────────────────────────────────────────────────

interface SseHandlers {
  onDelta: (content: string) => void;
  onReasoning: (content: string) => void;
  onUsage: (usage: Usage) => void;
  onError: (error: SseError) => void;
  onDone: () => void;
}

/**
 * Read an SSE stream frame-by-frame with a PERSISTENT buffer.
 *
 * Never assumes one network chunk = one event. A chunk may contain half an
 * event, one event, or twenty events; an event may be split across chunks.
 * Partial UTF-8 sequences are decoded by a single TextDecoder reused in
 * streaming mode. Multi-line `data:` fields are joined with "\n" per the
 * SSE spec; `event:` fields route frames; comments (`:` lines) and
 * `id:`/`retry:` lines are ignored. `[DONE]` fires onDone exactly once.
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
        handlers.onDone();
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
      // Append content delta.
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        handlers.onDelta(content);
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

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatPlaygroundClient({ data }: { data: ChatPlaygroundData }) {
  const { models } = data;
  const groups = React.useMemo(() => groupModels(models), [models]);

  // Selected model + messages.
  const [selectedModelId, setSelectedModelId] = React.useState<string>("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>("");
  const [system, setSystem] = React.useState<string>("");
  const [showSystem, setShowSystem] = React.useState<boolean>(false);
  const [openReasoning, setOpenReasoning] = React.useState<Record<string, boolean>>({});

  // State machine.
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [usage, setUsage] = React.useState<Usage | null>(null);

  // Live token tracking during streaming (cumulative across the current turn).
  const [streamTokens, setStreamTokens] = React.useState<{ in: number; out: number } | null>(null);

  // Misc UI state.
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState<boolean>(false);
  const [initialModelResolved, setInitialModelResolved] = React.useState<boolean>(false);

  // Refs.
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>([]);
  const selectedModelRef = React.useRef<string>("");
  const systemRef = React.useRef<string>("");
  // Guard against duplicate in-flight generations: while a generation is
  // running, additional send() calls are rejected (one user message → one
  // generation request — re-renders, model switches, or rapid double-clicks
  // can never start a second one).
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

  // Auto-select the first model on first mount if no ?model= param.
  // Also resolve a `?model=...` deep-link (URL-encoded).
  React.useEffect(() => {
    if (initialModelResolved) return;
    setInitialModelResolved(true);
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const modelParam = params.get("model");
      if (modelParam) {
        const decoded = decodeURIComponent(modelParam);
        if (models.some((m) => m.id === decoded)) {
          setSelectedModelId(decoded);
          return;
        }
      }
    } catch {
      // window.location not available (SSR) — skip.
    }
    if (models.length > 0) {
      // Prefer a streaming model.
      setSelectedModelId(
        (models.find((m) => m.capabilities.streaming) ?? models[0]).id,
      );
    }
  }, [models, initialModelResolved]);

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

  // ─── Derived ────────────────────────────────────────────────────────────

  const selectedModel = React.useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleSelectModel = React.useCallback((id: string) => {
    setSelectedModelId(id);
    setUsage(null);
    setStreamTokens(null);
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
    setPhase("idle");
    toast("Chat cleared");
  }, []);

  const send = React.useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text) return;
      // Duplicate-request guard: one user message → exactly one generation.
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

      // Build the message list — prior turns + new user turn.
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      // The SINGLE assistant message for this generation. Every subsequent
      // delta / reasoning chunk / usage block updates THIS object — chunks
      // are never split into separate messages.
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: selectedModelRef.current,
        providerLabel: selectedModel?.providerName,
        status: "streaming",
      };
      const priorMessages = messagesRef.current;
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");

      // The request body messages include the system prompt (if any) + every
      // prior turn + the new user turn (NOT the empty assistant placeholder).
      const requestMessages: Array<{ role: string; content: string }> = [];
      if (systemRef.current.trim()) {
        requestMessages.push({ role: "system", content: systemRef.current.trim() });
      }
      for (const m of priorMessages) {
        requestMessages.push({ role: m.role, content: m.content });
      }
      requestMessages.push({ role: "user", content: text });

      setPhase("routing");

      const ac = new AbortController();
      abortRef.current = ac;

      // Mutable holder for values captured inside the SSE closure.
      const holder: { usage: Usage | null; error: SseError | null } = {
        usage: null,
        error: null,
      };

      try {
        const response = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModelRef.current,
            messages: requestMessages,
            stream: true,
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

        setPhase("generating");

        await readSseStream(response, {
          onDelta: (content) => {
            // Incremental update of the SAME assistant message.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + content }
                  : m,
              ),
            );
          },
          onReasoning: (content) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, reasoning: (m.reasoning ?? "") + content }
                  : m,
              ),
            );
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
          onDone: () => {
            // terminal sentinel — finalisation happens below.
          },
        }, ac.signal);

        // User-aborted — finalize as cancelled.
        if (ac.signal.aborted) {
          setPhase("cancelled");
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

        // Mid-stream error — surface inline.
        const finalErr: SseError | null = holder.error;
        if (finalErr) {
          setPhase("error");
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

        // generating → completed.
        setPhase("completed");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  status: "completed",
                  usage: holder.usage ?? undefined,
                }
              : m,
          ),
        );

        // Usage stats (when the upstream sent a usage block).
        const finalUsage: Usage | null = holder.usage;
        if (finalUsage) {
          setUsage(finalUsage);
        }
      } catch (err) {
        // Two cases: AbortError (user-initiated) or network failure.
        if (ac.signal.aborted) {
          setPhase("cancelled");
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
              : String(err);
        setPhase("error");
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
        // remain stuck in "Generating".
        abortRef.current = null;
        generatingRef.current = false;
      }
    },
    // Refs (selectedModelRef / messagesRef / systemRef) carry fresh values
    // across renders so they don't need to be in the dep array.
    [input, selectedModel],
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

  // ─── Render ──────────────────────────────────────────────────────────────

  const isStreaming = phase === "preparing" || phase === "routing" || phase === "generating";
  const phaseMeta = PHASE_META[phase];

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Error banner (request-level failures). */}
      {errorMessage && (
        <Alert className="border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center gap-3 justify-between w-full">
            <span className="text-sm">{errorMessage}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={retry}
              className="h-7 shrink-0 border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/40"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Top control bar: model selector + model info card. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-3">
        <Card className="p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" />
            <span className="uppercase tracking-wider font-medium">Model</span>
            {selectedModel?.capabilities.streaming && (
              <Badge className="ml-auto gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100">
                <Zap className="h-3 w-3" /> streaming
              </Badge>
            )}
          </div>
          <Select
            value={selectedModelId || undefined}
            onValueChange={handleSelectModel}
            disabled={isStreaming}
          >
            <SelectTrigger className="w-full font-medium" aria-label="Select model">
              <SelectValue placeholder={models.length ? "Pick a model" : "No models"} />
            </SelectTrigger>
            <SelectContent className="max-h-[340px]">
              {groups.map((g, gi) => (
                <React.Fragment key={g.providerId}>
                  {gi > 0 && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel className="text-xs">
                      {g.providerName}
                      <span className="ml-1 text-muted-foreground">
                        ({g.items.length}
                        {g.hidden > 0 ? `+${g.hidden}` : ""})
                      </span>
                    </SelectLabel>
                    {g.items.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-sm">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </React.Fragment>
              ))}
              {groups.some((g) => g.hidden > 0) && (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground border-t border-border mt-1">
                  Some models are hidden here — see the full list at /models.
                </p>
              )}
            </SelectContent>
          </Select>
          {selectedModel && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {selectedModel.description}
            </p>
          )}
        </Card>

        {/* Model capability card. */}
        <Card className="p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wider font-medium">
              {selectedModel?.providerName ?? "Model info"}
            </span>
          </div>
          {selectedModel ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {selectedModel.capabilities.streaming && (
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    <Zap className="h-3 w-3" /> streaming
                  </Badge>
                )}
                {selectedModel.capabilities.reasoning && (
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    <Brain className="h-3 w-3" /> reasoning
                  </Badge>
                )}
                {selectedModel.capabilities.vision && (
                  <Badge variant="secondary" className="text-[11px]">vision</Badge>
                )}
                {selectedModel.capabilities.tools && (
                  <Badge variant="secondary" className="text-[11px]">tools</Badge>
                )}
                {selectedModel.capabilities.webSearch && (
                  <Badge variant="secondary" className="text-[11px]">web search</Badge>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted">
                  {selectedModel.id}
                </span>
                {selectedModel.contextWindow > 0 && (
                  <span>{formatTokens(selectedModel.contextWindow)} ctx</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No model selected.</p>
          )}
          {/* Live token counter while streaming. */}
          {streamTokens && (
            <div className="text-[11px] text-muted-foreground font-mono">
              in {streamTokens.in} · out {streamTokens.out}
            </div>
          )}
          {usage && !isStreaming && (
            <div className="text-[11px] text-muted-foreground font-mono">
              tokens: {usage.prompt_tokens} in · {usage.completion_tokens} out
            </div>
          )}
        </Card>
      </div>

      {/* Messages panel. */}
      <Card className="p-0 flex flex-col min-h-[420px] relative overflow-hidden">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4 max-h-[60vh] min-h-[380px]"
        >
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8 text-center">
              <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                <Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Pick a model and send a message
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Real token-by-token SSE streaming. Free native models, no key required.
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
                    className="text-xs px-3 py-1.5 rounded-full border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => (
              <div
                key={m.id}
                className={cn(
                  "flex gap-3",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {m.role === "assistant" && (
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[85%] sm:max-w-[75%] rounded-xl px-3.5 py-2.5",
                    m.role === "user"
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted/60 border border-border",
                    m.status === "error" && "border-rose-300 dark:border-rose-800",
                  )}
                >
                  {/* Reasoning block — collapses under the same message. */}
                  {m.reasoning && m.role === "assistant" && (
                    <div className="mb-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenReasoning((prev) => ({
                            ...prev,
                            [m.id]: !prev[m.id],
                          }))
                        }
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/30 transition-colors"
                        aria-expanded={openReasoning[m.id] ?? true}
                      >
                        <Brain className="h-3 w-3" />
                        Thinking
                        {m.status === "streaming" && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 ml-auto transition-transform",
                            !(openReasoning[m.id] ?? true) && "-rotate-90",
                          )}
                        />
                      </button>
                      {(openReasoning[m.id] ?? true) && (
                        <pre className="px-3 pb-2.5 text-[11px] leading-relaxed whitespace-pre-wrap text-amber-900 dark:text-amber-200/80 font-mono max-h-56 overflow-y-auto">
                          {m.reasoning}
                        </pre>
                      )}
                    </div>
                  )}

                  {m.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  ) : m.status === "error" && !m.content ? (
                    <div className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{m.error ?? "Generation failed."}</span>
                    </div>
                  ) : m.content ? (
                    <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-pre:my-2 prose-headings:my-2">
                      <ReactMarkdown
                        components={{
                          code({ className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className ?? "");
                            const inline = !match && !String(children).includes("\n");
                            return !inline && match ? (
                              <SyntaxHighlighter
                                {...props}
                                style={oneDark}
                                language={match[1]}
                                PreTag="div"
                                customStyle={{
                                  margin: 0,
                                  borderRadius: "0.5rem",
                                  fontSize: "12px",
                                }}
                              >
                                {String(children).replace(/\n$/, "")}
                              </SyntaxHighlighter>
                            ) : (
                              <code
                                {...props}
                                className={cn(
                                  "font-mono text-[12px] rounded bg-muted px-1 py-0.5",
                                  className,
                                )}
                              >
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
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
                        onClick={() => void copyMessage(idx, m.content)}
                        className="ml-auto inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        aria-label="Copy message"
                      >
                        {copiedIdx === idx ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {m.role === "user" && (
                  <div className="h-8 w-8 rounded-lg bg-accent/40 flex items-center justify-center shrink-0 mt-0.5">
                    <UserIcon className="h-4 w-4 text-accent-foreground" />
                  </div>
                )}
              </div>
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
            className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-border bg-background shadow-sm hover:bg-muted transition-colors"
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
            className="mt-2 min-h-[70px] text-sm"
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
          className="flex-1 resize-none min-h-[52px] max-h-[200px]"
          aria-label="Message"
        />
        {isStreaming ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={stop}
              className="h-[52px] px-4"
              aria-label="Stop generation"
            >
              <Square className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Stop</span>
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            disabled={!input.trim() || !selectedModelId}
            className="h-[52px] px-4"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Send</span>
          </Button>
        )}
      </form>

      {/* Footer row: phase indicator + clear. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn("inline-flex items-center gap-1.5", phaseMeta.text)}>
            <span className={cn("h-2 w-2 rounded-full", phaseMeta.dot, phaseMeta.pulse && "animate-pulse")} />
            {phaseMeta.label}
          </span>
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
