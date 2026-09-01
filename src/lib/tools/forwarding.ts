/**
 * Silent tool-loss detection (Tool PRD §20).
 *
 * One assertion, called by EVERY native-tools provider adapter right
 * before the upstream fetch:
 *
 *   if (tools.length > 0) assert(providerPayload.tools.length === tools.length)
 *
 * If tools disappear between the ChatRequest and the serialized provider
 * payload, a TOOL_FORWARDING_ERROR is thrown — the bug becomes
 * immediately visible during development instead of manifesting as the
 * model claiming "I don't have access to tools".
 */

import { toolDiagnostics } from "@/lib/tools/diagnostics";
import { GatewayError } from "@/lib/gateway/errors";

/**
 * Assert that the tools survived into the provider payload.
 *
 * @param payload   The exact object that will be JSON.stringify'd and sent
 *                  to the provider.
 * @param tools     The tools from the ChatRequest (undefined = none requested).
 * @param provider  Provider id (for diagnostics + the error envelope).
 * @param model     Model id (for the error envelope).
 */
export function assertToolsForwarded(
  payload: Record<string, unknown>,
  tools: unknown[] | undefined,
  provider: string,
  model?: string,
): void {
  const requested = Array.isArray(tools) ? tools.length : 0;
  if (requested === 0) return; // nothing to lose
  const forwarded = Array.isArray(payload.tools) ? payload.tools.length : 0;
  toolDiagnostics.record({
    id: `fwd-${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "forward",
    at: new Date().toISOString(),
    provider,
    model,
    toolsRequested: requested,
    toolsForwarded: forwarded,
    nativeForwarding: true,
    toolNames: toolDiagnostics.toolNames(tools),
  });
  if (forwarded !== requested) {
    throw new GatewayError({
      type: "TOOL_FORWARDING_ERROR",
      message: `Tools were dropped before reaching the provider payload: requested ${requested}, forwarded ${forwarded} (provider "${provider}").`,
      provider,
      model,
    });
  }
}

/**
 * Apply the OpenAI tool params to a provider payload, preserving every
 * field the upstream supports (PRD §5 — never blindly strip):
 *
 *   tools                — forwarded verbatim when non-empty
 *   tool_choice          — string OR forced-function object, default "auto"
 *   parallel_tool_calls  — forwarded when explicitly set
 *
 * Then runs the §20 forwarding assertion.
 */
export function applyToolParamsToPayload(
  payload: Record<string, unknown>,
  tools: unknown[] | undefined,
  toolChoice: unknown,
  parallelToolCalls: boolean | undefined,
  provider: string,
  model?: string,
): Record<string, unknown> {
  if (Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = toolChoice ?? "auto";
  }
  if (parallelToolCalls !== undefined) {
    payload.parallel_tool_calls = parallelToolCalls;
  }
  assertToolsForwarded(payload, tools, provider, model);
  return payload;
}
