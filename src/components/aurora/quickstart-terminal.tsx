"use client";

/**
 * QuickstartTerminal — the FreeAIXYZ hero terminal: traffic dots,
 * cURL / Python / Node.js tabs, crimson + ember syntax tints, and a copy
 * button. A pure client island on the otherwise-static homepage. Uses the
 * default Onyx fleet id (onyx-core-v1) in every example.
 */

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const ENDPOINT = "https://freeaixyz4all.vercel.app/api/v1/chat/completions";
const BASE_URL = "https://freeaixyz4all.vercel.app/api/v1";
const DEMO_MODEL = "onyx-core-v1";

type Lang = "curl" | "python" | "node";

const TABS: Array<{ id: Lang; label: string }> = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node.js" },
];

/** Token tint helpers (kit palette: crimson keywords, blush strings, ember consts). */
const K = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[#ff2a55] font-bold">{children}</span>
);
const S = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[#ffb68a]">{children}</span>
);
const E = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[#ff850d] font-bold">{children}</span>
);

const PLAIN: Record<Lang, string> = {
  curl: `curl -N ${ENDPOINT} \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${DEMO_MODEL}",
    "messages": [{"role": "user", "content": "Hello FreeAIXYZ"}],
    "stream": true
  }'`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${BASE_URL}", api_key="not-needed")

stream = client.chat.completions.create(
    model="${DEMO_MODEL}",
    messages=[{"role": "user", "content": "Hello FreeAIXYZ"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
  node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: "not-needed",
});

const stream = await client.chat.completions.create({
  model: "${DEMO_MODEL}",
  messages: [{ role: "user", content: "Hello FreeAIXYZ" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
};

export function QuickstartTerminal() {
  const [lang, setLang] = React.useState<Lang>("curl");
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PLAIN[lang]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [lang]);

  return (
    <div className="fxz-cmdbar overflow-hidden" aria-label="Quickstart code terminal">
      {/* Header: traffic dots + terminal label + lang tabs */}
      <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-2 border-b border-hd-highest/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-3 w-3 rounded-full bg-crimson inline-block shadow-[0_0_8px_rgba(255,42,85,0.7)]" />
          <span className="h-3 w-3 rounded-full bg-ember inline-block shadow-[0_0_8px_rgba(255,133,13,0.7)]" />
          <span className="h-3 w-3 rounded-full bg-gold inline-block" />
          <span className="ml-2 text-[11px] text-muted-foreground truncate font-mono">
            terminal@freeaixyz: ~
          </span>
        </div>
        <div
          className="flex items-center gap-0.5 bg-hd-low/80 p-0.5 rounded-lg border border-hd-line/40"
          role="tablist"
          aria-label="Code language"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={lang === tab.id}
              onClick={() => setLang(tab.id)}
              className={cn(
                "px-2.5 py-1 rounded font-mono text-[11px] transition-all",
                lang === tab.id
                  ? "bg-crimson text-white font-semibold shadow-[0_0_10px_rgba(255,42,85,0.45)]"
                  : "text-muted-foreground hover:text-white",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Code body */}
      <div className="relative font-mono text-[12.5px] leading-relaxed overflow-x-auto custom-scroll min-h-[218px]">
        <pre className="p-4 whitespace-pre-wrap text-foreground">
          {lang === "curl" && (
            <code>
              <E>curl</E> -N {ENDPOINT} {"\\"}
              {"\n"}  -H <S>&quot;Content-Type: application/json&quot;</S> {"\\"}
              {"\n"}  -d <span className="text-crimson">&apos;{"{"}</span>
              {"\n"}    <S>&quot;model&quot;</S>: <S>&quot;{DEMO_MODEL}&quot;</S>,
              {"\n"}    <S>&quot;messages&quot;</S>: [{"{"}<S>&quot;role&quot;</S>: <S>&quot;user&quot;</S>, <S>&quot;content&quot;</S>: <S>&quot;Hello FreeAIXYZ&quot;</S>{"}"}],
              {"\n"}    <S>&quot;stream&quot;</S>: <K>true</K>
              {"\n"}  <span className="text-crimson">{"}"}&apos;</span>
            </code>
          )}
          {lang === "python" && (
            <code>
              <K>from</K> openai <K>import</K> OpenAI{"\n\n"}
              client = OpenAI(base_url=<S>&quot;{BASE_URL}&quot;</S>, api_key=<S>&quot;not-needed&quot;</S>){"\n\n"}
              stream = client.chat.completions.create({"\n"}
              {"    "}model=<S>&quot;{DEMO_MODEL}&quot;</S>,{"\n"}
              {"    "}messages=[{"{"}<S>&quot;role&quot;</S>: <S>&quot;user&quot;</S>, <S>&quot;content&quot;</S>: <S>&quot;Hello FreeAIXYZ&quot;</S>{"}"}],{"\n"}
              {"    "}stream=<K>True</K>,{"\n"}
              ){"\n"}
              <K>for</K> chunk <K>in</K> stream:{"\n"}
              {"    "}<E>print</E>(chunk.choices[0].delta.content <K>or</K> <S>&quot;&quot;</S>, end=<S>&quot;&quot;</S>, flush=<K>True</K>)
            </code>
          )}
          {lang === "node" && (
            <code>
              <K>import</K> OpenAI <K>from</K> <S>&quot;openai&quot;</S>;{"\n\n"}
              <K>const</K> client = <K>new</K> OpenAI({"{"}{"\n"}
              {"  "}baseURL: <S>&quot;{BASE_URL}&quot;</S>,{"\n"}
              {"  "}apiKey: <S>&quot;not-needed&quot;</S>,{"\n"}
              {"}"});{"\n\n"}
              <K>const</K> stream = <K>await</K> client.chat.completions.create({"{"}{"\n"}
              {"  "}model: <S>&quot;{DEMO_MODEL}&quot;</S>,{"\n"}
              {"  "}messages: [{"{"} role: <S>&quot;user&quot;</S>, content: <S>&quot;Hello FreeAIXYZ&quot;</S> {"}"}],{"\n"}
              {"  "}stream: <K>true</K>,{"\n"}
              {"}"});{"\n"}
              <K>for await</K> (<K>const</K> chunk <K>of</K> stream) {"{"}{"\n"}
              {"  "}process.stdout.<E>write</E>(chunk.choices[0]?.delta?.content ?? <S>&quot;&quot;</S>);{"\n"}
              {"}"}
            </code>
          )}
        </pre>
      </div>

      {/* Footer actions */}
      <div className="mt-1 px-4 py-2.5 flex items-center justify-between border-t border-hd-highest/60">
        <span
          className={cn(
            "font-mono text-[11px] text-ember flex items-center gap-1 transition-opacity",
            copied ? "opacity-100" : "opacity-0",
          )}
          aria-live="polite"
        >
          <Check className="h-3.5 w-3.5" /> Copied payload to clipboard
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-hd-high hover:bg-hd-highest text-blush hover:text-white font-mono text-[12px] transition-colors border border-crimson/20"
          aria-label={`Copy ${lang} snippet`}
        >
          <Copy className="h-3.5 w-3.5 text-ember" />
          Copy
        </button>
      </div>
    </div>
  );
}
