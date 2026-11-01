import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACK_RIBBON, TRACK_RIBBON_HEIGHT_RANGE, isValidTrackRibbon } from './markerSettings'
import { RIBBON_MIN_SHARE, ribbonFractions, ribbonHeightM } from './trackRibbon'

describe('ribbon values', () => {
  it('gives the share of the range of each value, unknown ones staying unknown', () => {
    const fractions = ribbonFractions([0, 5, 10, 20, -3, Number.NaN], { min: 0, max: 10 })
    expect([...fractions].slice(0, 5)).toEqual([0, 0.5, 1, 1, 0])
    expect(fractions[5]).toBeNaN()
    // no spread: the middle; no range: nothing known
    expect([...ribbonFractions([4, 4], { min: 4, max: 4 })]).toEqual([0.5, 0.5])
    expect(ribbonFractions([1], null)[0]).toBeNaN()
  })

  it('stands the lowest value at a minimum height, the highest at the full height, and no wall without value', () => {
    expect(ribbonHeightM(0, 200)).toBeCloseTo(200 * RIBBON_MIN_SHARE, 10)
    expect(ribbonHeightM(1, 200)).toBeCloseTo(200, 10)
    expect(ribbonHeightM(Number.NaN, 200)).toBe(0)
  })
})

describe('ribbon settings', () => {
  it('accepts the defaults, a metric of the colouring and a height in range; nothing else', () => {
    expect(DEFAULT_TRACK_RIBBON.enabled).toBe(false)
    expect(isValidTrackRibbon(DEFAULT_TRACK_RIBBON)).toBe(true)
    expect(isValidTrackRibbon({ ...DEFAULT_TRACK_RIBBON, metric: 'heartRate', heightM: TRACK_RIBBON_HEIGHT_RANGE.max })).toBe(true)
    expect(isValidTrackRibbon({ ...DEFAULT_TRACK_RIBBON, metric: 'none' as never })).toBe(false)
    expect(isValidTrackRibbon({ ...DEFAULT_TRACK_RIBBON, metric: 'pression' as never })).toBe(false)
    expect(isValidTrackRibbon({ ...DEFAULT_TRACK_RIBBON, heightM: 5 })).toBe(false)
  })
})
