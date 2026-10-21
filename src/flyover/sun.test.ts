import { describe, expect, it } from 'vitest'
import { buildFilmClock, filmClockFor } from '../film/clock'
import type { ClockJunction } from '../film/clock'
import { DEFAULT_FILM } from '../film/model'
import type { FilmShot } from '../film/model'
import { buildTrack } from '../import/stats'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath } from './path'
import { buildSequence, stageAt } from './sequence'
import {
  SHOT_SUN_HOURS,
  SUN_CHIPS,
  blendSunDates,
  junctionBlendAt,
  junctionSunDate,
  clockHourOfSolar,
  isSunDate,
  SHOT_DAYLIGHT_HOUR,
  shotSunDate,
  shotSunShiftMs,
  solarDay,
  solarHourOf,
  solarHourToDate,
  sunChipHour,
  sunDateAt,
  sunDayMs,
  sunTimes,
} from './sun'
import type { SolarDay } from './sun'

describe('solarHourToDate', () => {
  const day = Date.UTC(2026, 6, 14, 17, 42) // any time of the day

  it('is the UTC hour on the Greenwich meridian', () => {
    expect(solarHourToDate(day, 0, 10.5).toISOString()).toBe('2026-07-14T10:30:00.000Z')
  })

  it('shifts by 4 minutes per degree of longitude', () => {
    // Chamonix ~6.87° E: solar noon ~27.5 min before 12:00 UTC
    expect(solarHourToDate(day, 6.87, 12).getTime()).toBe(Date.UTC(2026, 6, 14, 12) - 6.87 * 4 * 60_000)
    expect(solarHourToDate(day, -90, 12).toISOString()).toBe('2026-07-14T18:00:00.000Z')
  })
})

describe('sunDateAt', () => {
  const T0 = Date.UTC(2026, 6, 14, 3, 45) // dawn in the Alps
  const HOUR = 3_600_000
  const timed = buildTrackPath(
    buildTrack({
      name: 'aube',
      source: 'gpx',
      segments: [
        {
          points: [
            { lon: 6.8, lat: 45.9, time: T0 },
            { lon: 6.81, lat: 45.9, time: T0 + HOUR },
          ],
        },
      ],
    }),
  )
  const untimed = buildTrackPath(
    buildTrack({
      name: 'sans heure',
      source: 'gpx',
      segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.81, lat: 45.9 }] }],
    }),
  )
  const opts = { sunFromTrack: true, solarHour: 10, lon: 0, dayMs: T0 }
  const fixed = solarHourToDate(T0, 0, 10).getTime()

  it('follows the recorded time along the track', () => {
    expect(sunDateAt(timed, 0, opts).getTime()).toBe(T0)
    expect(sunDateAt(timed, 0.5, opts).getTime()).toBeCloseTo(T0 + HOUR / 2, 3)
    expect(sunDateAt(timed, 1, opts).getTime()).toBe(T0 + HOUR)
  })

  it('uses the fixed solar hour when disabled, without time or without track', () => {
    expect(sunDateAt(timed, 0.5, { ...opts, sunFromTrack: false }).getTime()).toBe(fixed)
    expect(sunDateAt(untimed, 0.5, opts).getTime()).toBe(fixed)
    expect(sunDateAt(null, 0.5, opts).getTime()).toBe(fixed)
  })
})

