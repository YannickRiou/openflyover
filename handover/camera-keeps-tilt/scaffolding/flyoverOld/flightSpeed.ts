/**
 * The flyover set by its duration or by the marker's speed: one setting (`flyoverDurationS`) with two faces. The speed is
 * not stored, it is the length of what is flown over the duration (km/h) or the time spent MOVING on the outing over the
 * duration (« × l'allure réelle »: pauses, lunches and nights are not counted, so 100 km/h on a day's walk at 2 km/h reads
 * about × 50, not the × 150 the elapsed time of the file would give); setting one gives the other, kept inside the
 * duration range and on whole seconds.
 *
 * It is the average speed: with « Garder la durée du survol » stops, slow-downs and speed portions are taken from the
 * duration, not added to it (nights and the pauses between stages always are: `flightExtras`).
 * Pure values and functions (no DOM, no React).
 */
import type { Track } from '../core/types'
import { correctedStats } from '../import/stats'
import { hasTimes } from '../import/tools/common'
import { findPauses } from '../import/tools/removePauses'
import { FLYOVER_DURATION_RANGE } from './cameraSettings'

const { min: MIN_S, max: MAX_S } = FLYOVER_DURATION_RANGE

/** The duration in whole seconds, kept inside the range of the slider. */
export function clampDuration(durationS: number): number {
  if (!Number.isFinite(durationS)) return MIN_S
  return Math.min(MAX_S, Math.max(MIN_S, Math.round(durationS)))
}

/** Average speed of the marker (km/h) over `lengthM` flown in `durationS`; undefined without a length. */
export function speedKmh(lengthM: number, durationS: number): number | undefined {
  return lengthM > 0 && durationS > 0 ? (lengthM * 3.6) / durationS : undefined
}

/** How many times faster than the outing's moving time the flyover runs; undefined when the track has no times. */
export function speedUpFactor(recordedS: number | undefined, durationS: number): number | undefined {
  return recordedS !== undefined && recordedS > 0 && durationS > 0 ? recordedS / durationS : undefined
}

/** Duration (clamped, whole seconds) that makes the marker go `kmh` over `lengthM`; undefined for no length or no speed. */
export function durationForKmh(lengthM: number, kmh: number): number | undefined {
  return lengthM > 0 && kmh > 0 ? clampDuration((lengthM * 3.6) / kmh) : undefined
}

/** Duration (clamped, whole seconds) that makes the flyover `factor` times faster than the `recordedS` of moving time. */
export function durationForSpeedUp(recordedS: number | undefined, factor: number): number | undefined {
  return recordedS !== undefined && recordedS > 0 && factor > 0 ? clampDuration(recordedS / factor) : undefined
}

/** True when the speed can be given as « × temps réel »: the track has times and the factors the durations allow include a whole one. */
export function hasSpeedUp(recordedS: number | undefined): recordedS is number {
  return recordedS !== undefined && recordedS >= MIN_S
}

/** The range a typed value may take (`lo` to `hi`, on notches of `step`), the ends brought inside; never inverted. */
export function typedRange(lo: number, hi: number, step: number): { min: number; max: number; step: number } {
  const min = Math.ceil(lo / step - 1e-9) * step
  const max = Math.floor(hi / step + 1e-9) * step
  return { min: Number(min.toFixed(6)), max: Number(Math.max(min, max).toFixed(6)), step }
}

/** Typed speed in km/h: the range the duration range allows for `lengthM`; notches of 0.1 under 100 km/h. */
export function kmhRange(lengthM: number): { min: number; max: number; step: number } {
  const lo = (lengthM * 3.6) / MAX_S
  const hi = (lengthM * 3.6) / MIN_S
  return typedRange(lo, hi, hi < 100 ? 0.1 : 1)
}

/** Typed speed as « × temps réel »: the range the duration range allows for `recordedS`, whole numbers. */
export function speedUpRange(recordedS: number): { min: number; max: number; step: number } {
  return typedRange(recordedS / MAX_S, recordedS / MIN_S, 1)
}

/** Positions of the speed slider: 0 = slowest (longest duration) to `SPEED_POSITIONS` = fastest, evenly spread in log scale. */
export const SPEED_POSITIONS = 1000

/** Slider position of a duration: the speed slider spans the duration range, logarithmically. */
export function speedPosition(durationS: number): number {
  const ratio = Math.log(clampDuration(durationS) / MIN_S) / Math.log(MAX_S / MIN_S)
  return Math.round((1 - ratio) * SPEED_POSITIONS)
}

/** Duration (whole seconds) at a position of the speed slider. */
export function durationAtPosition(position: number): number {
  const share = Math.min(1, Math.max(0, position / SPEED_POSITIONS))
  return clampDuration(MIN_S * Math.pow(MAX_S / MIN_S, 1 - share))
}

