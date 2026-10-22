/**
 * Water around a track from OpenStreetMap (Overpass, same client, queue and cache as the landmarks): lakes and river
 * areas as polygons with holes, the sea along a coast, and the rivers and streams mapped only as lines, for the
 * reflective water of the scene (scene/WaterLayer.tsx).
 *
 * Two queries per track in the corridor boxes of the track, with full geometry: the water areas (`waterQuery`) and the
 * coastline with the waterway lines (`waterLinesQuery`). The responses are reduced here (pure): relation rings stitched,
 * simplified (WATER_SIMPLIFY_M), small polygons dropped, the largest MAX_WATER_POLYGONS kept, the coast turned into sea
 * polygons (coast.ts), the lines capped at MAX_LINE_LENGTH_M; only those compact results are cached (localStorage,
 * 30 days).
 */
import type { LonLat, LonLatBounds, Track } from '../core/types'
import { chainCoastWays, reduceCoast, seaPolygons } from './coast'
import {
  M_PER_DEG,
  QUERY_TIMEOUT_S,
  cachedOverpassQuery,
  corridorBoxes,
  overpassBbox,
  overpassElements,
  planarDistanceM,
  simplifyLine,
  type OverpassDeps,
} from './overpass'

/** Corridor around the track (metres): the lakes seen from the flyover, not only those it passes by. */
export const WATER_MARGIN_M = 8000
/** Simplification tolerance of the shores (metres). */
export const WATER_SIMPLIFY_M = 4
/** Polygons smaller than this are dropped (m², about a 45 m square). */
export const MIN_WATER_AREA_M2 = 2000
export const MAX_WATER_POLYGONS = 300

/** The user setting (`settings.water`): reflective water from OpenStreetMap, strength 0..1 (opacity, reflections). */
export interface WaterSettings {
  enabled: boolean
  strength: number
}

export const DEFAULT_WATER: WaterSettings = { enabled: true, strength: 1 }

/** Corridor of the waterway lines (metres): narrower than the lakes', which are seen from far away; streams are many. */
export const WATER_LINE_MARGIN_M = 4000
/** Widths of a waterway without a `width` tag (metres). */
export const LINE_WIDTH_M: Readonly<Record<string, number>> = { river: 12, canal: 8, stream: 2.5 }
/** Widths outside this range are taken for mistakes (metres). */
export const MIN_LINE_WIDTH_M = 1
export const MAX_LINE_WIDTH_M = 150
/** Most waterway length kept in the corridor (metres): the widest, then the longest, come first. */
export const MAX_LINE_LENGTH_M = 200_000
/** Ways shorter than this are dropped (metres). */
export const MIN_LINE_LENGTH_M = 30

/** A lake (flat surface), a river area (follows the relief) or the sea (flat at 0 m). Rings open (last point ≠ first), [lon, lat]. */
export interface WaterPolygon {
  /** "way/123" or "relation/45", "sea/3" for the sea of the third cell of the corridor */
  id: string
  kind: 'lake' | 'river' | 'sea'
  outer: [number, number][]
  holes: [number, number][][]
}

/** A river, canal or stream mapped as a line only (no riverbank polygon): drawn as a ribbon. [lon, lat]. */
export interface WaterLine {
  /** "way/123" */
  id: string
  /** the `waterway` tag */
  kind: 'river' | 'canal' | 'stream'
  /** metres, from the `width` tag when it has one: else the width of its kind (`lineWidthM`, read when it is drawn) */
  width?: number
  points: [number, number][]
}

/** What the second query gives: sea polygons and waterway lines. */
export type WaterShape = WaterPolygon | WaterLine

export const isWaterLine = (shape: WaterShape): shape is WaterLine => 'points' in shape

/** `water=*` values of flowing water, drawn as rivers. */
const RIVER_WATER = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'stream_pool', 'rapids', 'lock'])