describe('sunTimes', () => {
  const MIN = 60_000
  /** |a − b| in minutes */
  const minutesApart = (a: Date | null, iso: string) => Math.abs((a?.getTime() ?? Number.NaN) - Date.parse(iso)) / MIN

  it('matches published sunrise, noon and sunset times (within 2 min)', () => {
    // Paris, summer solstice: 05:47 / 13:52 / 21:58 CEST
    const paris = sunTimes(48.8566, 2.3522, new Date(Date.UTC(2024, 5, 21, 15)))
    expect(minutesApart(paris.sunrise, '2024-06-21T03:47Z')).toBeLessThan(2)
    expect(minutesApart(paris.solarNoon, '2024-06-21T11:52Z')).toBeLessThan(2)
    expect(minutesApart(paris.sunset, '2024-06-21T19:58Z')).toBeLessThan(2)
    expect(paris.polar).toBeNull()
    // New York, winter solstice: 07:16 / 16:32 EST
    const ny = sunTimes(40.7128, -74.006, new Date(Date.UTC(2024, 11, 21, 3)))
    expect(minutesApart(ny.sunrise, '2024-12-21T12:16Z')).toBeLessThan(2)
    expect(minutesApart(ny.sunset, '2024-12-21T21:32Z')).toBeLessThan(2)
    // Sydney, southern summer: 05:41 / 20:05 AEDT (sunrise on the previous UTC day)
    const sydney = sunTimes(-33.8688, 151.2093, new Date(Date.UTC(2024, 11, 21)))
    expect(minutesApart(sydney.sunrise, '2024-12-20T18:41Z')).toBeLessThan(2)
    expect(minutesApart(sydney.sunset, '2024-12-21T09:05Z')).toBeLessThan(2)
  })

  it('follows the equation of time: Greenwich solar noon about 16 min early in early November', () => {
    const greenwich = sunTimes(51.4769, 0, new Date(Date.UTC(2024, 10, 3)))
    expect(minutesApart(greenwich.solarNoon, '2024-11-03T11:43:35Z')).toBeLessThan(1)
  })

  it('handles the polar day and night', () => {
    const june = sunTimes(69.6492, 18.9553, new Date(Date.UTC(2024, 5, 21)))
    expect(june).toMatchObject({ sunrise: null, sunset: null, polar: 'day' })
    const december = sunTimes(69.6492, 18.9553, new Date(Date.UTC(2024, 11, 21)))
    expect(december).toMatchObject({ sunrise: null, sunset: null, polar: 'night' })
    expect(december.solarNoon.getUTCHours()).toBe(10)
  })
})

describe('clockHourOfSolar', () => {
  it('turns a solar hour into the clock hour of a UTC offset, within the day', () => {
    // Chamonix in summer (UTC+2): the clock is 1 h 32 min ahead of mean solar time
    expect(clockHourOfSolar(4.5, 6.87, 120)).toBeCloseTo(4.5 + 2 - 6.87 / 15, 9)
    expect(clockHourOfSolar(23.5, 0, 60)).toBeCloseTo(0.5, 9)
    expect(clockHourOfSolar(0.5, -120, -480)).toBeCloseTo(0.5, 9) // Pacific time, clock = solar at 120° W
    expect(clockHourOfSolar(1, 30, 0)).toBeCloseTo(23, 9)
  })
})

describe('solarHourOf', () => {
  it('inverts solarHourToDate', () => {
    const day = Date.UTC(2026, 6, 14, 17)
    for (const lon of [-120, 0, 6.87, 151.2]) {
      expect(solarHourOf(day, lon, solarHourToDate(day, lon, 7.25))).toBeCloseTo(7.25, 9)
    }
  })

  it('gives sun events near the local clock of the sun whatever the longitude', () => {
    const chamonix = solarDay(45.92, 6.87, Date.UTC(2026, 6, 14, 5))
    expect(chamonix.noon).toBeCloseTo(12.1, 1) // equation of time −6 min in mid-July
    expect(chamonix.sunrise).toBeGreaterThan(4.2)
    expect(chamonix.sunrise).toBeLessThan(4.6)
    expect(chamonix.sunset).toBeGreaterThan(19.6)
    expect(chamonix.sunset).toBeLessThan(20)
  })
})

