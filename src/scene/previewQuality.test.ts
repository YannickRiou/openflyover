import { describe, expect, it } from 'vitest'
import { DESKTOP_BUDGET } from '../core/deviceBudget'
import {
  LIGHT_PREVIEW,
  RECOVER_WINDOWS,
  RUNG2_MOVING_PIXEL_RATIO,
  SLOW_PREVIEW_WINDOW_MS,
  createFrameCap,
  createRungGovernor,
  frameIntervalMs,
  previewBudget,
  previewRung,
  sceneBudget,
  shadowRefresh,
} from './previewQuality'

type Governor = ReturnType<typeof createRungGovernor>

/** Feeds frames `stepMs` apart for `durationMs`, from `from`; the rung after the last one. */
function play(governor: Governor, stepMs: number, durationMs: number, from = 0, capFps?: number): number {
  let rung = 0
  for (let t = from; t <= from + durationMs; t += stepMs) rung = governor.frame(t, capFps)
  return rung
}

describe('previewBudget', () => {
  it('a computer keeps its preview, a light one draws a phone’s pixels and clouds, a 2048² shadow map and half the trees', () => {
    expect(previewBudget(DESKTOP_BUDGET, 0)).toEqual({
      maxPixelRatio: 2,
      movingPixelRatio: 2,
      cloudResolutionScale: 1,
      cloudSettleFrames: 32,
      shadowMapSize: 4096,
      maxTrees: 250_000,
    })
    expect(previewBudget(DESKTOP_BUDGET, 1)).toEqual(LIGHT_PREVIEW)
    // a device already lower keeps its own
    const lower = { maxPixelRatio: 1.5, movingPixelRatio: 1, cloudResolutionScale: 0.25, cloudSettleFrames: 8, shadowMapSize: 1024, maxTrees: 30_000 }
    expect(previewBudget(lower, 1)).toEqual(lower)
    expect(LIGHT_PREVIEW.shadowMapSize).toBe(2048)
    expect(LIGHT_PREVIEW.maxTrees).toBe(DESKTOP_BUDGET.maxTrees / 2)
  })

  it('an export, a poster or a capture takes the device’s shadow map and trees, whatever the preview', () => {
    const light = previewBudget(DESKTOP_BUDGET, 1)
    expect(sceneBudget(light, false, DESKTOP_BUDGET)).toEqual({ shadowMapSize: 2048, maxTrees: 125_000 })
    expect(sceneBudget(light, true, DESKTOP_BUDGET)).toEqual({ shadowMapSize: 4096, maxTrees: 250_000 })
    expect(sceneBudget(previewBudget(DESKTOP_BUDGET, 0), false, DESKTOP_BUDGET)).toEqual({ shadowMapSize: 4096, maxTrees: 250_000 })
  })

  it('rung 2 only lowers the pixel ratio while moving (0.75); the ratio at rest and the rest of the budget are rung 1’s', () => {
    expect(previewBudget(DESKTOP_BUDGET, 2)).toEqual({ ...LIGHT_PREVIEW, movingPixelRatio: RUNG2_MOVING_PIXEL_RATIO })
    expect(RUNG2_MOVING_PIXEL_RATIO).toBeLessThan(1)
    // a device already lower keeps its own
    const lower = { maxPixelRatio: 1.5, movingPixelRatio: 0.5, cloudResolutionScale: 0.25, cloudSettleFrames: 8, shadowMapSize: 1024, maxTrees: 30_000 }
    expect(previewBudget(lower, 2)).toEqual(lower)
  })

  it('« Auto » follows the measured rung, « Légère » is rung 1 and « Complète » rung 0 whatever the measure', () => {
    expect(previewRung('auto', 0)).toBe(0)
    expect(previewRung('auto', 2)).toBe(2)
    expect(previewRung('light', 0)).toBe(1)
    expect(previewRung('light', 2)).toBe(1)
    expect(previewRung('full', 2)).toBe(0)
  })
})

