import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildPacing } from '../flyover/__fixtures__/pacing'
import { DEFAULT_PACING, flightPacing, PAUSE_EASE_S } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import { buildSequence } from '../flyover/sequence'
import { buildFilmClock, filmClockFor } from './clock'
import type { FilmClock, FilmClockInput } from './clock'
import { stageFlightS, withJunction, withStageDuration } from './junctions'
import type { JunctionInput } from './junctions'
import { DEFAULT_FILM } from './model'
import type { Film, FilmShot, FilmStop } from './model'

const L = 10_000
const D = 60
const OFF: PacingSettings = { ...DEFAULT_PACING, keepDuration: false }
const NONE: FilmShot = { style: 'aucune', durationS: 5 }
const OPEN: FilmShot = { style: 'descente', durationS: 6 }
const CLOSE: FilmShot = { style: 'saut', durationS: 4 }

const clockOf = (patch: Partial<FilmClockInput>): FilmClock =>
  buildFilmClock({ opening: OPEN, closing: CLOSE, stops: [], lengthM: L, highlightsM: [], durationS: D, pacing: OFF, ...patch })
const stop = (id: string, atM: number, durationS: number, camera: FilmStop['camera'] = 'fixe'): FilmStop => ({ id, atM, durationS, camera })

describe('film clock — phases', () => {
  const clock = clockOf({ stops: [stop('b', 7000, 4, 'orbite'), stop('a', 2000, 2)] })

  it('opening, flight with its stops, closing; total = sum', () => {
    expect(clock.openingS).toBe(6)
    expect(clock.closingS).toBe(4)
    expect(clock.flightS).toBeCloseTo(D + 6, 9)
    expect(clock.totalTime()).toBeCloseTo(6 + D + 6 + 4, 9)
    // stops sorted by position, placed in film time (opening included)
    expect(clock.stops.map((s) => s.id)).toEqual(['a', 'b'])
    expect(clock.stops[0].holdStartS).toBeCloseTo(6 + 2000 / L * D + PAUSE_EASE_S / 2, 9)
  })

  it('states: progress 0 in the opening, 1 in the closing, the stop window as its own phase', () => {
    expect(clock.stateAt(-1)).toMatchObject({ phase: 'opening', timeS: 0, progress: 0, localS: 0, lengthS: 6 })
    expect(clock.stateAt(3)).toMatchObject({ phase: 'opening', progress: 0, flightTimeS: 0, localS: 3 })
    expect(clock.stateAt(6)).toMatchObject({ phase: 'flight', progress: 0, flightTimeS: 0 })
    const [a, b] = clock.stops
    const inA = clock.stateAt((a.holdStartS + a.holdEndS) / 2)
    expect(inA.phase).toBe('stop')
    expect(inA.stop?.id).toBe('a')
    expect(inA.progress).toBeCloseTo(0.2, 12)
    expect(inA.lengthS).toBeCloseTo(2 + PAUSE_EASE_S, 9)
    expect(clock.stateAt(a.startS).localS).toBe(0)
    expect(clock.stateAt(a.endS).phase).toBe('flight')
    expect(clock.stateAt(b.startS + 0.01).stop?.camera).toBe('orbite')
    const end = clock.stateAt(6 + clock.flightS)
    expect(end).toMatchObject({ phase: 'closing', progress: 1, localS: 0, lengthS: 4 })
    expect(end.flightTimeS).toBeCloseTo(clock.flightS, 9)
    expect(clock.stateAt(1e9)).toMatchObject({ phase: 'closing', progress: 1, localS: 4 })
  })

  it('progress from time: constant during the shots, continuous and non-decreasing', () => {
    let previous = 0
    for (let t = 0; t <= clock.totalTime(); t += 0.05) {
      const p = clock.progressAtTime(t)
      expect(p).toBeGreaterThanOrEqual(previous)
      expect(p - previous).toBeLessThanOrEqual(0.05 / D + 1e-12)
      expect(p).toBe(clock.stateAt(t).progress)
      previous = p
    }
    expect(clock.progressAtTime(5.9)).toBe(0)
    expect(clock.progressAtTime(clock.totalTime() - 1)).toBe(1)
  })

  it('time from a scrubbed progress: the flight (after the opening), the end of the film at 1', () => {
    expect(clock.timeAtProgress(0)).toBe(6)
    expect(clock.timeAtProgress(0.1)).toBeCloseTo(12, 9)
    expect(clock.timeAtProgress(0.2)).toBeCloseTo(clock.stops[0].holdStartS, 9)
    expect(clock.timeAtProgress(1)).toBe(clock.totalTime())
    expect(clock.positionAt(0.5)).toEqual({ timeS: clock.timeAtProgress(0.5), progress: 0.5 })
  })

  it('advance: plays the opening, the stops and the closing, then ends at the total time', () => {
    let position = { timeS: 0, progress: 0 }
    let frames = 0
    while (position.timeS < clock.totalTime() && frames < 100_000) {
      position = clock.advance(position, 1 / 30, 1)
      frames++
    }
    expect(position.progress).toBe(1)
    expect(frames / 30).toBeCloseTo(clock.totalTime(), 1)
    expect(clock.advance({ timeS: 1, progress: 0 }, 1, 2)).toEqual({ timeS: 3, progress: 0 })
  })
})

