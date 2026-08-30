"use client";

/**
 * ChatPlayground — streaming chat UI (PRD §57, §58, §59, §60, §61, §106, §107, §108, §110).
 *
 * Replaces the legacy /chat playground. Uses the useSseStream hook to parse
 * the /v1/chat/completions SSE response incrementally (real streaming, no
 * setInterval — PRD §137).
 *
 * Features:
 *  - Searchable model selector populated from /v1/models?health=true (canonical ids).
 *  - System message textarea (optional).
 *  - User/assistant bubbles; assistant renders markdown.
 *  - Inline streaming indicator + immediate content (no full-screen spinner).
 *  - Stop button (visible only while streaming — PRD §59).
 *  - Auto-scroll when near bottom; "Jump to latest" when scrolled up (PRD §60).
 *  - Inline error card with provider/model/status + Retry + Switch model (PRD §61).
 *  - Copy + Regenerate + Clear buttons.
 *  - Temperature / max_tokens / stream toggle (PRD §106).
 *  - Canonical id display on each assistant message (PRD §57).
 *  - Mobile responsive input row (PRD §110).
 */

import * as React from "react";
import {
  Bot,
  User,
  Send,
  Square,
  Copy,
  Check,
  Loader2,
  RotateCcw,
  MessageSquare,
  Trash2,
  ChevronDown,
  SlidersHorizontal,
  AlertCircle,
  Shuffle,
  ChevronsUpDown,
  Search,
  Zap,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useSseStream, type SseError, type ToolCallDelta } from "@/hooks/use-sse-stream";
import { useModelSync } from "@/hooks/use-model-sync";
import { StreamingDiagnostics } from "@/components/playground/streaming-diagnostics";
import { RawSseDebugger } from "@/components/playground/raw-sse-debugger";
import { ToolCallCard } from "@/components/playground/tool-call-card";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  errorPayload?: SseError;
  /** Canonical model id used to produce this message (assistant only). */
  model?: string;
  provider?: string;
  /** True while this message is being streamed. */
  streaming?: boolean;
  /**
   * Tool calls accumulated during streaming (assistant only). One entry per
   * `index` — the SAME entry is mutated as fragments arrive (PRD §17).
   */
  toolCalls?: ToolCallState[];
}

/**
 * Per-tool-call accumulator state on a ChatMessage (PRD §11-§17).
 *
 * Built incrementally from `ToolCallDelta` fragments emitted by the SSE
 * hook. The `argumentsBuffer` is the CONCATENATION of all argument
 * fragments for this index — NEVER parsed mid-stream (PRD §12). The
 * `ToolCallCard` pretty-prints it lazily on render once complete.
 */
interface ToolCallState {
  /** OpenAI tool-call index (stable across deltas for the same call). */
  index: number;
  /** Stable id — kept from the FIRST delta that supplied a non-empty id. */
  id: string;
  /** Function name — kept from the FIRST delta that supplied a non-empty name. */
  name: string;
  /** Concatenated argument fragments (PRD §11, §12). */
  argumentsBuffer: string;
  /** `streaming` while fragments arrive, `ready` once the stream ends. */
  status: "streaming" | "ready";
}

interface HealthModel {
  id: string;
  owned_by: string;
  status: string;
  free: boolean;
  capabilities: {
    streaming?: boolean;
    tools?: boolean;
    vision?: boolean;
  };
  context_window: number | null;
  last_verified: string | null;
}

interface OAIModelList {
  object: "list";
  data: Array<Record<string, unknown>>;
}

const PROMPT_SUGGESTIONS = [
  "Explain quantum computing in three sentences.",
  "Write a TypeScript function to debounce another function.",
  "Draft a one-paragraph cover letter for a frontend role.",
  "Give me five project ideas using SSE streaming.",
];

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;

function groupBy<T, K extends string>(arr: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of arr) {
    const k = keyFn(item);
    const arr2 = m.get(k) ?? [];
    arr2.push(item);
    m.set(k, arr2);
  }
  return m;
}

function getChildrenText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    return children.map((c) => getChildrenText(c)).join("");
  }
  return "";
}

