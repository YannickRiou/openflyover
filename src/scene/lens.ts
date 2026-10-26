/** « Objectif » setting (`settings.lens`) and the pure parts of its effects (ARCHITECTURE.md, « Objectif »). */
import { withDefaults } from '../core/guards'
import { clamp } from '../core/math'
import type { FilmClock } from '../film/clock'
import { DEFAULT_FOCAL_MM, focalDolly } from '../flyover/cameraSettings'

export interface LensSettings {
  /** motion blur: fraction of the frame interval the shutter stays open, 0 (off) .. 1 */
  shutter: number
  /** bloom amount, 0 (off) .. 1 */
  bloom: number
  /** bloom radius, 0 (tight) .. 1 (wide) */
  bloomRadius: number
  /** lens flare amount when the sun is in the frame, 0 (off) .. 1 (atmosphere only) */
  flare: number
  /** depth of field amount, 0 (off) .. 1: sharp on the marker, blurred in front of and behind it */
  depthOfField: number
}

export const DEFAULT_LENS: LensSettings = { shutter: 0, bloom: 0, bloomRadius: 0.6, flare: 0, depthOfField: 0 }

/** Slider bounds of each value (also the validation of saved projects). */
export const LENS_RANGES: Record<keyof LensSettings, { min: number; max: number; step: number }> = {
  shutter: { min: 0, max: 1, step: 0.05 },
  bloom: { min: 0, max: 1, step: 0.05 },
  bloomRadius: { min: 0, max: 1, step: 0.05 },
  flare: { min: 0, max: 1, step: 0.05 },
  depthOfField: { min: 0, max: 1, step: 0.05 },
}

const LENS_KEYS = Object.keys(LENS_RANGES) as (keyof LensSettings)[]

export function isValidLens(v: LensSettings): boolean {
  return LENS_KEYS.every((key) => v[key] >= LENS_RANGES[key].min && v[key] <= LENS_RANGES[key].max)
}

/** Fields added after a project was saved take their default. */
export const withLensDefaults = withDefaults(DEFAULT_LENS)

/** True when an effect of the lens is on (the flare only counts with the atmosphere): a composer is needed. */
export function lensActive(lens: LensSettings, atmosphere: boolean): boolean {
  return lens.shutter > 0 || lens.bloom > 0 || lens.depthOfField > 0 || (atmosphere && lens.flare > 0)
}

// ---------------------------------------------------------------------------
// Effect parameters
// ---------------------------------------------------------------------------

/** Bloom: linear luminance (after the tone mapping) above which the image glows: sun, snow, glittering water. */
export const BLOOM_THRESHOLD = 0.6
export const BLOOM_SMOOTHING = 0.3
const BLOOM_MAX_INTENSITY = 2.5

export function bloomParams(amount: number, radius: number): { intensity: number; radius: number } {
  return { intensity: BLOOM_MAX_INTENSITY * clamp(amount, 0, 1), radius: 0.2 + 0.75 * clamp(radius, 0, 1) }
}

/** Bokeh scale (pixels at the 1080p reference) at amount 1. */
const DOF_MAX_BOKEH = 6
/** Distance from the focus, as a fraction of it, at which the blur is full (amount 0 and 1), with the default lens. */
const DOF_RANGE = { weak: 2, strong: 0.5 }

/**
 * With « Focale » the camera stands `focalDolly` times as far for the same framing: the range is divided by as much, so
 * the depth kept sharp is the same in metres, as with a real lens (a telephoto blurs the far mountains more, a wide
 * angle less).
 */
export function depthOfFieldParams(amount: number, focusM: number, focalMm = DEFAULT_FOCAL_MM): { focusRange: number; bokehScale: number } {
  const a = clamp(amount, 0, 1)
  return {
    focusRange: (Math.max(1, focusM) * (DOF_RANGE.weak + (DOF_RANGE.strong - DOF_RANGE.weak) * a)) / focalDolly(focalMm),
    bokehScale: DOF_MAX_BOKEH * a,
  }
}