describe('film clock — cuts between stages « À la suite »', () => {
  it('places each cut at the film time the marker reaches it, none without a track', () => {
    const clock = clockOf({ cutsM: [6000, 2500] })
    expect(clock.cuts.map((c) => c.atM)).toEqual([2500, 6000])
    for (const cut of clock.cuts) expect(cut.timeS).toBeCloseTo(clock.timeAtProgress(cut.atM / L), 9)
    expect(clockOf({}).cuts).toEqual([])
    expect(clockOf({ cutsM: [2500], lengthM: 0 }).cuts).toEqual([])
  })
})

describe('film clock — speed portions', () => {
  const speeds = [{ id: 'speed-1', fromM: 6000, toM: 8000, factor: 0.5 }, { id: 'speed-2', fromM: 1000, toM: 3000, factor: 2 }]
  const clock = clockOf({ speeds, stops: [stop('a', 2000, 2)] })

  it('placed in film time by position; the flight follows the factor; same as the bare flight pacing', () => {
    expect(clock.speeds.map((s) => s.id)).toEqual(['speed-2', 'speed-1'])
    const [fast, slow] = clock.speeds
    // before the first portion: the base ground speed after the opening
    expect(fast.startS).toBeCloseTo(6 + (1000 / L) * D, 9)
    expect(fast.endS).toBeGreaterThan(clock.stops[0].endS)
    expect(slow.startS).toBe(clock.timeAtProgress(0.6))
    expect(slow.endS).toBe(clock.timeAtProgress(0.8))
    const flight = flightPacing(L, [], D, OFF, [{ atM: 2000, durationS: 2 }], [...speeds].sort((a, b) => a.fromM - b.fromM))
    expect(clock.flightS).toBe(flight.totalTime())
    for (let t = 0; t <= clock.totalTime(); t += 0.3) expect(clock.progressAtTime(t)).toBe(flight.progressAtTime(t - 6))
  })

  it('a portion to the end of the track ends with the flight, not the film; no track: no portion', () => {
    const toEnd = clockOf({ speeds: [{ id: 'speed-1', fromM: 9000, toM: L, factor: 3 }] })
    expect(toEnd.speeds[0].endS).toBeCloseTo(toEnd.openingS + toEnd.flightS, 9)
    expect(clockOf({ lengthM: 0, speeds }).speeds).toEqual([])
  })

  it('the film clock of a track takes the speeds of the film', () => {
    const points = [0, 1, 2].map((k) => ({ lon: 6.8, lat: 45.8 + k * 0.01, ele: 1000 }))
    const track: Track = buildTrack({ name: 't', source: 'gpx', segments: [{ points }] })
    const film: Film = { ...DEFAULT_FILM, speeds: [{ id: 'speed-1', fromM: 0, toM: 1000, factor: 2 }] }
    expect(filmClockFor({ track, film, durationS: D, pacing: OFF }).speeds.map((s) => s.id)).toEqual(['speed-1'])
    expect(filmClockFor({ track, film, durationS: D, pacing: OFF }).flightS).toBeLessThan(D)
    expect(filmClockFor({ track: undefined, film, durationS: D, pacing: OFF }).speeds).toEqual([])
  })
})

