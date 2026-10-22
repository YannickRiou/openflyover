import type { TrackSegment } from '../../core/types'
import { simplifyLine } from '../../osm/overpass'
import { pointCount } from './common'
import type { Segments } from './common'

export const DEFAULT_SIMPLIFY_M = 2
/** Above this tolerance (metres) the dialog warns that the shape of the route is changing. */
export const SIMPLIFY_WARNING_M = 8
export const SIMPLIFY_RANGE = { min: 0.5, max: 20, step: 0.5 }

/**
 * « Simplifier »: Douglas–Peucker on each segment (the same algorithm as the map layers, `simplifyLine`), the points that
 * stay keep all their data. The ends of each segment stay. Unchanged when no point can go.
 */
export function simplify(segments: Segments, toleranceM: number = DEFAULT_SIMPLIFY_M): Segments {
  const out = segments.map((segment): TrackSegment => {
    const kept = new Set(simplifyLine(segment.points, toleranceM))
    return kept.size === segment.points.length ? segment : { points: segment.points.filter((p) => kept.has(p)) }
  })
  return pointCount(out) === pointCount(segments) ? segments : out
}
