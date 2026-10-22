/**
 * Forests around a track from OpenStreetMap (Overpass, same client, queue and cache as the landmarks and the water):
 * `landuse=forest` and `natural=wood` as polygons with holes, for the trees of the scene (scene/ForestLayer.tsx).
 *
 * One query per track in the corridor boxes of the track, with full geometry. The response is reduced here (pure):
 * relation rings stitched (the helpers of water.ts), simplified (FOREST_SIMPLIFY_M), small polygons dropped, the largest
 * MAX_FOREST_POLYGONS kept; only that compact result is cached (localStorage, 30 days).
 */
import type { LonLat, Track } from '../core/types'
import {
  QUERY_TIMEOUT_S,
  cachedOverpassQuery,
  corridorBoxes,
  overpassBbox,
  overpassElements,
  simplifyLine,
  type OverpassDeps,
} from './overpass'
import { pointInRing, ringAreaM2, stitchRings } from './water'

/** Corridor around the track (metres): the forests seen from the flyover. Narrower than the water: the payload is larger. */
export const FOREST_MARGIN_M = 5000
/** Simplification tolerance of the edges (metres). */
export const FOREST_SIMPLIFY_M = 8
/** Polygons smaller than this are dropped (m², a 70 m square). */
export const MIN_FOREST_AREA_M2 = 5000
export const MAX_FOREST_POLYGONS = 600
/** Most vertices kept in all (the sample's 8 km corridor has 13,000): ~20 bytes each in the cache, under its 1.5 MB entry limit. */
export const MAX_FOREST_VERTICES = 40_000

/** Trees per hectare offered by the « Densité des arbres » slider. */
export const FOREST_DENSITY_RANGE = { min: 20, max: 150, step: 10 } as const

/** The user setting (`settings.forest`): trees drawn where OpenStreetMap has forests, `density` in trees per hectare. */
export interface ForestSettings {
  enabled: boolean
  density: number
}

export const DEFAULT_FOREST: ForestSettings = { enabled: true, density: 60 }

export const isValidForest = (v: ForestSettings): boolean =>
  v.density >= FOREST_DENSITY_RANGE.min && v.density <= FOREST_DENSITY_RANGE.max

/** `leaf_type` of OpenStreetMap, when it says. */
export type LeafType = 'needleleaved' | 'broadleaved' | 'mixed'

/** A forest. Rings open (last point ≠ first), [lon, lat]. `leaf` absent when OpenStreetMap does not say. */
export interface ForestPolygon {
  /** "way/123" or "relation/45" */
  id: string
  leaf?: LeafType
  outer: [number, number][]
  holes: [number, number][][]
}

