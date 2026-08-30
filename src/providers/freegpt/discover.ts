/**
 * FreeGPT discoverer — `https://freegpt.tech/api/openai/oneapi/v1/models`
 * is behind a Cloudflare TLS fingerprinting + WASM proof-of-work challenge.
 *
 * Plain `fetch()` returns 403. We attempt a `curl`-based GET with challenge
 * headers; if the WASM signature is also required, we get 403 and fall
 * back to the legacy MODELS[] entries for freegpt.
 *
 * Never throws — returns the static list on any failure (PRD §27).
 */
import { manualModels } from "../_shared";
import { MODELS } from "@/lib/providers/registry";
import type { ProviderModel } from "../types";

const URL = "https://freegpt.tech/api/openai/oneapi/v1/models";
const STATUS_MARKER = "__HTTP_STATUS__";

const HEADERS = [
  "-H",
  "Accept: application/json",
  "-H",
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "-H",
  "Referer: https://freegpt.tech/",
  "-H",
  "Accept-Language: en-US,en;q=0.9",
  "-H",
  "x-origin: https://freegpt.tech",
];

async function curlGet(): Promise<{ status: number; body: string }> {
  const cp = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = cp.spawn(
      "curl",
      ["-s", "-S", "--max-time", "10", "-w", `\n${STATUS_MARKER}%{http_code}`, ...HEADERS, URL],
      { timeout: 12_000 },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => {
      const idx = stdout.lastIndexOf(STATUS_MARKER);
      if (idx >= 0) {
        const statusStr = stdout.slice(idx + STATUS_MARKER.length).trim();
        resolve({ status: parseInt(statusStr, 10) || 0, body: stdout.slice(0, idx) });
      } else {
        resolve({ status: 0, body: stdout });
      }
    });
    proc.on("error", () => resolve({ status: 0, body: stderr }));
  });
}

export async function discover(): Promise<ProviderModel[]> {
  try {
    const { status, body } = await curlGet();
    if (status === 200 && body) {
      const data = JSON.parse(body) as { data?: { id?: string }[]; models?: { id?: string }[] };
      const items = data.data ?? data.models ?? [];
      const out: ProviderModel[] = [];
      const seen = new Set<string>();
      for (const it of items) {
        const id = it?.id;
        if (!id || typeof id !== "string" || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, name: id, raw: { ...it, source: "live-freegpt" } });
      }
      if (out.length > 0) return out;
    }
    console.log(
      `[MODEL_SYNC] freegpt returned HTTP ${status || "?"} — using MODELS[] fallback`,
    );
  } catch (err) {
    console.log(
      "[MODEL_SYNC] freegpt live fetch failed — using MODELS[] fallback:",
      err instanceof Error ? err.message : err,
    );
  }
  // MODELS[] fallback — only text (not text-to-image) entries for freegpt.
  const ids: string[] = [];
  for (const m of MODELS) {
    if (m.provider !== "freegpt") continue;
    if (m.modality === "text-to-image") continue;
    ids.push(m.upstream);
  }
  return manualModels(ids, { source: "manual-fallback", endpoint: URL });
}
