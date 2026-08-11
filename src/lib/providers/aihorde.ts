/**
 * AI Horde image generation provider.
 *
 * AI Horde (https://aihorde.net) is a crowdsourced distributed cluster of
 * GPUs running community Stable Diffusion / SDXL / Flux models. Anonymous
 * access is permitted using the magic API key "0000000000" — no signup,
 * no account, no payment. 161+ community models are available across all
 * style families (anime, realism, NSFW anime, NSFW realism, mixed/artistic).
 *
 * Flow (async, submit → poll → fetch):
 *   1. POST https://stablehorde.net/api/v2/generate/async
 *      Headers: apikey: 0000000000, Client-Agent: freeaixyz:1.0:web
 *      Body: { prompt, params:{n,width,height,steps,cfg_scale,sampler_name}, models:[<name>], nsfw:true }
 *      Returns: { id, kudos }
 *   2. GET  https://stablehorde.net/api/v2/generate/check/{id}  (lightweight poll)
 *      Returns: { done, queue_position, wait_time, finished, processing, waiting }
 *   3. GET  https://stablehorde.net/api/v2/generate/status/{id}  (final, when done:true)
 *      Returns: { generations:[{ img, seed, model, state, censored }], done }
 *      `img` is a signed Cloudflare R2 URL to a .webp file.
 *
 * Anonymous concurrency limit is 500 (very generous); the queue position
 * determines wait time. Typical waits are 30s–3min; can spike to 10–15min
 * under heavy load.
 *
 * A registered API key (env AIHORDE_API_KEY) gives higher priority and
 * is used automatically when present.
 */

// NOTE: AI Horde is an image-only provider. It does NOT implement the chat
// Provider interface and is NOT registered in the chat provider map. Image
// generation goes exclusively through /api/v1/image/generate, which calls
// the generateImage() helper exported below.

const HORDE_BASE = "https://stablehorde.net/api/v2";
const ANON_API_KEY = "0000000000";
const CLIENT_AGENT = "freeaixyz:1.0:web";
const MAX_POLL_MS = 8 * 60 * 1000; // 8 min cap on polling
const POLL_INTERVAL_MS = 4000;

interface HordeSubmitResponse {
  id?: string;
  kudos?: number;
  message?: string;
}

interface HordeCheckResponse {
  done?: boolean;
  finished?: number;
  processing?: number;
  waiting?: number;
  queue_position?: number;
  wait_time?: number;
  replayed?: number;
}

interface HordeGeneration {
  img: string;
  seed?: string;
  model?: string;
  state?: string;
  censored?: boolean;
}

interface HordeStatusResponse {
  done?: boolean;
  generations?: HordeGeneration[];
  kudos?: number;
  faulted?: boolean;
}

function apiKey(): string {
  const envKey = process.env.AIHORDE_API_KEY;
  return envKey && envKey.trim().length > 10 ? envKey.trim() : ANON_API_KEY;
}

function hordeHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    apikey: apiKey(),
    "Client-Agent": CLIENT_AGENT,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Submit an async image generation job. Returns the job id. */
export async function submitHordeJob(opts: {
  prompt: string;
  model: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  nsfw?: boolean;
  negativePrompt?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const body = {
    prompt: opts.prompt,
    params: {
      n: 1,
      width: opts.width,
      height: opts.height,
      steps: opts.steps ?? 30,
      cfg_scale: opts.cfgScale ?? 7,
      sampler_name: "k_euler",
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    },
    models: [opts.model],
    nsfw: opts.nsfw ?? true,
    trusted_workers: false,
    slow_workers: true,
  };

  const res = await fetch(`${HORDE_BASE}/generate/async`, {
    method: "POST",
    headers: hordeHeaders(),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`AI Horde submit failed (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as HordeSubmitResponse;
  if (!data.id) {
    throw new Error(`AI Horde did not return a job id: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.id;
}

/** Poll until the job is done, then fetch the final status. Returns the image URL. */
export async function waitForHordeJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<{ imageUrl: string; seed?: string; model?: string; censored?: boolean }> {
  const deadline = Date.now() + MAX_POLL_MS;
  let lastPosition: number | undefined;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted");

    // Lightweight check first
    const checkRes = await fetch(`${HORDE_BASE}/generate/check/${jobId}`, {
      headers: hordeHeaders(),
      signal,
    });
    if (!checkRes.ok) {
      const txt = await checkRes.text().catch(() => "");
      throw new Error(`AI Horde poll failed (HTTP ${checkRes.status}): ${txt.slice(0, 200)}`);
    }
    const check = (await checkRes.json()) as HordeCheckResponse;
    lastPosition = check.queue_position;

    if (check.done) {
      // Fetch the full status with the image URL
      const statusRes = await fetch(`${HORDE_BASE}/generate/status/${jobId}`, {
        headers: hordeHeaders(),
        signal,
      });
      if (!statusRes.ok) {
        const txt = await statusRes.text().catch(() => "");
        throw new Error(`AI Horde status failed (HTTP ${statusRes.status}): ${txt.slice(0, 200)}`);
      }
      const status = (await statusRes.json()) as HordeStatusResponse;
      if (status.faulted) {
        throw new Error("AI Horde job faulted (worker error). Try again.");
      }
      const gen = status.generations?.[0];
      if (!gen || !gen.img) {
        throw new Error("AI Horde returned no image");
      }
      if (gen.censored) {
        // Still return the URL — the worker censors per its config, we surface it
        // so the caller can decide.
      }
      return {
        imageUrl: gen.img,
        seed: gen.seed,
        model: gen.model,
        censored: gen.censored,
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `AI Horde job timed out after ${MAX_POLL_MS / 1000}s${
      lastPosition !== undefined ? ` (last queue position: ${lastPosition})` : ""
    }. The free anon tier can be slow under load — retry.`,
  );
}

/**
 * High-level helper used by /api/v1/image/generate.
 * Returns the final image URL (a signed Cloudflare R2 .webp link).
 */
export async function generateImage(opts: {
  prompt: string;
  model: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  nsfw?: boolean;
  negativePrompt?: string;
  signal?: AbortSignal;
}): Promise<{
  imageUrl: string;
  seed?: string;
  model?: string;
  censored?: boolean;
  queueNote?: string;
}> {
  const width = opts.width ?? 512;
  const height = opts.height ?? 768;
  const jobId = await submitHordeJob({
    prompt: opts.prompt,
    model: opts.model,
    width,
    height,
    steps: opts.steps,
    cfgScale: opts.cfgScale,
    nsfw: opts.nsfw,
    negativePrompt: opts.negativePrompt,
    signal: opts.signal,
  });
  const result = await waitForHordeJob(jobId, opts.signal);
  return result;
}

/**
 * Fetch the live list of models currently served by the horde.
 * GET /api/v2/status/models → [{ name, count, jobs, eta, performance }]
 */
export async function fetchHordeModels(): Promise<
  { name: string; count: number; jobs: number; eta: number; performance: number }[]
> {
  const res = await fetch(`${HORDE_BASE}/status/models`, {
    headers: { "Client-Agent": CLIENT_AGENT },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`AI Horde models list failed (HTTP ${res.status})`);
  }
  return res.json();
}
