import { describe, expect, it } from 'vitest'
import type { DistanceMap } from '../import/tools/distanceMap'
import { DEFAULT_FILM } from './model'
import type { Film, FilmCameraKey, FilmStop } from './model'
import { remapFilm } from './remap'
import type { StageSpan } from './reorder'

const stop = (id: string, atM: number): FilmStop => ({ id, atM, durationS: 3, camera: 'film' })
const key = (id: string, atM: number): FilmCameraKey => ({ id, atM, distance: 1, pitchDeg: 30, headingOffsetDeg: 0 })
const filmWith = (patch: Partial<Film>): Film => ({ ...DEFAULT_FILM, autoStops: false, ...patch })
const span = (trackId: string, startM: number, endM: number): StageSpan => ({ trackId, startM, endM })

/** the first 400 m of the track cut off */
const trimmed: DistanceMap = { map: (d) => Math.max(0, d - 400), removed: (d) => d < 400 }
const identity: DistanceMap = { map: (d) => d, removed: () => false }

describe('remapFilm', () => {
  it('trimming stage 1 of two stages keeps stage 2 where it is, drops what stood on the removed part and says how many', () => {
    const film = filmWith({ stops: [stop('stop-1', 200), stop('stop-2', 700), stop('stop-3', 1500)] })
    const { film: next, dropped } = remapFilm(film, [span('a', 0, 1000), span('b', 1000, 2000)], [span('a', 0, 600), span('b', 600, 1600)], 'a', trimmed)
    expect(next.stops.map((s) => [s.id, s.atM])).toEqual([
      ['stop-2', 300],
      // stage 2: 500 m into the stage before, 500 m into it after
      ['stop-3', 1100],
    ])
    expect(dropped).toBe(1)
  })

  it('on one track, the items stay on their place and none piles up at the end', () => {
    const film = filmWith({ stops: [stop('stop-1', 900)], cameraKeys: [key('key-1', 500), key('key-2', 100)] })
    const { film: next, dropped } = remapFilm(film, [span('a', 0, 1000)], [span('a', 0, 600)], 'a', trimmed)
    expect(next.stops.map((s) => s.atM)).toEqual([500])
    expect(next.cameraKeys.map((k) => [k.id, k.atM])).toEqual([['key-1', 100]])
    expect(dropped).toBe(1)
  })

  it('a reversal moves a key to the mirrored place', () => {
    const film = filmWith({ cameraKeys: [key('key-1', 200)], markerKeys: [], stops: [stop('stop-1', 1000)] })
    const mirror: DistanceMap = { map: (d) => 1000 - d, removed: () => false }
    const { film: next, dropped } = remapFilm(film, [span('a', 0, 1000)], [span('a', 0, 1000)], 'a', mirror)
    expect(next.cameraKeys[0].atM).toBe(800)
    expect(next.stops[0].atM).toBe(0)
    expect(dropped).toBe(0)
  })

  it('moves the speed portions with their places, and drops one that lies on the removed stretch', () => {
    const film = filmWith({
      speeds: [
        { id: 'speed-1', fromM: 500, toM: 900, factor: 2 },
        { id: 'speed-2', fromM: 0, toM: 300, factor: 2 },
        { id: 'speed-3', fromM: 1200, toM: 1800, factor: 2 },
      ],
    })
    const { film: next, dropped } = remapFilm(film, [span('a', 0, 1000), span('b', 1000, 2000)], [span('a', 0, 600), span('b', 600, 1600)], 'a', trimmed)
    expect(next.speeds.map((s) => [s.id, s.fromM, s.toM])).toEqual([
      ['speed-1', 100, 500],
      ['speed-3', 800, 1400],
    ])
    expect(dropped).toBe(1)
  })

  it('returns the same film when nothing moves, and when the track is not a stage of the film', () => {
    const film = filmWith({ stops: [stop('stop-1', 200)] })
    expect(remapFilm(film, [span('a', 0, 1000)], [span('a', 0, 1000)], 'a', identity).film).toBe(film)
    expect(remapFilm(film, [span('a', 0, 1000)], [span('a', 0, 600)], 'other', trimmed).film).toBe(film)
  })
})
