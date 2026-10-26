/**
 * Variable pacing of the flyover: stops, speed portions and night pauses of the film.
 * Progress stays the fraction of the track distance; only the film time -> progress mapping changes
 * (raised-cosine transitions, pauses, speed portions, `keepDuration`: ARCHITECTURE.md "Flyover", Pacing).
 * Nothing to do gives the identity pacing. Pure functions (no DOM, React, Three or store).
 */
import { isRecord } from '../core/guards'
import { clamp, lastIndexAtOrBelow } from '../core/math'
import { CROSSED_PASS_M, type Landmark } from '../osm/landmarks'
import { advanceProgress } from './cameraSettings'

export interface PacingSettings {
  /** keep the film at `flyoverDurationS` (the base speed rises) instead of lengthening it */
  keepDuration: boolean
  /**
   * longest transition into and out of a speed portion or a pause (film seconds at ×1): the speed eases over it
   * instead of jumping; « Transitions » of the Survol tab
   */
  transitionS: number
}

export const DEFAULT_PACING: PacingSettings = {
  keepDuration: true,
  transitionS: 1.5,
}

/** Slider ranges (also the validity ranges of a loaded project). */
export const PACING_RANGES = {
  transitionS: { min: 0.5, max: 4, step: 0.25 },
} as const satisfies Partial<Record<keyof PacingSettings, { min: number; max: number; step: number }>>

/** A peak at most this far from the track is a highlight (metres). */
export const PEAK_NEAR_M = 300
/** Longest ease into and out of a pause by default (film seconds at ×1, `transitionS`). */
export const PAUSE_EASE_S = DEFAULT_PACING.transitionS
/** With `keepDuration`, the pauses take at most this share of the flyover duration. */
export const MAX_PAUSE_SHARE = 0.5
/** Longest transition into and out of a speed portion by default (film seconds at the base speed, ×1, `transitionS`). */
export const SPEED_EASE_S = DEFAULT_PACING.transitionS
/** Grid steps across each transition of a speed portion. */
export const SPEED_SAMPLES = 32

/**
 * Pacing of a project saved before a field was added: its default value. The fields of « Ralentir aux temps forts »
 * (removed) are dropped: such a film plays without those slow-downs.
 */
export function withPacingDefaults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const { enabled: _enabled, climbs: _climbs, landmarks: _landmarks, slowFactor: _slowFactor, windowM: _windowM, pauseS: _pauseS, ...saved } = raw
  return { ...DEFAULT_PACING, ...saved }
}

