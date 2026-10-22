import type { TrackPoint, TrackSegment } from '../../core/types'
import { haversineM } from '../../geo/lonLat'
import { hasTimes, settled } from './common'
import type { Segments } from './common'

export interface PauseOptions {
  /** a stop: the track stays within this distance (metres) of where it stopped… */
  radiusM: number
  /** …for at least this long (seconds) */
  minDurationS: number
}

export const DEFAULT_PAUSES: PauseOptions = { radiusM: 15, minDurationS: 120 }
export const PAUSE_RADIUS_RANGE = { min: 5, max: 50, step: 5 }
export const PAUSE_DURATION_RANGE = { min: 30, max: 600, step: 10 }

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

/**
 * The stops of the track (none without times). The GPS wanders by several metres at rest, so a stop is not a run of slow
 * legs but a stay: from a point, the track keeps within `radiusM` of it for `minDurationS` or more. A slow climb moves
 * out of the radius within the minute and is never a stop.
 */
export function findPauses(segments: Segments, options: PauseOptions = DEFAULT_PAUSES): Pause[] {
  const pauses: Pause[] = []
  if (!hasTimes(segments)) return pauses
  let offset = 0
  for (const { points } of segments) {
    let i = 0
    while (i < points.length - 1) {
      let end = i
      while (end + 1 < points.length && haversineM(points[i], points[end + 1]) <= options.radiusM) end++
      const durationS = (points[end].time! - points[i].time!) / 1000
      if (end > i && durationS >= options.minDurationS) {
        pauses.push({ fromIndex: offset + i, toIndex: offset + end, startTime: points[i].time!, durationS, lon: points[i].lon, lat: points[i].lat })
        i = end + 1
      } else {
        i++
      }
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
  const out = segments.map(({ points }): TrackSegment => {
    const kept: TrackPoint[] = []
    for (const point of points) {
      const i = index++
      if (i <= skipUntil) continue
      kept.push(shiftMs === 0 ? point : { ...point, time: point.time! - shiftMs })
      const pause = byStart.get(i)
      if (pause) {
        skipUntil = pause.toIndex
        // the first point of the stop stays; what follows the stop is one stop-duration earlier
        shiftMs += pause.durationS * 1000
      }
    }
    return { points: kept }
  })
  return settled(out, segments)
}
