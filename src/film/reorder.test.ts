import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { DEFAULT_FILM, MIN_SPEED_SPAN_M } from './model'
import type { Film, JunctionCard } from './model'
import { dropIndexAt, idsByDate, movedIds, reorderStages } from './reorder'
import type { StageSpan } from './reorder'

const A = 'a'
const B = 'b'
const C = 'c'
/** a 1 km stage, a 2 km one and a 1.5 km one, in this order */
const ABC: StageSpan[] = [
  { trackId: A, startM: 0, endM: 1000 },
  { trackId: B, startM: 1000, endM: 3000 },
  { trackId: C, startM: 3000, endM: 4500 },
]
/** the same stages flown C, A, B */
const CAB: StageSpan[] = [
  { trackId: C, startM: 0, endM: 1500 },
  { trackId: A, startM: 1500, endM: 2500 },
  { trackId: B, startM: 2500, endM: 4500 },
]

const stop = (id: string, atM: number) => ({ id, atM, durationS: 4, camera: 'orbite' as const })
const key = (id: string, atM: number) => ({ id, atM, distance: 1, pitchDeg: 40, headingOffsetDeg: 0 })
const card = (text: string): JunctionCard => ({ enabled: true, durationS: 5, anchor: 'center', size: 1, text })

const film: Film = {
  ...DEFAULT_FILM,
  autoStops: false,
  stops: [stop('stop-1', 200), stop('stop-2', 1500), stop('stop-3', 3500)],
  speeds: [{ id: 'speed-1', fromM: 1200, toM: 1800, factor: 2 }],
  cameraKeys: [key('camera-1', 100), key('camera-2', 3200)],
  paramKeys: [{ id: 'param-1', atM: 3100, param: 'exposure', value: 0.5 }],
  markerKeys: [{ id: 'marker-1', atM: 2900, kind: 'boule', figure: 'auto' }],
  texts: [{ id: 'text-1', startS: 6, durationS: 4, text: 'Jour 1', anchor: 'center', size: 1 }],
}