/** Every number inside its slider range. */
export function isValidPacing(pacing: PacingSettings): boolean {
  return (Object.keys(PACING_RANGES) as (keyof typeof PACING_RANGES)[]).every((k) => {
    const { min, max } = PACING_RANGES[k]
    return pacing[k] >= min && pacing[k] <= max
  })
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

/** A pass crossed by the track or a peak next to it. */
export function isHighlightLandmark(l: Landmark): boolean {
  return (l.kind === 'pass' && l.distanceM <= CROSSED_PASS_M) || (l.kind === 'peak' && l.distanceM <= PEAK_NEAR_M)
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Playback position: film time (seconds at ×1) and the progress it maps to. */
export interface PacingPosition {
  timeS: number
  progress: number
}

export interface PacingPause {
  progress: number
  /** film time (seconds at ×1) when the marker starts slowing down to the stop (start of the ease-in) */
  startS: number
  /** film time when the marker stops and starts again */
  holdStartS: number
  holdEndS: number
  /** film time when the marker is back to its speed (end of the ease-out) */
  endS: number
  /** time added to the film (seconds at ×1, after the `keepDuration` cap) */
  durationS: number
}

/** A pause inserted in the flight: the marker stops at `atM` metres along the track, `durationS` added to the film. */
export interface FlightStop {
  atM: number
  durationS: number
  /** added to the film whatever `keepDuration`, never shortened (a night of a multi-day track) */
  extra?: boolean
}

/** A portion of the track flown `factor` times faster (2) or slower (0.5), metres along it. */
export interface FlightSpeed {
  fromM: number
  toM: number
  factor: number
}

/**
 * Speed multiplier set by keys along the track (film `paramKeys` of the speed): `at(x)` at `x` metres, 1 = normal;
 * `knotsM` the key positions, sorted. Combined with the portions.
 */
export interface SpeedCurve {
  knotsM: readonly number[]
  at(xM: number): number
}

/**
 * A stage of a sequence « À la suite » (metres along it, the stages one after the other over the whole length): with
 * `durationS` it flies that long (its moving time plus its own pauses, not the held junctions or nights), without it
 * its share of the duration as ever.
 */
export interface FlightStage {
  fromM: number
  toM: number
  durationS?: number
}

/** Speed portion clamped to the track, with the length of its transitions (metres). */
interface SpeedRamp extends FlightSpeed {
  rampM: number
}

/**
 * Speed multiplier m(x) at `x` metres: `factor` inside a portion, eased from and back to 1 over `rampM` at both
 * ends (geometric, raised cosine), 1 outside every portion.
 */
function speedMultiplier(x: number, ramps: readonly SpeedRamp[]): number {
  for (const { fromM, toM, factor, rampM } of ramps) {
    if (x <= fromM || x >= toM) continue
    const edge = Math.min(x - fromM, toM - x)
    const w = edge >= rampM ? 1 : (1 - Math.cos((Math.PI * edge) / rampM)) / 2
    return factor ** w
  }
  return 1
}

export interface Pacing {
  /** false for the identity pacing (constant ground speed) */
  active: boolean
  pauses: readonly PacingPause[]
  /** film length at ×1 (seconds) */
  totalTime(): number
  /** progress at film time `tS` (clamped to [0, totalTime()]); continuous and non-decreasing */
  progressAtTime(tS: number): number
  /**
   * first film time at which the progress reaches `progress` (start of the hold for a paused highlight); 1 is the
   * end of the film, after a final pause
   */
  timeAtProgress(progress: number): number
  /** position of a progress set from outside (scrub, rewind) */
  positionAt(progress: number): PacingPosition
  /** position after `dtS` seconds of playback at `speed` (the film time is clamped to [0, totalTime()]) */
  advance(from: PacingPosition, dtS: number, speed: number): PacingPosition
}

/** Constant ground speed: the film lasts `durationS`, `advance` is `advanceProgress`. */
function identityPacing(durationS: number): Pacing {
  const progressAtTime = (tS: number) => clamp(tS / durationS, 0, 1)
  const timeAtProgress = (progress: number) => clamp(progress, 0, 1) * durationS
  return {
    active: false,
    pauses: [],
    totalTime: () => durationS,
    progressAtTime,
    timeAtProgress,
    positionAt: (progress) => ({ timeS: timeAtProgress(progress), progress }),
    advance: (from, dtS, speed) => ({
      timeS: clamp(from.timeS + dtS * speed, 0, durationS),
      progress: advanceProgress(from.progress, dtS, speed, durationS),
    }),
  }
}

/** Linear interpolation of the piecewise-linear table (from → to) at `v` (clamped to the table). */
function interpolate(from: Float64Array, to: Float64Array, v: number): number {
  const n = from.length
  if (v <= from[0]) return to[0]
  if (v >= from[n - 1]) return to[n - 1]
  const i = Math.min(n - 2, lastIndexAtOrBelow(from, v))
  const span = from[i + 1] - from[i]
  return span > 0 ? to[i] + ((to[i + 1] - to[i]) * (v - from[i])) / span : to[i]
}

/** Moving time covered `s` seconds into an ease-in of length `e` (clock 1 → 0); ease-in(e) = e / 2. */
function easeIn(s: number, e: number): number {
  return e > 0 ? s / 2 + (e / (2 * Math.PI)) * Math.sin((Math.PI * s) / e) : 0
}

/** Same for an ease-out (clock 0 → 1); ease-out(e) = e / 2. */
function easeOut(s: number, e: number): number {
  return e > 0 ? s / 2 - (e / (2 * Math.PI)) * Math.sin((Math.PI * s) / e) : 0
}

/** s in [0, e] with ease(s, e) = target (both eases are non-decreasing), by bisection. */
function invertEase(ease: (s: number, e: number) => number, target: number, e: number): number {
  let lo = 0
  let hi = e
  for (let k = 0; k < 60 && hi - lo > 1e-12; k++) {
    const mid = (lo + hi) / 2
    if (ease(mid, e) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Highlights closer than `gapM` to the previous one form a cluster; each cluster's member nearest its middle. */
export function pausePositions(sorted: readonly number[], gapM: number): number[] {
  const out: number[] = []
  let start = 0
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] - sorted[i - 1] <= gapM) continue
    const middle = (sorted[start] + sorted[i - 1]) / 2
    let best = sorted[start]
    for (let k = start; k < i; k++) if (Math.abs(sorted[k] - middle) < Math.abs(best - middle)) best = sorted[k]
    out.push(best)
    start = i
  }
  return out
}

/** Speed portions clamped to the track, without the empty or neutral ones, with transitions of at most `easeM`. */
function speedRamps(speeds: readonly FlightSpeed[], lengthM: number, easeM: number): SpeedRamp[] {
  return speeds.flatMap(({ fromM, toM, factor }) => {
    const from = clamp(fromM, 0, lengthM)
    const to = clamp(toM, 0, lengthM)
    return to > from && factor > 0 && factor !== 1 ? [{ fromM: from, toM: to, factor, rampM: Math.min(easeM, (to - from) / 2) }] : []
  })
}

/**
 * Distance grid (sorted, distinct): track ends, pauses, stage edges and regular steps across every speed transition
 * and speed key.
 */
function distanceGrid(
  lengthM: number,
  pauseAt: readonly number[],
  ramps: readonly SpeedRamp[],
  curve?: SpeedCurve,
  stageEdgesM: readonly number[] = [],
): number[] {
  const nodes = [0, lengthM, ...pauseAt, ...stageEdgesM.map((x) => clamp(x, 0, lengthM))]
  const knots = curve?.knotsM ?? []
  for (let i = 0; i < knots.length; i++) {
    nodes.push(clamp(knots[i], 0, lengthM))
    if (i > 0) for (let j = 1; j < SPEED_SAMPLES; j++) nodes.push(clamp(knots[i - 1] + (j * (knots[i] - knots[i - 1])) / SPEED_SAMPLES, 0, lengthM))
  }
  for (const { fromM, toM, rampM } of ramps) {
    for (let j = 0; j <= SPEED_SAMPLES; j++) nodes.push(fromM + (j * rampM) / SPEED_SAMPLES, toM - (j * rampM) / SPEED_SAMPLES)
  }
  nodes.sort((a, b) => a - b)
  const xs: number[] = []
  for (const x of nodes) if (xs.length === 0 || x > xs[xs.length - 1]) xs.push(x)
  return xs
}

/** Share of the stage's time its pauses may not leave to the flight: the moving time keeps at least this part of it. */
const MIN_STAGE_MOVING_SHARE = 0.1

/**
 * Moving time (`raw` scaled) along the grid `xs` of a sequence whose stages `stages` (sorted, one after the other over
 * `lengthM`) have durations of their own: a stage that sets one flies exactly that long, its own pauses (`squeezedS`, by
 * pause position `pauseAt`) included; the others share `durationS` in proportion to their length, with `keepDuration`
 * keeping them to it (otherwise their moving time is left as it is). A stage over zero metres has no time.
 */
function stagedMovingTime(
  stages: readonly FlightStage[],
  xs: readonly number[],
  raw: Float64Array,
  lengthM: number,
  durationS: number,
  keepDuration: boolean,
  pauseAt: readonly number[],
  squeezedS: readonly number[],
): Float64Array {
  const stageOf = (x: number) => {
    let k = 0
    for (let j = 1; j < stages.length; j++) if (x >= stages[j].fromM) k = j
    return k
  }
  const moving = stages.map(() => 0)
  const stepStage = xs.map((x, i) => (i > 0 ? stageOf((xs[i - 1] + x) / 2) : 0))
  for (let i = 1; i < xs.length; i++) moving[stepStage[i]] += raw[i] - raw[i - 1]
  const paused = stages.map(() => 0)
  pauseAt.forEach((x, k) => (paused[stageOf(x)] += squeezedS[k]))
  const keep = (target: number, pausedS: number, movingS: number) => (movingS > 0 ? Math.max(target - pausedS, MIN_STAGE_MOVING_SHARE * target) / movingS : 1)
  const unset = stages.flatMap((s, k) => (s.durationS === undefined ? [k] : []))
  const sum = (ks: readonly number[], of: readonly number[]) => ks.reduce((t, k) => t + of[k], 0)
  const share = (durationS * unset.reduce((t, k) => t + stages[k].toM - stages[k].fromM, 0)) / lengthM
  const unsetScale = keepDuration ? keep(share, sum(unset, paused), sum(unset, moving)) : 1
  const scales = stages.map((s, k) => (s.durationS === undefined ? unsetScale : keep(s.durationS, paused[k], moving[k])))
  const u = new Float64Array(xs.length)
  for (let i = 1; i < xs.length; i++) u[i] = u[i - 1] + (raw[i] - raw[i - 1]) * scales[stepStage[i]]
  return u
}

/**
 * Pacing of the flight with the given pauses (`stops`, sorted by position), speed portions (`speeds`, not overlapping)
 * and speed keys (`curve`). The identity pacing without length, or without pause, portion nor key.
 *
 * `stages` with a `durationS` give those stages a duration of their own: each flies that long (with `keepDuration`, as the
 * others share `durationS` in proportion to their length), and the film grows or shrinks by the difference. Without one
 * stage set, nothing changes.
 */
export function flightPacing(
  lengthM: number,
  durationS: number,
  settings: PacingSettings,
  stops: readonly FlightStop[],
  speeds: readonly FlightSpeed[] = [],
  curve?: SpeedCurve,
  stages: readonly FlightStage[] = [],
): Pacing {
  const L = lengthM
  if (!(L > 0) || !(durationS > 0)) return identityPacing(durationS > 0 ? durationS : 1)
  const ramps = speedRamps(speeds, L, (settings.transitionS * L) / durationS)
  const timed = stages.length > 0 && stages.some((s) => s.durationS !== undefined)
  if (stops.length === 0 && ramps.length === 0 && !curve && !timed) return identityPacing(durationS)
  const pauseAt = stops.map((s) => clamp(s.atM, 0, L))
  const xs = distanceGrid(L, pauseAt, ramps, curve, timed ? stages.map((s) => s.fromM) : [])

  // moving time at ×1 before scaling: speed v0 · r · m (midpoint) on each step
  const n = xs.length
  const raw = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const mid = (xs[i - 1] + xs[i]) / 2
    const r = speedMultiplier(mid, ramps) * (curve ? curve.at(mid) : 1)
    raw[i] = raw[i - 1] + ((xs[i] - xs[i - 1]) * durationS) / (L * r)
  }

  // pause lengths (capped with keepDuration) and the scale of the moving time that keeps the film at durationS;
  // the extra pauses (nights) lengthen the film instead
  const moving = raw[n - 1]
  const wanted = stops.reduce((sum, s) => sum + (s.extra ? 0 : s.durationS), 0)
  const share = settings.keepDuration && wanted > 0 ? Math.min(1, (MAX_PAUSE_SHARE * durationS) / wanted) : 1
  const pauseS = stops.map((s) => (s.extra ? s.durationS : s.durationS * share))
  /** time added by the pauses before pause k (`added[k]`), and by all of them (`added[pauseS.length]`) */
  const added = [0]
  let squeezed = 0
  pauseS.forEach((p, k) => {
    added.push(added[k] + p)
    if (!stops[k].extra) squeezed += p
  })
  const scale = settings.keepDuration ? (durationS - squeezed) / moving : 1

  const xTable = Float64Array.from(xs)
  const uTable = timed ? stagedMovingTime(stages, xs, raw, L, durationS, settings.keepDuration, pauseAt, stops.map((s, k) => (s.extra ? 0 : pauseS[k]))) : raw.map((u) => u * scale)
  const U = uTable[n - 1]

  // pauses: moving time of the paused node, eases limited by the neighbours and the ends
  const pu = pauseAt.map((x) => uTable[lastIndexAtOrBelow(xTable, x)])
  const ease = pu.map((u, k) =>
    Math.min(settings.transitionS, pauseS[k], 2 * u, 2 * (U - u), k > 0 ? u - pu[k - 1] : Infinity, k < pu.length - 1 ? pu[k + 1] - u : Infinity),
  )
  /** film time at which each pause starts easing in, and its moving time then */
  const startT = pu.map((u, k) => u - ease[k] / 2 + added[k])
  const startU = pu.map((u, k) => u - ease[k] / 2)
  const total = U + added[pauseS.length]

  const progressOfU = (u: number) => clamp(interpolate(uTable, xTable, u) / L, 0, 1)
  const uOfProgress = (progress: number) => interpolate(xTable, uTable, clamp(progress, 0, 1) * L)

  /** moving time at film time `tS`: the film time minus the pauses passed, eased around each pause */
  const movingTimeAt = (tS: number): number => {
    const t = clamp(tS, 0, total)
    const k = lastIndexAtOrBelow(startT, t)
    if (k < 0) return t
    const e = ease[k]
    const hold = pauseS[k] - e
    const s = t - startT[k]
    if (s < e) return startU[k] + easeIn(s, e)
    if (s < e + hold) return pu[k]
    if (s < 2 * e + hold) return pu[k] + easeOut(s - e - hold, e)
    return t - added[k + 1]
  }

  const timeAtProgress = (progress: number): number => {
    if (progress >= 1) return total
    const u = uOfProgress(progress)
    let k = lastIndexAtOrBelow(startU, u)
    if (k < 0) return u
    // pauses at the same place: the first one is reached first
    while (k > 0 && startU[k - 1] === u) k--
    const e = ease[k]
    const d = u - startU[k]
    if (d <= e / 2) return startT[k] + (d >= e / 2 ? e : invertEase(easeIn, d, e))
    if (d < e) return startT[k] + pauseS[k] + invertEase(easeOut, d - e / 2, e)
    return u + added[k + 1]
  }

  const progressAtTime = (tS: number) => progressOfU(movingTimeAt(tS))

  return {
    active: true,
    pauses: pauseAt.map((x, k) => ({
      progress: x / L,
      startS: startT[k],
      holdStartS: startT[k] + ease[k],
      holdEndS: startT[k] + pauseS[k],
      endS: startT[k] + pauseS[k] + ease[k],
      durationS: pauseS[k],
    })),
    totalTime: () => total,
    progressAtTime,
    timeAtProgress,
    positionAt: (progress) => ({ timeS: timeAtProgress(progress), progress }),
    advance: (from, dtS, speed) => {
      const timeS = clamp(from.timeS + dtS * speed, 0, total)
      return { timeS, progress: progressAtTime(timeS) }
    },
  }
}
