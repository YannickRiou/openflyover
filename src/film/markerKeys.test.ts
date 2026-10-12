import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_PACING } from '../flyover/pacing'
import { DEFAULT_MARKER } from '../scene/markerSettings'
import { buildFilmClock } from './clock'
import { MARKER_FADE_S, junctionsM, markerAt, markerFadeM, markerKeysMoveWithTime, sortedMarkerKeys } from './markerKeys'
import type { FilmMarkerKey } from './markerKeys'
import { usedMedia } from './media'
import { DEFAULT_FILM, isValidFilm, isValidMarkerKey, nextFilmId, withFilmDefaults } from './model'
import type { Film } from './model'
import { addMarkerKey, addMarkerKeysAt, hasFilmItem, removeFilmItem, updateMarkerKey } from './timeline'

const key = (id: string, atM: number, kind: FilmMarkerKey['kind'], figure: FilmMarkerKey['figure'] = 'auto', imageId?: string): FilmMarkerKey => ({
  id,
  atM,
  kind,
  figure,
  ...(imageId ? { imageId } : {}),
})
const film = (markerKeys: FilmMarkerKey[]): Film => ({ ...DEFAULT_FILM, markerKeys })

describe('markerAt', () => {
  const FADE = 100
  const f = film([key('marker-2', 5000, 'image', 'auto', 'photo-1'), key('marker-1', 1000, 'figurine', 'cycliste')])

  it('the settings themselves without a key and before the first fade', () => {
    expect(markerAt(film([]), DEFAULT_MARKER, 300, FADE)).toEqual({ from: DEFAULT_MARKER, to: DEFAULT_MARKER, mix: 1 })
    expect(markerAt(film([]), DEFAULT_MARKER, 300, FADE).to).toBe(DEFAULT_MARKER)
    const before = markerAt(f, DEFAULT_MARKER, 949, FADE)
    expect(before.mix).toBe(1)
    expect(before.to).toBe(DEFAULT_MARKER)
  })

  it('cross-fades from the previous look to the key look around the key, then holds it', () => {
    const start = markerAt(f, DEFAULT_MARKER, 950, FADE)
    expect(start.mix).toBe(0)
    expect(start.from).toBe(DEFAULT_MARKER)
    expect(start.to).toMatchObject({ kind: 'figurine', figure: 'cycliste', size: DEFAULT_MARKER.size })
    const middle = markerAt(f, DEFAULT_MARKER, 1000, FADE)
    expect(middle.mix).toBeCloseTo(0.5, 9)
    let last = 0
    for (let m = 950; m <= 1050; m += 5) {
      const { mix } = markerAt(f, DEFAULT_MARKER, m, FADE)
      expect(mix).toBeGreaterThanOrEqual(last)
      last = mix
    }
    const after = markerAt(f, DEFAULT_MARKER, 1050, FADE)
    expect(after.mix).toBe(1)
    expect(after.from).toBe(after.to)
    expect(after.to.kind).toBe('figurine')
    expect(markerAt(f, DEFAULT_MARKER, 3000, FADE).to.figure).toBe('cycliste')
  })

  it('the next key fades from the previous key look; a picture comes from the table, else from the settings', () => {
    const fading = markerAt(f, { ...DEFAULT_MARKER, image: 'data:base' }, 5000, FADE, (id) => (id === 'photo-1' ? 'data:one' : ''))
    expect(fading.from).toMatchObject({ kind: 'figurine', figure: 'cycliste' })
    expect(fading.to).toMatchObject({ kind: 'image', image: 'data:one' })
    expect(markerAt(film([key('marker-1', 100, 'image')]), { ...DEFAULT_MARKER, image: 'data:base' }, 500, FADE).to.image).toBe('data:base')
  })

  it('a key at the start is the look from the first metre (the fade does not begin before the track)', () => {
    const at0 = film([key('marker-1', 0, 'figurine')])
    expect(markerAt(at0, DEFAULT_MARKER, 0, FADE).mix).toBe(0)
    expect(markerAt(at0, DEFAULT_MARKER, FADE, FADE).mix).toBe(1)
  })

  it('a pure function of the position: same answer whatever was asked before; no fade length is an immediate change', () => {
    const a = markerAt(f, DEFAULT_MARKER, 1010, FADE)
    markerAt(f, DEFAULT_MARKER, 5000, FADE)
    expect(markerAt(f, DEFAULT_MARKER, 1010, FADE)).toEqual(a)
    expect(markerAt(f, DEFAULT_MARKER, 999, 0).mix).toBe(1)
    expect(markerAt(f, DEFAULT_MARKER, 999, 0).to).toBe(DEFAULT_MARKER)
    expect(markerAt(f, DEFAULT_MARKER, 1000, 0).to.kind).toBe('figurine')
  })

  it('fade length: MARKER_FADE_S of film at the average pace of the flight', () => {
    expect(markerFadeM(12_000, 60)).toBeCloseTo(12_000 * (MARKER_FADE_S / 60), 9)
    expect(markerFadeM(12_000, 0)).toBe(0)
  })

  it('held export frames are rendered again when a key brings an animated or pulsing look', () => {
    const animated = { ...DEFAULT_MARKER, animated: true }
    expect(markerKeysMoveWithTime(film([]), animated)).toBe(false)
    expect(markerKeysMoveWithTime(film([key('marker-1', 1, 'figurine')]), animated)).toBe(true)
    expect(markerKeysMoveWithTime(film([key('marker-1', 1, 'boule')]), { ...DEFAULT_MARKER, ballStyle: 'pulsation' })).toBe(true)
  })
})

