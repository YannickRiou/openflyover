import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RootState } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import { DESKTOP_BUDGET, budgetFor } from '../core/deviceBudget'
import { DEFAULT_FILM } from '../film/model'
import { filmClockFor } from '../film/clock'
import { DEFAULT_PACING } from '../flyover/pacing'
import type { WritableFile } from '../platform/platform'
import type { TerrainEngine } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'
import { runExport } from './ExportController'
import { NO_ENCODING_KEY } from './diagnostic'
import { renderSettledFrame } from './capture'
import type { RenderFrameDeps } from './capture'
import { readBreadcrumbs } from './guard'
import { createExportEncoder } from './nativeEncoder'
import { buildFrameSchedule } from './schedule'
import { useExportStore, type ExportRequest } from './store'

const session = {
  codec: { container: 'mp4', codec: 'avc' },
  audioCodec: null,
  bitrate: 1,
  mimeType: 'video/mp4',
  extension: '.mp4',
  addFrame: vi.fn(async (_index: number) => undefined),
  finish: vi.fn(async () => ({ blob: null, sizeBytes: 123 })),
  cancel: vi.fn(async () => undefined),
}

vi.mock('./nativeEncoder', () => ({ createExportEncoder: vi.fn(async () => session), compositorAttributes: () => ({}) }))
vi.mock('../film/audio', () => ({ mixFilmAudio: vi.fn(async () => null) }))
vi.mock('../overlay/exportOverlay', () => ({
  loadFrameMedia: vi.fn(async () => undefined),
  releaseFrameMedia: vi.fn(),
  overlayExtras: vi.fn(() => ({})),
}))
vi.mock('./capture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capture')>()),
  renderSettledFrame: vi.fn(async () => 'complete'),
  composeFrame: vi.fn(),
}))

vi.stubGlobal(
  'OffscreenCanvas',
  class {
    getContext() {
      return {}
    }
  },
)

function fakeThree() {
  const three = {
    gl: { domElement: { style: {}, parentElement: null } },
    frameloop: 'demand',
    size: { width: 800, height: 450, top: 0, left: 0 },
    viewport: { dpr: 2 },
    camera: new PerspectiveCamera(),
    scene: { getObjectByName: () => undefined },
    controls: null,
    setDpr: vi.fn(),
    setSize: vi.fn(),
    setFrameloop: vi.fn(),
    advance: vi.fn(),
  }
  return three
}

function destination(): WritableFile {
  return { fileName: 'film.mp4', write: vi.fn(), close: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) }
}

/** Starts a 2 s film at 10 fps written to `file` and runs it to the end. */
async function exportFilm(file: WritableFile, extra: Partial<Parameters<typeof runExport>[1]> = {}) {
  useExportStore.getState().start({
    width: 320,
    height: 180,
    fps: 10,
    quality: 'high',
    durationS: 2,
    holdStartS: 1,
    holdEndS: 1,
    baseName: 'film',
    destination: file,
  })
  const request = useExportStore.getState().request as ExportRequest
  const three = fakeThree()
  const clock = filmClockFor({ track: undefined, film: DEFAULT_FILM, durationS: 2, pacing: DEFAULT_PACING })
  await runExport(request, {
    get: () => three as unknown as RootState,
    engine: () => null,
    frame: () => null,
    overlay: () => undefined,
    clock: () => clock,
    signal: new AbortController().signal,
    ...extra,
  })
  return { three, frameCount: buildFrameSchedule(request).length }
}

