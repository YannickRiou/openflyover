/**
 * Triangle mesh of a water polygon (osm/water.ts) that can be draped on the relief: the polygon is cut by a grid of
 * square cells (Sutherland–Hodgman, each ring against each cell), every piece triangulated with its holes (earcut of
 * three's ShapeUtils). The grid adds vertices inside the water every `cellM`, so a river follows its valley and the
 * opacity can fade from the shore (`fade`: 0 on the shore, 1 at `fadeM` and beyond).
 *
 * Pure (three is used for its triangulation only).
 */
import { ShapeUtils, Vector2 } from 'three'
import type { WaterPolygon } from '../osm/water'

export interface WaterMesh {
  /** lon, lat of each vertex (degrees) */
  lonLat: Float64Array
  /** opacity factor of each vertex from its distance to the shore, [0, 1] */
  fade: Float32Array
  /** three vertex indices per triangle */
  index: Uint32Array
}

export interface WaterMeshOptions {
  /** smallest cell size (metres) */
  cellM: number
  /** at most this many cells along the longer side of the bounding box (larger cells for a large lake) */
  maxCells: number
  /** width of the fade at the shore (metres) */
  fadeM: number
}

export const DEFAULT_WATER_MESH: WaterMeshOptions = { cellM: 60, maxCells: 40, fadeM: 40 }

const M_PER_DEG = 111_320

type Pt = [number, number]

/** Clip a ring to the axis-aligned rectangle [x0, x1] × [y0, y1] (Sutherland–Hodgman). */
export function clipRing(ring: readonly Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  let out: Pt[] = ring.slice()
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ]
  for (const [inside, cross] of edges) {
    if (out.length === 0) break
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const a = input[(i + input.length - 1) % input.length]
      const b = input[i]
      if (inside(b)) {
        if (!inside(a)) out.push(cross(a, b))
        out.push(b)
      } else if (inside(a)) out.push(cross(a, b))
    }
  }
  return out
}

function signedArea(ring: readonly Pt[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return sum / 2
}

function bounds(ring: readonly Pt[]): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of ring) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/** Distance from p to segment ab. */
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const bx = b[0] - a[0]
  const by = b[1] - a[1]
  const len2 = bx * bx + by * by
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * bx + (p[1] - a[1]) * by) / len2)) : 0
  return Math.hypot(p[0] - a[0] - t * bx, p[1] - a[1] - t * by)
}

/** Mesh of `polygon` (local metres around its bounding box centre, then back to lon / lat). */
export function buildWaterMesh(polygon: WaterPolygon, options: WaterMeshOptions = DEFAULT_WATER_MESH): WaterMesh {
  const [w, s, e, n] = bounds(polygon.outer)
  const lon0 = (w + e) / 2
  const lat0 = (s + n) / 2
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG
  const project = (ring: readonly [number, number][]): Pt[] => ring.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG])
  const outer = project(polygon.outer)
  const holes = polygon.holes.map(project)
  const holeBounds = holes.map(bounds)
  const [bx0, by0, bx1, by1] = bounds(outer)
  const cell = Math.max(options.cellM, Math.max(bx1 - bx0, by1 - by0) / options.maxCells)

  const xy: number[] = []
  const index: number[] = []
  for (let cy = by0; cy < by1; cy += cell) {
    for (let cx = bx0; cx < bx1; cx += cell) {
      const x1 = Math.min(cx + cell, bx1)
      const y1 = Math.min(cy + cell, by1)
      const piece = clipRing(outer, cx, cy, x1, y1)
      if (piece.length < 3 || Math.abs(signedArea(piece)) < 1e-6) continue
      const cuts: Pt[][] = []
      holes.forEach((hole, i) => {
        const [hx0, hy0, hx1, hy1] = holeBounds[i]
        if (hx1 < cx || hx0 > x1 || hy1 < cy || hy0 > y1) return
        const cut = clipRing(hole, cx, cy, x1, y1)
        if (cut.length >= 3 && Math.abs(signedArea(cut)) > 1e-6) cuts.push(cut)
      })
      const contour = piece.map(([x, y]) => new Vector2(x, y))
      const holeVectors = cuts.map((cut) => cut.map(([x, y]) => new Vector2(x, y)))
      const base = xy.length / 2
      for (const v of [contour, ...holeVectors].flat()) xy.push(v.x, v.y)
      for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holeVectors)) index.push(base + a, base + b, base + c)
    }
  }

  // distance to the nearest shore edge, only up to fadeM (edges farther than that by their box are skipped)
  const rings = [outer, ...holes]
  const count = xy.length / 2
  const fade = new Float32Array(count)
  const lonLat = new Float64Array(count * 2)
  for (let v = 0; v < count; v++) {
    const p: Pt = [xy[2 * v], xy[2 * v + 1]]
    let d = options.fadeM
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j]
        const b = ring[i]
        if (Math.min(a[0], b[0]) - d > p[0] || Math.max(a[0], b[0]) + d < p[0]) continue
        if (Math.min(a[1], b[1]) - d > p[1] || Math.max(a[1], b[1]) + d < p[1]) continue
        d = Math.min(d, segmentDistance(p, a, b))
      }
    }
    fade[v] = options.fadeM > 0 ? d / options.fadeM : 1
    lonLat[2 * v] = lon0 + p[0] / kx
    lonLat[2 * v + 1] = lat0 + p[1] / M_PER_DEG
  }
  return { lonLat, fade, index: Uint32Array.from(index) }
}

