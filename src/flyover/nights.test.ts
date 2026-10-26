import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { filmClockFor } from '../film/clock'
import { DEFAULT_FILM, DEFAULT_NIGHTS } from '../film/model'
import type { Film } from '../film/model'
import { buildTrack } from '../import/stats'
import { hasFilmItem, removeFilmItem } from '../film/timeline'
import { flightNights, isNightItem, nightItemId, nightKey, nightPauseS, trackNights } from './nights'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath, recordedTimeAt } from './path'
import { NIGHT_DARK_MARGIN_MS, nightAt, nightSunDate, sunTimes } from './sun'

const HOUR = 3_600_000
const MIN = 60_000
/** 1 June 2026, 00:00 UTC */
const DAY1 = Date.UTC(2026, 5, 1)
const LAT = 45.92

/** A point every 10 min from `fromH` to `toH` (hours since DAY1, UTC), going east `kmPerStep` each step from `lon0`. */
function ride(fromH: number, toH: number, lon0: number, kmPerStep = 1): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let t = fromH * HOUR, k = 0; t <= toH * HOUR; t += 10 * MIN, k++) {
    points.push({ lon: lon0 + (k * kmPerStep) / 77.5, lat: LAT, time: DAY1 + t })
  }
  return points
}

/** Two days in the Alps, resting overnight from 18:00 to 06:00 UTC (sunset ~19:30, sunrise ~03:30). */
function twoDays(oneSegment = true) {
  const day1 = ride(8, 18, 6.8)
  const day2 = ride(30, 40, day1[day1.length - 1].lon)
  const segments = oneSegment ? [{ points: [...day1, ...day2] }] : [{ points: day1 }, { points: day2 }]
  return buildTrack({ name: 'deux jours', source: 'gpx', segments })
}

describe('trackNights', () => {
  it('finds the night between sunset and sunrise, placed in the rest between the two days', () => {
    for (const oneSegment of [true, false]) {
      const track = twoDays(oneSegment)
      const path = buildTrackPath(track)
      const nights = trackNights(path)
      expect(nights).toHaveLength(1)
      const [night] = nights
      expect(night.fromMs).toBe(DAY1 + 18 * HOUR)
      expect(night.toMs).toBe(DAY1 + 30 * HOUR)
      const times = sunTimes(LAT, 6.9, new Date(DAY1))
      expect(Math.abs(night.sunsetMs - times.sunset!.getTime())).toBeLessThan(5 * MIN)
      expect(night.sunriseMs).toBeGreaterThan(DAY1 + 24 * HOUR)
      expect(night.sunriseMs).toBeLessThan(DAY1 + 30 * HOUR)
      // the rest: no distance between the last point of the evening and the first of the morning
      const restM = path.dist[day1Count(path)]
      expect(night.atM).toBeCloseTo(restM, 3)
      expect(night.nightM).toBeCloseTo(0, 3)
    }
  })

  it('none on a single day, nor for a night not wholly recorded (a start before sunrise)', () => {
    expect(trackNights(buildTrackPath(buildTrack({ name: 'jour', source: 'gpx', segments: [{ points: ride(8, 18, 6.8) }] })))).toEqual([])
    const dawn = buildTrack({ name: 'aube', source: 'gpx', segments: [{ points: ride(2, 18, 6.8) }] })
    expect(trackNights(buildTrackPath(dawn))).toEqual([])
    const untimed = buildTrack({ name: 'sans heure', source: 'gpx', segments: [{ points: ride(8, 18, 6.8).map(({ lon, lat }) => ({ lon, lat })) }] })
    expect(trackNights(buildTrackPath(untimed))).toEqual([])
  })
})

/** Index of the first point of the second day in `twoDays`. */
const day1Count = (path: ReturnType<typeof buildTrackPath>) => path.time.findIndex((t) => t > DAY1 + 18 * HOUR)