describe('runExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    session.addFrame.mockImplementation(async () => undefined)
    useExportStore.setState({ phase: 'idle', request: null, cancelRequested: false, result: null, error: null })
  })

  it('encodes every scheduled frame, then restores the renderer', async () => {
    const file = destination()
    const { three, frameCount } = await exportFilm(file)
    expect(frameCount).toBe(40)
    expect(session.addFrame.mock.calls.map(([i]) => i)).toEqual([...Array(frameCount).keys()])
    expect(useExportStore.getState()).toMatchObject({
      phase: 'done',
      result: { url: null, fileName: 'film.mp4', sizeBytes: 123, codec: 'mp4/avc' },
    })
    expect(file.discard).not.toHaveBeenCalled()
    expect(three.setFrameloop).toHaveBeenLastCalledWith('demand')
    expect(three.setDpr).toHaveBeenLastCalledWith(2)
    expect(three.setSize).toHaveBeenLastCalledWith(800, 450, 0, 0)
  })

  it('stops on cancel and deletes the file', async () => {
    session.addFrame.mockImplementation(async (i) => {
      if (i === 5) useExportStore.getState().cancel()
    })
    const file = destination()
    const { three } = await exportFilm(file)
    expect(session.addFrame).toHaveBeenCalledTimes(6)
    expect(session.finish).not.toHaveBeenCalled()
    expect(session.cancel).toHaveBeenCalled()
    expect(file.discard).toHaveBeenCalled()
    expect(useExportStore.getState().phase).toBe('canceled')
    expect(three.setFrameloop).toHaveBeenLastCalledWith('demand')
  })

  it('reports an encoder error and deletes the file', async () => {
    session.addFrame.mockRejectedValueOnce(new Error('Disque plein.'))
    const file = destination()
    await exportFilm(file)
    expect(file.discard).toHaveBeenCalled()
    expect(useExportStore.getState()).toMatchObject({ phase: 'error', error: 'Disque plein.', result: null })
  })

  it('stops like a cancel, with the error named, when a frame cannot get its tiles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(renderSettledFrame).mockResolvedValueOnce('complete').mockResolvedValueOnce('missing')
    const file = destination()
    const { three } = await exportFilm(file)
    expect(session.cancel).toHaveBeenCalled()
    expect(session.finish).not.toHaveBeenCalled()
    expect(file.discard).toHaveBeenCalled()
    const state = useExportStore.getState()
    expect(state).toMatchObject({ phase: 'error', result: null })
    expect(state.error).toMatch(/^Tuiles introuvables pour l'image \d+\. Export arrêté/)
    // the history reads these: one frame given up, none at the timeout
    expect(state.timings).toMatchObject({ givenUp: 1, timeouts: 0 })
    expect(three.setFrameloop).toHaveBeenLastCalledWith('demand')
  })

  it('counts the renders and the time of each step, and reaches the store a few times a second only', async () => {
    const reportFrame = vi.spyOn(useExportStore.getState(), 'reportFrame')
    const { frameCount } = await exportFilm(destination())
    const { timings } = useExportStore.getState()
    expect(timings.rendered).toBeGreaterThan(0)
    expect(timings.encodeMs).toBeCloseTo(timings.composeMs + timings.frameMs + timings.encodeWaitMs, 5)
    // the first frame, then at most every 250 ms, and the last one (twice: the end of the loop and of the export)
    expect(reportFrame.mock.calls.length).toBeLessThan(frameCount)
    expect(reportFrame.mock.calls.at(-1)?.[0]).toBe(frameCount)
  })

  it('counts the tiles of a phone in film frames for the whole export, then goes back to wall time', async () => {
    // the controller reuses one object: keep what each call saw
    const seen: Array<{ frame: number; keepFrames: number; prefetchKeepFrames: number } | null> = []
    const setRetention = vi.fn((retention) => void seen.push(retention && { ...retention }))
    const phone = budgetFor({ coarsePointer: true, shortSidePx: 393 })
    const { frameCount } = await exportFilm(destination(), { engine: () => ({ setRetention }) as unknown as TerrainEngine, budget: phone })
    expect(seen.slice(0, -1).map((retention) => retention?.frame)).toEqual([...Array(frameCount).keys()])
    expect(seen[0]).toMatchObject({ keepFrames: phone.exportTileKeepFrames, prefetchKeepFrames: 30 })
    expect(seen.at(-1)).toBeNull()
  })

  it('« Export de test sans encodage » renders every frame, encodes none and ends on its message', async () => {
    const map = new Map([[NO_ENCODING_KEY, '1']])
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) })
    try {
      const engine = { stats: { loadedTiles: 5, pendingTiles: 1 }, caches: () => ({ bitmaps: 3, bitmapBytes: 2e6, heightGrids: 4 }) }
      const file = destination()
      await exportFilm(file, { engine: () => engine as unknown as TerrainEngine })
      expect(createExportEncoder).not.toHaveBeenCalled()
      expect(session.addFrame).not.toHaveBeenCalled()
      expect(file.discard).toHaveBeenCalled()
      expect(useExportStore.getState()).toMatchObject({ phase: 'error', result: null })
      expect(useExportStore.getState().error).toMatch(/^Export de test terminé sans fichier \(\d+ images rendues\)$/)
      const steps = readBreadcrumbs(sessionStorage)
      expect(steps.map((c) => c.event)).toContain('export : test sans encodage')
      expect(steps.at(-1)).toMatchObject({ tiles: 5, pending: 1, bitmaps: 3, bitmapMb: 2, grids: 4, drapes: 0 })
    } finally {
      vi.stubGlobal('sessionStorage', undefined)
    }
  })

  it('a computer keeps the wall-time retention (the engine is only reset at the end)', async () => {
    const setRetention = vi.fn()
    await exportFilm(destination(), { engine: () => ({ setRetention }) as unknown as TerrainEngine, budget: DESKTOP_BUDGET })
    expect(setRetention.mock.calls).toEqual([[null]])
  })

  it('prefetches the upcoming frames while a frame waits for its tiles, at most every 100 ms', async () => {
    const track = buildTrack({
      name: 'test',
      source: 'gpx',
      segments: [{ points: Array.from({ length: 12 }, (_, i) => ({ lon: 6.78, lat: 45.9 - i * 0.009, ele: 1000 })) }],
    })
    const tracks = useAppStore.getState().tracks
    useAppStore.setState({ tracks: [track] })
    const prefetch = vi.fn(() => 0)
    const engine = { prefetch, update: vi.fn(), sampleHeight: () => 0, stats: { pendingTiles: 0, pendingVisibleTiles: 0 } }
    const during: number[] = []
    vi.mocked(renderSettledFrame)
      .mockResolvedValueOnce('complete')
      .mockImplementationOnce(async (_progress: number, deps: RenderFrameDeps) => {
        // two polls within 100 ms: one round of prefetches
        const before = prefetch.mock.calls.length
        await deps.wait(16)
        during.push(prefetch.mock.calls.length - before)
        await deps.wait(16)
        during.push(prefetch.mock.calls.length - before)
        return 'complete'
      })
    try {
      await exportFilm(destination(), {
        engine: () => engine as unknown as TerrainEngine,
        frame: () => createLocalFrame(6.78, 45.85),
        budget: DESKTOP_BUDGET,
      })
    } finally {
      useAppStore.setState({ tracks })
    }
    expect(during[0]).toBeGreaterThan(0)
    expect(during[1]).toBe(during[0])
  })
})
