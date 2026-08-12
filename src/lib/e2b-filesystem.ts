// E2B Sandbox client — frontend interface for E2B-based filesystem & runtime execution
//
// This module provides a client-side API for interacting with E2B sandboxes
// through the serverless hand-off architecture:
//
//   [Browser] → POST /api/e2b-sandbox → [Vercel Function] → [E2B Cloud Sandbox]
//
// Key features:
// - Create/close sandboxes
// - Execute commands (foreground or background/autonomous)
// - Filesystem operations (read, write, list, remove, mkdir)
// - Background execution returns 202 immediately — sandbox runs even if user closes tab
// - Results stored in Supabase, pollable via pollBackgroundResult()
import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  sandboxId: string
}

export interface SandboxFileEntry {
  name: string
  type: 'file' | 'dir'
  path?: string
}

export interface BackgroundResult {
  id: string
  sandbox_id: string
  command: string
  result: SandboxExecutionResult | null
  status: 'pending' | 'completed' | 'failed'
  created_at: string
}

// ---------------------------------------------------------------------------
// Internal helper — authenticated POST to /api/e2b-sandbox
// ---------------------------------------------------------------------------

async function sandboxPost<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('You must be signed in to use sandboxes.')

  const res = await fetch('/api/e2b-sandbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText)
    throw new Error(`Sandbox error: ${errBody || res.statusText}`)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Sandbox lifecycle
// ---------------------------------------------------------------------------

/** Create a new E2B sandbox. Returns the sandbox ID for subsequent operations. */
export async function createSandbox(): Promise<string> {
  const data = await sandboxPost<{ sandboxId: string }>({ action: 'create' })
  return data.sandboxId
}

/** Close an E2B sandbox and release its resources. */
export async function closeSandbox(sandboxId: string): Promise<void> {
  await sandboxPost({ action: 'close', sandboxId })
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Execute a command in an E2B sandbox (foreground).
 * Waits for the result and returns stdout, stderr, exitCode.
 *
 * @param sandboxId - The sandbox to run the command in
 * @param command - The shell command to execute
 * @param timeoutMs - Optional timeout (server default: 5 minutes)
 */
export async function executeCommand(
  sandboxId: string,
  command: string,
  timeoutMs?: number,
): Promise<SandboxExecutionResult> {
  return sandboxPost<SandboxExecutionResult>({
    action: 'execute',
    sandboxId,
    command,
    background: false,
    timeoutMs,
  })
}

/**
 * Execute a command in an E2B sandbox in the BACKGROUND.
 * Returns immediately with 202 — the sandbox runs autonomously in the cloud.
 * The user can safely close their browser; the sandbox keeps running.
 *
 * Results are stored in Supabase (sandbox_results table) and can be polled
 * with pollBackgroundResult(). Optionally receives a Firebase push notification
 * when the execution completes.
 *
 * @param sandboxId - The sandbox to run the command in
 * @param command - The shell command to execute
 * @param userFcmToken - Optional Firebase Cloud Messaging token for push notification
 */
export async function executeBackground(
  sandboxId: string,
  command: string,
  userFcmToken?: string,
): Promise<{ status: string }> {
  return sandboxPost<{ status: string }>({
    action: 'execute',
    sandboxId,
    command,
    background: true,
    userFcmToken,
  })
}

/**
 * Poll Supabase for the result of a background sandbox execution.
 *
 * @param sandboxId - The sandbox ID to check
 * @param maxAttempts - Maximum number of polling attempts (default: 60)
 * @param intervalMs - Milliseconds between polls (default: 5000)
 */
export async function pollBackgroundResult(
  sandboxId: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<BackgroundResult | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const { data, error } = await supabase
      .from('sandbox_results')
      .select('*')
      .eq('sandbox_id', sandboxId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.warn('Poll error:', error)
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }

    if (data && data.length > 0) {
      const row = data[0] as BackgroundResult
      if (row.status === 'completed' || row.status === 'failed') {
        return row
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  return null // Timed out
}

// ---------------------------------------------------------------------------
// Filesystem operations
// ---------------------------------------------------------------------------

/** Read a file from the sandbox's filesystem. */
export async function sandboxReadFile(sandboxId: string, path: string): Promise<string> {
  const data = await sandboxPost<{ content: string }>({
    action: 'filesystem',
    sandboxId,
    fsAction: 'read',
    path,
  })
  return data.content
}

/** Write a file to the sandbox's filesystem. */
export async function sandboxWriteFile(sandboxId: string, path: string, content: string): Promise<void> {
  await sandboxPost({ action: 'filesystem', sandboxId, fsAction: 'write', path, content })
}

/** List files/directories at a path in the sandbox. */
export async function sandboxListDir(sandboxId: string, path: string): Promise<SandboxFileEntry[]> {
  const data = await sandboxPost<{ entries: SandboxFileEntry[] }>({
    action: 'filesystem',
    sandboxId,
    fsAction: 'list',
    path,
  })
  return data.entries
}

/** Remove a file or directory from the sandbox. */
export async function sandboxRemove(sandboxId: string, path: string): Promise<void> {
  await sandboxPost({ action: 'filesystem', sandboxId, fsAction: 'remove', path })
}

/** Create a directory in the sandbox. */
export async function sandboxMakeDir(sandboxId: string, path: string): Promise<void> {
  await sandboxPost({ action: 'filesystem', sandboxId, fsAction: 'mkdir', path })
}

// ---------------------------------------------------------------------------
// High-level convenience: Full project execution
// ---------------------------------------------------------------------------

/**
 * Deploy and execute a full project in an E2B sandbox.
 *
 * This is the primary high-level API for the "serverless hand-off" architecture.
 * It:
 * 1. Creates a new sandbox (or reuses one)
 * 2. Writes all project files into the sandbox filesystem
 * 3. Installs dependencies (npm install)
 * 4. Runs the project (npm start / npm run dev)
 * 5. Returns the sandbox ID so the user can poll for results
 *
 * The entire process runs in the cloud — the user can close their browser.
 */
export async function deployProjectToSandbox(
  files: Array<{ path: string; content: string }>,
  options?: {
    sandboxId?: string
    installCmd?: string
    startCmd?: string
    userFcmToken?: string
  },
): Promise<{ sandboxId: string; status: string }> {
  // 1. Create or reuse sandbox
  const sandboxId = options?.sandboxId || (await createSandbox())

  // 2. Write all project files
  for (const file of files) {
    await sandboxWriteFile(sandboxId, file.path, file.content)
  }

  // 3. Install dependencies (background)
  const installCmd = options?.installCmd || 'npm install'
  await executeBackground(sandboxId, installCmd, options?.userFcmToken)

  // 4. Start the project (background)
  const startCmd = options?.startCmd || 'npm start'
  await executeBackground(sandboxId, startCmd, options?.userFcmToken)

  return { sandboxId, status: 'detached' }
}
