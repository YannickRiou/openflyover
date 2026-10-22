/**
 * Where the trees stand (pure, deterministic): the same forests, density, budget and track always give the same trees,
 * so the export draws what the preview shows.
 *
 * The forests (osm/forest.ts) are cut into square chunks of CHUNK_M. In each chunk, trees stand on a jittered grid whose
 * spacing follows the density (every grid cell's tree comes from a hash of its place, not from a random generator), kept
 * only inside a forest and outside its holes. The density thins out with the distance of the chunk to the track
 * (the flyover sees the near forests closely, the far ones as a texture). Beyond `maxTrees` (core/deviceBudget.ts) the
 * far chunks are thinned, not dropped (`thinning`): the density keeps its full value near the track and falls with the
 * distance to the nearest track, just enough for the total to fit the budget.
 */
import type { LonLat } from '../core/types'
import type { ForestPolygon } from '../osm/forest'
import { M_PER_DEG, segmentDistanceM } from '../osm/overpass'
import { clipRing } from './waterMesh'

/** Side of a chunk (metres): the unit of the distance culling, one draw call per kind of tree. */
export const CHUNK_M = 1500
/** Full density up to this distance from the track (metres)... */
export const NEAR_TRACK_M = 2000
/** ...then falling linearly to `FAR_DENSITY_RATIO` of it at this distance. */
export const FAR_TRACK_M = 5000
export const FAR_DENSITY_RATIO = 0.4
/** Height of a tree (metres). */
export const TREE_HEIGHT_M = { min: 8, max: 22 } as const
/** Without a `leaf_type`, a forest above this altitude is made of conifers (metres). */
export const CONIFER_ALTITUDE_M = 1200

export const CONIFER = 0
export const BROADLEAF = 1
/** Decided where the tree stands: a conifer above `CONIFER_ALTITUDE_M`, else a broadleaf (`treeKind`). */
export const BY_ALTITUDE = 2

export type TreeKind = 'conifer' | 'broadleaf'

/** The kind of a placed tree (`CONIFER`, `BROADLEAF` or `BY_ALTITUDE`) at `altitudeM`. */
export function treeKind(kind: number, altitudeM: number): TreeKind {
  if (kind === CONIFER) return 'conifer'
  if (kind === BROADLEAF) return 'broadleaf'
  return altitudeM > CONIFER_ALTITUDE_M ? 'conifer' : 'broadleaf'
}

/** Share of the density kept at `distanceM` from the track, 1 (near) to FAR_DENSITY_RATIO (far). */
export function densityFactor(distanceM: number): number {
  const t = Math.min(1, Math.max(0, (distanceM - NEAR_TRACK_M) / (FAR_TRACK_M - NEAR_TRACK_M)))
  return 1 - t * (1 - FAR_DENSITY_RATIO)
}

export interface PlacementOptions {
  /** trees per hectare where the forest is closest to the track */
  density: number
  /** most trees placed in all */
  maxTrees: number
  /** the tracks of the film (simplified is enough); a forest is as near as its nearest track */
  paths: readonly (readonly LonLat[])[]
}

/** Smallest share of its density a chunk keeps while the budget is met by thinning (the far chunks stay present). */
export const MIN_THINNING = 0.05
/** The placement aims at this share of the budget: the count of the lattice only matches the area estimate roughly. */
const BUDGET_MARGIN = 0.97
/** Placements tried to land close under the budget (the area estimate is refined by the real count each time). */
const MAX_ATTEMPTS = 4
/** A placement using at least this share of the budget is good enough. */
const GOOD_FILL = 0.9

/** Steepest fall of `thinning` (exponent): the nearest chunk whole, the others near MIN_THINNING. */
const MAX_THINNING_EXPONENT = 40

/**
 * Share of its density each chunk keeps so that its expected trees (`expected`, at the density of its distance) fit
 * `target`: 1 everywhere when they already fit, else `MIN + (1 − MIN) × (1 − u) ^ k` where `u` runs from 0 (the nearest
 * chunk) to 1 (the farthest), MIN is MIN_THINNING and `k` the gentlest exponent that fits: the near chunks stay full
 * and the far ones fall towards MIN, never to zero. Below even the steepest fall every chunk is scaled alike (still above
 * zero). Pure, monotone with the distance, independent of the order of the chunks.
 */