describe('sunChipHour', () => {
  const day: SolarDay = { sunrise: 4.39, sunset: 19.8, noon: 12.1, polar: null }

  it('maps each chip to a quarter hour of the day', () => {
    expect(Object.fromEntries(SUN_CHIPS.map((chip) => [chip, sunChipHour(chip, day)]))).toEqual({
      lever: 4.5, // first quarter after sunrise
      matin: 8.25, // halfway to noon
      midi: 12,
      'heure-doree': 18.75, // one hour before sunset
      coucher: 19.75, // last quarter before sunset
      nuit: 0,
    })
  })

  it('leaves out the moments that do not exist in a polar day or night', () => {
    const polarDay: SolarDay = { sunrise: null, sunset: null, noon: 11.8, polar: 'day' }
    expect(SUN_CHIPS.map((chip) => sunChipHour(chip, polarDay))).toEqual([null, 9, 11.75, null, null, null])
    const polarNight: SolarDay = { sunrise: null, sunset: null, noon: 11.8, polar: 'night' }
    expect(SUN_CHIPS.map((chip) => sunChipHour(chip, polarNight))).toEqual([null, null, 11.75, null, null, 0])
  })

  it('stays inside the slider range', () => {
    expect(sunChipHour('coucher', { sunrise: 0.1, sunset: 23.95, noon: 12, polar: null })).toBe(23.75)
  })
})

describe('sunDayMs / isSunDate', () => {
  it('takes the day chosen, else the track start, else today', () => {
    expect(sunDayMs('2024-12-21', 5, 7)).toBe(Date.UTC(2024, 11, 21))
    expect(sunDayMs('', 5, 7)).toBe(5)
    expect(sunDayMs('', undefined, 7)).toBe(7)
  })

  it('accepts an empty day or YYYY-MM-DD only', () => {
    expect(isSunDate('')).toBe(true)
    expect(isSunDate('2024-06-21')).toBe(true)
    expect(isSunDate('2024-13-40')).toBe(false)
    expect(isSunDate('21/06/2024')).toBe(false)
  })
})