// ---------------------------------------------------------------------------
// Motion blur
// ---------------------------------------------------------------------------

/**
 * Most renders averaged per exported frame with the shutter open (the clouds share their noise slices among them);
 * fewer when the view barely moves (`subFrameCount`).
 */
export const SHUTTER_SUBFRAMES = 8
/** Largest step (pixels of the video frame) between two consecutive renders of a frame: the average still reads as a blur. */
export const SHUTTER_STEP_PX = 1
/** Nearest relief the motion estimate guards against, as a fraction of the aim distance (a ridge a quarter of the way). */
const NEAR_FRACTION = 0.25

export interface ShutterSample {
  progress: number
  timeS: number
}

/** `values` at the fractional frame index `f` (linear between neighbouring frames, clamped to the film). */
function valueAt(values: readonly number[], f: number): number {
  const last = values.length - 1
  const x = clamp(f, 0, last)
  const i = Math.floor(x)
  const t = x - i
  return t === 0 ? values[i] : values[i] + (values[Math.min(i + 1, last)] - values[i]) * t
}

/**
 * `count` renders of frame `index`, stratified over ± shutter / 2 frame intervals around it. An instant that `keep`
 * rejects (other side of a cut) is replaced by the frame itself.
 */
export function shutterSamples(
  times: readonly number[],
  progress: readonly number[],
  index: number,
  shutter: number,
  count: number,
  keep: (timeS: number) => boolean = () => true,
): ShutterSample[] {
  const own = { progress: progress[index], timeS: times[index] }
  const s = clamp(shutter, 0, 1)
  if (s === 0 || count <= 1) return [own]
  const samples: ShutterSample[] = []
  for (let j = 0; j < count; j++) {
    const f = index + s * ((j + 0.5) / count - 0.5)
    const timeS = valueAt(times, f)
    samples.push(keep(timeS) ? { progress: valueAt(progress, f), timeS } : own)
  }
  return samples
}

/** A point or a direction (a three.js Vector3 fits). */
interface Point3 {
  x: number
  y: number
  z: number
}

/** Camera placement and marker of the film at one instant of the shutter. */
export interface ShutterView {
  position: Point3
  target: Point3
  marker: Point3
}

const minus = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const plus = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const scaled = (a: Point3, k: number): Point3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const unit = (a: Point3): Point3 => scaled(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1))

/** Axes of a camera looking from `position` to `target`, level (y up), like `lookAt`. */
function cameraAxes({ position, target }: ShutterView) {
  const forward = unit(minus(target, position))
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }))
  // looking straight up or down: any horizontal axis
  const level = Math.hypot(right.x, right.y, right.z) > 0 ? right : { x: 1, y: 0, z: 0 }
  return { forward, right: level, up: cross(level, forward) }
}

/**
 * Largest distance (pixels of a video frame `heightPx` high) a point of the scene moves on screen between the cameras
 * of `a` and `b`: the marker (which moves itself), and fixed points of the relief seen at the four corners and the
 * centre, at the aim distance and, as the worst case of the parallax, a quarter of it (`NEAR_FRACTION`). Translation and
 * rotation both count; a point that ends up behind the camera counts as infinite.
 */