export function thinning(distance: readonly number[], expected: readonly number[], target: number): number[] {
  const sum = (m: readonly number[]) => m.reduce((n, share, i) => n + share * expected[i], 0)
  const full = distance.map(() => 1)
  if (sum(full) <= target) return full
  const near = Math.min(...distance)
  const span = Math.max(...distance) - near
  const shares = (k: number) => distance.map((d) => MIN_THINNING + (1 - MIN_THINNING) * (span > 0 ? (1 - (d - near) / span) ** k : 1))
  const steepest = shares(MAX_THINNING_EXPONENT)
  if (sum(steepest) > target) return steepest.map((m) => (m * target) / sum(steepest))
  let lo = 0
  let hi = MAX_THINNING_EXPONENT
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (sum(shares(mid)) <= target) hi = mid
    else lo = mid
  }
  return shares(hi)
}

/** The trees of one square of the ground. Arrays are parallel, `count` long. */
export interface ForestChunk {
  /** "cx,cy" */
  key: string
  centre: LonLat
  /** radius of the chunk's ground (metres), for the culling */
  radiusM: number
  count: number
  /** lon, lat of each tree (two numbers each) */
  lonLat: Float64Array
  /** metres */
  height: Float32Array
  /** CONIFER, BROADLEAF or BY_ALTITUDE */
  kind: Uint8Array
  /** [0, 1): slight variation of the colour */
  variation: Float32Array
  /** radians */
  yaw: Float32Array
}

/** A number in [0, 1) from three integers (integer hash, no state). */
export function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}


/** Distance (metres) from `p` to the polyline `path`. */
export function distanceToPath(p: LonLat, path: readonly LonLat[]): number {
  if (path.length === 0) return 0
  if (path.length === 1) return segmentDistanceM(p, path[0], path[0])
  let best = Infinity
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentDistanceM(p, path[i - 1], path[i]))
  return best
}

/** Segments per block of a `PathIndex`. */
const BLOCK_SEGMENTS = 32

/** The tracks cut into blocks of a few segments, each with its bounding box: a point only measures the blocks that can beat the best distance so far. */
export interface PathIndex {
  blocks: { west: number; south: number; east: number; north: number; cosMin: number; points: readonly LonLat[] }[]
}

export function indexPaths(paths: readonly (readonly LonLat[])[]): PathIndex {
  const blocks: PathIndex['blocks'] = []
  for (const path of paths) {
    for (let from = 0; from === 0 || from < path.length - 1; from += BLOCK_SEGMENTS) {
      const points = path.slice(from, from + BLOCK_SEGMENTS + 1)
      if (points.length === 0) break
      const lons = points.map((q) => q.lon)
      const lats = points.map((q) => q.lat)
      const south = Math.min(...lats)
      const north = Math.max(...lats)
      blocks.push({ west: Math.min(...lons), south, east: Math.max(...lons), north, cosMin: Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180), points })
    }
  }
  return { blocks }
}

/** Distance (metres) from `p` to the nearest track of `index` (0 without a track): the same as the smallest `distanceToPath`, without measuring every segment. */
export function distanceToIndex(p: LonLat, { blocks }: PathIndex): number {
  if (blocks.length === 0) return 0
  // lower bound of the distance to a block: to its box, in the metric of the segment measure (cos of the latitude of the segment, at least cosMin)
  const bound = blocks.map((b) => {
    const dx = Math.max(b.west - p.lon, 0, p.lon - b.east) * b.cosMin
    const dy = Math.max(b.south - p.lat, 0, p.lat - b.north)
    return Math.hypot(dx, dy) * M_PER_DEG
  })
  const order = bound.map((_, i) => i).sort((i, j) => bound[i] - bound[j])
  let best = Infinity
  for (const i of order) {
    if (bound[i] >= best) break
    best = Math.min(best, distanceToPath(p, blocks[i].points))
  }
  return best
}

/** Distance (metres) from `p` to the nearest of the tracks `paths`. */
export function distanceToPaths(p: LonLat, paths: readonly (readonly LonLat[])[]): number {
  return distanceToIndex(p, indexPaths(paths))
}

type Pt = [number, number]

