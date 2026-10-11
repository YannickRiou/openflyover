import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RootState } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import { DESKTOP_BUDGET, budgetFor } from '../core/deviceBudget'
import { DEFAULT_FILM } from '../film/model'
import { filmClockFor } from '../film/clock'
import { DEFAULT_PACING } from '../flyover/pacing'
import type { WritableFile } from '../platform/platform'
import type { TerrainEngine } from '../core/types'
import { runExport } from './ExportController'
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

vi.mock('./nativeEncoder', () => ({ createExportEncoder: vi.fn(async () => session) }))
vi.mock('../film/audio', () => ({ mixFilmAudio: vi.fn(async () => null) }))
vi.mock('../overlay/exportOverlay', () => ({
  loadFrameMedia: vi.fn(async () => undefined),
  releaseFrameMedia: vi.fn(),
  overlayExtras: vi.fn(() => ({})),
}))
vi.mock('./capture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./capture')>()),
  renderSettledFrame: vi.fn(async () => true),
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

  it('a computer keeps the wall-time retention (the engine is only reset at the end)', async () => {
    const setRetention = vi.fn()
    await exportFilm(destination(), { engine: () => ({ setRetention }) as unknown as TerrainEngine, budget: DESKTOP_BUDGET })
    expect(setRetention.mock.calls).toEqual([[null]])
  })
})
