"use client";

/**
 * ChatPlaygroundClient — interactive chat surface (W4-F, PRD §53, §54, §77).
 *
 * Server-side data is hydrated via the `data` prop (RSC-serialized):
 *   - models: every currently-available entry in the unified catalog
 *     (native + g4f + gratisfy when BYOK key present), grouped by
 *     (source, provider) in the dropdown.
 *   - byok:   the user's BYOK credential meta (connected + lastValidationOk).
 *   - user:   the authed account (null for anonymous).
 *   - multiplier: XYZ_USD_MULTIPLIER for USD → XYZ cost conversion.
 *
 * PRD §53 — model selection: a shadcn `<Select>` grouped by provider with
 *   source-coloured headers. The selected model's provider / model / status /
 *   pricing / estimated XYZ surface in a card next to the dropdown.
 *
 * PRD §54 — BYOK in playground: `gratisfy:*` / `g4f:*` models show a warning
 *   panel when the user has no saved key (or is anonymous), with a link to
 *   /settings. A valid key shows a "● Ready" badge.
 *
 * PRD §77 — state machine:
 *   idle → preparing → routing → generating → completed
 *   (any of preparing/routing/generating) → error on failure
 *   generating → cancelled on user Stop
 *   error | cancelled → idle on Retry or Clear
 *
 * Streaming: POST /api/v1/chat/completions with `{model, messages, stream: true}`
 *   and credentials:"include" (so the session cookie travels). The SSE stream
 *   is parsed frame-by-frame — `data: {chunk}` appends delta content;
 *   `event: error` + `finish_reason:"error"` terminal chunks surface inline;
 *   `data: [DONE]` finalises the message.
 *
 * Cost: when the response carries a `usage` block AND the model has pricing,
 *   `usdCost = (in/1e6) * prompt_tokens + (out/1e6) * completion_tokens` and
 *   `xyzCost = usdCost * multiplier` (multiplier fetched server-side, baked
 *   into `data`).
 */

import * as React from "react";
import Link from "next/link";
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
  KeyRound,
  Cpu,
  Coins,
  Zap,
  Lock,
  ExternalLink,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// ─── Types ──────────────────────────────────────────────────────────────────

type Source = "native" | "gratisfy" | "g4f";

interface ModelPricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion?: number | null;
  currency: "USD";
  status: "documented" | "supplied" | "estimated" | "free" | "not_documented";
  source: "provider" | "pricing-board" | "manual" | "unknown";
  verifiedAt?: string;
}

interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audio: boolean;
  video: boolean;
  image: boolean;
  reasoning: boolean;
  webSearch: boolean;
  streaming: boolean;
  tools?: boolean;
}

export interface PlaygroundModel {
  id: string;
  source: Source;
  provider: string;
  displayName: string;
  originalModelId: string;
  streaming: boolean;
  available: boolean;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
}

export interface PlaygroundByokMeta {
  provider: "gratisfy" | "g4f";
  connected: boolean;
  masked: string;
  addedAt: string;
  lastValidatedAt?: string;
  lastValidationOk?: boolean;
}

export interface ChatPlaygroundData {
  models: PlaygroundModel[];
  byok: Record<"gratisfy" | "g4f", PlaygroundByokMeta>;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    lastLoginAt: string;
  } | null;
  multiplier: number;
  catalogStale: boolean;
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
  /** Inline error message (when status === "error"). */
  error?: string;
  errorType?: string;
  /** Final usage block (when captured from the last SSE chunk). */
  usage?: Usage;
  /** Computed XYZ cost for this turn (only set when usage + pricing both known). */
  xyzCost?: number;
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

// Source palette — NO indigo or blue.
const SOURCE_COLORS: Record<Source, { text: string; bg: string; border: string; dot: string; label: string }> = {
  native: {
    text: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-800/60",
    border: "border-slate-300 dark:border-slate-700",
    dot: "bg-slate-500",
    label: "Native",
  },
  gratisfy: {
    text: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-950/40",
    border: "border-violet-300 dark:border-violet-800",
    dot: "bg-violet-500",
    label: "Gratisfy",
  },
  g4f: {
    text: "text-orange-700 dark:text-orange-300",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    border: "border-orange-300 dark:border-orange-800",
    dot: "bg-orange-500",
    label: "G4F",
  },
};

