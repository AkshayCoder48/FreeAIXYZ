/**
 * DOC CONTENT — the FreeAIXYZ documentation tree.
 *
 * This is the single source of truth for the /docs section: a typed, static
 * (build-time) content model rendered by the DocsBrowser client component.
 *
 * The docs are intentionally LARGE — 21 pages across 5 groups covering the
 * full surface of the gateway: onboarding, streaming, the tool-calling
 * pipeline, every API endpoint, every built-in tool, the provider catalog,
 * the error taxonomy, examples in multiple languages, FAQ, glossary and the
 * changelog.
 *
 * Block kinds:
 *   p        — paragraph (supports **bold**, `code`, [text](href))
 *   h3       — sub-heading within a page
 *   list     — bullet / ordered list
 *   code     — code block (mono, dark glass, warm header row)
 *   table    — reference table (warm hairlines)
 *   callout  — info / warn / tip callout
 *   kbd      — keyboard shortcut row
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type DocCalloutTone = "info" | "warn" | "tip";

export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "code"; title?: string; lang?: string; code: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "callout"; tone: DocCalloutTone; title?: string; text: string }
  | { kind: "kbd"; items: { keys: string; label: string }[] };

export interface DocPage {
  /** Slug — also the DOM anchor (`#doc-<id>`). */
  id: string;
  title: string;
  /** One-line summary shown under the page heading. */
  description: string;
  /** Sidebar group id (see DOC_GROUPS). */
  group: string;
  /** Extra search keywords for the sidebar filter. */
  keywords?: string[];
  blocks: DocBlock[];
}

export interface DocGroup {
  id: string;
  label: string;
}

export const DOC_GROUPS: DocGroup[] = [
  { id: "getting-started", label: "Getting started" },
  { id: "guides", label: "Guides" },
  { id: "api", label: "API reference" },
  { id: "tools", label: "Built-in tools" },
  { id: "resources", label: "Resources" },
];

// ─── Pages ───────────────────────────────────────────────────────────────────

