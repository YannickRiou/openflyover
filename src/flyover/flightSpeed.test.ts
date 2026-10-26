import { describe, expect, it } from 'vitest'
import { buildFilmClock } from '../film/clock'
import { DEFAULT_NIGHTS } from '../film/model'
import { buildTrack } from '../import/stats'
import { maintainerOuting } from './__fixtures__/maintainerOuting'
import { FLYOVER_DURATION_RANGE } from './cameraSettings'
import { flightNights } from './nights'
import { DEFAULT_PACING } from './pacing'
import { trackPathOf } from './path'
import {
  clampDuration,
  durationAtPosition,
  durationAtSliderPosition,
  durationForKmh,
  durationForSpeedUp,
  flightExtras,
  hasSpeedUp,
  kmhRange,
  movingDistanceM,
  movingTimeS,
  movingTotalS,
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

describe('recorded time of a sequence', () => {
  it('sums the stages’ own durations, not the span from the first start to the last end', () => {
    // two days of 1 h and 2 h: 3 h recorded, whatever the night between them
    expect(movingTotalS([3600, 7200])).toBe(10_800)
    expect(movingTotalS([5400])).toBe(5400)
  })

  it('is none when a stage has no times, or nothing is flown', () => {
    expect(movingTotalS([3600, undefined])).toBeUndefined()
    expect(movingTotalS([3600, 0])).toBeUndefined()
    expect(movingTotalS([])).toBeUndefined()
  })
})

describe('arrow keys on the speed slider', () => {
  it('one notch either way always changes the duration by at least a second, across the range', () => {
    for (let d = min; d <= max; d++) {
      const p = speedPosition(d)
      // right = faster = shorter
      if (d > min) expect(durationAtSliderPosition(p + 1, d)).toBeLessThan(d)
      if (d < max) expect(durationAtSliderPosition(p - 1, d)).toBeGreaterThan(d)
    }
  })

  it('a drag far from the current notch is the position asked, and staying put changes nothing', () => {
    expect(durationAtSliderPosition(500, 60)).toBe(durationAtPosition(500))
    expect(durationAtSliderPosition(speedPosition(60), 60)).toBe(60)
  })
})

describe('moving time of an outing', () => {
  const outing = maintainerOuting()

  it('leaves the lunch, the bivouac and the gaps out: 8 h of walking in a file of 24 h 33', () => {
    expect(outing.stats.durationS).toBe((200 + 60 + 100 + 918 + 195) * 60)
    // 495 minutes of walking
    expect(movingTimeS(outing)).toBeGreaterThanOrEqual(495 * 60)
    expect(movingTimeS(outing)).toBeLessThan(500 * 60 + 1)
    expect(outing.stats.distanceM).toBeGreaterThan(16_400)
    expect(outing.stats.distanceM).toBeLessThan(16_600)
  })

  it('is the elapsed time when nothing stops, the figure typed in « Corriger les chiffres » when there is one, none without times', () => {
    const walk = buildTrack({ name: 'a', source: 'gpx', segments: [{ points: Array.from({ length: 11 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.001, ele: 0, time: i * 60_000 })) }] })
    expect(movingTimeS(walk)).toBe(600)
    expect(movingTimeS({ ...walk, statsOverride: { durationS: 5400 } })).toBe(5400)
    const planned = buildTrack({ name: 'a', source: 'gpx', segments: [{ points: Array.from({ length: 11 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.001, ele: 0 })) }] })
    expect(movingTimeS(planned)).toBeUndefined()
  })

  it('does not count the gap between two segments (a night of chained days)', () => {
    const day = (from: number) => ({ points: Array.from({ length: 11 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.001, ele: 0, time: from + i * 60_000 })) })
    const two = buildTrack({ name: 'a', source: 'gpx', segments: [day(0), day(86_400_000)] })
    expect(movingTimeS(two)).toBe(1200)
  })
})

describe('recording gaps and the distance of the pace', () => {
  it('a 12 h gap in one segment, the first fix 200 m after the restart, is not moving time', () => {
    const walk = (from: number, lat0: number) => Array.from({ length: 31 }, (_, i) => ({ lon: 6, lat: lat0 + i * 0.0002, ele: 0, time: from + i * 60_000 }))
    const before = walk(0, 45)
    const lastLat = before[before.length - 1].lat
    // the recorder was off 12 h; the first fix after it is about 200 m further
    const after = walk(30 * 60_000 + 12 * 3_600_000, lastLat + 0.0018)
    const track = buildTrack({ name: 'a', source: 'gpx', segments: [{ points: [...before, ...after] }] })
    expect(track.stats.durationS).toBe((30 + 720 + 30) * 60)
    expect(movingTimeS(track)).toBeCloseTo(60 * 60, -1)
    // the gap of a stop that is already a pause is not taken twice
    expect(movingTimeS(maintainerOuting())).toBe(495 * 60)
  })

  it('the corrected distance goes with a corrected duration, the file\'s with its own', () => {
    const track = buildTrack({ name: 'a', source: 'gpx', segments: [{ points: Array.from({ length: 11 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.001, ele: 0, time: i * 60_000 })) }] })
    expect(movingDistanceM(track)).toBe(track.stats.distanceM)
    expect(movingDistanceM({ ...track, statsOverride: { distanceM: 5000 } })).toBe(track.stats.distanceM)
    expect(movingDistanceM({ ...track, statsOverride: { durationS: 3600, distanceM: 5000 } })).toBe(5000)
  })
})