// Phase palette — emerald/amber/rose/slate, no indigo/blue.
const PHASE_META: Record<Phase, { label: string; dot: string; text: string; pulse?: boolean }> = {
  idle: { label: "Idle", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-400" },
  preparing: { label: "Preparing", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", pulse: true },
  routing: { label: "Routing", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", pulse: true },
  generating: { label: "Generating", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", pulse: true },
  completed: { label: "Completed", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  error: { label: "Error", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" },
  cancelled: { label: "Cancelled", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-400" },
};

// ─── Utilities ──────────────────────────────────────────────────────────────

/** Cheap unique id (crypto.randomUUID when available, fallback to Math.random). */
function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Group models by (source, provider) preserving source order: native → gratisfy → g4f. */
function groupModels(models: PlaygroundModel[]): Array<{ source: Source; provider: string; items: PlaygroundModel[] }> {
  const order: Source[] = ["native", "gratisfy", "g4f"];
  const buckets = new Map<string, { source: Source; provider: string; items: PlaygroundModel[] }>();
  for (const m of models) {
    const key = `${m.source}::${m.provider}`;
    const entry = buckets.get(key);
    if (entry) {
      entry.items.push(m);
    } else {
      buckets.set(key, { source: m.source, provider: m.provider, items: [m] });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => {
    const ai = order.indexOf(a.source);
    const bi = order.indexOf(b.source);
    if (ai !== bi) return ai - bi;
    return a.provider.localeCompare(b.provider);
  });
}

/** Format a USD price as $X.XX / 1M tokens. */
function formatUsd(perMillion: number | null | undefined): string {
  if (perMillion == null) return "—";
  if (perMillion === 0) return "free";
  return `$${perMillion.toFixed(2)}/1M`;
}

/** Format an XYZ cost as a 4-decimal number. */
function formatXyz(cost: number): string {
  return cost.toFixed(4);
}

/** Extract the BYOK provider key for a model id ("gratisfy" | "g4f" | null). */
function byokProviderFor(modelId: string): "gratisfy" | "g4f" | null {
  if (modelId.startsWith("gratisfy:")) return "gratisfy";
  if (modelId.startsWith("g4f:")) return "g4f";
  return null;
}

/** Friendly provider name for a (source, provider) tuple. */
function providerLabel(source: Source, provider: string): string {
  if (source === "native") {
    // Map short ids to friendlier names (mirrors the gateway's PROVIDER_SHORT_IDS).
    const NATIVE_NAMES: Record<string, string> = {
      tb: "Toolbaz",
      au: "Aurora AI",
      ss: "SurfSense",
      jg: "JollyGen",
      ua: "UnlimitedAI",
      po: "Pollinations",
      kc: "Kilo Code",
      l7: "LLM7",
      sw: "SpicyWriter",
      fg: "FreeGPT",
      oc: "OpenCode",
      fc: "FreeChat",
      mk: "Miklium",
      sm: "Swarm",
      fx: "FreeAIXYZ",
      go: "GPT-OSS",
      vx: "Vexa",
      un: "UncloseAI",
      f2: "Free2GPT",
    };
    return NATIVE_NAMES[provider] ?? provider.toUpperCase();
  }
  if (source === "gratisfy") return "Gratisfy";
  if (source === "g4f") return provider === "g4f" ? "G4F" : `G4F — ${provider}`;
  return provider;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ChatPlaygroundClient({ data }: { data: ChatPlaygroundData }) {
  const { models, byok, user, multiplier, catalogStale } = data;

  // Selected model + messages.
  const [selectedModelId, setSelectedModelId] = React.useState<string>("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState<string>("");
  const [system, setSystem] = React.useState<string>("");
  const [showSystem, setShowSystem] = React.useState<boolean>(false);

  // State machine (PRD §77).
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [usage, setUsage] = React.useState<Usage | null>(null);
  const [xyzCost, setXyzCost] = React.useState<number | null>(null);

  // Live usage tracking during streaming (cumulative across the current turn).
  const [streamTokens, setStreamTokens] = React.useState<{
    in: number;
    out: number;
  } | null>(null);

  // Misc UI state.
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState<boolean>(false);
  const [initialModelResolved, setInitialModelResolved] = React.useState<boolean>(false);

  // Refs.
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = React.useRef<ChatMessage[]>([]);
  const selectedModelRef = React.useRef<string>("");
  const systemRef = React.useRef<string>("");

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

  // Auto-select the first available model on first mount if no ?model= param.
  // Also resolve a `?model=...` deep-link (URL-encoded).
  React.useEffect(() => {
    if (initialModelResolved) return;
    setInitialModelResolved(true);
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
      // Prefer a native streaming model — anonymous-safe and fast.
      const firstNative = models.find(
        (m) => m.source === "native" && m.streaming && m.capabilities.streaming,
      );
      setSelectedModelId((firstNative ?? models[0]).id);
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

  // Cancel any in-flight stream on unmount.
  React.useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // ─── Derived ────────────────────────────────────────────────────────────

  const selectedModel = React.useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const selectedByokProvider = selectedModel
    ? byokProviderFor(selectedModel.id)
    : null;

  // PRD §54 — BYOK readiness for the currently selected model.
  const byokState = React.useMemo<{
    state: "ready" | "invalid" | "needs-key" | "needs-auth" | "n/a";
    label: string;
    panelKind: "none" | "sign-in" | "configure-gratisfy" | "configure-g4f" | "invalid";
    maskedKey?: string;
  }>(() => {
    if (!selectedByokProvider) {
      return { state: "n/a", label: "Open", panelKind: "none" };
    }
    if (!user) {
      return { state: "needs-auth", label: "Sign in", panelKind: "sign-in" };
    }
    const meta = byok[selectedByokProvider];
    if (!meta.connected) {
      return {
        state: "needs-key",
        label: "Configure",
        panelKind:
          selectedByokProvider === "gratisfy"
            ? "configure-gratisfy"
            : "configure-g4f",
      };
    }
    if (meta.lastValidationOk === false) {
      return {
        state: "invalid",
        label: "Invalid key",
        panelKind: "invalid",
        maskedKey: meta.masked,
      };
    }
    return { state: "ready", label: "Ready", panelKind: "none", maskedKey: meta.masked };
  }, [selectedByokProvider, user, byok]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleSelectModel = React.useCallback((id: string) => {
    setSelectedModelId(id);
    setUsage(null);
    setXyzCost(null);
    setStreamTokens(null);
  }, []);

  const stop = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      // The fetch promise will reject with AbortError; the streaming try/catch
      // below finalises the message state with status="cancelled".
    }
  }, []);

  const clear = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setMessages([]);
    setUsage(null);
    setXyzCost(null);
    setStreamTokens(null);
    setErrorMessage(null);
    setPhase("idle");
    toast("Chat cleared");
  }, []);

  const send = React.useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text) return;
      if (!selectedModelRef.current) {
        toast.error("Pick a model first.");
        return;
      }
      // PRD §77 — idle → preparing.
      setPhase("preparing");
      setErrorMessage(null);
      setUsage(null);
      setXyzCost(null);
      setStreamTokens(null);

      // PRD §54 — BYOK gate.
      const byokP = byokProviderFor(selectedModelRef.current);
      if (byokP) {
        if (!user) {
          setPhase("error");
          setErrorMessage("Sign in to use BYOK models.");
          toast.error("Sign in to use BYOK models.");
          return;
        }
        if (!byok[byokP].connected) {
          setPhase("error");
          setErrorMessage(
            `This model requires your ${byokP === "gratisfy" ? "Gratisfy" : "G4F"} API key.`,
          );
          toast.error(
            `Configure your ${byokP === "gratisfy" ? "Gratisfy" : "G4F"} key in Settings.`,
          );
          return;
        }
      }

      // Build the message list — prior turns + new user turn.
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        model: selectedModelRef.current,
        providerLabel: selectedModel
          ? providerLabel(selectedModel.source, selectedModel.provider)
          : selectedModelRef.current,
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

      // PRD §77 — preparing → routing.
      setPhase("routing");

      const ac = new AbortController();
      abortRef.current = ac;

      // Mutable holder for values captured inside the SSE closure.
      // TS doesn't follow assignments inside callbacks, so we read the
      // holder's `.value` field (a property access defeats control-flow
      // narrowing) and re-bind to a fresh local const for the truthy guard.
      const holder: { usage: Usage | null; error: SseError | null } = {
        usage: null,
        error: null,
      };

      try {
        const response = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            model: selectedModelRef.current,
            messages: requestMessages,
            stream: true,
          }),
          signal: ac.signal,
        });

        // Non-2xx — server didn't even open the stream. Surface the JSON
        // error envelope inline (PRD §76).
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

        // PRD §77 — routing → generating.
        setPhase("generating");

        await readSseStream(response, {
          onDelta: (content) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + content }
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

        // Mid-stream error — surface inline (PRD §57, §76).
        // Reading holder.error (a property access) keeps TS from narrowing
        // the value to `never` after the closure assignment.
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

        // PRD §77 — generating → completed.
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

        // Cost tracking — only when the model has documented pricing.
        // Same closure-narrowing caveat as `finalErr` above — read via the
        // holder object so the truthy guard narrows.
        const finalUsage: Usage | null = holder.usage;
        if (finalUsage && selectedModel) {
          const p = selectedModel.pricing;
          if (p.inputPerMillion != null && p.outputPerMillion != null) {
            const usdCost =
              (finalUsage.prompt_tokens / 1e6) * p.inputPerMillion +
              (finalUsage.completion_tokens / 1e6) * p.outputPerMillion;
            const xyz = usdCost * (multiplier || 1);
            setXyzCost(xyz);
            setUsage(finalUsage);
            // Persist on the assistant message too, so the cost survives
            // a future Clear.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, usage: finalUsage, xyzCost: xyz } : m,
              ),
            );
          } else {
            // BYOK or undocumented pricing — show usage but no XYZ cost.
            setUsage(finalUsage);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id ? { ...m, usage: finalUsage } : m,
              ),
            );
          }
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
        // PRD §76 — network failure.
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
        abortRef.current = null;
      }
    },
    // Refs (selectedModelRef / messagesRef / systemRef) carry fresh values
    // across renders so they don't need to be in the dep array.
    [input, selectedModel, user, byok, multiplier],
  );

  const retry = React.useCallback(() => {
    // PRD §77 — error | cancelled → idle on Retry.
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

  // ─── Render ──────────────────────────────────────────────────────────────

  const isStreaming = phase === "preparing" || phase === "routing" || phase === "generating";
  const phaseMeta = PHASE_META[phase];

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Catalog stale banner */}
      {catalogStale && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-sm font-medium">
            Catalog is in degraded mode
          </AlertTitle>
          <AlertDescription className="text-xs">
            G4F live discovery failed — serving the last-known-good cache. Some
            G4F models may be unavailable until discovery recovers.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 min-h-0">
        {/* ─── Chat column ─── */}
        <Card className="flex flex-col gap-0 p-0 min-h-0 overflow-hidden">
          {/* Model selector bar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex-1 min-w-0">
              <Select
                value={selectedModelId}
                onValueChange={handleSelectModel}
                disabled={models.length === 0}
              >
                <SelectTrigger
                  className="w-full h-9 font-mono text-[12px] bg-background"
                  aria-label="Select a model"
                >
                  <SelectValue
                    placeholder={
                      models.length === 0
                        ? "No models available"
                        : "Select a model"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-[420px]">
                  {groupModels(models).map((group) => (
                    <SelectGroup key={`${group.source}:${group.provider}`}>
                      <SelectLabel className="text-[10px] uppercase tracking-[0.15em] font-medium flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 rounded-full",
                            SOURCE_COLORS[group.source].dot,
                          )}
                        />
                        <span className={SOURCE_COLORS[group.source].text}>
                          {SOURCE_COLORS[group.source].label}
                        </span>
                        <span className="text-muted-foreground">—</span>
                        <span className="text-foreground/80">
                          {providerLabel(group.source, group.provider)}
                        </span>
                      </SelectLabel>
                      {group.items.map((m) => (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                          className="font-mono text-[11px] leading-snug py-2"
                        >
                          <span className="flex flex-col gap-0.5">
                            <span className="break-all">{m.id}</span>
                            <span className="text-[10px] text-muted-foreground not-italic">
                              {formatUsd(m.pricing.inputPerMillion)} in ·{" "}
                              {formatUsd(m.pricing.outputPerMillion)} out
                              {m.streaming ? " · stream" : ""}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                      <SelectSeparator />
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  phaseMeta.text,
                  "border-border bg-background",
                )}
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    phaseMeta.dot,
                    phaseMeta.pulse && "animate-pulse-dot",
                  )}
                />
                {phaseMeta.label}
              </span>
            </div>
          </div>

          {/* BYOK warning panel (PRD §54) */}
          {byokState.panelKind !== "none" && (
            <ByokWarningPanel
              kind={byokState.panelKind}
              maskedKey={byokState.maskedKey}
            />
          )}

          {/* Messages list */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={scrollRef}
              className="max-h-[60vh] overflow-y-auto px-4 py-4 custom-scroll"
            >
              {messages.length === 0 ? (
                <EmptyState
                  onPickSuggestion={(s) => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {messages.map((m, i) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      index={i}
                      copied={copiedIdx === i}
                      onCopy={async () => {
                        try {
                          await navigator.clipboard.writeText(m.content);
                          setCopiedIdx(i);
                          setTimeout(() => setCopiedIdx(null), 2000);
                          toast.success("Copied to clipboard");
                        } catch {
                          toast.error("Clipboard unavailable");
                        }
                      }}
                      multiplier={multiplier}
                    />
                  ))}
                </div>
              )}
            </div>
            {showJumpToLatest && (
              <button
                type="button"
                onClick={() => {
                  const el = scrollRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] shadow-md hover:bg-accent transition-colors"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                <ArrowDown className="h-3 w-3" />
                Jump to latest
              </button>
            )}
          </div>

          {/* Input row */}
          <div className="border-t border-border bg-background p-3 flex flex-col gap-2">
            {showSystem && (
              <div className="mb-1">
                <Textarea
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  placeholder="System prompt (optional) — sets the assistant's persona / rules…"
                  className="min-h-[60px] text-[13px] font-mono"
                  aria-label="System prompt"
                />
                <div className="flex justify-end mt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px] h-7 text-muted-foreground"
                    onClick={() => setShowSystem(false)}
                  >
                    Hide system
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
              <div className="flex-1 min-w-0">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Send a message to ${
                    selectedModel?.displayName ?? "the model"
                  }…`}
                  className="min-h-[60px] max-h-[200px] text-[14px] resize-y"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!isStreaming && input.trim()) {
                        void send();
                      }
                    }
                  }}
                  disabled={models.length === 0}
                  aria-label="Chat input"
                />
              </div>
              <div className="flex gap-2 shrink-0">
                {isStreaming ? (
                  <Button
                    onClick={stop}
                    variant="outline"
                    className="h-[60px] sm:h-auto sm:self-end border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    onClick={() => void send()}
                    disabled={!input.trim() || !selectedModelId || models.length === 0}
                    className="h-[60px] sm:h-auto sm:self-end bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-muted-foreground"
                  onClick={() => setShowSystem((s) => !s)}
                >
                  {showSystem ? "Hide system" : "Add system"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-muted-foreground"
                  onClick={clear}
                  disabled={messages.length === 0}
                >
                  <Trash2 className="h-3 w-3" />
                  Clear chat
                </Button>
                {(phase === "error" || phase === "cancelled") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px] text-emerald-700 hover:text-emerald-600 dark:text-emerald-300"
                    onClick={retry}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </Button>
                )}
              </div>
              <span
                className="font-mono text-[10px]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                Enter to send · Shift+Enter for newline
              </span>
            </div>
          </div>
        </Card>

        {/* ─── Side panel (model + usage) ─── */}
        <aside className="flex flex-col gap-4 min-w-0">
          {selectedModel ? (
            <ModelCard
              model={selectedModel}
              byokState={byokState}
              multiplier={multiplier}
            />
          ) : (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Cpu className="h-4 w-4" />
                No model selected
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Pick a model from the dropdown to start chatting.
              </p>
            </Card>
          )}

          {/* Live usage */}
          <Card className="p-4 gap-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              Token usage
            </div>
            {usage || streamTokens ? (
              <UsageGrid
                inTokens={(usage?.prompt_tokens ?? streamTokens?.in) ?? 0}
                outTokens={(usage?.completion_tokens ?? streamTokens?.out) ?? 0}
                totalTokens={usage?.total_tokens ?? ((streamTokens?.in ?? 0) + (streamTokens?.out ?? 0))}
                xyzCost={xyzCost}
                multiplier={multiplier}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Send a message to see live token + cost tracking.
              </p>
            )}
          </Card>

          {/* Last error */}
          {phase === "error" && errorMessage && (
            <Alert className="border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-sm font-medium">Last error</AlertTitle>
              <AlertDescription className="text-xs break-words">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}

          {/* Deep-link helper */}
          <Card className="p-4 gap-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              Deep-link
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Append{" "}
              <code
                className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded text-foreground/80"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                ?model=&lt;urlencoded-id&gt;
              </code>{" "}
              to share a pre-selected model.
            </p>
            {selectedModelId && (
              <p
                className="font-mono text-[10px] text-muted-foreground break-all"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                /chat?model={encodeURIComponent(selectedModelId)}
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* Custom scrollbar styling (injected once) */}
      <style jsx global>{`
        .custom-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: hsl(var(--muted-foreground) / 0.3);
          border-radius: 4px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--muted-foreground) / 0.5);
        }
        @keyframes pulse-dot-anim {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .animate-pulse-dot {
          animation: pulse-dot-anim 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function EmptyState({ onPickSuggestion }: { onPickSuggestion: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 gap-4">
      <div className="rounded-full bg-emerald-50 dark:bg-emerald-950/40 p-3 border border-emerald-200 dark:border-emerald-800">
        <Bot className="h-6 w-6 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">
          Start a conversation
        </h3>
        <p className="text-xs text-muted-foreground max-w-md">
          Pick a model above and send your first message. The assistant
          streams tokens in real time as they arrive from upstream — no
          buffering, no re-pacing.
        </p>
      </div>
      <div className="flex flex-col gap-1.5 max-w-md w-full">
        {PROMPT_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPickSuggestion(s)}
            className="text-left text-[12px] px-3 py-2 rounded-md border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  index,
  copied,
  onCopy,
  multiplier,
}: {
  message: ChatMessage;
  index: number;
  copied: boolean;
  onCopy: () => void;
  multiplier: number;
}) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";
  const isError = message.status === "error";
  const isCancelled = message.status === "cancelled";

  return (
    <article
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
      aria-label={`${message.role} message ${index + 1}`}
    >
      <div
        className={cn(
          "shrink-0 rounded-full p-2 border h-9 w-9 flex items-center justify-center",
          isUser
            ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300"
            : "bg-slate-100 border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300",
        )}
      >
        {isUser ? (
          <UserIcon className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Bot className="h-4 w-4" strokeWidth={1.75} />
        )}
      </div>
      <div className={cn("flex flex-col gap-1 min-w-0 max-w-[85%] sm:max-w-[80%]", isUser ? "items-end" : "items-start")}>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono uppercase tracking-[0.12em]">
            {isUser ? "You" : "Assistant"}
          </span>
          {message.providerLabel && (
            <span className="text-muted-foreground/70">· {message.providerLabel}</span>
          )}
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              streaming
            </span>
          )}
          {isCancelled && (
            <span className="text-slate-500">· stopped</span>
          )}
          {isError && (
            <span className="text-rose-600 dark:text-rose-400">· error</span>
          )}
        </div>
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-[13px] leading-relaxed break-words",
            isUser
              ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-foreground"
              : "bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-foreground",
          )}
        >
          {message.content ? (
            isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MarkdownRenderer text={message.content} />
            )
          ) : isStreaming ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-[12px]">
              <span className="inline-block h-3 w-1.5 bg-emerald-500 animate-pulse-dot" />
              waiting for first token…
            </span>
          ) : (
            <span className="text-muted-foreground text-[12px] italic">
              (no content)
            </span>
          )}
        </div>

        {/* Inline error card */}
        {isError && message.error && (
          <Alert className="mt-1 border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800 py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <AlertDescription className="text-[12px] break-words">
              {message.error}
            </AlertDescription>
          </Alert>
        )}

        {/* Footer with model + usage + actions */}
        {!isUser && (message.model || message.usage) && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {message.model && (
              <code
                className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/80 break-all"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {message.model}
              </code>
            )}
            {message.usage && (
              <span
                className="font-mono text-[10px]"
                style={{ fontFamily: "var(--font-mono), monospace" }}
              >
                {message.usage.prompt_tokens} in · {message.usage.completion_tokens} out
                {message.usage.total_tokens ? ` · ${message.usage.total_tokens} total` : ""}
              </span>
            )}
            {message.xyzCost != null && message.xyzCost > 0 && (
              <Badge className="bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800 text-[10px] font-mono">
                <Zap className="h-2.5 w-2.5" />
                {formatXyz(message.xyzCost)} XYZ
              </Badge>
            )}
            {message.xyzCost === 0 && message.usage && (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 text-[10px] font-mono">
                free
              </Badge>
            )}
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Copy message"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {/* multiplier kept in scope for future per-message recompute */}
        <span className="sr-only">Multiplier: {multiplier}</span>
      </div>
    </article>
  );
}

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
              className="text-emerald-700 dark:text-emerald-400 underline underline-offset-2 hover:opacity-70"
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
          h1: ({ children }) => (
            <h1 className="text-base font-semibold mt-3 mb-1.5">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[13px] font-semibold mt-2 mb-1">{children}</h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-slate-300 dark:border-slate-700 pl-3 my-2 italic text-muted-foreground">
              {children}
            </blockquote>
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
  const text = getChildrenText(children).replace(/\n$/, "");
  // Block code (fenced) carries a `language-xxx` className; inline does not.
  const isBlock = Boolean(className && className.includes("language-"));
  const language = isBlock
    ? className?.replace(/^.*language-/, "").split(" ")[0] ?? "text"
    : null;
  const [copied, setCopied] = React.useState(false);

  if (!isBlock) {
    return (
      <code
        className={cn(
          "px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[12px]",
          className,
        )}
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {children}
      </code>
    );
  }
  return (
    <div className="relative my-2 rounded-lg border border-slate-700 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700 bg-slate-800 text-slate-100">
        <span
          className="text-[10px] uppercase tracking-[0.12em] text-slate-300"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
              toast.success("Code copied");
            } catch {
              toast.error("Clipboard unavailable");
            }
          }}
          className="h-6 px-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] rounded-full hover:bg-slate-700 transition-colors"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          fontSize: "12px",
          fontFamily: "var(--font-mono), monospace",
          background: "#0F172A",
        }}
        wrapLongLines
      >
        {text}
      </SyntaxHighlighter>
    </div>
  );
}

