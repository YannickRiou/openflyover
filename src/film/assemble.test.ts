import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildSequence, sequenceLandmarks } from '../flyover/sequence'
import { buildTrack } from '../import/stats'
import { recordLandmarks } from '../osm/landmarks'
import type { Landmark } from '../osm/landmarks'
import {
  alignRecordStops,
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
    expect(autoStops({ track, landmarks: [record] }).map((s) => s.label)).toEqual(['Montée la plus raide · 18 % sur 400 m'])
  })

  it('make at most four stops per stage of a film: the steepest climb, the highest point, the fastest descent, the best thermal', () => {
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
    // …but only these per stage feed the automatic stops
    expect(stops.length).toBeLessThanOrEqual(8)
    expect(stops.length).toBeGreaterThan(2)
    const kinds = new Set(stops.map((s) => (s.source.ref ?? '').split(':')[2]))
    expect([...kinds].every((k) => ['steepestClimb', 'highest', 'fastestDescent', 'bestThermal'].includes(k))).toBe(true)
  })

  describe('alignRecordStops', () => {
    const own = (patch: Partial<Film['stops'][number]>): Film['stops'][number] => ({ id: 'stop-1', atM: 2000, durationS: 4, camera: 'orbite', label: 'À moi', source: { kind: 'manual' }, ...patch })
    const written = (landmark: Landmark) => autoStops({ track, landmarks: [landmark] })[0]
    const film = (stops: Film['stops']): Film => ({ ...DEFAULT_FILM, autoStops: false, stops })
    const input = (list: Landmark[]) => ({ track, landmarks: list })

    it('removes the stop of a record that is gone or moved, adds the stop of a record that has none, never touches the others', () => {
      const gone = { ...record, id: 'record:t:highest', recordKind: 'highest' as const, alongM: 4000 }
      const moved = written({ ...record, alongM: 1000 })
      const byHand = own({ atM: 4500 })
      const passStop = { id: 'stop-2', atM: 1500, durationS: 4, camera: 'orbite' as const, source: { kind: 'landmark' as const, ref: 'node/1500' } }
      // saved with stops for a highest point that is gone and for a steepest climb that has moved since (now at 3200)
      const result = alignRecordStops(film([moved, written(gone), byHand, passStop]), input([landmarks[0], { ...record, alongM: 3200 }]))
      expect(result.removed.map((s) => s.source?.ref).sort()).toEqual(['record:t:highest', 'record:t:steepestClimb'])
      expect(result.added.map((s) => s.atM)).toEqual([3200])
      // the user's stops and the landmarks' stay, ordered along the track
      expect(result.film.stops.map((s) => s.id)).toEqual(['stop-2', autoStopId(3200), 'stop-1'])
      expect(result.film.stops).toContain(byHand)
      expect(result.film.stops).toContain(passStop)
    })

    it('adds no stop beside one set by hand, and the other records stay labels', () => {
      const result = alignRecordStops(film([own({ atM: 2100 })]), input([record, { ...record, id: 'record:t:slowestKm', recordKind: 'slowestKm', alongM: 4000 }]))
      expect(result.added).toEqual([])
      expect(result.removed).toEqual([])
      expect(result.film.stops).toHaveLength(1)
    })

    it('is the same film when nothing changes, and leaves a film that generates its stops to itself', () => {
      const aligned = film([written(record)])
      expect(alignRecordStops(aligned, input([record])).film).toBe(aligned)
      expect(alignRecordStops(DEFAULT_FILM, input([record])).film).toBe(DEFAULT_FILM)
    })
  })
})

describe('autoStops', () => {
  it('a stop at every pass crossed and peak nearby, orbiting, AUTO_STOP_S each; none at the climb tops', () => {
    const stops = autoStops({ track, landmarks })
    expect(stops.map((s) => s.label)).toEqual(['Col de Voza', 'Mont Lachat'])
    expect(stops.every((s) => s.camera === 'orbite' && s.durationS === AUTO_STOP_S)).toBe(true)
    // the grouping is the film's own
    expect(autoStops({ track, landmarks }, 5000)).toHaveLength(1)
  })

  it('stopCandidates: the highlight landmarks by position, not clustered, never a climb top', () => {
    const candidates = stopCandidates({ track, landmarks })
    expect(candidates.map((c) => c.source)).toEqual([
      { kind: 'landmark', ref: 'node/1500' },
      { kind: 'landmark', ref: 'node/4500' },
    ])
    expect(autoStops({ track, landmarks }, 5000)).toHaveLength(1)
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
    const film = materializeStops(DEFAULT_FILM, { track, landmarks })
    expect(film.opening).toEqual(DEFAULT_FILM.opening)
    expect(film.closing).toEqual(DEFAULT_FILM.closing)
    expect(film.autoStops).toBe(false)
    expect(film.stops).toEqual(autoStops({ track, landmarks }))
    expect(isValidFilm(film)).toBe(true)
  })

  it('filmStops: generated while autoStops is set, else the film own', () => {
    expect(filmStops(DEFAULT_FILM, { track, landmarks })).toHaveLength(2)
    const own = { ...DEFAULT_FILM, autoStops: false, stops: [{ id: 'stop-1', atM: 10, durationS: 1, camera: 'orbite' as const }] }
    expect(filmStops(own, { track, landmarks })).toBe(own.stops)
  })
})
