import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_PACING } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { buildSequence, sequenceLandmarks } from '../flyover/sequence'
import { buildTrack } from '../import/stats'
import { recordLandmarks } from '../osm/landmarks'
import type { Landmark } from '../osm/landmarks'
import {
  autoStopId,
  autoStops,
  filmStops,
  materializeStops,
  placeStop,
  stopCandidates,
  withoutPlaceItems,
} from './assemble'
import type { StopPlace } from './assemble'
import { AUTO_STOP_S, DEFAULT_FILM, isValidFilm } from './model'
import type { Film, FilmStop } from './model'

const ON: PacingSettings = { ...DEFAULT_PACING, enabled: true }
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

/** 5 km heading north: flat, a 200 m climb from 1 km to 3 km, flat. */
function climbTrack(): Track {
  const points = []
  for (let d = 0; d <= 5000; d += 10) {
    const ele = d < 1000 ? 1000 : d < 3000 ? 1000 + ((d - 1000) / 2000) * 200 : 1200
    points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele })
  }
  return buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
}

function landmark(kind: Landmark['kind'], name: string, alongM: number, distanceM: number): Landmark {
  return { id: `node/${alongM}`, kind, name, lon: 6.8, lat: 45.8, distanceM, alongM, priority: 10, text: name }
}

const track = climbTrack()
const landmarks = [
  landmark('pass', 'Col de Voza', 1500, 50),
  landmark('peak', 'Mont Lachat', 4500, 250),
  // too far from the track to be a highlight
  landmark('peak', 'Aiguille', 2000, 900),
]

describe('records of the outing', () => {
  const record: Landmark = { ...landmark('record' as Landmark['kind'], 'Montée la plus raide · 18 % sur 400 m', 2000, 0), id: 'record:t:steepestClimb', recordKind: 'steepestClimb' }

  it('are stops like the passes and summits, with the record as label and source', () => {
    expect(stopCandidates({ track, landmarks: [landmarks[0], record] })).toEqual([
      { atM: 1500, label: 'Col de Voza', source: { kind: 'landmark', ref: 'node/1500' } },
      { atM: 2000, label: 'Montée la plus raide · 18 % sur 400 m', source: { kind: 'landmark', ref: 'record:t:steepestClimb' } },
    ])
    // the other records stay labels
    expect(stopCandidates({ track, landmarks: [{ ...record, id: 'record:t:slowestKm', recordKind: 'slowestKm' }] })).toEqual([])
    expect(autoStops({ track, landmarks: [record], pacing: DEFAULT_PACING }, 'temps-forts').map((s) => s.label)).toEqual(['Montée la plus raide · 18 % sur 400 m'])
  })

  it('make at most three stops per stage of a film: the steepest climb, the highest point, the fastest descent', () => {
    const stage = (id: string): Track => {
      const points = []
      for (let d = 0; d <= 6000; d += 10) {
        const ele = 1000 + (d < 1000 ? 0 : d < 2000 ? (d - 1000) * 0.15 : d < 3000 ? 150 - (d - 2000) * 0.1 : 50 + (d - 3000) * 0.05)
        points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele, time: Date.UTC(2026, 5, 1, 8) + (d / (d > 2000 && d < 3000 ? 12 : d % 1500 < 700 ? 3 : 4)) * 1000 })
      }
      return { ...buildTrack({ name: id, source: 'gpx', segments: [{ points }] }), id }
    }
    const [a, b] = [stage('a'), stage('b')]
    const all = [a, b].map((t) => recordLandmarks(t, []))
    // every kind is listed as a landmark, per stage…
    expect(all.every((list) => list.length > 3)).toBe(true)
    const sequence = buildSequence([a, b])
    const landmarks = sequenceLandmarks(sequence, { a: all[0], b: all[1] })!
    const stops = stopCandidates({ track: sequence.track, landmarks })
    // …but only three per stage feed the automatic stops
    expect(stops.length).toBeLessThanOrEqual(6)
    expect(stops.length).toBeGreaterThan(2)
    const kinds = new Set(stops.map((s) => (s.source.ref ?? '').split(':')[2]))
    expect([...kinds].every((k) => ['steepestClimb', 'highest', 'fastestDescent'].includes(k))).toBe(true)
  })

  it('do not add pauses to a film saved before the timeline', () => {
    expect(autoStops({ track, landmarks: [record], pacing: ON }, 'rythme').map((s) => s.label?.slice(0, 8))).toEqual(['Montée 1'])
  })
})

