/**
 * Elevation of a track that has none (routes drawn on a map, some exports), read from the terrain source chosen in the
 * settings: the DEM tiles under the points at one zoom (`elevationZoom`), through a tile fetcher (offline packs first,
 * then the network and its HTTP cache), bilinear sampling. Points with a recorded elevation keep it; a gap between two
 * recorded points is shifted onto them, so the device's offset to the terrain makes no step (no false D+).
 * Limit: bridges and tunnels follow the ground (the terrain has no deck nor bore).
 * The same ground, read under every point of a recorded track, finds its flights at import (`withFlights`).
 */
import { clamp } from '../core/math'
import type { HeightGrid, LonLat, TerrainSource, TileFetcher, TileKey, Track, TrackPoint, TrackSegment } from '../core/types'
import { detectFlights } from '../flyover/flights'
import { buildTrackPath } from '../flyover/path'
import { cumulativeDistances } from '../geo/lonLat'
import { lonLatToTileFrac, lonLatToTileUV, tileKeyString } from '../geo/mercator'
import { computeStats } from '../import/stats'
import { decodeDem, sampleGrid } from './dem'
import { createTileFetcher, isNoDataError } from './fetch'
import { buildTileUrl } from './sources'

/** Ground height in metres above sea level under a point, NaN when unknown. */
export type HeightSampler = (point: LonLat) => number

/** The height grid of one tile, null when the source has no data there; rejects on a network failure. */
export type GridLoader = (key: TileKey, signal?: AbortSignal) => Promise<HeightGrid | null>

/**
 * Tiles above which an import does not compute the elevation by itself (the track card offers « Calculer
 * l'altitude »). A 512 px tile at z12 is ~7 km wide at 45° N and weighs ~150 KB (Mapterhorn): 64 tiles (~10 MB, a few
 * seconds) cover a 200 km outing even when it winds, about what the 3D view loads anyway when it opens; a multi-day
 * raid (500 km and more) would hold the import for much longer.
 */
export const AUTO_ELEVATION_MAX_TILES = 64

/** Longest wait an import gives the computation (offline, a failing request is retried for ~5 s). */
export const AUTO_ELEVATION_TIMEOUT_MS = 15_000

/** Few requests at a time: the 3D view shares the network, and a decoded grid is 1 MB until its points are read. */
const FETCHER_OPTIONS = { concurrency: 4, maxEntries: 16 }

function hasElevation(point: TrackPoint): boolean {
  return point.ele !== undefined && Number.isFinite(point.ele)
}

/** True when some point of the track has no elevation. */
export function hasMissingElevation(track: Track): boolean {
  return track.segments.some((segment) => segment.points.some((point) => !hasElevation(point)))
}

/**
 * Zoom read: 13 for 256 px tiles, 12 for 512 px ones (~19 m per pixel at the equator, ~14 m at 45° N), within the
 * source's range. Finer would multiply the tiles for a profile that shows no more.
 */
export function elevationZoom(source: TerrainSource): number {
  return clamp(Math.round(13 - Math.log2(source.tileSize / 256)), source.minZoom, source.maxZoom)
}

function tileAt(point: LonLat, z: number): TileKey {
  const n = 2 ** z
  const f = lonLatToTileFrac(point.lon, point.lat, z)
  return { z, x: clamp(Math.floor(f.x), 0, n - 1), y: clamp(Math.floor(f.y), 0, n - 1) }
}

/** Runs of consecutive points without elevation, as [first, last] indices. */
function gapsOf(points: readonly TrackPoint[]): [number, number][] {
  const gaps: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    if (hasElevation(points[i])) continue
    const first = i
    while (i + 1 < points.length && !hasElevation(points[i + 1])) i++
    gaps.push([first, i])
  }
  return gaps
}

/**
 * The points a sampler is asked about, grouped by tile: those without elevation and the recorded one on each side of a
 * gap, or every point (`all`, for the flights).
 */
