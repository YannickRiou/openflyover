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

describe('autoStops: few and spread out', () => {
  const at = (kind: Landmark['kind'], name: string, alongM: number, distanceM: number, priority = 10): Landmark => ({ ...landmark(kind, name, alongM, distanceM), id: `node/${name}`, priority })
  /** 30 km north */
  const long = buildTrack({ name: 'long', source: 'gpx', segments: [{ points: Array.from({ length: 301 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000 })) }] })
  const gapM = (durationS: number) => Math.max(1000, (15 * long.stats.distanceM) / durationS)
  const spread = (stops: { atM: number }[], minM: number) => stops.every((x, i) => i === 0 || x.atM - stops[i - 1].atM >= minM - 1e-6)

  it('a 60 s flyover gets at most 4 stops, the most notable kept, and a longer one more', () => {
    const peaks = Array.from({ length: 20 }, (_, i) => at('peak', `P${i}`, 500 + i * 1450, 20, 20 + i))
    const stops = autoStops({ track: long, landmarks: peaks, durationS: 60 })
    expect(stops).toHaveLength(4)
    expect(stops.map((x) => x.label)).toContain('P19')
    expect(spread(stops, gapM(60))).toBe(true)
    expect(autoStops({ track: long, landmarks: peaks, durationS: 180 }).length).toBeGreaterThan(4)
    expect(autoStops({ track: long, landmarks: peaks, durationS: 10 })).toHaveLength(1)
  })

  it('no two stops closer than the group, nor than 15 s of film at the base speed', () => {
    const list = [at('pass', 'Col', 1000, 20, 45), at('peak', 'Voisin', 1900, 20, 40), at('peak', 'Loin', 9000, 20, 30)]
    expect(autoStops({ track: long, landmarks: list, durationS: 180 }).map((x) => x.label)).toEqual(['Col', 'Loin'])
    // 30 km in 60 s: 7.5 km apart
    expect(autoStops({ track: long, landmarks: [at('pass', 'A', 1000, 20, 45), at('peak', 'B', 7000, 20, 40), at('peak', 'C', 12000, 20, 30)], durationS: 60 }).map((x) => x.label)).toEqual(['A', 'C'])
  })

  it("the stops of the film's own are not generated, counted, capped nor touched", () => {
    const own = Array.from({ length: 10 }, (_, i): FilmStop => ({ id: `stop-${i}`, atM: 1000 * (i + 1), durationS: 4, camera: 'orbite', source: { kind: 'manual' } }))
    const film: Film = { ...DEFAULT_FILM, autoStops: false, stops: own }
    const input = { track: long, landmarks: [at('pass', 'Col', 1000, 20, 45)], durationS: 60 }
    expect(filmStops(film, input)).toBe(own)
    expect(materializeStops(film, input)).toBe(film)
  })

  it('« Recalculer les records » does not bring back a record stop the cap dropped', () => {
    const rec: Landmark = { ...at('record' as Landmark['kind'], 'Record', 14000, 0, 32), id: 'record:t:highest', recordKind: 'highest' }
    const passes = [0, 1, 2, 3].map((i) => at('pass', `Col ${i}`, 2000 + i * 8000, 20, 45))
    const input = { track: long, landmarks: [...passes, rec], durationS: 60 }
    expect(autoStops(input).map((x) => x.label)).toEqual(['Col 0', 'Col 1', 'Col 2', 'Col 3'])
    expect(alignRecordStops({ ...DEFAULT_FILM, autoStops: false, stops: [] }, input).added).toEqual([])
  })
})

describe('autoStops with « Aussi aux lieux traversés »', () => {
  const at = (kind: Landmark['kind'], name: string, alongM: number, distanceM: number, priority = 10): Landmark => ({ ...landmark(kind, name, alongM, distanceM), id: `node/${name}`, priority })
  const names = (list: Landmark[], durationS = 180, groupM = 1000) => autoStops({ track, landmarks: list, durationS }, groupM, true).map((x) => x.label)

  it('adds the villages, huts, lakes, waterfalls and viewpoints beside the track; not without the option', () => {
    const list = [at('pass', 'Col', 500, 20), at('place', 'Village', 1500, 100), at('hut', 'Refuge', 2500, 250), at('lake', 'Lac', 3200, 250), at('waterfall', 'Cascade', 3900, 250), at('viewpoint', 'Belvédère', 4600, 250)]
    expect(names(list, 180, 500)).toEqual(['Col', 'Village', 'Refuge', 'Lac', 'Cascade', 'Belvédère'])
    expect(autoStops({ track, landmarks: list, durationS: 180 }).map((x) => x.label)).toEqual(['Col'])
    const stop = autoStops({ track, landmarks: list, durationS: 180 }, 500, true)[1]
    expect(stop).toEqual({ id: autoStopId(1500), atM: 1500, durationS: AUTO_STOP_S, camera: 'orbite', label: 'Village', source: { kind: 'landmark', ref: 'node/Village' } })
  })

  it('distance limits: 150 m for a place, 300 m for the others; glaciers and water points are not stops', () => {
    expect(names([at('place', 'Près', 1000, 150), at('place', 'Loin', 2500, 151), at('hut', 'Refuge près', 3500, 300), at('hut', 'Refuge loin', 4500, 301)])).toEqual(['Près', 'Refuge près'])
    expect(names([at('glacier', 'Glacier', 1000, 0), at('waterPoint', 'Source', 2000, 0)])).toEqual([])
  })

  it('places never take the slot of a pass, a summit or a record, whatever their ranking', () => {
    const long = buildTrack({ name: 'long', source: 'gpx', segments: [{ points: Array.from({ length: 301 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000 })) }] })
    const villages = Array.from({ length: 28 }, (_, i) => at('place', `V${i}`, 500 + i * 1000, 20, 49))
    const notable = [at('pass', 'Col', 7300, 20, 45), at('peak', 'Sommet', 19700, 100, 30)]
    const run = (durationS: number, list: Landmark[]) => autoStops({ track: long, landmarks: list, durationS }, 1000, true)
    const stops = run(60, [...villages, ...notable])
    expect(stops.length).toBeLessThanOrEqual(4)
    expect(stops.map((x) => x.label)).toEqual(expect.arrayContaining(['Col', 'Sommet']))
    expect(stops.some((x) => x.label?.startsWith('V'))).toBe(true)
    // the first tier fills the slots: no place at all
    const four = [0, 1, 2, 3].map((i) => at('peak', `S${i}`, 1000 + i * 9000, 20, 30))
    expect(run(60, [...villages, ...four]).map((x) => x.label)).toEqual(['S0', 'S1', 'S2', 'S3'])
  })

  it('« materializeStops » writes the same stops out, and the film validates', () => {
    const film = { ...DEFAULT_FILM, autoStopsPlaces: true }
    const input = { track, landmarks: [at('pass', 'Col', 500, 20), at('place', 'Village', 3000, 20)], durationS: 180 }
    const written = materializeStops(film, input)
    expect(written.autoStops).toBe(false)
    expect(written.stops).toEqual(filmStops(film, input))
    expect(written.stops.map((x) => x.label)).toEqual(['Col', 'Village'])
    expect(isValidFilm(film)).toBe(true)
    expect(isValidFilm({ ...film, autoStopsPlaces: 'oui' as unknown as boolean })).toBe(false)
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