describe('shotSunShiftMs', () => {
  const HOUR = 3_600_000
  const clockOf = (opening: FilmShot, closing: FilmShot) =>
    buildFilmClock({
      opening,
      closing,
      stops: [],
      cameraKeys: [],
      lengthM: 4_000,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
  const moving = { style: 'situation', durationS: 8, moveSun: true } as const

  it('opening: from SHOT_SUN_HOURS before the flight, slowing down to it; closing: from it, speeding up', () => {
    const clock = clockOf(moving, { ...moving, durationS: 6 })
    expect(shotSunShiftMs(clock, 0)).toBe(-SHOT_SUN_HOURS * HOUR)
    expect(shotSunShiftMs(clock, 4)).toBeCloseTo(-SHOT_SUN_HOURS * HOUR * 0.25, 6)
    expect(shotSunShiftMs(clock, 8)).toBe(0)
    expect(shotSunShiftMs(clock, 30)).toBe(0)
    const closingS = clock.openingS + clock.flightS
    expect(shotSunShiftMs(clock, closingS)).toBe(0)
    expect(shotSunShiftMs(clock, closingS + 3)).toBeCloseTo(SHOT_SUN_HOURS * HOUR * 0.25, 6)
    expect(shotSunShiftMs(clock, clock.totalTime())).toBe(SHOT_SUN_HOURS * HOUR)
    // the sun stands still where the shot meets the flight: no jump in its speed
    const speed = (t: number) => (shotSunShiftMs(clock, t + 0.001) - shotSunShiftMs(clock, t - 0.001)) / 0.002
    expect(Math.abs(speed(8 - 0.002))).toBeLessThan((0.01 * SHOT_SUN_HOURS * HOUR) / 8)
  })

  it('« Accéléré »: the hours of the shot (4 h by default), each shot its own', () => {
    expect(SHOT_SUN_HOURS).toBe(4)
    const clock = clockOf({ style: 'descente', durationS: 8, sun: 'accelere', sunHours: 8 }, { style: 'descente', durationS: 6, sun: 'accelere' })
    expect(shotSunShiftMs(clock, 0)).toBe(-8 * HOUR)
    expect(shotSunShiftMs(clock, clock.totalTime())).toBe(SHOT_SUN_HOURS * HOUR)
  })

  it('« Plein jour » (default): daylight at the region view, easing to the flight\'s sun where the shot meets it', () => {
    const plain = { style: 'situation', durationS: 8 } as const
    const clock = clockOf(plain, { ...plain, durationS: 6 })
    const flight = new Date(Date.UTC(2026, 5, 1, 4)), daylight = new Date(Date.UTC(2026, 5, 1, SHOT_DAYLIGHT_HOUR))
    expect(shotSunDate(clock, 0, flight, daylight)).toEqual(daylight)
    expect(shotSunDate(clock, 4, flight, daylight).getTime()).toBeCloseTo(flight.getTime() + 0.25 * (daylight.getTime() - flight.getTime()), -1)
    expect(shotSunDate(clock, 8, flight, daylight)).toEqual(flight)
    expect(shotSunDate(clock, 30, flight, daylight)).toEqual(flight)
    expect(shotSunDate(clock, clock.totalTime(), flight, daylight)).toEqual(daylight)
    // « Heure du survol »: the flight's sun throughout; old projects with moveSun stay « Accéléré »
    const still = { ...plain, sun: 'survol' } as const
    for (const t of [0, 4, 8]) expect(shotSunDate(clockOf(still, still), t, flight, daylight)).toEqual(flight)
    expect(shotSunDate(clockOf(moving, moving), 0, flight, daylight).getTime()).toBe(flight.getTime() - SHOT_SUN_HOURS * HOUR)
  })

  it('« Soleil » applies to every shot style but « Aucune »; the default of the others holds the flight\'s sun', () => {
    const night = new Date(Date.UTC(2026, 5, 1, 22)), daylight = new Date(Date.UTC(2026, 5, 1, SHOT_DAYLIGHT_HOUR))
    // a track ending at night, closing « Descente » in « Plein jour »: from the arrival's sun to daylight
    const descent = { style: 'descente', durationS: 5 } as const
    const clock = clockOf({ style: 'aucune', durationS: 6 }, { ...descent, sun: 'jour' })
    const closingS = clock.openingS + clock.flightS
    expect(shotSunDate(clock, closingS, night, daylight)).toEqual(night)
    expect(shotSunDate(clock, closingS + 2.5, night, daylight).getTime()).toBeCloseTo(night.getTime() + 0.25 * (daylight.getTime() - night.getTime()), -1)
    expect(shotSunDate(clock, clock.totalTime(), night, daylight)).toEqual(daylight)
    // the flight itself keeps its sun
    expect(shotSunDate(clock, closingS - 1, night, daylight)).toEqual(night)
    // without a choice, « Descente », « Saut » and « Balayage » keep the flight's sun (no change for saved films)
    for (const style of ['descente', 'saut', 'balayage'] as const) {
      const plain = clockOf({ style, durationS: 6 }, { style, durationS: 5 })
      for (const t of [0, 3, plain.totalTime()]) expect(shotSunDate(plain, t, night, daylight)).toEqual(night)
    }
    // « Accéléré » on an opening « Balayage »: the time lapse of a « Depuis la région » shot
    const sweep = clockOf({ style: 'balayage', durationS: 8, sun: 'accelere' }, descent)
    expect(shotSunShiftMs(sweep, 0)).toBe(-SHOT_SUN_HOURS * HOUR)
    expect(shotSunShiftMs(sweep, 8)).toBe(0)
    // « Aucune » has no shot, so no sun of its own
    const none = clockOf({ style: 'aucune', durationS: 6, sun: 'jour' }, { style: 'aucune', durationS: 5, sun: 'accelere' })
    for (const t of [0, none.totalTime()]) expect(shotSunDate(none, t, night, daylight)).toEqual(night)
  })

  it('no time lapse without « Accéléré », outside a « Depuis la région » shot', () => {
    for (const shot of [{ style: 'situation', durationS: 8 }, { style: 'descente', durationS: 8, moveSun: true }] as const) {
      const clock = clockOf(shot, shot)
      for (const t of [0, 4, clock.totalTime()]) expect(shotSunShiftMs(clock, t)).toBe(0)
    }
  })
})

describe('the light across a fade between two stages', () => {
  const HOUR = 3_600_000
  const evening = new Date(Date.UTC(2026, 6, 14, 18))
  const morning = new Date(Date.UTC(2026, 6, 15, 6))
  const junction = (kind: ClockJunction['kind'], patch: Partial<ClockJunction> = {}): ClockJunction => ({
    id: 'junction-a',
    afterTrackId: 'a',
    atM: 1000,
    kind,
    holdS: 2,
    progress: 0.5,
    startS: 10,
    holdStartS: 11.5,
    holdEndS: 13.5,
    endS: 15,
    ...patch,
  })
  const hourOf = (d: Date) => (d.getTime() - Date.UTC(2026, 6, 14)) / HOUR

  it('an evening into a morning runs forward through the night, eased, joining both ends', () => {
    expect(blendSunDates(evening, morning, 0).getTime()).toBe(evening.getTime())
    expect(blendSunDates(evening, morning, 1).getTime()).toBe(morning.getTime())
    expect(hourOf(blendSunDates(evening, morning, 0.5))).toBeCloseTo(24, 9)
    const hours = Array.from({ length: 21 }, (_, k) => hourOf(blendSunDates(evening, morning, k / 20)))
    expect(hours.every((h, k) => k === 0 || h >= hours[k - 1])).toBe(true)
  })

  it('a stage that is earlier runs backward; the whole days between are taken once, half-way', () => {
    const before = new Date(Date.UTC(2026, 6, 15, 8))
    const after = new Date(Date.UTC(2026, 6, 14, 18))
    expect(hourOf(blendSunDates(before, after, 0.5))).toBeCloseTo(25, 9)
    const a = new Date(Date.UTC(2026, 6, 14, 8))
    const b = new Date(Date.UTC(2026, 6, 17, 8))
    expect(blendSunDates(a, b, 0.49).getTime()).toBe(a.getTime())
    expect(blendSunDates(a, b, 0.5).getTime()).toBe(b.getTime())
  })

  it('the same sun on both sides stays the same sun', () => {
    for (const u of [0, 0.3, 0.5, 0.9, 1]) expect(blendSunDates(evening, evening, u).getTime()).toBe(evening.getTime())
  })

  it('only the fades blend, from the start of the pause to its end; the flight’s sun elsewhere', () => {
    const flight = new Date(Date.UTC(2026, 6, 14, 12))
    const ends = () => ({ before: evening, after: morning })
    const at = (kind: ClockJunction['kind'], t: number) => junctionSunDate({ junctions: [junction(kind)] }, t, flight, ends)
    expect(at('fondu-noir', 9.99)).toBe(flight)
    expect(at('fondu-noir', 15)).toBe(flight)
    expect(at('fondu-noir', 10).getTime()).toBe(evening.getTime())
    expect(at('fondu-blanc', 12.5).getTime()).toBeGreaterThan(evening.getTime())
    expect(at('fondu-blanc', 14.999).getTime()).toBeCloseTo(morning.getTime(), -3)
    // the middle of the pause is the middle of the night
    expect(hourOf(at('fondu-noir', 12.5))).toBeCloseTo(24, 9)
    // a cut has no pause, a night its own dusk, night and dawn
    expect(at('coupe', 12.5)).toBe(flight)
    expect(at('nuit', 12.5)).toBe(flight)
    expect(junctionBlendAt({ junctions: [junction('fondu-noir', { holdS: 0 })] }, 12.5)).toBeNull()
    // the stages' ends unknown: the flight’s sun
    expect(junctionSunDate({ junctions: [junction('fondu-noir')] }, 12.5, flight, () => null)).toBe(flight)
  })

  it('is a pure function of the film time', () => {
    const clock = { junctions: [junction('fondu-noir')] }
    const ends = () => ({ before: evening, after: morning })
    const first = [10.5, 12.5, 14.5].map((t) => junctionSunDate(clock, t, evening, ends).getTime())
    expect([14.5, 10.5, 12.5].map((t) => junctionSunDate(clock, t, evening, ends).getTime())).toEqual([first[2], first[0], first[1]])
  })
})

describe('three days À la suite: the light across the fades', () => {
  const day = (name: string, lat: number, startMs: number) =>
    buildTrack({
      name,
      source: 'gpx',
      segments: [{ points: Array.from({ length: 5 }, (_, i) => ({ lon: 6.8 + i * 0.01, lat, ele: 1000, time: startMs + i * 10 * 60_000 })) }],
    })
  const start = Date.UTC(2026, 6, 1, 8)
  const sequence = buildSequence([day('a', 45, start), day('b', 45.1, start + 24 * 3_600_000), day('c', 45.2, start + 48 * 3_600_000)])
  // fades between the stages (the default « Nuit » would pass the nights)
  const film = { ...DEFAULT_FILM, nights: { ...DEFAULT_FILM.nights, enabled: false }, junctionDefault: { kind: 'fondu-noir' as const, holdS: 1.5, card: true } }
  const clock = filmClockFor({ track: sequence.track, film, durationS: 60, pacing: DEFAULT_PACING, cutsM: sequence.cutsM, stageIds: sequence.stageIds })
  const sunAt = (progress: number) => {
    const at = stageAt(sequence, progress)
    return sunDateAt(buildTrackPath(at.stage.track), at.progress, { sunFromTrack: true, solarHour: 10, lon: 6.8, dayMs: start })
  }
  const dateAt = (t: number) =>
    junctionSunDate(clock, t, sunAt(clock.progressAtTime(t)), (j) => {
      const from = sequence.stages[clock.junctions.indexOf(j) + 1].from
      return { before: sunAt(from - 1e-9), after: sunAt(from) }
    }).getTime()

  it('every stage is lit at its own recorded hour, the junctions are fades', () => {
    expect(clock.junctions.map((j) => j.kind)).toEqual(['fondu-noir', 'fondu-noir'])
    const [a, b] = [sunAt(0.1).getTime(), sunAt(0.5).getTime()]
    expect(b - a).toBeGreaterThan(20 * 3_600_000)
  })

  it('across a junction the light runs on without a jump at either end of the pause, forward through the night', () => {
    const MINUTES_5 = 5 * 60_000
    for (const j of clock.junctions) {
      const flightAt = (t: number) => sunAt(clock.progressAtTime(t)).getTime()
      expect(Math.abs(dateAt(j.startS) - flightAt(j.startS - 1e-6))).toBeLessThan(MINUTES_5)
      expect(Math.abs(dateAt(j.endS - 1e-6) - flightAt(j.endS))).toBeLessThan(MINUTES_5)
      const dates = Array.from({ length: 41 }, (_, k) => dateAt(j.startS + ((j.endS - j.startS) * k) / 41))
      expect(dates.every((d, k) => k === 0 || d >= dates[k - 1])).toBe(true)
      // the sun spends the middle of the pause in the night, the pause itself being a whole night apart
      const middle = new Date(dateAt((j.startS + j.endS) / 2))
      expect(middle.getUTCHours() >= 20 || middle.getUTCHours() <= 4).toBe(true)
    }
  })

  it('the same film time gives the same light however the film is reached', () => {
    const j = clock.junctions[0]
    const t = (j.startS + j.endS) / 2
    const first = dateAt(t)
    dateAt(0)
    dateAt(clock.totalTime())
    expect(dateAt(t)).toBe(first)
  })
})