describe('film clock — equivalence with the pacing', () => {
  const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
  const points = []
  for (let d = 0; d <= 5000; d += 10) {
    const ele = d < 1000 ? 1000 : d < 3000 ? 1000 + ((d - 1000) / 2000) * 200 : 1200
    points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele })
  }
  const track: Track = buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
  const landmarks: Landmark[] = [
    { id: 'node/1', kind: 'pass', name: 'Col', lon: 6.8, lat: 45.8, distanceM: 20, alongM: 1500, priority: 10, text: 'Col' },
  ]
  // films saved before the timeline: the generated stops are the pauses of the pacing
  const legacy: Film = { ...DEFAULT_FILM, autoMode: 'rythme' }
  const noShots: Film = { ...legacy, opening: NONE, closing: NONE }

  it('without shots, the generated stops (rythme) replay the pacing exactly (pauses and slow-downs)', () => {
    for (const pacing of [DEFAULT_PACING, { ...DEFAULT_PACING, enabled: true }, { ...DEFAULT_PACING, enabled: true, keepDuration: false, pauseS: 4 }]) {
      const before = buildPacing({ track, durationS: D, settings: pacing, landmarks })
      const clock = filmClockFor({ track, film: noShots, durationS: D, pacing, landmarks })
      expect(clock.totalTime()).toBeCloseTo(before.totalTime(), 9)
      expect(clock.highlights).toEqual(before.highlights)
      expect(clock.stops.map((s) => s.holdStartS)).toEqual(before.pauses.map((p) => p.holdStartS))
      for (let t = 0; t <= before.totalTime(); t += 0.25) expect(clock.progressAtTime(t)).toBeCloseTo(before.progressAtTime(t), 12)
      for (let i = 0; i <= 100; i++) expect(clock.timeAtProgress(i / 100)).toBeCloseTo(before.timeAtProgress(i / 100), 9)
    }
  })

  it('with the default shots: the same flight, shifted by the opening', () => {
    const pacing = { ...DEFAULT_PACING, enabled: true }
    const before = buildPacing({ track, durationS: D, settings: pacing, landmarks })
    const clock = filmClockFor({ track, film: legacy, durationS: D, pacing, landmarks })
    const O = DEFAULT_FILM.opening.durationS
    expect(clock.totalTime()).toBeCloseTo(O + before.totalTime() + DEFAULT_FILM.closing.durationS, 9)
    for (let t = 0; t <= before.totalTime(); t += 0.5) expect(clock.progressAtTime(O + t)).toBeCloseTo(before.progressAtTime(t), 12)
  })

  it('own stops replace the generated ones; no track: the bare flight duration and shots', () => {
    const pacing = { ...DEFAULT_PACING, enabled: true }
    const own: Film = { ...noShots, autoStops: false, stops: [stop('stop-1', 2500, 7, 'orbite')] }
    const clock = filmClockFor({ track, film: own, durationS: D, pacing, landmarks })
    expect(clock.stops.map((s) => s.id)).toEqual(['stop-1'])
    expect(clock.totalTime()).toBeCloseTo(D, 9)

    const empty = filmClockFor({ track: undefined, film: DEFAULT_FILM, durationS: D, pacing })
    expect(empty.stops).toEqual([])
    expect(empty.totalTime()).toBe(D + 11)
  })
})