function sampledPointsByTile(track: Track, z: number, all = false): Map<string, { key: TileKey; points: TrackPoint[] }> {
  const tiles = new Map<string, { key: TileKey; points: TrackPoint[] }>()
  const add = (point: TrackPoint) => {
    const key = tileAt(point, z)
    const id = tileKeyString(key)
    const tile = tiles.get(id)
    if (tile) tile.points.push(point)
    else tiles.set(id, { key, points: [point] })
  }
  for (const { points } of track.segments) {
    if (all) points.forEach(add)
    else {
      for (const [first, last] of gapsOf(points)) {
        for (let i = Math.max(0, first - 1); i <= Math.min(points.length - 1, last + 1); i++) add(points[i])
      }
    }
  }
  return tiles
}

/** Number of tiles the computation reads for this track (0 when no point lacks elevation): its cost. */
export function elevationTileCount(track: Track, source: TerrainSource): number {
  return sampledPointsByTile(track, elevationZoom(source)).size
}

/** Recorded minus ground elevation at a recorded point, NaN when the ground is unknown there. */
function offsetAt(point: TrackPoint | undefined, sample: HeightSampler): number {
  return point && hasElevation(point) ? (point.ele as number) - sample(point) : NaN
}

/**
 * The track with an elevation on every point the sampler knows the ground under, stats recomputed and
 * `elevationEstimated` set ('all' when no point had one, 'gaps' otherwise); the same track when nothing was filled.
 * In a gap, the ground is shifted by the offset of the recorded points around it, weighed by distance.
 */
export function withTerrainElevation(track: Track, sample: HeightSampler): Track {
  let filled = 0
  let recorded = 0
  const segments = track.segments.map((segment): TrackSegment => {
    const { points } = segment
    const gaps = gapsOf(points)
    recorded += points.length - gaps.reduce((n, [first, last]) => n + last - first + 1, 0)
    if (gaps.length === 0) return segment
    const out = points.slice()
    for (const [first, last] of gaps) {
      const before = offsetAt(points[first - 1], sample)
      const after = offsetAt(points[last + 1], sample)
      const from = Math.max(0, first - 1)
      const span = cumulativeDistances(points.slice(from, Math.min(points.length, last + 2)))
      const total = span[span.length - 1]
      for (let i = first; i <= last; i++) {
        const ground = sample(points[i])
        if (!Number.isFinite(ground)) continue
        const t = total > 0 ? span[i - from] / total : 0.5
        const offset = Number.isFinite(before)
          ? Number.isFinite(after)
            ? before + (after - before) * t
            : before
          : Number.isFinite(after)
            ? after
            : 0
        out[i] = { ...points[i], ele: Math.round((ground + offset) * 10) / 10 }
        filled++
      }
    }
    return { points: out }
  })
  if (filled === 0) return track
  const estimated = recorded === 0 || track.elevationEstimated === 'all' ? 'all' : 'gaps'
  return { ...track, segments, stats: computeStats(segments), elevationEstimated: estimated }
}

/** « Effacer » : the track as imported, without the elevation computed on every point (only for 'all'). */
export function withoutTerrainElevation(track: Track): Track {
  if (track.elevationEstimated !== 'all') return track
  const segments = track.segments.map((segment) => ({
    points: segment.points.map((p) => {
      const point = { ...p }
      delete point.ele
      return point
    }),
  }))
  const out: Track = { ...track, segments, stats: computeStats(segments) }
  delete out.elevationEstimated
  return out
}

/** Grids of `source` through `fetcher` (offline packs, then the network); a 4xx answer means no data there. */
export function createGridLoader(source: TerrainSource, fetcher: TileFetcher): GridLoader {
  return async (key, signal) => {
    try {
      return decodeDem(await fetcher.fetchBitmap(buildTileUrl(source, key), { signal }), source.encoding)
    } catch (error) {
      if (isNoDataError(error)) return null
      throw error
    }
  }
}

/**
 * Ground heights under the points the track needs (`withTerrainElevation`), read tile by tile: a grid is dropped once
 * its points are read. Rejects when a tile cannot be loaded (network, abort): nothing is half computed.
 */