export function ChatPlayground() {
  const [models, setModels] = React.useState<HealthModel[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState<boolean>(true);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [selectedModel, setSelectedModel] = React.useState<string>("");

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>("");
  const [system, setSystem] = React.useState<string>("");
  const [temperature, setTemperature] = React.useState<number>(DEFAULT_TEMPERATURE);
  const [maxTokens, setMaxTokens] = React.useState<number>(DEFAULT_MAX_TOKENS);
  const [streamEnabled, setStreamEnabled] = React.useState<boolean>(true);

  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [rawSseEnabled, setRawSseEnabled] = React.useState<boolean>(false);
  const [rawSseLines, setRawSseLines] = React.useState<string[]>([]);
  const [showSettings, setShowSettings] = React.useState<boolean>(false);
  const [showSystem, setShowSystem] = React.useState<boolean>(false);

  const [nearBottom, setNearBottom] = React.useState<boolean>(true);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  const stream = useSseStream();
  // Real-time model-registry sync (PRD §6, §7, §28, §29).
  const modelSync = useModelSync();

  // Tracks whether the user has manually chosen a model — used to suppress the
  // "first active streaming model" auto-pick on the very first load only.
  const userPickedRef = React.useRef<boolean>(false);

  // Fetch the model list (also called after a sync completes — PRD §43, §44).
  const fetchModels = React.useCallback(async (): Promise<HealthModel[]> => {
    setModelsLoading(true);
    try {
      const res = await fetch("/api/v1/models?health=true", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as OAIModelList;
      const list: HealthModel[] = (json.data as unknown[])
        .map((d) => d as Partial<HealthModel> & Record<string, unknown>)
        .filter((d) => typeof d.id === "string")
        .map((d) => ({
          id: d.id as string,
          owned_by: (d.owned_by as string) ?? "—",
          status: (d.status as string) ?? "unknown",
          // Treat `free: true` as free; if field is missing default to true
          // (FreeAIXYZ is a free-tier gateway — most models are free).
          free: d.free !== false,
          capabilities: {
            streaming: Boolean(
              (d.capabilities as { streaming?: boolean })?.streaming,
            ),
            tools: Boolean((d.capabilities as { tools?: boolean })?.tools),
            vision: Boolean((d.capabilities as { vision?: boolean })?.vision),
          },
          context_window:
            typeof d.context_window === "number" ? d.context_window : null,
          last_verified:
            typeof d.last_verified === "string" ? d.last_verified : null,
        }));
      // PRD §42 — free-only: filter to active + free models.
      const freeActive = list.filter(
        (m) => m.status === "active" && m.free !== false,
      );
      setModels(freeActive.length > 0 ? freeActive : list);
      return freeActive.length > 0 ? freeActive : list;
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
      return [];
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Load models list on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchModels();
      if (cancelled) return;
      if (list.length === 0) return;
      // Don't auto-pick if the user already selected a model (rare on first mount).
      const preferred =
        list.find((m) => m.capabilities.streaming && m.status === "active") ??
        list.find((m) => m.status === "active") ??
        list.find((m) => m.capabilities.streaming) ??
        list[0];
      if (preferred && !userPickedRef.current) setSelectedModel(preferred.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchModels]);

  // After a sync completes, re-fetch the model list and auto-switch if the
  // currently selected model is no longer present (PRD §43, §44).
  React.useEffect(() => {
    if (modelSync.syncing) return;
    if (!modelSync.lastSyncAt) return;
    let cancelled = false;
    (async () => {
      const list = await fetchModels();
      if (cancelled || list.length === 0) return;
      const stillThere = list.some((m) => m.id === selectedModel);
      if (!stillThere) {
        const next =
          list.find((m) => m.capabilities.streaming && m.status === "active") ??
          list.find((m) => m.status === "active") ??
          list[0];
        if (next) {
          const prev = selectedModel || "—";
          setSelectedModel(next.id);
          if (prev !== "—" && prev !== next.id) {
            toast.success(
              `Model ${prev} was removed — switched to ${next.id}`,
            );
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelSync.lastSyncAt, modelSync.syncing, fetchModels, selectedModel]);

  // Track scroll position to enable "Jump to latest".
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setNearBottom(distFromBottom < 120);
  }, []);

  const scrollToBottom = React.useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setNearBottom(true);
  }, []);

  const send = React.useCallback(async () => {
    const text = input.trim();
    if (stream.state === "streaming" || stream.state === "connecting") return;
    if (!text) return;
    if (!selectedModel) {
      toast.error("Select a model first.");
      return;
    }
    if (streamEnabled) {
      setRawSseLines([]);
    }

    const userMsg: ChatMessage = { role: "user", content: text };
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      streaming: true,
      model: selectedModel,
    };
    const prior = messages;
    const next = [...prior, userMsg, assistantMsg];
    setMessages(next);
    setInput("");

    const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (system.trim()) {
      apiMessages.push({ role: "system", content: system.trim() });
    }
    for (const m of prior) {
      if (m.error) continue;
      apiMessages.push({ role: m.role, content: m.content });
    }
    apiMessages.push({ role: "user", content: text });

    const body = {
      model: selectedModel,
      messages: apiMessages,
      stream: streamEnabled,
      temperature,
      max_tokens: maxTokens,
    };

    await stream.start({
      url: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-No-Buffer": "true",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
      onDelta: (delta) => {
        setMessages((prev) => {
          const arr = [...prev];
          const last = arr[arr.length - 1];
          if (last?.role === "assistant") {
            arr[arr.length - 1] = {
              ...last,
              content: last.content + delta,
            };
          }
          return arr;
        });
        if (nearBottom) {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
        }
      },
      /**
       * Tool-call delta accumulator (PRD §11-§17). Mutates the LAST assistant
       * message's `toolCalls` array by index: stable id, first non-empty name
       * wins (empty name deltas MUST NOT erase — PRD §11), arguments
       * CONCATENATED (never overwritten, never JSON.parsed mid-stream —
       * PRD §12). One card per index, never per delta (PRD §17).
       */
      onToolCallDelta: (tcs: ToolCallDelta[]) => {
        setMessages((prev) => {
          const arr = [...prev];
          const last = arr[arr.length - 1];
          if (last?.role !== "assistant") return prev;
          // Deep-copy the existing tool-calls array so React sees a new ref.
          const existing: ToolCallState[] = (last.toolCalls ?? []).map((t) => ({
            ...t,
          }));
          for (const tc of tcs) {
            const idx = existing.findIndex((e) => e.index === tc.index);
            if (idx === -1) {
              // First delta for this index — initialize the accumulator.
              existing.push({
                index: tc.index,
                id: tc.id ?? `call_${tc.index}`,
                name: tc.function.name ?? "",
                argumentsBuffer: tc.function.arguments ?? "",
                status: "streaming",
              });
            } else {
              const cur = existing[idx];
              // Stable id: keep the FIRST non-empty id (PRD §11).
              if (!cur.id && tc.id) cur.id = tc.id;
              // First non-empty name wins — empty/absent name MUST NOT erase
              // the accumulated name (PRD §11).
              if (!cur.name && tc.function.name) cur.name = tc.function.name;
              // Concatenate the argument FRAGMENT — NEVER overwrite
              // (PRD §11), NEVER JSON.parse the partial buffer (PRD §12).
              if (tc.function.arguments) {
                cur.argumentsBuffer =
                  cur.argumentsBuffer + tc.function.arguments;
              }
              // status stays "streaming" until the stream ends.
            }
          }
          arr[arr.length - 1] = { ...last, toolCalls: existing };
          return arr;
        });
        if (nearBottom) {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
        }
      },
      onError: (err) => {
        setMessages((prev) => {
          const arr = [...prev];
          const last = arr[arr.length - 1];
          if (last?.role === "assistant") {
            arr[arr.length - 1] = {
              ...last,
              streaming: false,
              error: true,
              errorPayload: err,
              provider: err.provider ?? last.provider,
              model: err.model ?? last.model,
            };
          }
          return arr;
        });
        toast.error(`Stream error: ${err.message}`);
      },
      onDone: () => {
        setMessages((prev) => {
          const arr = [...prev];
          const last = arr[arr.length - 1];
          if (last?.role === "assistant") {
            // Mark every accumulated tool call as ready (PRD §11). The
            // ToolCallCard lazily pretty-prints the now-complete arguments
            // buffer on render (PRD §12).
            const toolCalls =
              last.toolCalls && last.toolCalls.length > 0
                ? last.toolCalls.map((tc) => ({
                    ...tc,
                    status: "ready" as const,
                  }))
                : last.toolCalls;
            arr[arr.length - 1] = {
              ...last,
              streaming: false,
              toolCalls,
            };
          }
          return arr;
        });
      },
      onRawData: (line) => {
        if (streamEnabled) {
          setRawSseLines((prev) => {
            const next2 = [...prev, line];
            if (next2.length > 400) return next2.slice(-400);
            return next2;
          });
        }
      },
    });
  }, [
    input,
    messages,
    nearBottom,
    maxTokens,
    selectedModel,
    stream,
    streamEnabled,
    temperature,
    system,
  ]);

  const stop = React.useCallback(() => {
    stream.stop();
    setMessages((prev) => {
      const arr = [...prev];
      const last = arr[arr.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        arr[arr.length - 1] = {
          ...last,
          streaming: false,
          content: last.content || "(stopped)",
        };
      }
      return arr;
    });
  }, [stream]);

  const regenerate = React.useCallback(() => {
    const lastUserIdx = [...messages]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find(({ m }) => m.role === "user");
    if (!lastUserIdx) return;
    const text = lastUserIdx.m.content;
    const trimmed = messages.slice(0, lastUserIdx.i);
    setMessages(trimmed);
    setInput(text);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [messages]);

  const clear = React.useCallback(() => {
    setMessages([]);
    setRawSseLines([]);
    stream.reset();
  }, [stream]);

  const copy = React.useCallback(async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      toast.error("Clipboard unavailable.");
    }
  }, []);

  const switchModel = React.useCallback(
    (err: SseError | undefined) => {
      if (err?.model) {
        const currentIdx = models.findIndex((m) => m.id === err.model);
        if (currentIdx >= 0) {
          const next =
            models.slice(currentIdx + 1).find((m) => m.capabilities.streaming) ??
            models.find((m) => m.capabilities.streaming);
          if (next) {
            userPickedRef.current = true;
            setSelectedModel(next.id);
            toast.success(`Switched to ${next.id}`);
            return;
          }
        }
      }
      toast.error("No alternative streaming model available.");
    },
    [models],
  );

  // Manual model-pick handler — flips the userPicked flag so the auto-pick
  // effect doesn't override the user's choice on a later sync.
  const handleSelectModel = React.useCallback((id: string) => {
    userPickedRef.current = true;
    setSelectedModel(id);
  }, []);

  // Manual sync trigger (PRD §8) — "Refresh Models" button.
  const handleRefreshModels = React.useCallback(async () => {
    const result = await modelSync.refresh();
    if (result) {
      toast.success(
        `Models updated — new: ${result.added} · updated: ${result.updated} · removed: ${result.removed} · free: ${result.free}`,
        { duration: 4000 },
      );
    } else if (modelSync.error) {
      toast.error(`Sync failed: ${modelSync.error}`);
    }
    // The post-sync effect above will re-fetch + auto-switch if needed.
  }, [modelSync]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  const streaming = stream.state === "streaming" || stream.state === "connecting";

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4 min-h-0">
      {/* Chat column */}
      <section className="flex flex-col min-h-0">
        {/* Top bar */}
        <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3 flex-wrap shadow-sm">
          <ModelPicker
            models={models}
            loading={modelsLoading}
            error={modelsError}
            value={selectedModel}
            onChange={handleSelectModel}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshModels}
            disabled={modelSync.syncing}
            aria-label="Refresh models"
            className="h-12 shrink-0 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-border rounded-xl hover:bg-accent/10 hover:text-accent hover:border-accent disabled:opacity-60 disabled:pointer-events-none"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {modelSync.syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={1.75} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
            )}
            <span className="hidden sm:inline">Refresh models</span>
            <span className="sm:hidden">Sync</span>
          </Button>
          <Badge
            variant="outline"
            className="text-[10px] border-accent/30 bg-accent/5 text-accent uppercase tracking-[0.12em] rounded-full"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {streamEnabled ? "streaming" : "non-stream"}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSystem((v) => !v)}
              className="h-9 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-border rounded-full hover:bg-accent/10 hover:text-accent hover:border-accent"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
              System
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings((v) => !v)}
              className="h-9 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-border rounded-full hover:bg-accent/10 hover:text-accent hover:border-accent"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <SlidersHorizontal className="h-3 w-3" strokeWidth={1.75} />
              Settings
            </Button>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clear}
                className="h-9 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-border rounded-full hover:bg-rose-50 hover:text-rose-500 hover:border-rose-300"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Sync state line — PRD §45 (lightweight status near model selector). */}
        <SyncStatusBar sync={modelSync} />

        {/* System prompt (collapsible) */}
        {showSystem && (
          <div className="rounded-xl border border-border bg-muted/30 p-3 mt-2">
            <label
              className="block text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              System message (optional)
            </label>
            <Textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="You are a concise, helpful assistant."
              className="min-h-[60px] resize-y border-border bg-background rounded-lg"
            />
          </div>
        )}

        {/* Settings (collapsible) */}
        {showSettings && (
          <div className="rounded-xl border border-border bg-muted/30 p-3 mt-2 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label
                className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Stream
              </label>
              <Switch checked={streamEnabled} onCheckedChange={setStreamEnabled} />
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Temperature: {temperature.toFixed(2)}
              </label>
              <Slider
                value={[temperature]}
                min={0}
                max={2}
                step={0.05}
                onValueChange={(v) => setTemperature(v[0] ?? temperature)}
              />
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5 block"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Max tokens
              </label>
              <Input
                type="number"
                min={1}
                max={8192}
                value={maxTokens}
                onChange={(e) =>
                  setMaxTokens(
                    Math.max(1, Math.min(8192, Number(e.target.value) || 1)),
                  )
                }
                className="h-9 border-border bg-background rounded-lg"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              />
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="rounded-xl border border-border bg-card border-t-0 flex-1 min-h-0 relative overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full max-h-[calc(100vh-360px)] min-h-[300px] overflow-y-auto custom-scroll"
          >
            <div className="p-4 space-y-5">
              {messages.length === 0 ? (
                <EmptyState
                  onPick={(s) => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                />
              ) : (
                messages.map((m, i) => (
                  <MessageBubble
                    key={i}
                    message={m}
                    copied={copiedIdx === i}
                    onCopy={() => copy(m.content, i)}
                    onRegenerate={regenerate}
                    onRetry={regenerate}
                    onShuffle={() => switchModel(m.errorPayload)}
                  />
                ))
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          {!nearBottom && messages.length > 0 && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 h-9 px-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] text-white shadow-accent text-[10px] uppercase tracking-[0.12em] hover:shadow-accent-lg transition-all"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
              Jump to latest
            </button>
          )}
        </div>

        {/* Composer */}
        <div className="rounded-xl border border-border border-t-0 bg-card p-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Send a message…"
                className="min-h-[56px] max-h-[200px] resize-y border-border bg-background px-4 py-3 text-sm rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                rows={1}
              />
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="h-14 w-14 shrink-0 inline-flex items-center justify-center rounded-xl bg-rose-500 text-white hover:bg-rose-600 hover:shadow-accent transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
                aria-label="Stop streaming"
              >
                <Square className="h-5 w-5" strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || !selectedModel}
                className="h-14 w-14 shrink-0 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] text-white hover:shadow-accent hover:-translate-y-0.5 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                aria-label="Send"
              >
                <Send className="h-5 w-5" strokeWidth={2} />
              </button>
            )}
          </div>
          <p
            className="text-[10px] text-muted-foreground mt-2 text-center uppercase tracking-[0.12em]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            Enter to send · Shift+Enter for newline · canonical id:{" "}
            <span className="text-accent">{selectedModel || "—"}</span>
          </p>
        </div>
      </section>

      {/* Diagnostics column */}
      <aside className="flex flex-col gap-4 min-w-0">
        <StreamingDiagnostics
          state={stream.state}
          timings={stream.timings}
          derived={stream.derived}
        />
        <RawSseDebugger
          lines={rawSseLines}
          enabled={rawSseEnabled}
          onToggle={setRawSseEnabled}
          onClear={() => setRawSseLines([])}
        />
      </aside>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 py-12 text-center">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#0052FF] to-[#4D7CFF] flex items-center justify-center shadow-accent">
        <MessageSquare className="h-8 w-8 text-white" strokeWidth={1.75} />
      </div>
      <div>
        <h2
          className="text-2xl sm:text-3xl font-normal text-foreground"
          style={{ fontFamily: "var(--font-display), Georgia, serif" }}
        >
          Inference Playground
        </h2>
        <p className="text-base text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
          Select a model and send a message. Free, no API key, real streaming
          via SSE.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 max-w-2xl">
        {PROMPT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-sm rounded-full border border-border text-foreground bg-card px-4 py-2 hover:border-accent/30 hover:shadow-accent hover:text-accent transition-all text-left max-w-full"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  copied: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onShuffle: () => void;
}