/** Between two consecutive points, longer than this (seconds) is a recording gap, not time spent moving. */
const GAP_S = 600

const movingCache = new WeakMap<Track['segments'], number | undefined>()

/**
 * Time the person spent moving on the outing (seconds): the time of each segment minus its stops (« Retirer les pauses »:
 * the track stays within 15 m for 2 minutes) and its recording gaps (over 10 minutes between two points), so a lunch, a
 * bivouac or a night are not counted, nor the gap between two segments. The duration typed in « Corriger les chiffres » is taken as it is; a track without times has none.
 */
export function movingTimeS(track: Track): number | undefined {
  const typed = track.statsOverride?.durationS
  if (typed !== undefined) return typed > 0 ? typed : undefined
  const { segments } = track
  if (!hasTimes(segments)) return track.stats.durationS
  if (movingCache.has(segments)) return movingCache.get(segments)
  const elapsedMs = segments.reduce((sum, { points }) => sum + (points.length > 1 ? points[points.length - 1].time! - points[0].time! : 0), 0)
  const pauses = findPauses(segments)
  const stoppedS = pauses.reduce((sum, pause) => sum + pause.durationS, 0)
  // a recording gap (recorder paused or off, the first fix after it far away) is a pause too, unless a stop already holds it
  let gapS = 0
  let index = 0
  for (const { points } of segments) {
    for (let k = 0; k + 1 < points.length; k++) {
      const at = index + k
      const dt = (points[k + 1].time! - points[k].time!) / 1000
      if (dt > GAP_S && !pauses.some((p) => p.fromIndex <= at && at + 1 <= p.toIndex)) gapS += dt
    }
    index += points.length
  }
  const movingS = elapsedMs / 1000 - stoppedS - gapS
  const result = movingS > 0 ? movingS : undefined
  movingCache.set(segments, result)
  return result
}

/** Distance that goes with `movingTimeS` for the pace walked: the corrected one when the duration is a corrected figure. */
export function movingDistanceM(track: Track): number {
  return track.statsOverride?.durationS !== undefined ? correctedStats(track).distanceM : track.stats.distanceM
}

/**
 * Moving time of everything flown: the sum of each stage's own (the nights between two days of « À la suite » are not
 * counted); undefined when one has no times, since « × l'allure réelle » then means nothing.
 */
export function movingTotalS(durationsS: readonly (number | undefined)[]): number | undefined {
  if (durationsS.length === 0 || durationsS.some((d) => d === undefined || !(d > 0))) return undefined
  return (durationsS as number[]).reduce((a, b) => a + b, 0)
}

/** What makes the flight longer (or shorter) than the duration set, in seconds (`flightExtras`). */
export interface FlightExtras {
  /** flight minus the duration set: negative when the flight is shorter */
  deltaS: number
  nights: number
  nightsS: number
  /** stops added on top of the duration (« Garder la durée du survol » unticked) */
  stopsS: number
  /** the rest: slow-downs added with « Garder » unticked, pauses between stages */
  otherS: number
}

/**
 * Why the flight (the « Survol » block of the timeline, `flightS`) does not last the duration set: longer (the nights
 * shown as pauses, the stops when « Garder la durée du survol » is off, the rest) or shorter (speed portions, stages with
 * a duration of their own, « Garder » off). Undefined when it lasts the duration set (within half a second).
 */
export function flightExtras(input: {
  flightS: number
  durationS: number
  keepDuration: boolean
  /** film time added by the stops (`ClockStop.addedS`) */
  stopsAddedS: number
  /** film time of each night shown as a pause */
  nightsS: readonly number[]
}): FlightExtras | undefined {
  const deltaS = input.flightS - input.durationS
  if (!(Math.abs(deltaS) >= 0.5)) return undefined
  const nightsS = input.nightsS.reduce((a, b) => a + b, 0)
  const stopsS = input.keepDuration ? 0 : input.stopsAddedS
  return { deltaS, nights: input.nightsS.length, nightsS, stopsS, otherS: Math.max(0, deltaS - nightsS - stopsS) }
}

/**
 * Duration the speed slider asks for at `position` while the flyover lasts `currentS`. Several notches of the log slider
 * can round to the same whole second: a step of one notch (the arrow keys) that would change nothing moves one second
 * the way it points (right = faster = shorter) instead, so the thumb never sticks. A drag that lands on the same second
 * more than one notch away changes nothing.
 */
export function durationAtSliderPosition(position: number, currentS: number): number {
  const asked = durationAtPosition(position)
  if (asked !== currentS) return asked
  const delta = position - speedPosition(currentS)
  return Math.abs(delta) === 1 ? clampDuration(currentS - delta) : currentS
}
