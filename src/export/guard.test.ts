import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../ui/toast'
import { REPORT_KEY, parseReport, useDiagnosticStore } from './diagnostic'
import {
  BREADCRUMB_KEY,
  EXPORT_INTERRUPTED_TEXT,
  EXPORT_RUNNING_KEY,
  MAX_STEPS,
  createScreenWakeLock,
  currentReport,
  describeBreadcrumb,
  describeSteps,
  installExportGuard,
  isExportStep,
  readBreadcrumbs,
  reportInterruptedExport,
  setBreadcrumbProbe,
  setExportProbe,
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

  it('starts each export with fresh breadcrumbs (its first step, not an older one) and its report', () => {
    const storage = memoryStorage()
    storage.setItem(BREADCRUMB_KEY, JSON.stringify([{ event: 'pagehide', at: 1 }]))
    storage.setItem(REPORT_KEY, JSON.stringify({ at: 'avant', sections: [] }))
    setBreadcrumbProbe(() => ({ tiles: 7 }))
    stop = installExportGuard(lock(), storage, {})
    useExportStore.getState().start(REQUEST)
    expect(readBreadcrumbs(storage)).toMatchObject([{ event: 'export : démarrage', tiles: 7 }])
    const report = parseReport(storage.getItem(REPORT_KEY))
    expect(report?.at).not.toBe('avant')
    expect(report?.sections.find((s) => s.title === 'Export')?.rows).toContainEqual(['Taille', '1280 × 720'])
  })

  it('keeps the last MAX_STEPS breadcrumbs, oldest first', () => {
    const storage = memoryStorage()
    for (let i = 1; i <= MAX_STEPS + 5; i++) writeBreadcrumb(`export : image ${i} / ${MAX_STEPS + 5}`, storage, i)
    const steps = readBreadcrumbs(storage)
    expect(steps).toHaveLength(MAX_STEPS)
    expect(steps[0].event).toBe(`export : image 6 / ${MAX_STEPS + 5}`)
    expect(steps.at(-1)!.event).toBe(`export : image ${MAX_STEPS + 5} / ${MAX_STEPS + 5}`)
    // a single breadcrumb, as stored before the steps were kept, still reads
    storage.setItem(BREADCRUMB_KEY, JSON.stringify({ event: 'freeze', at: 3 }))
    expect(readBreadcrumbs(storage)).toEqual([{ event: 'freeze', at: 3 }])
  })

  it('writes a breadcrumb on pagehide and freeze', () => {
    const storage = memoryStorage()
    const page = new EventTarget()
    const doc = new EventTarget()
    setBreadcrumbProbe(() => ({ textures: 12, geometries: 3, tiles: 40 }))
    stop = installExportGuard(lock(), storage, { pagehide: page, freeze: doc })
    page.dispatchEvent(new Event('pagehide'))
    expect(readBreadcrumbs(storage).at(-1)).toMatchObject({ event: 'pagehide', textures: 12, geometries: 3, tiles: 40 })
    doc.dispatchEvent(new Event('freeze'))
    expect(readBreadcrumbs(storage).map((c) => c.event)).toEqual(['pagehide', 'freeze'])
  })
})