describe('reorderStages', () => {
  it('carries every item anchored in metres with its stage', () => {
    const out = reorderStages(film, ABC, CAB)
    // A moves by +1500, B by +1500, C by -3000
    expect(out.stops.map((s) => [s.id, s.atM])).toEqual([
      ['stop-1', 1700],
      ['stop-2', 3000],
      ['stop-3', 500],
    ])
    expect(out.cameraKeys.map((k) => k.atM)).toEqual([1600, 200])
    expect(out.paramKeys[0].atM).toBe(100)
    expect(out.markerKeys[0].atM).toBe(4400)
    // the rest of the film is untouched, and so are the texts (film seconds)
    expect(out.texts).toBe(film.texts)
    expect(out.opening).toBe(film.opening)
  })

  it('puts an item at a boundary in the stage that starts there, and the end of the last stage in the last', () => {
    const edge = { ...film, stops: [stop('at-b', 1000), stop('at-c', 3000), stop('at-end', 4500)] }
    const out = reorderStages(edge, ABC, CAB)
    // 1000 starts B (+1500), 3000 starts C (-3000), the end of the sequence ends C (-3000)
    expect(out.stops.map((s) => s.atM)).toEqual([2500, 0, 1500])
  })

  it('splits a speed portion across a boundary in two, one per stage, the same factor', () => {
    const across: Film = { ...film, speeds: [{ id: 'speed-1', fromM: 800, toM: 1400, factor: 3 }] }
    const out = reorderStages(across, ABC, CAB)
    expect(out.speeds).toEqual([
      { id: 'speed-1', fromM: 2300, toM: 2500, factor: 3 },
      { id: 'speed-2', fromM: 2500, toM: 2900, factor: 3 },
    ])
  })

  it('drops the pieces of a split speed that are shorter than the minimum, a whole portion is kept', () => {
    const sliver: Film = { ...film, speeds: [{ id: 'speed-1', fromM: 1000 - (MIN_SPEED_SPAN_M - 1), toM: 1600, factor: 2 }] }
    const out = reorderStages(sliver, ABC, CAB)
    expect(out.speeds).toEqual([{ id: 'speed-1', fromM: 2500, toM: 3100, factor: 2 }])
    const small: Film = { ...film, speeds: [{ id: 'speed-1', fromM: 100, toM: 100 + MIN_SPEED_SPAN_M, factor: 2 }] }
    expect(reorderStages(small, ABC, CAB).speeds).toEqual([{ id: 'speed-1', fromM: 1600, toM: 1600 + MIN_SPEED_SPAN_M, factor: 2 }])
  })

  it('numbers the second piece of a split speed after the highest speed of the film', () => {
    const two: Film = {
      ...film,
      speeds: [
        { id: 'speed-1', fromM: 800, toM: 1400, factor: 3 },
        { id: 'speed-7', fromM: 3200, toM: 3400, factor: 0.5 },
      ],
    }
    expect(reorderStages(two, ABC, CAB).speeds.map((s) => s.id)).toEqual(['speed-1', 'speed-8', 'speed-7'])
  })

  it('is its own inverse: A, B, C back from C, A, B restores the film', () => {
    const there = reorderStages(film, ABC, CAB)
    const back = reorderStages(there, CAB, ABC)
    expect(back).toEqual(film)
  })

  it('changes nothing when the order does not change, and is the same film then', () => {
    expect(reorderStages(film, ABC, ABC)).toBe(film)
    expect(reorderStages(film, [], [])).toBe(film)
    // not the same stages
    expect(reorderStages(film, ABC, CAB.slice(0, 2))).toBe(film)
    expect(reorderStages(film, ABC, [{ ...CAB[0], trackId: 'x' }, CAB[1], CAB[2]])).toBe(film)
  })

  it('moving a stage and moving it back through every intermediate order is the same as the direct move', () => {
    const acb: StageSpan[] = [ABC[0], { trackId: C, startM: 1000, endM: 2500 }, { trackId: B, startM: 2500, endM: 4500 }]
    const viaAcb = reorderStages(reorderStages(film, ABC, acb), acb, CAB)
    expect(viaAcb).toEqual(reorderStages(film, ABC, CAB))
  })

  it('keeps the optional junction fields absent on a film that has none', () => {
    const out = reorderStages(film, ABC, CAB)
    expect(out).not.toHaveProperty('junctions')
    expect(out).not.toHaveProperty('firstCard')
  })

  describe('junctions and cards', () => {
    const own: Film = {
      ...film,
      junctions: [
        { id: 'junction-a', afterTrackId: A, kind: 'coupe', holdS: 0, card: card('Jour B') },
        { id: 'junction-b', afterTrackId: B, kind: 'fondu-blanc', holdS: 2, card: card('Jour C') },
      ],
      firstCard: card('Jour A'),
    }

    it('keeps a junction between the two stages it was between, and gives the others the default', () => {
      // C, A, B: A -> B were neighbours (kept), B -> C are not (C is first now); the card of a stage stays with it
      const out = reorderStages(own, ABC, CAB)
      expect(out.firstCard?.text).toBe('Jour C')
      expect(out.junctions).toEqual([
        { id: 'junction-c', afterTrackId: C, card: card('Jour A') },
        { id: 'junction-a', afterTrackId: A, kind: 'coupe', holdS: 0, card: card('Jour B') },
      ])
    })

    it('B, C, A: the transition between B and C stays, the junction after A is gone, C -> A is the default one', () => {
      const bca: StageSpan[] = [
        { trackId: B, startM: 0, endM: 2000 },
        { trackId: C, startM: 2000, endM: 3500 },
        { trackId: A, startM: 3500, endM: 4500 },
      ]
      const out = reorderStages(own, ABC, bca)
      expect(out.junctions).toEqual([
        { id: 'junction-b', afterTrackId: B, kind: 'fondu-blanc', holdS: 2, card: card('Jour C') },
        { id: 'junction-c', afterTrackId: C, card: card('Jour A') },
      ])
      expect(out.firstCard?.text).toBe('Jour B')
    })

    it('drops a stored junction that has neither its own transition nor a card to carry', () => {
      const lone: Film = { ...film, junctions: [{ id: 'junction-b', afterTrackId: B, kind: 'coupe', holdS: 0 }] }
      // B is last in C, A, B: nothing follows it
      expect(reorderStages(lone, ABC, CAB).junctions).toEqual([])
    })
  })
})

describe('movedIds', () => {
  it('moves an id to a place, clamped, and gives the same list when nothing moves', () => {
    const ids = ['a', 'b', 'c']
    expect(movedIds(ids, 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(movedIds(ids, 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(movedIds(ids, 'a', 9)).toEqual(['b', 'c', 'a'])
    expect(movedIds(ids, 'b', -4)).toEqual(['b', 'a', 'c'])
    expect(movedIds(ids, 'b', 1)).toBe(ids)
    expect(movedIds(ids, 'x', 0)).toBe(ids)
  })
})

describe('idsByDate', () => {
  const at = (name: string, startTime?: number): Track => {
    const t = buildTrack({ name, source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45 }] }] })
    return { ...t, id: name, stats: { ...t.stats, startTime } }
  }

  it('sorts by departure, the tracks without a time last, a tie keeping the list order', () => {
    const tracks = [at('day2', 2000), at('none1'), at('day3', 3000), at('day1', 1000), at('none2'), at('twin', 2000)]
    expect(idsByDate(tracks)).toEqual(['day1', 'day2', 'twin', 'day3', 'none1', 'none2'])
    expect(idsByDate([])).toEqual([])
  })
})

describe('dropIndexAt', () => {
  it('counts the other cards whose centre the pointer has passed', () => {
    expect(dropIndexAt([10, 30, 50], 0)).toBe(0)
    expect(dropIndexAt([10, 30, 50], 31)).toBe(2)
    expect(dropIndexAt([10, 30, 50], 900)).toBe(3)
    expect(dropIndexAt([], 5)).toBe(0)
  })
})
