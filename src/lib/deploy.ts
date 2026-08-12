// Client-side deployment using Puter.js browser SDK
//
// NO server endpoint needed! Puter.js handles auth automatically via popup
// when any API is called. The entire deploy flow runs in the browser:
//
//   1. puter.fs.mkdir(dirName)           — create site directory
//   2. puter.fs.write(dir/index.html)    — write the HTML
//   3. puter.hosting.create(subdomain)   — first deploy (creates *.puter.site)
//      OR puter.hosting.update(subdomain) — re-deploy to existing site
//   4. Site is live at https://{subdomain}.puter.site
//
// Auth flow:
//   - If user hasn't signed in to Puter, calling any puter.* API
//     automatically opens a sign-in popup.
//   - puter.auth.signIn() can also be called explicitly (e.g. "Connect Puter" button).
//   - puter.auth.isSignedIn() checks status synchronously.

// Type declarations for the Puter.js browser SDK global
declare global {
  interface Window {
    puter: typeof puter
  }
}

// Puter.js SDK types (minimal — just what we use)
interface PuterAuth {
  isSignedIn: () => boolean
  signIn: (options?: { attempt_temp_user_creation?: boolean; request_auth?: boolean }) => Promise<{ success: boolean; username?: string; token?: string; error?: string }>
  getUser: () => Promise<{ uuid: string; username: string }>
  signOut: () => void
}

interface PuterFSItem {
  uid: string
  name: string
  path?: string
  type?: string
}

interface PuterFS {
  write: (path: string, data: string | Blob, options?: { overwrite?: boolean; createMissingParents?: boolean }) => Promise<PuterFSItem>
  mkdir: (path: string, options?: { createMissingParents?: boolean }) => Promise<PuterFSItem>
  read: (path: string) => Promise<Blob>
}

interface PuterSubdomain {
  uid: string
  subdomain: string
  root_dir: PuterFSItem | string
}

interface PuterHosting {
  create: (subdomain: string, dirPath: string) => Promise<PuterSubdomain>
  update: (subdomain: string, dirPath: string) => Promise<PuterSubdomain>
  delete: (subdomain: string) => Promise<{ success: boolean; uid: string }>
  list: () => Promise<PuterSubdomain[]>
  get: (subdomain: string) => Promise<PuterSubdomain>
}

interface PuterSDK {
  auth: PuterAuth
  fs: PuterFS
  hosting: PuterHosting
  randName: (separator?: string) => string
}

// The puter global is loaded via <script src="https://js.puter.com/v2/"></script>
// We declare it as a module-level variable for type safety
const puter: PuterSDK = (typeof window !== 'undefined' && (window as any).puter) as PuterSDK

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployResult {
  url: string
  siteId: string  // The Puter subdomain name
}

export interface PuterAuthStatus {
  isSignedIn: boolean
  username?: string
}

// ---------------------------------------------------------------------------
// Puter auth helpers
// ---------------------------------------------------------------------------

/** Check if user is signed in to Puter (synchronous). */
export function isPuterSignedIn(): boolean {
  if (!puter) return false
  return puter.auth.isSignedIn()
}

/**
 * Sign in to Puter — opens a popup for the user.
 * MUST be called from a user gesture (click) or browsers will block the popup.
 */
export async function puterSignIn(): Promise<PuterAuthStatus> {
  if (!puter) throw new Error('Puter.js SDK not loaded. Add <script src="https://js.puter.com/v2/"></script> to index.html.')

  const result = await puter.auth.signIn()
  if (!result.success) {
    throw new Error(`Puter sign-in failed: ${result.error || 'unknown error'}`)
  }

  const user = await puter.auth.getUser()
  return { isSignedIn: true, username: user.username }
}

/** Get current Puter auth status. */
export async function getPuterAuthStatus(): Promise<PuterAuthStatus> {
  if (!puter) return { isSignedIn: false }

  if (puter.auth.isSignedIn()) {
    try {
      const user = await puter.auth.getUser()
      return { isSignedIn: true, username: user.username }
    } catch {
      return { isSignedIn: false }
    }
  }

  return { isSignedIn: false }
}

/** Sign out of Puter. */
export function puterSignOut(): void {
  if (puter) puter.auth.signOut()
}

// ---------------------------------------------------------------------------
// Slugify — turn a project title into a Puter subdomain name
// ---------------------------------------------------------------------------

