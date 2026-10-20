import { describe, expect, it } from 'vitest'
import { WORK_AREA_MIN_S, clampWorkArea, dragWorkArea, loopTime, markIn, markOut } from './workArea'

const TOTAL = 70

describe('work area', () => {
  it('keeps an area inside the film, to a tenth, at least WORK_AREA_MIN_S long; none otherwise', () => {
    expect(clampWorkArea({ inS: 10.04, outS: 20.06 }, TOTAL)).toEqual({ inS: 10, outS: 20.1 })
    expect(clampWorkArea({ inS: -5, outS: 500 }, TOTAL)).toEqual({ inS: 0, outS: TOTAL })
    expect(clampWorkArea({ inS: 10, outS: 10 + WORK_AREA_MIN_S - 0.1 }, TOTAL)).toBeNull()
    expect(clampWorkArea({ inS: 30, outS: 10 }, TOTAL)).toBeNull()
    expect(clampWorkArea(null, TOTAL)).toBeNull()
    // the film got shorter: the area follows it, or goes
    expect(clampWorkArea({ inS: 10, outS: 60 }, 40)).toEqual({ inS: 10, outS: 40 })
    expect(clampWorkArea({ inS: 50, outS: 60 }, 40)).toBeNull()
  })

  it('I and O: the first sets one end and the other stays at the edge of the film', () => {
    expect(markIn(null, 12, TOTAL)).toEqual({ inS: 12, outS: TOTAL })
    expect(markOut(null, 30, TOTAL)).toEqual({ inS: 0, outS: 30 })
    const area = { inS: 12, outS: 30 }
    expect(markIn(area, 20, TOTAL)).toEqual({ inS: 20, outS: 30 })
    expect(markOut(area, 45, TOTAL)).toEqual({ inS: 12, outS: 45 })
    // past the other end: that end goes to the edge of the film
    expect(markIn(area, 40, TOTAL)).toEqual({ inS: 40, outS: TOTAL })
    expect(markOut(area, 5, TOTAL)).toEqual({ inS: 0, outS: 5 })
    // at the very end of the film: no room for an area
    expect(markIn(null, TOTAL, TOTAL)).toBeNull()
    expect(markOut(null, 0, TOTAL)).toBeNull()
  })

  it('dragging an end never brings it closer than WORK_AREA_MIN_S to the other', () => {
    const area = { inS: 10, outS: 20 }
    expect(dragWorkArea(area, 'in', 15, TOTAL)).toEqual({ inS: 15, outS: 20 })
    expect(dragWorkArea(area, 'in', 99, TOTAL)).toEqual({ inS: 20 - WORK_AREA_MIN_S, outS: 20 })
    expect(dragWorkArea(area, 'in', -4, TOTAL)).toEqual({ inS: 0, outS: 20 })
    expect(dragWorkArea(area, 'out', 3, TOTAL)).toEqual({ inS: 10, outS: 10 + WORK_AREA_MIN_S })
    expect(dragWorkArea(area, 'out', 99, TOTAL)).toEqual({ inS: 10, outS: TOTAL })
  })

  it('the playback comes back to the in point as far as it went past the out point; only when it crosses it', () => {
    const area = { inS: 10, outS: 20 }
    expect(loopTime(19.9, 20.1, area)).toBeCloseTo(10.1, 9)
    expect(loopTime(19.9, 20, area)).toBe(10)
    expect(loopTime(5, 8, area)).toBeNull()
    expect(loopTime(12, 15, area)).toBeNull()
    // already past it (started after the out point): plays on
    expect(loopTime(25, 26, area)).toBeNull()
    // a step longer than the area wraps as often as needed
    expect(loopTime(19, 43, area)).toBeCloseTo(10 + (43 - 20) % 10, 9)
    // always back inside the area
    for (const to of [20, 20.5, 29.9, 30, 31]) {
      const t = loopTime(19.5, to, area)
      expect(t).toBeGreaterThanOrEqual(area.inS)
      expect(t).toBeLessThan(area.outS)
    }
  })
})