function getChildrenText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) {
    return children.map((c) => getChildrenText(c)).join("");
  }
  if (React.isValidElement(children)) {
    return getChildrenText((children.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function ModelCard({
  model,
  byokState,
  multiplier,
}: {
  model: PlaygroundModel;
  byokState: {
    state: "ready" | "invalid" | "needs-key" | "needs-auth" | "n/a";
    label: string;
    panelKind: string;
    maskedKey?: string;
  };
  multiplier: number;
}) {
  const sourceColor = SOURCE_COLORS[model.source];
  const pricing = model.pricing;
  const isFree =
    pricing.status === "free" ||
    (pricing.inputPerMillion === 0 && pricing.outputPerMillion === 0);
  const isDocumented =
    pricing.inputPerMillion != null && pricing.outputPerMillion != null;

  // Estimated XYZ for the standard reference request (PRD §33): 1200 in + 800 out.
  const referenceInputTokens = 1200;
  const referenceOutputTokens = 800;
  const estimatedUsd =
    isDocumented && pricing.inputPerMillion != null && pricing.outputPerMillion != null
      ? (referenceInputTokens / 1e6) * pricing.inputPerMillion +
        (referenceOutputTokens / 1e6) * pricing.outputPerMillion
      : null;
  const estimatedXyz = estimatedUsd != null ? estimatedUsd * (multiplier || 1) : null;

  const byokBadgeColor =
    byokState.state === "ready"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
      : byokState.state === "invalid"
        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
        : byokState.state === "needs-key" || byokState.state === "needs-auth"
          ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
          : "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700";

  return (
    <Card className="p-4 gap-3">
      <div className="flex items-center gap-2">
        <span className={cn("inline-block h-2 w-2 rounded-full", sourceColor.dot)} />
        <span
          className={cn("text-[10px] uppercase tracking-[0.15em] font-medium", sourceColor.text)}
        >
          {sourceColor.label}
        </span>
        <span className="text-muted-foreground text-[10px]">—</span>
        <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/80">
          {providerLabel(model.source, model.provider)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-medium text-foreground">
          {model.displayName}
        </h3>
        <code
          className="font-mono text-[10px] text-muted-foreground break-all"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {model.id}
        </code>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5">
        <Badge className={cn("text-[10px]", byokBadgeColor)}>
          {byokState.state === "ready" && <Check className="h-2.5 w-2.5" />}
          {byokState.state === "invalid" && <AlertCircle className="h-2.5 w-2.5" />}
          {byokState.state === "needs-key" && <KeyRound className="h-2.5 w-2.5" />}
          {byokState.state === "needs-auth" && <Lock className="h-2.5 w-2.5" />}
          {byokState.label}
        </Badge>
        {isFree && (
          <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
            free
          </Badge>
        )}
        {model.streaming && (
          <Badge className="text-[10px] bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700">
            stream
          </Badge>
        )}
      </div>

      {byokState.maskedKey && (
        <div className="text-[10px] text-muted-foreground">
          Key:{" "}
          <code
            className="font-mono text-[10px] text-foreground/80"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            {byokState.maskedKey}
          </code>
        </div>
      )}

      {/* Pricing grid */}
      <div className="grid grid-cols-2 gap-2 mt-1">
        <PricingCell label="Input" value={formatUsd(pricing.inputPerMillion)} />
        <PricingCell label="Output" value={formatUsd(pricing.outputPerMillion)} />
        <PricingCell
          label="Cache"
          value={
            pricing.cachePerMillion != null
              ? formatUsd(pricing.cachePerMillion)
              : "—"
          }
        />
        <PricingCell label="Status" value={pricing.status.replace("_", " ")} />
      </div>

      {/* Estimated XYZ for the reference request (PRD §33) */}
      <div className="mt-1 pt-3 border-t border-border">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">
          Estimated XYZ per request
        </div>
        {estimatedXyz != null ? (
          <div className="flex items-center gap-2">
            <Badge className="text-[10px] font-mono bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800">
              <Zap className="h-2.5 w-2.5" />
              {formatXyz(estimatedXyz)} XYZ
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              ≈ ${estimatedUsd?.toFixed(4)} USD × {multiplier}
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Pricing not documented for this model — actual cost will be
            computed if the upstream reports token usage.
          </p>
        )}
      </div>
    </Card>
  );
}

function PricingCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span
        className="font-mono text-[11px] text-foreground"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {value}
      </span>
    </div>
  );
}

function UsageGrid({
  inTokens,
  outTokens,
  totalTokens,
  xyzCost,
  multiplier,
}: {
  inTokens: number;
  outTokens: number;
  totalTokens: number;
  xyzCost: number | null;
  multiplier: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-1">
      <UsageCell label="Prompt" value={inTokens.toLocaleString()} accent="slate" />
      <UsageCell label="Completion" value={outTokens.toLocaleString()} accent="emerald" />
      <UsageCell label="Total" value={totalTokens.toLocaleString()} accent="slate" />
      <div className="flex flex-col gap-0.5 rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 px-2 py-1.5">
        <span className="text-[9px] uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">
          XYZ Cost
        </span>
        <span
          className="font-mono text-[11px] text-violet-900 dark:text-violet-200"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        >
          {xyzCost != null ? `${formatXyz(xyzCost)}` : "—"}
        </span>
      </div>
      <div className="col-span-2 text-[10px] text-muted-foreground mt-0.5">
        Multiplier: {multiplier} · BYOK turns cost 0 platform XYZ
      </div>
    </div>
  );
}

function UsageCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "slate" | "emerald";
}) {
  const colors =
    accent === "emerald"
      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300";
  return (
    <div className={cn("flex flex-col gap-0.5 rounded-md border px-2 py-1.5", colors)}>
      <span className="text-[9px] uppercase tracking-[0.12em] opacity-80">
        {label}
      </span>
      <span
        className="font-mono text-[11px]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {value}
      </span>
    </div>
  );
}

