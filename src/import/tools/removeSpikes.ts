import type { TrackPoint, TrackSegment } from '../../core/types'
import { haversineM } from '../../geo/lonLat'
import { medianOf, secondsBetween, settled } from './common'
import type { Segments } from './common'

export interface SpikeOptions {
  /** a leg is a jump above this many times the median speed of the track (the median step without times) */
  factor: number
  /** a jump is at least this long (metres): a slow wobble is not a spike */
  minJumpM: number
}

export const DEFAULT_SPIKES: SpikeOptions = { factor: 4, minJumpM: 100 }
export const SPIKE_FACTOR_RANGE = { min: 2, max: 20, step: 1 }

/** Speed (m/s) of the leg a → b, Infinity for a jump in no time, undefined without times. */
function legSpeed(a: TrackPoint, b: TrackPoint, distanceM: number): number | undefined {
  const s = secondsBetween(a, b)
  if (s === undefined) return undefined
  return s > 0 ? distanceM / s : distanceM > 0 ? Number.POSITIVE_INFINITY : 0
}

/**
 * Indexes (over every segment) of the points to drop: a point that the track leaves and comes back from in a jump of
 * `minJumpM` at least, faster than `factor` times the median speed (a single wrong fix, a GPS jump). The first and the last
 * point of a segment have no neighbour on one side: never dropped.
 */
export function findSpikes(segments: Segments, options: SpikeOptions = DEFAULT_SPIKES): number[] {
  const speeds: number[] = []
  const steps: number[] = []
  for (const { points } of segments) {
    for (let i = 1; i < points.length; i++) {
      const d = haversineM(points[i - 1], points[i])
      steps.push(d)
      const v = legSpeed(points[i - 1], points[i], d)
      if (v !== undefined && v > 0 && Number.isFinite(v)) speeds.push(v)
    }
  }
  const timed = speeds.length > 0
  const limit = options.factor * (timed ? medianOf(speeds) : medianOf(steps.filter((d) => d > 0)))
  const spikes: number[] = []
  let offset = 0
  for (const { points } of segments) {
    let previous = 0
    for (let i = 1; i < points.length - 1; i++) {
      const d1 = haversineM(points[previous], points[i])
      const d2 = haversineM(points[i], points[i + 1])
      const back = haversineM(points[previous], points[i + 1])
      let fast = Math.min(d1, d2) > limit
      if (timed) {
        const v1 = legSpeed(points[previous], points[i], d1)
        const v2 = legSpeed(points[i], points[i + 1], d2)
        fast = v1 === undefined || v2 === undefined || (v1 > limit && v2 > limit)
      }
      if (Math.min(d1, d2) >= options.minJumpM && back < Math.min(d1, d2) / 2 && fast) spikes.push(offset + i)
      else previous = i
    }
    offset += points.length
  }
  return spikes
}

/** « Supprimer les pics GPS »: the points `findSpikes` finds are dropped. Unchanged when there is none. */
export function removeSpikes(segments: Segments, options: SpikeOptions = DEFAULT_SPIKES): Segments {
  const spikes = new Set(findSpikes(segments, options))
  if (spikes.size === 0) return segments
  let index = 0
  return settled(segments.map((segment): TrackSegment => ({ points: segment.points.filter(() => !spikes.has(index++)) })), segments)
}
