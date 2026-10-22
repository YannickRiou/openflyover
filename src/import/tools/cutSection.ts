import type { TrackPoint, TrackSegment } from '../../core/types'
import { pointCount } from './common'
import type { Segments } from './common'

/** What becomes of the two sides of the removed section: one segment (a straight line over it) or two. */
export type CutMode = 'join' | 'split'

/**
 * « Retirer une section »: removes the points from index `first` to index `last` (inclusive, over every segment).
 * `join`: the points around the cut stay in one segment, joined by a straight line (the time gap is kept);
 * `split`: they become two segments of the same track. Unchanged when no point goes or when fewer than two would stay.
 */
export function cutSection(segments: Segments, first: number, last: number, mode: CutMode): Segments {
  const total = pointCount(segments)
  const from = Math.max(0, Math.floor(first))
  const to = Math.min(total - 1, Math.floor(last))
  if (to < from || to - from + 1 > total - 2) return segments
  const out: TrackPoint[][] = []
  let current: TrackPoint[] | null = null
  let previousSegment = -1
  let gap = false
  let index = 0
  segments.forEach((segment, s) => {
    for (const point of segment.points) {
      const removed = index >= from && index <= to
      index++
      if (removed) {
        gap = true
        continue
      }
      // after a cut: one more segment when splitting; otherwise a new segment only where the file had one
      if (current === null || (gap ? mode === 'split' : s !== previousSegment)) {
        current = []
        out.push(current)
      }
      current.push(point)
      previousSegment = s
      gap = false
    }
  })
  return out.map((points): TrackSegment => ({ points }))
}
