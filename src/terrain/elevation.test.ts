import { describe, expect, it, vi } from 'vitest'
import type { HeightGrid, LonLat, TileFetcher, TileKey, Track, TrackPoint } from '../core/types'
import { haversineM } from '../geo/lonLat'
import { buildTrack, densify } from '../import/stats'
import {
  AUTO_ELEVATION_MAX_TILES,
  completeImportedElevations,
  computeTrackElevation,
  createGridLoader,
  elevationTileCount,
  elevationZoom,
  hasMissingElevation,
  withTerrainElevation,
  withoutTerrainElevation,
} from './elevation'
import type { GridLoader } from './elevation'
import { TileFetchError } from './fetch'
import { getTerrainSource } from './sources'

vi.mock('./dem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dem')>()),
  // no canvas here: a decoded bitmap is the grid the fake fetcher hands over
  decodeDem: (bitmap: unknown) => bitmap as HeightGrid,
}))

const mapterhorn = getTerrainSource('mapterhorn')
const aws = getTerrainSource('aws-terrarium')

/** Ground of the tests: rises 1 m every 10 m eastwards from 1000 m at lon 6.8. */
const ground = (p: LonLat) => 1000 + haversineM({ lon: 6.8, lat: p.lat }, p) / 10

function trackOf(...segments: TrackPoint[][]): Track {
  return { ...buildTrack({ name: 't', source: 'gpx', segments: segments.map((points) => ({ points })) }), color: '#ff0000' }
}

/** Straight eastward line from (6.8, 45.9), one point every `stepM`, without elevation. */
function line(lengthM: number, stepM = 100): TrackPoint[] {
  const degPerM = 1 / (111_320 * Math.cos((45.9 * Math.PI) / 180))
  return densify([{ lon: 6.8, lat: 45.9 }, { lon: 6.8 + lengthM * degPerM, lat: 45.9 }], stepM)
}

/** Constant grid per tile: every height of tile `key` is `heightOf(key)`. */
function flatLoader(heightOf: (key: TileKey) => number | null): GridLoader & { calls: TileKey[] } {
  const calls: TileKey[] = []
  const load = async (key: TileKey) => {
    calls.push(key)
    const h = heightOf(key)
    return h === null ? null : { width: 2, height: 2, data: new Float32Array(4).fill(h) }
  }
  return Object.assign(load, { calls })
}

describe('withTerrainElevation', () => {
  it('gives a track without elevation the ground under every point, and recomputes its stats', () => {
    const track = trackOf(line(2000))
    expect(track.stats.maxEle).toBeUndefined()
    const out = withTerrainElevation(track, ground)
    expect(out.elevationEstimated).toBe('all')
    expect(hasMissingElevation(out)).toBe(false)
    expect(out.stats.minEle).toBeCloseTo(1000, 0)
    expect(out.stats.maxEle).toBeCloseTo(1200, 0)
    expect(out.stats.ascentM).toBeGreaterThan(150)
    expect(out.id).toBe(track.id)
    expect(out.color).toBe(track.color)
    expect(track.segments[0].points[0].ele).toBeUndefined()
  })

  it('fills a gap between recorded points, shifted onto them so no step appears', () => {
    const points = line(1000)
    // device 20 m above the ground before the gap, 40 m after it
    const recorded = points.map((p, i) => (i < 3 || i > 7 ? { ...p, ele: ground(p) + (i < 3 ? 20 : 40) } : p))
    const out = withTerrainElevation(trackOf(recorded), ground)
    expect(out.elevationEstimated).toBe('gaps')
    const result = out.segments[0].points
    expect(result[0]).toBe(recorded[0])
    expect(result[10]).toBe(recorded[10])
    for (let i = 3; i <= 7; i++) {
      const offset = (result[i].ele as number) - ground(result[i])
      expect(offset).toBeGreaterThan(20)
      expect(offset).toBeLessThan(40)
    }
    // first gap point, a sixth of the way from the point before the gap to the one after it
    expect((result[3].ele as number) - ground(result[3])).toBeCloseTo(20 + 20 / 6, 1)
  })

  it('keeps the track when the ground is unknown everywhere', () => {
    const track = trackOf(line(500))
    expect(withTerrainElevation(track, () => NaN)).toBe(track)
  })
})

describe('withoutTerrainElevation', () => {
  it('removes the computed elevation and the flag', () => {
    const track = trackOf(line(500))
    const cleared = withoutTerrainElevation(withTerrainElevation(track, ground))
    expect(cleared).not.toHaveProperty('elevationEstimated')
    expect(cleared.stats.maxEle).toBeUndefined()
    expect(cleared.segments[0].points.every((p) => !('ele' in p))).toBe(true)
  })

  it('leaves a track whose gaps only were filled (its recorded elevation would go with it)', () => {
    const points = line(500)
    const partial = withTerrainElevation(trackOf(points.map((p, i) => (i === 2 ? p : { ...p, ele: 1000 }))), ground)
    expect(partial.elevationEstimated).toBe('gaps')
    expect(withoutTerrainElevation(partial)).toBe(partial)
  })
})