function slugifyTitle(title: string | null | undefined): string {
  return (title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

// ---------------------------------------------------------------------------
// Core deploy function
// ---------------------------------------------------------------------------

/**
 * Deploy a static HTML site to Puter.js hosting — entirely in the browser.
 *
 * If the user isn't signed in to Puter, the first API call will automatically
 * trigger a sign-in popup. This function MUST be called from a user gesture
 * (click handler) for the popup to work.
 *
 * @param projectId - OpenThorn project ID (used for directory naming)
 * @param html - The full HTML string to deploy
 * @param existingSiteId - Existing Puter subdomain name (for re-deploys)
 * @param title - Project title (used for readable subdomain naming)
 */
export async function deploySite(
  projectId: string,
  html: string,
  existingSiteId?: string | null,
  title?: string | null,
): Promise<DeployResult> {
  if (!puter) {
    throw new Error(
      'Puter.js SDK not loaded. Add <script src="https://js.puter.com/v2/"></script> to index.html.',
    )
  }

  // If re-deploying to an existing site, we need to find its directory
  if (existingSiteId) {
    try {
      // Try to get the existing site's directory
      const siteInfo = await puter.hosting.get(existingSiteId)
      const dirPath = typeof siteInfo.root_dir === 'string'
        ? siteInfo.root_dir
        : siteInfo.root_dir?.name || existingSiteId

      // Write updated index.html into the existing directory
      await puter.fs.write(`${dirPath}/index.html`, html, { overwrite: true })

      // Update the hosting to point to the same directory (triggers a refresh)
      await puter.hosting.update(existingSiteId, dirPath)

      return {
        url: `https://${existingSiteId}.puter.site`,
        siteId: existingSiteId,
      }
    } catch (err) {
      // If the existing site doesn't exist anymore (deleted on Puter),
      // fall through to create a new one
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
      if (!msg.includes('not found') && !msg.includes('does not exist')) {
        throw err
      }
      // Fall through to create new site
    }
  }

  // --- Create a new site ---

  // 1. Choose a subdomain name
  const base = slugifyTitle(title) || `site-${projectId.slice(0, 8)}`
  let subdomain = base
  let dirName = `openthorn-${base}`

  // 2. Create the site directory
  await puter.fs.mkdir(dirName, { createMissingParents: true })

  // 3. Write index.html + SPA _redirects
  await puter.fs.write(`${dirName}/index.html`, html, { overwrite: true })

  // 4. Try to create the hosted subdomain (may fail if name taken)
  let site: PuterSubdomain
  try {
    site = await puter.hosting.create(subdomain, dirName)
  } catch (err) {
    // Subdomain name taken — try numbered variants, then random
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
    if (
      msg.includes('already exists') ||
      msg.includes('already in use') ||
      msg.includes('taken') ||
      msg.includes('not available')
    ) {
      // Try numbered suffixes: base-2, base-3, ...
      let created = false
      for (let i = 2; i <= 6; i++) {
        try {
          subdomain = `${base}-${i}`
          dirName = `openthorn-${subdomain}`
          await puter.fs.mkdir(dirName, { createMissingParents: true })
          await puter.fs.write(`${dirName}/index.html`, html, { overwrite: true })
          site = await puter.hosting.create(subdomain, dirName)
          created = true
          break
        } catch {
          continue
        }
      }

      // Last resort: use a random Puter-safe name
      if (!created) {
        subdomain = puter.randName()
        dirName = `openthorn-${subdomain}`
        await puter.fs.mkdir(dirName, { createMissingParents: true })
        await puter.fs.write(`${dirName}/index.html`, html, { overwrite: true })
        site = await puter.hosting.create(subdomain, dirName)
      }
    } else {
      throw err
    }
  }

  return {
    url: `https://${site.subdomain}.puter.site`,
    siteId: site.subdomain,
  }
}

// ---------------------------------------------------------------------------
// List existing Puter-hosted sites
// ---------------------------------------------------------------------------

/** List all Puter-hosted subdomains for the current user. */
export async function listPutterSites(): Promise<PuterSubdomain[]> {
  if (!puter) return []
  try {
    return await puter.hosting.list()
  } catch {
    return []
  }
}

/** Delete a Puter-hosted site (just unlinks the subdomain; files remain). */
export async function deletePutterSite(subdomain: string): Promise<void> {
  if (!puter) throw new Error('Puter.js SDK not loaded.')
  await puter.hosting.delete(subdomain)
}