describe('flightExtras when the flight is shorter than the duration set', () => {
  it('gives a negative difference, with no night nor stop added', () => {
    expect(flightExtras({ flightS: 20, durationS: 25, keepDuration: false, stopsAddedS: 0, nightsS: [] })).toEqual({ deltaS: -5, nights: 0, nightsS: 0, stopsS: 0, otherS: 0 })
    expect(flightExtras({ flightS: 25.2, durationS: 25, keepDuration: true, stopsAddedS: 0, nightsS: [] })).toBeUndefined()
  })
})

describe('the two reports of 4.2.0 (16.5 km walked at 2 km/h, 24 h 33 in the file)', () => {
  const outing = maintainerOuting()
  const lengthM = outing.stats.distanceM
  const movingS = movingTimeS(outing)!

  it('« 100 km/h » reads about × 50 of the real pace (not × 149 of the file), and the walk is 2 km/h', () => {
    const durationS = durationForKmh(lengthM, 100)!
    expect(durationS).toBeGreaterThan(590)
    expect(durationS).toBeLessThan(600)
    expect(speedUpFactor(movingS, durationS)).toBeGreaterThan(49)
    expect(speedUpFactor(movingS, durationS)).toBeLessThan(51)
    expect(speedUpFactor(outing.stats.durationS, durationS)).toBeGreaterThan(148)
    expect(speedKmh(lengthM, movingS)).toBeCloseTo(2, 1)
  })

  it('round trip: × 50 gives the duration whose speed is 100 km/h, and back', () => {
    const durationS = durationForSpeedUp(movingS, 50)!
    expect(speedKmh(lengthM, durationS)).toBeCloseTo(100, -1)
    expect(speedUpFactor(movingS, durationS)).toBeCloseTo(50, 0)
    expect(durationForKmh(lengthM, speedKmh(lengthM, durationS)!)).toBe(durationS)
  })

  // the stop of the report, at 8 km, and a slow portion around 5 km
  const clockOf = (keepDuration: boolean, durationS = 25) => {
    const nights = flightNights(trackPathOf(outing), DEFAULT_NIGHTS, durationS)
    return {
      nights,
      clock: buildFilmClock({
        opening: { style: 'aucune', durationS: 5 },
        closing: { style: 'aucune', durationS: 6 },
        stops: [{ id: 's', atM: 8000, durationS: 4.5, camera: 'fixe' }],
        nights,
        lengthM,
        speeds: [{ id: 'v', fromM: 4000, toM: 6000, factor: 0.5 }],
        durationS,
        pacing: { ...DEFAULT_PACING, keepDuration },
      }),
    }
  }

  it('« 25 s »: the flight is the 25 s set plus the night of the bivouac, the stop and the slow-down are taken inside', () => {
    const { nights, clock } = clockOf(true)
    expect(nights).toHaveLength(1)
    // 25 s + dusk 3 s + night 2 s + dawn 3 s: the 33 s block of the report, not the 25 s typed
    expect(clock.flightS).toBeCloseTo(33, 6)
    expect(clock.totalTime()).toBeCloseTo(clock.openingS + 33 + clock.closingS, 6)
    expect(flightExtras({ flightS: clock.flightS, durationS: 25, keepDuration: true, stopsAddedS: clock.stops[0].addedS, nightsS: [8] })).toEqual({ deltaS: 8, nights: 1, nightsS: 8, stopsS: 0, otherS: 0 })
  })

  it('without the night the flight lasts exactly the duration set, whatever the stop and the slow-down; unticked, they are added and named', () => {
    const kept = buildFilmClock({
      opening: { style: 'aucune', durationS: 5 },
      closing: { style: 'aucune', durationS: 6 },
      stops: [{ id: 's', atM: 8000, durationS: 4.5, camera: 'fixe' }],
      lengthM,
      speeds: [{ id: 'v', fromM: 4000, toM: 6000, factor: 0.5 }],
      durationS: 25,
      pacing: { ...DEFAULT_PACING, keepDuration: true },
    })
    expect(kept.flightS).toBeCloseTo(25, 6)
    expect(flightExtras({ flightS: kept.flightS, durationS: 25, keepDuration: true, stopsAddedS: kept.stops[0].addedS, nightsS: [] })).toBeUndefined()
    const { clock } = clockOf(false)
    const extras = flightExtras({ flightS: clock.flightS, durationS: 25, keepDuration: false, stopsAddedS: clock.stops[0].addedS, nightsS: [8] })!
    expect(extras.nightsS).toBe(8)
    expect(extras.stopsS).toBeCloseTo(4.5, 6)
    // the slow-down lengthens it too: the three add up to what the block lasts beyond 25 s
    expect(extras.nightsS + extras.stopsS + extras.otherS).toBeCloseTo(clock.flightS - 25, 6)
    expect(extras.otherS).toBeGreaterThan(0)
  })
})