describe('autoStops (rythme: films saved before the timeline)', () => {
  it('none with the default pacing (off) or without pause', () => {
    expect(autoStops({ track, landmarks, pacing: DEFAULT_PACING }, 'rythme')).toEqual([])
    expect(autoStops({ track, landmarks, pacing: { ...ON, pauseS: 0 } }, 'rythme')).toEqual([])
  })

  it('one held stop per highlight: climb top and landmarks, with label, source and a stable id', () => {
    const stops = autoStops({ track, landmarks, pacing: ON }, 'rythme')
    expect(stops).toHaveLength(3)
    const [pass, top, peak] = stops
    expect(pass).toEqual({
      id: autoStopId(1500),
      atM: 1500,
      durationS: ON.pauseS,
      camera: 'film',
      label: 'Col de Voza',
      source: { kind: 'landmark', ref: 'node/1500' },
    })
    expect(top.atM).toBeGreaterThan(2800)
    expect(top.atM).toBeLessThan(3100)
    expect(top.source).toEqual({ kind: 'climb', ref: '0' })
    expect(top.label).toMatch(/^Montée 1/)
    expect(peak.label).toBe('Mont Lachat')
    expect(autoStops({ track, landmarks, pacing: ON }, 'rythme')).toEqual(stops)
  })

  it('follow the highlight kinds and cluster close highlights like the pauses they replace', () => {
    expect(autoStops({ track, landmarks, pacing: { ...ON, landmarks: false } }, 'rythme').map((s) => s.source?.kind)).toEqual(['climb'])
    expect(autoStops({ track, landmarks, pacing: { ...ON, climbs: false } }, 'rythme').map((s) => s.label)).toEqual(['Col de Voza', 'Mont Lachat'])
    // window of 1.5 km: the pass and the climb top (~1.45 km apart) form one cluster, paused once
    expect(autoStops({ track, landmarks, pacing: { ...ON, windowM: 1500 } }, 'rythme')).toHaveLength(2)
  })
})

describe('autoStops (temps-forts: new films)', () => {
  it('a stop at every pass crossed and peak nearby whatever the pacing, orbiting, AUTO_STOP_S each; none at the climb tops', () => {
    const stops = autoStops({ track, landmarks, pacing: DEFAULT_PACING }, 'temps-forts')
    expect(stops.map((s) => s.label)).toEqual(['Col de Voza', 'Mont Lachat'])
    expect(stops.every((s) => s.camera === 'orbite' && s.durationS === AUTO_STOP_S)).toBe(true)
    expect(autoStops({ track, landmarks, pacing: { ...DEFAULT_PACING, climbs: false } }, 'temps-forts')).toEqual(stops)
    // the pacing's « Repères » and « Longueur du ralenti » no longer touch them; the grouping is the film's own
    expect(autoStops({ track, landmarks, pacing: { ...DEFAULT_PACING, landmarks: false, windowM: 5000 } }, 'temps-forts')).toEqual(stops)
    expect(autoStops({ track, landmarks, pacing: DEFAULT_PACING }, 'temps-forts', 5000)).toHaveLength(1)
  })

  it('stopCandidates: the highlight landmarks by position, not clustered, never a climb top', () => {
    const candidates = stopCandidates({ track, landmarks })
    expect(candidates.map((c) => c.source)).toEqual([
      { kind: 'landmark', ref: 'node/1500' },
      { kind: 'landmark', ref: 'node/4500' },
    ])
    expect(autoStops({ track, landmarks, pacing: DEFAULT_PACING }, 'temps-forts', 5000)).toHaveLength(1)
  })
})

