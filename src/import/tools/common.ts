/**
 * Track tools (« Outils de la trace »): shared helpers. Each tool is a pure function on the segments of a track (the
 * points addressed by one running index over every segment) that returns the **same array** when it has nothing to do:
 * the dialog and the store tell « no change, no history entry » by `next === segments`.
 */
import type { Track, TrackPoint, TrackSegment } from '../../core/types'
import { computeBounds, computeStats } from '../stats'

export type Segments = TrackSegment[]

export function pointCount(segments: Segments): number {
  return segments.reduce((n, s) => n + s.points.length, 0)
}

/** True when every point of the track has a time (the tools that read or move the clock need it). */
export function hasTimes(segments: Segments): boolean {
  return pointCount(segments) > 0 && segments.every((s) => s.points.every((p) => p.time !== undefined && Number.isFinite(p.time)))
}

/** Seconds between two points when both are timed, else undefined. */
export function secondsBetween(a: TrackPoint, b: TrackPoint): number | undefined {
  return a.time !== undefined && b.time !== undefined ? (b.time - a.time) / 1000 : undefined
}

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * `track` over new segments: statistics and bounds recomputed. The stretches flown (`flights`) and the filled ranges
 * (`elevationFilled`) are indexed on the old points: dropped. The figures corrected by hand are kept (the user's choice).
 * Returns `track` itself when `segments` is its own (the tool had nothing to do).
 */
export function withSegments(track: Track, segments: Segments): Track {
  if (segments === track.segments) return track
  const kept = segments.filter((s) => s.points.length > 0)
  if (kept.length === 0) return track
  const out: Track = { ...track, segments: kept, stats: computeStats(kept), bounds: computeBounds(kept) }
  delete out.flights
  delete out.elevationFilled
  return out
}