export async function loadTerrainSampler(track: Track, z: number, load: GridLoader, signal?: AbortSignal, all = false): Promise<HeightSampler> {
  const heights = new Map<LonLat, number>()
  await Promise.all(
    Array.from(sampledPointsByTile(track, z, all).values(), async ({ key, points }) => {
      const grid = await load(key, signal)
      if (!grid) return
      for (const point of points) {
        const { u, v } = lonLatToTileUV(key, point.lon, point.lat)
        heights.set(point, sampleGrid(grid, u, v))
      }
    }),
  )
  return (point) => heights.get(point) ?? NaN
}

/** The track with its flights (`detectFlights`) against the ground `sample` gives under its points; the same track when it has none. */
export function withFlights(track: Track, sample: HeightSampler): Track {
  const ground = track.segments.flatMap((segment) => segment.points.map((point) => sample(point)))
  const flights = detectFlights(buildTrackPath(track), ground)
  return flights.length > 0 ? { ...track, flights } : track
}

/**
 * At import: `withFlights` with the ground of `source` under every point, for a track with recorded elevation that
 * needs at most `maxTiles` tiles (the same track otherwise). Rejects on a network failure.
 */
async function detectTrackFlights(
  track: Track,
  source: TerrainSource,
  maxTiles: number,
  options: { load?: GridLoader; signal?: AbortSignal },
): Promise<Track> {
  const z = elevationZoom(source)
  if (track.stats.maxEle === undefined || track.elevationEstimated === 'all') return track
  if (sampledPointsByTile(track, z, true).size > maxTiles) return track
  if (options.load) return withFlights(track, await loadTerrainSampler(track, z, options.load, options.signal, true))
  const fetcher = createTileFetcher(FETCHER_OPTIONS)
  try {
    return withFlights(track, await loadTerrainSampler(track, z, createGridLoader(source, fetcher), options.signal, true))
  } finally {
    fetcher.clear()
  }
}

async function fillFromTerrain(track: Track, source: TerrainSource, load: GridLoader, signal?: AbortSignal): Promise<Track> {
  return withTerrainElevation(track, await loadTerrainSampler(track, elevationZoom(source), load, signal))
}

/**
 * « Calculer l'altitude » : the track with the elevation of `source` where it has none (the same track when every point
 * has one or the source has no data there). `load` replaces the tile fetcher (tests). Rejects on a network failure.
 */
export async function computeTrackElevation(
  track: Track,
  source: TerrainSource,
  options: { load?: GridLoader; signal?: AbortSignal } = {},
): Promise<Track> {
  if (!hasMissingElevation(track)) return track
  if (options.load) return fillFromTerrain(track, source, options.load, options.signal)
  const fetcher = createTileFetcher(FETCHER_OPTIONS)
  try {
    return await fillFromTerrain(track, source, createGridLoader(source, fetcher), options.signal)
  } finally {
    fetcher.clear()
  }
}

/**
 * At import: the tracks with the elevation computed where it is missing, then their flights (`withFlights`), for the
 * tracks that need at most `maxTiles` tiles, within `timeoutMs` for the whole batch. Never rejects: a track that fails
 * (offline, too slow) comes as it was (stays on the ground), and its card offers « Calculer l'altitude ».
 */
export async function completeImportedElevations(
  tracks: readonly Track[],
  source: TerrainSource,
  options: { load?: GridLoader; maxTiles?: number; timeoutMs?: number } = {},
): Promise<Track[]> {
  const maxTiles = options.maxTiles ?? AUTO_ELEVATION_MAX_TILES
  const todo = new Set(tracks.filter((t) => hasMissingElevation(t) && elevationTileCount(t, source) <= maxTiles))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? AUTO_ELEVATION_TIMEOUT_MS)
  try {
    return await Promise.all(
      tracks.map(async (track) => {
        const loading = { load: options.load, signal: controller.signal }
        let out = track
        try {
          if (todo.has(track)) out = await computeTrackElevation(track, source, loading)
          return await detectTrackFlights(out, source, maxTiles, loading)
        } catch {
          return out
        }
      }),
    )
  } finally {
    clearTimeout(timer)
  }
}