describe('stops of the rows of « Repères »', () => {
  const pass: StopPlace = { id: 'node/1500', atM: 1500 }
  const stop = (id: string, atM: number, source?: FilmStop['source']): FilmStop => ({ id, atM, durationS: 4, camera: 'orbite', source })

  it('placeStop: the stop made for the landmark, else one placed by hand within a metre', () => {
    expect(placeStop([stop('stop-1', 1500.5, { kind: 'manual' }), stop('stop-2', 1600, { kind: 'landmark', ref: 'node/1500' })], pass)?.id).toBe('stop-2')
    expect(placeStop([stop('stop-1', 1500.5, { kind: 'manual' })], pass)?.id).toBe('stop-1')
    expect(placeStop([stop('stop-1', 1499.5)], pass)?.id).toBe('stop-1')
    // made for another landmark or a climb there, or too far: not its stop
    expect(placeStop([stop('stop-1', 1500, { kind: 'landmark', ref: 'node/9' }), stop('stop-2', 1500, { kind: 'climb', ref: '0' })], pass)).toBeUndefined()
    expect(placeStop([stop('stop-1', 1502)], pass)).toBeUndefined()
  })

  it('withoutPlaceItems: the own stops of the hidden rows go, the rest stays', () => {
    const own: Film = {
      ...DEFAULT_FILM,
      autoStops: false,
      stops: [stop('stop-1', 1500, { kind: 'landmark', ref: 'node/1500' }), stop('stop-2', 3000, { kind: 'climb', ref: '0' }), stop('stop-3', 800)],
      // slow-downs and titles an earlier version wrote for a landmark are ordinary items now: hiding leaves them
      speeds: [{ id: 'auto-speed-node-1500', fromM: 1300, toM: 1700, factor: 0.5 }],
      texts: [{ id: 'auto-text-node-1500', startS: 10, durationS: 4, text: 'Col de Voza', anchor: 'top-center', size: 1 }],
    }
    const hidden = withoutPlaceItems(own, [pass, { id: 'poi-1', atM: 800 }])
    expect(hidden).toEqual({ ...own, stops: [own.stops[1]] })
    // generated stops follow the landmarks shown by themselves
    expect(withoutPlaceItems({ ...own, autoStops: true }, [pass]).stops).toHaveLength(3)
    expect(withoutPlaceItems(own, [{ id: 'node/9', atM: 9 }])).toBe(own)
  })
})

describe('materializeStops on the default film', () => {
  it('default shots, generated stops written out, valid', () => {
    const film = materializeStops(DEFAULT_FILM, { track, landmarks, pacing: ON })
    expect(film.opening).toEqual(DEFAULT_FILM.opening)
    expect(film.closing).toEqual(DEFAULT_FILM.closing)
    expect(film.autoStops).toBe(false)
    expect(film.stops).toEqual(autoStops({ track, landmarks, pacing: ON }, 'temps-forts'))
    expect(isValidFilm(film)).toBe(true)
  })

  it('materializeStops: writes the generated stops of the film mode, keeps the rest; own stops untouched', () => {
    const legacy: Film = { ...DEFAULT_FILM, autoMode: 'rythme', opening: { style: 'saut', durationS: 3 } }
    const written = materializeStops(legacy, { track, landmarks, pacing: ON })
    expect(written).toEqual({ ...legacy, autoStops: false, stops: autoStops({ track, landmarks, pacing: ON }, 'rythme') })
    expect(materializeStops(written, { track, landmarks, pacing: DEFAULT_PACING })).toBe(written)
  })

  it('filmStops: generated while autoStops is set, else the film own', () => {
    expect(filmStops(DEFAULT_FILM, { track, landmarks, pacing: ON })).toHaveLength(2)
    expect(filmStops({ ...DEFAULT_FILM, autoMode: 'rythme' }, { track, landmarks, pacing: DEFAULT_PACING })).toEqual([])
    const own = { ...DEFAULT_FILM, autoStops: false, stops: [{ id: 'stop-1', atM: 10, durationS: 1, camera: 'orbite' as const }] }
    expect(filmStops(own, { track, landmarks, pacing: ON })).toBe(own.stops)
  })
})
