import type { TrackPoint, TrackSegment } from '../../core/types'
import { pointCount } from './common'
import type { Segments } from './common'

/**
 * « Inverser le sens »: the points run the other way (the segments too), each one keeping its measures. The times are
 * mirrored so they still increase: the first time stays, each gap is kept (the point that was last is now first).
 * Unchanged below two points.
 */
export function reverse(segments: Segments): Segments {
  if (pointCount(segments) < 2) return segments
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const { points } of segments) {
    for (const p of points) {
      if (p.time === undefined) continue
      first = Math.min(first, p.time)
      last = Math.max(last, p.time)
    }
  }
  const mirrored = (p: TrackPoint): TrackPoint => (p.time === undefined ? p : { ...p, time: first + last - p.time })
  return segments
    .map((segment): TrackSegment => ({ points: segment.points.map(mirrored).reverse() }))
    .reverse()
}
