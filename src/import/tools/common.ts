/**
 * Track tools (« Outils de la trace »): shared helpers. Each tool is a pure function on the segments of a track (the
 * points addressed by one running index over every segment) that returns the **same array** when it has nothing to do:
 * the dialog and the store tell « no change, no history entry » by `next === segments`.
 */
import type { Flight, StatsOverride, Track, TrackPoint, TrackSegment } from '../../core/types'
import { computeBounds, computeStats } from '../stats'
import type { DistanceMap } from './distanceMap'

export type Segments = TrackSegment[]

export const TOOL_IDS = ['trim', 'cut', 'spikes', 'pauses', 'simplify', 'reverse', 'shift'] as const
export type ToolId = (typeof TOOL_IDS)[number]

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
 * The result of a tool that removes points: the segments left with a line in them (two points at least), or `original`
 * (nothing done) when no such segment would stay.
 */
export function settled(out: Segments, original: Segments): Segments {
  const kept = out.filter((s) => s.points.length >= 2)
  return kept.length === 0 ? original : kept
}

/** The figures of a correction by hand that a tool makes wrong (`Track.statsOverride`): they are dropped with it. */
const INVALIDATED: Record<ToolId, readonly (keyof StatsOverride)[]> = {
  trim: ['distanceM', 'ascentM', 'maxEle', 'durationS', 'maxSpeedKmh'],
  cut: ['distanceM', 'ascentM', 'maxEle', 'durationS', 'maxSpeedKmh'],
  spikes: ['distanceM', 'ascentM', 'maxSpeedKmh'],
  pauses: ['distanceM', 'durationS'],
  simplify: ['distanceM', 'ascentM', 'maxSpeedKmh'],
  // climbing becomes descending
  reverse: ['ascentM'],
  shift: [],
}

/** The corrected figures of `track` that `tool` would make wrong. */
export function invalidatedFigures(track: Track, tool: ToolId): (keyof StatsOverride)[] {
  const override = track.statsOverride
  return override ? INVALIDATED[tool].filter((key) => override[key] !== undefined) : []
}

/** Flights of the old points on the new ones: each end moved with `distances`, those on a removed stretch dropped. */
function movedFlights(flights: readonly Flight[], distances: DistanceMap): Flight[] {
  return flights.flatMap((f) => {
    if (distances.removed(f.startM) && distances.removed(f.endM)) return []
    const [a, b] = [distances.map(f.startM), distances.map(f.endM)]
    const [startM, endM] = [Math.min(a, b), Math.max(a, b)]
    return endM - startM >= 1 ? [{ ...f, startM, endM }] : []
  })
}

/**
 * `track` over new segments: statistics and bounds recomputed. The figures corrected by hand that `tool` makes wrong are
 * dropped (`invalidatedFigures`). With `distances` (old distance → new distance of the same place) the stretches flown
 * (`flights`, metres along the track) move with it; `elevationFilled` is indexed on the old points: dropped. A time shift
 * moves nothing: both stay. Returns `track` itself when `segments` is its own (the tool had nothing to do).
 */
export function withSegments(track: Track, segments: Segments, tool: ToolId, distances?: DistanceMap): Track {
  if (segments === track.segments) return track
  const kept = segments.filter((s) => s.points.length > 0)
  if (kept.length === 0) return track
  const out: Track = { ...track, segments: kept, stats: computeStats(kept), bounds: computeBounds(kept) }
  if (tool !== 'shift') {
    delete out.elevationFilled
    delete out.flights
    const flights = track.flights && distances ? movedFlights(track.flights, distances) : []
    if (flights.length > 0) out.flights = flights
  }
  const dropped = invalidatedFigures(track, tool)
  if (dropped.length > 0) {
    const override = { ...track.statsOverride }
    for (const key of dropped) delete override[key]
    if (Object.keys(override).length > 0) out.statsOverride = override
    else delete out.statsOverride
  }
  return out
}