function ByokWarningPanel({
  kind,
  maskedKey,
}: {
  kind:
    | "sign-in"
    | "configure-gratisfy"
    | "configure-g4f"
    | "invalid";
  maskedKey?: string;
}) {
  if (kind === "sign-in") {
    return (
      <Alert className="rounded-none border-x-0 border-t-0 border-b border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
        <Lock className="h-4 w-4" />
        <AlertTitle className="text-sm font-medium">
          Sign in to use BYOK models
        </AlertTitle>
        <AlertDescription className="text-xs flex flex-col gap-2 mt-1">
          <span>
            This model is sourced from a Bring-Your-Own-Key provider. Sign in
            to attach your stored API key and route the request through the
            user-account credential store.
          </span>
          <div>
            <Button
              asChild
              size="sm"
              className="h-7 text-[11px] bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Link href="/account">
                <Lock className="h-3 w-3" />
                Sign in
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  if (kind === "configure-gratisfy" || kind === "configure-g4f") {
    const providerName = kind === "configure-gratisfy" ? "Gratisfy" : "G4F";
    const accent =
      kind === "configure-gratisfy"
        ? "border-violet-300 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-800"
        : "border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800";
    const buttonClass =
      kind === "configure-gratisfy"
        ? "bg-violet-600 hover:bg-violet-700 text-white"
        : "bg-orange-600 hover:bg-orange-700 text-white";
    return (
      <Alert className={cn("rounded-none border-x-0 border-t-0 border-b", accent)}>
        <KeyRound className="h-4 w-4" />
        <AlertTitle className="text-sm font-medium">
          This model requires your {providerName} API key
        </AlertTitle>
        <AlertDescription className="text-xs flex flex-col gap-2 mt-1">
          <span>
            You&apos;re signed in but no {providerName} BYOK key is configured.
            The chat endpoint will return 401 <code
              className="font-mono text-[10px] bg-white/60 dark:bg-black/40 px-1 py-0.5 rounded"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >BYOK_KEY_REQUIRED</code> until you save one. Keys are stored
            encrypted server-side and never travel with chat requests (PRD §10).
          </span>
          <div>
            <Button
              asChild
              size="sm"
              className={cn("h-7 text-[11px]", buttonClass)}
            >
              <Link href="/settings">
                <KeyRound className="h-3 w-3" />
                Configure {providerName}
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  if (kind === "invalid") {
    return (
      <Alert className="rounded-none border-x-0 border-t-0 border-b border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle className="text-sm font-medium">
          BYOK key validation failed
        </AlertTitle>
        <AlertDescription className="text-xs flex flex-col gap-2 mt-1">
          <span>
            Your saved key ({maskedKey || "masked"}) failed the last validation
            round-trip. Re-save it in Settings to refresh.
          </span>
          <div>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
            >
              <Link href="/settings">
                <RefreshCw className="h-3 w-3" />
                Re-validate key
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

// ─── SSE stream reader ───────────────────────────────────────────────────────

interface SseHandlers {
  onDelta: (content: string) => void;
  onUsage: (usage: Usage) => void;
  onError: (error: SseError) => void;
  onDone: () => void;
}

/**
 * Parse the SSE response body incrementally and dispatch each frame to the
 * appropriate handler. Handles:
 *   - `data: {...}` — OpenAI chunk with delta.content + optional usage
 *   - `data: [DONE]` — terminal sentinel → onDone()
 *   - `event: error\ndata: {...}` — mid-stream error → onError()
 *   - Terminal chunk with `finish_reason: "error"` — onError()
 *
 * Aborts cleanly when the AbortSignal fires (cancels the underlying reader).
 */
async function readSseStream(
  response: Response,
  handlers: SseHandlers,
  signal: AbortSignal,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingEvent = "";
  let dataLines: string[] = [];
  let done = false;

  const flush = () => {
    if (dataLines.length === 0) {
      pendingEvent = "";
      return;
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
      return;
    }

    if (data === "[DONE]") {
      if (!done) {
        done = true;
        handlers.onDone();
      }
      return;
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
        return;
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
      // Not JSON — ignore the line (some servers send comment frames).
    }
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
      for (const line of lines) {
        if (line === "") {
          flush();
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
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best-effort */ }
  }
}


