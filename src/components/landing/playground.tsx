"use client";

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Trash2, Bot, User, Zap, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MODELS } from "@/lib/providers";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const PLAYGROUND_MODELS = MODELS.map((m) => ({
  id: m.id,
  key: `${m.provider}:${m.id}`,
  label: m.id,
  hint: m.description,
}));

const SAMPLE_PROMPTS = [
  "Write a haiku about serverless APIs",
  "Explain quantum entanglement in one paragraph",
  "Give me 3 startup ideas using AI",
  "Write a Python function to check if a string is a palindrome",
];

/** Parse a Server-Sent-Events stream into incremental text deltas. */
async function* parseSSE(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
}

const emptySubscribe = () => () => {};
/** Returns true only on the client (after hydration), avoiding SSR/client ID mismatches in Radix. */
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function Playground() {
  const mounted = useMounted();
  const [model, setModel] = useState("toolbaz-v4.5-fast");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [stream, setStream] = useState(true);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    const apiMessages = [
      ...(systemPrompt.trim()
        ? [{ role: "system" as const, content: systemPrompt.trim() }]
        : []),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const controller = new AbortController();
    abortRef.current = controller;

    // optimistically add an empty assistant bubble we can stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      // Include LMArena token from localStorage if set (via /settings page)
      const lmarenaToken = typeof window !== "undefined" ? localStorage.getItem("lmarena_token") || "" : "";
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(lmarenaToken ? { "x-lmarena-token": lmarenaToken } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
      }

      if (stream) {
        let acc = "";
        for await (const delta of parseSSE(res)) {
          acc += delta;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: acc };
            return next;
          });
        }
        if (!acc) {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: "(empty response)",
            };
            return next;
          });
        }
      } else {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? "(empty)";
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content };
          return next;
        });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              role: "assistant",
              content: last.content + "\n\n_(stopped)_",
            };
          }
          return next;
        });
      } else {
        const message = err instanceof Error ? err.message : "Request failed";
        toast.error(message);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: `⚠️ ${message}`,
          };
          return next;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [input, loading, messages, model, stream, systemPrompt]);

  const stop = () => abortRef.current?.abort();

  const clear = () => {
    setMessages([]);
    toast.success("Conversation cleared");
  };

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-4">
      {/* Chat column */}
      <div className="flex flex-col rounded-xl border border-border bg-card/60 backdrop-blur overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-sm font-medium">Live Playground</span>
            {stream && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Zap className="h-3 w-3" /> streaming
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-[420px] max-h-[520px] overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10">
              <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Bot className="h-7 w-7 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Try the API right here</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Each send rotates a fresh Toolbaz token behind the scenes —
                  no key needed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {SAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setInput(p)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border bg-background/60 hover:bg-accent hover:border-emerald-500/40 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex gap-3",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                {m.role === "assistant" && (
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-emerald-400" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm border border-border",
                  )}
                >
                  {m.content || (
                    <span className="inline-flex gap-1 items-center text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce" />
                    </span>
                  )}
                </div>
                {m.role === "user" && (
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-muted border border-border flex items-center justify-center">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </motion.div>
            ))
          )}
        </div>

        <div className="border-t border-border p-3 bg-muted/20">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
              rows={1}
              className="min-h-[44px] max-h-40 resize-none bg-background"
            />
            {loading ? (
              <Button
                onClick={stop}
                variant="destructive"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Stop"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={send}
                size="icon"
                className="h-11 w-11 shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Settings column */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-400" /> Settings
          </h3>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Model</Label>
            {mounted ? (
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAYGROUND_MODELS.map((m) => (
                    <SelectItem key={m.key} value={m.id}>
                      <div className="flex flex-col">
                        <span>{m.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {m.hint}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 rounded-md border border-input px-3 flex items-center text-sm text-muted-foreground">
                {model}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              System prompt
            </Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="resize-none text-xs bg-background"
              placeholder="Optional system instructions…"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2">
            <Label htmlFor="stream" className="text-xs cursor-pointer">
              Stream tokens
            </Label>
            <Switch id="stream" checked={stream} onCheckedChange={setStream} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 space-y-2">
          <h3 className="text-sm font-semibold">Endpoint</h3>
          <code className="block text-[11px] text-emerald-400 break-all bg-emerald-500/5 border border-emerald-500/15 rounded-md px-2.5 py-2">
            POST /api/v1/chat/completions
          </code>
          <p className="text-[11px] text-muted-foreground">
            Drop-in compatible with the OpenAI Chat Completions schema.
          </p>
        </div>
      </div>
    </div>
  );
}
