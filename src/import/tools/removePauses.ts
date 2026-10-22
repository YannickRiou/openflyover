import type { TrackPoint, TrackSegment } from '../../core/types'
import { haversineM } from '../../geo/lonLat'
import { hasTimes, secondsBetween } from './common'
import type { Segments } from './common'

export interface PauseOptions {
  /** a leg slower than this (km/h) belongs to a pause */
  maxSpeedKmh: number
  /** a stretch of slow legs shorter than this (seconds) is not a pause */
  minDurationS: number
}

export const DEFAULT_PAUSES: PauseOptions = { maxSpeedKmh: 1, minDurationS: 60 }
export const PAUSE_SPEED_RANGE = { min: 0.5, max: 5, step: 0.5 }
export const PAUSE_DURATION_RANGE = { min: 10, max: 600, step: 10 }

/** A stop found: the points `fromIndex` (kept) to `toIndex` (over every segment) and where and when it was. */
export interface Pause {
  fromIndex: number
  toIndex: number
  /** time of the first point of the stop (ms since epoch) */
  startTime: number
  durationS: number
  lon: number
  lat: number
}

function slowLeg(a: TrackPoint, b: TrackPoint, maxSpeedKmh: number): boolean {
  const s = secondsBetween(a, b)
  if (s === undefined || s < 0) return false
  const d = haversineM(a, b)
  return s === 0 ? d === 0 : (d / s) * 3.6 < maxSpeedKmh
}

/** The stops of the track (none without times). */
export function findPauses(segments: Segments, options: PauseOptions = DEFAULT_PAUSES): Pause[] {
  const pauses: Pause[] = []
  if (!hasTimes(segments)) return pauses
  let offset = 0
  for (const { points } of segments) {
    let i = 0
    while (i < points.length - 1) {
      let end = i
      while (end < points.length - 1 && slowLeg(points[end], points[end + 1], options.maxSpeedKmh)) end++
      const durationS = (points[end].time! - points[i].time!) / 1000
      if (end > i && durationS >= options.minDurationS) {
        pauses.push({ fromIndex: offset + i, toIndex: offset + end, startTime: points[i].time!, durationS, lon: points[i].lon, lat: points[i].lat })
      }
      i = Math.max(end, i + 1)
    }
    offset += points.length
  }
  return pauses
}

/**
 * « Retirer les pauses »: in every stop `findPauses` finds, the points after the first one are dropped and every later
 * time is moved back by the duration of the stop, so the duration of the outing no longer counts it. Unchanged when
 * there is no stop (or no time).
 */
export function removePauses(segments: Segments, options: PauseOptions = DEFAULT_PAUSES): Segments {
  const pauses = findPauses(segments, options)
  if (pauses.length === 0) return segments
  const byStart = new Map(pauses.map((p) => [p.fromIndex, p]))
  let shiftMs = 0
  let skipUntil = -1
  let index = 0
  return segments.map(({ points }): TrackSegment => {
    const out: TrackPoint[] = []
    for (const point of points) {
      const i = index++
      if (i <= skipUntil) continue
      out.push(shiftMs === 0 ? point : { ...point, time: point.time! - shiftMs })
      const pause = byStart.get(i)
      if (pause) {
        skipUntil = pause.toIndex
        // the first point of the stop stays; what follows the stop is one stop-duration earlier
        shiftMs += pause.durationS * 1000
      }
    }
    return { points: out }
  })
}
