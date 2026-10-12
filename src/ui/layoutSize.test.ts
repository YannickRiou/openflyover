import { describe, expect, it } from 'vitest'
import { STAGE_MIN_RATIO, clampTimelineHeight, parseTimelineHeight, timelineHeightRange } from './layoutSize'

describe('parseTimelineHeight', () => {
  it('reads the stored height', () => {
    expect(parseTimelineHeight('{"timelineH":240}')).toBe(240)
    expect(parseTimelineHeight('{"timelineH":240.6}')).toBe(241)
  })

  it('falls back to the default layout (null) on anything unusable', () => {
    for (const raw of [null, '', 'oops', 'null', '[]', '{}', '{"timelineH":"240"}', '{"timelineH":0}', '{"timelineH":-5}', '{"timelineH":null}']) {
      expect(parseTimelineHeight(raw)).toBeNull()
    }
  })
})

describe('timelineHeightRange', () => {
  it('keeps the view at least 35 % of the shared height', () => {
    const { min, max } = timelineHeightRange(1000)
    expect(max).toBe(Math.floor(1000 * (1 - STAGE_MIN_RATIO)))
    expect(min).toBeLessThan(max)
  })

  it('grows its minimum with a wrapped transport row', () => {
    expect(timelineHeightRange(1000, 70).min).toBeGreaterThan(timelineHeightRange(1000).min)
    // a row shorter than one line changes nothing
    expect(timelineHeightRange(1000, 10).min).toBe(timelineHeightRange(1000).min)
  })

  it('never has a maximum under the minimum, in a very short window', () => {
    const { min, max } = timelineHeightRange(120)
    expect(max).toBe(min)
  })
})

describe('clampTimelineHeight', () => {
  it('keeps a height within the range and rounds it', () => {
    const { min, max } = timelineHeightRange(800)
    expect(clampTimelineHeight(10, 800)).toBe(min)
    expect(clampTimelineHeight(5000, 800)).toBe(max)
    expect(clampTimelineHeight(300.4, 800)).toBe(300)
  })

  it('follows the window when it gets shorter', () => {
    expect(clampTimelineHeight(500, 600)).toBe(Math.floor(600 * (1 - STAGE_MIN_RATIO)))
  })
})