describe('shadowRefresh', () => {
  it('draws the shadow map on every frame, or on every second one (and while it is missing) when halved', () => {
    expect(shadowRefresh(false, 3, true)).toEqual({ autoUpdate: true, needsUpdate: false })
    const drawn = (halved: boolean, from: number, count: number) =>
      Array.from({ length: count }, (_, i) => shadowRefresh(halved, from + i, true)).filter((f) => f.autoUpdate || f.needsUpdate).length
    expect(drawn(false, 0, 60)).toBe(60)
    expect(drawn(true, 0, 60)).toBe(30)
    expect(drawn(true, 1, 60)).toBe(30)
    expect(shadowRefresh(true, 1, false)).toEqual({ autoUpdate: false, needsUpdate: true })
    expect(shadowRefresh(true, 1, true)).toEqual({ autoUpdate: false, needsUpdate: false })
  })
})

describe('frame cap', () => {
  /** Frames drawn in `seconds` of a display ticking at `hz`, the cap asking for `interval` ms (0: none). */
  function framesDrawn(hz: number, interval: number, seconds = 1, from = 0): number {
    const cap = createFrameCap()
    let drawn = 0
    for (let t = from; t < from + seconds * 1000; t += 1000 / hz) if (cap.allow(t, interval)) drawn++
    return drawn
  }

  it('the interval: none on a computer, 60 frames per second on a phone or tablet, 30 once light', () => {
    expect(frameIntervalMs('desktop', 0)).toBe(0)
    expect(frameIntervalMs('desktop', 2)).toBe(0)
    expect(frameIntervalMs('phone', 0)).toBeCloseTo(1000 / 60)
    expect(frameIntervalMs('tablet', 0)).toBeCloseTo(1000 / 60)
    expect(frameIntervalMs('phone', 1)).toBeCloseTo(1000 / 30)
    expect(frameIntervalMs('tablet', 2)).toBeCloseTo(1000 / 30)
  })

  it('draws 60 frames a second on a 120 Hz screen, 30 when light; every frame without a cap', () => {
    expect(framesDrawn(120, 0)).toBe(120)
    expect(framesDrawn(120, frameIntervalMs('phone', 0))).toBe(60)
    expect(framesDrawn(120, frameIntervalMs('phone', 1))).toBe(30)
  })

  it('averages the cap on a 90 Hz screen (not half of it), and leaves a 60 Hz screen at 60 / 30', () => {
    expect(framesDrawn(90, frameIntervalMs('phone', 0), 4)).toBeGreaterThanOrEqual(4 * 59)
    expect(framesDrawn(90, frameIntervalMs('phone', 0), 4)).toBeLessThanOrEqual(4 * 61)
    expect(framesDrawn(90, frameIntervalMs('phone', 1), 4)).toBeGreaterThanOrEqual(4 * 29)
    expect(framesDrawn(90, frameIntervalMs('phone', 1), 4)).toBeLessThanOrEqual(4 * 31)
    expect(Math.abs(framesDrawn(60, frameIntervalMs('phone', 0), 4) - 4 * 60)).toBeLessThanOrEqual(1)
    expect(Math.abs(framesDrawn(60, frameIntervalMs('phone', 1), 4) - 4 * 30)).toBeLessThanOrEqual(1)
  })

  it('does not hold back a screen slower than the cap, and a stall is not followed by a burst', () => {
    expect(Math.abs(framesDrawn(30, frameIntervalMs('phone', 0), 4) - 4 * 30)).toBeLessThanOrEqual(1)
    const cap = createFrameCap()
    const interval = frameIntervalMs('phone', 0)
    expect(cap.allow(0, interval)).toBe(true)
    // half a second without a tick: the next one draws, then 120 Hz ticks give 60 frames a second again, not the missed ones
    expect(cap.allow(500, interval)).toBe(true)
    let drawn = 0
    for (let t = 500 + 1000 / 120; t < 600; t += 1000 / 120) if (cap.allow(t, interval)) drawn++
    expect(drawn).toBeLessThanOrEqual(7)
  })

  it('starts again at once when the cap lifts (pause, export)', () => {
    const cap = createFrameCap()
    expect(cap.allow(0, 1000 / 30)).toBe(true)
    expect(cap.allow(1, 1000 / 30)).toBe(false)
    expect(cap.allow(2, 0)).toBe(true)
    expect(cap.allow(3, 1000 / 30)).toBe(true)
  })
})

