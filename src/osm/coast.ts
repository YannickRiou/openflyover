/**
 * The sea from the coastline of OpenStreetMap. `natural=coastline` is a line, not a polygon: by convention the land is
 * on the LEFT of the way's direction and the water on its right. Pure (no network, no three.js).
 *
 * The corridor is cut into rectangular cells (`seaCells`, no two overlapping: translucent water drawn twice would show).
 * In each cell the coast is clipped to the rectangle; every piece enters and leaves through the edge of the cell, and
 * the sea is closed along that edge turning clockwise (water on the right all the way round). A cell crossed by no
 * coastline is all sea or all land: an island ring inside it makes it sea, otherwise the side of the nearest coastline
 * decides (`seaSide`). When the pieces of a coast that crosses the cell do not close (data cut off, crossing ways) the cell
 * falls back to a flat rectangle: the sea is drawn at sea level (0 m, raised by `SEA_LIFT_M` in WaterLayer), so it hides
 * under any land above it. A cell that fails with no coast crossing it is left out.
 */
import type { LonLat, LonLatBounds } from '../core/types'
import { simplifyLine } from './overpass'
import type { WaterPolygon } from './water'

type Pt = [number, number]
type Rect = [number, number, number, number]

/** Tolerance of the coast simplification (metres), raised until the corridor holds at most `MAX_COAST_POINTS`. */
export const COAST_SIMPLIFY_M = 8
/** Most coast vertices kept in the corridor: it is cached with the sea polygons (about 20 bytes each). */
export const MAX_COAST_POINTS = 20_000

const round6 = (v: number) => Math.round(v * 1e6) / 1e6
const key = (p: Pt) => `${p[0]},${p[1]}`
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1]

/** Signed area of a ring in the lon / lat plane (> 0: counter-clockwise, an island; < 0: clockwise, water inside). */
function signedArea(ring: readonly Pt[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return sum / 2
}

function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

/** Coast ways joined end to end, in their own direction only (the direction is the meaning): a way is followed by the one that starts where it ends. */
export function chainCoastWays(ways: readonly Pt[][]): Pt[][] {
  const byStart = new Map<string, number>()
  ways.forEach((w, i) => byStart.set(key(w[0]), i))
  const hasPredecessor = new Set<number>()
  ways.forEach((w, i) => {
    const next = byStart.get(key(w[w.length - 1]))
    if (next !== undefined && next !== i) hasPredecessor.add(next)
  })
  const used = new Set<number>()
  const chains: Pt[][] = []
  const follow = (first: number) => {
    const chain = ways[first].slice()
    used.add(first)
    for (;;) {
      const next = byStart.get(key(chain[chain.length - 1]))
      if (next === undefined || used.has(next)) break
      used.add(next)
      chain.push(...ways[next].slice(1))
    }
    chains.push(chain)
  }
  ways.forEach((_, i) => !hasPredecessor.has(i) && !used.has(i) && follow(i))
  // what is left are loops of several ways
  ways.forEach((_, i) => !used.has(i) && follow(i))
  return chains
}

/**
 * The parts of `chains` that touch the rectangles `boxes` (a segment is kept when it crosses one, whatever its ends): far
 * parts of a long way are neither counted nor simplified. A chain is cut where it leaves the boxes, so the pieces end
 * outside every cell; a closed ring is opened at such a gap first.
 */
export function clipChainsToBoxes(chains: readonly Pt[][], boxes: readonly LonLatBounds[]): Pt[][] {
  const rects = boxes.map((b): Rect => [b.west, b.south, b.east, b.north])
  const out: Pt[][] = []
  for (const chain of chains) {
    const n = chain.length - 1
    const kept = Array.from({ length: n }, (_, i) => rects.some((r) => clipSegment(chain[i], chain[i + 1], r) !== null))
    const closed = same(chain[0], chain[n])
    const gap = kept.indexOf(false)
    if (gap < 0 && closed) {
      out.push(chain)
      continue
    }
    // a closed ring starts just after a gap, so no piece wraps around its first point
    const first = closed ? gap + 1 : 0
    let piece: Pt[] = []
    for (let t = 0; t < n; t++) {
      const i = (first + t) % n
      if (kept[i]) {
        if (piece.length === 0) piece.push(chain[i])
        piece.push(chain[i + 1])
      } else if (piece.length > 0) {
        out.push(piece)
        piece = []
      }
    }
    if (piece.length > 0) out.push(piece)
  }
  return out
}

/** The chains simplified at `COAST_SIMPLIFY_M`, then coarser until they hold at most `maxPoints` points. */
export function reduceCoast(chains: readonly Pt[][], maxPoints = MAX_COAST_POINTS): Pt[][] {
  let tolerance = COAST_SIMPLIFY_M
  for (;;) {
    const reduced = chains.map((c) => simplifyLine(c.map(([lon, lat]): LonLat => ({ lon, lat })), tolerance).map((p): Pt => [p.lon, p.lat]))
    if (reduced.reduce((n, c) => n + c.length, 0) <= maxPoints || tolerance > 1000) return reduced.filter((c) => c.length >= 2)
    tolerance *= 2
  }
}

/** Rectangles covering the boxes without overlap (the boxes of a corridor overlap at their margins), rounded to 1e-6°. */
export function seaCells(boxes: readonly LonLatBounds[]): Rect[] {
  const rounded = boxes.map((b) => ({ west: round6(b.west), south: round6(b.south), east: round6(b.east), north: round6(b.north) }))
  const xs = [...new Set(rounded.flatMap((b) => [b.west, b.east]))].sort((a, b) => a - b)
  const ys = [...new Set(rounded.flatMap((b) => [b.south, b.north]))].sort((a, b) => a - b)
  const cells: Rect[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cy = (ys[j] + ys[j + 1]) / 2
      if (rounded.some((b) => cx > b.west && cx < b.east && cy > b.south && cy < b.north)) cells.push([xs[i], ys[j], xs[i + 1], ys[j + 1]])
    }
  }
  return cells
}