describe('interrupted export', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useDiagnosticStore.setState({ text: null })
  })

  it('is reported once, when the flag outlived the page', () => {
    const storage = memoryStorage()
    expect(takeInterruptedExport(storage)).toBeNull()
    storage.setItem(EXPORT_RUNNING_KEY, '123')
    expect(takeInterruptedExport(storage)).toEqual({ breadcrumb: null })
    expect(takeInterruptedExport(storage)).toBeNull()
  })

  it('shows the toast with the diagnostic report a click away, then nothing the next time', () => {
    const storage = memoryStorage()
    storage.setItem(EXPORT_RUNNING_KEY, '123')
    writeBreadcrumb('export : démarrage', storage, Date.UTC(2026, 9, 11, 12, 3, 40))
    writeBreadcrumb('pagehide', storage, Date.UTC(2026, 9, 11, 12, 3, 44))
    expect(reportInterruptedExport(storage)).toBe(true)
    const [toast] = useToastStore.getState().toasts
    expect(toast).toMatchObject({ kind: 'error', text: EXPORT_INTERRUPTED_TEXT, action: { label: 'Détails' } })
    toast.action!.run()
    const text = useDiagnosticStore.getState().text!
    expect(text).toMatch(/\[Étapes\]\n1 : export : démarrage à .*\n2 : pagehide à /)
    expect(text).toContain('[Réglages]')
    useToastStore.setState({ toasts: [] })
    expect(reportInterruptedExport(storage)).toBe(false)
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('shows no « Détails » without a report or a breadcrumb', () => {
    const storage = memoryStorage()
    storage.setItem(EXPORT_RUNNING_KEY, '123')
    expect(reportInterruptedExport(storage)).toBe(true)
    expect(useToastStore.getState().toasts[0].action).toBeUndefined()
  })

  it('the report of « Afficher le rapport » adds the last export and its steps to the one made now', () => {
    const storage = memoryStorage()
    expect(currentReport(storage)).toMatch(/\[Appareil\][\s\S]*\[Export\][\s\S]*\[Réglages\][\s\S]*\[Étapes\]\naucune$/)
    storage.setItem(REPORT_KEY, JSON.stringify({ at: '2026-10-11T12:03:40.000Z', sections: [{ title: 'Export', rows: [['Taille', '1280 × 720']] }] }))
    writeBreadcrumb('export : encodeur prêt (mp4/avc, 8.0 Mbit/s)', storage)
    const text = currentReport(storage)
    expect(text).toContain('[Dernier export]\nCommencé le : 2026-10-11T12:03:40.000Z\nTaille : 1280 × 720')
    expect(text).toMatch(/1 : export : encodeur prêt \(mp4\/avc, 8.0 Mbit\/s\) à /)
  })

  it('a storage that throws is no interruption', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => undefined, removeItem: () => undefined }
    expect(takeInterruptedExport(broken)).toBeNull()
    expect(() => writeBreadcrumb('pagehide', broken)).not.toThrow()
  })

  it('describes the breadcrumb', () => {
    expect(describeBreadcrumb({ event: 'freeze', at: 0, textures: 5, tiles: 9 })).toMatch(/^freeze à .* · 5 tex, 9 tuiles$/)
    expect(describeBreadcrumb({ event: 'freeze', at: 0, tiles: 9, pending: 3 })).toMatch(/ · 9 tuiles \(3 en attente\)$/)
    expect(describeBreadcrumb({ event: 'freeze', at: 0, pending: 3 })).toMatch(/ · 3 en attente$/)
    // the terrain's detail lowered to keep a phone under its tile budget; full detail is not shown
    expect(describeBreadcrumb({ event: 'freeze', at: 0, tiles: 9, lod: 3.8 })).toMatch(/ · 9 tuiles, détail ÷3,8$/)
    expect(describeBreadcrumb({ event: 'freeze', at: 0, tiles: 9, lod: 1 })).toMatch(/ · 9 tuiles$/)
    expect(describeBreadcrumb({ event: 'pagehide', at: 0 })).toMatch(/^pagehide à [^·]*$/)
    expect(describeBreadcrumb({ event: 'freeze', at: 0, heapMb: 310 })).toMatch(/ · 310 Mo de tas JS$/)
    const step = { event: 'export : image 100 / 1848', at: 11_000, textures: 136, geometries: 126, tiles: 161, pending: 12 }
    const counters = { bitmaps: 180, bitmapMb: 45, grids: 160, inFlight: 4, queue: 2, drapes: 37 }
    expect(describeBreadcrumb({ ...step, ...counters }, { event: 'export : image 90 / 1848', at: 0 })).toMatch(
      /^export : image 100 \/ 1848 à .* · 136 tex, 126 géo, 161 tuiles \(12 en attente\), 180 bitmaps ~45 Mo, 160 grilles, 4 en vol, file 2, 37 re-drapages, \+11,0 s$/,
    )
    expect(describeSteps([{ event: 'a', at: 0 }, { event: 'b', at: 2_500 }])).toEqual([
      expect.stringMatching(/^a à [^·]*$/),
      expect.stringMatching(/^b à .* · \+2,5 s$/),
    ])
  })

  it('notes 1 frame in 10 from 50 to 200, 1 in 25 elsewhere, and the first 3', () => {
    const steps = Array.from({ length: 301 }, (_, i) => i).filter(isExportStep)
    expect(steps).toEqual([0, 1, 2, 25, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 225, 250, 275, 300])
  })

  it('adds the counters of a running export to every breadcrumb', () => {
    const storage = memoryStorage()
    setBreadcrumbProbe(() => ({ textures: 12, tiles: 40 }))
    setExportProbe(() => ({ tiles: 41, bitmaps: 180, inFlight: 4 }))
    writeBreadcrumb('pagehide', storage, 1)
    setExportProbe(null)
    writeBreadcrumb('freeze', storage, 2)
    expect(readBreadcrumbs(storage)).toEqual([
      { event: 'pagehide', at: 1, textures: 12, tiles: 41, bitmaps: 180, inFlight: 4 },
      { event: 'freeze', at: 2, textures: 12, tiles: 40 },
    ])
  })
})
