/**
 * g4f (GPT4Free) provider — calls the Python g4f package via a one-shot
 * subprocess per request (no persistent process to crash the server).
 *
 * Each request spawns `python3.13 scripts/g4f-wrapper.py`, sends one JSON
 * request, reads one JSON response, and the process exits. This fully
 * isolates the Python runtime from the Next.js server.
 */

import { join } from "path";
import type { Provider, ProviderCompletionRequest } from "./types";

const WRAPPER_SCRIPT = join(process.cwd(), "scripts", "g4f-wrapper.py");
const PYTHON_PATH = "/home/z/.local/lib/python3.13/site-packages";

// Lazy-load child_process via require() to hide it from Turbopack's static
// analysis (which fails on "Module not found: child_process" in some contexts).
let _spawn: ((cmd: string, args: string[], opts: Record<string, unknown>) => import("child_process").ChildProcess) | null = null;
function getSpawn() {
  if (!_spawn) {
    try {
      // Use require via eval to bypass static analysis
      const cp = eval('require')("child_process");
      _spawn = cp.spawn;
    } catch {
      _spawn = null;
    }
  }
  return _spawn;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface G4fResponse {
  ok: boolean;
  sse?: string;
  error?: string;
}

/**
 * Spawn a fresh Python process for one request, get the result, let it exit.
 */
async function callG4f(
  model: string,
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<string> {
  const spawnFn = getSpawn();
  if (!spawnFn) {
    throw new Error("g4f requires Node.js runtime (child_process not available).");
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      reject(new Error("g4f request timed out (90s). Try a different model."));
    }, 90000);

    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error("Aborted"));
      return;
    }

    const child = spawnFn("python3", [WRAPPER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: PYTHON_PATH },
      detached: true, // own process group — can't take down parent
    });
    child.unref();

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`g4f failed to start: ${e.message}`));
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(
          new Error(
            `g4f wrapper exited with code ${code}. ${stderr.slice(0, 200)}`,
          ),
        );
        return;
      }
      // Parse the last line of stdout (skip the "ready" line)
      const lines = stdout.trim().split("\n");
      const responseLine = lines[lines.length - 1];
      try {
        const result: G4fResponse = JSON.parse(responseLine);
        if (result.ok && result.sse) {
          resolve(result.sse);
        } else {
          reject(new Error(result.error || "g4f error"));
        }
      } catch {
        reject(new Error(`g4f: invalid response. ${stderr.slice(0, 200)}`));
      }
    });

    // Send the request
    try {
      const req = JSON.stringify({ model, messages, stream: true });
      child.stdin?.write(req + "\n");
      child.stdin?.end();
    } catch {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      reject(new Error("Failed to send request to g4f wrapper"));
    }

    // Handle abort
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      reject(new Error("Aborted"));
    });
  });
}

function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

export const g4fProvider: Provider = {
  id: "toolbaz", // unused legacy file

  async complete(req) {
    let text = "";
    for await (const chunk of this.stream(req)) {
      text += chunk;
    }
    return { text };
  },

  async *stream(req) {
    const sseText = await callG4f(
      req.model.upstream,
      req.messages.map((m) => ({ role: m.role, content: m.content })),
      req.signal,
    );
    const lines = sseText.split("\n");
    for (const line of lines) {
      const delta = parseSseLine(line);
      if (delta) yield delta;
    }
  },
};
