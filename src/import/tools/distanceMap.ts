import { haversineM } from '../../geo/lonLat'
import type { Segments } from './common'

/**
 * Where a place of the track was before a tool and where it is after: distances along the track (metres, the scale of
 * `buildTrackPath`: a jump between two segments counts for nothing). Used to move what is anchored in metres (the film's
 * stops and keys, the flights) with the points they were set on.
 */
export interface DistanceMap {
  /** the distance after the tool of the place that was at `distanceM` (between two surviving points: in proportion) */
  map(distanceM: number): number
  /** the place was on a stretch the tool removed (trim, cut): what is anchored there goes */
  removed(distanceM: number): boolean
}

/** What a tool did to the places of the track: nothing (points dropped here and there), a reversal, stretches removed. */
export interface Anchors {
  reversed?: boolean
  /** stretches removed, as indexes of the old points (both included, over every segment) */
  removed?: { from: number; to: number }[]
}

/** Cumulative distance at each point over every segment (what `buildTrackPath` calls `dist`). */
export function cumulativeOf(segments: Segments): number[] {
  const out: number[] = []
  let total = 0
  for (const { points } of segments) {
    points.forEach((p, i) => {
      if (i > 0) total += haversineM(points[i - 1], p)
      out.push(total)
    })
  }
  return out
}

/**
 * The map from the old segments to the new ones. The points a tool keeps are found again by their position, in order
 * (no tool moves a point); the places between two of them move in proportion, so a stop in the middle of a long straight
 * line that `simplify` thinned out stays in the middle.
 */
export function distanceMap(before: Segments, after: Segments, { reversed = false, removed = [] }: Anchors = {}): DistanceMap {
  const old = cumulativeOf(before)
  const next = cumulativeOf(after)
  const total = old.length > 0 ? old[old.length - 1] : 0
  if (reversed) return { map: (d) => Math.max(0, total - d), removed: () => false }

  // intervals of the old distance on removed ground, open at the ends (the first point kept survives)
  const gaps = removed.map(({ from, to }): [number, number] => [from > 0 ? old[from - 1] : Number.NEGATIVE_INFINITY, to < old.length - 1 ? old[to + 1] : Number.POSITIVE_INFINITY])
  const oldPoints = before.flatMap((s) => s.points)
  const newPoints = after.flatMap((s) => s.points)
  const pairs: [number, number][] = []
  let j = 0
  for (let i = 0; i < oldPoints.length && j < newPoints.length; i++) {
    if (oldPoints[i].lon === newPoints[j].lon && oldPoints[i].lat === newPoints[j].lat) pairs.push([old[i], next[j++]])
  }
  return {
    removed: (d) => gaps.some(([a, b]) => d > a && d < b),
    map: (d) => {
      if (pairs.length === 0) return 0
      // the last surviving point at or before d
      let lo = 0
      let hi = pairs.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (pairs[mid][0] <= d) lo = mid
        else hi = mid - 1
      }
      const [a, na] = pairs[lo]
      if (d <= a || lo === pairs.length - 1) return na
      const [b, nb] = pairs[lo + 1]
      return b > a ? na + ((d - a) / (b - a)) * (nb - na) : na
    },
  }
}
