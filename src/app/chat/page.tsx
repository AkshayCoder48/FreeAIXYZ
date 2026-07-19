"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  User,
  Send,
  Square,
  Plus,
  Trash2,
  MessageSquare,
  FileCode2,
  Search,
  Music,
  Wrench,
  X,
  Menu,
  Copy,
  Check,
  Zap,
  ExternalLink,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ModelSelect } from "@/components/landing/model-select";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface AudioAsset {
  audio_base64: string;
  format: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  searchResults?: SearchResult[];
  audio?: AudioAsset[];
}

interface StoredChat {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredFile {
  id: string;
  name: string;
  content: string;
  language: string;
  createdAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHATS_KEY = "freeaipt_chats";
const FILES_KEY = "freeaipt_files";
const DEFAULT_MODEL = "toolbaz-v4.5-fast";

const FILE_EXTENSIONS: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  json: "json",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  go: "go",
  rust: "rs",
  rs: "rs",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  cs: "cs",
  sql: "sql",
  yaml: "yml",
  yml: "yml",
  toml: "toml",
  xml: "xml",
  markdown: "md",
  md: "md",
  php: "php",
  ruby: "rb",
  rb: "rb",
  swift: "swift",
  kotlin: "kt",
  scala: "scala",
  dart: "dart",
  r: "r",
  lua: "lua",
  perl: "pl",
  haskell: "hs",
  elixir: "ex",
  clojure: "clj",
  text: "txt",
  plaintext: "txt",
  "": "txt",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const emptySubscribe = () => () => {};
/** True only after hydration (prevents Radix hydration mismatch in ModelSelect). */
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadChats(): StoredChat[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChats(chats: StoredChat[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

function loadFiles(): StoredFile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFiles(files: StoredFile[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {
    /* ignore */
  }
}

interface CodeBlockExtract {
  language: string;
  code: string;
}

/** Extract fenced code blocks (```lang\ncode```) from a markdown-ish string. */
function extractCodeBlocks(content: string): CodeBlockExtract[] {
  const blocks: CodeBlockExtract[] = [];
  const regex = /```([\w+-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const language = (match[1] || "text").toLowerCase();
    const code = match[2].replace(/\n$/, "");
    blocks.push({ language, code });
  }
  return blocks;
}

/** Accumulate streaming tool_call deltas by index (OpenAI streaming format). */
function accumulateToolCalls(
  existing: ToolCall[] | undefined,
  deltas: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
): ToolCall[] {
  const acc: ToolCall[] = existing
    ? existing.map((t) => ({
        id: t.id,
        function: {
          name: t.function.name,
          arguments: t.function.arguments,
        },
      }))
    : [];
  for (const d of deltas) {
    const idx = d.index ?? 0;
    if (!acc[idx]) {
      acc[idx] = {
        id: d.id ?? "",
        function: {
          name: d.function?.name ?? "",
          arguments: d.function?.arguments ?? "",
        },
      };
    } else {
      if (d.id) acc[idx].id = d.id;
      if (d.function?.name) acc[idx].function.name = d.function.name;
      if (d.function?.arguments)
        acc[idx].function.arguments += d.function.arguments;
    }
  }
  return acc;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

// ─── SSE Parser ─────────────────────────────────────────────────────────────

interface SSEDelta {
  content?: string;
  toolCalls?: ToolCall[];
}

/** Parse an SSE stream into incremental content + tool-call deltas. */
async function* parseSSE(response: Response): AsyncGenerator<SSEDelta> {
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
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        const content =
          typeof delta.content === "string" ? delta.content : undefined;
        const toolCalls = Array.isArray(delta.tool_calls)
          ? accumulateToolCalls([], delta.tool_calls)
          : undefined;
        if (content || toolCalls) {
          yield { content, toolCalls };
        }
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }
}

// ─── Code Block (renders a single fenced block) ─────────────────────────────

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2 rounded-lg border border-border bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-zinc-900/70">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500/70" />
          <span className="h-2 w-2 rounded-full bg-yellow-500/70" />
          <span className="h-2 w-2 rounded-full bg-[#2ce080]/70" />
          <span className="ml-2 text-[11px] text-muted-foreground font-mono uppercase tracking-wide">
            {language || "text"}
          </span>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Copy failed");
            }
          }}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed text-zinc-200 font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── Message Content (renders markdown-ish text + code blocks) ──────────────

function MessageContent({ content }: { content: string }) {
  if (!content) return null;
  // Split on fenced code blocks; keep them so we can render separately.
  const parts = content.split(/(```[\w+-]*\n[\s\S]*?```)/g);
  return (
    <div className="space-y-1">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const match = part.match(/^```([\w+-]*)\n([\s\S]*?)```$/);
          if (match) {
            return (
              <CodeBlock
                key={i}
                language={match[1] || "text"}
                code={match[2].replace(/\n$/, "")}
              />
            );
          }
        }
        // Render plain text with preserved whitespace + basic inline code.
        return part ? (
          <div
            key={i}
            className="whitespace-pre-wrap break-words leading-relaxed"
          >
            {renderInlineCode(part)}
          </div>
        ) : null;
      })}
    </div>
  );
}

/** Render `inline code` spans within plain text. */
function renderInlineCode(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /`([^`\n]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    nodes.push(
      <code
        key={`ic-${i}`}
        className="px-1.5 py-0.5 rounded bg-zinc-900/80 border border-border/60 text-[12px] font-mono text-[#2ce080]"
      >
        {match[1]}
      </code>,
    );
    last = regex.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ─── Tool Call Badge ────────────────────────────────────────────────────────

function ToolCallCard({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="space-y-1.5 my-2">
      {toolCalls.map((tc, i) => (
        <div
          key={tc.id || i}
          className="flex items-center gap-2 rounded-lg border border-[#2ce080]/50 bg-[#2ce080]/5 px-3 py-2"
        >
          <Wrench className="h-3.5 w-3.5 text-[#2ce080]" />
          <Badge
            variant="secondary"
            className="bg-[#2ce080]/15 text-[#2ce080] border border-[#2ce080]/30 font-mono text-xs"
          >
            {tc.function.name || "unknown_tool"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// ─── Audio Player ───────────────────────────────────────────────────────────

function AudioPlayer({ audios }: { audios: AudioAsset[] }) {
  return (
    <div className="space-y-2 my-2">
      {audios.map((a, i) => {
        const fmt = a.format || "mp3";
        const src = `data:audio/${fmt};base64,${a.audio_base64}`;
        return (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-[#2ce080]/40 bg-[#2ce080]/5 px-3 py-2.5"
          >
            <div className="flex items-center justify-center h-9 w-9 shrink-0 rounded-full bg-[#2ce080]/15 border border-[#2ce080]/30">
              <Music className="h-4 w-4 text-[#2ce080]" />
            </div>
            <audio controls src={src} className="flex-1 h-9 min-w-0" />
          </div>
        );
      })}
    </div>
  );
}

// ─── Search Results ─────────────────────────────────────────────────────────

function SearchResults({ results }: { results: SearchResult[] }) {
  return (
    <div className="space-y-2 my-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="h-3.5 w-3.5 text-[#2ce080]" />
        <span>{results.length} results</span>
      </div>
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {results.map((r, i) => (
          <a
            key={i}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-border bg-card/40 px-3 py-2 hover:border-[#2ce080]/40 hover:bg-[#2ce080]/5 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-foreground line-clamp-1">
                {r.title}
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            </div>
            <span className="text-[11px] text-[#2ce080] line-clamp-1 font-mono">
              {r.url}
            </span>
            {r.snippet && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                {r.snippet}
              </p>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Typing Indicator ───────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-[#2ce080] animate-bounce [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-[#2ce080] animate-bounce [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-[#2ce080] animate-bounce" />
    </span>
  );
}

// ─── Main Page Component ────────────────────────────────────────────────────

export default function ChatPage() {
  const mounted = useMounted();
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [input, setInput] = useState("");
  const [stream, setStream] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<StoredFile | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted chats + files on mount
  useEffect(() => {
    setChats(loadChats());
    setFiles(loadFiles());
  }, []);

  // Auto-scroll to bottom on new messages / streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-grow textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Persist current chat whenever messages change
  useEffect(() => {
    if (!currentChatId || messages.length === 0) return;
    const existing = chats.find((c) => c.id === currentChatId);
    const title =
      messages[0]?.content.slice(0, 60).replace(/\s+/g, " ").trim() ||
      "New Chat";
    const now = Date.now();
    const updated: StoredChat = {
      id: currentChatId,
      title,
      messages,
      model,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== currentChatId);
      next.unshift(updated);
      saveChats(next);
      return next;
    });
  }, [messages, currentChatId]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setCurrentChatId(null);
    setMessages([]);
    setInput("");
    setSidebarOpen(false);
  }, []);

  const loadChat = useCallback(
    (id: string) => {
      const chat = chats.find((c) => c.id === id);
      if (!chat) return;
      abortRef.current?.abort();
      setCurrentChatId(chat.id);
      setMessages(chat.messages);
      setModel(chat.model);
      setSidebarOpen(false);
    },
    [chats],
  );

  const deleteChat = useCallback(
    (id: string) => {
      setChats((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveChats(next);
        return next;
      });
      if (currentChatId === id) {
        setCurrentChatId(null);
        setMessages([]);
      }
      toast.success("Chat deleted");
    },
    [currentChatId],
  );

  const deleteFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const next = prev.filter((f) => f.id !== id);
        saveFiles(next);
        return next;
      });
      if (selectedFile?.id === id) setSelectedFile(null);
    },
    [selectedFile],
  );

  /** Save any new code blocks found in an assistant message as Files. */
  const saveFilesFromContent = useCallback((content: string) => {
    const blocks = extractCodeBlocks(content);
    if (blocks.length === 0) return;
    const now = Date.now();
    const newFiles: StoredFile[] = blocks.map((b, i) => ({
      id: generateId(),
      name: `${b.language || "text"}_${now + i}.${
        FILE_EXTENSIONS[b.language] ?? "txt"
      }`,
      content: b.code,
      language: b.language || "text",
      createdAt: now + i,
    }));
    setFiles((prev) => {
      const next = [...newFiles, ...prev].slice(0, 100);
      saveFiles(next);
      return next;
    });
    if (newFiles.length > 0) {
      toast.success(
        `Saved ${newFiles.length} file${newFiles.length > 1 ? "s" : ""}`,
      );
    }
  }, []);

  // ─── Chat completions (streaming + non-streaming) ────────────────────────

  const sendChat = useCallback(
    async (history: Message[], controller: AbortController) => {
      const apiMessages = history.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ model, messages: apiMessages, stream }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
      }

      if (stream) {
        let acc = "";
        let toolCalls: ToolCall[] | undefined;
        for await (const delta of parseSSE(res)) {
          if (delta.content) acc += delta.content;
          if (delta.toolCalls) {
            toolCalls = accumulateToolCalls(toolCalls, delta.toolCalls);
          }
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: acc,
                toolCalls:
                  toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
              };
            }
            return next;
          });
        }
        if (!acc && (!toolCalls || toolCalls.length === 0)) {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: "(empty response)",
            };
            return next;
          });
        } else {
          // After stream completes, extract any code blocks as Files.
          if (acc) saveFilesFromContent(acc);
        }
      } else {
        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        const content: string = msg?.content ?? "(empty)";
        const toolCalls: ToolCall[] | undefined = Array.isArray(
          msg?.tool_calls,
        )
          ? msg.tool_calls
          : undefined;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content,
            toolCalls:
              toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
          };
          return next;
        });
        if (content) saveFilesFromContent(content);
      }
    },
    [model, stream, saveFilesFromContent],
  );

  // ─── Web Search ──────────────────────────────────────────────────────────

  const sendSearch = useCallback(
    async (query: string, controller: AbortController) => {
      const res = await fetch("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ query, num: 8 }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
      }
      const data = await res.json();
      const results: SearchResult[] = Array.isArray(data?.results)
        ? data.results
        : [];
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content:
            results.length > 0
              ? `Here are the top ${results.length} web results for **${query}**.`
              : `No search results found for "${query}".`,
          searchResults: results,
        };
        return next;
      });
    },
    [],
  );

  // ─── Music Generation ────────────────────────────────────────────────────

  const sendMusic = useCallback(
    async (prompt: string, controller: AbortController) => {
      const res = await fetch("/api/v1/music/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ prompt, duration: 30 }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
        );
      }
      const data = await res.json();
      const audios: AudioAsset[] = Array.isArray(data?.audios)
        ? data.audios
        : [];
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content:
            audios.length > 0
              ? `Generated ${audios.length} audio track${
                  audios.length > 1 ? "s" : ""
                } from your prompt.`
              : data?.error
                ? `Music generation failed: ${data.error}`
                : "No audio was returned.",
          audio: audios.length > 0 ? audios : undefined,
        };
        return next;
      });
    },
    [],
  );

  // ─── Send (router) ───────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (!currentChatId) {
      setCurrentChatId(generateId());
    }

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Optimistically add an empty assistant bubble for streaming.
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      if (model === "music-generate") {
        await sendMusic(text, controller);
      } else if (model === "web-search") {
        await sendSearch(text, controller);
      } else {
        await sendChat(history, controller);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content:
                last.content + (last.content ? "\n\n" : "") + "_(stopped)_",
            };
          }
          return next;
        });
      } else {
        const message = err instanceof Error ? err.message : "Request failed";
        toast.error(message);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              content: `⚠️ ${message}`,
            };
          }
          return next;
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [
    input,
    loading,
    messages,
    model,
    currentChatId,
    sendChat,
    sendMusic,
    sendSearch,
  ]);

  const stop = () => abortRef.current?.abort();

  // ─── Render ──────────────────────────────────────────────────────────────

  const isMusicModel = model === "music-generate";
  const isSearchModel = model === "web-search";
  const inputPlaceholder = isMusicModel
    ? "Describe the music you want to generate…  (Enter to send, Shift+Enter for newline)"
    : isSearchModel
      ? "Enter a search query…  (Enter to send, Shift+Enter for newline)"
      : "Type a message…  (Enter to send, Shift+Enter for newline)";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-hidden">
      {/* ─── Header ─── */}
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-card/40 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-9 w-9"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </Button>
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to home</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2ce080] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2ce080]" />
            </span>
            FreeGPT Chat
          </span>
        </div>
      </header>

      {/* ─── Body: 3-column layout ─── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left sidebar — Chat History (drawer on mobile, static on md+) */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}
        <aside
          className={cn(
            "absolute z-40 md:relative inset-y-0 left-0 w-64 shrink-0 border-r border-border bg-card/60 backdrop-blur flex flex-col transition-transform duration-200 ease-out",
            sidebarOpen
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0",
          )}
        >
          <div className="p-3 border-b border-border">
            <Button
              onClick={newChat}
              className="w-full bg-[#2ce080] hover:bg-[#22b569] text-[#042330] font-medium gap-2"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </div>
          <div className="px-3 py-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Chat History
            </span>
          </div>
          <ScrollArea className="flex-1 px-2 pb-2">
            {chats.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  No chats yet. Start a new one!
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {chats.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      "group relative flex items-start gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors",
                      currentChatId === c.id
                        ? "bg-[#2ce080]/10 border border-[#2ce080]/30"
                        : "hover:bg-accent border border-transparent",
                    )}
                    onClick={() => loadChat(c.id)}
                  >
                    <MessageSquare
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 mt-0.5",
                        currentChatId === c.id
                          ? "text-[#2ce080]"
                          : "text-muted-foreground",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5 text-muted-foreground/60" />
                        <span className="text-[10px] text-muted-foreground/70">
                          {formatTimestamp(c.updatedAt)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 ml-1 truncate">
                          · {c.model}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteChat(c.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* Center — Chat Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-background">
          {/* Model selector bar */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card/30 shrink-0">
            {mounted ? (
              <ModelSelect value={model} onChange={setModel} />
            ) : (
              <div className="h-9 flex-1 rounded-md border border-input px-3 flex items-center text-sm text-muted-foreground">
                {model}
              </div>
            )}
            <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
              {isMusicModel ? (
                <>
                  <Music className="h-3 w-3 text-[#2ce080]" /> music
                </>
              ) : isSearchModel ? (
                <>
                  <Search className="h-3 w-3 text-[#2ce080]" /> search
                </>
              ) : stream ? (
                <>
                  <Zap className="h-3 w-3 text-[#2ce080]" /> streaming
                </>
              ) : (
                "non-stream"
              )}
            </Badge>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10">
                <div className="h-16 w-16 rounded-2xl bg-[#2ce080]/10 border border-[#2ce080]/20 flex items-center justify-center">
                  <Bot className="h-8 w-8 text-[#2ce080]" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-base font-semibold">
                    {isMusicModel
                      ? "Generate AI Music"
                      : isSearchModel
                        ? "Search the Web"
                        : "Start a Conversation"}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {isMusicModel
                      ? "Describe the music you want and ACE-Step 1.5 will generate it."
                      : isSearchModel
                        ? "Enter a query to fetch live web results from DuckDuckGo."
                        : "Pick a model above and send a message. Code blocks get saved as files →"}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-3",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {m.role === "assistant" && (
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-[#2ce080]/10 border border-[#2ce080]/20 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-[#2ce080]" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                      m.role === "user"
                        ? "bg-[#2ce080] text-[#042330] rounded-br-sm font-medium"
                        : "bg-card border border-border rounded-bl-sm",
                    )}
                  >
                    {m.role === "user" ? (
                      <div className="whitespace-pre-wrap break-words">
                        {m.content}
                      </div>
                    ) : (
                      <>
                        {m.toolCalls && m.toolCalls.length > 0 && (
                          <ToolCallCard toolCalls={m.toolCalls} />
                        )}
                        {m.audio && m.audio.length > 0 && (
                          <AudioPlayer audios={m.audio} />
                        )}
                        {m.searchResults && m.searchResults.length > 0 && (
                          <SearchResults results={m.searchResults} />
                        )}
                        {m.content ? (
                          <MessageContent content={m.content} />
                        ) : (
                          !m.toolCalls &&
                          !m.audio &&
                          !m.searchResults && <TypingDots />
                        )}
                      </>
                    )}
                  </div>
                  {m.role === "user" && (
                    <div className="h-8 w-8 shrink-0 rounded-lg bg-muted border border-border flex items-center justify-center">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 bg-card/30 shrink-0">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={inputPlaceholder}
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
                  className="h-11 w-11 shrink-0 bg-[#2ce080] hover:bg-[#22b569] text-[#042330]"
                  aria-label="Send"
                  disabled={!input.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between mt-2 px-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="stream-toggle"
                  checked={stream}
                  onCheckedChange={(v) => setStream(v === true)}
                  className="border-border data-[state=checked]:bg-[#2ce080] data-[state=checked]:border-[#2ce080] data-[state=checked]:text-[#042330]"
                />
                <Label
                  htmlFor="stream-toggle"
                  className="text-xs text-muted-foreground cursor-pointer select-none"
                >
                  Stream tokens
                </Label>
              </div>
              <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">
                Enter to send · Shift+Enter for newline
              </span>
            </div>
          </div>
        </main>

        {/* Right sidebar — Files */}
        <aside className="hidden md:flex w-64 shrink-0 border-l border-border bg-card/60 backdrop-blur flex-col">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-[#2ce080]" />
              Files
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Saved from AI responses
            </p>
          </div>
          <ScrollArea className="flex-1 px-2 py-2">
            {files.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <FileCode2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  No files yet. Ask the AI to write code!
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="group relative rounded-lg border border-transparent hover:border-border hover:bg-accent px-2.5 py-2 cursor-pointer transition-colors"
                    onClick={() => setSelectedFile(f)}
                  >
                    <div className="flex items-center gap-2">
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#2ce080]" />
                      <span className="text-xs font-medium truncate flex-1">
                        {f.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 pl-[14px]">
                      <span className="text-[10px] text-muted-foreground/70">
                        {f.language}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">
                        · {formatTimestamp(f.createdAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFile(f.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1.5 right-1.5 p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
                      aria-label="Delete file"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>
      </div>

      {/* ─── File Viewer Modal ─── */}
      <Dialog
        open={!!selectedFile}
        onOpenChange={(open) => !open && setSelectedFile(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm font-mono">
              <FileCode2 className="h-4 w-4 text-[#2ce080]" />
              {selectedFile?.name}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {selectedFile?.language} ·{" "}
              {selectedFile && formatTimestamp(selectedFile.createdAt)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 bg-zinc-950">
            <pre className="text-[12.5px] leading-relaxed text-zinc-200 font-mono whitespace-pre-wrap break-words">
              <code>{selectedFile?.content}</code>
            </pre>
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!selectedFile) return;
                try {
                  await navigator.clipboard.writeText(selectedFile.content);
                  toast.success("Copied to clipboard");
                } catch {
                  toast.error("Copy failed");
                }
              }}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!selectedFile) return;
                const blob = new Blob([selectedFile.content], {
                  type: "text/plain",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = selectedFile.name;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
