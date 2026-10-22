/**
 * Glaciers around a track from OpenStreetMap (Overpass, same client, queue and cache as the landmarks, the water and the
 * forests): `natural=glacier` as polygons with holes, drawn white on the relief whatever the snow line of the day
 * (scene/GlacierLayer.tsx).
 *
 * One query per track in the corridor boxes of the track, with full geometry. The response is reduced here (pure): the
 * rings are stitched, simplified at 8 m and the small polygons dropped by `parseForest` (osm/forest.ts, which only reads the
 * geometry of ways and multipolygons: the tag it asks for is the query's business), then the largest glaciers are kept
 * within MAX_GLACIER_POLYGONS and MAX_GLACIER_VERTICES. Only that compact result is cached (localStorage, 30 days).
 */
import type { Track } from '../core/types'
import { parseForest } from './forest'
import {
  QUERY_TIMEOUT_S,
  cachedOverpassQuery,
  corridorBoxes,
  overpassBbox,
  type OverpassDeps,
} from './overpass'
import { ringAreaM2 } from './water'

/** Corridor around the track (metres), as for the forests. */
export const GLACIER_MARGIN_M = 5000
/** Polygons smaller than this are dropped (m², 2 ha: a snow patch is not a glacier). */
export const MIN_GLACIER_AREA_M2 = 20_000
export const MAX_GLACIER_POLYGONS = 200
/** Most vertices kept in all, largest glaciers first: ~20 bytes each in the cache, far under its 1.5 MB entry limit. */
export const MAX_GLACIER_VERTICES = 20_000

/** A glacier. Rings open (last point ≠ first), [lon, lat]. */
export interface GlacierPolygon {
  /** "way/123" or "relation/45" */
  id: string
  outer: [number, number][]
  holes: [number, number][][]
}

/** Overpass QL query of the glaciers inside the corridor of `track` (full geometry). */
export function glacierQuery(track: Track): string {
  const lines = corridorBoxes(track, GLACIER_MARGIN_M).flatMap((b) => {
    const bbox = overpassBbox(b)
    return [`  way["natural"="glacier"]${bbox};`, `  relation["natural"="glacier"]["type"="multipolygon"]${bbox};`]
  })
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${lines.join('\n')}\n);\nout geom qt;\n`
}

/** Glacier polygons of an Overpass `out geom` response, largest first; throws on a server-side error. */
export function parseGlacier(json: unknown): GlacierPolygon[] {
  const kept: GlacierPolygon[] = []
  let vertices = 0
  // parseForest gives the polygons largest first
  for (const { id, outer, holes } of parseForest(json)) {
    if (ringAreaM2(outer.map(([lon, lat]) => ({ lon, lat }))) < MIN_GLACIER_AREA_M2) break
    const count = outer.length + holes.reduce((n, h) => n + h.length, 0)
    if (kept.length >= MAX_GLACIER_POLYGONS) break
    if (vertices + count > MAX_GLACIER_VERTICES) continue
    kept.push({ id, outer, holes })
    vertices += count
  }
  return kept
}

/** Glaciers around `track`, from the caches or one queued Overpass query (fair use: see overpass.ts). */
export function fetchTrackGlacier(track: Track, signal?: AbortSignal, deps?: OverpassDeps): Promise<GlacierPolygon[]> {
  return cachedOverpassQuery(glacierQuery(track), parseGlacier, signal, deps)
}