function MessageBubble({
  message,
  copied,
  onCopy,
  onRegenerate,
  onRetry,
  onShuffle,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = Boolean(message.streaming);
  const isError = Boolean(message.error);
  const hasToolCalls =
    !isUser &&
    Boolean(message.toolCalls) &&
    (message.toolCalls?.length ?? 0) > 0;

  return (
    <article
      className={cn(
        "group flex gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#0052FF] to-[#4D7CFF] flex items-center justify-center shrink-0 mt-1 shadow-accent">
          <Bot className="h-4 w-4 text-white" strokeWidth={1.75} />
        </div>
      )}
      <div
        className={cn(
          "max-w-[88%] sm:max-w-[80%] flex flex-col gap-2",
          isUser ? "items-end" : "items-start",
        )}
      >
        {!isUser && (message.model || message.provider) && (
          <div
            className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="text-accent">{message.model ?? "—"}</span>
            {message.provider && (
              <span className="text-muted-foreground/70">
                ({message.provider})
              </span>
            )}
          </div>
        )}
        {/* Tool-call cards (PRD §17) — one per index, ABOVE the markdown
            content. Rendered for assistant messages only, when tool calls
            have been accumulated. Cards stand alone when content is empty. */}
        {hasToolCalls && message.toolCalls && (
          <div className="w-full flex flex-col gap-2">
            {message.toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id || tc.index}
                name={tc.name}
                argumentsRaw={tc.argumentsBuffer}
                status={tc.status}
              />
            ))}
          </div>
        )}
        {/* Assistant bubble — skipped when there is no text content AND
            tool calls are present (the cards stand alone). For all other
            cases (user content, assistant markdown, streaming spinner, or
            error) the bubble renders as before. Raw __tool_calls markers
            never reach here — they are filtered upstream (PRD §8). */}
        {isUser ||
        message.content ||
        (!hasToolCalls && (isStreaming || isError)) ? (
          <div
            className={cn(
              "px-5 py-3.5 text-sm leading-relaxed rounded-2xl",
              isUser
                ? "bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] text-white"
                : isError
                  ? "border-2 border-rose-300 bg-rose-50 text-rose-900"
                  : "border border-border bg-card text-foreground",
            )}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            ) : message.content ? (
              <MarkdownRenderer text={message.content} />
            ) : isStreaming ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={1.75} />
                Generating…
              </span>
            ) : isError ? (
              <div className="text-foreground">
                {message.errorPayload?.message ?? "Error"}
              </div>
            ) : null}
          </div>
        ) : null}
        {isError && message.errorPayload && (
          <InlineErrorCard
            err={message.errorPayload}
            onRetry={onRetry}
            onShuffle={onShuffle}
          />
        )}
        {!isUser && !isStreaming && !isError && (message.content || hasToolCalls) && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] rounded-full border border-border text-foreground hover:bg-accent hover:text-white hover:border-accent transition-all"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {copied ? (
                <Check className="h-3 w-3" strokeWidth={1.75} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={1.75} />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] rounded-full border border-border text-foreground hover:bg-accent hover:text-white hover:border-accent transition-all"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
              Regenerate
            </button>
          </div>
        )}
      </div>
      {isUser && (
        <div className="h-9 w-9 rounded-xl bg-foreground flex items-center justify-center shrink-0 mt-1">
          <User className="h-4 w-4 text-background" strokeWidth={1.75} />
        </div>
      )}
    </article>
  );
}

