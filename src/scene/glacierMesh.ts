/**
 * Triangle mesh of a glacier (osm/glacier.ts) that can be draped on the relief: the same grid of square cells as the
 * water (`buildWaterMesh`: each ring cut against each cell, every piece triangulated with its holes), so the vertices lie
 * inside the glacier and follow the relief, and `fade` rises from 0 on the edge to 1 at `fadeM` (the outline is not a hard cut).
 *
 * Pure (three is used for its triangulation only).
 */
import type { GlacierPolygon } from '../osm/glacier'
import { DEFAULT_WATER_MESH, buildWaterMesh, type WaterMesh, type WaterMeshOptions } from './waterMesh'

/** Grid of the water, fade over 40 m. */
export const DEFAULT_GLACIER_MESH: WaterMeshOptions = DEFAULT_WATER_MESH

export type GlacierMesh = WaterMesh

export function buildGlacierMesh(polygon: GlacierPolygon, options: WaterMeshOptions = DEFAULT_GLACIER_MESH): GlacierMesh {
  return buildWaterMesh({ ...polygon, kind: 'lake' }, options)
}

/**
 * Heights of the vertices of a glacier with the holes of the relief filled: a vertex whose tile is not loaded (NaN) takes the
 * median of the known ones, so a glacier is drawn as soon as part of its relief is there and settles when the rest arrives.
 * Null when no height is known (the glacier waits for its tiles).
 */
export function fillHeights(heights: ArrayLike<number>): Float64Array | null {
  const known = Array.from(heights).filter((h) => !Number.isNaN(h))
  if (known.length === 0) return null
  known.sort((a, b) => a - b)
  const median = known[Math.floor((known.length - 1) / 2)]
  return Float64Array.from(heights, (h) => (Number.isNaN(h) ? median : h))
}
