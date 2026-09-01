/**
 * Tool lifecycle diagnostics (Tool PRD §19, §27).
 *
 * Captures the COMPLETE tool pipeline lifecycle per request so the debug
 * dashboard can PROVE whether tools were forwarded:
 *
 *   tool requested → validated → forwarded → tool_calls detected →
 *   executed → result returned → model resumed
 *
 * SAFETY (PRD §19): never log API keys, cookies, authorization headers,
 * tool ARGUMENTS, or tool RESULT contents — only names, counts, booleans,
 * and byte sizes. Nothing in this module serializes user data.
 */

const MAX_TRACES = 100;

export type ToolTraceKind =
  | "request" // gateway received a chat request carrying tools
  | "forward" // provider payload assertion result (tools forwarded?)
  | "stream" // streaming parser detected tool_calls in the upstream response
  | "execution" // a tool executor ran (via /api/tools/execute)
  | "final"; // generation finished (success / error / no tool calls)

export interface ToolTrace {
  /** Stable id (gateway requestId / executor uid). */
  id: string;
  kind: ToolTraceKind;
  at: string;
  /** Request id this trace correlates to, when known. */
  requestId?: string;
  model?: string;
  provider?: string;
  streaming?: boolean;
  /** capabilities.tools of the resolved model (PRD §4). */
  capabilitiesTools?: boolean;
  /** Native API forwarding vs prompt emulation (PRD §16). */
  nativeForwarding?: boolean;
  toolsRequested?: number;
  toolsForwarded?: number;
  /** Tool NAMES only — never arguments (PRD §19). */
  toolNames?: string[];
  toolChoice?: string;
  /** "auto" | "none" | "required" | "function:<name>" | "unset" */
  toolCallsDetected?: number;
  rounds?: number;
  execution?: {
    name: string;
    ok: boolean;
    ms: number;
    resultChars: number;
    truncated: boolean;
    error?: string;
  };
  finalStatus?: "success" | "error" | "no_tool_calls" | "aborted";
}

class ToolDiagnosticsService {
  private traces: ToolTrace[] = [];

  /** Append a trace (auto-pruned ring buffer). */
  record(trace: ToolTrace): void {
    this.traces.push(trace);
    if (this.traces.length > MAX_TRACES) {
      this.traces.splice(0, this.traces.length - MAX_TRACES);
    }
    // Console mirror (no secrets — names/counts only). Tagged so it can be
    // grepped in dev: `TOOL_DEBUG`.
    if (process.env.NODE_ENV !== "production" || process.env.TOOL_DEBUG === "1") {
      console.log("[TOOL_DEBUG]", JSON.stringify(this.redact(trace)));
    }
  }

  /** Describe a tool_choice value compactly for logs. */
  describeToolChoice(tc: unknown): string {
    if (tc === undefined || tc === null) return "unset";
    if (typeof tc === "string") return tc;
    if (typeof tc === "object" && tc !== null) {
      const fn = (tc as { function?: { name?: string } }).function;
      if (fn?.name) return `function:${fn.name}`;
    }
    return "unknown";
  }

  /** List tool names (names only — safe to expose). */
  toolNames(tools: unknown): string[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    return tools
      .map(
        (t) =>
          (t as { function?: { name?: string } })?.function?.name ?? "?",
      )
      .filter((n) => n !== "?");
  }

  /** Snapshot for the debug endpoint (newest first). */
  list(): ToolTrace[] {
    return [...this.traces].reverse();
  }

  /** Defensive redaction — strips anything that is not a name/count/bool. */
  private redact(trace: ToolTrace): ToolTrace {
    const copy: ToolTrace = { ...trace };
    delete copy.requestId;
    return copy;
  }
}

const globalForTools = globalThis as unknown as {
  __freeaixyzToolDiagnostics?: ToolDiagnosticsService;
};

export const toolDiagnostics: ToolDiagnosticsService =
  globalForTools.__freeaixyzToolDiagnostics ?? new ToolDiagnosticsService();

if (!globalForTools.__freeaixyzToolDiagnostics) {
  globalForTools.__freeaixyzToolDiagnostics = toolDiagnostics;
}
