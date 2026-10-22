import type { TrackSegment } from '../../core/types'
import { pointCount, settled } from './common'
import type { Segments } from './common'

/**
 * « Rogner le début et la fin »: keeps the points from index `first` to index `last` (inclusive, counted over every
 * segment), times and measures untouched. Segments left with a single point go. Unchanged when nothing is cut or when no segment of two points would stay.
 */
export function trim(segments: Segments, first: number, last: number): Segments {
  const total = pointCount(segments)
  const from = Math.max(0, Math.floor(first))
  const to = Math.min(total - 1, Math.floor(last))
  if (to - from < 1 || (from === 0 && to === total - 1)) return segments
  const out: TrackSegment[] = []
  let offset = 0
  for (const segment of segments) {
    const lo = Math.max(from - offset, 0)
    const hi = Math.min(to - offset, segment.points.length - 1)
    if (hi >= lo) out.push({ points: segment.points.slice(lo, hi + 1) })
    offset += segment.points.length
  }
  return settled(out, segments)
}