function InlineErrorCard({
  err,
  onRetry,
  onShuffle,
}: {
  err: SseError;
  onRetry: () => void;
  onShuffle: () => void;
}) {
  return (
    <Alert className="rounded-xl border-rose-300 bg-rose-50">
      <AlertCircle className="h-4 w-4 text-rose-500" />
      <AlertTitle className="text-rose-900">
        {err.type ?? "STREAM_ERROR"}
      </AlertTitle>
      <AlertDescription className="text-xs space-y-2">
        <div
          className="grid grid-cols-2 gap-1"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {err.provider && <span>provider: {err.provider}</span>}
          {err.model && <span>model: {err.model}</span>}
          {typeof err.status === "number" && <span>HTTP: {err.status}</span>}
          {typeof err.upstreamStatus === "number" && (
            <span>upstream: {err.upstreamStatus}</span>
          )}
          {err.requestId && (
            <span className="break-all col-span-2">request: {err.requestId}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="h-7 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-accent text-accent hover:bg-accent hover:text-white rounded-full"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
            Retry
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onShuffle}
            className="h-7 gap-1.5 text-[10px] uppercase tracking-[0.12em] border-border rounded-full hover:bg-accent/10 hover:text-accent hover:border-accent"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            <Shuffle className="h-3 w-3" strokeWidth={1.75} />
            Switch model
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Markdown rendering — react-markdown + custom code renderer with copy.

function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-2 hover:opacity-70"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>
          ),
          p: ({ children }) => (
            <p className="my-1.5 leading-relaxed">{children}</p>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

interface CodeComponentProps extends React.HTMLAttributes<HTMLElement> {
  // react-markdown v10 attaches a `node` prop; we ignore it.
  node?: unknown;
}

function CodeBlock({ className, children }: CodeComponentProps) {
  const [copied, setCopied] = React.useState(false);
  const text = getChildrenText(children).replace(/\n$/, "");
  // Block code (fenced) carries a `language-xxx` className; inline does not.
  const isBlock = Boolean(className && className.includes("language-"));
  if (!isBlock) {
    return (
      <code
        className={cn("px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[12px]", className)}
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {children}
      </code>
    );
  }
  return (
    <div className="relative my-2 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted">
        <span
          className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {className?.replace(/^language-/, "") || "code"}
        </span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore
            }
          }}
          className="h-6 px-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] rounded-full hover:bg-accent hover:text-white transition-all"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {copied ? (
            <Check className="h-3 w-3" strokeWidth={1.75} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={1.75} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-x-auto p-3 text-[12px] leading-relaxed bg-[#0F172A] text-zinc-100"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Model picker — Command + Popover (searchable, grouped by provider).

interface ModelPickerProps {
  models: HealthModel[];
  loading: boolean;
  error: string | null;
  value: string;
  onChange: (id: string) => void;
}

function ModelPicker({
  models,
  loading,
  error,
  value,
  onChange,
}: ModelPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.owned_by.toLowerCase().includes(q),
    );
  }, [models, query]);

  const grouped = React.useMemo(() => {
    return groupBy(filtered, (m) => m.owned_by);
  }, [filtered]);

  const selected = models.find((m) => m.id === value);

  // Empty state (PRD §46) — no free/active models currently available.
  const isEmpty = !loading && !error && models.length === 0;

  // PRD §39 — title attribute for the full provider name tooltip on overflow.
  const selectedFullProvider = selected?.owned_by ?? "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select model"
          className="flex-1 min-w-0 h-12 justify-between border-border bg-background font-normal rounded-xl hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {/* Content container — PRD §36: min-w-0 + flex-1 so the inner
              truncate spans actually clip on overflow. */}
          <span className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
            {loading ? (
              <span className="text-muted-foreground text-xs flex items-center gap-2 truncate">
                <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" strokeWidth={1.75} />
                <span className="truncate">Loading models…</span>
              </span>
            ) : error ? (
              <span className="text-rose-500 text-xs truncate">
                Models unavailable
              </span>
            ) : isEmpty ? (
              <span className="text-muted-foreground text-xs truncate flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" strokeWidth={1.75} />
                <span className="truncate">
                  No free models available — Refresh to check again
                </span>
              </span>
            ) : selected ? (
              <>
                <span
                  className="text-foreground truncate text-sm overflow-hidden text-ellipsis whitespace-nowrap"
                  title={selected.id}
                  style={{ fontFamily: "var(--font-mono), monospace" }}
                >
                  {selected.id}
                </span>
                <span
                  className="text-muted-foreground text-[10px] hidden sm:inline-flex items-center gap-1 min-w-0 truncate overflow-hidden text-ellipsis whitespace-nowrap"
                  title={`${selectedFullProvider}${selected.capabilities.streaming ? " · streaming" : ""}`}
                >
                  <span className="truncate">{selectedFullProvider}</span>
                  {selected.capabilities.streaming && (
                    <span className="inline-flex items-center gap-0.5 shrink-0">
                      <Zap className="h-2.5 w-2.5 text-accent" strokeWidth={1.75} />
                      stream
                    </span>
                  )}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-xs truncate">
                Select model…
              </span>
            )}
          </span>
          {/* PRD §40 — flex-shrink-0 on the chevron so the name gets the
              remaining width and the chevron stays pinned. */}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[400px] p-0 rounded-xl border-border"
        align="start"
      >
        <Command shouldFilter={false}>
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 text-accent" />
            <CommandInput
              placeholder={`Search ${models.length} models by id, provider…`}
              value={query}
              onValueChange={setQuery}
              className="h-10 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            />
          </div>
          <CommandList className="max-h-[360px] overflow-y-auto custom-scroll">
            {isEmpty ? (
              <CommandEmpty>
                <div className="py-8 text-center space-y-2">
                  <AlertCircle
                    className="h-5 w-5 mx-auto text-amber-500"
                    strokeWidth={1.75}
                  />
                  <p className="text-xs text-muted-foreground">
                    No free models currently available.
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    Refresh models to check again.
                  </p>
                </div>
              </CommandEmpty>
            ) : (
              <CommandEmpty>
                {query ? `No models found for "${query}".` : "Type to search…"}
              </CommandEmpty>
            )}
            {Array.from(grouped.entries()).map(([provider, list]) => (
              <CommandGroup
                key={provider}
                heading={`${provider} (${list.length})`}
              >
                {list.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.id}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex flex-col items-start gap-0.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 w-full min-w-0">
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          value === m.id ? "opacity-100 text-accent" : "opacity-0",
                        )}
                        strokeWidth={1.75}
                      />
                      <span
                        className="text-sm font-medium truncate min-w-0 flex-1"
                        title={m.id}
                        style={{ fontFamily: "var(--font-mono), monospace" }}
                      >
                        {m.id}
                      </span>
                      {m.capabilities.streaming && (
                        <Zap
                          className="h-3 w-3 text-accent shrink-0"
                          strokeWidth={1.75}
                        />
                      )}
                      <span
                        className={cn(
                          "ml-auto inline-block h-1.5 w-1.5 rounded-full shrink-0",
                          m.status === "active"
                            ? "bg-emerald-500"
                            : m.status === "degraded"
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40",
                        )}
                      />
                    </div>
                    <span
                      className="text-[10px] text-muted-foreground pl-5 flex items-center gap-2"
                      style={{ fontFamily: "var(--font-mono), monospace" }}
                    >
                      <span className="uppercase tracking-[0.12em]">
                        {m.status}
                      </span>
                      {m.capabilities.tools && <span>· tools</span>}
                      {m.capabilities.vision && <span>· vision</span>}
                      {m.context_window ? (
                        <span>· ctx {m.context_window}</span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SyncStatusBar — lightweight inline sync state line (PRD §45).
//
// Shows "↻ Updating models…" while syncing, then briefly flashes the diff
// result ("✓ Models updated (N new, M removed)") before fading out.

interface SyncStatusBarProps {
  sync: {
    syncing: boolean;
    lastSyncAt: string | null;
    result: {
      added: number;
      updated: number;
      removed: number;
      free: number;
    } | null;
    error: string | null;
  };
}

function SyncStatusBar({ sync }: SyncStatusBarProps) {
  // Flash the result for 3 seconds after a sync completes, then fade (PRD §45).
  const [showFlash, setShowFlash] = React.useState(false);
  const lastResultRef = React.useRef<SyncStatusBarProps["sync"]["result"]>(null);
  React.useEffect(() => {
    if (sync.result && sync.result !== lastResultRef.current) {
      lastResultRef.current = sync.result;
      setShowFlash(true);
      const t = window.setTimeout(() => setShowFlash(false), 3000);
      return () => window.clearTimeout(t);
    }
    return;
  }, [sync.result]);

  const syncing = sync.syncing;
  const hasResult = Boolean(sync.result);
  const diff = sync.result;

  if (!syncing && !showFlash && !sync.error) {
    // Idle — render an invisible placeholder so layout doesn't jump when the
    // line shows up. Use min-h to reserve the row.
    return <div className="h-6 mt-1" aria-hidden="true" />;
  }

  return (
    <div
      className="mt-1 h-6 flex items-center px-1"
      role="status"
      aria-live="polite"
    >
      {syncing ? (
        <span
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-accent"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
          <span>↻ Updating models…</span>
        </span>
      ) : sync.error ? (
        <span
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-rose-500"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <AlertCircle className="h-3 w-3" strokeWidth={1.75} />
          <span>Sync failed: {sync.error}</span>
        </span>
      ) : showFlash && hasResult && diff ? (
        <span
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400 transition-opacity"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          <Check className="h-3 w-3" strokeWidth={1.75} />
          <span>
            ✓ Models updated · {diff.added} new · {diff.removed} removed ·{" "}
            {diff.free} free
          </span>
        </span>
      ) : null}
    </div>
  );
}