/** Part [t0, t1] of segment ab inside the rectangle (Liang–Barsky), null when it misses it. */
function clipSegment(a: Pt, b: Pt, [x0, y0, x1, y1]: Rect): [number, number] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dy, a[1] - y0],
    [dy, y1 - a[1]],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return null
        t0 = Math.max(t0, r)
      } else {
        if (r < t0) return null
        t1 = Math.min(t1, r)
      }
    }
  }
  return [t0, t1]
}

const inside = (p: Pt, [x0, y0, x1, y1]: Rect) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1
const onBoundary = (p: Pt, [x0, y0, x1, y1]: Rect) => p[0] === x0 || p[0] === x1 || p[1] === y0 || p[1] === y1

/** Clockwise distance along the edge of the rectangle from its south-west corner (west edge up, north edge east, east edge down, south edge west). */
function perimeter(p: Pt, [x0, y0, x1, y1]: Rect): number {
  const w = x1 - x0
  const h = y1 - y0
  const d = [Math.abs(p[0] - x0), Math.abs(p[1] - y1), Math.abs(p[0] - x1), Math.abs(p[1] - y0)]
  const nearest = d.indexOf(Math.min(...d))
  const s = [p[1] - y0, h + (p[0] - x0), h + w + (y1 - p[1]), 2 * h + w + (x1 - p[0])][nearest]
  return s % (2 * (w + h))
}

interface Run {
  pts: Pt[]
  sIn: number
  sOut: number
}

