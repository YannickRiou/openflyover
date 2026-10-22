/**
 * Where the trees stand (pure, deterministic): the same forests, density, budget and track always give the same trees,
 * so the export draws what the preview shows.
 *
 * The forests (osm/forest.ts) are cut into square chunks of CHUNK_M. In each chunk, trees stand on a jittered grid whose
 * spacing follows the density (every grid cell's tree comes from a hash of its place, not from a random generator), kept
 * only inside a forest and outside its holes. The density thins out with the distance of the chunk to the track
 * (the flyover sees the near forests closely, the far ones as a texture), and the chunks nearest to the track are placed
 * first, until `maxTrees` is reached: a long track never exceeds the device budget (core/deviceBudget.ts).
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
  /** the track (simplified is enough) */
  path: readonly LonLat[]
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

/** Place the trees of the forests (see the module comment). */
export function placeTrees(polygons: readonly ForestPolygon[], { density, maxTrees, path }: PlacementOptions): ForestChunk[] {
  if (polygons.length === 0 || density <= 0 || maxTrees <= 0) return []
  // equirectangular metres around the first point of the track (else of the first forest), one fixed frame for the run
  const origin = path[0] ?? { lon: polygons[0].outer[0][0], lat: polygons[0].outer[0][1] }
  const kx = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180)
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
  const ordered = [...chunks.entries()]
    .map(([key, chunk]) => {
      const centre = { lon: ((chunk.cx + 0.5) * CHUNK_M) / kx, lat: ((chunk.cy + 0.5) * CHUNK_M) / ky }
      return { key, chunk, centre, distance: distanceToPath(centre, path) }
    })
    .sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : 1))

  const result: ForestChunk[] = []
  let total = 0
  for (const { key, chunk, centre, distance } of ordered) {
    const spacing = Math.sqrt(10_000 / (density * densityFactor(distance)))
    const trees = treesOfChunk(chunk, spacing)
    const count = trees.x.length
    if (count === 0) continue
    if (total + count > maxTrees) break
    total += count
    result.push(toChunk(key, centre, trees, kx, ky))
  }
  return result
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
function treesOfChunk(chunk: { cx: number; cy: number; forests: Prepared[] }, spacing: number): Trees {
  const trees: Trees = { x: [], y: [], height: [], kind: [], variation: [], yaw: [] }
  const cellX0 = chunk.cx * CHUNK_M
  const cellY0 = chunk.cy * CHUNK_M
  const cellX1 = cellX0 + CHUNK_M
  const cellY1 = cellY0 + CHUNK_M
  const forests = clipToChunk(chunk.forests, cellX0, cellY0, cellX1, cellY1)
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