describe('film model', () => {
  it('validates the look and the place; unique ids across the film; none in a film saved before', () => {
    expect(DEFAULT_FILM.markerKeys).toEqual([])
    expect(isValidFilm(film([key('marker-1', 10, 'image', 'auto', 'photo-3'), key('marker-2', 0, 'figurine', 'kayak')]))).toBe(true)
    const bad = [
      key('', 1, 'boule'),
      key('marker-1', -1, 'boule'),
      key('marker-1', 1, 'cube' as FilmMarkerKey['kind']),
      key('marker-1', 1, 'figurine', 'licorne' as FilmMarkerKey['figure']),
      { ...key('marker-1', 1, 'boule'), imageId: 7 as unknown as string },
    ]
    for (const k of bad) expect(isValidMarkerKey(k)).toBe(false)
    expect(isValidFilm({ ...film([key('a', 1, 'boule')]), stops: [{ id: 'a', atM: 1, durationS: 2, camera: 'film' }] })).toBe(false)
    const { markerKeys: _, ...saved } = film([])
    expect((withFilmDefaults(saved) as Film).markerKeys).toEqual([])
    expect(nextFilmId(film([key('marker-4', 1, 'boule')]), 'marker')).toBe('marker-5')
  })

  it('edits: one key per place, removed with the other items, the pictures of the keys are kept with the project', () => {
    const a = addMarkerKey(film([]), 500.4, { kind: 'figurine', figure: 'vtt' })
    expect(a.id).toBe('marker-1')
    expect(a.film.markerKeys[0]).toMatchObject({ atM: 500, kind: 'figurine', figure: 'vtt' })
    const same = addMarkerKey(a.film, 500, { kind: 'boule', figure: 'auto' })
    expect(same.id).toBe('marker-1')
    expect(same.film.markerKeys).toHaveLength(1)
    expect(same.film.markerKeys[0].kind).toBe('boule')
    expect(addMarkerKey(a.film, 800, { kind: 'boule', figure: 'auto' }).id).toBe('marker-2')
    expect(updateMarkerKey(a.film, 'marker-1', { atM: -5 }).markerKeys[0].atM).toBe(0)
    expect(hasFilmItem(a.film, [], 'marker-1')).toBe(true)
    expect(removeFilmItem(a.film, 'marker-1').markerKeys).toEqual([])
    const withPicture = film([key('marker-1', 1, 'image', 'auto', 'photo-2')])
    const table = { 'photo-1': { data: 'a' }, 'photo-2': { data: 'b' } } as never
    expect(Object.keys(usedMedia(withPicture, table))).toEqual(['photo-2'])
    expect(sortedMarkerKeys([key('b', 9, 'boule'), key('a', 1, 'boule')]).map((k) => k.id)).toEqual(['a', 'b'])
  })

  it('a key at each junction that has none, with the given look', () => {
    const base = addMarkerKey(film([]), 1000, { kind: 'boule', figure: 'auto' }).film
    const next = addMarkerKeysAt(base, [1000, 2000, 3000], { kind: 'figurine', figure: 'auto' })
    expect(next.markerKeys.map((k) => [k.atM, k.kind])).toEqual([
      [1000, 'boule'],
      [2000, 'figurine'],
      [3000, 'figurine'],
    ])
  })
})

describe('marker keys in the clock', () => {
  it('placed in film time, by position', () => {
    const clock = buildFilmClock({
      opening: { style: 'aucune', durationS: 5 },
      closing: { style: 'aucune', durationS: 5 },
      stops: [],
      lengthM: 10_000,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, enabled: false, keepDuration: false },
      markerKeys: [key('b', 5000, 'boule'), key('a', 0, 'figurine')],
    })
    expect(clock.markerKeys.map((k) => k.id)).toEqual(['a', 'b'])
    expect(clock.markerKeys[1].timeS).toBeCloseTo(30, 6)
  })
})

describe('junctionsM', () => {
  const point = (lat: number) => ({ lon: 6, lat })
  const track = {
    segments: [{ points: [point(45), point(45.01)] }, { points: [point(45.5), point(45.51)] }, { points: [point(46), point(46.01)] }],
  } as unknown as Track

  it('stage cuts « À la suite », else the start of each segment of a chained track, none for one segment', () => {
    expect(junctionsM(track, [1234])).toEqual([1234])
    const found = junctionsM(track)
    expect(found).toHaveLength(2)
    expect(found[0]).toBeCloseTo(1112, -1)
    expect(found[1]).toBeCloseTo(2224, -1)
    expect(junctionsM({ segments: [track.segments[0]] } as unknown as Track)).toEqual([])
    expect(junctionsM(undefined)).toEqual([])
  })
})
