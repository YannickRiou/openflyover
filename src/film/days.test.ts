import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import { filmClockFor } from './clock'
import { DAY_CARD_S, isDayCard, localDate, trackDays, withDayCards } from './days'
import { DEFAULT_FILM } from './model'
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

describe('withDayCards', () => {
  const film: Film = { ...DEFAULT_FILM, autoStops: false }
  const clock = filmClockFor({ track, film, durationS: 60, pacing: DEFAULT_PACING })
  const days = trackDays(path, track.utcOffsetMin)
  const input = { days, lengthM: path.lengthM, utcOffsetMin: track.utcOffsetMin }

  it('one card per day: at the start of the flight, then once the night pause ends', () => {
    expect(clock.nights).toHaveLength(1)
    const next = withDayCards(film, input, clock, { day: true, total: true })
    expect(next.texts.map((t) => t.id)).toEqual(['day-1', 'day-2'])
    const [first, second] = next.texts
    expect(first).toMatchObject({ text: 'Jour 1', startS: clock.openingS, durationS: DAY_CARD_S, anchor: 'center' })
    expect(second.startS).toBeCloseTo(clock.nights[0].holdEndS, 1)
    expect(first.subtitle).toBe('20,0 km · 20,0 km au total')
    expect(second.subtitle).toBe('8,0 km · 28,0 km au total')
    expect(withDayCards(film, input, clock, { day: false, total: true }).texts[1].subtitle).toBe('28,0 km au total')
    expect(withDayCards(film, input, clock, { day: false, total: false }).texts[1].subtitle).toBeUndefined()
  })

  it('replaces the cards made before, keeps the other texts; none for a single day', () => {
    const own = { id: 'text-1', startS: 2, durationS: 4, text: 'Départ', anchor: 'bottom-left' as const, size: 1 }
    const once = withDayCards({ ...film, texts: [own] }, input, clock, { day: true, total: false })
    const twice = withDayCards(once, input, clock, { day: false, total: true })
    expect(twice.texts.filter(isDayCard)).toHaveLength(2)
    expect(twice.texts[0]).toBe(own)
    expect(withDayCards(twice, { ...input, days: days.slice(0, 1) }, clock, { day: true, total: false }).texts).toEqual([own])
  })
})
