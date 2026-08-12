// Deploy endpoint — DEPRECATED / NO-OP
//
// Deploy is now fully client-side via the Puter.js browser SDK.
// The browser calls puter.fs.write() + puter.hosting.create/update() directly.
// No server round-trip is needed.
//
// This file is kept as a stub to avoid breaking any existing fetch('/api/deploy')
// calls during the transition. It returns a message directing the client
// to use the browser SDK instead.
import { verifyUser, rateLimit } from './_shared.js'

interface VercelReq {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}
interface VercelRes {
  status: (code: number) => VercelRes
  json: (body: unknown) => void
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  res.status(410).json({
    error: 'Server-side deploy is deprecated. Use the Puter.js browser SDK (puter.hosting) directly from the client.',
  })
}