describe('film clock — junctions between stages « À la suite »', () => {
  const junction = (atM: number, holdS: number, kind: JunctionInput['kind'] = 'fondu-noir', id = 'a'): JunctionInput => ({
    id: `junction-${id}`,
    afterTrackId: id,
    atM,
    kind,
    holdS,
  })
  const bare = clockOf({ cutsM: [4000] })

  it('a fade holds the film for its time on the clock: the pause of the cut, added to the film', () => {
    const clock = clockOf({ cutsM: [4000], junctions: [junction(4000, 2)] })
    expect(clock.totalTime()).toBeCloseTo(bare.totalTime() + 2, 9)
    const [j] = clock.junctions
    expect(j).toMatchObject({ id: 'junction-a', afterTrackId: 'a', atM: 4000, kind: 'fondu-noir', holdS: 2 })
    expect(j.startS).toBeLessThan(j.holdStartS)
    expect(j.holdStartS).toBeLessThanOrEqual(j.holdEndS)
    expect(j.holdEndS).toBeLessThan(j.endS)
    // the stage changes when the marker reaches the cut: that is the start of the hold
    expect(clock.cuts[0].timeS).toBe(j.holdStartS)
    expect(clock.progressAtTime(j.holdStartS)).toBeCloseTo(0.4, 12)
    expect(clock.progressAtTime((j.holdStartS + j.holdEndS) / 2)).toBeCloseTo(0.4, 12)
    expect(clock.progressAtTime(j.endS + 1)).toBeGreaterThan(0.4)
  })

  it('a plain cut holds nothing: no time, one point on the clock', () => {
    const clock = clockOf({ cutsM: [4000], junctions: [junction(4000, 0, 'coupe')] })
    expect(clock.totalTime()).toBe(bare.totalTime())
    const [j] = clock.junctions
    expect(new Set([j.startS, j.holdStartS, j.holdEndS, j.endS]).size).toBe(1)
    expect(j.holdStartS).toBe(clock.cuts[0].timeS)
    // the cuts without junctions (no film) hold nothing either
    expect(bare.junctions).toEqual([])
    expect(clockOf({ junctions: [junction(4000, 2)], lengthM: 0 }).junctions).toEqual([])
  })

  it('« Garder la durée »: the holds come on top of the flight, as the nights do', () => {
    const keep = { ...DEFAULT_PACING, keepDuration: true }
    const plain = clockOf({ pacing: keep, cutsM: [4000] })
    const held = clockOf({ pacing: keep, cutsM: [4000, 7000], junctions: [junction(4000, 2), junction(7000, 1.5, 'fondu-blanc', 'b')] })
    expect(plain.flightS).toBeCloseTo(D, 9)
    expect(held.flightS).toBeCloseTo(D + 3.5, 9)
    expect(held.junctions.map((j) => j.kind)).toEqual(['fondu-noir', 'fondu-blanc'])
  })

  it('a stop at the cut starts after the fade, on the next stage', () => {
    const clock = clockOf({ stops: [stop('s', 4000, 3)], cutsM: [4000], junctions: [junction(4000, 2)] })
    const [j] = clock.junctions
    expect(clock.stops[0].holdStartS).toBeGreaterThanOrEqual(j.holdEndS - 1e-9)
    expect(clock.totalTime()).toBeCloseTo(bare.totalTime() + 2 + 3, 9)
  })

  it('a junction that passes a night is the night’s pause: its length, and the night stays on the clock', () => {
    const night = { atM: 4000, fromMs: 0, toMs: 1, sunsetMs: 0, sunriseMs: 1, nightM: 0, duskS: 3, nightS: 2, dawnS: 3 }
    const clock = clockOf({ cutsM: [4000], junctions: [{ ...junction(4000, 8, 'nuit'), night }] })
    expect(clock.totalTime()).toBeCloseTo(bare.totalTime() + 8, 9)
    expect(clock.nights).toHaveLength(1)
    expect(clock.nights[0].holdStartS).toBe(clock.junctions[0].holdStartS)
    expect(clock.junctions[0].kind).toBe('nuit')
  })

  it('the film clock of a sequence places the junctions of the film: default, own, and none for a cut', () => {
    const line = (name: string, lat: number): Track =>
      buildTrack({ name, source: 'gpx', segments: [{ points: [0, 1, 2].map((k) => ({ lon: 6.8 + k * 0.01, lat, ele: 1000 })) }] })
    const sequence = buildSequence([line('a', 45), line('b', 45.1), line('c', 45.2)])
    const source = { track: sequence.track, durationS: D, pacing: OFF, cutsM: sequence.cutsM, stageIds: sequence.stageIds }
    const withFilm = (film: Film) => filmClockFor({ ...source, film })
    const none = withFilm({ ...DEFAULT_FILM, junctionDefault: { kind: 'coupe', holdS: 0, card: true } })
    const byDefault = withFilm(DEFAULT_FILM)
    expect(byDefault.junctions.map((j) => j.afterTrackId)).toEqual(sequence.stageIds.slice(0, 2))
    expect(byDefault.junctions.every((j) => j.kind === 'fondu-noir' && j.holdS === 1.5)).toBe(true)
    expect(byDefault.totalTime()).toBeCloseTo(none.totalTime() + 3, 9)
    // the second junction its own: a longer white fade; the first still the default
    const own = withFilm(withJunction(DEFAULT_FILM, sequence.stageIds[1], { kind: 'fondu-blanc', holdS: 4 }))
    expect(own.junctions.map((j) => [j.kind, j.holdS])).toEqual([
      ['fondu-noir', 1.5],
      ['fondu-blanc', 4],
    ])
    expect(own.totalTime()).toBeCloseTo(none.totalTime() + 5.5, 9)
    // not a sequence: no cut, no junction
    expect(filmClockFor({ track: sequence.track, film: DEFAULT_FILM, durationS: D, pacing: OFF }).junctions).toEqual([])
  })
})

