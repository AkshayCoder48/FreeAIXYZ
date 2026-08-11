"use client";

/**
 * Reverse Engineering Docs — all tricks used to bypass FreeGPT.tech's security.
 *
 * This page documents every technique used to reverse-engineer and bypass
 * FreeGPT.tech's WASM-secured proof-of-work challenge system.
 */

import Link from "next/link";
import {
  ArrowLeft,
  Terminal,
  Shield,
  Key,
  Fingerprint,
  Cpu,
  Lock,
  Zap,
  Code,
  Network,
  Eye,
  Wrench,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QuickCodeBlock } from "@/components/ui/code-block";

interface Trick {
  id: string;
  icon: typeof Shield;
  title: string;
  category: string;
  problem: string;
  solution: string;
  code?: string;
  file?: string;
}

const TRICKS: Trick[] = [
  {
    id: "backup-host",
    icon: Network,
    title: "1. Backup Host Bypass (Cloudflare evasion)",
    category: "Network",
    problem:
      "The main host freegpt.tech sits behind Cloudflare with bot detection (Turnstile challenge). Server-side fetch requests get 403 blocked by Cloudflare's browser fingerprinting.",
    solution:
      "Discovered a backup host standalone.freegpt.win:3001 that runs the same One API (New API fork) backend but WITHOUT Cloudflare in front. All API calls go to this backup host instead. The Cloudflare Turnstile token header is sent empty — the backup host's middleware accepts empty tokens.",
    code: `const BASE_URL = "https://standalone.freegpt.win:3001";
// NOT https://freegpt.tech (Cloudflare-blocked)

// Empty Turnstile token — backup host accepts it
"cf-turnstile-token": "",`,
    file: "src/lib/providers/freegpt.ts:34",
  },
  {
    id: "wasm-extraction",
    icon: Cpu,
    title: "2. WASM Binary Extraction",
    category: "Reverse Engineering",
    problem:
      "FreeGPT's signing logic is compiled to WebAssembly (wasm_signer_bg.wasm, 46KB). The browser loads this WASM and calls generate_secure_payload() to compute the proof-of-work hash + signature. Without replicating this, requests get rejected.",
    solution:
      "Downloaded the wasm_signer_bg.wasm binary directly from FreeGPT's CDN. Also grabbed the JavaScript glue code (wasm_signer.js) that wasm-bindgen generates. These files are now bundled in the project root and loaded server-side via WebAssembly.instantiate().",
    code: `// The WASM binary lives at: wasm_signer_bg.wasm (46KB)
// The JS glue lives at: wasm_signer.js (the wasm-bindgen output)

// Load server-side:
const wasmBuffer = fs.readFileSync("wasm_signer_bg.wasm");
const result = await WebAssembly.instantiate(wasmBuffer, imports);
wasm = result.instance.exports;`,
    file: "wasm_signer_bg.wasm, src/lib/freegpt-signer.cjs:139-253",
  },
  {
    id: "browser-mock",
    icon: Eye,
    title: "3. Browser API Mocking (no jsdom)",
    category: "Serverless Compatibility",
    problem:
      "The WASM signer was compiled to run in a browser — it calls window, document, canvas.getContext(), canvas.toDataURL(), navigator, etc. On a server (Vercel serverless), these don't exist. Originally used jsdom but that broke the Vercel build ('Cannot find module jsdom') and was too heavy.",
    solution:
      "Built lightweight mocks for every browser API the WASM touches: window, document, canvas (with a fixed toDataURL fingerprint), navigator, location. The canvas mock returns a hardcoded base64 PNG so the fingerprint is always 'fp_error' (the WASM can't actually render canvas server-side, but the PoW hash still satisfies the difficulty).",
    code: `// Canvas mock — returns a fixed fingerprint
function createCanvasMock() {
  return {
    width: 200, height: 200,
    getContext: () => ({ fillRect(){}, fillText(){}, fillStyle:'', font:'' }),
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAo...',
  };
}

// Window mock with location + navigator
const windowMock = {
  document: documentMock,
  location: { protocol: "https:", host: "freegpt.tech", origin: "https://freegpt.tech" },
  navigator: { userAgent: "Mozilla/5.0..." },
  // ...all the JS globals the WASM expects
};

global.window = windowMock;
global.document = documentMock;`,
    file: "src/lib/freegpt-signer.cjs:15-82",
  },
  {
    id: "wasm-glue",
    icon: Wrench,
    title: "4. wasm-bindgen Import Shimming",
    category: "WASM Interop",
    problem:
      "The WASM binary imports ~30 functions from its JavaScript glue module (./wasm_signer_bg.js). These are wasm-bindgen generated functions like __wbg_createElement_9b0aab265c549ded, __wbg_toDataURL_bf99d85b39ce57cc, etc. Without providing ALL of these imports, WebAssembly.instantiate() fails with a LinkError.",
    solution:
      "Reverse-engineered every import the WASM expects by reading the original wasm_signer.js glue code. Implemented all ~30 import functions in the signer CJS module — each one bridges the WASM call to our mocked browser APIs. Functions like getStringFromWasm0/passStringToWasm0 handle the string memory marshalling between JS and WASM linear memory.",
    code: `const imports = {
  './wasm_signer_bg.js': {
    __wbg_createElement_9b0aab265c549ded: function(arg0, arg1, arg2) {
      const tag = getStringFromWasm0(arg1, arg2);
      return documentMock.createElement(tag);
    },
    __wbg_toDataURL_bf99d85b39ce57cc: function(arg0, arg1, arg2) {
      const type = getStringFromWasm0(arg1, arg2);
      return arg0.toDataURL(type); // returns fixed base64
    },
    __wbg_instanceof_Window_23e677d2c6843922: function(arg0) {
      return arg0 === windowMock;
    },
    // ...27 more import shims
  }
};
await WebAssembly.instantiate(wasmBuffer, imports);`,
    file: "src/lib/freegpt-signer.cjs:141-250",
  },
  {
    id: "pow-challenge",
    icon: Key,
    title: "5. Proof-of-Work Challenge Handshake",
    category: "Authentication",
    problem:
      "FreeGPT requires a proof-of-work challenge per request. The flow is: GET /api/challenge with a UUID → server returns a challenge string + difficulty level → the WASM signer computes a PoW hash that satisfies the difficulty → POST the hash + signature in x-secure-* headers.",
    solution:
      "Implemented the full challenge handshake: (1) Generate a fresh UUID per request (never reused), (2) GET /api/challenge with the UUID, (3) Feed the challenge + difficulty to the WASM signer which computes the PoW hash (seed_nonce + nonce + hash), (4) Flatten the signer's output into x-secure-* headers.",
    code: `// 1. Fresh UUID per request
const uuid = randomUUID();

// 2. Fetch challenge
const { challenge, difficulty, challengeId, expiresAt, version } =
  await fetchChallenge(uuid);
// GET https://standalone.freegpt.win:3001/api/challenge
// Headers: { uuid: uuid, "x-origin": "https://freegpt.tech" }

// 3. Run WASM signer → computes PoW hash
const payload = signer.generateSecurePayload(
  uuid, timestamp, nonce, challenge, clientIp, difficulty
);
// Returns: { signature, fingerprint, pow: { seed_nonce, nonce, hash, difficulty } }

// 4. Flatten to x-secure-* headers
const secureHeaders = securePayloadToHeaders(payload);`,
    file: "src/lib/providers/freegpt.ts:331-369",
  },
  {
    id: "header-flattening",
    icon: Code,
    title: "6. x-secure-* Header Flattening",
    category: "Header Engineering",
    problem:
      "The WASM signer returns a nested object: { signature, fingerprint, client_ip, v, pow: { seed_nonce, nonce, hash, difficulty } }. FreeGPT's middleware expects each field as a separate HTTP header prefixed with x-secure-, with nested objects flattened using dashes and underscores converted to dashes.",
    solution:
      "Built a recursive walker that flattens the nested object into a flat header map. snake_case keys are converted to kebab-case. Nested objects are joined with dashes. Every key gets the x-secure- prefix. So pow.seed_nonce becomes x-secure-pow-seed-nonce.",
    code: `function securePayloadToHeaders(payload) {
  const headers = {};
  function walk(prefix, value) {
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const key = k.replace(/_/g, '-'); // snake_case -> kebab-case
        const newPrefix = prefix ? prefix + '-' + key : 'x-secure-' + key;
        walk(newPrefix, v);
      }
      return;
    }
    headers[prefix] = String(value);
  }
  walk("", payload);
  return headers;
}
// Result: x-secure-signature, x-secure-fingerprint, x-secure-pow-nonce, etc.`,
    file: "src/lib/providers/freegpt.ts:202-238",
  },
  {
    id: "dynamic-require",
    icon: Lock,
    title: "7. eval(\"require\") Bundler Evasion",
    category: "Build System",
    problem:
      "The MODELS registry is imported by client components (playground, models-showcase). Any statically-analyzable require() in freegpt.ts would cause webpack/Turbopack to bundle the signer (and its fs/jsdom deps) into client bundles — breaking the client build with 'Module not found: Can't resolve fs'.",
    solution:
      "Used eval(\"require\") to hide the require() call from static analysis. webpack/Turbopack can't see what eval() evaluates to, so the signer is never bundled into client code. The signer is loaded with an absolute path (process.cwd() + src/lib/freegpt-signer.cjs) because Next.js bundles route handlers into chunk files under .next/dev/server/chunks/ — a relative require would resolve relative to the chunk, not the source.",
    code: `// eval("require") — webpack can't statically analyze this
const dynamicRequire = eval("require") as NodeRequire;

// Absolute path — chunks move around, cwd() doesn't
const signerPath = path.join(
  process.cwd(), "src", "lib", "freegpt-signer.cjs"
);
const mod = dynamicRequire(signerPath);

// WASM binary also resolved by absolute path
const wasmPath = path.join(process.cwd(), "wasm_signer_bg.wasm");
await mod.initWasm(wasmPath);`,
    file: "src/lib/providers/freegpt.ts:81-101",
  },
  {
    id: "lazy-loading",
    icon: Zap,
    title: "8. Lazy WASM Initialization + Singleton",
    category: "Performance",
    problem:
      "Loading + instantiating the 46KB WASM binary takes ~200ms. If done per-request, every chat call would have a 200ms penalty. Also, concurrent first requests could trigger double-initialization.",
    solution:
      "Singleton pattern with a shared load promise. The first request triggers initWasm() and stores the promise. All concurrent requests await the same promise. After init, the WASM instance is cached in a module-level variable — subsequent calls skip init entirely (just 0ms overhead).",
    code: `let signerLoaded = false;
let signerLoadPromise: Promise<void> | null = null;
let signerModule: SignerModule | null = null;

async function ensureSignerLoaded() {
  if (signerLoaded && signerModule) return signerModule; // fast path
  if (!signerLoadPromise) {
    signerLoadPromise = (async () => {
      // ... load + init WASM (runs ONCE)
      signerModule = mod;
      signerLoaded = true;
    })();
  }
  await signerLoadPromise; // concurrent callers share this
  return signerModule!;
}`,
    file: "src/lib/providers/freegpt.ts:55-101",
  },
  {
    id: "origin-spoofing",
    icon: Fingerprint,
    title: "9. Origin Spoofing + User-Agent Mimicry",
    category: "Anti-Bot Evasion",
    problem:
      "FreeGPT's middleware checks the x-origin header and User-Agent to verify requests come from their frontend. Missing or wrong values get rejected.",
    solution:
      "Every request includes x-origin: https://freegpt.tech (the frontend origin) and a realistic Chrome 130 User-Agent string. The Accept header is set to text/event-stream for streaming and application/json for non-streaming — matching what a real browser would send.",
    code: `const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/130.0.0.0 Safari/537.36",
  "x-origin": "https://freegpt.tech",
  "Accept": "text/event-stream", // or "application/json"
  // ...
};`,
    file: "src/lib/providers/freegpt.ts:353-370",
  },
  {
    id: "required-fields",
    icon: CheckCircle2,
    title: "10. Body Field Requirements (Invalid Data fix)",
    category: "Request Format",
    problem:
      "FreeGPT returned HTTP 400 'Invalid data' when sending only {model, messages, stream}. The One API backend requires specific fields to be present.",
    solution:
      "Discovered through trial and error that the body must include temperature, presence_penalty, frequency_penalty, and top_p with specific values. Missing any of these triggers 'Invalid data'. The values are hardcoded: temperature=0.5, presence_penalty=0, frequency_penalty=0, top_p=1.",
    code: `const body = {
  model: req.model.upstream,
  messages: req.messages.map(m => ({ role: m.role, content: m.content })),
  stream: true,
  // These 4 fields are REQUIRED — without them: 400 "Invalid data"
  temperature: 0.5,
  presence_penalty: 0,
  frequency_penalty: 0,
  top_p: 1,
};`,
    file: "src/lib/providers/freegpt.ts:373-384",
  },
  {
    id: "challenge-fields",
    icon: AlertCircle,
    title: "11. Defensive Challenge Field Parsing",
    category: "Resilience",
    problem:
      "The /api/challenge response shape varied during development — sometimes the challenge token was in challenge, sometimes in token, sometimes in challenge_token. The difficulty was sometimes level. The challengeId/expiresAt/version fields were added later.",
    solution:
      "Defensive parsing that checks multiple possible field names for each value. Falls back to sensible defaults (difficulty=2, version='1.0') if fields are missing. This makes the provider resilient to upstream API changes.",
    code: `const json = await res.json();
const challenge =
  json.challenge ?? json.token ?? json.challenge_token ?? "";
const difficulty = json.difficulty ?? json.level ?? 2;
const challengeId = json.challengeId ?? "";
const expiresAt = json.expiresAt ?? 0;
const version = json.version ?? "1.0";`,
    file: "src/lib/providers/freegpt.ts:166-178",
  },
  {
    id: "rate-limit",
    icon: Shield,
    title: "12. Self-Imposed Rate Limiting (8 req/min)",
    category: "Rate Limit Management",
    problem:
      "FreeGPT's upstream has a shared anonymous token pool that can get exhausted if hammered. Also, the upstream One API may rate-limit by IP.",
    solution:
      "Implemented a self-imposed in-memory rate limiter: 8 requests per minute per client IP. Uses a sliding window Map<ip, {count, windowStart}>. This prevents the gateway from exhausting FreeGPT's token pool and keeps the service sustainable for all users.",
    code: `const RATE_LIMIT_PER_MIN = 8;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function rateLimitCheck(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > 60_000) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MIN) return false;
  bucket.count++;
  return true;
}`,
    file: "src/lib/providers/freegpt.ts:103-121",
  },
  {
    id: "token-exhaustion",
    icon: AlertCircle,
    title: "13. Token Pool Exhaustion Bypass (400 handler)",
    category: "Error Handling",
    problem:
      "FreeGPT's upstream sometimes returns HTTP 400 with a Chinese error message: {\"error\":{\"message\":\"Provider failed: 400 - 没有可用的tokens，请联系管理员解决！\"}}. This means their shared token pool is temporarily empty. The raw error is confusing for users.",
    solution:
      "Detect the Chinese error string (没有可用的tokens = 'no available tokens') and surface a clear English message: 'FreeGPT's upstream token pool is temporarily exhausted. Please try a different model or retry in a few minutes.' Also detect generic 'Provider failed' errors with actionable guidance.",
    code: `if (res.status === 400 && txt.includes("没有可用的tokens")) {
  throw new Error(
    "FreeGPT's upstream token pool is temporarily exhausted. " +
    "Please try a different model or retry in a few minutes."
  );
}
if (res.status === 400 && txt.includes("Provider failed")) {
  throw new Error(
    "FreeGPT upstream provider error: " + txt.slice(0, 150) +
    ". Try a different model or retry shortly."
  );
}`,
    file: "src/lib/providers/freegpt.ts:399-416",
  },
  {
    id: "native-tools",
    icon: Wrench,
    title: "14. Native Tool Calling Pass-Through",
    category: "Feature Support",
    problem:
      "FreeGPT's One API backend natively supports OpenAI tool calling. But the standard gateway tool-calls system uses prompt injection. We wanted FreeGPT models to use native tool calling for better reliability.",
    solution:
      "FreeGPT is in the realStream allowlist and tools are passed through directly in the request body (body.tools + body.tool_choice). The upstream returns tool_calls in standard OpenAI format — no prompt injection needed. The gateway parses these and converts to the standard format.",
    code: `// Pass tools directly to FreeGPT (native support)
if (req.tools && req.tools.length > 0) {
  body.tools = req.tools;
  body.tool_choice = req.toolChoice || "auto";
}

// FreeGPT is in the realStream allowlist:
const realStream = model.provider === "freegpt" || /* ... */;`,
    file: "src/lib/providers/freegpt.ts:386-394, route.ts:433-446",
  },
];

