/**
 * Flyover camera: the view (camera position, look-at target = marker) as a pure function of the progress, the film
 * time, the camera settings and the terrain sampler. No frame-to-frame state, so the video export can render any frame
 * on its own. Styles and the steady-heights scheme: ARCHITECTURE.md "Flyover".
 *
 * Each style places the camera on a sphere around the aim point, then raises it to keep MIN_GROUND_CLEARANCE_M above the
 * smoothed ground and the sight line above the relief. The heights are read from terrain samples that stay put while
 * the marker moves, so the camera follows the relief without riding each bump. The time-based motions (orbit, cinematic
 * swing) follow the film time, so they keep moving while the pacing holds the progress.
 */
import { Vector3 } from 'three'
import { clamp, lastIndexAtOrBelow, smootherstep } from '../core/math'
import type { LocalFrame } from '../core/types'
import type { HeightSampler } from '../scene/trackLineSet'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S, turnSmoothingM, type CameraSettings, type CameraStyle } from './cameraSettings'
import { pathHeightM } from './flights'
import { samplePath, type TrackPath } from './path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Automatic camera distance = this fraction of the track, clamped; times the `distance` setting. */
export const CHASE_DISTANCE_FRACTION = 0.04
export const CHASE_DISTANCE_MIN_M = 600
export const CHASE_DISTANCE_MAX_M = 4_000
/** Pitch limits whatever the settings: under 2° the sight line grazes the relief, at 90° lookAt is undefined. */
export const PITCH_MIN_DEG = 2
export const PITCH_MAX_DEG = 88
/** The camera never goes closer than this to the smoothed (exaggerated) ground below it (metres). */
export const MIN_GROUND_CLEARANCE_M = 80
/** Whatever the smoothing, the camera never goes closer than this to the actual (exaggerated) terrain below it. */
export const MIN_TERRAIN_CLEARANCE_M = 40
/** The clearance floor takes over from the free height over this band (smooth maximum, at most a quarter above). */
export const CLEARANCE_EASE_M = 80
/**
 * Ground smoothing radius = this fraction of the heading window, at most GROUND_WINDOW_MAX_M:
 * the aim height is the tent-weighted mean of the terrain along the track over ± this radius, and the clearance
 * rules read the terrain on a grid of this cell size. Scaled like the heading window, so with the track length and
 * the marker's step per frame: a frame slides the weights by the same small share (37.5 m for a track under
 * 7.5 km at smoothing 1). Capped so a valley or a ridge narrower than a cell does not shift the ground much; the
 * tracks that reach the cap (over 30 km) are seen from 1.2 km or more, where a few metres of bobbing no longer show.
 */
export const GROUND_WINDOW_FRACTION = 0.25
export const GROUND_WINDOW_MAX_M = 150
/** Aim height: terrain samples on each side of the marker, at multiples of radius / this along the track. */
export const GROUND_SAMPLES_PER_SIDE = 4
/**
 * Terrain samples along the sight line camera → marker (at its steady height, not its own: that rides each bump). The
 * clearance tapers from MIN_GROUND_CLEARANCE_M under the camera to LINE_OF_SIGHT_MIN_CLEARANCE_M (a safety margin: the
 * relief cuts the marker where it passes in front, `pullMarkerForward`), so a rise just before the marker no
 * longer hides it. The ground is the grid's raised by the relief its cells miss (`reliefGround`). The line is checked
 * up to LINE_OF_SIGHT_END_M
 * short of the marker (`lineOfSightClearance` leaves the slope under it out) and at most LINE_OF_SIGHT_MAX_GAIN × the
 * camera's distance short of it: a raise is the clearance gap divided by the share of the line left, so near the marker
 * the camera would ride every bump of the ground (the heading swing handles that slope, `swingAngle`).
 */
export const LINE_OF_SIGHT_SAMPLES = 48
export const LINE_OF_SIGHT_END_M = 100
export const LINE_OF_SIGHT_MIN_CLEARANCE_M = 20
export const LINE_OF_SIGHT_MAX_GAIN = 20
/**
 * Where a metre of ground lifts the camera by more than LINE_OF_SIGHT_FINE_GAIN metres (eased out up to twice that),
 * the line is checked against a coarse grid instead: cells of at least LINE_OF_SIGHT_COARSE_CELL_M, each corner the mean
 * of LINE_OF_SIGHT_COARSE_SAMPLES² terrain samples over a cell (the ground cell's grid when as coarse), the line ending on
 * that grid's ground at the marker (never above its steady height). A sharper tile arriving near the marker then
 * shifts the line's ground and its end alike, instead of being multiplied by up to LINE_OF_SIGHT_MAX_GAIN (#186: 6.3×
 * → 2.1× on the test hills). Nearer the camera, the ground cell's grid still clears a crest narrower than a coarse cell.
 */
export const LINE_OF_SIGHT_FINE_GAIN = 3
export const LINE_OF_SIGHT_COARSE_CELL_M = 150
export const LINE_OF_SIGHT_COARSE_SAMPLES = 2

/**
 * Smoothing scaled with the ground speed of the film (track length / flyover duration, metres per film second), so a
 * long track flown fast turns and climbs no faster than a short one: the heading is averaged over
 * ± HEADING_SMOOTHING_FACTOR × « Lissage de la caméra » film seconds of track, the aim point and the camera's point of
 * the track over at least POSITION_SMOOTHING_S (the corners of a sparse recording rounded off), and the ground cell is
 * at least GROUND_SPEED_S of track (at most GROUND_SPEED_MAX_M). With « Lissage de la caméra », the camera stands on the
 * track smoothed over a deviation of CAMERA_LINE_FACTOR × « Lissage de la caméra » film seconds (`cameraLine`: it does
 * not follow the zigzags and the GPS noise) and the aim on one AIM_LINE_SHARE as wide, at most AIM_LINE_MAX_SHARE of
 * the camera's distance (the marker stays near the middle of the frame).
 */
export const HEADING_SMOOTHING_FACTOR = 1.5
export const POSITION_SMOOTHING_S = 0.5
export const CAMERA_LINE_FACTOR = 0.2
export const AIM_LINE_SHARE = 0.5
export const AIM_LINE_MAX_SHARE = 0.06
export const GROUND_SPEED_S = 0.25
export const GROUND_SPEED_MAX_M = 500
/** The aim's height eases between the track's ground and the grid's over this band (smooth maximum). */
export const AIM_GROUND_EASE_M = 40
/** Fixed samples on each side of a smoothing window (weights sliding over them). */
export const SMOOTHING_SAMPLES_PER_SIDE = 8