/** The coast inside `cell`: pieces from edge to edge (`runs`) and rings entirely inside it; throws when a piece does not end on the edge. */
function clipCoast(chains: readonly Pt[][], cell: Rect): { runs: Run[]; rings: Pt[][] } {
  const runs: Run[] = []
  const rings: Pt[][] = []
  for (const original of chains) {
    let chain = original
    if (same(chain[0], chain[chain.length - 1])) {
      const start = chain.findIndex((p) => !inside(p, cell))
      if (start < 0) {
        rings.push(chain.slice(0, -1))
        continue
      }
      chain = chain.slice(start, -1).concat(chain.slice(0, start + 1))
    }
    let current: Pt[] | null = null
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]
      const b = chain[i + 1]
      const span = clipSegment(a, b, cell)
      if (!span) {
        if (current) throw new Error('coast piece left the cell inside it')
        continue
      }
      const [t0, t1] = span
      const at = (t: number): Pt => (t === 0 ? a : t === 1 ? b : [round6(a[0] + (b[0] - a[0]) * t), round6(a[1] + (b[1] - a[1]) * t)])
      if (!current) {
        if (t0 === 0 && !onBoundary(a, cell)) throw new Error('coast piece starts inside the cell')
        current = [at(t0)]
      }
      current.push(at(t1))
      // the piece leaves the cell, or ends on its edge
      if (t1 < 1 || onBoundary(b, cell)) {
        if (current.length >= 2 && !same(current[0], current[current.length - 1])) {
          runs.push({ pts: current, sIn: perimeter(current[0], cell), sOut: perimeter(current[current.length - 1], cell) })
        }
        current = null
      }
    }
    if (current) throw new Error('coast piece ends inside the cell')
  }
  return { runs, rings }
}

/** Sea rings of a cell from the coast pieces, water on the right: every exit continues along the edge, clockwise, to the next entry. */
function walkRings(runs: readonly Run[], cell: Rect): Pt[][] {
  const [x0, y0, x1, y1] = cell
  const total = 2 * (x1 - x0 + (y1 - y0))
  const corners: [number, Pt][] = [
    [0, [x0, y0]],
    [y1 - y0, [x0, y1]],
    [y1 - y0 + (x1 - x0), [x1, y1]],
    [2 * (y1 - y0) + (x1 - x0), [x1, y0]],
  ]
  const after = (from: number, to: number) => (((to - from) % total) + total) % total
  const visited = new Set<number>()
  const rings: Pt[][] = []
  runs.forEach((_, first) => {
    if (visited.has(first)) return
    const ring: Pt[] = []
    let k = first
    do {
      visited.add(k)
      ring.push(...runs[k].pts)
      let next = -1
      let gap = Infinity
      runs.forEach((r, j) => {
        const g = after(runs[k].sOut, r.sIn)
        if (g < gap) {
          gap = g
          next = j
        }
      })
      for (const [s, p] of corners.map(([s, p]): [number, Pt] => [after(runs[k].sOut, s), p]).sort((a, b) => a[0] - b[0])) {
        if (s > 0 && s < gap) ring.push(p)
      }
      if (next !== first && visited.has(next)) throw new Error('coast pieces do not close')
      k = next
    } while (k !== first)
    rings.push(ring.filter((p, i) => i === 0 || !same(p, ring[i - 1])))
  })
  return rings
}

/** Which side of the nearest coast `p` lies on: 'sea' (right of the way), 'land' (left), null when it cannot be told. */
export function seaSide(chains: readonly Pt[][], p: Pt): 'sea' | 'land' | null {
  const k = Math.cos((p[1] * Math.PI) / 180)
  let best = Infinity
  let side: 'sea' | 'land' | null = null
  for (const chain of chains) {
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]
      const b = chain[i + 1]
      const bx = (b[0] - a[0]) * k
      const by = b[1] - a[1]
      const len = Math.hypot(bx, by)
      if (len === 0) continue
      const px = (p[0] - a[0]) * k
      const py = p[1] - a[1]
      const t = Math.min(1, Math.max(0, (px * bx + py * by) / (len * len)))
      const d = Math.hypot(px - t * bx, py - t * by)
      if (d >= best) continue
      best = d
      // inside a segment its own side; at a vertex the sum of the normals of the two segments that meet there
      let nx = -by / len
      let ny = bx / len
      const other = t === 0 ? chain[i - 1] : t === 1 ? chain[i + 2] : undefined
      if (other) {
        const ox = t === 0 ? (a[0] - other[0]) * k : (other[0] - b[0]) * k
        const oy = t === 0 ? a[1] - other[1] : other[1] - b[1]
        const ol = Math.hypot(ox, oy)
        if (ol > 0) {
          nx += -oy / ol
          ny += ox / ol
        }
      }
      const vx = px - t * bx
      const vy = py - t * by
      const dot = vx * nx + vy * ny
      side = dot === 0 ? null : dot > 0 ? 'land' : 'sea'
    }
  }
  return side
}