describe('createRungGovernor', () => {
  const window = SLOW_PREVIEW_WINDOW_MS

  it('stays at rung 0 at 60 frames per second, goes to 1 under 30 over two seconds of playback, not before', () => {
    expect(play(createRungGovernor(), 16, window * 3)).toBe(0)
    expect(play(createRungGovernor(), 32, window * 3)).toBe(0)
    expect(play(createRungGovernor(), 50, window * 3 / 4)).toBe(0)
    expect(play(createRungGovernor(), 50, window)).toBe(1)
  })

  it('goes from 1 to 2 when the light preview stays under 24, holds at 25, and never goes past 2', () => {
    const governor = createRungGovernor()
    expect(play(governor, 50, window)).toBe(1)
    expect(play(governor, 40, window * 3, window + 40)).toBe(1)
    expect(play(governor, 50, window * 3, window * 4)).toBe(2)
    expect(play(governor, 200, window * 5, window * 8)).toBe(2)
  })

  it('judges the median: a few long frames (a tile decoded) do not count', () => {
    const governor = createRungGovernor()
    let rung = 0
    for (let i = 0, t = 0; t < window * 2; i++) {
      t += i % 10 === 0 ? 200 : 16
      rung = governor.frame(t)
    }
    expect(rung).toBe(0)
  })

  it('a pause (a gap over a second) starts the count again', () => {
    const governor = createRungGovernor()
    expect(play(governor, 50, window * 0.9)).toBe(0)
    expect(play(governor, 50, window * 0.9, 10_000)).toBe(0)
  })

  it('steps back one rung after several seconds at 50+ frames per second, not before, not at 40', () => {
    const governor = createRungGovernor()
    play(governor, 50, window) // rung 1
    play(governor, 50, window * 2, window + 1) // rung 2
    let t = window * 4
    expect(play(governor, 25, window * 6, t)).toBe(2)
    t += window * 6 + 5000
    expect(play(governor, 16, window * (RECOVER_WINDOWS - 1), t)).toBe(2)
    t += window * (RECOVER_WINDOWS - 1) + 5000
    expect(play(governor, 16, window * RECOVER_WINDOWS, t)).toBe(1)
  })

  it('a capped preview recovers at 90 % of its cap: 30 frames per second under a 30 cap steps back, 25 does not', () => {
    const light = () => {
      const governor = createRungGovernor()
      play(governor, 50, window)
      return governor
    }
    expect(play(light(), 33, window * (RECOVER_WINDOWS + 1), window + 100, 30)).toBe(0)
    expect(play(light(), 40, window * (RECOVER_WINDOWS + 3), window + 100, 30)).toBe(1)
    // without the cap told, 30 frames per second is not comfortable
    expect(play(light(), 33, window * (RECOVER_WINDOWS + 3), window + 100)).toBe(1)
  })

  it('does not flip-flop: the wait before each step back doubles', () => {
    const governor = createRungGovernor()
    let t = 0
    const run = (stepMs: number, durationMs: number) => {
      const rung = play(governor, stepMs, durationMs, t)
      t += durationMs + stepMs + 5000
      return rung
    }
    expect(run(50, window)).toBe(1)
    expect(run(16, window * RECOVER_WINDOWS)).toBe(0) // recovered after 3 windows
    expect(run(50, window)).toBe(1) // too slow again
    expect(run(16, window * RECOVER_WINDOWS)).toBe(1) // 3 windows are no longer enough
    expect(run(16, window * RECOVER_WINDOWS * 2)).toBe(0) // 6 are
  })
})
