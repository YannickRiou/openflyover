import { describe, expect, it } from 'vitest'
import { DESKTOP_BUDGET } from '../core/deviceBudget'
import { LIGHT_PREVIEW, SLOW_PREVIEW_WINDOW_MS, createSlowPreviewDetector, previewBudget, previewIsLight } from './previewQuality'

/** Feeds frames `stepMs` apart for `durationMs`; whether the detector found the preview slow. */
function play(detector: ReturnType<typeof createSlowPreviewDetector>, stepMs: number, durationMs: number, from = 0): boolean {
  let slow = false
  for (let t = from; t <= from + durationMs; t += stepMs) slow = detector.frame(t) || slow
  return slow
}

describe('previewBudget', () => {
  it('a computer keeps its preview, a light one draws a phone’s pixels and clouds', () => {
    expect(previewBudget(DESKTOP_BUDGET, false)).toEqual({ maxPixelRatio: 2, movingPixelRatio: 2, cloudResolutionScale: 1, cloudSettleFrames: 32 })
    expect(previewBudget(DESKTOP_BUDGET, true)).toEqual(LIGHT_PREVIEW)
    // a device already lower keeps its own
    expect(previewBudget({ maxPixelRatio: 1.5, movingPixelRatio: 1, cloudResolutionScale: 0.25, cloudSettleFrames: 8 }, true)).toEqual({
      maxPixelRatio: 1.5,
      movingPixelRatio: 1,
      cloudResolutionScale: 0.25,
      cloudSettleFrames: 8,
    })
  })

  it('« Auto » is light once measured slow, « Légère » and « Complète » whatever the measure', () => {
    expect(previewIsLight('auto', false)).toBe(false)
    expect(previewIsLight('auto', true)).toBe(true)
    expect(previewIsLight('light', false)).toBe(true)
    expect(previewIsLight('full', true)).toBe(false)
  })
})

describe('createSlowPreviewDetector', () => {
  it('slow under 30 frames per second over two seconds of playback, not above', () => {
    expect(play(createSlowPreviewDetector(), 1000 / 60, SLOW_PREVIEW_WINDOW_MS * 3)).toBe(false)
    expect(play(createSlowPreviewDetector(), 1000 / 31, SLOW_PREVIEW_WINDOW_MS * 3)).toBe(false)
    expect(play(createSlowPreviewDetector(), 1000 / 20, SLOW_PREVIEW_WINDOW_MS * 3)).toBe(true)
    // not before the window is played
    expect(play(createSlowPreviewDetector(), 1000 / 20, SLOW_PREVIEW_WINDOW_MS / 2)).toBe(false)
  })

  it('judges the median: a few long frames (a tile decoded) do not count', () => {
    const detector = createSlowPreviewDetector()
    let slow = false
    for (let i = 0, t = 0; t < SLOW_PREVIEW_WINDOW_MS * 2; i++) {
      t += i % 10 === 0 ? 200 : 1000 / 60
      slow = detector.frame(t) || slow
    }
    expect(slow).toBe(false)
  })

  it('a pause (a gap over a second) starts the count again', () => {
    const detector = createSlowPreviewDetector()
    expect(play(detector, 1000 / 20, SLOW_PREVIEW_WINDOW_MS * 0.9)).toBe(false)
    expect(play(detector, 1000 / 20, SLOW_PREVIEW_WINDOW_MS * 0.9, 10_000)).toBe(false)
  })
})