const rectRing = ([x0, y0, x1, y1]: Rect): Pt[] => [
  [x0, y0],
  [x0, y1],
  [x1, y1],
  [x1, y0],
]

function seaInCell(chains: readonly Pt[][], cell: Rect, id: string): WaterPolygon[] {
  const near = chains.filter((c) => {
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let n = -Infinity
    for (const [x, y] of c) {
      w = Math.min(w, x)
      e = Math.max(e, x)
      s = Math.min(s, y)
      n = Math.max(n, y)
    }
    return e >= cell[0] && w <= cell[2] && n >= cell[1] && s <= cell[3]
  })
  const { runs, rings } = clipCoast(near, cell)
  const outers: Pt[][] = walkRings(runs, cell)
  const islands = rings.filter((r) => signedArea(r) > 0)
  const lagoons = rings.filter((r) => signedArea(r) < 0)
  if (runs.length === 0) {
    const centre: Pt = [(cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2]
    // all sea (an island stands in the open sea, or the nearest coast has the cell on its right), all land, or only lagoons
    const standsInSea = islands.some((island) => !lagoons.some((lagoon) => inRing(island[0], lagoon)))
    if (standsInSea || (islands.length === 0 && lagoons.length === 0 && seaSide(chains, centre) === 'sea')) outers.push(rectRing(cell))
  }
  outers.push(...lagoons)
  const area = outers.map((o) => Math.abs(signedArea(o)))
  const holes = outers.map((): Pt[][] => [])
  for (const island of islands) {
    let owner = -1
    outers.forEach((o, i) => {
      if (inRing(island[0], o) && (owner < 0 || area[i] < area[owner])) owner = i
    })
    if (owner >= 0) holes[owner].push(island)
  }
  const round = (ring: Pt[]): Pt[] => {
    const rounded = ring.map(([lon, lat]): Pt => [round6(lon), round6(lat)])
    return rounded.length > 1 && same(rounded[0], rounded[rounded.length - 1]) ? rounded.slice(0, -1) : rounded
  }
  return outers.map((outer, i) => ({
    id: outers.length > 1 ? `${id}#${i}` : id,
    kind: 'sea',
    outer: round(outer),
    holes: holes[i].map(round),
  }))
}

/**
 * Sea polygons of the corridor `boxes` from the coast `chains` (see `chainCoastWays`). Nothing without a coast: the sea is
 * never drawn far from one. A cell crossed by a coast whose pieces do not close is a flat rectangle (the sea plane is at 0 m);
 * any other cell that fails is left out.
 */
export function seaPolygons(chains: readonly Pt[][], boxes: readonly LonLatBounds[]): WaterPolygon[] {
  if (chains.length === 0) return []
  return seaCells(boxes).flatMap((cell, i) => {
    try {
      return seaInCell(chains, cell, `sea/${i}`)
    } catch {
      const crossed = chains.some((chain) =>
        chain.some((p, k) => {
          const span = k > 0 ? clipSegment(chain[k - 1], p, cell) : null
          return span !== null && span[1] > span[0]
        }),
      )
      return crossed ? [{ id: `sea/${i}`, kind: 'sea' as const, outer: rectRing(cell), holes: [] }] : []
    }
  })
}