/**
 * Mesh of a sea polygon (osm/coast.ts): the polygon triangulated as it is, with its holes (islands). The sea is flat, so
 * it needs no grid, and it fades at no shore: where the relief rises above the plane the land hides the water.
 */
export function buildSeaMesh(polygon: WaterPolygon): WaterMesh {
  const [w, s, e, n] = bounds(polygon.outer)
  const lon0 = (w + e) / 2
  const lat0 = (s + n) / 2
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG
  const project = (ring: readonly Pt[]) => ring.map(([lon, lat]) => new Vector2((lon - lon0) * kx, (lat - lat0) * M_PER_DEG))
  const contour = project(polygon.outer)
  const holes = polygon.holes.map(project)
  const vertices = [contour, ...holes].flat()
  const lonLat = new Float64Array(vertices.length * 2)
  vertices.forEach((v, i) => {
    lonLat[2 * i] = lon0 + v.x / kx
    lonLat[2 * i + 1] = lat0 + v.y / M_PER_DEG
  })
  return { lonLat, fade: new Float32Array(vertices.length).fill(1), index: Uint32Array.from(ShapeUtils.triangulateShape(contour, holes).flat()) }
}

/** Share of `fade` from which a vertex counts as inside the water, away from the shore (an OSM shore is a few metres off the DEM's). */
const INNER_FADE = 0.5
/** Percentile of the heights inside a lake taken as its level: high, so that the relief of a lake does not poke through. */
const LAKE_INNER_PERCENTILE = 0.9
/** Percentile when too few vertices are inside (a thin lake): all the vertices, as the median. */
const LAKE_ALL_PERCENTILE = 0.5
/** Fewest inner vertices for the inner percentile. */
const MIN_INNER_VERTICES = 4

function percentile(values: number[], p: number): number {
  values.sort((a, b) => a - b)
  return values[Math.floor((values.length - 1) * p)]
}

/**
 * Level of a lake (flat surface) from the heights of its vertices (NaN where the relief is not loaded yet; NaN when none is
 * known). The water must lie over the relief of the lake: a DEM is not flat on a lake (noise, tile seams) and a coarse
 * level of detail rises towards the banks, so the level is a high percentile of the heights inside the lake, not of the
 * shore (which a steep bank lifts) nor a low one (under which the relief shows through as dark patches).
 */
export function lakeLevel(heights: ArrayLike<number>, fade: ArrayLike<number>): number {
  const inner: number[] = []
  const all: number[] = []
  for (let v = 0; v < heights.length; v++) {
    if (Number.isNaN(heights[v])) continue
    all.push(heights[v])
    if (fade[v] >= INNER_FADE) inner.push(heights[v])
  }
  if (all.length === 0) return Number.NaN
  return inner.length >= MIN_INNER_VERTICES ? percentile(inner, LAKE_INNER_PERCENTILE) : percentile(all, LAKE_ALL_PERCENTILE)
}