export const DOC_PAGES: DocPage[] = [

  // ═════════════════════════════ GETTING STARTED ═══════════════════════════

  {
    id: "introduction",
    title: "Introduction",
    description:
      "What FreeAIXYZ is, what it deliberately is not, and how the pieces fit together.",
    group: "getting-started",
    keywords: ["about", "overview", "what", "architecture", "gateway"],
    blocks: [
      {
        kind: "p",
        text: "FreeAIXYZ is a **free AI gateway**: one OpenAI-compatible API in front of a curated set of native free providers. You send standard `chat/completions` requests — with or without `stream`, with or without `tools` — and the gateway routes them to a live provider, forwards every parameter faithfully, and streams back the response.",
      },
      {
        kind: "p",
        text: "There is nothing to sign up for. No account, no API key, no credit card, no rate-limit token. The gateway aggregates free upstreams behind one surface and exposes a single stable URL.",
      },
      {
        kind: "h3",
        text: "The three surfaces",
      },
      {
        kind: "list",
        items: [
          "**The API** — `POST /api/v1/chat/completions`, plus `/api/v1/models`, health and debug endpoints. Point any OpenAI SDK at the base URL.",
          "**The Playground** — a full chat surface with real token-by-token SSE streaming and built-in tool toggles, at [/chat](/chat).",
          "**The catalog** — every model, every provider, capability badges and canonical IDs, at [/models](/models).",
        ],
      },
      {
        kind: "h3",
        text: "Architecture at a glance",
      },
      {
        kind: "code",
        title: "request pipeline",
        lang: "text",
        code: `client
  │  POST /api/v1/chat/completions   { model, messages, stream, tools }
  ▼
gateway  ── schema validation (tools / tool_choice / parallel_tool_calls)
  │  ── capability gate (model supports tools? streaming?)
  │  ── request builder → provider payload (params PRESERVED)
  ▼
provider adapter  ── assertToolsForwarded (nothing dropped)
  │
  ▼
upstream provider  (17 native providers, 75 models)
  │
  ▼
streaming parser  ── delta.content / delta.reasoning / delta.tool_calls
  │
  ▼
tool detector  ── finish_reason:"tool_calls" → executor → follow-up
  │
  ▼
client  ◀─ SSE chunks + data: [DONE]`,
      },
      {
        kind: "callout",
        tone: "info",
        title: "Design principle",
        text: "The gateway never invents behavior. What you send is what the provider receives; what the provider streams is what you receive. No re-pacing, no buffering, no silent parameter dropping.",
      },
      {
        kind: "h3",
        text: "Quick facts",
      },
      {
        kind: "table",
        head: ["Property", "Value"],
        rows: [
          ["Base URL", "https://freeaixyz4all.vercel.app"],
          ["Chat endpoint", "POST /api/v1/chat/completions"],
          ["Models endpoint", "GET /api/v1/models"],
          ["Auth", "none — no key, no account"],
          ["Models offered", "75 native models"],
          ["Providers", "17 native adapters"],
          ["Streaming", "true end-to-end SSE"],
          ["Tool calling", "full pipeline, streamed + parallel"],
          ["Pricing", "free, no quota system"],
        ],
      },
    ],
  },

  {
    id: "quickstart",
    title: "Quickstart",
    description:
      "Your first streaming request in under a minute — plus your first tool call.",
    group: "getting-started",
    keywords: ["start", "first", "request", "curl", "hello", "sample"],
    blocks: [
      {
        kind: "p",
        text: "The fastest path is curl. This request streams a completion token-by-token with Server-Sent Events:",
      },
      {
        kind: "code",
        title: "bash",
        lang: "bash",
        code: `curl -N https://freeaixyz4all.vercel.app/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "tb/gpt-5",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "stream": true
  }'`,
      },
      {
        kind: "p",
        text: "You will see `data: {…}` chunks arrive as the model generates, ending with the `data: [DONE]` sentinel. Remove `\"stream\": true` for a single JSON response.",
      },
      {
        kind: "h3",
        text: "Your first tool call",
      },
      {
        kind: "p",
        text: "Attach a tool definition and the model will call it instead of guessing. The gateway forwards `tools`, `tool_choice` and `parallel_tool_calls` upstream, accumulates streamed tool-call deltas, executes the calls, and sends the results back to the model in an automatic follow-up round:",
      },
      {
        kind: "code",
        title: "bash — with a calculator tool",
        lang: "bash",
        code: `curl -N https://freeaixyz4all.vercel.app/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "oc/gpt-5.6",
    "messages": [{"role": "user", "content": "What is 12345 times 6789?"}],
    "stream": true,
    "tools": [{
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Evaluate a math expression exactly.",
        "parameters": {
          "type": "object",
          "properties": {
            "expression": {"type": "string"}
          },
          "required": ["expression"]
        }
      }
    }],
    "tool_choice": "auto",
    "parallel_tool_calls": true
  }'`,
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Expected result",
        text: "The model streams a tool call for calculator({\"expression\":\"12345 * 6789\"}), the pipeline executes it, and the final answer streams back: 83,810,205 — the model no longer claims it has no tools.",
      },
      {
        kind: "h3",
        text: "Prefer a UI?",
      },
      {
        kind: "p",
        text: "Open the [Playground](/chat) — pick any tools-capable model, toggle **Calculator** or **Web search**, and watch the tool chips fire live. Then browse [/models](/models) to pick your model by capability.",
      },
      {
        kind: "h3",
        text: "Point an OpenAI SDK at the gateway",
      },
      {
        kind: "code",
        title: "python",
        lang: "python",
        code: `from openai import OpenAI

client = OpenAI(
    base_url="https://freeaixyz4all.vercel.app/api/v1",
    api_key="not-needed",  # any non-empty string
)

stream = client.chat.completions.create(
    model="tb/gpt-5",
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta
    if delta.content:
        print(delta.content, end="", flush=True)`,
      },
    ],
  },

  {
    id: "authentication",
    title: "Authentication",
    description:
      "There is none — and that is a feature. What we ask instead: fair use.",
    group: "getting-started",
    keywords: ["auth", "key", "token", "api key", "headers"],
    blocks: [
      {
        kind: "p",
        text: "FreeAIXYZ has **no authentication**. No API keys are issued, checked or stored. There are no accounts, no sessions, no BYOK vault, no token metering. Every endpoint is open.",
      },
      {
        kind: "p",
        text: "You do not need to send any headers beyond `Content-Type: application/json`. If your client insists on an API key (OpenAI SDKs do), pass any non-empty placeholder string — the gateway ignores it.",
      },
      {
        kind: "code",
        title: "any OpenAI client",
        lang: "javascript",
        code: `const client = new OpenAI({
  baseURL: "https://freeaixyz4all.vercel.app/api/v1",
  apiKey: "not-needed", // placeholder — ignored by the gateway
});`,
      },
      {
        kind: "h3",
        text: "Fair use",
      },
      {
        kind: "list",
        items: [
          "The gateway sits on free upstreams — they have their own capacity and moods. If a provider rate-limits, the gateway surfaces `RATE_LIMITED` rather than hiding it.",
          "Do not hammer one model in a tight loop; the upstreams throttle aggressively and your requests will start failing.",
          "No credential harvesting, no bulk scraping, no resale of upstream capacity.",
          "Everything you send is processed to fulfill the request only — the gateway is stateless and stores nothing.",
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Privacy expectation",
        text: "Requests pass through the gateway and the upstream provider. Do not send secrets, credentials or private data you would not hand to a third party. There is no zero-retention guarantee on the upstream side.",
      },
      {
        kind: "h3",
        text: "CORS",
      },
      {
        kind: "p",
        text: "The API is browser-callable: cross-origin requests are accepted from any origin. You can build a client-side app directly against the base URL without a proxy of your own.",
      },
    ],
  },

  {
    id: "playground",
    title: "Playground tour",
    description:
      "Every control on the /chat surface — model picker, tool toggles, reasoning fold, phases.",
    group: "getting-started",
    keywords: ["chat", "ui", "tour", "tools toggle", "stop", "retry"],
    blocks: [
      {
        kind: "p",
        text: "The [Playground](/chat) is the interactive surface for the whole pipeline: model selection, SSE streaming, tool calling and diagnostics. This page walks through every control.",
      },
      {
        kind: "h3",
        text: "Model picker",
      },
      {
        kind: "p",
        text: "The left panel lists every offered model grouped by provider. The right panel shows the selected model's capability badges (streaming, reasoning, vision, tools, web search), its canonical id, context window and — while generating — a live token counter.",
      },
      {
        kind: "h3",
        text: "Tool toggles",
      },
      {
        kind: "p",
        text: "For tools-capable models, a row of warm pills lets you enable the built-in tools — **Calculator**, **Web search**, **Current time**. Enabled definitions are sent with every request (`tools` + `tool_choice: \"auto\"` + `parallel_tool_calls: true`). The model calls them only when it decides to. For models without tool support, the row explains that instead of pretending.",
      },
      {
        kind: "h3",
        text: "Generation phases",
      },
      {
        kind: "table",
        head: ["Phase", "Meaning"],
        rows: [
          ["Idle", "Nothing in flight — Send enabled"],
          ["Preparing / Routing", "Request validated and adapter resolved"],
          ["Generating", "Tokens streaming in (coral pulsing dot)"],
          ["Completed", "Final token received, usage captured"],
          ["Cancelled", "You pressed Stop — partial output kept"],
          ["Error", "Structured failure — inline banner + Retry"],
        ],
      },
      {
        kind: "h3",
        text: "Tool activity chips",
      },
      {
        kind: "p",
        text: "While the model uses tools, compact chips appear above the reply: a spinner while running, then the tool name and duration on success, or `failed` with the reason on error. Multiple tools run in parallel — the gateway preserves each `tool_call_id` when appending results.",
      },
      {
        kind: "h3",
        text: "Reasoning fold",
      },
      {
        kind: "p",
        text: "Models that expose chain-of-thought stream `reasoning` deltas. These accumulate under a collapsible **Thinking** fold attached to the same message — the final answer always streams into one single assistant bubble.",
      },
      {
        kind: "h3",
        text: "Stop, retry, clear",
      },
      {
        kind: "kbd",
        items: [
          { keys: "Enter", label: "Send the composer message" },
          { keys: "Shift+Enter", label: "New line inside the composer" },
          { keys: "Esc", label: "Dismiss the mobile nav drawer" },
        ],
      },
      {
        kind: "p",
        text: "Stop aborts the in-flight request immediately (the partial answer is kept and marked `stopped`). Retry re-sends the last user message after a failure. Clear wipes the conversation. A generation can never get stuck in *Generating* — the request is finalized in every terminal state.",
      },
      {
        kind: "callout",
        tone: "tip",
        title: "System prompt",
        text: "The collapsible System prompt field is applied to every request as a top-level system message — useful for steering tone or format.",
      },
    ],
  },

  // ═════════════════════════════════ GUIDES ═════════════════════════════════

  {
    id: "streaming",
    title: "Streaming",
    description:
      "The SSE wire format: chunk anatomy, [DONE], reasoning deltas and how to parse correctly.",
    group: "guides",
    keywords: ["sse", "stream", "chunks", "delta", "done", "parser"],
    blocks: [
      {
        kind: "p",
        text: "Set `\"stream\": true` and the response becomes a `text/event-stream`. The gateway streams **real upstream deltas** — no gateway re-pacing, no buffering. Chunks arrive in the OpenAI SSE shape:",
      },
      {
        kind: "code",
        title: "wire format",
        lang: "text",
        code: `data: {"id":"chatcmpl-…","object":"chat.completion.chunk",
       "model":"oc/gpt-5.6",
       "choices":[{"index":0,
         "delta":{"role":"assistant"},
         "finish_reason":null}]}

data: {"choices":[{"index":0,
         "delta":{"content":"Hel"},
         "finish_reason":null}]}

data: {"choices":[{"index":0,
         "delta":{"content":"lo"},
         "finish_reason":null}]}

data: {"choices":[{"index":0,
         "delta":{},
         "finish_reason":"stop"}]}

data: [DONE]`,
      },
      {
        kind: "h3",
        text: "Chunk anatomy",
      },
      {
        kind: "table",
        head: ["Field", "Meaning"],
        rows: [
          ["choices[0].delta.content", "A text fragment — append to your buffer"],
          ["choices[0].delta.reasoning", "Chain-of-thought fragment (reasoning models)"],
          ["choices[0].delta.tool_calls", "Tool-call delta — id/name, then argument fragments"],
          ["choices[0].finish_reason", "null while streaming; \"stop\", \"tool_calls\", or an error code at the end"],
          ["data: [DONE]", "Terminal sentinel — finalize your message here"],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Parse [DONE], don't wait for EOF",
        text: "The terminal `data: [DONE]` line is the contract for finalization. Some HTTP stacks hold the body open after the sentinel (browser gzip in dev). Parse the sentinel as the end of stream — do not rely on end-of-body.",
      },
      {
        kind: "h3",
        text: "A correct client parser",
      },
      {
        kind: "p",
        text: "One network chunk can contain zero, one or many events; one event can span many chunks. Use a persistent buffer and a single streaming `TextDecoder`:",
      },
      {
        kind: "code",
        title: "typescript — persistent-buffer SSE reader",
        lang: "typescript",
        code: `async function readSseStream(res: Response, onDelta: (text: string) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();          // stream: true by default
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split COMPLETE events only — keep the partial tail in the buffer.
    const events = buffer.split("\\n\\n");
    buffer = events.pop() ?? "";

    for (const evt of events) {
      for (const line of evt.split("\\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;      // terminal sentinel
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      }
    }
  }
}`,
      },
      {
        kind: "h3",
        text: "Non-streaming",
      },
      {
        kind: "p",
        text: "With `stream` omitted or `false`, the response is a single JSON `chat.completion` object — the same shape the OpenAI API returns. Tool calls, when they occur, arrive in `choices[0].message.tool_calls` in one piece.",
      },
    ],
  },

  {
    id: "tool-calling",
    title: "Tool calling",
    description:
      "The complete pipeline: forwarding, streamed accumulation, execution, follow-up rounds.",
    group: "guides",
    keywords: ["tools", "function calling", "tool_choice", "parallel", "rounds"],
    blocks: [
      {
        kind: "p",
        text: "Tool calling is a **first-class pipeline**, not a prompt suggestion. The guarantee: if you send `tools`, the provider receives `tools`; if the model decides to call one, the call executes and the model receives the result — then continues generating with the same tools available.",
      },
      {
        kind: "h3",
        text: "The request",
      },
      {
        kind: "table",
        head: ["Parameter", "Type", "Behavior"],
        rows: [
          ["tools", "OAITool[]", "Validated then forwarded 1:1 — assertToolsForwarded fails loudly if any definition is dropped"],
          ["tool_choice", "string or object", "\"auto\" | \"none\" | {type:\"function\",function:{name}} — object form is preserved"],
          ["parallel_tool_calls", "boolean", "Forwarded as-is (the playground sends true)"],
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Capability gate",
        text: "Sending tools for a model whose capabilities.tools is false returns 400 TOOL_UNSUPPORTED — before any upstream call. The toggle never appears for such models in the Playground.",
      },
      {
        kind: "h3",
        text: "How a tool call streams",
      },
      {
        kind: "p",
        text: "Providers stream tool calls as **fragments**: the first `delta.tool_calls` carries the `id` and `function.name`; subsequent fragments carry pieces of `function.arguments`. Accumulate by `index`, concatenate argument fragments, and parse the JSON only after the round completes:",
      },
      {
        kind: "code",
        title: "fragment accumulation (by index)",
        lang: "typescript",
        code: `// index-keyed map — supports multiple parallel tool calls
const acc = new Map<number, { id: string; name: string; args: string }>();

function onToolCallDelta(frag: {
  index?: number; id?: string;
  function?: { name?: string; arguments?: string };
}) {
  const i = frag.index ?? 0;
  const slot = acc.get(i) ?? { id: "", name: "", args: "" };
  if (frag.id) slot.id = frag.id;              // first-wins
  if (frag.function?.name) slot.name = frag.function.name;
  if (frag.function?.arguments) slot.args += frag.function.arguments; // concat
  acc.set(i, slot);
}

// ONLY after finish_reason === "tool_calls":
const calls = [...acc.values()].map((c) => ({
  id: c.id,
  name: c.name,
  arguments: JSON.parse(c.args || "{}"),   // arguments are a JSON *string*
}));`,
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Never execute from plain text",
        text: "Execution is triggered by `finish_reason: \"tool_calls\"` (or a complete emulated fence on providers without a native tools API) — never by parsing tool-looking text out of the reply.",
      },
      {
        kind: "h3",
        text: "Execution and the follow-up round",
      },
      {
        kind: "p",
        text: "When a round ends with tool calls, the pipeline executes them (in parallel, preserving each `tool_call_id`), appends the OpenAI-shaped history, and re-requests with the **same tools**:",
      },
      {
        kind: "code",
        title: "follow-up history shape",
        lang: "json",
        code: `[
  {"role": "user",      "content": "What is 12345 times 6789?"},
  {"role": "assistant", "content": null,
   "tool_calls": [{
     "id": "call_abc123",
     "type": "function",
     "function": {"name": "calculator", "arguments": "{\\"expression\\":\\"12345 * 6789\\"}"}
   }]},
  {"role": "tool", "tool_call_id": "call_abc123",
   "content": "{\\"ok\\":true,\\"result\\":83810205}"}
]`,
      },
      {
        kind: "h3",
        text: "The loop",
      },
      {
        kind: "list",
        items: [
          "Rounds are capped at **MAX_TOOL_ROUNDS = 10** — a hard stop against infinite tool loops.",
          "Parallel calls execute via `Promise.all`, each result mapped back by `tool_call_id`.",
          "Tool results are clamped to 20,000 characters — oversized results become a structured truncation error the model can reason about.",
          "The final answer continues streaming into the **same assistant message** — one generation is always one bubble.",
        ],
      },
      {
        kind: "h3",
        text: "Emulated tools (non-native providers)",
      },
      {
        kind: "p",
        text: "Providers without an upstream tools API get a fenced-emulation system prompt. The model writes a ` ```tool_call ` JSON fence; the pipeline detects the complete fence after the round, converts it to structured tool calls, and proceeds exactly like the native path. From your side the behavior is identical.",
      },
      {
        kind: "h3",
        text: "Diagnostics",
      },
      {
        kind: "p",
        text: "`GET /api/debug/tools` exposes the last tool-trace ring buffer: tools requested vs forwarded, tool_choice, detected tool_calls, execution results and the final status — names and counts only, never arguments or credentials. See [Observability](#doc-observability).",
      },
    ],
  },

  {
    id: "models",
    title: "Models & IDs",
    description:
      "Canonical IDs, the capability matrix, and how to pick a model programmatically.",
    group: "guides",
    keywords: ["model", "id", "catalog", "capability", "shortid"],
    blocks: [
      {
        kind: "p",
        text: "Every model has one **canonical id** of the form `<providerShortId>/<upstreamId>` — e.g. `oc/gpt-5.6` or `tb/gpt-5`. Cross-provider duplicates stay distinct: the same upstream model behind two providers is two ids with two adapters and two health profiles.",
      },
      {
        kind: "h3",
        text: "Listing models",
      },
      {
        kind: "code",
        title: "bash",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/v1/models | jq '.data[].id' | head

# the full registry (including delisted-but-resolvable entries):
curl -s "https://freeaixyz4all.vercel.app/api/v1/models?all=true" | jq '.data | length'`,
      },
      {
        kind: "h3",
        text: "Capability matrix",
      },
      {
        kind: "table",
        head: ["Capability", "Meaning", "Where it matters"],
        rows: [
          ["streaming", "Token-by-token SSE", "stream: true"],
          ["reasoning", "Exposes chain-of-thought deltas", "reasoning fold in the Playground"],
          ["vision", "Image inputs accepted", "multimodal messages"],
          ["tools", "Native tool calling", "tools parameter — gated"],
          ["webSearch", "Provider-side live search", "web_search: true shortcut"],
          ["multiTurn", "Conversation state kept upstream", "multi-turn chats"],
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Choosing a model",
        text: "The Playground pre-selects a model that is both streaming- and tools-capable. For agents, filter /api/v1/models by the capabilities you need — or browse [/models](/models) with warm capability badges and instant copy of the canonical id.",
      },
      {
        kind: "h3",
        text: "Deep links",
      },
      {
        kind: "list",
        items: [
          "`/models` — full catalog, grouped by provider, live search + provider pills",
          "`/models/<provider>` — one provider's grid",
          "`/models/<provider>/<model>` — capability matrix, context window, upstream id, one-click into the Playground",
          "`/chat?model=<id>` — open the Playground with the model pre-selected",
        ],
      },
    ],
  },

  {
    id: "providers",
    title: "Providers",
    description:
      "The 17 native adapters behind the gateway — what each one is and does.",
    group: "guides",
    keywords: ["provider", "upstream", "adapter", "native"],
    blocks: [
      {
        kind: "p",
        text: "Each provider is a hand-written adapter with its own request shaping, SSE quirks and capability flags. The catalog is **static** — bundled at build time, no dynamic fetching, no stale caches; every id maps to a live adapter.",
      },
      {
        kind: "table",
        head: ["Short id", "Provider", "Notes"],
        rows: [
          ["tb", "Toolbaz", "Large general-purpose free pool (15+)"],
          ["oc", "OpenCode.ai", "DeepSeek/Ling/Nemotron-class, streaming + tools"],
          ["kg", "Kilo Code", "16 free models, real SSE streaming"],
          ["sw", "Swarm", "Community GGUF models (Qwen 3.5/3.6), streaming + tools"],
          ["ua", "UnlimitedAI", "GPT/Gemini/DeepSeek/Claude/Grok-class, web search + vision"],
          ["llm7", "LLM7.io", "Anonymous no-key access, GPT-OSS/Minimax/Codestral"],
          ["go", "GPT-OSS", "120B reasoning + 20B fast, reasoning_content support"],
          ["un", "UncloseAI", "Qwen 3.6 27B (int4) uncensored, token streaming"],
          ["fg", "FreeGPT.tech", "50 models: GPT-5.x, Claude, Grok, Gemini, DeepSeek"],
          ["jg", "JollyGen", "Unrestricted roleplay"],
          ["vx", "Vexa AI", "15+ models via multi-provider routing"],
          ["au", "AuroraAI", "Uncensored LLaMA-3 roleplay, real token streaming"],
          ["sp", "SpicyWriter", "Ling 2.6 Flash / Nemo, anonymous SSE"],
          ["fg2", "Free2GPT", "Signed-request chat API, server-routed"],
          ["fc", "FreeChat", "Single community model via llmproxy"],
          ["mi", "Miklium", "Personality models"],
          ["fx", "FreeAIXYZ Text API", "First-party proxy with tool emulation"],
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Health",
        text: "Providers are free upstreams — availability shifts. The gateway applies per-provider circuit breakers and per-model health tracking, and surfaces `PROVIDER_UNAVAILABLE` / `UPSTREAM_*` errors honestly instead of hanging.",
      },
      {
        kind: "h3",
        text: "Native tool providers",
      },
      {
        kind: "p",
        text: "The providers whose upstreams accept the OpenAI tools API natively (and therefore get real `tools` forwarding): OpenCode, Kilo Code, LLM7, GPT-OSS, Swarm, UncloseAI, FreeGPT and the first-party FX proxy. Every other provider gets the fenced tool-call emulation described in [Tool calling](#doc-tool-calling).",
      },
    ],
  },

  {
    id: "errors",
    title: "Errors",
    description:
      "The structured error envelope, the full code taxonomy, and what is retryable.",
    group: "guides",
    keywords: ["error", "codes", "retry", "taxonomy"],
    blocks: [
      {
        kind: "p",
        text: "Every failure returns a structured JSON envelope — never a bare stack trace, never a silent hang:",
      },
      {
        kind: "code",
        title: "error envelope",
        lang: "json",
        code: `{
  "error": {
    "type": "upstream_error",
    "message": "Upstream unavailable (HTTP 503). Retry later.",
    "provider": "opencode",
    "model": "oc/gpt-5.6",
    "request_id": "req_a1b2c3",
    "code": "PROVIDER_UNAVAILABLE",
    "status": 503
  }
}`,
      },
      {
        kind: "h3",
        text: "Code taxonomy",
      },
      {
        kind: "table",
        head: ["Code", "HTTP", "Meaning", "Retryable?"],
        rows: [
          ["INVALID_REQUEST", "400", "Malformed body (bad JSON, missing model/messages)", "no — fix the request"],
          ["TOOL_SCHEMA_INVALID", "400", "tools / tool_choice / parallel_tool_calls failed schema validation", "no"],
          ["TOOL_UNSUPPORTED", "400", "Model capabilities.tools is false but tools were sent", "no — pick another model"],
          ["TOOL_FORWARDING_ERROR", "500", "assertToolsForwarded failed — a definition was dropped", "no — gateway bug, report it"],
          ["MODEL_NOT_FOUND", "404", "Unknown canonical id (or delisted)", "no"],
          ["PROVIDER_NOT_FOUND", "404", "Provider slug has no adapter", "no"],
          ["AUTHENTICATION_REQUIRED", "401", "Upstream demanded auth (upstream regression)", "maybe later"],
          ["RATE_LIMITED", "429", "Upstream throttled this provider", "yes — back off and retry"],
          ["UPSTREAM_4XX", "4xx", "Upstream 4xx passed through with its status", "depends"],
          ["UPSTREAM_TIMEOUT", "504", "Upstream timed out", "yes"],
          ["UPSTREAM_UNAVAILABLE", "503", "Upstream 5xx / connection failure", "yes"],
          ["PROVIDER_UNAVAILABLE", "503", "Circuit breaker open for this provider", "yes — try later or another model"],
          ["EMPTY_UPSTREAM_RESPONSE", "502", "Upstream returned a blank body", "yes"],
          ["STREAM_ERROR", "500", "Stream failed mid-flight (surfaced inline in the Playground)", "yes"],
          ["STREAM_ABORTED", "—", "Client aborted (Stop) — terminal, not a failure", "no"],
        ],
      },
      {
        kind: "callout",
        tone: "warn",
        title: "In streams",
        text: "Mid-stream failures arrive as SSE error frames (`event: error` or a chunk whose `finish_reason` is an error code) after 200 OK has already been sent — handle both transports in your client.",
      },
      {
        kind: "h3",
        text: "Retry strategy",
      },
      {
        kind: "list",
        items: [
          "Retry `RATE_LIMITED` with exponential backoff — start around 2 seconds.",
          "For `PROVIDER_UNAVAILABLE`, the fastest fix is a different model (the catalog marks capability-equivalent alternatives).",
          "Never retry `TOOL_SCHEMA_INVALID` or `INVALID_REQUEST` with the same body — it will fail identically.",
        ],
      },
    ],
  },

  {
    id: "self-hosting",
    title: "Self-hosting",
    description:
      "Run the gateway yourself — it is a plain Next.js app with zero required env vars.",
    group: "guides",
    keywords: ["deploy", "vercel", "self-host", "clone", "docker"],
    blocks: [
      {
        kind: "p",
        text: "The gateway is a standard Next.js (App Router) application. Clone it, install, run — there are **no required environment variables** for the core API:",
      },
      {
        kind: "code",
        title: "bash",
        lang: "bash",
        code: `git clone https://github.com/AkshayCoder48/FreeAIXYZ.git
cd FreeAIXYZ
bun install
bun run dev        # http://localhost:3000

# production
bun run build && bun run start`,
      },
      {
        kind: "h3",
        text: "Optional environment variables",
      },
      {
        kind: "table",
        head: ["Variable", "Effect"],
        rows: [
          ["ZAI_BASE_URL", "Enables the rich web_search backend for the built-in web_search tool"],
          ["ZAI_API_KEY", "Credentials for the above"],
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "web_search fallback chain",
        text: "Without ZAI vars (or where the primary backend is unreachable, e.g. serverless networks) the tool falls back: ZAI → DDG-lite → Wikipedia MediaWiki. Every result carries an honest `provider` field; total failure returns a structured error to the model.",
      },
      {
        kind: "h3",
        text: "Deploy to Vercel",
      },
      {
        kind: "p",
        text: "The repo deploys zero-config: `vercel --prod`. The app is stateless — no database, no cron, no queue — so any Node host works. Set the optional ZAI vars as Secrets if you want the richer search backend.",
      },
      {
        kind: "code",
        title: "bash",
        lang: "bash",
        code: `npm i -g vercel
vercel link
vercel --prod`,
      },
      {
        kind: "h3",
        text: "Where things live",
      },
      {
        kind: "table",
        head: ["Path", "Contents"],
        rows: [
          ["src/app/api/v1/chat/completions", "The chat endpoint: validation, capability gate, routing, SSE"],
          ["src/lib/tools/", "Tool definitions, validation, executors, diagnostics"],
          ["src/lib/native-catalog.ts", "The static model registry (the source of truth)"],
          ["src/lib/gateway/", "Adapters, error taxonomy, ids, streaming helpers"],
          ["src/components/", "The warm-aurora UI (landing, playground, models, docs)"],
        ],
      },
    ],
  },

  // ═════════════════════════════ API REFERENCE ══════════════════════════════

  {
    id: "chat-completions",
    title: "POST /chat/completions",
    description:
      "The full parameter surface of the chat endpoint — streaming and tools included.",
    group: "api",
    keywords: ["completions", "endpoint", "params", "request", "response"],
    blocks: [
      {
        kind: "p",
        text: "The single inference endpoint. OpenAI-compatible in shape and behavior.",
      },
      {
        kind: "code",
        title: "endpoint",
        lang: "text",
        code: `POST /api/v1/chat/completions
Content-Type: application/json`,
      },
      {
        kind: "h3",
        text: "Parameters",
      },
      {
        kind: "table",
        head: ["Parameter", "Type", "Default", "Description"],
        rows: [
          ["model", "string", "— (required)", "Canonical id, e.g. `oc/gpt-5.6`. Unknown ids → 404 MODEL_NOT_FOUND"],
          ["messages", "array", "— (required)", "OpenAI-shaped: system / user / assistant / tool roles"],
          ["stream", "boolean", "false", "true → SSE chunks + `[DONE]`"],
          ["tools", "array", "—", "OpenAI function-tool definitions. Validated, then forwarded 1:1"],
          ["tool_choice", "string | object", "\"auto\" when tools present", "\"auto\", \"none\", or {type:\"function\",function:{name}}"],
          ["parallel_tool_calls", "boolean", "—", "Forwarded as-is"],
          ["web_search", "boolean", "false", "Shortcut: request the provider-side live web search capability"],
          ["temperature", "number 0–2", "—", "Forwarded when supported upstream"],
          ["max_tokens", "integer > 0", "—", "Also accepts max_completion_tokens"],
          ["top_p", "number", "—", "Forwarded when supported"],
          ["stop", "string | string[]", "—", "Stop sequences"],
          ["seed", "integer", "—", "Forwarded when supported"],
          ["presence_penalty", "number", "—", "Forwarded when supported"],
          ["frequency_penalty", "number", "—", "Forwarded when supported"],
          ["n", "integer", "—", "Forwarded when supported"],
        ],
      },
      {
        kind: "h3",
        text: "Response — non-streaming",
      },
      {
        kind: "code",
        title: "200 application/json",
        lang: "json",
        code: `{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "model": "oc/gpt-5.6",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "The result of 12345 times 6789 is 83,810,205.",
      "tool_calls": null
    },
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 42, "completion_tokens": 12, "total_tokens": 54}
}`,
      },
      {
        kind: "h3",
        text: "Response — streaming",
      },
      {
        kind: "p",
        text: "`text/event-stream` of `data: {chunk}` frames as documented in [Streaming](#doc-streaming). Reasoning models add `delta.reasoning`; tool rounds add `delta.tool_calls` fragments and `finish_reason: \"tool_calls\"`.",
      },
      {
        kind: "h3",
        text: "Examples",
      },
      {
        kind: "code",
        title: "curl — minimal",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"tb/gpt-5",
       "messages":[{"role":"user","content":"Hi"}]}'`,
      },
      {
        kind: "code",
        title: "javascript — streaming + tools",
        lang: "javascript",
        code: `const res = await fetch("/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "oc/gpt-5.6",
    messages: [{ role: "user", content: "What is 12345 * 6789?" }],
    stream: true,
    tools: [{
      type: "function",
      function: {
        name: "calculator",
        description: "Evaluate a math expression exactly.",
        parameters: {
          type: "object",
          properties: { expression: { type: "string" } },
          required: ["expression"],
        },
      },
    }],
    tool_choice: "auto",
    parallel_tool_calls: true,
  }),
};
// then parse the SSE stream (see the Streaming guide)`,
      },
    ],
  },

  {
    id: "models-endpoint",
    title: "GET /models",
    description: "The model catalog endpoint — offered vs all, and the entry shape.",
    group: "api",
    keywords: ["models", "list", "catalog", "endpoint"],
    blocks: [
      {
        kind: "p",
        text: "Returns the static registry. No auth, no pagination — the whole catalog in one call.",
      },
      {
        kind: "code",
        title: "bash",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/v1/models

# include delisted-but-resolvable entries:
curl -s "https://freeaixyz4all.vercel.app/api/v1/models?all=true"`,
      },
      {
        kind: "h3",
        text: "Response shape",
      },
      {
        kind: "code",
        title: "200 application/json",
        lang: "json",
        code: `{
  "object": "list",
  "data": [
    {
      "id": "tb/gpt-5",
      "object": "model",
      "created": 1788250097,
      "owned_by": "Toolbaz"
    }
  ]
}`,
      },
      {
        kind: "table",
        head: ["Query", "Effect"],
        rows: [
          ["(none)", "The 75 offered models — the recommended set"],
          ["?all=true", "The full registry (94 entries) including delisted ids that still resolve"],
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "OpenAI SDK compatible",
        text: "`client.models.list()` works out of the box against the base URL — model-picker UIs built for OpenAI work unmodified.",
      },
    ],
  },

  {
    id: "tools-execute",
    title: "POST /tools/execute",
    description:
      "Execute a built-in tool directly — the same executor the pipeline uses.",
    group: "api",
    keywords: ["execute", "tool", "endpoint", "calculator", "search"],
    blocks: [
      {
        kind: "p",
        text: "Runs one built-in tool server-side. This is exactly what the tool-calling pipeline invokes between rounds — exposed so you can test tools in isolation or drive them from your own agent loop.",
      },
      {
        kind: "code",
        title: "endpoint",
        lang: "text",
        code: `POST /api/tools/execute
Content-Type: application/json

{
  "name": "calculator",
  "arguments": { "expression": "12345 * 6789" }
}`,
      },
      {
        kind: "h3",
        text: "Response",
      },
      {
        kind: "code",
        title: "200 application/json",
        lang: "json",
        code: `{
  "ok": true,
  "result": 83810205,
  "tool": "calculator",
  "ms": 1
}`,
      },
      {
        kind: "callout",
        tone: "warn",
        title: "Failure semantics",
        text: "An unknown tool name returns **400**. A known tool that fails at runtime still returns **200** with `{ok: false, error: …}` — the model always receives a structured result instead of a dead round.",
      },
      {
        kind: "h3",
        text: "Built-in names",
      },
      {
        kind: "table",
        head: ["name", "arguments"],
        rows: [
          ["calculator", "{ expression: string }"],
          ["web_search", "{ query: string, num?: 1–8, recency_days?: number }"],
          ["get_current_time", "{ }"],
        ],
      },
      {
        kind: "code",
        title: "bash — web_search",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/tools/execute \\
  -H "Content-Type: application/json" \\
  -d '{"name":"web_search","arguments":{"query":"latest next.js release","num":5}}'`,
      },
      {
        kind: "p",
        text: "Results larger than 20,000 characters are truncated with a structured notice — the same clamp the pipeline applies before returning results to the model.",
      },
    ],
  },

  {
    id: "observability",
    title: "Observability",
    description:
      "Health, readiness, metrics, and the tool-debug trace endpoints.",
    group: "api",
    keywords: ["health", "ready", "metrics", "debug", "status", "traces"],
    blocks: [
      {
        kind: "p",
        text: "The gateway is observable without credentials. All endpoints are GET, no auth:",
      },
      {
        kind: "table",
        head: ["Endpoint", "Purpose"],
        rows: [
          ["GET /health", "Liveness + per-provider snapshot (uptime, breaker state)"],
          ["GET /ready", "Readiness probe — 200 when the catalog is seeded"],
          ["GET /api/metrics", "Counters and latencies for requests, streams, errors"],
          ["GET /api/debug/tools", "Tool-trace ring buffer: the last N tool lifecycles"],
          ["GET /api/debug/provider?id=…", "Deep dive on one provider (models, health)"],
          ["GET /api/debug/stream", "Stream-parser diagnostics for the last request"],
        ],
      },
      {
        kind: "h3",
        text: "Tool traces",
      },
      {
        kind: "p",
        text: "`/api/debug/tools` is the diagnostic surface for the tool pipeline. Each trace records the full lifecycle — **names and counts only**, never arguments or credentials:",
      },
      {
        kind: "code",
        title: "example trace (abridged)",
        lang: "json",
        code: `{
  "registry": ["calculator", "web_search", "get_current_time"],
  "traces": [{
    "model": "oc/gpt-5.6",
    "provider": "opencode",
    "streaming": true,
    "toolsRequested": 1,
    "toolsForwarded": 1,
    "toolChoice": "auto",
    "toolCallsDetected": ["calculator"],
    "executions": [{ "name": "calculator", "ok": true, "ms": 1 }],
    "followUpForwarded": true,
    "finalStatus": "completed"
  }]
}`,
      },
      {
        kind: "callout",
        tone: "info",
        title: "Privacy rule",
        text: "Diagnostics log tool names, counts, durations and statuses. Never tool arguments, never message content, never credentials.",
      },
    ],
  },

  // ════════════════════════════ BUILT-IN TOOLS ══════════════════════════════

  {
    id: "calculator",
    title: "calculator",
    description:
      "Exact arithmetic — operators, functions, constants, precedence rules.",
    group: "tools",
    keywords: ["math", "expression", "arithmetic", "sqrt"],
    blocks: [
      {
        kind: "p",
        text: "Evaluates a mathematical expression with **exact arithmetic** — no eval, no floating-point surprises on integers. Use it for any numeric computation instead of letting the model compute by hand.",
      },
      {
        kind: "h3",
        text: "Parameters",
      },
      {
        kind: "table",
        head: ["Parameter", "Type", "Required", "Description"],
        rows: [
          ["expression", "string", "yes", "The expression, e.g. `\"12345 * 6789\"` or `\"sqrt(2) * sin(pi/6)\"`"],
        ],
      },
      {
        kind: "h3",
        text: "Operators",
      },
      {
        kind: "table",
        head: ["Operator", "Meaning", "Notes"],
        rows: [
          ["+ - * /", "arithmetic", "standard precedence"],
          ["%", "modulo", "left-assoc, like C"],
          ["^", "power", "right-assoc; `-2^2` = `-(2^2)` = -4 (math convention)"],
          ["unary -", "negation", "binds tighter than * / but looser than ^"],
          ["( )", "grouping", "arbitrary nesting"],
          [",", "argument separator", "for multi-arg functions (min, max, pow…)"],
        ],
      },
      {
        kind: "h3",
        text: "Functions",
      },
      {
        kind: "list",
        items: [
          "`sqrt(x)`, `abs(x)`, `round(x)`, `floor(x)`, `ceil(x)`",
          "`min(a, b, …)`, `max(a, b, …)`, `pow(a, b)`",
          "`log(x)` (base 10), `ln(x)`, `exp(x)`",
          "`sin(x)`, `cos(x)`, `tan(x)` — radians",
        ],
      },
      {
        kind: "h3",
        text: "Constants",
      },
      {
        kind: "list",
        items: ["`pi` ≈ 3.14159…", "`e` ≈ 2.71828…"],
      },
      {
        kind: "h3",
        text: "Examples",
      },
      {
        kind: "code",
        title: "expressions",
        lang: "text",
        code: `12345 * 6789            → 83810205
sqrt(2) * sin(pi/6)     → 0.7071067811865476
-2^2                    → -4
(1 + 2) * (3 + 4)       → 21
max(3, 7, 5) + pow(2, 10) → 1031`,
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Thousands separators",
        text: "The parser tolerates digit-group separators (`1,234,567`) — useful when the model echoes human-formatted numbers.",
      },
      {
        kind: "code",
        title: "bash — direct execution",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/tools/execute \\
  -H "Content-Type: application/json" \\
  -d '{"name":"calculator","arguments":{"expression":"12345 * 6789"}}'
# → {"ok":true,"result":83810205,"tool":"calculator","ms":1}`,
      },
    ],
  },

  {
    id: "web-search",
    title: "web_search",
    description:
      "Live web results — parameters, the provider fallback chain, and the result shape.",
    group: "tools",
    keywords: ["search", "web", "query", "results", "wikipedia"],
    blocks: [
      {
        kind: "p",
        text: "Searches the live web for current information. Returns ranked results with title, url, host, date and a snippet. Use it for anything time-sensitive — releases, prices, news, \"what is the latest…\".",
      },
      {
        kind: "h3",
        text: "Parameters",
      },
      {
        kind: "table",
        head: ["Parameter", "Type", "Required", "Description"],
        rows: [
          ["query", "string", "yes", "Search query — keywords work better than sentences"],
          ["num", "number 1–8", "no (default 5)", "Number of results to return"],
          ["recency_days", "number", "no", "Restrict results to the last N days"],
        ],
      },
      {
        kind: "h3",
        text: "Result shape",
      },
      {
        kind: "code",
        title: "result (as the model receives it)",
        lang: "json",
        code: `{
  "ok": true,
  "provider": "wikipedia",
  "results": [
    {
      "title": "Next.js",
      "url": "https://en.wikipedia.org/wiki/Next.js",
      "host": "en.wikipedia.org",
      "date": "2025-11-01",
      "snippet": "Next.js is an open-source web development framework …"
    }
  ]
}`,
      },
      {
        kind: "h3",
        text: "The provider fallback chain",
      },
      {
        kind: "p",
        text: "The search backend adapts to its environment. Providers are tried in order and the winner is reported honestly in the `provider` field:",
      },
      {
        kind: "table",
        head: ["Order", "Backend", "Where it works"],
        rows: [
          ["1", "ZAI search", "Rich environment (self-hosted with ZAI vars, sandbox)"],
          ["2", "DDG-lite HTML", "Self-hosted / non-datacenter IPs"],
          ["3", "Wikipedia MediaWiki API", "Everywhere — keyless, serverless-friendly"],
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Honest degradation",
        text: "If every backend fails, the tool returns `{ok: false, error: …}` — the model is told search is unavailable instead of receiving an empty-but-successful result.",
      },
      {
        kind: "code",
        title: "bash — direct execution",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/tools/execute \\
  -H "Content-Type: application/json" \\
  -d '{"name":"web_search",
       "arguments":{"query":"latest next.js release notes","num":5}}'`,
      },
    ],
  },

  {
    id: "current-time",
    title: "get_current_time",
    description: "The model's clock — for anything that depends on now.",
    group: "tools",
    keywords: ["time", "date", "now", "today"],
    blocks: [
      {
        kind: "p",
        text: "Returns the current date and time whenever the answer depends on *now* — \"today\", \"this week\", \"how old is…\". Models have no internal clock; this tool is the honest answer to that.",
      },
      {
        kind: "h3",
        text: "Parameters",
      },
      {
        kind: "p",
        text: "None — `{}`.",
      },
      {
        kind: "h3",
        text: "Result",
      },
      {
        kind: "code",
        title: "result",
        lang: "json",
        code: `{
  "ok": true,
  "iso": "2026-01-14T09:41:07.000Z",
  "epoch_ms": 1768386067000
}`,
      },
      {
        kind: "code",
        title: "bash — direct execution",
        lang: "bash",
        code: `curl -s https://freeaixyz4all.vercel.app/api/tools/execute \\
  -H "Content-Type: application/json" \\
  -d '{"name":"get_current_time","arguments":{}}'`,
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Combine with web_search",
        text: "Time questions often become search questions (\"who won the game last night?\"). The pipeline supports parallel tool calls — the model can check the clock and search the web in the same round.",
      },
    ],
  },

  // ═════════════════════════════ RESOURCES ══════════════════════════════════

  {
    id: "examples",
    title: "Examples",
    description:
      "Cookbook: curl, JavaScript, Python, a full streaming tool loop, and SDK wiring.",
    group: "resources",
    keywords: ["example", "cookbook", "code", "sample", "sdk"],
    blocks: [
      {
        kind: "h3",
        text: "curl — stream + tools",
      },
      {
        kind: "code",
        title: "bash",
        lang: "bash",
        code: `curl -N https://freeaixyz4all.vercel.app/api/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "oc/gpt-5.6",
    "messages": [{"role":"user","content":"Search the web for the latest Next.js release and summarize it."}],
    "stream": true,
    "tools": [{
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "Search the live web for current information.",
        "parameters": {
          "type": "object",
          "properties": {"query": {"type": "string"}},
          "required": ["query"]
        }
      }
    }],
    "tool_choice": "auto",
    "parallel_tool_calls": true
  }'`,
      },
      {
        kind: "h3",
        text: "JavaScript — OpenAI SDK, streaming",
      },
      {
        kind: "code",
        title: "node / edge",
        lang: "javascript",
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://freeaixyz4all.vercel.app/api/v1",
  apiKey: "not-needed",
});

const stream = await client.chat.completions.create({
  model: "tb/gpt-5",
  messages: [{ role: "user", content: "Write a haiku about streaming." }],
  stream: true,
});

for await (const chunk of stream) {
  const text = chunk.choices[0]?.delta?.content ?? "";
  process.stdout.write(text);
}`,
      },
      {
        kind: "h3",
        text: "Python — OpenAI SDK, non-streaming with tools",
      },
      {
        kind: "code",
        title: "python",
        lang: "python",
        code: `from openai import OpenAI

client = OpenAI(
    base_url="https://freeaixyz4all.vercel.app/api/v1",
    api_key="not-needed",
)

tools = [{
    "type": "function",
    "function": {
        "name": "calculator",
        "description": "Evaluate a math expression exactly.",
        "parameters": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
}]

res = client.chat.completions.create(
    model="oc/gpt-5.6",
    messages=[{"role": "user", "content": "What is 12345 times 6789?"}],
    tools=tools,
    tool_choice="auto",
)

msg = res.choices[0].message
if msg.tool_calls:
    call = msg.tool_calls[0]
    print("tool call:", call.function.name, call.function.arguments)
else:
    print(msg.content)`,
      },
      {
        kind: "h3",
        text: "A complete streaming tool loop (fetch + SSE)",
      },
      {
        kind: "code",
        title: "typescript — the full agent round-trip",
        lang: "typescript",
        code: `const BASE = "https://freeaixyz4all.vercel.app";
const TOOLS = [/* your tool definitions */];
const MAX_ROUNDS = 10;

async function chatWithTools(userMessage: string) {
  const messages: any[] = [{ role: "user", content: userMessage }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(\`\${BASE}/api/v1/chat/completions\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "oc/gpt-5.6",
        messages,
        stream: true,
        tools: TOOLS,
        tool_choice: "auto",
        parallel_tool_calls: true,
      }),
    });

    // (parse SSE with the persistent-buffer reader from the
    //  Streaming guide; collect text + tool_calls + finish_reason)

    const { text, toolCalls, finishReason } = await parseStream(res);

    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      return text;                       // final answer
    }

    // append assistant tool_calls + execute + append tool results
    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
    await Promise.all(toolCalls.map(async (call) => {
      const exec = await fetch(\`\${BASE}/api/tools/execute\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: call.function.name,
          arguments: JSON.parse(call.function.arguments),
        }),
      }).then((r) => r.json());
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(exec),
      });
    }));
    // loop — next round streams the continuation with the SAME tools
  }
  throw new Error("MAX_TOOL_ROUNDS exceeded");
}`,
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Same-origin usage",
        text: "The API is CORS-open — the snippets above run unchanged in the browser against the deployed URL (relative paths if you host inside the app).",
      },
    ],
  },

  {
    id: "faq",
    title: "FAQ",
    description: "The questions that come up — answered.",
    group: "resources",
    keywords: ["faq", "questions", "answers", "help"],
    blocks: [
      {
        kind: "list",
        items: [
          "**Is it really free?** Yes — no keys, no accounts, no quota ledger. The upstreams are free providers; the gateway adds routing, streaming and tools.",
          "**What happens to my data?** Requests are processed to fulfill them; the gateway itself is stateless and stores nothing. Upstreams are third parties — treat them accordingly.",
          "**Why did the model say it has no tools?** You are on an old client, or the model's capabilities.tools is false (the Playground hides the toggles for such models). On tools-capable models the pipeline guarantees forwarding — verified by `assertToolsForwarded` and the `/api/debug/tools` traces.",
          "**A model returned an empty response.** That is `EMPTY_UPSTREAM_RESPONSE` — free upstreams occasionally return blank bodies. Retry; if it persists, pick another model.",
          "**Can I use this in production?** You can, with the right expectations: upstream availability shifts, and there is no SLA. For hobby tools, agents, prototypes and demos it is solid. For contractual uptime, bring your own fallback.",
          "**Do you support vision? Image generation?** Vision inputs are supported on models whose capability matrix says `vision`. Generation endpoints (image/video) are not part of the native-only surface.",
          "**How do I report a broken provider?** Open an issue on the GitHub repo with the model id, the error code and a timestamp — the debug endpoints give you everything needed.",
          "**Can I add a provider?** The registry is static by design. A PR with an adapter + registry entries is the path — see [Self-hosting](#doc-self-hosting) for the code map.",
          "**Why is my stream stuck?** Your parser is waiting for EOF instead of `data: [DONE]`. See the warning in the [Streaming](#doc-streaming) guide.",
          "**Which model should I start with?** Any streaming + tools model (the Playground pre-selects one). For reasoning, filter the catalog by the reasoning badge.",
        ],
      },
    ],
  },

  {
    id: "glossary",
    title: "Glossary",
    description: "Terms used across the docs, defined once.",
    group: "resources",
    keywords: ["glossary", "terms", "definitions"],
    blocks: [
      {
        kind: "table",
        head: ["Term", "Definition"],
        rows: [
          ["Canonical id", "The stable model identifier `<shortId>/<upstreamId>` you put in `model`"],
          ["Short id", "2–4 letter provider prefix (oc, tb, kg…)"],
          ["Upstream id", "The provider's own model name, e.g. `gpt-5.6`"],
          ["SSE", "Server-Sent Events — the `text/event-stream` transport for chunks"],
          ["Delta", "One streamed fragment: content, reasoning or tool_calls"],
          ["[DONE]", "The terminal SSE sentinel that finalizes a generation"],
          ["Tool round", "One request→tool_calls→execute→follow-up cycle; capped at 10"],
          ["Emulated tools", "Fenced ```tool_call text for providers without a tools API"],
          ["Capability gate", "400 TOOL_UNSUPPORTED when tools are sent to a non-tools model"],
          ["Forwarding assertion", "The guard that fails the request if provider payload drops tools"],
          ["Circuit breaker", "Per-provider auto-open on failures; `PROVIDER_UNAVAILABLE` while open"],
          ["Ring buffer", "The bounded in-memory trace store behind /api/debug/tools"],
        ],
      },
    ],
  },

  {
    id: "changelog",
    title: "Changelog",
    description: "What shipped, when — newest first.",
    group: "resources",
    keywords: ["changelog", "release", "version", "history"],
    blocks: [
      {
        kind: "h3",
        text: "v2.0 — native tool calling + warm aurora",
      },
      {
        kind: "list",
        items: [
          "Complete tool-calling pipeline: schema validation, capability gate, 1:1 forwarding with assertions, streamed fragment accumulation, parallel execution, follow-up rounds (MAX 10), result clamping.",
          "Built-in tools: `calculator` (exact recursive-descent arithmetic), `web_search` (ZAI → DDG-lite → Wikipedia fallback chain), `get_current_time`.",
          "TOOL_* error taxonomy + `/api/debug/tools` lifecycle traces (names/counts only).",
          "Playground: tool toggle row, warm tool chips, tool status line, per-round diagnostics.",
          "New warm-aurora design across the whole product: landing hero (living light-blades, keycap buttons, command-bar mockup), playground, models and the docs section you are reading.",
        ],
      },
      {
        kind: "h3",
        text: "v1.5 — native-only",
      },
      {
        kind: "list",
        items: [
          "Removed all external provider systems: OnyxBase persistence, Pollinations, Gratisfy aggregation, auth, BYOK, API keys, XYZ pricing, dynamic discovery, database.",
          "Static 75-model registry — every id maps to a live adapter at build time.",
          "Single-message streaming: deltas + reasoning accumulate into ONE assistant message; `[DONE]` finalizes (fixes dev-server gzip hangs).",
          "Stateless deploy — zero env vars required.",
        ],
      },
      {
        kind: "h3",
        text: "v1.0 — the gateway",
      },
      {
        kind: "list",
        items: [
          "OpenAI-compatible `/api/v1/chat/completions` with true end-to-end SSE.",
          "Canonical model ids across 17 providers; structured error envelopes.",
          "Playground + browsable model catalog.",
        ],
      },
      {
        kind: "callout",
        tone: "tip",
        title: "Stay current",
        text: "The changelog tracks the deployed product at [freeaixyz4all.vercel.app](https://freeaixyz4all.vercel.app) — the same code as the GitHub repo's main branch.",
      },
    ],
  },
];
