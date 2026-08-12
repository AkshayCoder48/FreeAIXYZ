import { describe, expect, it, vi } from 'vitest'

// Mock the Puter.js browser SDK global
const mockHostingCreate = vi.fn()
const mockHostingUpdate = vi.fn()
const mockHostingGet = vi.fn()
const mockFsWrite = vi.fn()
const mockFsMkdir = vi.fn()
const mockAuthIsSignedIn = vi.fn().mockReturnValue(true)
const mockAuthGetUser = vi.fn().mockResolvedValue({ uuid: 'test-uuid', username: 'testuser' })

vi.stubGlobal('puter', {
  auth: {
    isSignedIn: mockAuthIsSignedIn,
    signIn: vi.fn().mockResolvedValue({ success: true, username: 'testuser' }),
    getUser: mockAuthGetUser,
    signOut: vi.fn(),
  },
  fs: {
    write: mockFsWrite,
    mkdir: mockFsMkdir,
    read: vi.fn(),
  },
  hosting: {
    create: mockHostingCreate,
    update: mockHostingUpdate,
    get: mockHostingGet,
    delete: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  },
  randName: vi.fn().mockReturnValue('happy-river-4281'),
})

describe('deploySite (Puter.js browser SDK)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockHostingCreate.mockReset()
    mockHostingUpdate.mockReset()
    mockHostingGet.mockReset()
    mockFsWrite.mockReset()
    mockFsMkdir.mockReset()
  })

  it('creates a new site via Puter.js browser SDK', async () => {
    mockFsMkdir.mockResolvedValue({ uid: 'dir-1', name: 'openthorn-my-site' })
    mockFsWrite.mockResolvedValue({ uid: 'file-1', name: 'index.html' })
    mockHostingCreate.mockResolvedValue({
      uid: 'site-1',
      subdomain: 'my-site',
      root_dir: { uid: 'dir-1', name: 'openthorn-my-site' },
    })

    const { deploySite } = await import('../deploy')
    const result = await deploySite('project-1234', '<html>Hello</html>', null, 'My Site')

    expect(result).toEqual({
      url: 'https://my-site.puter.site',
      siteId: 'my-site',
    })
    expect(mockFsMkdir).toHaveBeenCalledWith('openthorn-my-site', { createMissingParents: true })
    expect(mockFsWrite).toHaveBeenCalledWith('openthorn-my-site/index.html', '<html>Hello</html>', { overwrite: true })
    expect(mockHostingCreate).toHaveBeenCalledWith('my-site', 'openthorn-my-site')
  })

  it('re-deploys to an existing Puter.js site using hosting.update', async () => {
    mockHostingGet.mockResolvedValue({
      uid: 'site-1',
      subdomain: 'my-existing-site',
      root_dir: { uid: 'dir-1', name: 'openthorn-my-existing-site' },
    })
    mockFsWrite.mockResolvedValue({ uid: 'file-1', name: 'index.html' })
    mockHostingUpdate.mockResolvedValue({
      uid: 'site-1',
      subdomain: 'my-existing-site',
      root_dir: { uid: 'dir-1', name: 'openthorn-my-existing-site' },
    })

    const { deploySite } = await import('../deploy')
    const result = await deploySite('project-1', '<html>Updated</html>', 'my-existing-site', 'My Site')

    expect(result).toEqual({
      url: 'https://my-existing-site.puter.site',
      siteId: 'my-existing-site',
    })
    expect(mockHostingGet).toHaveBeenCalledWith('my-existing-site')
    expect(mockFsWrite).toHaveBeenCalledWith('openthorn-my-existing-site/index.html', '<html>Updated</html>', { overwrite: true })
    expect(mockHostingUpdate).toHaveBeenCalledWith('my-existing-site', 'openthorn-my-existing-site')
  })
})

describe('Puter auth helpers', () => {
  it('isPuterSignedIn returns true when Puter user is signed in', async () => {
    mockAuthIsSignedIn.mockReturnValue(true)
    const { isPuterSignedIn } = await import('../deploy')
    expect(isPuterSignedIn()).toBe(true)
  })

  it('isPuterSignedIn returns false when Puter user is not signed in', async () => {
    mockAuthIsSignedIn.mockReturnValue(false)
    const { isPuterSignedIn } = await import('../deploy')
    expect(isPuterSignedIn()).toBe(false)
  })
})