export function viewMotionPx(a: ShutterView, b: ShutterView, heightPx: number, aspect: number, fovDeg: number): number {
  const half = heightPx / 2
  const focal = half / Math.tan((fovDeg * Math.PI) / 360)
  const from = cameraAxes(a)
  const to = cameraAxes(b)
  const project = (v: ShutterView, axes: typeof from, p: Point3) => {
    const d = minus(p, v.position)
    const z = dot(d, axes.forward)
    return z > 1e-3 ? { x: (dot(d, axes.right) / z) * focal, y: (dot(d, axes.up) / z) * focal } : null
  }
  let worst = 0
  const marker = [project(a, from, a.marker), project(b, to, b.marker)]
  if (marker[0] && marker[1]) worst = Math.hypot(marker[1].x - marker[0].x, marker[1].y - marker[0].y)
  const aimM = Math.max(1, Math.hypot(a.target.x - a.position.x, a.target.y - a.position.y, a.target.z - a.position.z))
  for (const depth of [aimM, NEAR_FRACTION * aimM]) {
    for (const [sx, sy] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = sx * half * aspect
      const y = sy * half
      // the point seen at (x, y) from `a`, `depth` away along the view axis
      const across = plus(scaled(from.right, (x / focal) * depth), scaled(from.up, (y / focal) * depth))
      const point = plus(plus(a.position, scaled(from.forward, depth)), across)
      const moved = project(b, to, point)
      worst = moved ? Math.max(worst, Math.hypot(moved.x - x, moved.y - y)) : Infinity
    }
  }
  return worst
}

/**
 * Renders of a frame needed for the blur to look like the `max` (`SHUTTER_SUBFRAMES`, or fewer for a lighter export
 * quality) of a full one, from the on-screen motion (`viewMotionPx`) between the first and the last of those: the
 * shutter window is max / (max - 1) of it, and its evenly spaced renders are at most `SHUTTER_STEP_PX` apart. 1 when
 * the view stands still (no blur to render).
 */
export function subFrameCount(spanPx: number, max = SHUTTER_SUBFRAMES): number {
  if (max < 2) return 1
  const windowPx = (spanPx * max) / (max - 1)
  // an estimate that failed (NaN) keeps the full blur
  return windowPx >= 0 ? clamp(Math.ceil(windowPx / SHUTTER_STEP_PX), 1, max) : max
}

/** Frame the motion is measured on: height in pixels, width / height, vertical field of view in degrees. */
export interface ShutterScreen {
  heightPx: number
  aspect: number
  fovDeg: number
}

/**
 * Renders of frame `index` with the shutter open: `max` of them (`shutterSamples`; `SHUTTER_SUBFRAMES`, or fewer for a
 * lighter export quality), fewer when the view barely moves over the shutter. `viewOf` places the film at a render (without the terrain loaded, so that the count
 * is the same on every run). A function of the film time alone.
 */
export function adaptiveShutterSamples(
  times: readonly number[],
  progress: readonly number[],
  index: number,
  shutter: number,
  viewOf: (sample: ShutterSample) => ShutterView,
  screen: ShutterScreen,
  keep?: (timeS: number) => boolean,
  max = SHUTTER_SUBFRAMES,
): ShutterSample[] {
  const full = shutterSamples(times, progress, index, shutter, max, keep)
  if (full.length < 2) return full
  const span = viewMotionPx(viewOf(full[0]), viewOf(full[full.length - 1]), screen.heightPx, screen.aspect, screen.fovDeg)
  const count = subFrameCount(span, max)
  return count < full.length ? shutterSamples(times, progress, index, shutter, count, keep) : full
}

/**
 * Weight of the previous output in the preview trail: the lag of the exponential average, Δt · w / (1 − w), matches
 * the centre of the exported shutter (shutter / fps / 2) at any preview frame rate.
 */
export function previewShutterWeight(shutter: number, fps: number, deltaS: number): number {
  const lagS = (clamp(shutter, 0, 1) / Math.max(1, fps)) / 2
  if (lagS <= 0 || !(deltaS > 0)) return 0
  return lagS / (deltaS + lagS)
}

/**
 * Radial mask shared by the three parts of the motion blur (radial streaks, export sub-frames, preview trail): 0 in
 * the centre (sharp inside `RADIAL_MASK_START`), 1 in the farthest corner; `r` is the distance to the centre of
 * travel over the distance to the farthest corner. `shutterEffect.ts` has the GLSL twin.
 */