/**
 * Heading swing (`swingAngle`): a slope rising from the marker toward the camera steeper than the camera's pitch hides
 * the marker. Climbing over it is allowed up to SWING_CLIMB_DEG above the style's pitch (less SWING_MARGIN of slope);
 * beyond, the camera turns around the marker toward the side the slope falls away, eased in over SWING_ONSET of excess
 * steepness. The slope is the ground's gradient over ± half the camera's ground distance (at least
 * SWING_SLOPE_BASELINE_M), averaged along the track like the heading, so the swing turns as calmly as the heading.
 */
export const SWING_CLIMB_DEG = 10
export const SWING_MARGIN = 0.05
export const SWING_SLOPE_BASELINE_M = 150
export const SWING_ONSET = 0.2

/** 'sway': swing (radians) = SWAY_MAX_RAD · tanh(SWAY_GAIN · turn / SWAY_MAX_RAD), turn measured over ±2w. */
export const SWAY_GAIN = 0.8
export const SWAY_MAX_RAD = (50 * Math.PI) / 180
/** 'top': farther and nearly vertical. */
export const TOP_DISTANCE_FACTOR = 2.5
export const TOP_MIN_PITCH_DEG = 70
/** 'cinematic': farther, half the pitch, calmer heading, slow lateral swing of the viewing direction. */
export const CINEMATIC_DISTANCE_FACTOR = 1.6
export const CINEMATIC_PITCH_FACTOR = 0.5
export const CINEMATIC_WINDOW_FACTOR = 2
export const CINEMATIC_SWING_RAD = (35 * Math.PI) / 180
export const CINEMATIC_PERIOD_S = 40

/**
 * « Espace devant »: the aim moves ahead along the smoothed travel direction, so the marker stands behind the middle of the
 * frame by `leadRoomPct` of half its height, whatever the camera's distance, pitch or viewing angle. Half the frame
 * height per metre of distance at the scene camera's field of view (CAMERA_FOV_DEG, filmCamera.ts imports this module).
 * Full once the marker moves at LEAD_FULL_SPEED of a flight's constant pace, eased out below it (a stop, a shot).
 * LEAD_SCREEN_FLOOR keeps the shift finite where travel is nearly along the line of sight at a low pitch (the same
 * ground shift moves the marker little on screen there, `leadRoom`).
 */
export const LEAD_HALF_FRAME_PER_M = Math.tan((50 * Math.PI) / 360)
export const LEAD_FULL_SPEED = 0.5
export const LEAD_PAN_PITCH_DEG = 45
export const LEAD_MOVE_PITCH_DEG = 75
export const LEAD_SCREEN_FLOOR = 0.2
/**
 * « Inclinaison dans les virages »: the camera rolls into a bend by `bankDeg` × tanh(turn rate / BANK_TURN_RATE_RAD_S), the
 * turn rate being that of the smoothed travel direction in film time, read over BANK_SPAN_SHARE of the heading window.
 * Proportional in a gentle bend, never more than `bankDeg`, and at 0 where the camera does not turn (a stop included).
 */
export const BANK_TURN_RATE_RAD_S = 0.15
export const BANK_SPAN_SHARE = 0.5

const DEG = Math.PI / 180
const NORTH = new Vector3(0, 0, -1)
/** Scratch vectors of the per-frame helpers (never returned). */
const _behind = new Vector3()
const _ahead = new Vector3()
const _sight = new Vector3()
const _corner = new Vector3()
const _sightEnd = new Vector3()

// ---------------------------------------------------------------------------
// Path measures
// ---------------------------------------------------------------------------

/** Heading window (half chord length) for `path` with the « Lissage des virages » of `camera`. */
export function headingWindowM(path: TrackPath, camera: CameraSettings): number {
  return turnSmoothingM(camera, path.lengthM) / 2
}

/** Automatic camera distance for `path`, before the distance multiplier. */
export function autoDistanceM(path: TrackPath): number {
  return clamp(path.lengthM * CHASE_DISTANCE_FRACTION, CHASE_DISTANCE_MIN_M, CHASE_DISTANCE_MAX_M)
}

/**
 * Horizontal unit direction of travel at `d`: the chord [d - w, d + w], wide enough to ignore GPS jitter and
 * switchbacks. North when the chord is shorter than 1 m (no motion).
 */
export function headingAt(path: TrackPath, d: number, w: number, frame: LocalFrame): Vector3 {
  const behind = samplePath(path, d - w)
  const ahead = samplePath(path, d + w)
  const a = frame.toLocal(behind.lon, behind.lat, 0, _behind)
  const b = frame.toLocal(ahead.lon, ahead.lat, 0, _ahead)
  const heading = new Vector3(b.x - a.x, 0, b.z - a.z)
  if (heading.lengthSq() < 1) return NORTH.clone()
  return heading.normalize()
}

/**
 * Weight of a sample `offset` from the centre of a window of radius `radius`: squared raised cosine, flat to the second
 * derivative at the edges, so a sample entering or leaving the window does not jolt the acceleration (0 outside).
 */
function bump(offset: number, radius: number): number {
  if (Math.abs(offset) >= radius) return 0
  const c = 0.5 + 0.5 * Math.cos((Math.PI * offset) / radius)
  return c * c
}

interface HeadingTable {
  step: number
  /** chord direction at k · step, unwrapped along the track (radians, atan2(x, -z): 0 = north, > 0 = east) */
  angle: Float64Array
  /** chord length there (metres): a short chord (U-turn, GPS star at a rest) counts less */
  chord: Float64Array
}

const headingTables = new WeakMap<TrackPath, WeakMap<LocalFrame, Map<string, HeadingTable>>>()

/**
 * Chord directions [s - w, s + w] at fixed steps along the track, unwrapped once for the whole path (each against the
 * last chord at least a quarter of 2w long), so an average over them turns through a U-turn instead of flipping.
 */
function headingTable(path: TrackPath, w: number, step: number, frame: LocalFrame): HeadingTable {
  let perFrame = headingTables.get(path)
  if (!perFrame) headingTables.set(path, (perFrame = new WeakMap()))
  let tables = perFrame.get(frame)
  if (!tables) perFrame.set(frame, (tables = new Map()))
  const key = `${w}:${step}`
  const cached = tables.get(key)
  if (cached) return cached
  const count = Math.ceil(path.lengthM / step) + 1
  const angle = new Float64Array(count)
  const chord = new Float64Array(count)
  let reference = Number.NaN
  for (let k = 0; k < count; k++) {
    const a = samplePath(path, k * step - w)
    const b = samplePath(path, k * step + w)
    const from = frame.toLocal(a.lon, a.lat, 0, _behind)
    const to = frame.toLocal(b.lon, b.lat, 0, _ahead)
    const x = to.x - from.x
    const z = to.z - from.z
    const raw = Math.atan2(x, -z)
    const unwrapped = Number.isNaN(reference) ? raw : reference + Math.atan2(Math.sin(raw - reference), Math.cos(raw - reference))
    angle[k] = unwrapped
    chord[k] = Math.hypot(x, z)
    if (chord[k] >= w / 2 || Number.isNaN(reference)) reference = unwrapped
  }
  if (tables.size > 16) tables.clear()
  const table = { step, angle, chord }
  tables.set(key, table)
  return table
}

