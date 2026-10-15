// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopPlatform } from './desktop'
import { detectCapabilities } from './platform'
import { canCheckUpdate, canInstallUpdate, checkOutcome, downloadProgress, failedCheck, percentOf, shortNotes } from './updater'
import type { DownloadEvent, UpdateProgress } from './updater'

const updater = vi.hoisted(() => ({ check: vi.fn() }))
const processPlugin = vi.hoisted(() => ({ relaunch: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/plugin-updater', () => updater)
vi.mock('@tauri-apps/plugin-process', () => processPlugin)

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('checkOutcome', () => {
  it('is up to date when the plugin finds nothing', () => {
    expect(checkOutcome(null)).toEqual({ status: 'current' })
  })

  it('carries the version, date and notes of the update', () => {
    expect(checkOutcome({ version: '2.1.0', date: '2026-10-20T08:00:00Z', body: '  - faster export\n' })).toEqual({
      status: 'available',
      update: { version: '2.1.0', date: '2026-10-20T08:00:00Z', notes: '- faster export' },
    })
    expect(checkOutcome({ version: '2.1.0' })).toEqual({ status: 'available', update: { version: '2.1.0', date: null, notes: null } })
  })
})

describe('failedCheck', () => {
  it('says the updater is not set up when Tauri does not know the plugin (no signing key in this build)', () => {
    expect(failedCheck('plugin updater not found', true)).toEqual({ status: 'unavailable' })
    expect(failedCheck(new Error('plugin updater not found'), false)).toEqual({ status: 'unavailable' })
  })

  it('says offline without network, or when the request could not be sent', () => {
    expect(failedCheck('anything', false)).toEqual({ status: 'offline' })
    expect(failedCheck('error sending request for url (https://github.com/x/latest.json)', true)).toEqual({ status: 'offline' })
  })

  it('keeps the message of any other failure', () => {
    const failed = failedCheck('Could not fetch a valid release JSON from the remote', true)
    expect(failed.status).toBe('error')
    expect(failed.status === 'error' && failed.message).toContain('Could not fetch a valid release JSON')
  })
})

describe('download progress', () => {
  const run = (events: DownloadEvent[]) => events.reduce<UpdateProgress>(downloadProgress, { downloadedBytes: 0, totalBytes: null })

  it('adds the chunks to the announced size', () => {
    const progress = run([{ event: 'Started', data: { contentLength: 200 } }, { event: 'Progress', data: { chunkLength: 50 } }])
    expect(progress).toEqual({ downloadedBytes: 50, totalBytes: 200 })
    expect(percentOf(progress)).toBe(25)
  })

  it('has no percentage without a size, and is complete at the end', () => {
    expect(percentOf(run([{ event: 'Started', data: {} }, { event: 'Progress', data: { chunkLength: 10 } }]))).toBeNull()
    expect(percentOf(run([{ event: 'Started', data: { contentLength: 80 } }, { event: 'Progress', data: { chunkLength: 70 } }, { event: 'Finished' }]))).toBe(100)
  })
})

describe('shortNotes', () => {
  it('drops blank lines and keeps short notes whole', () => {
    expect(shortNotes('- a\n\n  - b \r\n')).toBe('- a\n- b')
  })

  it('cuts long notes at a word', () => {
    const cut = shortNotes('word '.repeat(100), 50)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(51)
  })
})

describe('buttons', () => {
  it('installs only an update found, and not during an export', () => {
    const available = { status: 'available', update: { version: '2.1.0', date: null, notes: null } } as const
    expect(canInstallUpdate(available, false)).toBe(true)
    expect(canInstallUpdate(available, true)).toBe(false)
    expect(canInstallUpdate({ status: 'current' }, false)).toBe(false)
  })

  it('checks again except while working', () => {
    expect(canCheckUpdate({ status: 'idle' })).toBe(true)
    expect(canCheckUpdate({ status: 'error', message: 'x' })).toBe(true)
    expect(canCheckUpdate({ status: 'checking' })).toBe(false)
    expect(canCheckUpdate({ status: 'installing', percent: null })).toBe(false)
  })
})

describe('desktop platform', () => {
  const desktop = () => createDesktopPlatform(detectCapabilities({ isTauri: true }))

  it('reports an update with its details, without downloading it', async () => {
    updater.check.mockResolvedValue({ version: '2.1.0', date: '2026-10-20T08:00:00Z', body: 'notes', close: vi.fn(async () => undefined), downloadAndInstall: vi.fn() })
    expect(await desktop().checkForUpdate!()).toEqual({ status: 'available', update: { version: '2.1.0', date: '2026-10-20T08:00:00Z', notes: 'notes' } })
  })

  it('is up to date when check() returns null', async () => {
    updater.check.mockResolvedValue(null)
    expect(await desktop().checkForUpdate!()).toEqual({ status: 'current' })
  })

  it('never throws: not set up, offline, other failure', async () => {
    updater.check.mockRejectedValueOnce('plugin updater not found')
    expect(await desktop().checkForUpdate!()).toEqual({ status: 'unavailable' })
    updater.check.mockRejectedValueOnce('error sending request for url (https://github.com)')
    expect(await desktop().checkForUpdate!()).toEqual({ status: 'offline' })
    vi.stubGlobal('navigator', { onLine: false })
    updater.check.mockRejectedValueOnce('anything')
    expect(await desktop().checkForUpdate!()).toEqual({ status: 'offline' })
    vi.unstubAllGlobals()
    updater.check.mockRejectedValueOnce('signature verification failed')
    expect((await desktop().checkForUpdate!()).status).toBe('error')
  })

  it('downloads, installs with progress, then restarts', async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      onEvent({ event: 'Progress', data: { chunkLength: 40 } })
      onEvent({ event: 'Finished' })
    })
    updater.check.mockResolvedValue({ version: '2.1.0', close: vi.fn(async () => undefined), downloadAndInstall })
    const platform = desktop()
    await platform.checkForUpdate!()
    const seen: (number | null)[] = []
    await platform.installUpdate!((progress) => seen.push(percentOf(progress)))
    expect(seen).toEqual([0, 40, 100])
    expect(processPlugin.relaunch).toHaveBeenCalledOnce()
  })

  it('refuses to install before a check found something, and does not restart when the installation fails', async () => {
    const platform = desktop()
    await expect(platform.installUpdate!()).rejects.toThrow()
    updater.check.mockResolvedValue({ version: '2.1.0', close: vi.fn(async () => undefined), downloadAndInstall: vi.fn(async () => Promise.reject(new Error('disk full'))) })
    await platform.checkForUpdate!()
    await expect(platform.installUpdate!()).rejects.toThrow('disk full')
    expect(processPlugin.relaunch).not.toHaveBeenCalled()
  })
})