export const RADIAL_MASK_START = 0.3
export function radialMask(r: number): number {
  const t = clamp((r - RADIAL_MASK_START) / (1 - RADIAL_MASK_START), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Spread (fraction of the shutter window) of the sub-frames that make up the centre of the export frame. */
export const SHUTTER_CENTRE_SIGMA = 0.05

/**
 * Weight of each of the `count` sub-frames at the centre of the frame (where the mask is 0): a narrow bell around the
 * frame instant, so the centre is the frame itself (the two middle sub-frames when `count` is even). Further out the
 * weight goes to 1 with the mask: `mix(weight, 1, mask)`.
 */
export function shutterCentreWeights(count: number): number[] {
  if (count <= 1) return [1]
  return Array.from({ length: count }, (_, j) => {
    const offset = (j + 0.5) / count - 0.5
    return Math.exp(-0.5 * (offset / SHUTTER_CENTRE_SIGMA) ** 2)
  })
}

/**
 * Weight of the running mean when sub-frame `index` joins it, where the mask is `mask`: W(index - 1) / W(index), W the
 * cumulative sum of `mix(centre[i], 1, mask)`. CPU twin of the shader's loop, which cannot be unit tested.
 */
export function shutterHistoryWeight(centre: readonly number[], index: number, mask: number): number {
  let before = 0
  let total = 0
  for (let i = 0; i <= index; i++) {
    const w = centre[i] + (1 - centre[i]) * mask
    if (i < index) before += w
    total += w
  }
  return before / total
}

/** Radial speed blur: streak length (fraction of the distance to the centre) per unit of relative speed (1/s). */
const RADIAL_GAIN_S = 0.1
const RADIAL_MAX = 0.15
/** Below this relative speed (1/s) the camera counts as still: no radial blur. */
const RADIAL_MIN_SPEED = 0.02

/**
 * Length of the radial speed blur, from the camera placements of the film `intervalS` apart: the camera moved
 * `movedM` while aiming `aimDistanceM` away, so the scene sweeps the frame at movedM / aimDistanceM per interval.
 */
export function radialBlurLength(shutter: number, movedM: number, aimDistanceM: number, intervalS: number): number {
  // a jump longer than the aim distance in one interval is a cut (stage, leader), not a move
  if (!(intervalS > 0) || movedM > aimDistanceM) return 0
  const speed = movedM / Math.max(1, aimDistanceM) / intervalS
  return speed < RADIAL_MIN_SPEED ? 0 : clamp(shutter, 0, 1) * Math.min(RADIAL_MAX, RADIAL_GAIN_S * speed)
}

/** Sub-frame being rendered by the export: `index` of `count` (count 1: no motion blur). */
export interface ShutterSubFrame {
  index: number
  count: number
}

let subFrame: ShutterSubFrame = { index: 0, count: 1 }

/** Set by the export before each render of a motion-blurred frame, back to { 0, 1 } afterwards. */
export function setShutterSubFrame(index: number, count: number): void {
  subFrame = { index, count }
}

export function shutterSubFrame(): ShutterSubFrame {
  return subFrame
}

/**
 * The cloud noise slices of a frame split among its sub-frames, so the blur does not multiply their cost: every slice
 * is used once whatever the number of sub-frames (the first ones take the remainder).
 */
export function subFrameSlices(slices: number, { index, count }: ShutterSubFrame): { first: number; count: number } {
  const per = Math.floor(slices / Math.max(1, count))
  if (per < 1) return { first: index, count: 1 }
  const extra = slices - per * count
  return { first: index * per + Math.min(index, extra), count: per + (index < extra ? 1 : 0) }
}

/** `aS` and `bS` belong to the same continuous shot: same phase and no stage cut « À la suite » between them. */
export function sameShot(clock: FilmClock, aS: number, bS: number): boolean {
  const [from, to] = aS <= bS ? [aS, bS] : [bS, aS]
  return clock.stateAt(aS).phase === clock.stateAt(bS).phase && !clock.cuts.some((c) => c.timeS > from && c.timeS <= to)
}