describe('film clock — three days À la suite with nights', () => {
  const HOUR = 3600 * 1000
  const day = (name: string, lat: number, startMs: number): Track =>
    buildTrack({
      name,
      source: 'gpx',
      segments: [{ points: Array.from({ length: 5 }, (_, i) => ({ lon: 6.8 + i * 0.01, lat, ele: 1000, time: startMs + i * 10 * 60 * 1000 })) }],
    })
  const start = Date.UTC(2026, 6, 1, 8)
  const sequence = buildSequence([day('a', 45, start), day('b', 45.1, start + 24 * HOUR), day('c', 45.2, start + 48 * HOUR)])
  const clockOfFilm = (film: Film) =>
    filmClockFor({ track: sequence.track, film, durationS: D, pacing: OFF, cutsM: sequence.cutsM, stageIds: sequence.stageIds })
  const nightsOn: Film = { ...DEFAULT_FILM, nights: { ...DEFAULT_FILM.nights, enabled: true } }
  const nightsOff: Film = { ...DEFAULT_FILM, nights: { ...DEFAULT_FILM.nights, enabled: false } }
  const parts = DEFAULT_FILM.nights.duskS + DEFAULT_FILM.nights.nightS + DEFAULT_FILM.nights.dawnS

  it('the night between two days is at the cut: the junction passes it, once (the film is as long as before the junctions)', () => {
    const clock = clockOfFilm(nightsOn)
    expect(clock.junctions.map((j) => [j.kind, j.holdS])).toEqual([['nuit', parts], ['nuit', parts]])
    expect(clock.nights.map((n) => n.holdStartS)).toEqual(clock.junctions.map((j) => j.holdStartS))
    // a cut that does not pass the night is a cut, the nights on or not: the film is shorter by the two nights
    const cut = { kind: 'coupe' as const, holdS: 0, card: true, night: false }
    expect(clockOfFilm({ ...nightsOn, junctionDefault: cut }).junctions.map((j) => j.kind)).toEqual(['coupe', 'coupe'])
    expect(clock.totalTime()).toBeCloseTo(clockOfFilm({ ...nightsOn, junctionDefault: cut }).totalTime() + 2 * parts, 9)
  })

  it('a junction that chose another transition replaces the night; the default « Nuit » keeps it with the nights off, a default fade does not', () => {
    const chosen = clockOfFilm(withJunction(nightsOn, sequence.stageIds[0], { kind: 'fondu-blanc', holdS: 2, night: false }))
    expect(chosen.junctions.map((j) => [j.kind, j.holdS])).toEqual([['fondu-blanc', 2], ['nuit', parts]])
    expect(chosen.nights).toHaveLength(1)
    const off = clockOfFilm(nightsOff)
    expect(off.junctions.map((j) => [j.kind, j.holdS])).toEqual([['nuit', parts], ['nuit', parts]])
    const fades = clockOfFilm({ ...nightsOn, junctionDefault: { kind: 'fondu-noir', holdS: 1.5, card: true, night: false } })
    expect(fades.junctions.map((j) => [j.kind, j.holdS])).toEqual([['fondu-noir', 1.5], ['fondu-noir', 1.5]])
    expect(fades.nights).toEqual([])
    // « Nuit » asked for over a default fade: that junction passes the night
    const one = withJunction({ ...nightsOff, junctionDefault: { kind: 'fondu-noir', holdS: 1.5, card: true, night: false } }, sequence.stageIds[1], { night: true })
    expect(clockOfFilm(one).junctions.map((j) => j.kind)).toEqual(['fondu-noir', 'nuit'])
  })
})

