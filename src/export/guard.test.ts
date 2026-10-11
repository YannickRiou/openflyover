import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../ui/toast'
import {
  BREADCRUMB_KEY,
  EXPORT_INTERRUPTED_TEXT,
  EXPORT_RUNNING_KEY,
  createScreenWakeLock,
  describeBreadcrumb,
  installExportGuard,
  reportInterruptedExport,
  setBreadcrumbProbe,
  takeInterruptedExport,
  writeBreadcrumb,
  type ScreenWakeLock,
  type WakeLockHost,
} from './guard'
import { resetExportStore, useExportStore, type ExportRequest } from './store'

const REQUEST: Omit<ExportRequest, 'id'> = {
  width: 1280,
  height: 720,
  fps: 30,
  quality: 'high',
  durationS: 10,
  holdStartS: 1,
  holdEndS: 2,
  baseName: 'Tour',
}
const RESULT = { url: null, fileName: 'Tour.mp4', mimeType: 'video/mp4', sizeBytes: 5, codec: 'mp4/avc', incompleteFrames: 0 }

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

/** A Wake Lock host: `request` hands out sentinels that can be released by the browser too. */
function fakeHost(visibility: 'visible' | 'hidden' = 'visible') {
  const listeners = new Set<() => void>()
  const sentinels: { released: boolean; release: () => Promise<void>; fire: () => void; onRelease?: () => void }[] = []
  const request = vi.fn(async () => {
    const s = {
      released: false,
      release: async () => void (s.released = true),
      addEventListener: (_type: 'release', l: () => void) => void (s.onRelease = l),
      fire: () => {
        s.released = true
        s.onRelease?.()
      },
    } as (typeof sentinels)[number]
    sentinels.push(s)
    return s
  })
  const doc = {
    visibilityState: visibility as DocumentVisibilityState,
    addEventListener: (_t: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_t: string, l: () => void) => void listeners.delete(l),
  }
  const host = { navigator: { wakeLock: { request } }, document: doc } as unknown as WakeLockHost
  const show = (v: DocumentVisibilityState) => {
    doc.visibilityState = v
    listeners.forEach((l) => l())
  }
  return { host, request, sentinels, show, listeners }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createScreenWakeLock', () => {
  it('asks for the screen lock, asks again when the page comes back, and lets go at the end', async () => {
    const { host, request, sentinels, show, listeners } = fakeHost()
    const lock = createScreenWakeLock(host)
    lock.hold()
    await settle()
    expect(request).toHaveBeenCalledWith('screen')
    expect(request).toHaveBeenCalledTimes(1)

    // hidden: the browser drops the lock; coming back asks again
    show('hidden')
    sentinels[0].fire()
    show('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)

    lock.release()
    expect(sentinels[1].released).toBe(true)
    expect(listeners.size).toBe(0)
    show('hidden')
    show('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not ask while hidden, and releases a lock that arrives after the end', async () => {
    const hidden = fakeHost('hidden')
    createScreenWakeLock(hidden.host).hold()
    await settle()
    expect(hidden.request).not.toHaveBeenCalled()

    const late = fakeHost()
    const lock = createScreenWakeLock(late.host)
    lock.hold()
    lock.release() // before the browser answered
    await settle()
    expect(late.sentinels[0].released).toBe(true)
  })

  it('goes on without the API, and when the browser refuses', async () => {
    const lock = createScreenWakeLock({ navigator: {}, document: undefined })
    expect(() => {
      lock.hold()
      lock.release()
    }).not.toThrow()
    const refused = fakeHost()
    refused.request.mockRejectedValueOnce(new Error('NotAllowedError'))
    const refusing = createScreenWakeLock(refused.host)
    refusing.hold()
    await settle()
    expect(() => refusing.release()).not.toThrow()
  })
})

describe('export guard', () => {
  let stop: (() => void) | undefined
  const lock = () => ({ hold: vi.fn<ScreenWakeLock['hold']>(), release: vi.fn<ScreenWakeLock['release']>() })

  beforeEach(() => {
    resetExportStore()
    useToastStore.setState({ toasts: [] })
    setBreadcrumbProbe(null)
  })
  afterEach(() => stop?.())

  it('holds the screen and flags the tab while an export is busy, then clears both (done, canceled, error)', () => {
    const storage = memoryStorage()
    const screen = lock()
    stop = installExportGuard(screen, storage, {})
    for (const end of ['complete', 'canceled', 'fail'] as const) {
      useExportStore.getState().start(REQUEST)
      expect(storage.getItem(EXPORT_RUNNING_KEY)).not.toBeNull()
      expect(screen.hold).toHaveBeenCalled()
      screen.hold.mockClear()
      useExportStore.getState().begin(useExportStore.getState().request!.id, 10, 0)
      expect(screen.hold).not.toHaveBeenCalled() // still the same export
      if (end === 'complete') useExportStore.getState().complete(RESULT)
      else if (end === 'fail') useExportStore.getState().fail('boom')
      else useExportStore.getState().canceled()
      expect(storage.getItem(EXPORT_RUNNING_KEY)).toBeNull()
      expect(screen.release).toHaveBeenCalledTimes(1)
      screen.release.mockClear()
    }
  })

  it('a storage that refuses writes does not stop the export', () => {
    const storage = { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error('quota') } }
    const screen = lock()
    stop = installExportGuard(screen, storage, {})
    expect(() => useExportStore.getState().start(REQUEST)).not.toThrow()
    expect(screen.hold).toHaveBeenCalled()
  })

  it('starts each export with a fresh breadcrumb: its first step, not an older one', () => {
    const storage = memoryStorage()
    storage.setItem(BREADCRUMB_KEY, JSON.stringify({ event: 'pagehide', at: 1 }))
    setBreadcrumbProbe(() => ({ tiles: 7 }))
    stop = installExportGuard(lock(), storage, {})
    useExportStore.getState().start(REQUEST)
    expect(JSON.parse(storage.getItem(BREADCRUMB_KEY)!)).toMatchObject({ event: 'export : démarrage', tiles: 7 })
  })

  it('writes a breadcrumb on pagehide and freeze', () => {
    const storage = memoryStorage()
    const page = new EventTarget()
    const doc = new EventTarget()
    setBreadcrumbProbe(() => ({ textures: 12, geometries: 3, tiles: 40 }))
    stop = installExportGuard(lock(), storage, { pagehide: page, freeze: doc })
    page.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(storage.getItem(BREADCRUMB_KEY)!)).toMatchObject({ event: 'pagehide', textures: 12, geometries: 3, tiles: 40 })
    doc.dispatchEvent(new Event('freeze'))
    expect(JSON.parse(storage.getItem(BREADCRUMB_KEY)!)).toMatchObject({ event: 'freeze' })
  })
})