/** A forest in metres (the fixed frame of `placeTrees`). */
interface Prepared {
  polygon: ForestPolygon
  outer: Pt[]
  holes: Pt[][]
  /** bounding box */
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Area of a ring in metres (shoelace). */
function areaM2(ring: readonly Pt[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return Math.abs(sum) / 2
}

/** A forest cut to one chunk: short rings, so the point-in-polygon tests of its many candidate trees stay cheap. */
interface Clipped {
  polygon: ForestPolygon
  outer: Pt[]
  holes: Pt[][]
}

/** Even-odd point in ring test, metres. */
function inRing(x: number, y: number, ring: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

const inForest = (x: number, y: number, f: Clipped) => inRing(x, y, f.outer) && !f.holes.some((hole) => inRing(x, y, hole))

const KIND_OF_LEAF = { needleleaved: CONIFER, broadleaved: BROADLEAF } as const

/** Trees of a chunk, as growing parallel arrays. */
interface Trees {
  x: number[]
  y: number[]
  height: number[]
  kind: number[]
  variation: number[]
  yaw: number[]
}

/** A chunk that meets a forest: where it is, how far from the tracks, what it holds. */
interface Cell {
  key: string
  cx: number
  cy: number
  centre: LonLat
  /** metres to the nearest track */
  distance: number
  forests: Clipped[]
  /** trees expected at the full density of the chunk (`densityFactor` applied), from the area of its forests */
  expected: number
}

/** Place the trees of the forests (see the module comment). */
export function placeTrees(polygons: readonly ForestPolygon[], { density, maxTrees, paths }: PlacementOptions): ForestChunk[] {
  if (polygons.length === 0 || density <= 0 || maxTrees <= 0) return []
  // equirectangular metres at the latitude of the middle of the tracks (else of the first forest) rounded to 0.01°: one fixed
  // frame for the run, the same whatever the order of the tracks, and a small change of the tracks does not move the trees
  let south = Infinity
  let north = -Infinity
  for (const path of paths) {
    for (const q of path) {
      south = Math.min(south, q.lat)
      north = Math.max(north, q.lat)
    }
  }
  const originLat = south <= north ? Math.round(((south + north) / 2) * 100) / 100 : polygons[0].outer[0][1]
  const pathIndex = indexPaths(paths)
  const kx = M_PER_DEG * Math.cos((originLat * Math.PI) / 180)
  const ky = M_PER_DEG
  const toMetres = (ring: [number, number][]): Pt[] => ring.map(([lon, lat]) => [lon * kx, lat * ky])

  // by id: the trees do not depend on the order the forests come in
  const prepared: Prepared[] = [...polygons]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((polygon) => {
      const outer = toMetres(polygon.outer)
      const xs = outer.map((p) => p[0])
      const ys = outer.map((p) => p[1])
      return { polygon, outer, holes: polygon.holes.map(toMetres), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
    })

  // the chunks that meet a forest (bounding box), with the forests that meet them
  const chunks = new Map<string, { cx: number; cy: number; forests: Prepared[] }>()
  for (const forest of prepared) {
    for (let cx = Math.floor(forest.x0 / CHUNK_M); cx <= Math.floor(forest.x1 / CHUNK_M); cx++) {
      for (let cy = Math.floor(forest.y0 / CHUNK_M); cy <= Math.floor(forest.y1 / CHUNK_M); cy++) {
        const key = `${cx},${cy}`
        const chunk = chunks.get(key) ?? { cx, cy, forests: [] }
        chunk.forests.push(forest)
        chunks.set(key, chunk)
      }
    }
  }

  // nearest to the track first; the key breaks ties so the order never depends on the input order
  const cells: Cell[] = []
  for (const [key, { cx, cy, forests }] of chunks) {
    const clipped = clipToChunk(forests, cx * CHUNK_M, cy * CHUNK_M, (cx + 1) * CHUNK_M, (cy + 1) * CHUNK_M)
    const area = clipped.reduce((n, f) => n + areaM2(f.outer) - f.holes.reduce((h, hole) => h + areaM2(hole), 0), 0)
    if (area <= 0) continue
    const centre = { lon: ((cx + 0.5) * CHUNK_M) / kx, lat: ((cy + 0.5) * CHUNK_M) / ky }
    const distance = distanceToIndex(centre, pathIndex)
    cells.push({ key, cx, cy, centre, distance, forests: clipped, expected: (area * density * densityFactor(distance)) / 10_000 })
  }
  cells.sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : 1))

  // Thinned, not cut: aim a little under the budget, place, and correct the aim by the real count (a few attempts)
  const place = (shares: readonly number[]): ForestChunk[] => {
    const result: ForestChunk[] = []
    cells.forEach((cell, i) => {
      const trees = treesOfChunk(cell, Math.sqrt(10_000 / (density * densityFactor(cell.distance) * shares[i])))
      if (trees.x.length > 0) result.push(toChunk(cell.key, cell.centre, trees, kx, ky))
    })
    return result
  }
  const countOf = (result: readonly ForestChunk[]) => result.reduce((n, c) => n + c.count, 0)
  const distances = cells.map((c) => c.distance)
  const expected = cells.map((c) => c.expected)
  let target = maxTrees * BUDGET_MARGIN
  let best: ForestChunk[] = []
  let last: ForestChunk[] = []
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const shares = thinning(distances, expected, target)
    last = place(shares)
    const count = countOf(last)
    const aimed = shares.reduce((n, share, i) => n + share * expected[i], 0)
    if (count <= maxTrees && count > countOf(best)) best = last
    if (count <= maxTrees && (count >= maxTrees * GOOD_FILL || shares.every((s) => s === 1))) break
    target = count > 0 ? (aimed * maxTrees * BUDGET_MARGIN) / count : target * 2
  }
  if (best.length > 0 || countOf(last) <= maxTrees) return best.length > 0 ? best : last
  // the budget is smaller than a minimal thinning can reach: the nearest chunks only, as a last resort
  const kept: ForestChunk[] = []
  let total = 0
  for (const chunk of last) {
    if (total + chunk.count > maxTrees) break
    total += chunk.count
    kept.push(chunk)
  }
  return kept
}

/** The forests of a chunk cut to its square (those left with no area dropped). */
function clipToChunk(forests: readonly Prepared[], x0: number, y0: number, x1: number, y1: number): Clipped[] {
  const clipped: Clipped[] = []
  for (const forest of forests) {
    const outer = clipRing(forest.outer, x0, y0, x1, y1)
    if (outer.length < 3) continue
    const holes = forest.holes.map((hole) => clipRing(hole, x0, y0, x1, y1)).filter((hole) => hole.length >= 3)
    clipped.push({ polygon: forest.polygon, outer, holes })
  }
  return clipped
}

/** Trees of one chunk: the cells of a global lattice of `spacing` whose jittered point falls in the chunk and in a forest. */
function treesOfChunk(chunk: { cx: number; cy: number; forests: Clipped[] }, spacing: number): Trees {
  const trees: Trees = { x: [], y: [], height: [], kind: [], variation: [], yaw: [] }
  const cellX0 = chunk.cx * CHUNK_M
  const cellY0 = chunk.cy * CHUNK_M
  const cellX1 = cellX0 + CHUNK_M
  const cellY1 = cellY0 + CHUNK_M
  const { forests } = chunk
  for (let k = 0; k < forests.length; k++) {
    const forest = forests[k]
    const xs = forest.outer.map((p) => p[0])
    const ys = forest.outer.map((p) => p[1])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    for (let ix = Math.floor(x0 / spacing); ix <= Math.floor(x1 / spacing); ix++) {
      for (let iy = Math.floor(y0 / spacing); iy <= Math.floor(y1 / spacing); iy++) {
        const x = (ix + hash01(ix, iy, 1)) * spacing
        const y = (iy + hash01(ix, iy, 2)) * spacing
        if (x < cellX0 || x >= cellX1 || y < cellY0 || y >= cellY1) continue
        if (!inForest(x, y, forest)) continue
        // two overlapping forests share the lattice: the one listed first has the tree
        if (k > 0 && forests.some((other, j) => j < k && inForest(x, y, other))) continue
        const leaf = forest.polygon.leaf
        trees.x.push(x)
        trees.y.push(y)
        trees.height.push(TREE_HEIGHT_M.min + (TREE_HEIGHT_M.max - TREE_HEIGHT_M.min) * hash01(ix, iy, 4))
        trees.kind.push(leaf === 'mixed' ? (hash01(ix, iy, 3) < 0.5 ? CONIFER : BROADLEAF) : leaf ? KIND_OF_LEAF[leaf] : BY_ALTITUDE)
        trees.variation.push(hash01(ix, iy, 5))
        trees.yaw.push(hash01(ix, iy, 6) * Math.PI * 2)
      }
    }
  }
  return trees
}

function toChunk(key: string, centre: LonLat, trees: Trees, kx: number, ky: number): ForestChunk {
  const count = trees.x.length
  const lonLat = new Float64Array(2 * count)
  for (let i = 0; i < count; i++) {
    lonLat[2 * i] = trees.x[i] / kx
    lonLat[2 * i + 1] = trees.y[i] / ky
  }
  return {
    key,
    centre,
    radiusM: (CHUNK_M * Math.SQRT2) / 2,
    count,
    lonLat,
    height: Float32Array.from(trees.height),
    kind: Uint8Array.from(trees.kind),
    variation: Float32Array.from(trees.variation),
    yaw: Float32Array.from(trees.yaw),
  }
}