/**
 * Travel direction at `d` (`headingAt`) averaged along the track over ± `radiusM`: `bump` weights times the chord
 * length, over the unwrapped chord directions of `headingTable` (radians, atan2(x, -z)). Continuous, as is its turn rate.
 */
function smoothAngleAt(path: TrackPath, d: number, w: number, radiusM: number, frame: LocalFrame): number {
  const { step, angle, chord } = headingTable(path, w, radiusM / SMOOTHING_SAMPLES_PER_SIDE, frame)
  let sum = 0
  let weight = 0
  const last = angle.length - 1
  for (let k = Math.floor((d - radiusM) / step) + 1; k * step < d + radiusM; k++) {
    const i = clamp(k, 0, last)
    const wk = bump(k * step - d, radiusM) * (chord[i] + 1e-3 * w)
    sum += wk * angle[i]
    weight += wk
  }
  return weight > 0 ? sum / weight : angle[clamp(Math.round(d / step), 0, last)]
}

/** `headingAt` averaged along the track over ± `radiusM` (`smoothAngleAt`); `headingAt` itself without a radius. */
export function smoothHeadingAt(path: TrackPath, d: number, w: number, radiusM: number, frame: LocalFrame): Vector3 {
  if (!(radiusM > 0)) return headingAt(path, d, w, frame)
  const heading = smoothAngleAt(path, d, w, radiusM, frame)
  return new Vector3(Math.sin(heading), 0, -Math.cos(heading))
}

/**
 * `smoothedTurn` over ± 2w from the averaged chord directions (`smoothAngleAt`): the direction w ahead minus the one w
 * behind, each averaged over ± `radiusM` (> 0 = to the right).
 */
function smoothTurnAt(path: TrackPath, d: number, w: number, radiusM: number, frame: LocalFrame): number {
  if (!(radiusM > 0)) return smoothedTurn(path, d, 2 * w)
  return smoothAngleAt(path, d + w, w, radiusM, frame) - smoothAngleAt(path, d - w, w, radiusM, frame)
}

/**
 * Point of the track (local frame, y = `heightM`) around `d`, averaged over ± `radiusM`: `bump` weights sliding
 * over samples at fixed distances, so the corners of the polyline are rounded off (continuous velocity). The point
 * at `d` without a radius.
 */
function smoothPointAt(path: TrackPath, d: number, radiusM: number, heightM: number, frame: LocalFrame): Vector3 {
  if (!(radiusM > 0)) return anchorAt(path, d, heightM, frame)
  const step = radiusM / SMOOTHING_SAMPLES_PER_SIDE
  let x = 0
  let z = 0
  let weight = 0
  for (let k = Math.floor((d - radiusM) / step) + 1; k * step < d + radiusM; k++) {
    const wk = bump(k * step - d, radiusM)
    const at = samplePath(path, clamp(k * step, 0, path.lengthM))
    const p = frame.toLocal(at.lon, at.lat, 0, _corner)
    x += wk * p.x
    z += wk * p.z
    weight += wk
  }
  const at = frame.toLonLat(_corner.set(x / weight, 0, z / weight))
  return frame.toLocal(at.lon, at.lat, heightM)
}

/** The track smoothed for the camera to stand on (`cameraLine`): points every `step` metres of track, local frame. */
interface CameraLine {
  step: number
  x: Float64Array
  z: Float64Array
}

const cameraLines = new WeakMap<TrackPath, WeakMap<LocalFrame, Map<number, CameraLine>>>()

/**
 * Moving average of `values` over 2h + 1 entries, the table continued beyond its ends by point symmetry (a straight
 * end stays straight, its end point in place).
 */
function boxFilter(values: Float64Array, h: number): Float64Array {
  const n = values.length
  const last = n - 1
  const at = (i: number): number => {
    if (i < 0) return 2 * values[0] - values[Math.min(last, -i)]
    if (i > last) return 2 * values[last] - values[Math.max(0, 2 * last - i)]
    return values[i]
  }
  const out = new Float64Array(n)
  let sum = 0
  for (let i = -h; i <= h; i++) sum += at(i)
  for (let k = 0; k < n; k++) {
    out[k] = sum / (2 * h + 1)
    sum += at(k + h + 1) - at(k - h)
  }
  return out
}

/**
 * The track smoothed with a window of deviation `sigmaM` (three moving averages, close to a Gaussian), built once per
 * path, frame and window like `headingTable`: the exact mean of the polyline over ± `sigmaM` at fixed steps (every
 * recorded point counts, so the GPS noise between the steps cannot alias), then two moving averages of the table. The
 * track is continued beyond its ends by point symmetry, so its ends stay in place. No corner left to jolt the camera; a
 * bend is cut inside by about sigma² / (2 × its radius).
 */
function cameraLine(path: TrackPath, sigmaM: number, frame: LocalFrame): CameraLine {
  let perFrame = cameraLines.get(path)
  if (!perFrame) cameraLines.set(path, (perFrame = new WeakMap()))
  let lines = perFrame.get(frame)
  if (!lines) perFrame.set(frame, (lines = new Map()))
  const cached = lines.get(sigmaM)
  if (cached) return cached
  const { count, dist, lengthM } = path
  if (!(lengthM > 0)) {
    const p = frame.toLocal(path.lon[0], path.lat[0], 0, _corner)
    return { step: 1, x: Float64Array.of(p.x), z: Float64Array.of(p.z) }
  }
  // the recorded points in the local frame and the running integrals of x and z over the distance
  const vx = new Float64Array(count)
  const vz = new Float64Array(count)
  const ix = new Float64Array(count)
  const iz = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const p = frame.toLocal(path.lon[i], path.lat[i], 0, _corner)
    vx[i] = p.x
    vz[i] = p.z
    if (i === 0) continue
    const ds = dist[i] - dist[i - 1]
    ix[i] = ix[i - 1] + (ds * (vx[i] + vx[i - 1])) / 2
    iz[i] = iz[i - 1] + (ds * (vz[i] + vz[i - 1])) / 2
  }
  // ∫ over [0, s] of the track continued beyond its ends by point symmetry (like `boxFilter`)
  const integral = (values: Float64Array, sums: Float64Array, s: number): number => {
    if (s < 0) return integral(values, sums, Math.min(lengthM, -s)) - 2 * values[0] * -s
    if (s > lengthM) return integral(values, sums, Math.max(0, 2 * lengthM - s)) + 2 * values[count - 1] * (s - lengthM)
    if (s === lengthM) return sums[count - 1]
    const i = lastIndexAtOrBelow(dist, s)
    const ds = dist[i + 1] - dist[i]
    const end = values[i] + (values[i + 1] - values[i]) * (ds > 0 ? (s - dist[i]) / ds : 0)
    return sums[i] + ((s - dist[i]) * (values[i] + end)) / 2
  }
  // at most 100,000 steps, at least 8 per deviation
  const step = Math.max(sigmaM / 8, lengthM / 100_000, 1e-3)
  const n = Math.ceil(lengthM / step) + 1
  let x: Float64Array = new Float64Array(n)
  let z: Float64Array = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const a = k * step - sigmaM
    const b = k * step + sigmaM
    x[k] = (integral(vx, ix, b) - integral(vx, ix, a)) / (2 * sigmaM)
    z[k] = (integral(vz, iz, b) - integral(vz, iz, a)) / (2 * sigmaM)
  }
  // a box of ±sigma has a variance of sigma² / 3, as has each of the two moving averages of ±h steps
  const h = Math.max(1, Math.round(Math.sqrt(1 + (4 * sigmaM * sigmaM) / (step * step)) / 2 - 0.5))
  for (let pass = 0; pass < 2; pass++) {
    x = boxFilter(x, h)
    z = boxFilter(z, h)
  }
  // a few windows per path (camera and aim, a slider being dragged): up to 1.6 MB each
  if (lines.size > 4) lines.clear()
  const line = { step, x, z }
  lines.set(sigmaM, line)
  return line
}