describe('flightNights', () => {
  it('a night spent riding is shown by the flight: no pause', () => {
    const allNight = buildTrack({ name: 'nuit', source: 'gpx', segments: [{ points: ride(8, 40, 6.8, 2) }] })
    const path = buildTrackPath(allNight)
    expect(trackNights(path)).toHaveLength(1)
    expect(flightNights(path, DEFAULT_NIGHTS, 60)).toEqual([])
  })

  it('off, or with parts of 0 s: no pause', () => {
    const path = buildTrackPath(twoDays())
    expect(flightNights(path, DEFAULT_NIGHTS, 60)).toHaveLength(1)
    expect(flightNights(path, { ...DEFAULT_NIGHTS, enabled: false }, 60)).toEqual([])
    expect(flightNights(path, { enabled: true, duskS: 0, nightS: 0, dawnS: 0 }, 60)).toEqual([])
  })

  it('a night removed by hand (`skipped`, its sunset date) is left out; the others stay', () => {
    const path = buildTrackPath(twoDays())
    const [night] = trackNights(path)
    expect(nightKey(night)).toBe('2026-06-01')
    expect(flightNights(path, { ...DEFAULT_NIGHTS, skipped: ['2026-06-01'] }, 60)).toEqual([])
    expect(flightNights(path, { ...DEFAULT_NIGHTS, skipped: ['2026-06-02'] }, 60)).toHaveLength(1)
  })

  it('removing the block of a night on the timeline adds its key to `skipped`: the film loses the pause, the item is gone', () => {
    const track = twoDays()
    const film: Film = { ...DEFAULT_FILM, autoStops: false }
    const clockOf = (f: Film) => filmClockFor({ track, film: f, durationS: 60, pacing: DEFAULT_PACING })
    const [night] = clockOf(film).nights
    const id = nightItemId(night)
    expect(isNightItem(id)).toBe(true)
    expect(hasFilmItem(film, [], id, [], clockOf(film).nights)).toBe(true)
    const removed = removeFilmItem(film, id)
    expect(removed.nights.skipped).toEqual(['2026-06-01'])
    expect(clockOf(removed).nights).toEqual([])
    expect(clockOf(removed).totalTime()).toBeCloseTo(clockOf(film).totalTime() - nightPauseS(DEFAULT_NIGHTS), 9)
    expect(hasFilmItem(removed, [], id, [], clockOf(removed).nights)).toBe(false)
  })
})

describe('night pause on the film clock', () => {
  const track = twoDays()
  const path = buildTrackPath(track)
  const film: Film = { ...DEFAULT_FILM, autoStops: false, opening: { style: 'aucune', durationS: 6 }, closing: { style: 'aucune', durationS: 5 } }
  const pacing = { ...DEFAULT_PACING, keepDuration: true }
  const clock = filmClockFor({ track, film, durationS: 60, pacing })
  const off = filmClockFor({ track, film: { ...film, nights: { ...DEFAULT_NIGHTS, enabled: false } }, durationS: 60, pacing })

  it('adds dusk + night + dawn to the film whatever « Garder la durée », in the flight phase, the marker held', () => {
    expect(off.nights).toEqual([])
    expect(off.totalTime()).toBeCloseTo(60, 9)
    expect(clock.nights).toHaveLength(1)
    expect(clock.totalTime()).toBeCloseTo(60 + nightPauseS(DEFAULT_NIGHTS), 9)
    const [night] = clock.nights
    const middle = (night.holdStartS + night.holdEndS) / 2
    expect(clock.stateAt(middle)).toMatchObject({ phase: 'flight', stop: null })
    expect(clock.progressAtTime(night.holdStartS)).toBeCloseTo(clock.progressAtTime(night.holdEndS), 12)
    expect(clock.stops).toEqual([])
    expect(nightAt(clock, middle)).toBe(night)
    expect(nightAt(clock, night.endS + 0.01)).toBeNull()
  })

  it('the sun sets, the night passes and the sun rises during the pause, joining the flight at both ends', () => {
    const [night] = clock.nights
    const sunAt = (progress: number) => new Date(recordedTimeAt(path, progress * path.lengthM)!)
    const date = (t: number) => nightSunDate(clock, t, clock.progressAtTime(t), sunAt).getTime()
    // outside the pause: the flight's sun
    expect(date(night.startS - 0.5)).toBe(sunAt(clock.progressAtTime(night.startS - 0.5)).getTime())
    // continuous at both ends
    expect(Math.abs(date(night.startS) - date(night.startS - 1e-6))).toBeLessThan(MIN)
    expect(Math.abs(date(night.endS) - date(night.endS - 1e-6))).toBeLessThan(MIN)
    // full darkness after the dusk part, the end of the dark after the night part
    const scale = (night.endS - night.startS) / nightPauseS(night)
    const darkS = night.startS + night.duskS * scale
    const lightS = darkS + night.nightS * scale
    expect(date(darkS)).toBeCloseTo(night.sunsetMs + NIGHT_DARK_MARGIN_MS, -3)
    expect(date(lightS)).toBeCloseTo(night.sunriseMs - NIGHT_DARK_MARGIN_MS, -3)
    // never backwards
    let previous = -Infinity
    for (let t = night.startS - 1; t <= night.endS + 1; t += 0.05) {
      expect(date(t)).toBeGreaterThanOrEqual(previous)
      previous = date(t)
    }
  })
})