describe('cost', () => {
  it('reads z12 for 512 px tiles and z13 for 256 px ones', () => {
    expect(elevationZoom(mapterhorn)).toBe(12)
    expect(elevationZoom(aws)).toBe(13)
  })

  it('counts nothing for a track with elevation, and a handful of tiles for a day outing', () => {
    const withEle = trackOf(line(5000).map((p) => ({ ...p, ele: 1000 })))
    expect(elevationTileCount(withEle, mapterhorn)).toBe(0)
    // straight eastward lines at 45.9° N (a winding or looping outing of the same length stays in fewer tiles)
    const counts = [20_000, 100_000, 200_000, 540_000].map((m) => elevationTileCount(trackOf(line(m, 500)), mapterhorn))
    expect(counts).toEqual([4, 16, 30, 80])
    expect(counts.slice(0, 3).every((n) => n <= AUTO_ELEVATION_MAX_TILES)).toBe(true)
    expect(counts[3]).toBeGreaterThan(AUTO_ELEVATION_MAX_TILES)
    // 256 px tiles: about twice as many along a line
    expect(elevationTileCount(trackOf(line(100_000, 500)), aws)).toBe(31)
  })
})

describe('computeTrackElevation', () => {
  it('loads each tile under the points once and samples it', async () => {
    const track = trackOf(line(20_000, 200))
    const load = flatLoader((key) => 500 + key.x - 2125)
    const out = await computeTrackElevation(track, mapterhorn, { load })
    expect(load.calls.length).toBe(elevationTileCount(track, mapterhorn))
    expect(new Set(load.calls.map((k) => `${k.z}/${k.x}/${k.y}`)).size).toBe(load.calls.length)
    expect(load.calls.every((k) => k.z === 12)).toBe(true)
    expect(out.elevationEstimated).toBe('all')
    expect(out.segments[0].points[0].ele).toBe(500 + load.calls[0].x - 2125)
  })

  it('returns the track itself when every point has an elevation, without loading anything', async () => {
    const track = trackOf(line(500).map((p) => ({ ...p, ele: 1 })))
    const load = flatLoader(() => 0)
    expect(await computeTrackElevation(track, mapterhorn, { load })).toBe(track)
    expect(load.calls).toEqual([])
  })

  it('returns the track itself where the source has no data', async () => {
    const track = trackOf(line(500))
    expect(await computeTrackElevation(track, mapterhorn, { load: flatLoader(() => null) })).toBe(track)
  })

  it('rejects when a tile fails, nothing half computed', async () => {
    const load: GridLoader = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(computeTrackElevation(trackOf(line(500)), mapterhorn, { load })).rejects.toThrow('Failed to fetch')
  })
})

describe('createGridLoader', () => {
  const grid: HeightGrid = { width: 1, height: 1, data: new Float32Array([42]) }
  const fetcherOf = (fetchBitmap: TileFetcher['fetchBitmap']): TileFetcher => ({
    fetchBitmap,
    stats: { inflight: 0, queued: 0, cached: 0, failed: 0 },
    clear() {},
  })

  it('fetches the tile URL of the source and decodes it', async () => {
    const fetchBitmap = vi.fn(async () => grid as unknown as ImageBitmap)
    const load = createGridLoader(mapterhorn, fetcherOf(fetchBitmap))
    expect(await load({ z: 12, x: 2125, y: 1452 })).toBe(grid)
    expect(fetchBitmap).toHaveBeenCalledWith('https://tiles.mapterhorn.com/12/2125/1452.webp', { signal: undefined })
  })

  it('reads a 4xx as no data and lets a network failure through', async () => {
    const url = 'https://tiles.mapterhorn.com/12/0/0.webp'
    const missing = createGridLoader(mapterhorn, fetcherOf(() => Promise.reject(new TileFetchError(url, 404))))
    expect(await missing({ z: 12, x: 0, y: 0 })).toBeNull()
    const failing = createGridLoader(mapterhorn, fetcherOf(() => Promise.reject(new TileFetchError(url, 503))))
    await expect(failing({ z: 12, x: 0, y: 0 })).rejects.toThrow('503')
  })
})

describe('completeImportedElevations', () => {
  const load = flatLoader(() => 800)

  it('computes the tracks without elevation and keeps the others as they are', async () => {
    const recorded = trackOf(line(500).map((p) => ({ ...p, ele: 1 })))
    const drawn = trackOf(line(500))
    const [a, b] = await completeImportedElevations([recorded, drawn], mapterhorn, { load })
    expect(a).toBe(recorded)
    expect(b.elevationEstimated).toBe('all')
    expect(b.stats.maxEle).toBe(800)
  })

  it('leaves a track above the tile threshold for the button', async () => {
    const drawn = trackOf(line(20_000, 500))
    const [out] = await completeImportedElevations([drawn], mapterhorn, { load, maxTiles: 3 })
    expect(out).toBe(drawn)
  })

  it('gives up after the timeout or on a failure, without rejecting', async () => {
    const drawn = trackOf(line(500))
    const stalled: GridLoader = (_key, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    expect(await completeImportedElevations([drawn], mapterhorn, { load: stalled, timeoutMs: 10 })).toEqual([drawn])
    const failing: GridLoader = () => Promise.reject(new TypeError('Failed to fetch'))
    expect(await completeImportedElevations([drawn], mapterhorn, { load: failing })).toEqual([drawn])
  })
})