/**
 * Point of the camera's line (`cameraLine`) at `d` (local frame, y = `heightM`): uniform Catmull-Rom between the table
 * points, so the camera's velocity has no break from one step to the next.
 */
function cameraLineAt(path: TrackPath, d: number, sigmaM: number, heightM: number, frame: LocalFrame): Vector3 {
  const { step, x, z } = cameraLine(path, sigmaM, frame)
  const last = x.length - 1
  const u = clamp(d, 0, path.lengthM) / step
  const k = Math.min(Math.floor(u), Math.max(0, last - 1))
  const t = Math.min(1, u - k)
  const spline = (v: Float64Array) => {
    const p0 = v[clamp(k - 1, 0, last)]
    const p1 = v[clamp(k, 0, last)]
    const p2 = v[clamp(k + 1, 0, last)]
    const p3 = v[clamp(k + 2, 0, last)]
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  }
  const at = frame.toLonLat(_corner.set(spline(x), 0, spline(z)))
  return frame.toLocal(at.lon, at.lat, heightM)
}

/**
 * Signed turn of the path around `d` (radians, > 0 = to the right, clockwise seen from above): the turning
 * angles of the vertices within ]d - window, d + window[ weighted by the tent max(0, 1 - |s - d| / window).
 * A vertex enters and leaves the window with a zero weight, so the result is continuous in `d`; GPS jitter and
 * switchback series (left, right, left…) cancel out. Zero-length steps (duplicates, segment joins) are skipped.
 */