describe('interrupted export', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('is reported once, when the flag outlived the page', () => {
    const storage = memoryStorage()
    expect(takeInterruptedExport(storage)).toBeNull()
    storage.setItem(EXPORT_RUNNING_KEY, '123')
    expect(takeInterruptedExport(storage)).toEqual({ breadcrumb: null })
    expect(takeInterruptedExport(storage)).toBeNull()
  })

  it('shows the toast with the breadcrumb a click away, then nothing the next time', () => {
    const storage = memoryStorage()
    storage.setItem(EXPORT_RUNNING_KEY, '123')
    writeBreadcrumb('pagehide', storage, Date.UTC(2026, 9, 11, 12, 3, 44))
    expect(reportInterruptedExport(storage)).toBe(true)
    const [toast] = useToastStore.getState().toasts
    expect(toast).toMatchObject({ kind: 'error', text: EXPORT_INTERRUPTED_TEXT })
    toast.action!.run()
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/pagehide à /)
    useToastStore.setState({ toasts: [] })
    expect(reportInterruptedExport(storage)).toBe(false)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('a storage that throws is no interruption', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => undefined, removeItem: () => undefined }
    expect(takeInterruptedExport(broken)).toBeNull()
    expect(() => writeBreadcrumb('pagehide', broken)).not.toThrow()
  })

  it('describes the breadcrumb', () => {
    expect(describeBreadcrumb({ event: 'freeze', at: 0, textures: 5, tiles: 9 })).toMatch(/^freeze à .* · 5 textures, 9 tuiles$/)
    expect(describeBreadcrumb({ event: 'pagehide', at: 0 })).toMatch(/^pagehide à [^·]*$/)
  })
})
