import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import { cumulativeAscent } from '../overlay/data'
import { filmClockFor } from './clock'
import { dayFigures, isDayCard, localDate, trackDays, withoutDayCards } from './days'
import { DEFAULT_DAY_CARDS, DEFAULT_FILM } from './model'
import type { Film } from './model'

const HOUR = 3_600_000
/** 1 June 2026, 00:00 UTC */
const DAY1 = Date.UTC(2026, 5, 1)

/** A point every 30 min from `fromH` to `toH` (hours since DAY1, UTC), 1 km east per point. */
function ride(fromH: number, toH: number, lon0: number): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let t = fromH * HOUR, k = 0; t <= toH * HOUR; t += HOUR / 2, k++) points.push({ lon: lon0 + k / 77.35, lat: 45.92, time: DAY1 + t })
  return points
}

const day1 = ride(8, 18, 6.8)
const day2 = ride(30, 34, day1[day1.length - 1].lon)
const track = { ...buildTrack({ name: 'deux jours', source: 'gpx', segments: [{ points: day1 }, { points: day2 }] }), utcOffsetMin: 120 }
const path = buildTrackPath(track)

describe('days of a track', () => {
  it('split on the local calendar date of the recorded times', () => {
    expect(localDate(DAY1 + 23 * HOUR, 120)).toBe('2026-06-02')
    expect(localDate(DAY1 + 21 * HOUR, 120)).toBe('2026-06-01')
    const days = trackDays(path, track.utcOffsetMin)
    expect(days.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02'])
    expect(days[0].startM).toBe(0)
    expect(days[0].endM).toBe(days[1].startM)
    expect(days[1].endM).toBe(path.lengthM)
    // the second day starts with its first point: the evening's last point stays on the first day
    expect(days[1].startM).toBe(path.dist[day1.length])
  })

  it('a single day, or no time: no split', () => {
    const one = buildTrack({ name: 'jour', source: 'gpx', segments: [{ points: day1 }] })
    expect(trackDays(buildTrackPath(one))).toHaveLength(1)
    const untimed = buildTrack({ name: 'sans heure', source: 'gpx', segments: [{ points: day1.map(({ lon, lat }) => ({ lon, lat })) }] })
    expect(trackDays(buildTrackPath(untimed))).toEqual([])
  })
})

describe('day figures', () => {
  const days = trackDays(path, track.utcOffsetMin)
  const figures = dayFigures(path, days, cumulativeAscent(track), null, track.utcOffsetMin)

  it('distance, first recorded time and time of each day', () => {
    expect(figures.map((f) => [f.n, f.count, f.date])).toEqual([[1, 2, '2026-06-01'], [2, 2, '2026-06-02']])
    expect(figures[0].distanceM).toBeCloseTo(days[0].endM, 6)
    expect(figures[1].distanceM).toBeCloseTo(path.lengthM - days[1].startM, 6)
    expect(figures[0].startTime).toBe(DAY1 + 8 * HOUR)
    expect(figures[1].startTime).toBe(DAY1 + 30 * HOUR)
    // 8 h to 18 h, then 30 h to 34 h: from the first to the last point of each day
    expect(figures[0].durationS).toBeCloseTo(10 * 3600, 0)
    expect(figures[1].durationS).toBeCloseTo(4 * 3600, 0)
    expect(figures[0].weather).toBeUndefined()
  })

  it('climb of a day: the cumulative ascent between its first and last point; none without elevations', () => {
    const climbing = dayFigures(path, days, Float64Array.from({ length: path.count }, (_, i) => i * 10), null, track.utcOffsetMin)
    expect(climbing[0].ascentM).toBeCloseTo((day1.length - 1) * 10, 6)
    expect(climbing[1].ascentM).toBeCloseTo((day2.length - 1) * 10, 6)
    expect(figures[0].ascentM).toBe(0)
    expect(dayFigures(path, days, undefined, null, track.utcOffsetMin)[0].ascentM).toBeUndefined()
  })
})

describe('days on the film clock', () => {
  const film: Film = { ...DEFAULT_FILM, autoStops: false, dayCards: { ...DEFAULT_DAY_CARDS, enabled: true } }
  const clockOf = (f: Film) => filmClockFor({ track, film: f, durationS: 60, pacing: DEFAULT_PACING })

  it('none while the cards are off or for a single day', () => {
    expect(clockOf({ ...film, dayCards: undefined }).days).toEqual([])
    expect(clockOf({ ...film, dayCards: { ...DEFAULT_DAY_CARDS, enabled: false } }).days).toEqual([])
  })

  it('a card with the flight for the first day, once the night pause ends for the next', () => {
    const clock = clockOf(film)
    expect(clock.nights).toHaveLength(1)
    expect(clock.days.map((d) => d.cardS)).toEqual([clock.openingS, clock.nights[0].holdEndS])
    expect(clock.days[1].night).toBe(clock.nights[0])
    expect(clock.days.every((d) => !d.view)).toBe(true)
  })

  it('with the high view, the card of the next day comes as the night pause starts', () => {
    const clock = clockOf({ ...film, dayCards: { ...DEFAULT_DAY_CARDS, enabled: true, view: true } })
    expect(clock.days[1].cardS).toBe(clock.nights[0].holdStartS)
    expect(clock.days.map((d) => d.view)).toEqual([false, true])
  })
})

describe('withoutDayCards', () => {
  it('drops the cards earlier versions baked into the texts, keeps the other texts', () => {
    const own = { id: 'text-1', startS: 2, durationS: 4, text: 'Départ', anchor: 'bottom-left' as const, size: 1 }
    const baked = { id: 'day-1', startS: 0, durationS: 5, text: 'Jour 1', anchor: 'center' as const, size: 1.25 }
    expect(isDayCard(baked)).toBe(true)
    const film: Film = { ...DEFAULT_FILM, texts: [own, baked, { ...baked, id: 'day-2' }] }
    expect(withoutDayCards(film).texts).toEqual([own])
    const none: Film = { ...DEFAULT_FILM, texts: [own] }
    expect(withoutDayCards(none)).toBe(none)
  })
})
