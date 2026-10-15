/**
 * Task 4-gptai: end-to-end adapter verification.
 *
 * Imports each new adapter and calls complete() + stream() directly with
 * (a) a hello prompt, (b) a multi-turn conversation with a system prompt,
 * (c) a code prompt — proving the adapter path (not just raw fetch) works.
 */

import { goody2Provider } from "../src/lib/providers/gptai-goody2";
import { chatSmithProvider } from "../src/lib/providers/gptai-chatsmith";
import { chatWithFictionProvider } from "../src/lib/providers/gptai-chatwithfiction";
import { bookaiProvider } from "../src/lib/providers/gptai-bookai";
import { publicaiProvider } from "../src/lib/providers/gptai-publicai";
import { doppleProvider } from "../src/lib/providers/gptai-dopple";
import type { Provider } from "../src/lib/providers/types";
import type { GatewayModel } from "../src/lib/providers/registry";

function mkModel(provider: string, upstream: string): GatewayModel {
  return {
    id: `test/${upstream}`,
    provider: provider as GatewayModel["provider"],
    upstream,
    description: "test",
    category: "professional",
    contextWindow: 8000,
    capabilities: {
      streaming: true,
      tools: false,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}

interface CaseResult {
  name: string;
  case: string;
  ok: boolean;
  detail: string;
  ms: number;
  deltas?: number;
}

const results: CaseResult[] = [];

async function runCase(
  name: string,
  provider: Provider,
  model: GatewayModel,
  testCase: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  mode: "complete" | "stream" = "complete",
) {
  const t0 = Date.now();
  try {
    let text = "";
    let deltas = 0;
    if (mode === "stream") {
      for await (const chunk of provider.stream({ model, messages })) {
        text += chunk;
        deltas++;
      }
    } else {
      const r = await provider.complete({ model, messages });
      text = r.text;
    }
    const words = text.trim().split(/\s+/).filter(Boolean);
    // ≥2 words OR a correct one-word recall answer (multi-turn cases expect
    // exactly one word like "Teal" / "MANGO-77" — those are PASSES).
    const normalized = text.toLowerCase().replace(/[*_.]/g, "").trim();
    const expectedRecall = ["teal", "mango-77", "paris"];
    const ok = words.length >= 2 || expectedRecall.includes(normalized);
    results.push({
      name,
      case: testCase,
      ok,
      detail: JSON.stringify(text.trim().slice(0, 160)),
      ms: Date.now() - t0,
      ...(mode === "stream" ? { deltas } : {}),
    });
    console.log(
      `${ok ? "PASS" : "WARN"} ${name} [${testCase}] ${mode} ${Date.now() - t0}ms${mode === "stream" ? ` (${deltas} deltas)` : ""}: ${text.trim().slice(0, 140)}`,
    );
  } catch (err) {
    results.push({
      name,
      case: testCase,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
    });
    console.log(`FAIL ${name} [${testCase}] ${mode}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const HELLO: Array<{ role: "user"; content: string }> = [
  { role: "user", content: "Hello! Greet me and introduce yourself in one short sentence." },
];
const MULTITURN = [
  { role: "system", content: "You are a concise assistant. Keep replies under 15 words." },
  { role: "user", content: "My favorite color is teal. Remember it." },
  { role: "assistant", content: "Got it — teal." },
  { role: "user", content: "What is my favorite color? Answer with the color word only." },
];
const CODE = [
  { role: "user", content: "Write a JavaScript arrow function that doubles x. Reply with the code only." },
];

// goody2 — refusal monologues are the expected output (≥2 words = coherent).
await runCase("goody2", goody2Provider, mkModel("goody2", "goody2"), "hello", HELLO);
await runCase("goody2", goody2Provider, mkModel("goody2", "goody2"), "multiturn+sys", MULTITURN);
await runCase("goody2", goody2Provider, mkModel("goody2", "goody2"), "code", CODE, "stream");

// chatsmith — real GPT-4o-mini; system+multiturn MUST be honored.
await runCase("chatsmith", chatSmithProvider, mkModel("chatsmith", "gpt-4o-mini"), "hello", HELLO);
await runCase(
  "chatsmith",
  chatSmithProvider,
  mkModel("chatsmith", "gpt-4o-mini"),
  "multiturn+sys",
  [
    ...MULTITURN.slice(0, 3),
    { role: "user", content: "What is my favorite color? One word." },
  ],
);
await runCase("chatsmith", chatSmithProvider, mkModel("chatsmith", "gpt-4o-mini"), "code", CODE);

// chatwithfiction — Harry Potter persona; multi-turn recall via prevMessages.
await runCase("chatwithfiction", chatWithFictionProvider, mkModel("chatwithfiction", "harry-potter"), "hello", HELLO, "stream");
await runCase(
  "chatwithfiction",
  chatWithFictionProvider,
  mkModel("chatwithfiction", "harry-potter"),
  "multiturn",
  [
    { role: "user", content: "My favorite color is teal. Just reply OK." },
    { role: "assistant", content: "OK" },
    { role: "user", content: "What is my favorite color? One word only." },
  ],
  "stream",
);
await runCase("chatwithfiction", chatWithFictionProvider, mkModel("chatwithfiction", "harry-potter"), "code", CODE, "stream");

// bookai — per-request reset + messages override; system honored.
await runCase("bookai", bookaiProvider, mkModel("bookai", "gpt-3.5-turbo"), "hello", HELLO);
await runCase(
  "bookai",
  bookaiProvider,
  mkModel("bookai", "gpt-3.5-turbo"),
  "multiturn+sys",
  [
    { role: "system", content: "You are a pirate. Always start replies with 'Arrr'." },
    { role: "user", content: "My secret codeword is MANGO-77. Reply OK." },
    { role: "assistant", content: "OK, MANGO-77 noted." },
    { role: "user", content: "What is my secret codeword? One word." },
  ],
);
await runCase("bookai", bookaiProvider, mkModel("bookai", "gpt-3.5-turbo"), "code", CODE);

// publicai — Apertus; system via top-level field; real SSE deltas.
await runCase("publicai", publicaiProvider, mkModel("publicai", "apertus-1.5-70b"), "hello", HELLO, "stream");
await runCase(
  "publicai",
  publicaiProvider,
  mkModel("publicai", "apertus-1.5-70b"),
  "multiturn+sys",
  [
    { role: "system", content: "You are a pirate. Start every reply with 'Arrr'." },
    { role: "user", content: "My favorite color is teal. Reply OK." },
    { role: "assistant", content: "Arrr, OK matey." },
    { role: "user", content: "What is my favorite color? One word." },
  ],
  "stream",
);
await runCase("publicai", publicaiProvider, mkModel("publicai", "apertus-1.5-70b"), "code", CODE, "stream");

// dopple — fresh chat identity per request; flattened history.
await runCase("dopple", doppleProvider, mkModel("dopple", "dopple"), "hello", HELLO);
await runCase(
  "dopple",
  doppleProvider,
  mkModel("dopple", "dopple"),
  "multiturn",
  [
    { role: "system", content: "Always answer in exactly three words." },
    { role: "user", content: "What is the capital of France?" },
  ],
);
await runCase("dopple", doppleProvider, mkModel("dopple", "dopple"), "code", CODE);

console.log("\n════ SUMMARY ════");
let pass = 0;
let fail = 0;
for (const r of results) {
  if (r.ok) pass++;
  else fail++;
  console.log(`${r.ok ? "✅" : "❌"} ${r.name.padEnd(18)} [${r.case.padEnd(14)}] ${String(r.ms).padStart(6)}ms ${r.ok ? "" : `— ${r.detail.slice(0, 140)}`}`);
}
console.log(`\n${pass} pass / ${fail} fail / ${results.length} total`);

await Bun.write(
  "/home/z/my-project/gateway-tests/gptai-adapter-results.json",
  JSON.stringify(results, null, 2),
);
console.log("results → /home/z/my-project/gateway-tests/gptai-adapter-results.json");