/** Overpass QL query of the water areas inside the corridor of `track` (full geometry). */
export function waterQuery(track: Track): string {
  const lines = corridorBoxes(track, WATER_MARGIN_M).flatMap((b) => {
    const bbox = overpassBbox(b)
    return [
      `  way["natural"="water"]${bbox};`,
      `  relation["natural"="water"]["type"="multipolygon"]${bbox};`,
      `  way["waterway"="riverbank"]${bbox};`,
      `  relation["waterway"="riverbank"]["type"="multipolygon"]${bbox};`,
      `  way["water"]${bbox};`,
      `  relation["water"]["type"="multipolygon"]${bbox};`,
    ]
  })
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${lines.join('\n')}\n);\nout geom qt;\n`
}

interface GeomPoint {
  lat: number
  lon: number
}

interface WaterElement {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: (GeomPoint | null)[]
  members?: { type: string; ref: number; role?: string; geometry?: (GeomPoint | null)[] }[]
}

type Ring = LonLat[]

function kindOf(tags: Record<string, string> = {}): WaterPolygon['kind'] {
  return tags.waterway === 'riverbank' || RIVER_WATER.has(tags.water ?? '') ? 'river' : 'lake'
}

function toRing(geometry: (GeomPoint | null)[] | undefined): LonLat[] {
  return (geometry ?? []).filter((p): p is GeomPoint => p !== null).map((p) => ({ lon: p.lon, lat: p.lat }))
}

const same = (a: LonLat, b: LonLat) => a.lon === b.lon && a.lat === b.lat
const isClosed = (r: Ring) => r.length >= 4 && same(r[0], r[r.length - 1])

/**
 * Closed rings from the member ways of a multipolygon: ways joined end to end (either direction) until the ring
 * closes; what cannot be closed is dropped (incomplete relation).
 */
export function stitchRings(parts: readonly Ring[]): Ring[] {
  const open = parts.filter((p) => p.length >= 2).map((p) => p.slice())
  const rings: Ring[] = []
  while (open.length > 0) {
    let ring = open.pop()!
    while (!isClosed(ring)) {
      const end = ring[ring.length - 1]
      const i = open.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end))
      if (i < 0) break
      const next = open.splice(i, 1)[0]
      ring = ring.concat((same(next[0], end) ? next : next.reverse()).slice(1))
    }
    if (isClosed(ring)) rings.push(ring)
  }
  return rings
}

/** Area of a ring (m², equirectangular around its first point). */
export function ringAreaM2(ring: readonly LonLat[]): number {
  if (ring.length < 3) return 0
  const k = Math.cos((ring[0].lat * Math.PI) / 180) * M_PER_DEG
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].lon - ring[0].lon) * k * ((ring[i].lat - ring[0].lat) * M_PER_DEG)
    sum -= (ring[i].lon - ring[0].lon) * k * ((ring[j].lat - ring[0].lat) * M_PER_DEG)
  }
  return Math.abs(sum) / 2
}

/** Even-odd point in ring test (lon / lat plane). */
export function pointInRing(p: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Simplified open ring rounded to 1e-6° (~10 cm), or null when too small. */
function finishRing(ring: Ring): [number, number][] | null {
  const simplified = simplifyLine(ring, WATER_SIMPLIFY_M)
  const open = isClosed(simplified) ? simplified.slice(0, -1) : simplified
  if (open.length < 3 || ringAreaM2(open) < MIN_WATER_AREA_M2) return null
  return open.map((p) => [round6(p.lon), round6(p.lat)])
}

function polygonsOf(id: string, kind: WaterPolygon['kind'], outers: Ring[], inners: Ring[]): WaterPolygon[] {
  const out: WaterPolygon[] = []
  const holesOf = outers.map((): Ring[] => [])
  for (const inner of inners) {
    const owner = outers.findIndex((outer) => pointInRing(inner[0], outer))
    if (owner >= 0) holesOf[owner].push(inner)
  }
  outers.forEach((ring, i) => {
    const outer = finishRing(ring)
    if (!outer) return
    const holes = holesOf[i].map(finishRing).filter((h): h is [number, number][] => h !== null)
    out.push({ id: outers.length > 1 ? `${id}#${i}` : id, kind, outer, holes })
  })
  return out
}

