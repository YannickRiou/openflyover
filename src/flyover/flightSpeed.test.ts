import { describe, expect, it } from 'vitest'
import { FLYOVER_DURATION_RANGE } from './cameraSettings'
import {
  clampDuration,
  durationAtPosition,
  durationForKmh,
  durationForSpeedUp,
  hasSpeedUp,
  kmhRange,
  speedKmh,
  speedPosition,
  speedUpFactor,
  speedUpRange,
  SPEED_POSITIONS,
} from './flightSpeed'

const { min, max } = FLYOVER_DURATION_RANGE

describe('duration <-> speed', () => {
  it('km/h is the length over the duration; none without a length', () => {
    expect(speedKmh(10_000, 120)).toBeCloseTo(300)
    expect(speedKmh(0, 120)).toBeUndefined()
    expect(speedKmh(10_000, 0)).toBeUndefined()
  })

  it('« × temps réel » is the recorded time over the duration; none for an outing without times', () => {
    expect(speedUpFactor(4 * 3600, 60)).toBe(240)
    expect(speedUpFactor(undefined, 60)).toBeUndefined()
    expect(speedUpFactor(0, 60)).toBeUndefined()
  })

  it('a speed gives back the duration, in whole seconds', () => {
    expect(durationForKmh(10_000, 300)).toBe(120)
    expect(durationForSpeedUp(4 * 3600, 240)).toBe(60)
    // 14400 / 7 = 2057 s: over the range, brought back to it
    expect(durationForSpeedUp(4 * 3600, 7)).toBe(max)
    expect(durationForKmh(10_000, 1)).toBe(max)
    // faster than the shortest flyover allows
    expect(durationForKmh(10_000, 100_000)).toBe(min)
    expect(durationForSpeedUp(4 * 3600, 10_000)).toBe(min)
    // 3600 / 7 = 514.28 s
    expect(durationForSpeedUp(3600, 7)).toBe(514)
  })

  it('round trip: the duration of the displayed speed is the duration, for every whole second', () => {
    for (let d = min; d <= max; d++) {
      expect(durationForKmh(190_000, speedKmh(190_000, d)!)).toBe(d)
      expect(durationForSpeedUp(86_400, speedUpFactor(86_400, d)!)).toBe(d)
    }
  })

  it('nothing for an unusable speed or length', () => {
    expect(durationForKmh(0, 50)).toBeUndefined()
    expect(durationForKmh(10_000, 0)).toBeUndefined()
    expect(durationForKmh(10_000, Number.NaN)).toBeUndefined()
    expect(durationForSpeedUp(undefined, 20)).toBeUndefined()
    expect(durationForSpeedUp(3600, -1)).toBeUndefined()
  })

  it('clamps and rounds a duration', () => {
    expect(clampDuration(1)).toBe(min)
    expect(clampDuration(10_000)).toBe(max)
    expect(clampDuration(47.6)).toBe(48)
    expect(clampDuration(Number.NaN)).toBe(min)
  })

  it('the gabarits of the film automatique stay inside the range (24 s, 50 s, 168 s)', () => {
    for (const d of [24, 50, 168]) expect(clampDuration(d)).toBe(d)
  })

  it('multi-track film: the length of everything flown gives the speed', () => {
    // three stages of 30, 50 and 20 km over 5 minutes
    expect(speedKmh(30_000 + 50_000 + 20_000, 300)).toBeCloseTo(1200)
    expect(durationForKmh(100_000, 1200)).toBe(300)
  })
})

describe('typed ranges', () => {
  it('speed-up: from the longest to the shortest flyover, whole numbers', () => {
    // 4 h: 14400 / 600 = 24 to 14400 / 15 = 960
    expect(speedUpRange(4 * 3600)).toEqual({ min: 24, max: 960, step: 1 })
    // 1 h: 6 (6 s short of whole = rounded up) to 240
    expect(speedUpRange(3600)).toEqual({ min: 6, max: 240, step: 1 })
  })

  it('km/h: tenths for slow flyovers, whole numbers above 100 km/h; never inverted', () => {
    expect(kmhRange(10_000)).toEqual({ min: 60, max: 2400, step: 1 })
    expect(kmhRange(200)).toEqual({ min: 1.2, max: 48, step: 0.1 })
    const tiny = kmhRange(1)
    expect(tiny.max).toBeGreaterThanOrEqual(tiny.min)
  })

  it('« × temps réel » is offered only for an outing at least as long as the shortest flyover', () => {
    expect(hasSpeedUp(undefined)).toBe(false)
    expect(hasSpeedUp(10)).toBe(false)
    expect(hasSpeedUp(15)).toBe(true)
  })
})

describe('speed slider (log scale over the duration range)', () => {
  it('ends are the longest (slowest) and the shortest (fastest) duration', () => {
    expect(durationAtPosition(0)).toBe(max)
    expect(durationAtPosition(SPEED_POSITIONS)).toBe(min)
    expect(speedPosition(max)).toBe(0)
    expect(speedPosition(min)).toBe(SPEED_POSITIONS)
  })

  it('is geometric: the middle is the geometric mean of the ends', () => {
    expect(durationAtPosition(SPEED_POSITIONS / 2)).toBe(Math.round(Math.sqrt(min * max)))
  })

  it('faster to the right, and positions outside the slider are brought in', () => {
    expect(durationAtPosition(300)).toBeGreaterThan(durationAtPosition(700))
    expect(durationAtPosition(-5)).toBe(max)
    expect(durationAtPosition(5_000)).toBe(min)
  })

  it('a duration read back from its position is within a second, between the notches', () => {
    for (const d of [24, 50, 60, 168, 300]) expect(Math.abs(durationAtPosition(speedPosition(d)) - d)).toBeLessThanOrEqual(1)
  })
})
