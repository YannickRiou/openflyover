import { describe, expect, it, vi } from 'vitest'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@react-three/fiber', () => ({ invalidate, useFrame: vi.fn(), useThree: vi.fn(), addEffect: vi.fn(), addAfterEffect: vi.fn() }))
const device = vi.hoisted(() => ({ kind: 'desktop' }))
vi.mock('../core/deviceBudget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/deviceBudget')>()
  return { ...actual, deviceBudget: () => ({ ...actual.DESKTOP_BUDGET, kind: device.kind }) }
})

const { CLOUD_SETTLE_FRAMES, MAX_FRAME_DELTA_S, frameDelta, holdBackFrame, playbackFrameIntervalMs, previewCloudPass, sceneChanged, wakeScene } =
  await import('./renderOnDemand')
const { createFrameCap, usePreviewMeasure } = await import('./previewQuality')
const { usePreferences } = await import('../ui/preferences')
const { useAppStore } = await import('../state/store')
const { useExportStore } = await import('../export/store')

describe('render on demand', () => {
  it('wakes the scene for a change of anything but the quiet keys', () => {
    const before = { settings: {}, terrainStats: {}, loading: false }
    expect(sceneChanged({ ...before, terrainStats: { visibleTiles: 3 } }, before)).toBe(false)
    expect(sceneChanged({ ...before, loading: true }, before)).toBe(false)
    expect(sceneChanged({ ...before, settings: { exaggeration: 2 } }, before)).toBe(true)
    expect(sceneChanged(before, before)).toBe(false)
  })

  it('bounds the time step of a frame after a pause', () => {
    expect(frameDelta(0.016)).toBe(0.016)
    expect(frameDelta(12)).toBe(MAX_FRAME_DELTA_S)
  })

  it('asks for a frame when woken', () => {
    invalidate.mockClear()
    wakeScene()
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('upscales the preview clouds while the view changes, then averages the still frames until converged', () => {
    expect(previewCloudPass(0)).toEqual({ upscale: true, alpha: 1, more: true })
    // the first still frame discards the upscaled history, the next ones make a running average
    expect(previewCloudPass(1)).toEqual({ upscale: false, alpha: 1, more: true })
    expect(previewCloudPass(4)).toEqual({ upscale: false, alpha: 1 / 4, more: true })
    expect(previewCloudPass(CLOUD_SETTLE_FRAMES)).toEqual({ upscale: false, alpha: 1 / CLOUD_SETTLE_FRAMES, more: false })
    // frames drawn later for something else (tiles): the average keeps its weight
    expect(previewCloudPass(CLOUD_SETTLE_FRAMES * 3).alpha).toBe(1 / CLOUD_SETTLE_FRAMES)
  })
})

describe('frame cap while the film plays', () => {
  const play = (playing: boolean) => useAppStore.setState((state) => ({ playback: { ...state.playback, playing } }))

  /** Frames of the loop drawn in `seconds` of a display ticking at `hz`: what R3F's loop does with `holdBackFrame` before each tick. */
  async function framesDrawn(hz: number, seconds = 1): Promise<number> {
    const cap = createFrameCap()
    const internal = { frames: 1 }
    let drawn = 0
    for (let t = 0; t < seconds * 1000; t += 1000 / hz) {
      if (holdBackFrame(cap, internal, t)) {
        expect(internal.frames).toBe(0) // nothing left to draw: the loop stops
        await Promise.resolve() // the microtask that asks again
        internal.frames = 1
      } else drawn++
    }
    return drawn
  }

  it('a computer is not capped, playing or not', async () => {
    device.kind = 'desktop'
    play(true)
    expect(playbackFrameIntervalMs()).toBe(0)
    expect(await framesDrawn(120)).toBe(120)
  })

  it('a phone draws 60 frames a second at 120 Hz, 30 with a light preview; a paused film is not capped', async () => {
    device.kind = 'phone'
    usePreferences.setState({ previewQuality: 'auto' })
    usePreviewMeasure.setState({ rung: 0 })
    play(true)
    expect(await framesDrawn(120)).toBe(60)
    usePreviewMeasure.setState({ rung: 1 })
    expect(await framesDrawn(120)).toBe(30)
    usePreferences.setState({ previewQuality: 'light' })
    usePreviewMeasure.setState({ rung: 0 })
    expect(await framesDrawn(120)).toBe(30)
    usePreferences.setState({ previewQuality: 'full' })
    usePreviewMeasure.setState({ rung: 2 })
    expect(await framesDrawn(120)).toBe(60)
    play(false)
    expect(playbackFrameIntervalMs()).toBe(0)
    expect(await framesDrawn(120)).toBe(120)
  })

  it('a held-back tick asks for a frame again', async () => {
    device.kind = 'phone'
    play(true)
    invalidate.mockClear()
    const cap = createFrameCap()
    expect(holdBackFrame(cap, { frames: 1 }, 0)).toBe(false)
    expect(holdBackFrame(cap, { frames: 1 }, 1)).toBe(true)
    expect(invalidate).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('never during an export', async () => {
    device.kind = 'phone'
    play(true)
    for (const phase of ['starting', 'rendering', 'finalizing'] as const) {
      useExportStore.setState({ phase })
      expect(playbackFrameIntervalMs()).toBe(0)
      expect(await framesDrawn(120)).toBe(120)
    }
    useExportStore.setState({ phase: 'idle' })
    expect(playbackFrameIntervalMs()).toBeGreaterThan(0)
    play(false)
  })
})

