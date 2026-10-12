import { describe, expect, it } from 'vitest'
import { DEFAULT_PACING } from '../flyover/pacing'
import { DEFAULT_GRADING } from '../scene/grading'
import { buildFilmClock } from './clock'
import type { FilmClockInput } from './clock'
import { DEFAULT_FILM, SPEED_FACTOR_RANGE, isValidFilm, isValidParamKey, nextFilmId, withFilmDefaults } from './model'
import type { Film } from './model'
import { FILM_PARAMS, PARAM_LANE_LABELS, PARAM_SPECS, clampParamValue, gradingAt, keysOfParam, paramAt, paramBase, paramLanes, sortedParamKeys, valueAtKeys } from './paramKeys'
import type { FilmParam, FilmParamKey } from './paramKeys'
import { addParamKey, removeFilmItem, updateParamKey } from './timeline'

const key = (id: string, atM: number, param: FilmParam, value: number): FilmParamKey => ({ id, atM, param, value })
const film = (paramKeys: FilmParamKey[]): Film => ({ ...DEFAULT_FILM, paramKeys })

describe('paramAt', () => {
  const f = film([key('param-2', 1000, 'exposure', 2), key('param-1', 0, 'exposure', -1), key('param-3', 500, 'sunHour', 18)])

  it('base without keys, held before the first and after the last key, one parameter at a time', () => {
    expect(paramAt(film([]), 0.5, 'exposure', 300)).toBe(0.5)
    expect(paramAt(f, 9, 'warmth', 300)).toBe(9)
    expect(paramAt(f, 0, 'exposure', 0)).toBe(-1)
    expect(paramAt(f, 0, 'exposure', 5000)).toBe(2)
    expect(paramAt(f, 0, 'sunHour', 0)).toBe(18)
    expect(paramAt(f, 0, 'sunHour', 9999)).toBe(18)
  })

  it('smootherstep between keys: exact at keys, halfway at the middle, monotonic', () => {
    expect(paramAt(f, 0, 'exposure', 1000)).toBe(2)
    expect(paramAt(f, 0, 'exposure', 500)).toBeCloseTo(0.5, 9)
    let last = paramAt(f, 0, 'exposure', 0)
    for (let m = 10; m <= 1000; m += 10) {
      const v = paramAt(f, 0, 'exposure', m)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })

  it('speed is eased geometrically: x0.5 to x2 passes x1 halfway', () => {
    const s = film([key('a', 0, 'speed', 0.5), key('b', 100, 'speed', 2)])
    expect(paramAt(s, 1, 'speed', 50)).toBeCloseTo(1, 9)
  })

  it('two keys at the same place do not divide by zero', () => {
    const s = film([key('a', 100, 'exposure', 1), key('b', 100, 'exposure', 3), key('c', 200, 'exposure', 3)])
    expect(Number.isFinite(paramAt(s, 0, 'exposure', 100))).toBe(true)
    expect(paramAt(s, 0, 'exposure', 150)).toBeCloseTo(3, 9)
  })

  it('grading values: only the keyed ones move, the base object is returned without keys', () => {
    expect(gradingAt(film([]), DEFAULT_GRADING, 10)).toBe(DEFAULT_GRADING)
    const g = gradingAt(film([key('a', 0, 'saturation', -1), key('b', 100, 'saturation', 1)]), { ...DEFAULT_GRADING, warmth: 0.3 }, 50)
    expect(g).toMatchObject({ saturation: 0, warmth: 0.3, contrast: 0, vignette: 0 })
  })

  it('bases come from the film-wide settings; sortedParamKeys sorts one parameter', () => {
    const settings = { exposureEv: 1, sunHour: 14, grading: { ...DEFAULT_GRADING, contrast: 0.4 } }
    expect(FILM_PARAMS.map((p) => paramBase(settings, p))).toEqual([1, 1, 14, 0, 0.4, 0, 0])
    expect(sortedParamKeys(f.paramKeys, 'exposure').map((k) => k.id)).toEqual(['param-1', 'param-2'])
    expect(valueAtKeys([], 7, 3)).toBe(7)
  })
})

describe('film model', () => {
  it('validates the parameter and its range; unique ids; none in a film saved before', () => {
    expect(DEFAULT_FILM.paramKeys).toEqual([])
    expect(PARAM_SPECS.speed).toMatchObject(SPEED_FACTOR_RANGE)
    expect(isValidFilm(film([key('param-1', 10, 'exposure', 4), key('param-2', 0, 'speed', 0.25), key('param-3', 5, 'sunHour', 24)]))).toBe(true)
    const bad = [
      key('param-1', -1, 'exposure', 0),
      key('param-1', 1, 'exposure', 4.5),
      key('param-1', 1, 'speed', 0),
      key('param-1', 1, 'sunHour', 25),
      key('param-1', 1, 'vignette', -0.1),
      key('', 1, 'exposure', 0),
      key('param-1', 1, 'zoom' as FilmParam, 0),
      key('param-1', 1, 'exposure', Number.NaN),
    ]
    for (const k of bad) expect(isValidParamKey(k)).toBe(false)
    expect(isValidFilm({ ...film([key('a', 1, 'exposure', 0)]), stops: [{ id: 'a', atM: 1, durationS: 2, camera: 'film' }] })).toBe(false)
    const { paramKeys: _, ...saved } = film([])
    expect((withFilmDefaults(saved) as Film).paramKeys).toEqual([])
    expect(nextFilmId(film([key('param-4', 1, 'exposure', 0)]), 'param')).toBe('param-5')
  })

  it('edits: one key per parameter and place, value kept in range, removed with the other items', () => {
    const a = addParamKey(film([]), 500, 'exposure', 1)
    expect(a.id).toBe('param-1')
    expect(addParamKey(a.film, 500, 'sunHour', 12).id).toBe('param-2')
    const same = addParamKey(a.film, 500, 'exposure', 2)
    expect(same.id).toBe('param-1')
    expect(same.film.paramKeys).toHaveLength(1)
    expect(updateParamKey(a.film, 'param-1', { value: 99 }).paramKeys[0].value).toBe(4)
    expect(updateParamKey(a.film, 'param-1', { atM: -5 }).paramKeys[0].atM).toBe(0)
    expect(removeFilmItem(a.film, 'param-1').paramKeys).toEqual([])
    expect(clampParamValue('exposure', 0.3000001)).toBe(0.3)
  })
})

describe('speed keys in the clock', () => {
  const input: FilmClockInput = {
    opening: { style: 'aucune', durationS: 5 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: 10_000,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, enabled: false, keepDuration: false },
  }

  it('without keys: the flight lasts the flyover duration', () => {
    expect(buildFilmClock(input).flightS).toBeCloseTo(60, 9)
  })

  it('x2 over the whole track halves the flight; the clock places the keys in film time', () => {
    const clock = buildFilmClock({ ...input, paramKeys: [key('a', 0, 'speed', 2), key('b', 10_000, 'speed', 2), key('c', 5000, 'exposure', 1)] })
    expect(clock.flightS).toBeCloseTo(30, 6)
    expect(clock.paramKeys.map((k) => k.id)).toEqual(['a', 'c', 'b'])
    expect(clock.paramKeys[1].timeS).toBeCloseTo(15, 6)
  })

  it('keeping the duration, the keys only share the time out along the track', () => {
    const keep = { ...input, pacing: { ...input.pacing, keepDuration: true } }
    const clock = buildFilmClock({ ...keep, paramKeys: [key('a', 0, 'speed', 2), key('b', 10_000, 'speed', 2)] })
    expect(clock.flightS).toBeCloseTo(60, 6)
    const uneven = buildFilmClock({ ...keep, paramKeys: [key('a', 0, 'speed', 0.5), key('b', 5000, 'speed', 2)] })
    expect(uneven.flightS).toBeCloseTo(60, 6)
    expect(uneven.progressAtTime(5 + 30)).toBeLessThan(0.5)
  })

  it('a slow section between keys lengthens the film; the progress stays monotonic', () => {
    const clock = buildFilmClock({
      ...input,
      paramKeys: [key('a', 2000, 'speed', 1), key('b', 4000, 'speed', 0.5), key('c', 6000, 'speed', 0.5), key('d', 8000, 'speed', 1)],
    })
    expect(clock.flightS).toBeGreaterThan(60)
    let last = 0
    for (let t = 0; t <= clock.flightS; t += 0.5) {
      const p = clock.progressAtTime(t)
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
  })
})

describe('lanes and navigation of the parameter keys', () => {
  const keys = [key('a', 300, 'warmth', 0.2), key('b', 100, 'speed', 2), key('c', 50, 'exposure', 1), key('d', 700, 'warmth', -0.1)]

  it('a lane only for a parameter that has a key, in the order of the parameters, the speed on its own lane', () => {
    expect(paramLanes(film([]))).toEqual([])
    expect(paramLanes(film([key('s', 0, 'speed', 2)]))).toEqual([])
    expect(paramLanes(film(keys))).toEqual(['exposure', 'warmth'])
    // the lane goes with its last key
    expect(paramLanes(removeFilmItem(film(keys), 'c'))).toEqual(['warmth'])
  })

  it('every parameter has a lane name, none called « Réglages »', () => {
    expect(Object.keys(PARAM_LANE_LABELS)).toEqual([...FILM_PARAMS])
    expect(Object.values(PARAM_LANE_LABELS)).not.toContain('Réglages')
    expect(PARAM_LANE_LABELS.sunHour).toBe('Soleil')
    expect(PARAM_LANE_LABELS.warmth).toBe('Température')
  })

  it('the keys of one parameter, in the order given (clock keys included)', () => {
    expect(keysOfParam(keys, 'warmth').map((k) => k.id)).toEqual(['a', 'd'])
    expect(keysOfParam(keys, 'vignette')).toEqual([])
    expect(keysOfParam(keys.map((k) => ({ ...k, timeS: k.atM / 10 })), 'speed')).toEqual([{ ...keys[1], timeS: 10 }])
  })
})
