/**
 * The flyover set by its duration or by the marker's speed: one setting (`flyoverDurationS`) with two faces. The speed is
 * not stored, it is the length of what is flown over the duration (km/h) or the recorded time over the duration
 * (« × temps réel »); setting one gives the other, kept inside the duration range and on whole seconds.
 *
 * It is the average speed: stops, slow-downs and speed portions are taken from the duration, not added to it.
 * Pure values and functions (no DOM, no React).
 */
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

/** How many times faster than the outing the flyover runs; undefined when the track has no times. */
export function speedUpFactor(recordedS: number | undefined, durationS: number): number | undefined {
  return recordedS !== undefined && recordedS > 0 && durationS > 0 ? recordedS / durationS : undefined
}

/** Duration (clamped, whole seconds) that makes the marker go `kmh` over `lengthM`; undefined for no length or no speed. */
export function durationForKmh(lengthM: number, kmh: number): number | undefined {
  return lengthM > 0 && kmh > 0 ? clampDuration((lengthM * 3.6) / kmh) : undefined
}

/** Duration (clamped, whole seconds) that makes the flyover `factor` times faster than the `recordedS` outing. */
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

/**
 * Recorded time of everything flown: the sum of each stage's own recorded duration (the nights between two days of
 * « À la suite » are not counted); undefined when one has no times, since « × temps réel » then means nothing.
 */
export function recordedTotalS(durationsS: readonly (number | undefined)[]): number | undefined {
  if (durationsS.length === 0 || durationsS.some((d) => d === undefined || !(d > 0))) return undefined
  return (durationsS as number[]).reduce((a, b) => a + b, 0)
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