/** Water polygons of an Overpass `out geom` response, largest first; throws on a server-side error. */
export function parseWater(json: unknown): WaterPolygon[] {
  const elements = overpassElements(json) as WaterElement[]
  // a way that is also a member of a returned relation is drawn by the relation
  const members = new Set(elements.flatMap((e) => (e.type === 'relation' ? (e.members ?? []).map((m) => m.ref) : [])))
  const polygons: WaterPolygon[] = []
  for (const e of elements) {
    if (e.type === 'way' && !members.has(e.id)) {
      const ring = toRing(e.geometry)
      if (isClosed(ring)) polygons.push(...polygonsOf(`way/${e.id}`, kindOf(e.tags), [ring], []))
    } else if (e.type === 'relation') {
      const ways = (e.members ?? []).filter((m) => m.type === 'way')
      const outers = stitchRings(ways.filter((m) => m.role !== 'inner').map((m) => toRing(m.geometry)))
      const inners = stitchRings(ways.filter((m) => m.role === 'inner').map((m) => toRing(m.geometry)))
      polygons.push(...polygonsOf(`relation/${e.id}`, kindOf(e.tags), outers, inners))
    }
  }
  const area = new Map(polygons.map((p) => [p, ringAreaM2(p.outer.map(([lon, lat]) => ({ lon, lat })))]))
  return polygons.sort((a, b) => area.get(b)! - area.get(a)!).slice(0, MAX_WATER_POLYGONS)
}

/** Water around `track`, from the caches or one queued Overpass query (fair use: see overpass.ts). */
export function fetchTrackWater(track: Track, signal?: AbortSignal, deps?: OverpassDeps): Promise<WaterPolygon[]> {
  return cachedOverpassQuery(waterQuery(track), parseWater, signal, deps)
}

// ---------------------------------------------------------------------------
// The sea and the waterway lines (second query)
// ---------------------------------------------------------------------------