/** Overpass QL query of the forests inside the corridor of `track` (full geometry). */
export function forestQuery(track: Track): string {
  const lines = corridorBoxes(track, FOREST_MARGIN_M).flatMap((b) => {
    const bbox = overpassBbox(b)
    return [
      `  way["landuse"="forest"]${bbox};`,
      `  relation["landuse"="forest"]["type"="multipolygon"]${bbox};`,
      `  way["natural"="wood"]${bbox};`,
      `  relation["natural"="wood"]["type"="multipolygon"]${bbox};`,
    ]
  })
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${lines.join('\n')}\n);\nout geom qt;\n`
}

interface GeomPoint {
  lat: number
  lon: number
}

interface ForestElement {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: (GeomPoint | null)[]
  members?: { type: string; ref: number; role?: string; geometry?: (GeomPoint | null)[] }[]
}

type Ring = LonLat[]

const LEAF_TYPES: readonly string[] = ['needleleaved', 'broadleaved', 'mixed']

function leafOf(tags: Record<string, string> = {}): LeafType | undefined {
  return LEAF_TYPES.includes(tags.leaf_type) ? (tags.leaf_type as LeafType) : undefined
}

function toRing(geometry: (GeomPoint | null)[] | undefined): Ring {
  return (geometry ?? []).filter((p): p is GeomPoint => p !== null).map((p) => ({ lon: p.lon, lat: p.lat }))
}

const same = (a: LonLat, b: LonLat) => a.lon === b.lon && a.lat === b.lat
const isClosed = (r: Ring) => r.length >= 4 && same(r[0], r[r.length - 1])
const round5 = (v: number) => Math.round(v * 1e5) / 1e5

/** Simplified open ring rounded to 1e-5° (~1 m), or null when too small. */
function finishRing(ring: Ring): [number, number][] | null {
  const simplified = simplifyLine(ring, FOREST_SIMPLIFY_M)
  const open = isClosed(simplified) ? simplified.slice(0, -1) : simplified
  if (open.length < 3 || ringAreaM2(open) < MIN_FOREST_AREA_M2) return null
  return open.map((p) => [round5(p.lon), round5(p.lat)])
}

function polygonsOf(id: string, leaf: LeafType | undefined, outers: Ring[], inners: Ring[]): ForestPolygon[] {
  const out: ForestPolygon[] = []
  const holesOf = outers.map((): Ring[] => [])
  for (const inner of inners) {
    const owner = outers.findIndex((outer) => pointInRing(inner[0], outer))
    if (owner >= 0) holesOf[owner].push(inner)
  }
  outers.forEach((ring, i) => {
    const outer = finishRing(ring)
    if (!outer) return
    const holes = holesOf[i].map(finishRing).filter((h): h is [number, number][] => h !== null)
    out.push({ id: outers.length > 1 ? `${id}#${i}` : id, ...(leaf ? { leaf } : {}), outer, holes })
  })
  return out
}

/** Forest polygons of an Overpass `out geom` response, largest first; throws on a server-side error. */
export function parseForest(json: unknown): ForestPolygon[] {
  const elements = overpassElements(json) as ForestElement[]
  // a way that is also a member of a returned relation is drawn by the relation
  const members = new Set(elements.flatMap((e) => (e.type === 'relation' ? (e.members ?? []).map((m) => m.ref) : [])))
  const polygons: ForestPolygon[] = []
  for (const e of elements) {
    if (e.type === 'way' && !members.has(e.id)) {
      const ring = toRing(e.geometry)
      if (isClosed(ring)) polygons.push(...polygonsOf(`way/${e.id}`, leafOf(e.tags), [ring], []))
    } else if (e.type === 'relation') {
      const ways = (e.members ?? []).filter((m) => m.type === 'way')
      const outers = stitchRings(ways.filter((m) => m.role !== 'inner').map((m) => toRing(m.geometry)))
      const inners = stitchRings(ways.filter((m) => m.role === 'inner').map((m) => toRing(m.geometry)))
      polygons.push(...polygonsOf(`relation/${e.id}`, leafOf(e.tags), outers, inners))
    }
  }
  const area = new Map(polygons.map((p) => [p, ringAreaM2(p.outer.map(([lon, lat]) => ({ lon, lat })))]))
  // the largest first, until the polygons or the vertices run out (a smaller one may still fit)
  const kept: ForestPolygon[] = []
  let vertices = 0
  for (const p of polygons.sort((a, b) => area.get(b)! - area.get(a)!)) {
    const count = p.outer.length + p.holes.reduce((n, h) => n + h.length, 0)
    if (kept.length >= MAX_FOREST_POLYGONS) break
    if (vertices + count > MAX_FOREST_VERTICES) continue
    kept.push(p)
    vertices += count
  }
  return kept
}

/** Forests around `track`, from the caches or one queued Overpass query (fair use: see overpass.ts). */
export function fetchTrackForest(track: Track, signal?: AbortSignal, deps?: OverpassDeps, onStart?: () => void): Promise<ForestPolygon[]> {
  return cachedOverpassQuery(forestQuery(track), parseForest, signal, deps, false, onStart)
}
