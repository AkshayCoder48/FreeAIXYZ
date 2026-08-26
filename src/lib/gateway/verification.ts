/**
 * Model verification service (PRD §36-39, §77, §78, §175, §176).
 *
 * Sends a fixed minimal test prompt ("Reply with: ok") to a model and
 * verifies the response. Used for degraded-model recovery (PRD §78) and
 * on-demand checks. Image models are skipped (too expensive — PRD §77).
 * NOT run on every startup — only on-demand or periodic for degraded
 * models (PRD §78). Results are cached in a VerificationRun row.
 */

import { db } from "@/lib/db";
import { catalogStore } from "@/lib/gateway/catalog";
import { providerHealthService } from "@/lib/gateway/health";
import { providerRegistry } from "@/lib/gateway/registry";
import type { ChatRequest } from "@/lib/gateway/types";

const VERIFY_PROMPT = "Reply with: ok"; // PRD §176 — fixed, no user data
const VERIFY_TIMEOUT_MS = 30_000;
const CONCURRENCY_LIMIT = 2; // PRD §77
const MODEL_DEGRADED_FAILURES_THRESHOLD = 2;
const MODEL_OFFLINE_FAILURES_THRESHOLD = 5;

export interface VerifyResult {
  text: string; // PASS|FAIL|N/A
  stream: string; // PASS|FAIL|N/A
  image: string; // PASS|FAIL|N/A
  status: string; // verified|failed|skipped
  latencyMs?: number;
  error?: string;
}

class ModelVerificationService {
  /**
   * Verify a single model (PRD §36, §176). For text models: tests
   * non-stream complete + stream. Image models: skipped (PRD §77).
   */
  async verifyModel(publicId: string): Promise<VerifyResult> {
    const model = catalogStore.getModel(publicId);
    const adapter = model ? providerRegistry.get(model.providerId) : undefined;
    if (!model || !adapter) {
      return resultNA("model or adapter not found");
    }
    if (model.capabilities.image) {
      const r: VerifyResult = {
        text: "N/A",
        stream: "N/A",
        image: "SKIP",
        status: "skipped",
      };
      await this.persistRun(publicId, r).catch(() => {});
      return r;
    }
    const req: ChatRequest = {
      modelId: model.id,
      upstreamId: model.upstreamId,
      messages: [{ role: "user", content: VERIFY_PROMPT }],
      stream: false,
      temperature: 0,
      maxTokens: 16,
    };
    const startedAt = Date.now();

    // Non-stream test.
    let textStatus = "FAIL";
    let textErr: string | undefined;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
      const res = await adapter.complete({ ...req, signal: controller.signal });
      clearTimeout(timer);
      textStatus = res.text && res.text.trim().length > 0 ? "PASS" : "FAIL";
    } catch (err) {
      textErr = err instanceof Error ? err.message : String(err);
    }

    // Stream test (first-chunk + chunk-count).
    let streamStatus = "FAIL";
    let streamErr: string | undefined;
    let chunkCount = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
      for await (const _delta of adapter.stream({
        ...req,
        stream: true,
        signal: controller.signal,
      })) {
        chunkCount += 1;
      }
      clearTimeout(timer);
      streamStatus = chunkCount > 0 ? "PASS" : "FAIL";
    } catch (err) {
      streamErr = err instanceof Error ? err.message : String(err);
    }

    const latencyMs = Date.now() - startedAt;
    const ok =
      textStatus === "PASS" &&
      (streamStatus === "PASS" || streamStatus === "N/A");
    const r: VerifyResult = {
      text: textStatus,
      stream: streamStatus,
      image: "N/A",
      status: ok ? "verified" : "failed",
      latencyMs,
      error: textErr ?? streamErr,
    };

    // Update health + catalog (PRD §78).
    if (ok) {
      providerHealthService.recordModelSuccess(publicId);
    } else {
      providerHealthService.recordModelFailure(
        publicId,
        new Error(r.error ?? "verify failed"),
      );
    }
    await this.persistRun(publicId, r).catch((err) =>
      console.error(`[gateway.verification] persist ${publicId}:`, err),
    );
    return r;
  }

  /** Batch-verify a provider's models with concurrency limit (PRD §77). */
  async verifyProviderModels(providerId: string): Promise<VerifyResult[]> {
    const models = catalogStore.getProviderModels(providerId);
    const results: VerifyResult[] = [];
    const queue = [...models];
    const workers = Array.from({ length: CONCURRENCY_LIMIT }, async () => {
      while (queue.length > 0) {
        const m = queue.shift();
        if (!m) break;
        try {
          results.push(await this.verifyModel(m.id));
        } catch (err) {
          results.push(
            resultNA(err instanceof Error ? err.message : String(err)),
          );
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /** Persist a VerificationRun row (PRD §82). */
  private async persistRun(
    publicId: string,
    r: VerifyResult,
  ): Promise<void> {
    try {
      // VerificationRun.modelId references ProviderModel.id (cuid), not publicId.
      const row = await db.providerModel.findUnique({
        where: { publicId },
      });
      if (!row) return;
      await db.verificationRun.create({
        data: {
          modelId: row.id,
          finishedAt: new Date(),
          text: r.text,
          stream: r.stream,
          image: r.image,
          status: r.status,
          latencyMs: r.latencyMs ?? null,
          error: r.error ?? null,
        },
      });
    } catch (err) {
      console.error(`[gateway.verification] persistRun ${publicId}:`, err);
    }
  }
}

function resultNA(error: string): VerifyResult {
  return {
    text: "N/A",
    stream: "N/A",
    image: "N/A",
    status: "skipped",
    error,
  };
}

// Re-export thresholds (kept here so they're not inlined elsewhere).
export const VERIFICATION_THRESHOLDS = {
  degraded: MODEL_DEGRADED_FAILURES_THRESHOLD,
  offline: MODEL_OFFLINE_FAILURES_THRESHOLD,
} as const;

// globalThis-backed singleton (see catalog.ts / registry.ts for the pattern).
const globalForVerification = globalThis as unknown as {
  __freeaixyzModelVerificationService?: ModelVerificationService;
};

export const modelVerificationService: ModelVerificationService =
  globalForVerification.__freeaixyzModelVerificationService ??
  new ModelVerificationService();

if (!globalForVerification.__freeaixyzModelVerificationService) {
  globalForVerification.__freeaixyzModelVerificationService = modelVerificationService;
}