describe('film clock — a duration per stage', () => {
  // three stages of 1 : 2 : 1 in length, the middle one twice as long
  const line = (name: string, lat: number, step: number): Track =>
    buildTrack({ name, source: 'gpx', segments: [{ points: [0, 1, 2].map((k) => ({ lon: 6.8 + k * step, lat, ele: 1000 })) }] })
  const sequence = buildSequence([line('a', 45, 0.01), line('b', 45.1, 0.02), line('c', 45.2, 0.01)])
  const [a, b, c] = sequence.stageIds
  const cut: Film = { ...DEFAULT_FILM, junctionDefault: { kind: 'coupe', holdS: 0, card: true } }
  const clockOfFilm = (film: Film, pacing: PacingSettings = OFF) =>
    filmClockFor({ track: sequence.track, film, durationS: D, pacing, cutsM: sequence.cutsM, stageIds: sequence.stageIds })
  const stagesS = (clock: FilmClock) => [0, 1, 2].map((k) => stageFlightS(clock, k))
  const share = sequence.stages.map((s) => (D * (s.endM - s.startM)) / sequence.track.stats.distanceM)
  /** about twice the share of the last stage, in tenths of a second as the film keeps them */
  const twice = Math.round(share[2] * 20) / 10

  it('without a duration of its own, every stage shares the flyover duration by its distance', () => {
    const clock = clockOfFilm(cut)
    stagesS(clock).forEach((s, k) => expect(s).toBeCloseTo(share[k], 6))
    expect(clock.flightS).toBeCloseTo(D, 9)
  })

  it('a stage set to twice its share lasts that long; the others keep theirs and the film grows by the difference', () => {
    for (const keepDuration of [false, true]) {
      const clock = clockOfFilm(withStageDuration(cut, c, twice), { ...OFF, keepDuration })
      const [s0, s1, s2] = stagesS(clock)
      expect(s2).toBeCloseTo(twice, 6)
      expect(s0).toBeCloseTo(share[0], 6)
      expect(s1).toBeCloseTo(share[1], 6)
      expect(clock.flightS).toBeCloseTo(D + twice - share[2], 9)
    }
  })

  it('every stage set: the durations add up, the flyover duration no longer matters', () => {
    const film = withStageDuration(withStageDuration(withStageDuration(cut, a, 10), b, 30), c, 20)
    const clock = clockOfFilm(film)
    expect(stagesS(clock).map((s) => Math.round(s * 1e6) / 1e6)).toEqual([10, 30, 20])
    expect(clock.flightS).toBeCloseTo(60, 9)
    expect(filmClockFor({ track: sequence.track, film, durationS: 300, pacing: OFF, cutsM: sequence.cutsM, stageIds: sequence.stageIds }).flightS).toBeCloseTo(60, 9)
  })

  it('the stops of a stage are inside its duration, with or without « Garder la durée »; the holds of the junctions are not', () => {
    const stops = [stop('s1', sequence.stages[1].startM + 500, 4), stop('s2', sequence.stages[1].startM + 1500, 3)]
    for (const keepDuration of [false, true]) {
      const film = withStageDuration({ ...DEFAULT_FILM, autoStops: false, stops }, b, 40)
      const clock = clockOfFilm(film, { ...OFF, keepDuration })
      expect(stageFlightS(clock, 1)).toBeCloseTo(40, 6)
      expect(clock.stops).toHaveLength(2)
      // the default junctions hold the film 1.5 s each, on top
      expect(clock.flightS).toBeCloseTo(40 + share[0] + share[2] + 3, 6)
    }
  })

  it('a stage with a stop inside a stage that is not set is left to the shared duration', () => {
    const stops = [stop('s1', sequence.stages[1].startM + 500, 4)]
    const clock = clockOfFilm(withStageDuration({ ...DEFAULT_FILM, autoStops: false, stops, junctionDefault: cut.junctionDefault }, a, 20), { ...OFF, keepDuration: true })
    expect(stageFlightS(clock, 0)).toBeCloseTo(20, 6)
    // the two others share what is left of the duration, their stop squeezed in
    expect(stageFlightS(clock, 1) + stageFlightS(clock, 2)).toBeCloseTo(share[1] + share[2], 6)
  })

  it('a film without durations, or one that does not play « À la suite », flies as before', () => {
    const bare = clockOfFilm(cut)
    const mark = (clock: FilmClock) => [0, 0.1, 0.35, 0.5, 0.77, 1].map((t) => clock.progressAtTime(t * clock.totalTime()))
    expect(mark(clockOfFilm({ ...cut, stageDurations: {} }))).toEqual(mark(bare))
    // a duration kept for a track that is not a stage
    expect(mark(clockOfFilm({ ...cut, stageDurations: { gone: 50 } }))).toEqual(mark(bare))
    const single = filmClockFor({ track: sequence.track, film: { ...cut, stageDurations: { [a]: 5 } }, durationS: D, pacing: OFF })
    expect(single.flightS).toBe(D)
  })

  it('sets and clears a duration in the film, kept in its range', () => {
    expect(withStageDuration(cut, a, 1).stageDurations).toEqual({ [a]: 5 })
    expect(withStageDuration(cut, a, 9999).stageDurations).toEqual({ [a]: 600 })
    expect(withStageDuration(withStageDuration(cut, a, 20), b, 30).stageDurations).toEqual({ [a]: 20, [b]: 30 })
    expect(withStageDuration(withStageDuration(cut, a, 20), a, null)).toEqual(cut)
    expect(withStageDuration(cut, a, null)).toEqual(cut)
  })
})