export function smoothedTurn(path: TrackPath, d: number, window: number): number {
  const { count, lon, lat, dist } = path
  if (count < 3 || window <= 0) return 0
  const cosLat = Math.cos(lat[0] * DEG)

  // start one non-empty step before the window, for the direction coming into its first vertex
  let k = Math.max(0, lastIndexAtOrBelow(dist, d - window))
  while (k > 0 && dist[k] - dist[k - 1] <= 0) k--
  k = Math.max(0, k - 1)

  let total = 0
  let hasPrev = false
  let px = 0
  let py = 0
  for (; k < count - 1 && dist[k] < d + window; k++) {
    if (dist[k + 1] - dist[k] <= 0) continue
    // east / north components, planar approximation (only angles are used)
    const x = (lon[k + 1] - lon[k]) * cosLat
    const y = lat[k + 1] - lat[k]
    if (hasPrev) {
      const weight = 1 - Math.abs(dist[k] - d) / window
      // cross < 0 for a clockwise (right) turn in east / north axes
      if (weight > 0) total += weight * -Math.atan2(px * y - py * x, px * x + py * y)
    }
    px = x
    py = y
    hasPrev = true
  }
  return total
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface CameraView {
  /** look-at point, local frame (flight: above the marker, at the smoothed ground height) */
  target: Vector3
  position: Vector3
}

export interface FlightView extends CameraView {
  /** marker position on the draped track, local frame */
  marker: Vector3
  /** how far the clearance rules raised the camera (metres; 0 without terrain) */
  raiseM: number
  /** the aim point before « Espace devant » moved it ahead (`target` = this + the lead room): what the camera keys are placed around */
  aim: Vector3
  /** `target` for a camera that stands at `position` instead (the lead is meant on the screen, so it depends on the camera's height) */
  leadTarget: (position: Vector3) => Vector3
  /** roll of the camera about its line of sight (radians, > 0 = banking right: its up leans to the right, as in a right bend) */
  rollRad: number
}

export interface CameraViewOptions {
  exaggeration: number
  /** height of the marker above the ground (the track line lift) */
  liftM: number
  camera?: CameraSettings
  /** flyover duration at speed x1 (seconds): film time = progress × durationS when `timeS` is absent */
  durationS?: number
  /** film time (seconds at x1, pacing included) of the time-based motions (orbit, cinematic swing) */
  timeS?: number
  /** extra rotation of the viewing direction around the marker (radians, > 0 = right): orbit of a film stop */
  orbitRad?: number
  /** progress of the aim point (time smoothing, `timeSmoothing.ts`); the marker's when absent */
  aimProgress?: number
  /** progress the camera is placed from (place along the track, heading); the marker's when absent */
  cameraProgress?: number
  /** how fast the marker and the camera's point of the track move, as shares of a flight's constant pace (`motionShares`, `timeSmoothing.ts`); 1 each (steady flight) when absent */
  motion?: { marker: number; camera: number }
}

/** Styles whose view also moves with the film time (they keep moving during a pause of the pacing). */
export function movesWithTime(style: CameraStyle): boolean {
  return style === 'orbit' || style === 'cinematic'
}

/** Horizontal reference direction, viewing angle relative to it (radians, > 0 = right), pitch and distance. */
interface Placement {
  reference: Vector3
  viewAngle: number
  pitchDeg: number
  distance: number
}

function placement(
  path: TrackPath,
  d: number,
  timeS: number,
  frame: LocalFrame,
  camera: CameraSettings,
  durationS: number,
): Placement {
  const speedMps = path.lengthM / Math.max(1, durationS)
  const w = headingWindowM(path, camera)
  const radiusM = speedMps * camera.cameraSmoothingS * HEADING_SMOOTHING_FACTOR
  const travel = (at: number, window: number) => smoothHeadingAt(path, at, window, radiusM, frame)
  const distance = autoDistanceM(path) * camera.distance
  const offset = camera.headingOffsetDeg * DEG

  switch (camera.style) {
    case 'sway': {
      const turn = smoothTurnAt(path, d, w, radiusM, frame)
      // to the outside of the bend: a right turn swings the view to the right (camera on the left)
      const swing = SWAY_MAX_RAD * Math.tanh((SWAY_GAIN * turn) / SWAY_MAX_RAD)
      return { reference: travel(d, w), viewAngle: offset + swing, pitchDeg: camera.pitchDeg, distance }
    }
    case 'orbit':
      // absolute rotation from the start heading, independent of the bends of the track: `orbitTurns` full turns over
      // the flight at speed x1, whatever its duration
      return {
        reference: headingAt(path, 0, w, frame),
        viewAngle: offset + (2 * Math.PI * camera.orbitTurns * timeS) / Math.max(1, durationS),
        pitchDeg: camera.pitchDeg,
        distance,
      }
    case 'top':
      return {
        reference: camera.northUp ? NORTH.clone() : travel(d, w),
        viewAngle: offset,
        pitchDeg: Math.max(camera.pitchDeg, TOP_MIN_PITCH_DEG),
        distance: distance * TOP_DISTANCE_FACTOR,
      }
    case 'cinematic':
      return {
        reference: travel(d, w * CINEMATIC_WINDOW_FACTOR),
        viewAngle: offset + CINEMATIC_SWING_RAD * Math.sin((2 * Math.PI * timeS) / CINEMATIC_PERIOD_S),
        pitchDeg: camera.pitchDeg * CINEMATIC_PITCH_FACTOR,
        distance: distance * CINEMATIC_DISTANCE_FACTOR,
      }
    case 'chase':
    default:
      return { reference: travel(d, w), viewAngle: offset, pitchDeg: camera.pitchDeg, distance }
  }
}

/**
 * Camera view at `progress` along `path` and film time `options.timeS`: looks at the aim point from `distance` away
 * at `pitch` above the horizon, then raised (pitch steepens) to stay MIN_GROUND_CLEARANCE_M above the smoothed terrain
 * (MIN_TERRAIN_CLEARANCE_M above the actual one) and until the sight line to the marker clears the terrain between,
 * turned around the marker first when the slope there is too steep to climb over (`swingAngle`).
 * Aim = the track at the aim's progress, smoothed (`cameraLine`, `smoothPointAt` without « Lissage de la caméra »), at
 * the smoothed ground height (`trackGround` eased with `smoothGridGround`) + `liftM`; the camera stands around its own
 * smoothed point of the track. Heights: `trackHeightM` (terrain sample, else recorded elevation, else 0; the recorded
 * one in a flight); times `exaggeration`. `aimProgress` / `cameraProgress`: see `timeSmoothing.ts`.
 */
export function computeCameraView(
  path: TrackPath,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: CameraViewOptions,
): FlightView {
  const { exaggeration, liftM, camera = DEFAULT_CAMERA, durationS = DEFAULT_FLYOVER_DURATION_S } = options
  const p = clamp(progress, 0, 1)
  const timeS = options.timeS ?? p * durationS
  const d = p * path.lengthM

  const at = samplePath(path, d)
  const marker = frame.toLocal(at.lon, at.lat, pathHeightM(path, d, at, sample) * exaggeration + liftM)
  // time smoothing: the aim and the camera may follow their own progress along the track
  const dAim = options.aimProgress === undefined ? d : clamp(options.aimProgress, 0, 1) * path.lengthM
  const dCamera = options.cameraProgress === undefined ? d : clamp(options.cameraProgress, 0, 1) * path.lengthM
  const speedMps = path.lengthM / Math.max(1, durationS)
  const pointRadiusM = (speedMps * POSITION_SMOOTHING_S) / 2
  // with « Lissage de la caméra », the camera stands on its own smoothed line and the aim on a shorter one (AIM_LINE_SHARE
  // of it, at most AIM_LINE_MAX_SHARE of the camera's distance: the marker stays near the middle of the frame); never
  // less than the corners' rounding (`bump` over ± pointRadiusM, a deviation of 0.28 × pointRadiusM)
  const pointSigmaM = 0.28 * pointRadiusM
  const lineSigmaM = Math.max(CAMERA_LINE_FACTOR * camera.cameraSmoothingS * speedMps, pointSigmaM)
  const aimSigmaM = Math.max(Math.min(lineSigmaM * AIM_LINE_SHARE, autoDistanceM(path) * camera.distance * AIM_LINE_MAX_SHARE), pointSigmaM)
  const smoothLine = camera.cameraSmoothingS > 0
  const aim = smoothLine ? cameraLineAt(path, dAim, aimSigmaM, 0, frame) : smoothPointAt(path, dAim, pointRadiusM, 0, frame)
  const cellM = Math.max(
    Math.min(headingWindowM(path, camera) * GROUND_WINDOW_FRACTION, GROUND_WINDOW_MAX_M),
    Math.min(speedMps * GROUND_SPEED_S, GROUND_SPEED_MAX_M),
  )
  // steady ground height (exaggerated) at the point `p` of the track at `dist`
  const steadyGround = (dist: number, p: Vector3) => {
    const alongTrack = trackGround(path, dist, cellM, sample)
    const grid = sample ? smoothGridGround(p.x, p.z, cellM, frame, sample) : undefined
    return (grid === undefined ? alongTrack : smoothMax(alongTrack, grid, AIM_GROUND_EASE_M)) * exaggeration
  }
  const aimGround = steadyGround(dAim, aim)
  const aimAt = frame.toLonLat(aim)
  const target = frame.toLocal(aimAt.lon, aimAt.lat, aimGround + liftM)

  const place = placement(path, dCamera, timeS, frame, camera, durationS)
  place.viewAngle += options.orbitRad ?? 0
  if (sample) {
    const slopeRadiusM = Math.max(speedMps * camera.cameraSmoothingS * HEADING_SMOOTHING_FACTOR, headingWindowM(path, camera))
    const baselineM = Math.max(SWING_SLOPE_BASELINE_M, (place.distance * Math.cos(clamp(place.pitchDeg, PITCH_MIN_DEG, PITCH_MAX_DEG) * DEG)) / 2)
    place.viewAngle += swingAngle(place, trackSlope(path, d, slopeRadiusM, baselineM, frame, sample, exaggeration))
  }
  // placed around its own point of the track, at the aim's height
  const from = smoothLine
    ? cameraLineAt(path, dCamera, lineSigmaM, aimGround + liftM, frame)
    : dCamera === dAim
      ? target
      : smoothPointAt(path, dCamera, pointRadiusM, aimGround + liftM, frame)
  // the aim moves ahead (and the camera with it, as far as `leadRoom` says): the marker falls back in the frame; the
  // clearance rules below place the camera where it ends up
  const motion = options.motion ?? { marker: 1, camera: 1 }
  const travel = smoothHeadingAt(path, dCamera, headingWindowM(path, camera), speedMps * camera.cameraSmoothingS * HEADING_SMOOTHING_FACTOR, frame)
  const position = positionAround(from, place)
  const lead = leadRoom(target.clone().sub(position), travel, camera, motion.marker)
  position.add(lead.camera)
  const freeY = position.y
  if (sample) {
    // the sight line ends at the marker, at its steady height (its own rides each bump)
    const endGround = dAim === d && !smoothLine ? aimGround : steadyGround(d, marker)
    position.y = lowestClearY(position, frame.toLocal(at.lon, at.lat, endGround + liftM, _sightEnd), frame, sample, exaggeration, cellM, liftM)
  }
  // the aim moves by what the camera needs where it stands (the film moves it again once it has set its height)
  const leadTarget = (at: Vector3) => target.clone().add(leadRoom(target.clone().sub(at).add(lead.camera), travel, camera, motion.marker).target)
  const rollRad = bankRad(path, dCamera, timeS, frame, camera, durationS, motion.camera)
  return { target: leadTarget(position), aim: target, leadTarget, position, marker, raiseM: position.y - freeY, rollRad }
}

/**
 * « Espace devant »: how far the aim moves ahead along `travel` and how far the camera goes with it (horizontal vectors,
 * local frame), so that the marker, which stays where it is, falls back from the middle of the frame by `leadRoomPct`
 * of half the frame height (toward the side of the screen the travel leaves it) once it moves (`markerShare`,
 * LEAD_FULL_SPEED); `sight` is the vector from the camera to the aim. Below LEAD_PAN_PITCH_DEG the camera stays put and
 * turns to its new aim (the sight line to the marker and the clearances are what they were); from LEAD_MOVE_PITCH_DEG it
 * moves with it (a near-vertical view turned toward an aim just beside it would swing round); in between the share
 * `move` of the shift is the camera's.
 *
 * Solved exactly: with `d` the camera's distance from the aim, `u` = shift / d, `f` the unit forward and `t` the travel,
 * the marker is at d·f − move·u·d·t from the camera and the axis along d·f + (1 − move)·u·d·t, so the tangent of the angle
 * between them is u·|f × t| / (1 + (1 − 2·move)·u·f·t − move·(1 − move)·u²) and must be `leadRoomPct` of tan(fov / 2).
 * No lead in 'orbit', whose view turns round the marker whatever the way it is heading.
 */
function leadRoom(sight: Vector3, travel: Vector3, { style, leadRoomPct }: CameraSettings, markerShare: number): { target: Vector3; camera: Vector3 } {
  const distance = sight.length()
  if (style === 'orbit' || !(leadRoomPct > 0) || !(distance > 0)) return { target: new Vector3(), camera: new Vector3() }
  const f = sight.clone().divideScalar(distance)
  const along = f.x * travel.x + f.z * travel.z
  const across = Math.sqrt(Math.max(0, 1 - along * along))
  const pitchDeg = Math.asin(clamp(-f.y, -1, 1)) / DEG
  const move = smootherstep((pitchDeg - LEAD_PAN_PITCH_DEG) / (LEAD_MOVE_PITCH_DEG - LEAD_PAN_PITCH_DEG))
  const k = (leadRoomPct / 100) * smootherstep(markerShare / LEAD_FULL_SPEED) * LEAD_HALF_FRAME_PER_M
  // travel nearly along the line of sight, toward the camera, at a low pitch: the marker would drift away, not off-centre
  const divisor = smoothMax(across - k * (1 - 2 * move) * along, LEAD_SCREEN_FLOOR, LEAD_SCREEN_FLOOR)
  const shiftM = ((2 * k) / (divisor + Math.sqrt(divisor * divisor + 4 * k * k * move * (1 - move)))) * distance
  return { target: travel.clone().multiplyScalar(shiftM), camera: travel.clone().multiplyScalar(shiftM * move) }
}

/**
 * Roll of the camera at `d` (radians, > 0 = banking right) from the turn rate of its reference direction (`placement`):
 * the turn over ± BANK_SPAN_SHARE of the heading window per metre of track, times the camera's speed along the track
 * (`cameraShare`: its share of a flight's constant pace). None in 'top' (the map does not tilt).
 */
function bankRad(path: TrackPath, d: number, timeS: number, frame: LocalFrame, camera: CameraSettings, durationS: number, cameraShare: number): number {
  if (camera.style === 'top' || !(camera.bankDeg > 0)) return 0
  const half = headingWindowM(path, camera) * BANK_SPAN_SHARE
  const from = clamp(d - half, 0, path.lengthM)
  const to = clamp(d + half, 0, path.lengthM)
  if (!(to > from)) return 0
  const heading = (at: number) => {
    const { reference } = placement(path, at, timeS, frame, camera, durationS)
    return Math.atan2(reference.x, -reference.z)
  }
  const turn = heading(to) - heading(from)
  const rate = (Math.atan2(Math.sin(turn), Math.cos(turn)) / (to - from)) * cameraShare * (path.lengthM / Math.max(1, durationS))
  return camera.bankDeg * DEG * Math.tanh(rate / BANK_TURN_RATE_RAD_S)
}

/**
 * Ground height (metres, not exaggerated) under the track around `d`: the `bump`-weighted mean over
 * ]d - radiusM, d + radiusM[ of the terrain at fixed track distances (multiples of radiusM / GROUND_SAMPLES_PER_SIDE).
 * The samples stay put while the marker moves, only their weights slide: the mean follows the relief, not the
 * bumps under the marker, and a finer tile arriving shifts it by a fraction. `trackHeightM`: terrain, else recorded
 * elevation, else 0 (the recorded one in a flight).
 */
function trackGround(path: TrackPath, d: number, radiusM: number, sample: HeightSampler | null): number {
  const step = radiusM / GROUND_SAMPLES_PER_SIDE
  let sum = 0
  let weight = 0
  for (let k = Math.floor((d - radiusM) / step) + 1; k * step < d + radiusM; k++) {
    const w = bump(k * step - d, radiusM)
    sum += w * pathHeightM(path, k * step, samplePath(path, k * step), sample)
    weight += w
  }
  return sum / weight
}

/**
 * Terrain (metres, not exaggerated) at the corners and the cell centres of a fixed `cellM` grid of the local frame,
 * each read once per view (the sight line crosses the same cells many times); with `perSide` > 1, each the mean of
 * perSide² samples over the cell-sized square around it. Undefined where the terrain is unknown.
 */
interface TerrainGrid {
  cellM: number
  /** terrain at corner (i, j) */
  corner: (i: number, j: number) => number | undefined
  /** how far corner (i, j) is raised for the relief the grid misses (`reliefGround`) */
  lift: (i: number, j: number) => number
}

function terrainGrid(cellM: number, frame: LocalFrame, sample: HeightSampler, perSide = 1): TerrainGrid {
  const memo = <T>(compute: (i: number, j: number) => T) => {
    const cache = new Map<number, T>()
    return (i: number, j: number): T => {
      // a frame spans far fewer than 2^19 cells each way
      const key = i * 1_048_576 + j
      if (cache.has(key)) return cache.get(key) as T
      const value = compute(i, j)
      cache.set(key, value)
      return value
    }
  }
  const point = (i: number, j: number) => {
    const at = frame.toLonLat(_corner.set(i * cellM, 0, j * cellM))
    return sample(at.lon, at.lat)
  }
  const terrain = (i: number, j: number) => {
    let sum = 0
    for (let a = 0; a < perSide; a++) {
      for (let b = 0; b < perSide; b++) {
        const h = point(i + (a + 0.5) / perSide - 0.5, j + (b + 0.5) / perSide - 0.5)
        if (h === undefined) return undefined
        sum += h
      }
    }
    return sum / (perSide * perSide)
  }
  const corner = memo(terrain)
  // rise of the terrain at the centre of cell (i, j) above the mean of its corners: what the grid misses (0 for a hollow)
  const rise = memo((i, j) => {
    const h = terrain(i + 0.5, j + 0.5)
    const a = corner(i, j)
    const b = corner(i + 1, j)
    const c = corner(i, j + 1)
    const d = corner(i + 1, j + 1)
    if (h === undefined || a === undefined || b === undefined || c === undefined || d === undefined) return 0
    return Math.max(0, h - (a + b + c + d) / 4)
  })
  const lift = memo((i, j) => Math.max(rise(i - 1, j - 1), rise(i, j - 1), rise(i - 1, j), rise(i, j)))
  return { cellM, corner, lift }
}

/**
 * Ground height (metres, not exaggerated) at local (x, z), bilinear between the terrain at the corners of its cell
 * in `grid`: the corners stay put while the camera moves, so the height follows the relief with a bounded slope, never
 * each bump. Exact on a plane; a bump narrower than the cell can rise above it (`reliefGround`, MIN_TERRAIN_CLEARANCE_M),
 * a cliff is softened over a cell. Undefined without terrain there.
 */
function gridGround(x: number, z: number, grid: TerrainGrid): number | undefined {
  const i = Math.floor(x / grid.cellM)
  const j = Math.floor(z / grid.cellM)
  const tx = x / grid.cellM - i
  const tz = z / grid.cellM - j
  let sum = 0
  let weight = 0
  for (let ci = 0; ci <= 1; ci++) {
    for (let cj = 0; cj <= 1; cj++) {
      const w = (ci ? tx : 1 - tx) * (cj ? tz : 1 - tz)
      if (w <= 0) continue
      const h = grid.corner(i + ci, j + cj)
      if (h === undefined) continue
      sum += w * h
      weight += w
    }
  }
  return weight > 0 ? sum / weight : undefined
}

/**
 * `gridGround` raised by the relief its cells miss: each corner by the largest rise of its four cells (terrain at the
 * centre above the mean of the corners, `TerrainGrid.lift`), interpolated like the grid, so anywhere in a cell the
 * ground is at least the grid plus that cell's rise. The samples stay put while the camera moves (fixed corners and
 * centres), so the line of sight clears a crest narrower than a cell without riding it.
 */
function reliefGround(x: number, z: number, grid: TerrainGrid): number | undefined {
  const base = gridGround(x, z, grid)
  if (base === undefined) return undefined
  const i = Math.floor(x / grid.cellM)
  const j = Math.floor(z / grid.cellM)
  const tx = x / grid.cellM - i
  const tz = z / grid.cellM - j
  let excess = 0
  for (let ci = 0; ci <= 1; ci++) {
    for (let cj = 0; cj <= 1; cj++) {
      const w = (ci ? tx : 1 - tx) * (cj ? tz : 1 - tz)
      if (w <= 0) continue
      excess += w * grid.lift(i + ci, j + cj)
    }
  }
  return base + excess
}

/** Uniform cubic B-spline weights of the four corners around a cell fraction `t`. */
function splineWeights(t: number): [number, number, number, number] {
  const u = 1 - t
  return [(u * u * u) / 6, (3 * t * t * t - 6 * t * t + 4) / 6, (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6, (t * t * t) / 6]
}

/**
 * `gridGround` as a cubic B-spline over the 4 × 4 corners around the cell: still exact on a plane, with a continuous
 * slope and curvature, so the aim's height does not jolt at each cell edge (16 terrain samples).
 */
function smoothGridGround(x: number, z: number, cellM: number, frame: LocalFrame, sample: HeightSampler): number | undefined {
  const i = Math.floor(x / cellM)
  const j = Math.floor(z / cellM)
  const wx = splineWeights(x / cellM - i)
  const wz = splineWeights(z / cellM - j)
  let sum = 0
  let weight = 0
  for (let ci = 0; ci < 4; ci++) {
    for (let cj = 0; cj < 4; cj++) {
      const w = wx[ci] * wz[cj]
      const at = frame.toLonLat(_corner.set((i + ci - 1) * cellM, 0, (j + cj - 1) * cellM))
      const h = sample(at.lon, at.lat)
      if (h === undefined) continue
      sum += w * h
      weight += w
    }
  }
  return weight > 0 ? sum / weight : undefined
}

/** Point of the track at `d` (local frame), `heightM` above the ellipsoid. */
function anchorAt(path: TrackPath, d: number, heightM: number, frame: LocalFrame): Vector3 {
  const at = samplePath(path, d)
  return frame.toLocal(at.lon, at.lat, heightM)
}

/**
 * Ground gradient (exaggerated, rise per metre; x east, z south) under the track around `d`: central differences over
 * ± `h` at fixed track distances (multiples of radiusM / GROUND_SAMPLES_PER_SIDE), `bump`-weighted over ± `radiusM`.
 * The samples stay put while the marker moves, so the slope turns smoothly (32 terrain samples).
 */
function trackSlope(path: TrackPath, d: number, radiusM: number, h: number, frame: LocalFrame, sample: HeightSampler, exaggeration: number): Vector3 {
  const step = radiusM / GROUND_SAMPLES_PER_SIDE
  const slope = new Vector3()
  let weight = 0
  for (let k = Math.floor((d - radiusM) / step) + 1; k * step < d + radiusM; k++) {
    const wk = bump(k * step - d, radiusM)
    const at = samplePath(path, clamp(k * step, 0, path.lengthM))
    const { x, z } = frame.toLocal(at.lon, at.lat, 0, _corner)
    const height = (dx: number, dz: number) => {
      const q = frame.toLonLat(_corner.set(x + dx, 0, z + dz))
      return sample(q.lon, q.lat)
    }
    const east = height(h, 0)
    const west = height(-h, 0)
    const south = height(0, h)
    const north = height(0, -h)
    if (east === undefined || west === undefined || south === undefined || north === undefined) continue
    slope.x += (wk * (east - west)) / (2 * h)
    slope.z += (wk * (south - north)) / (2 * h)
    weight += wk
  }
  return weight > 0 ? slope.multiplyScalar(exaggeration / weight) : slope
}

/**
 * Extra viewing angle (radians, > 0 = right) that keeps the marker in sight across `slope` (`trackSlope`). Seen from
 * the marker, the ground rises toward the camera by slope · u (u: horizontal direction to the camera) and the sight
 * line by tan(pitch): beyond tan(pitch + SWING_CLIMB_DEG) - SWING_MARGIN the camera turns until it no longer does,
 * the camera's angle from uphill α eased to β (where the rise is just allowed) by an odd quintic, continuous with its
 * slope at ±β (no turn outside, no jolt where it starts), twice the heading's turn rate straight uphill (no flip
 * between the two sides there: the climb clears it).
 */
function swingAngle({ reference, viewAngle, pitchDeg }: Placement, slope: Vector3): number {
  const steepness = Math.hypot(slope.x, slope.z)
  const allowed = Math.tan(clamp(pitchDeg + SWING_CLIMB_DEG, PITCH_MIN_DEG, PITCH_MAX_DEG) * DEG) - SWING_MARGIN
  if (!(steepness > allowed) || allowed <= 0) return 0
  // acos grows as the square root of the excess: eased in over SWING_ONSET so the swing does not start with a jolt
  const excess = 1 - allowed / steepness
  const beta = Math.acos(1 - excess) * Math.min(1, excess / SWING_ONSET)
  // direction marker → camera (opposite to the viewing direction), angles clockwise from north as atan2(x, -z)
  const toCamera = Math.atan2(reference.x, -reference.z) + viewAngle + Math.PI
  const uphill = Math.atan2(slope.x, -slope.z)
  const alpha = Math.atan2(Math.sin(toCamera - uphill), Math.cos(toCamera - uphill))
  if (Math.abs(alpha) >= beta) return 0
  const u = alpha / beta
  return beta * (2 * u - 2 * u ** 3 + u ** 5) - alpha
}

/** max(a, b) eased over a band of `k`: never below the larger, at most k / 4 above it, with no kink. */
export function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k
  return Math.max(a, b) + (h * h * k) / 4
}

/** Horizontal viewing direction of a placement: its reference turned clockwise (seen from above) by its viewing angle; right = (-z, 0, x). */
function lookDirection({ reference, viewAngle }: Placement): Vector3 {
  const cos = Math.cos(viewAngle)
  const sin = Math.sin(viewAngle)
  return new Vector3(reference.x * cos - reference.z * sin, 0, reference.z * cos + reference.x * sin)
}

/** Camera on the sphere around `target` given by the placement (pitch clamped to PITCH_MIN_DEG..PITCH_MAX_DEG). */
function positionAround(target: Vector3, place: Placement): Vector3 {
  const { pitchDeg, distance } = place
  const pitch = clamp(pitchDeg, PITCH_MIN_DEG, PITCH_MAX_DEG) * DEG
  const look = lookDirection(place)
  return target
    .clone()
    .addScaledVector(look, -distance * Math.cos(pitch))
    .setY(target.y + distance * Math.sin(pitch))
}

/**
 * Lowest camera height (local y, at least `position.y`) that keeps the sight line to `target` (the marker) above the
 * (exaggerated) grid ground with the relief its cells miss (`reliefGround`): the line at fraction f (0 = camera) has
 * height y + (target.y - y) · f
 * and must clear the ground there by MIN_GROUND_CLEARANCE_M · (1 - f), at least LINE_OF_SIGHT_MIN_CLEARANCE_M, up to
 * the end of the checked line (LINE_OF_SIGHT_END_M, LINE_OF_SIGHT_MAX_GAIN). Where the lift per metre of ground passes
 * LINE_OF_SIGHT_FINE_GAIN, the line is checked against the coarse grid instead (LINE_OF_SIGHT_COARSE_CELL_M). The floor
 * is eased in (`smoothMax`), then the camera is kept MIN_TERRAIN_CLEARANCE_M above the actual terrain below it.
 */
function lowestClearY(
  position: Vector3,
  target: Vector3,
  frame: LocalFrame,
  sample: HeightSampler,
  exaggeration: number,
  cellM: number,
  liftM: number,
): number {
  let floor = -Infinity
  const grid = terrainGrid(cellM, frame, sample)
  const coarseM = Math.max(cellM, LINE_OF_SIGHT_COARSE_CELL_M)
  const coarse = coarseM === cellM ? grid : terrainGrid(coarseM, frame, sample, LINE_OF_SIGHT_COARSE_SAMPLES)
  // the coarse line ends on the coarse ground at the marker, never above the steady height
  const endAt = frame.toLonLat(target)
  const endGround = reliefGround(target.x, target.z, coarse)
  const end = endGround === undefined ? target : frame.toLocal(endAt.lon, endAt.lat, endGround * exaggeration + liftM)
  if (end.y > target.y) end.copy(target)
  // lowest camera height for the line to `to` to clear `ground` + `clearance` at f, `share` of its lift kept
  const floorAt = (to: Vector3, f: number, g: TerrainGrid, clearance: number, share: number) => {
    _sight.lerpVectors(position, to, f).setY(to.y)
    const ground = reliefGround(_sight.x, _sight.z, g)
    if (ground === undefined) return -Infinity
    const at = frame.toLonLat(_sight)
    const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + clearance, _sight).y
    return to.y + ((floorY - to.y) * share) / (1 - f)
  }
  const left = Math.max(LINE_OF_SIGHT_END_M / Math.max(1, position.distanceTo(target)), 1 / LINE_OF_SIGHT_MAX_GAIN)
  for (let i = 0; i <= LINE_OF_SIGHT_SAMPLES; i++) {
    const f = (i / LINE_OF_SIGHT_SAMPLES) * (1 - Math.min(0.5, left))
    const clearance = Math.max(MIN_GROUND_CLEARANCE_M * (1 - f), LINE_OF_SIGHT_MIN_CLEARANCE_M)
    // the fine grid's lift eased out between LINE_OF_SIGHT_FINE_GAIN and twice that
    const t = clamp(2 - 1 / ((1 - f) * LINE_OF_SIGHT_FINE_GAIN), 0, 1)
    const share = t * t * (3 - 2 * t)
    if (share > 0) floor = Math.max(floor, floorAt(target, f, grid, clearance, share))
    floor = Math.max(floor, floorAt(end, f, coarse, clearance, 1))
  }
  let y = smoothMax(position.y, floor, CLEARANCE_EASE_M)
  // a bump narrower than the grid cell
  const below = frame.toLonLat(_sight.set(position.x, y, position.z))
  const ground = sample(below.lon, below.lat)
  if (ground !== undefined) {
    y = Math.max(y, frame.toLocal(below.lon, below.lat, ground * exaggeration + MIN_TERRAIN_CLEARANCE_M, _sight).y)
  }
  return y
}