const CATEGORIES = [
  "Network",
  "Reverse Engineering",
  "Serverless Compatibility",
  "WASM Interop",
  "Authentication",
  "Header Engineering",
  "Build System",
  "Performance",
  "Anti-Bot Evasion",
  "Request Format",
  "Resilience",
  "Rate Limit Management",
  "Error Handling",
  "Feature Support",
];

export default function ReverseEngineeringPage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, rgba(255,154,60,0.10), transparent 70%)",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm font-semibold">Reverse Engineering</span>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href="/docs">
              <Terminal className="h-3.5 w-3.5" /> API Docs
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-5xl w-full px-4 sm:px-6 py-10">
        {/* Hero */}
        <div className="mb-10">
          <Badge
            variant="outline"
            className="gap-1.5 border-primary/30 text-primary bg-primary/5 mb-4"
          >
            <Shield className="h-3 w-3" /> FreeGPT.tech
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Reverse Engineering & Rate-Limit Bypass
          </h1>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            A complete breakdown of every technique used to reverse-engineer
            FreeGPT.tech's WASM-secured proof-of-work challenge system and
            bypass its anti-bot protections. 14 tricks across network evasion,
            WASM interop, browser mocking, and more.
          </p>
        </div>

        {/* Overview */}
        <div className="grid sm:grid-cols-3 gap-3 mb-10">
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <Cpu className="h-5 w-5 text-primary mb-2" />
            <div className="text-2xl font-bold">46KB</div>
            <div className="text-[11px] text-muted-foreground">WASM binary</div>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <Key className="h-5 w-5 text-primary mb-2" />
            <div className="text-2xl font-bold">14</div>
            <div className="text-[11px] text-muted-foreground">tricks used</div>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <Shield className="h-5 w-5 text-primary mb-2" />
            <div className="text-2xl font-bold">30+</div>
            <div className="text-[11px] text-muted-foreground">WASM imports shimmed</div>
          </div>
        </div>

        {/* Architecture diagram */}
        <div className="mb-10">
          <QuickCodeBlock
            title="request flow"
            code={`client ──▶ POST /api/v1/chat/completions
            │  { model: "fgpt-deepseek-chat", messages, stream }
            ▼
   ┌─ gateway (stateless) ──────────────────────────────┐
   │  1. uuid        = randomUUID()                      │
   │  2. challenge   = GET /api/challenge ─▶ {challenge} │
   │  3. payload     = WASM.generateSecurePayload(...)   │
   │     ┌─ pow hash ──────────────────────────┐         │
   │     │ seed_nonce + nonce → SHA256 → hash  │         │
   │     │ hash must satisfy difficulty (bits) │         │
   │     └─────────────────────────────────────┘         │
   │  4. headers     = x-secure-* (flattened payload)    │
   │  5. POST /api/openai/oneapi/v1/chat/completions     │
   │     with empty cf-turnstile-token (backup host)     │
   │  6. parse OpenAI SSE stream → re-pace word-by-word  │
   └─────────────────────────────────────────────────────┘
            ▼
client ◀── SSE stream { choices: [{ delta: { content } }] }`}
          />
        </div>

        {/* Tricks list */}
        <div className="space-y-6">
          {TRICKS.map((trick) => (
            <div
              key={trick.id}
              id={trick.id}
              className="rounded-2xl border border-border bg-card/40 backdrop-blur p-6 scroll-mt-20"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                  <trick.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold tracking-tight">
                    {trick.title}
                  </h2>
                  <Badge
                    variant="outline"
                    className="text-[9px] mt-1 text-muted-foreground"
                  >
                    {trick.category}
                  </Badge>
                </div>
              </div>

              <div className="space-y-3 mt-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-500 mb-1">
                    Problem
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {trick.problem}
                  </p>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500 mb-1">
                    Solution
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {trick.solution}
                  </p>
                </div>
                {trick.code && (
                  <div className="mt-3">
                    <QuickCodeBlock
                      title={trick.file ?? "code"}
                      code={trick.code}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Files involved */}
        <div className="mt-10 rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Code className="h-5 w-5 text-primary" /> Files Involved
          </h2>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>
              <code className="text-primary">src/lib/providers/freegpt.ts</code>{" "}
              (543 lines) — Provider implementation: challenge handshake, header
              construction, SSE parsing, rate limiting
            </li>
            <li>
              <code className="text-primary">src/lib/freegpt-signer.cjs</code>{" "}
              (286 lines) — WASM loader + browser API mocks + wasm-bindgen
              import shims
            </li>
            <li>
              <code className="text-primary">wasm_signer_bg.wasm</code> (46KB) —
              The extracted WASM binary that computes PoW hashes + signatures
            </li>
            <li>
              <code className="text-primary">wasm_signer.js</code> (13.8KB) —
              Original wasm-bindgen glue (reference, not loaded directly)
            </li>
            <li>
              <code className="text-primary">src/lib/dsml-parser.ts</code> —
              DSML→OpenAI tool_calls translator (bonus: handles DeepSeek's
              custom XML format that FreeGPT models emit)
            </li>
          </ul>
        </div>

        {/* Footer */}
        <div className="mt-8 flex justify-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/docs">
              <Terminal className="h-3.5 w-3.5" /> API Docs
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href="/">
              <ArrowLeft className="h-3.5 w-3.5" /> Home
            </Link>
          </Button>
        </div>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            FreeAIXYZ Gateway · Reverse Engineering Docs
          </span>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Home
          </Link>
        </div>
      </footer>
    </div>
  );
}
