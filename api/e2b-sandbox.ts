// E2B Sandbox endpoint — serverless hand-off architecture
//
// This endpoint implements the "Free 24/7 E2B Orchestration Stack":
//   [Browser] → POST /api/e2b-sandbox → [This Vercel Function]
//     → Spawns E2B Sandbox in the cloud (independent of user's device)
//     → Returns 202 immediately (user can close browser)
//     → Sandbox runs autonomously, writes results to Supabase
//     → (Optional) Firebase push notification alerts the user
//
// Supports two action types:
//   'execute'  — Run a command in the sandbox (e.g., python3, npm, node)
//   'filesystem' — Read/write/list files in the sandbox's filesystem
import { verifyUser, rateLimit, getE2BConfig, hasE2BConfig } from './_shared.js'

interface VercelReq {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}
interface VercelRes {
  status: (code: number) => VercelRes
  json: (body: unknown) => void
}

function header(req: VercelReq, name: string): string | undefined {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

function parseBody(body: unknown) {
  if (!body) return {}
  if (typeof body === 'string') {
    try { return JSON.parse(body) } catch { return {} }
  }
  return body as Record<string, never>
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!hasE2BConfig()) {
    res.status(503).json({ error: 'E2B sandbox not configured. Set E2B_API_KEY.' })
    return
  }

  const authorization = header(req, 'authorization')
  const user = await verifyUser(authorization)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (!(await rateLimit(`e2b:${user.id}`, 30, 60_000))) {
    res.status(429).json({ error: 'Too many sandbox requests. Please wait and try again.' })
    return
  }

  const body = parseBody(req.body)
  const action = body.action as string | undefined

  if (action === 'execute') {
    // Execute a command in an E2B sandbox
    const { command, sandboxId, background, userFcmToken } = body as {
      command?: string
      sandboxId?: string
      background?: boolean
      userFcmToken?: string
    }

    if (!command) {
      res.status(400).json({ error: 'Missing command' })
      return
    }

    // For background execution: return 202 immediately, run in the cloud
    if (background) {
      process.nextTick(async () => {
        try {
          const config = getE2BConfig()!
          // Dynamic import of E2B SDK (only when configured)
          const { Sandbox } = await import('@e2b/code-interpreter')

          const sb = sandboxId
            ? await Sandbox.connect(sandboxId)
            : await Sandbox.create({ apiKey: config.apiKey, template: config.template })

          const execution = await (sb as any).commands.run(command, { timeoutMs: config.timeoutMs })
          const result = {
            stdout: execution.stdout,
            stderr: execution.stderr,
            exitCode: execution.exitCode,
            sandboxId: (sb as any).sandboxId,
          }

          // Store result in Supabase for the client to poll
          const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
          const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (supabaseUrl && serviceKey) {
            await fetch(`${supabaseUrl}/rest/v1/sandbox_results`, {
              method: 'POST',
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({
                user_id: user.id,
                sandbox_id: sb.sandboxId,
                command,
                result: JSON.stringify(result),
                status: 'completed',
              }),
            })
          }

          // Optional: Send Firebase push notification
          if (userFcmToken && process.env.FIREBASE_PROJECT_ID) {
            try {
              const { default: admin } = await import('firebase-admin') as any
              if (!admin.apps.length) {
                admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY!)) })
              }
              await admin.messaging().send({
                token: userFcmToken,
                notification: {
                  title: 'E2B Sandbox Completed',
                  body: result.stdout?.slice(0, 200) || 'Command finished.',
                },
              })
            } catch (e) {
              console.warn('Firebase push failed:', e)
            }
          }

          await (sb as any).close()
        } catch (error) {
          console.error('Background E2B execution error:', error)
        }
      })

      // Return immediately — the sandbox is running autonomously
      res.status(202).json({ status: 'Sandbox execution detached to cloud background' })
      return
    }

    // Foreground execution: wait for result
    try {
      const config = getE2BConfig()!
      const { Sandbox } = await import('@e2b/code-interpreter')

      const sb = sandboxId
        ? await Sandbox.connect(sandboxId)
        : await Sandbox.create({ apiKey: config.apiKey, template: config.template })

      const execution = await (sb as any).commands.run(command, { timeoutMs: config.timeoutMs })

      res.status(200).json({
        stdout: execution.stdout,
        stderr: execution.stderr,
        exitCode: execution.exitCode,
        sandboxId: (sb as any).sandboxId,
      })

      // Don't close the sandbox if the client might reuse it
      // The client should explicitly close it via action='close'
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sandbox execution failed' })
    }
    return
  }

  if (action === 'filesystem') {
    // Filesystem operations on an E2B sandbox
    const { sandboxId, fsAction, path: filePath, content } = body as {
      sandboxId?: string
      fsAction?: 'read' | 'write' | 'list' | 'remove' | 'mkdir'
      path?: string
      content?: string
    }

    if (!sandboxId || !fsAction || !filePath) {
      res.status(400).json({ error: 'Missing sandboxId, fsAction, or path' })
      return
    }

    try {
      const config = getE2BConfig()!
      const { Sandbox } = await import('@e2b/code-interpreter')

      const sb = await Sandbox.connect(sandboxId) as any

      if (fsAction === 'write') {
        if (!content) {
          res.status(400).json({ error: 'Missing content for write operation' })
          return
        }
        await sb.filesystem.write(filePath, content)
        res.status(200).json({ ok: true })
      } else if (fsAction === 'read') {
        const fileContent = await sb.filesystem.read(filePath)
        res.status(200).json({ content: fileContent })
      } else if (fsAction === 'list') {
        const entries = await sb.filesystem.list(filePath)
        res.status(200).json({ entries })
      } else if (fsAction === 'remove') {
        await sb.filesystem.remove(filePath)
        res.status(200).json({ ok: true })
      } else if (fsAction === 'mkdir') {
        await sb.filesystem.makeDir(filePath)
        res.status(200).json({ ok: true })
      } else {
        res.status(400).json({ error: `Unknown fsAction: ${fsAction}` })
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Filesystem operation failed' })
    }
    return
  }

  if (action === 'create') {
    // Create a new sandbox
    try {
      const config = getE2BConfig()!
      const { Sandbox } = await import('@e2b/code-interpreter')

      const sb = await Sandbox.create({ apiKey: config.apiKey, template: config.template }) as any
      res.status(200).json({ sandboxId: sb.sandboxId })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create sandbox' })
    }
    return
  }

  if (action === 'close') {
    // Close an existing sandbox
    const { sandboxId } = body as { sandboxId?: string }
    if (!sandboxId) {
      res.status(400).json({ error: 'Missing sandboxId' })
      return
    }
    try {
      const { Sandbox } = await import('@e2b/code-interpreter')
      const sb = await Sandbox.connect(sandboxId) as any
      await sb.close()
      res.status(200).json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to close sandbox' })
    }
    return
  }

  res.status(400).json({ error: 'Unknown action. Use: execute, filesystem, create, close' })
}