/** Overpass QL query of the coastline (in the water corridor) and of the river, canal and stream lines (in the narrower line corridor), full geometry. */
export function waterLinesQuery(track: Track): string {
  const coast = corridorBoxes(track, WATER_MARGIN_M).map((b) => `  way["natural"="coastline"]${overpassBbox(b)};`)
  const lines = corridorBoxes(track, WATER_LINE_MARGIN_M).flatMap((b) => {
    const bbox = overpassBbox(b)
    return Object.keys(LINE_WIDTH_M).map((type) => `  way["waterway"="${type}"]${bbox};`)
  })
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${[...coast, ...lines].join('\n')}\n);\nout geom qt;\n`
}

/** The `width` tag ("12", "12.5 m", "8,5") in metres, clamped; undefined when it is missing or not a number. */
export function taggedWidthM(raw: string | undefined): number | undefined {
  const width = Number.parseFloat((raw ?? '').replace(',', '.'))
  return Number.isFinite(width) ? Math.min(MAX_LINE_WIDTH_M, Math.max(MIN_LINE_WIDTH_M, width)) : undefined
}

/** Width of the ribbon of a line: its own, else that of its kind. */
export const lineWidthM = (line: Pick<WaterLine, 'kind' | 'width'>): number => line.width ?? LINE_WIDTH_M[line.kind]

function lengthM(points: readonly [number, number][]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    sum += planarDistanceM({ lon: points[i - 1][0], lat: points[i - 1][1] }, { lon: points[i][0], lat: points[i][1] })
  }
  return sum
}

/** Waterway lines of an Overpass response: tunnels left out, simplified, the widest then the longest kept up to `MAX_LINE_LENGTH_M`. */
export function parseWaterLines(elements: readonly WaterElement[]): WaterLine[] {
  const lines: (WaterLine & { length: number })[] = []
  for (const e of elements) {
    const tags = e.tags ?? {}
    if (e.type !== 'way' || !Object.hasOwn(LINE_WIDTH_M, tags.waterway ?? '') || (tags.tunnel && tags.tunnel !== 'no')) continue
    const points = simplifyLine(toRing(e.geometry), WATER_SIMPLIFY_M).map((p): [number, number] => [round6(p.lon), round6(p.lat)])
    const length = lengthM(points)
    if (points.length < 2 || length < MIN_LINE_LENGTH_M) continue
    const line: WaterLine = { id: `way/${e.id}`, kind: tags.waterway as WaterLine['kind'], points }
    const width = taggedWidthM(tags.width)
    if (width !== undefined) line.width = width
    lines.push({ ...line, length })
  }
  lines.sort((a, b) => lineWidthM(b) - lineWidthM(a) || b.length - a.length)
  const kept: WaterLine[] = []
  let total = 0
  for (const { length, ...line } of lines) {
    if (total + length > MAX_LINE_LENGTH_M) continue
    total += length
    kept.push(line)
  }
  return kept
}

/** Sea polygons of the corridor `boxes` and waterway lines of an Overpass response; throws on a server-side error. */
export function parseWaterShapes(json: unknown, boxes: readonly LonLatBounds[]): WaterShape[] {
  const elements = overpassElements(json) as WaterElement[]
  const ways = elements
    .filter((e) => e.type === 'way' && e.tags?.natural === 'coastline')
    .map((e) => toRing(e.geometry).map((p): [number, number] => [p.lon, p.lat]))
    .filter((w) => w.length >= 2)
  return [...seaPolygons(reduceCoast(chainCoastWays(ways)), boxes), ...parseWaterLines(elements)]
}

/** The sea and the waterway lines around `track`, from the caches or one queued Overpass query. */
export function fetchTrackWaterShapes(track: Track, signal?: AbortSignal, deps?: OverpassDeps): Promise<WaterShape[]> {
  const boxes = corridorBoxes(track, WATER_MARGIN_M)
  return cachedOverpassQuery(waterLinesQuery(track), (json) => parseWaterShapes(json, boxes), signal, deps)
}

/**
 * The runs of `line` outside every polygon: a river mapped as a line inside its riverbank polygon (or in a lake, or
 * the sea) is drawn by the polygon. A run keeps the first point inside, so the ribbon reaches the polygon.
 */
export function runsOutside(line: WaterLine, polygons: readonly WaterPolygon[]): WaterLine[] {
  const rings = polygons.map((p) => ({
    outer: p.outer.map(([lon, lat]) => ({ lon, lat })),
    holes: p.holes.map((h) => h.map(([lon, lat]) => ({ lon, lat }))),
  }))
  const boxes = rings.map(({ outer }) => ({
    west: Math.min(...outer.map((q) => q.lon)),
    south: Math.min(...outer.map((q) => q.lat)),
    east: Math.max(...outer.map((q) => q.lon)),
    north: Math.max(...outer.map((q) => q.lat)),
  }))
  const covered = line.points.map(([lon, lat]) => {
    const p = { lon, lat }
    return rings.some(
      (ring, i) =>
        lon >= boxes[i].west &&
        lon <= boxes[i].east &&
        lat >= boxes[i].south &&
        lat <= boxes[i].north &&
        pointInRing(p, ring.outer) &&
        !ring.holes.some((h) => pointInRing(p, h)),
    )
  })
  if (!covered.some(Boolean)) return [line]
  const runs: WaterLine[] = []
  let start = -1
  for (let i = 0; i <= line.points.length; i++) {
    if (i < line.points.length && !covered[i]) {
      if (start < 0) start = Math.max(0, i - 1)
      continue
    }
    if (start >= 0) {
      const points = line.points.slice(start, i + 1)
      if (points.length >= 2) runs.push({ ...line, id: `${line.id}#${runs.length}`, points })
      start = -1
    }
  }
  return runs
}
