/**
 * Camera of the film: the flight camera (`computeCameraView`) during the flight, with the framing of the camera
 * keys (`keyedCamera`), an overview of the whole track for the opening and closing shots, the camera of each stop
 * ('orbite', 'large', 'fixe', 'panorama'). A pure function of the film time, the progress, the settings and the terrain sampler,
 * like the flight camera: the export renders any frame alone. Shots and transitions: ARCHITECTURE.md "Film and timeline".
 *
 * Overview: target = centre of the track's box, distance = OVERVIEW_DISTANCE_FACTOR x box diagonal (more for a frame
 * taller than wide, so 9:16 keeps the whole track), on the side the flight camera looks from where the shot joins
 * the flight (no turn during the transition). The transition interpolates the tilt and the heading of the direction
 * apart (`blendDirections`), the distance geometrically (smootherstep), lerps the target as the distance changes, stays
 * MIN_GROUND_CLEARANCE_M above the ground and, in between, on a glide slope over the flight camera and clear of the
 * relief on the way (`shotLift`); the aim is raised as much as the camera, so the tilt goes from one end view's to
 * the other's. A shot that cuts ('coupe', dips to black or white) holds its wide view and cuts at the boundary with the
 * flight (`shotWeight`).
 *
 * « Focale »: every framing here is that of the film's lens (`CameraSettings.focalMm`, `focalMm` below): a distance
 * computed from a size (overview, region, group) is the one that frames it with that lens, the flight camera and the
 * keyframes stand `focalDolly` farther or closer than with the default one.
 */
import { Vector3, type PerspectiveCamera } from 'three'
import { clamp, smootherstep } from '../core/math'
import type { LocalFrame, LonLat } from '../core/types'
import type { ClockDay, ClockStop, FilmClock, FilmState } from '../film/clock'
import { CAMERA_KEY_RANGES, SITUATION_DISTANCE_KM_RANGE, SITUATION_TILT_DEFAULT_DEG, SITUATION_TILT_RANGE, shotCuts, situationTiming } from '../film/model'
import type { FilmCameraKey, FilmShot, ShotStyle, SituationFraming, StartHeight } from '../film/model'
import type { HeightSampler } from '../scene/trackLineSet'
import {
  LINE_OF_SIGHT_FINE_GAIN,
  LINE_OF_SIGHT_MIN_CLEARANCE_M,
  MIN_GROUND_CLEARANCE_M,
  autoDistanceM,
  smoothMax,
  computeCameraView,
  headingWindowM,
  movesWithTime,
  smoothHeadingAt,
  type CameraView,
  type CameraViewOptions,
} from './camera'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S, DEFAULT_FOCAL_MM, focalDolly, fovDegOf, type CameraSettings } from './cameraSettings'
import { pathHeightM } from './flights'
import { samplePath, type TrackPath } from './path'
import { nightAt } from './sun'
import { cameraKeyEaseM, keyFraming, keyPoseAt, type KeyFraming } from './cameraKeys'
import { ANTICIPATION_REACH_S, ANTICIPATION_STEP_S, anticipatedRaise, groundSpeedMps, motionShares, smoothsInTime, timeSmoothing } from './timeSmoothing'
import { aimTowardsPins, type AimPin } from './pinAim'

export { smootherstep }
export { CAMERA_KEY_EASE_S, cameraKeyEaseM, keyedCamera } from './cameraKeys'

/** Overview distance = this × diagonal of the track's box (landscape frames), at least OVERVIEW_MIN_DISTANCE_M. */
export const OVERVIEW_DISTANCE_FACTOR = 1.6
export const OVERVIEW_MIN_DISTANCE_M = 2_000
export const OVERVIEW_PITCH_DEG = 40
/**
 * Region view of a 'situation' shot, this much above the horizon. Start height « Région »: this × the track's box
 * diagonal away, within [REGION_MIN_DISTANCE_M, REGION_MAX_DISTANCE_M] (start altitude ~50–150 km); « Pays »:
 * COUNTRY_DISTANCE_FACTOR × farther. A highlighted region is framed instead: its box fills the frame height (width
 * in portrait) with REGION_FIT_MARGIN.
 */
export const REGION_PITCH_DEG = 90 - SITUATION_TILT_DEFAULT_DEG
export const REGION_DISTANCE_FACTOR = 8
export const REGION_MIN_DISTANCE_M = 55_000
export const REGION_MAX_DISTANCE_M = 165_000
export const COUNTRY_DISTANCE_FACTOR = 2.5
export const REGION_FIT_MARGIN = 1.15
/**
 * The frame of the region view reaches at most this far beyond the track's box (flat ground); the terrain area of a
 * film with a region view (scene/TerrainLayer.tsx) has REGION_AREA_MARGIN_M around it: the round Earth makes the
 * far corners reach a bit farther than flat ground.
 */
export const REGION_REACH_M = 400_000
export const REGION_AREA_MARGIN_M = 500_000
/** 'balayage' shot: turn of the overview around its target (degrees), share of the shot it takes. */
export const SWEEP_DEG = 75
export const SWEEP_SHARE = 0.6
/** Glide slope (degrees above the horizon) a shot's camera keeps over the flight view it moves to or from. */
export const SHOT_GLIDE_DEG = 15
/** A shot's camera clears the ground under it, and the line to its aim, by this share of its distance (at least the flight's). */
export const SHOT_CLEARANCE_SHARE = 0.08
/** Samples of the relief along the line of sight of a shot's camera, up to 90% of the way to its aim. */
const SHOT_SIGHT_SAMPLES = 16
/** Width (share of its distance) over which the floor of a shot's camera takes over from the blend. */
const SHOT_SOFT_SHARE = 0.2
/** The glide and the clearances ease in over this share of the shot's blend at each end (the end views are untouched). */
const SHOT_EASE_SHARE = 0.1
/**
 * ... longer by the lift's share of the camera's distance over this much, up to this share of the blend (2 before « Focale »:
 * a wide angle's closer camera came down from a lift of 4 km in a few frames at the start of a closing « Balayage »).
 */
const SHOT_EASE_LIFT = 1.5
/** The camera takes at least this share of a night pause to rise to the high view of the day, and as much to come back. */
const DAY_VIEW_MIN_SHARE = 0.2
/** A shot's lift is read at this many points of the blend, kept in full within HOLD of the blend and down to nothing at REACH. */
const SHOT_LIFT_POINTS = 40
const SHOT_LIFT_HOLD = 0.06
const SHOT_LIFT_REACH = 0.25
const SHOT_EASE_MAX_SHARE = 0.5
/** The raise of a film instant moves by at most this share of the camera's distance each time a sharper terrain refreshes it (`flightAt`). */
const RAISE_REFRESH_SHARE = 0.012
/** Length of the quick move of a 'saut' shot (seconds). */
export const JUMP_S = 0.6
/** 'orbite' stop: the camera turns out by STOP_ORBIT_DEG_PER_S × stop duration (at most STOP_ORBIT_MAX_DEG) and back. */
export const STOP_ORBIT_DEG_PER_S = 6
export const STOP_ORBIT_MAX_DEG = 120
/** 'large' stop: at the middle of its window, the camera is this much farther and this much higher (degrees of pitch). */
export const STOP_WIDE_DISTANCE_FACTOR = 2.5
export const STOP_WIDE_PITCH_DEG = 20
/** Racers framed together (« Toutes les traces »): their spread around their centre × this fills half the frame height. */
export const GROUP_FRAMING_MARGIN = 1.4
const DEG = Math.PI / 180
const UP = new Vector3(0, 1, 0)
/** tan(vertical field of view / 2) of the lens `focalMm` long. */
const tanHalfFov = (focalMm: number) => Math.tan((fovDegOf(focalMm) / 2) * DEG)
/** The lens of the film (`FilmViewOptions.camera`). */
const focalOf = (options: { camera?: CameraSettings }) => options.camera?.focalMm ?? DEFAULT_FOCAL_MM

/**
 * Fraction (0 = first view, 1 = second) of a shot `localS` seconds into it: opening overview → flight, closing
 * flight → overview. A 'situation' shot holds its region view `holdS` seconds (opening: first; closing: last) and
 * moves by smootherstep over the rest; with no hold, over the whole shot, like 'descente'.
 */
export function shotBlend(style: ShotStyle, phase: 'opening' | 'closing', localS: number, lengthS: number, holdS = 0): number {
  if (!(lengthS > 0)) return 1
  if (style === 'situation' && holdS > 0) {
    const { holdS: hold, moveS } = situationTiming({ durationS: lengthS, holdS })
    return ramp(phase === 'opening' ? localS - hold : localS, moveS)
  }
  if (style === 'balayage') {
    const u = localS / lengthS
    return smootherstep(phase === 'opening' ? (u - SWEEP_SHARE) / (1 - SWEEP_SHARE) : u / (1 - SWEEP_SHARE))
  }
  if (style !== 'saut') return smootherstep(localS / lengthS)
  const jump = Math.min(JUMP_S, lengthS)
  return smootherstep((phase === 'opening' ? localS - (lengthS - jump) : localS) / jump)
}

/** Turn (radians) of the overview of a 'balayage' shot `localS` seconds into it: SWEEP_DEG → 0 (opening), 0 → SWEEP_DEG (closing). */
export function sweepRad(phase: 'opening' | 'closing', localS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  const u = localS / lengthS
  const k = phase === 'opening' ? 1 - smootherstep(u / SWEEP_SHARE) : smootherstep((u - (1 - SWEEP_SHARE)) / SWEEP_SHARE)
  return SWEEP_DEG * DEG * k
}

/** `view` turned by `angleRad` around the vertical through its target. */
export function turnedView(view: CameraView, angleRad: number): CameraView {
  if (angleRad === 0) return view
  const offset = view.position.clone().sub(view.target).applyAxisAngle(UP, angleRad)
  return { target: view.target.clone(), position: view.target.clone().add(offset) }
}

/**
 * `shotBlend` of a shot joined to the flight by a continuous move; with a cut, its wide view over the whole shot:
 * the weight jumps at the boundary with the flight (opening: 0 until it ends; closing: 1 from its start).
 */
export function shotWeight(shot: FilmShot, phase: 'opening' | 'closing', localS: number, lengthS: number): number {
  if (shotCuts(shot)) return phase === 'opening' ? 0 : 1
  return shotBlend(shot.style, phase, localS, lengthS, shot.holdS)
}

/** Share of the region view in a highlighting 'situation' shot below which its highlight is gone, above which it is whole. */
export const REGION_HIGHLIGHT_FADE = { from: 0.55, to: 0.85 } as const

/**
 * Opacity of the region highlight (scene/RegionHighlight.tsx) at film time `timeS`: 1 while a 'situation' shot that
 * highlights the region holds its region view, fading out by smootherstep as the camera dives (closing: back in as it
 * climbs), 0 anywhere else. It follows the shot's weight, so a shot that cuts keeps it whole until the cut.
 */
export function regionHighlightOpacity(clock: Pick<FilmClock, 'stateAt' | 'opening' | 'closing'>, timeS: number): number {
  const state = clock.stateAt(timeS)
  if (state.phase !== 'opening' && state.phase !== 'closing') return 0
  const shot = state.phase === 'opening' ? clock.opening : clock.closing
  if (shot.style !== 'situation' || shot.highlight !== true) return 0
  const k = shotWeight(shot, state.phase, state.localS, state.lengthS)
  const wide = state.phase === 'opening' ? 1 - k : k
  const { from, to } = REGION_HIGHLIGHT_FADE
  return smootherstep((wide - from) / (to - from))
}

/** 0 → 1 → 0 over a stop window `lengthS` long, `localS` seconds into it (raised cosine: still at both ends). */
export function stopBump(localS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  return (1 - Math.cos(2 * Math.PI * clamp(localS / lengthS, 0, 1))) / 2
}

/** Orbit angle (radians) `localS` seconds into a stop window `lengthS` long: out and back, still at both ends. */
export function stopOrbitRad(addedS: number, localS: number, lengthS: number): number {
  return Math.min(STOP_ORBIT_MAX_DEG, STOP_ORBIT_DEG_PER_S * addedS) * DEG * stopBump(localS, lengthS)
}

/** Orbit angle (radians) of a 'panorama' stop: one full turn, eased in and out over the window, so the end joins the flight camera. */
export function stopPanoramaRad(localS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  return 2 * Math.PI * smootherstep(clamp(localS / lengthS, 0, 1))
}

/** 0 → 1 over the first and last fifth of a stop window, 1 between: a tilt that is held, without a jump at either end. */
export function stopHoldWeight(localS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  return smootherstep(clamp(Math.min(localS, lengthS - localS) / (lengthS * 0.2), 0, 1))
}

/** Camera of a 'large' stop: farther and higher by `k` (0 = the flight camera, 1 = the widest). */
export function widenedCamera<T extends Pick<CameraSettings, 'distance' | 'pitchDeg'>>(camera: T, k: number): T {
  return {
    ...camera,
    distance: camera.distance * (1 + (STOP_WIDE_DISTANCE_FACTOR - 1) * k),
    pitchDeg: camera.pitchDeg + STOP_WIDE_PITCH_DEG * k,
  }
}

/** 0 → 1 by smootherstep over `lengthS` (a step when it is 0). */
const ramp = (s: number, lengthS: number) => (lengthS > 0 ? smootherstep(s / lengthS) : s >= 0 ? 1 : 0)

/**
 * Film time driving the time-based motions (orbit and cinema styles) at `timeS` during a 'fixe' stop: eased to the
 * middle of the window over the ease-in, held there, eased back over the ease-out. The camera slows down, holds and
 * moves on where it would have been, without a jump (never backwards).
 */
export function heldMotionTimeS(stop: Pick<ClockStop, 'startS' | 'holdStartS' | 'holdEndS' | 'endS'>, timeS: number): number {
  const middle = (stop.startS + stop.endS) / 2
  const weight = Math.min(ramp(timeS - stop.startS, stop.holdStartS - stop.startS), ramp(stop.endS - timeS, stop.endS - stop.holdEndS))
  return timeS + (middle - timeS) * weight
}

/**
 * True when the view changes with the film time alone (progress unchanged): shots, orbiting, turning or widening stops, every
 * stop with a smoothing in time, orbit / cinema, free (its keyframes are timed by the film time).
 */
export function filmViewMovesWithTime(state: FilmState, camera: CameraSettings): boolean {
  if (state.phase === 'opening' || state.phase === 'closing' || camera.style === 'free') return true
  if (state.phase === 'stop' && (state.stop?.camera === 'orbite' || state.stop?.camera === 'large' || state.stop?.camera === 'panorama' || smoothsInTime(camera))) return true
  return movesWithTime(camera.style)
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

interface TrackBox {
  /** horizontal box of the track in the local frame (height 0) */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** recorded elevations (NaN when none) */
  minEle: number
  maxEle: number
}

/** A stretch of the path, in metres along it (a day of a multi-day track). */
export interface PathRange {
  fromM: number
  toM: number
}

const boxes = new WeakMap<TrackPath, WeakMap<LocalFrame, Map<string, TrackBox>>>()

/** Box of the track, or of its stretch `range`, in the local frame (cached per path, frame and range). */
export function trackBox(path: TrackPath, frame: LocalFrame, range?: PathRange): TrackBox {
  let perFrame = boxes.get(path)
  if (!perFrame) boxes.set(path, (perFrame = new WeakMap()))
  let perRange = perFrame.get(frame)
  if (!perRange) perFrame.set(frame, (perRange = new Map()))
  const key = range ? `${range.fromM}:${range.toM}` : ''
  const cached = perRange.get(key)
  if (cached) return cached
  const box: TrackBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minEle: NaN, maxEle: NaN }
  const p = new Vector3()
  for (let i = 0; i < path.count; i++) {
    if (range && (path.dist[i] < range.fromM || path.dist[i] > range.toM)) continue
    frame.toLocal(path.lon[i], path.lat[i], 0, p)
    box.minX = Math.min(box.minX, p.x)
    box.maxX = Math.max(box.maxX, p.x)
    box.minZ = Math.min(box.minZ, p.z)
    box.maxZ = Math.max(box.maxZ, p.z)
    const ele = path.ele[i]
    if (Number.isNaN(ele)) continue
    if (!(ele >= box.minEle)) box.minEle = ele
    if (!(ele <= box.maxEle)) box.maxEle = ele
  }
  perRange.set(key, box)
  return box
}

/** Raise `position` to MIN_GROUND_CLEARANCE_M above the (exaggerated) ground under it. */
function keepAboveGround(position: Vector3, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number): Vector3 {
  if (!sample) return position
  const at = frame.toLonLat(position)
  const ground = sample(at.lon, at.lat)
  if (ground === undefined) return position
  const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + MIN_GROUND_CLEARANCE_M).y
  if (position.y < floorY) position.y = floorY
  return position
}

/** The clearance of a keyed camera is whole beyond this much of `edge` (0 at an exact pose of a key, 1 halfway between two keys). */
const KEY_CLEARANCE_EDGE = 0.2

/**
 * `position` of a keyed camera raised to MIN_GROUND_CLEARANCE_M above the ground, by smootherstep of `edge` over
 * KEY_CLEARANCE_EDGE: none at a keyframe (its pose is the view that was taken, and the flight camera it blends with has
 * its own clearance), whole a little way from it. Blends of two views know nothing of the terrain between them: the
 * camera went through a ridge between two keys (65 to 101 m under the ground on the switchbacks), and a plain floor jumped where a key
 * lies within MIN_GROUND_CLEARANCE_M of the ground.
 */
function keyClearance(position: Vector3, edge: number, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number): Vector3 {
  if (!(edge > 0)) return position
  const kept = keepAboveGround(position.clone(), frame, sample, exaggeration)
  return position.clone().setY(position.y + (kept.y - position.y) * smootherstep(edge / KEY_CLEARANCE_EDGE))
}

/** Distance factor for a frame taller than wide (9:16 keeps the whole track). */
const portraitFactor = (aspect: number) => (aspect > 0 && aspect < 1 ? 1 / aspect : 1)

/**
 * How much farther than with the default lens a wide view (overview, region) stands with a lens `focalMm` long: a
 * telephoto backs off (`focalDolly`) so the whole track still fits the narrower frame; a wide angle does not come closer,
 * it already sees more: the view is the default's, with more land around (and no camera nearer the relief than before).
 */
const wideViewDolly = (focalMm: number) => Math.max(1, focalDolly(focalMm))

/** Distance of the overview from the centre of a track box `diagonal` long (relief included), with a lens `focalMm` long. */
export function overviewDistanceM(diagonal: number, aspect: number, focalMm = DEFAULT_FOCAL_MM): number {
  return Math.max(OVERVIEW_MIN_DISTANCE_M, OVERVIEW_DISTANCE_FACTOR * diagonal * portraitFactor(aspect)) * wideViewDolly(focalMm)
}

/**
 * Farthest flat ground in the frame from the target, per metre of camera distance, for a camera `pitchDeg` above
 * the horizon (more than half the field of view: no sky) and a frame of `aspect`: the top or bottom corners.
 */
export function groundReach(pitchDeg: number, aspect: number, focalMm = DEFAULT_FOCAL_MM): number {
  const sin = Math.sin(pitchDeg * DEG)
  const cos = Math.cos(pitchDeg * DEG)
  const t = tanHalfFov(focalMm)
  // camera 1 m from the target; corner ray = forward + side·t·up + aspect·t·right, cut by the ground plane
  const corner = (side: number) => {
    const length = sin / (sin - side * t * cos)
    return Math.hypot(length * aspect * t, length * (cos + side * t * sin) - cos)
  }
  return Math.max(corner(1), corner(-1))
}

/** Highlighted region a 'situation' shot frames: centre and size of its box (metres). */
export interface RegionFrame {
  centre: LonLat
  widthM: number
  heightM: number
}

/**
 * Distance of the region view of a 'situation' shot: from the track's box `diagonal` long, or fitting the `region`
 * box; × COUNTRY_DISTANCE_FACTOR for « Pays »; or the distance chosen (`chosenM`, as is). Its frame, `pitchDeg`
 * above the horizon, reaches no farther than REGION_REACH_M beyond the track's box (`halfSideM` = its smaller half
 * side, `offsetM` = distance from the region's centre to the track's); never nearer than the overview.
 */
export function regionDistanceM(
  diagonal: number,
  halfSideM: number,
  aspect: number,
  height: StartHeight = 'region',
  region?: Pick<RegionFrame, 'widthM' | 'heightM'>,
  offsetM = 0,
  pitchDeg = REGION_PITCH_DEG,
  chosenM?: number,
  focalMm = DEFAULT_FOCAL_MM,
): number {
  const overview = overviewDistanceM(diagonal, aspect, focalMm)
  // the automatic height is that of the default lens (the telephoto's, farther: `wideViewDolly`); a box to fit, exactly
  const regional = region
    ? (REGION_FIT_MARGIN * Math.max(region.widthM, region.heightM)) / (2 * tanHalfFov(focalMm))
    : clamp(REGION_DISTANCE_FACTOR * diagonal, REGION_MIN_DISTANCE_M, REGION_MAX_DISTANCE_M) * wideViewDolly(focalMm)
  const wanted = chosenM ?? regional * portraitFactor(aspect) * (height === 'pays' ? COUNTRY_DISTANCE_FACTOR : 1)
  const reachM = halfSideM + REGION_REACH_M - offsetM
  return Math.max(overview, Math.min(wanted, reachM / groundReach(pitchDeg, aspect, focalMm)))
}

/** Centre of the track's box on the ground, the box diagonal (relief included) and its smaller half side. */
function trackFraming(path: TrackPath, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number, range?: PathRange) {
  const box = trackBox(path, frame, range)
  const centre = new Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2)
  const at = frame.toLonLat(centre)
  const recorded = Number.isNaN(box.minEle) ? 0 : (box.minEle + box.maxEle) / 2
  const target = frame.toLocal(at.lon, at.lat, (sample?.(at.lon, at.lat) ?? recorded) * exaggeration)
  const relief = Number.isNaN(box.minEle) ? 0 : (box.maxEle - box.minEle) * exaggeration
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ, relief)
  const halfSideM = Math.min(box.maxX - box.minX, box.maxZ - box.minZ) / 2
  return { target, diagonal, halfSideM }
}

/** Horizontal direction from the target to the camera of the `joined` view (the side it looks from). */
const sideOf = (joined: CameraView) => joined.position.clone().sub(joined.target).setY(0)

/** View of `target` from `distance` away, `pitchDeg` above the horizon, on the horizontal `side` of it. */
function viewFromSide(
  target: Vector3,
  side: Vector3,
  pitchDeg: number,
  distance: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
): CameraView {
  const back = side.clone()
  if (back.lengthSq() < 1e-12) back.set(1, 0, 1)
  back.normalize().multiplyScalar(Math.cos(pitchDeg * DEG)).addScaledVector(UP, Math.sin(pitchDeg * DEG))
  const position = target.clone().addScaledVector(back, distance)
  return { target, position: keepAboveGround(position, frame, sample, exaggeration) }
}

/**
 * Overview of the whole track (or of its stretch `range`: a day) for a frame of `aspect` (width / height), seen from
 * the side the `joined` flight view looks from.
 */
export function overviewView(
  path: TrackPath,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  aspect: number,
  joined: CameraView,
  range?: PathRange,
  focalMm = DEFAULT_FOCAL_MM,
): CameraView {
  const { target, diagonal } = trackFraming(path, frame, sample, exaggeration, range)
  return viewFromSide(target, sideOf(joined), OVERVIEW_PITCH_DEG, overviewDistanceM(diagonal, aspect, focalMm), frame, sample, exaggeration)
}

/**
 * What the region view of a 'situation' shot aims at: the centre of the highlighted `region` when there is one, else
 * the overview's target; on the ground.
 */
export function situationTarget(
  path: TrackPath,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  region: RegionFrame | null = null,
): Vector3 {
  if (!region) return trackFraming(path, frame, sample, exaggeration).target
  const { lon, lat } = region.centre
  return frame.toLocal(lon, lat, (sample?.(lon, lat) ?? 0) * exaggeration)
}

/**
 * Region view of a 'situation' shot: by default the overview's side, higher and steeper, aimed at the centre of the
 * highlighted `region` when there is one (else at the overview's target). `framing` (« Cadrage », each field
 * optional): tilt from the vertical, distance (km, as is, instead of the automatic one; still within the reach of
 * the terrain and never nearer than the overview), heading north up turned by a bearing ('boussole'), headroom (the
 * view moved up by that share of the frame height, so the target sits that much below the middle).
 */
export function regionView(
  path: TrackPath,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  aspect: number,
  joined: CameraView,
  {
    height = 'region',
    region = null,
    framing = {},
    focalMm = DEFAULT_FOCAL_MM,
  }: { height?: StartHeight; region?: RegionFrame | null; framing?: SituationFraming; focalMm?: number } = {},
): CameraView {
  const track = trackFraming(path, frame, sample, exaggeration)
  const target = region ? situationTarget(path, frame, sample, exaggeration, region) : track.target
  const offsetM = Math.hypot(target.x - track.target.x, target.z - track.target.z)
  const pitchDeg = framing.tiltDeg === undefined ? REGION_PITCH_DEG : 90 - framing.tiltDeg
  const chosenM = framing.distanceKm === undefined ? undefined : framing.distanceKm * 1000
  const distance = regionDistanceM(track.diagonal, track.halfSideM, aspect, height, region ?? undefined, offsetM, pitchDeg, chosenM, focalMm)
  // 'boussole': looking toward the bearing (+X east, -Z north), so the camera stands on the opposite side
  const bearing = (framing.bearingDeg ?? 0) * DEG
  const side = framing.heading === 'boussole' ? new Vector3(-Math.sin(bearing), 0, Math.cos(bearing)) : sideOf(joined)
  const view = viewFromSide(target, side, pitchDeg, distance, frame, sample, exaggeration)
  const headroom = (framing.headroomPct ?? 0) / 100
  if (headroom <= 0) return view
  // up in the frame: perpendicular to the line of sight, in its vertical plane
  const back = view.position.clone().sub(view.target).normalize()
  const up = UP.clone().addScaledVector(back, -back.y).normalize()
  const shift = up.multiplyScalar(2 * headroom * distance * tanHalfFov(focalMm))
  return { target: view.target.clone().add(shift), position: keepAboveGround(view.position.clone().add(shift), frame, sample, exaggeration) }
}

/**
 * Framing of the region view that sees its `target` from `position` (« Capturer la vue actuelle »): tilt from the
 * vertical, distance and compass bearing of the line of sight, rounded and kept within their ranges.
 */
export function situationFramingOf(position: Vector3, target: Vector3): Required<Pick<SituationFraming, 'tiltDeg' | 'distanceKm' | 'bearingDeg'>> {
  const back = position.clone().sub(target)
  const distance = Math.max(1, back.length())
  const tilt = Math.acos(clamp(back.y / distance, -1, 1)) / DEG
  const bearing = (Math.atan2(-back.x, back.z) / DEG + 360) % 360
  const { min, max, step } = SITUATION_DISTANCE_KM_RANGE
  return {
    tiltDeg: clamp(Math.round(tilt), SITUATION_TILT_RANGE.min, SITUATION_TILT_RANGE.max),
    distanceKm: clamp(Math.round(distance / 1000 / step) * step, min, max),
    bearingDeg: Math.round(bearing) % 360,
  }
}

/**
 * Unit direction `k` of the way from `a` to `b` (target → camera): the tilt above the horizon goes from one's to the
 * other's, the heading turns the short way round. Interpolating the 3D vectors instead went through the zenith when
 * the two headings were opposite (a region view facing north, a flight view facing south): the camera dived nose
 * down and spun round in half a second. A vertical direction takes the other's heading.
 */
function blendDirections(a: Vector3, b: Vector3, k: number): Vector3 {
  const tiltA = Math.asin(clamp(a.y, -1, 1))
  const tiltB = Math.asin(clamp(b.y, -1, 1))
  const level = (v: Vector3) => Math.hypot(v.x, v.z) > 1e-9
  const headingA = level(a) ? Math.atan2(a.x, -a.z) : Math.atan2(b.x, -b.z)
  const headingB = level(b) ? Math.atan2(b.x, -b.z) : headingA
  const turn = Math.atan2(Math.sin(headingB - headingA), Math.cos(headingB - headingA))
  const tilt = tiltA + (tiltB - tiltA) * k
  const heading = headingA + turn * k
  return new Vector3(Math.cos(tilt) * Math.sin(heading), Math.sin(tilt), -Math.cos(tilt) * Math.cos(heading))
}

/**
 * View `k` of the way from `a` to `b` (exactly `a` at 0 and `b` at 1). `panWithZoom` (shots): the aim moves as the
 * distance changes rather than with `k`, so a point framed at both ends (the marker) stays in the frame on the way.
 */
export function blendViews(
  a: CameraView,
  b: CameraView,
  k: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  panWithZoom = false,
): CameraView {
  if (k <= 0) return a
  if (k >= 1) return b
  const fromA = a.position.clone().sub(a.target)
  const fromB = b.position.clone().sub(b.target)
  const da = Math.max(1, fromA.length())
  const db = Math.max(1, fromB.length())
  const direction = blendDirections(fromA.divideScalar(da), fromB.divideScalar(db), k)
  const distance = da ** (1 - k) * db ** k
  const target = a.target.clone().lerp(b.target, panWithZoom && Math.abs(da - db) > 1 ? (da - distance) / (da - db) : k)
  const position = target.clone().addScaledVector(direction.normalize(), distance)
  return { target, position: keepAboveGround(position, frame, sample, exaggeration) }
}

/**
 * How much higher (metres, 0 or more) the camera of `view`, a blend of a wide view and the `flight` view, must be so
 * that it stays on a glide slope of SHOT_GLIDE_DEG over the flight camera (no dive far from it), clears the ground under
 * it by SHOT_CLEARANCE_SHARE of its distance and does not hide its aim behind the relief (the straight line of the
 * blend knows nothing of the terrain between the two views). The aim checked is the one before « Espace devant », for the
 * `flightShare` of the flight view in `view`: the lead aims ahead of the marker, often into the slope it climbs, and lifting
 * the camera over that would drop the marker out of the frame.
 */
function shotLift(view: CameraView, flight: CameraView, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number, flightShare = 1): number {
  const { position, target } = view
  // where the floor takes over from the blend, the camera's climb changes pace over a stretch, not at a point
  const softM = SHOT_SOFT_SHARE * position.distanceTo(target)
  let floorY = flight.position.y + Math.hypot(position.x - flight.position.x, position.z - flight.position.z) * Math.tan(SHOT_GLIDE_DEG * DEG)
  if (sample) {
    const clearance = Math.max(MIN_GROUND_CLEARANCE_M, SHOT_CLEARANCE_SHARE * position.distanceTo(target))
    // the blended aim's height knows nothing of the ground under it either: buried in a slope, no line could clear the
    // relief up to it (the lift would be the depth × 1 / (1 − f), km for a few hundred metres): the line ends on the
    // ground above it
    const end = target.clone()
    if ('aim' in flight && flight.aim instanceof Vector3) end.addScaledVector(flight.aim.clone().sub(flight.target), flightShare)
    const aim = frame.toLonLat(end)
    const aimGround = sample(aim.lon, aim.lat)
    if (aimGround !== undefined) end.y = Math.max(end.y, frame.toLocal(aim.lon, aim.lat, aimGround * exaggeration).y)
    const point = new Vector3()
    for (let i = 0; i <= SHOT_SIGHT_SAMPLES; i++) {
      const f = (0.9 * i) / SHOT_SIGHT_SAMPLES
      const at = frame.toLonLat(point.lerpVectors(position, end, f))
      const ground = sample(at.lon, at.lat)
      if (ground === undefined) continue
      // the line from the camera to the aim, at f of the way, must pass `clearance · (1 − f)` over the ground there
      const need = frame.toLocal(at.lon, at.lat, ground * exaggeration).y + Math.max(clearance * (1 - f), LINE_OF_SIGHT_MIN_CLEARANCE_M)
      // its lift eased out where a metre of ground lifts the camera by more than LINE_OF_SIGHT_FINE_GAIN (camera.ts)
      const u = clamp(2 - 1 / ((1 - f) * LINE_OF_SIGHT_FINE_GAIN), 0, 1)
      floorY = Math.max(floorY, end.y + ((need - end.y) * u * u * (3 - 2 * u)) / (1 - f))
    }
  }
  return Math.max(0, smoothMax(position.y, floorY, softM) - position.y)
}

/**
 * `view` (a blend `k`, 0..1 exclusive, of a wide view and the `flight` view) raised by `liftM`, eased in and out toward
 * each end view: over SHOT_EASE_SHARE of the blend, and longer the higher the lift is (up to SHOT_EASE_MAX_SHARE), or
 * the camera would drop kilometres in a fraction of a second where the glide slope asks for more than an end view's height.
 */
function liftedOnTheWay(view: CameraView, k: number, liftM: number): CameraView {
  if (!(liftM > 0)) return view
  const { position, target } = view
  const easeShare = Math.min(SHOT_EASE_MAX_SHARE, SHOT_EASE_SHARE + liftM / (SHOT_EASE_LIFT * position.distanceTo(target)))
  const share = smootherstep(Math.min(k, 1 - k) / easeShare)
  if (share <= 0) return view
  return { target, position: position.clone().setY(position.y + liftM * share) }
}

/**
 * The view `k` (0..1, exclusive) of the way from `from` to `to`, one of which is the `flight` view, lifted over the
 * relief and eased toward the ends. The camera takes ahead the lift the relief will ask for around: a crest passing
 * under the line of sight asks 2 km in less than half a second. The lift is read at fixed points of the blend, and
 * each point's lift counts in full within SHOT_LIFT_HOLD of the blend and down to nothing (raised cosine) at
 * SHOT_LIFT_REACH: a smooth function of `k`. The lifts above the ground raise the camera only: its aim goes up as
 * much, so the tilt eases from one end view's to the other's instead of tipping down at the ground. With a telephoto
 * (`focalMm` over the default), the lift scales with the distance but the frame is narrower by the same factor: the aim
 * is raised that much less (`aimShare`), or the marker would leave the frame on the way.
 */
function liftedBlend(
  from: CameraView,
  to: CameraView,
  k: number,
  flight: CameraView,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  focalMm: number,
): CameraView {
  const blended = blendViews(from, to, k, frame, sample, exaggeration, true)
  if (!(k > 0 && k < 1)) return blended
  // the share of the flight view in the blend at `at` (`shotLift`)
  const flightShare = (at: number) => (to === flight ? at : from === flight ? 1 - at : 0)
  let liftM = 0
  for (let i = 1; i < SHOT_LIFT_POINTS; i++) {
    const at = i / SHOT_LIFT_POINTS
    const away = Math.abs(at - k)
    if (away >= SHOT_LIFT_REACH) continue
    const weight = away <= SHOT_LIFT_HOLD ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (away - SHOT_LIFT_HOLD)) / (SHOT_LIFT_REACH - SHOT_LIFT_HOLD))
    liftM = Math.max(liftM, weight * shotLift(blendViews(from, to, at, frame, sample, exaggeration, true), flight, frame, sample, exaggeration, flightShare(at)))
  }
  // never less than this very point's lift
  liftM = Math.max(liftM, shotLift(blended, flight, frame, sample, exaggeration, flightShare(k)))
  const { position } = liftedOnTheWay(blended, k, liftM)
  const free = blendViews(from, to, k, frame, null, exaggeration, true)
  const aimShare = 1 / Math.max(1, focalDolly(focalMm))
  return { target: blended.target.clone().setY(blended.target.y + (position.y - free.position.y) * aimShare), position }
}

/** Marker position on the draped track at `progress` (as `computeCameraView` places it). */
export function markerAt(path: TrackPath, progress: number, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number, liftM: number): Vector3 {
  const d = clamp(progress, 0, 1) * path.lengthM
  const at = samplePath(path, d)
  return frame.toLocal(at.lon, at.lat, pathHeightM(path, d, at, sample) * exaggeration + liftM)
}

/**
 * `view` moved to the centre of the `group` positions (on the ground), from the same direction, far enough for their
 * spread to fit the frame (GROUP_FRAMING_MARGIN) and never nearer than `view`: continuous as the racers move.
 */
export function framedGroup(
  view: CameraView,
  group: readonly { lon: number; lat: number; ele?: number }[],
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  aspect: number,
  focalMm = DEFAULT_FOCAL_MM,
): CameraView {
  if (group.length < 2) return view
  const points = group.map((g) => frame.toLocal(g.lon, g.lat, (sample?.(g.lon, g.lat) ?? g.ele ?? 0) * exaggeration))
  const target = points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(points.length)
  const spread = Math.max(...points.map((p) => Math.hypot(p.x - target.x, p.z - target.z)))
  const back = view.position.clone().sub(view.target)
  const fit = (GROUP_FRAMING_MARGIN * spread * portraitFactor(aspect)) / tanHalfFov(focalMm)
  const distance = Math.max(back.length(), fit)
  if (back.lengthSq() < 1e-12) back.copy(UP)
  const position = target.clone().addScaledVector(back.normalize(), distance)
  return { target, position: keepAboveGround(position, frame, sample, exaggeration) }
}

// ---------------------------------------------------------------------------
// Film view
// ---------------------------------------------------------------------------

/** What the flight camera flies instead of the film track at a progress (several tracks, `flyover/follow.ts`). */
export interface FollowedFlight {
  path: TrackPath
  progress: number
  /** the film's marker stays on the film track (a ghost racer is followed); else it is on `path` (a stage) */
  markerOnFilm?: boolean
  /** positions the camera frames together (« Toutes les traces ») */
  group?: readonly { lon: number; lat: number; ele?: number }[]
  /** « Bilan »: the camera does not fly, it holds the high view of this path (the region of the stage), the marker stays on `path` */
  overview?: TrackPath
}

export interface FilmViewOptions extends Omit<CameraViewOptions, 'timeS' | 'orbitRad'> {
  /** width / height of the frame (overview framing) */
  aspect: number
  /** administrative region of the outing, framed by a 'situation' shot that highlights it (osm/region.ts) */
  region?: RegionFrame | null
  /** what the flight camera follows at a film progress (null or absent: the film track itself) */
  follow?: ((progress: number) => FollowedFlight | null) | null
  /** how many times the terrain behind `sample` changed (tiles loaded or dropped): see `raiseTable` */
  terrainVersion?: number
  /** the photo pins the flight camera turns towards (« Photos sur le terrain », `pinAim.ts`); none or absent: it does not turn */
  pins?: readonly AimPin[]
}

export interface FilmView extends CameraView {
  /** marker position on the draped track (the target only during the flight) */
  marker: Vector3
  /**
   * roll of the camera about its line of sight (radians, > 0 = banking right; 0 when absent): the flight camera's, which the
   * shots, the high views and the camera keys take away as they take the view over (`lookAtView` applies it)
   */
  rollRad?: number
}

const _sight = new Vector3()

/** Point `camera` at the target of `view`, rolled by its `rollRad` about the line of sight (the horizon tilts in a bend). */
export function lookAtView(camera: Pick<PerspectiveCamera, 'up' | 'lookAt'>, view: CameraView & Pick<FilmView, 'rollRad'>): void {
  camera.up.set(0, 1, 0)
  if (view.rollRad) camera.up.applyAxisAngle(_sight.subVectors(view.target, view.position).normalize(), view.rollRad)
  camera.lookAt(view.target)
}

/**
 * What a keyframe pose is placed around: the film's aim point, the direction of travel, the automatic distance (with the
 * lens's dolly: a key frames the same with any focal length), and a stop's widening (0..1) and orbit (radians).
 */
export interface KeyBase {
  target: Vector3
  reference: Vector3
  autoDistanceM: number
  wide: number
  orbitRad: number
}

/**
 * Between and around the keys, the direction a keyframe is placed around is averaged over at least ± the track the flight
 * covers in this much film time (at its average speed). At 10 km of track per film second over hairpins, the 6 km it is
 * otherwise averaged over turned 50° a kilometre and swung the view round at 350 deg/s; with 5 s the film stays under 70 deg/s.
 * At a key it is still the plain one (`flightAt`: `keyTurn`), so a key keeps the image it was taken with.
 */
export const KEY_REFERENCE_SMOOTHING_S = 5

/**
 * Direction of travel a keyframe's heading is measured from at `d` metres: the default turn window averaged over four
 * of them, set by the track alone, so a keyframe keeps its pose when the camera settings change. With the flight's average
 * `speedMps` (metres per film second): wider where KEY_REFERENCE_SMOOTHING_S of film asks, the direction the film places its
 * keys around between them (a track flown fast does not whip the view round); a slower film keeps its reference.
 */
export function keyReferenceAt(path: TrackPath, d: number, frame: LocalFrame, speedMps = 0): Vector3 {
  const w = headingWindowM(path, DEFAULT_CAMERA)
  return smoothHeadingAt(path, d, w, Math.max(4 * w, speedMps * KEY_REFERENCE_SMOOTHING_S), frame)
}

/** Right of the horizontal direction `reference` (seen from above). */
const rightOf = (reference: Vector3) => new Vector3(-reference.z, 0, reference.x)
/** Highest pitch of a keyframe: straight down has no heading. */
const KEY_MAX_PITCH_DEG = 89.999

/** Camera of keyframe pose `f` around `base`: no style, smoothing or clearance, so it is the view that was taken. */
export function keyView(base: KeyBase, f: KeyFraming): CameraView {
  const { reference } = base
  const right = rightOf(reference)
  const target = base.target.clone().addScaledVector(reference, f.aimAheadM).addScaledVector(right, f.aimRightM)
  const { distance, pitchDeg } = widenedCamera(f, base.wide)
  const angle = f.headingOffsetDeg * DEG + base.orbitRad
  const pitch = clamp(pitchDeg, 0, KEY_MAX_PITCH_DEG) * DEG
  const distanceM = base.autoDistanceM * distance
  const look = reference.clone().multiplyScalar(Math.cos(angle)).addScaledVector(right, Math.sin(angle))
  const position = target.clone().addScaledVector(look, -distanceM * Math.cos(pitch))
  position.y += distanceM * Math.sin(pitch)
  return { target, position }
}

/**
 * Keyframe pose of a camera at `position` looking toward `lookAt` around `base` (the inverse of `keyView`). The aim
 * point is taken on the line of sight at the height of the film's aim point, so a panned view keeps its look.
 */
export function keyFramingFrom(base: KeyBase, position: Vector3, lookAt: Vector3): KeyFraming {
  const { reference } = base
  const right = rightOf(reference)
  const sight = lookAt.clone().sub(position)
  const along = sight.y < -1e-9 ? (base.target.y - position.y) / sight.y : -1
  const aim = along > 0 ? position.clone().addScaledVector(sight, along) : lookAt.clone().setY(base.target.y)
  const back = position.clone().sub(aim)
  const distanceM = Math.max(1e-3, back.length())
  const angle = Math.atan2(-back.dot(right), -back.dot(reference)) - base.orbitRad
  const shift = aim.sub(base.target)
  const widened = 1 + (STOP_WIDE_DISTANCE_FACTOR - 1) * base.wide
  return {
    distance: distanceM / base.autoDistanceM / widened,
    pitchDeg: Math.asin(clamp(back.y / distanceM, -1, 1)) / DEG - STOP_WIDE_PITCH_DEG * base.wide,
    headingOffsetDeg: ((((angle / DEG + 180) % 360) + 360) % 360) - 180,
    aimRightM: shift.dot(right),
    aimAheadM: shift.dot(reference),
  }
}

/**
 * Raises of the flight camera at the instants of `anticipatedRaise` (film time → raise in metres and the terrain version
 * it was computed with), one table per terrain sampler, emptied when another input changes. A frame computes only the
 * instants that came into reach since the frame before (about one flight camera every ANTICIPATION_STEP_S of film) and,
 * while tiles arrive, refreshes the instant nearest to now computed on an older terrain, its raise moving a little toward
 * the sharper terrain's each time (RAISE_REFRESH_SHARE): the camera height follows the sharper terrain over a few frames,
 * never with a jump, and the anticipation costs about one more flight camera at most per frame.
 */
interface RaiseTable {
  inputs: readonly unknown[]
  raises: Map<number, { raiseM: number; version: number }>
}

const raiseTables = new WeakMap<HeightSampler, RaiseTable>()

function raiseTable(sample: HeightSampler, inputs: readonly unknown[]): RaiseTable['raises'] {
  const table = raiseTables.get(sample)
  if (table && table.inputs.length === inputs.length && table.inputs.every((input, i) => input === inputs[i])) return table.raises
  const raises: RaiseTable['raises'] = new Map()
  raiseTables.set(sample, { inputs, raises })
  return raises
}

/**
 * The flight camera at a film state, before the keyframes, and what a keyframe is placed around there. Its height above
 * the ground is the anticipated raise of the film instants around (`anticipatedRaise`), not its own.
 */
function flightAt(
  path: TrackPath,
  clock: FilmClock,
  state: FilmState,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
): { flight: FilmView; base: KeyBase; captureBase: KeyBase; keyTurn: (key: FilmCameraKey) => number } {
  const flown = flownAt(path, clock, state, progress, frame, sample, options)
  const { followed, flightPath, wide, orbitRad } = flown
  if (sample) {
    const { camera, exaggeration, liftM, durationS, aspect, follow, terrainVersion: version = 0 } = options
    const raises = raiseTable(sample, [path, clock, frame, camera, exaggeration, liftM, durationS, aspect, follow])
    // the progress holds still during the opening and closing shots, so does the flight view they blend with
    const timeS = clamp(state.timeS, clock.openingS, clock.openingS + clock.flightS)
    // the instant refreshed this frame: the nearest to now that was computed on an older terrain (the first in time
    // order starved the others while tiles kept arriving, and the ones that count most went stale)
    let stale: number | undefined
    for (let k = Math.ceil((timeS - ANTICIPATION_REACH_S) / ANTICIPATION_STEP_S); k * ANTICIPATION_STEP_S < timeS + ANTICIPATION_REACH_S; k++) {
      const instantS = k * ANTICIPATION_STEP_S
      const known = raises.get(instantS)
      if (known && known.version !== version && (stale === undefined || Math.abs(instantS - timeS) < Math.abs(stale - timeS))) stale = instantS
    }
    const raiseAt = (instantS: number) => {
      const known = raises.get(instantS)
      if (known && instantS !== stale) return known.raiseM
      const fresh = flownAt(path, clock, clock.stateAt(instantS), clock.progressAtTime(instantS), frame, sample, options).view.raiseM
      if (!known) {
        raises.set(instantS, { raiseM: fresh, version })
        return fresh
      }
      // on a sharper terrain the raise moves a little each time it is refreshed (it stays stale until it has got there), so
      // a whole terrain arriving at once is a climb over a few frames, not a step of a hundred metres
      const reach = RAISE_REFRESH_SHARE * flown.view.position.distanceTo(flown.view.target)
      const raiseM = known.raiseM + clamp(fresh - known.raiseM, -reach, reach)
      raises.set(instantS, { raiseM, version: raiseM === fresh ? version : known.version })
      return raiseM
    }
    flown.view.position.y += anticipatedRaise(raiseAt, timeS) - flown.view.raiseM
    flown.view.target = flown.view.leadTarget(flown.view.position)
  }
  const view = flown.view
  const marker = followed?.markerOnFilm ? markerAt(path, progress, frame, sample, options.exaggeration, options.liftM) : view.marker
  const framed = followed?.group ? framedGroup(view, followed.group, frame, sample, options.exaggeration, options.aspect, focalOf(options)) : view
  const flight = followed ? { ...framed, marker } : view
  const speedMps = flightPath.lengthM / Math.max(1, options.durationS ?? DEFAULT_FLYOVER_DURATION_S)
  const at = (followed?.progress ?? progress) * flightPath.lengthM
  // a key is placed around the aim before « Espace devant » moved it, so it keeps its pose whatever that setting
  const target = framed === view ? view.aim : flight.target
  const base = { target, reference: keyReferenceAt(flightPath, at, frame, speedMps), autoDistanceM: autoDistanceM(flightPath) * focalDolly(focalOf(options)), wide, orbitRad }
  /**
   * How far the key's reference is turned from the one that calms the view (radians): `keyReferenceAt` at the key's own place
   * without and with the film-time average, so the key's pose there is placed around the reference it was taken with
   */
  const keyTurn = (key: FilmCameraKey) => {
    let d = key.atM
    if (followed) {
      // a key is placed on the film track: on the followed one only where the flight is on it
      const held = options.follow?.(key.atM / Math.max(1, path.lengthM))
      if (held?.path !== flightPath) return 0
      d = held.progress * flightPath.lengthM
    }
    const heading = (v: Vector3) => Math.atan2(v.x, -v.z)
    const turn = heading(keyReferenceAt(flightPath, d, frame)) - heading(keyReferenceAt(flightPath, d, frame, speedMps))
    return Math.atan2(Math.sin(turn), Math.cos(turn))
  }
  // the capture is made against the reference as it was before (the average only calms what the film does around the keys)
  return { flight, base, captureBase: { ...base, reference: keyReferenceAt(flightPath, at, frame) }, keyTurn }
}

/** The flight camera of `computeCameraView` at a film state (stop cameras, time smoothing, followed track), with its own raise. */
function flownAt(
  path: TrackPath,
  clock: FilmClock,
  state: FilmState,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
) {
  const { aspect: _aspect, region: _region, follow, terrainVersion: _version, ...flightOptions } = options
  const stop = state.stop
  const settings = options.camera ?? DEFAULT_CAMERA
  const wide = stop?.camera === 'large' ? stopBump(state.localS, state.lengthS) : 0
  const widened = wide > 0 ? widenedCamera(settings, wide) : settings
  // « Inclinaison » of a stop: held through the hold, eased in and out
  const tilt = stop?.tiltDeg ? stop.tiltDeg * stopHoldWeight(state.localS, state.lengthS) : 0
  const camera = tilt ? { ...widened, pitchDeg: widened.pitchDeg + tilt } : widened
  const orbitRad =
    stop?.camera === 'orbite' ? stopOrbitRad(stop.addedS, state.localS, state.lengthS) : stop?.camera === 'panorama' ? stopPanoramaRad(state.localS, state.lengthS) : 0
  const motionS = stop?.camera === 'fixe' ? heldMotionTimeS(stop, state.timeS) - clock.openingS : state.flightTimeS
  const smoothing = timeSmoothing(clock, state.timeS, motionS, camera)
  const followed = follow?.(progress) ?? null
  const flightPath = followed?.path ?? path
  // a smoothed progress on the followed path, dropped when it falls on another stage or racer
  const along = (p: number | undefined) => {
    if (p === undefined || !followed) return p
    const other = follow?.(p)
    return other && other.path === followed.path ? other.progress : undefined
  }
  const view = computeCameraView(flightPath, followed?.progress ?? progress, frame, sample, {
    ...flightOptions,
    camera,
    orbitRad,
    speedMps: groundSpeedMps(clock, state.timeS, path.lengthM),
    motion: motionShares(clock, state.timeS, camera, options.durationS ?? DEFAULT_FLYOVER_DURATION_S),
    ...smoothing,
    aimProgress: along(smoothing.aimProgress),
    cameraProgress: along(smoothing.cameraProgress),
  })
  return { view, followed, flightPath, wide, orbitRad }
}

/**
 * The keyframe pose that shows the camera at `position` looking toward `lookAt` at film time `timeS` and `progress`
 * (« Ajouter une image clé »): `computeFilmView` shows that very view at the keyframe.
 */
export function keyFramingAt(
  path: TrackPath,
  clock: FilmClock,
  timeS: number,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
  position: Vector3,
  lookAt: Vector3,
): KeyFraming {
  const base =
    options.camera?.style === 'free'
      ? freeKeyBase(path, progress * path.lengthM, frame, sample, options)
      : flightAt(path, clock, clock.stateAt(timeS), progress, frame, sample, options).captureBase
  const f = keyFramingFrom(base, position, lookAt)
  const { distance, pitchDeg } = CAMERA_KEY_RANGES
  return { ...f, distance: clamp(f.distance, distance.min, distance.max), pitchDeg: clamp(f.pitchDeg, pitchDeg.min, pitchDeg.max) }
}

/**
 * What a keyframe of the 'free' style is placed around: its own place on the film track (the marker there, the
 * direction of travel there), not the marker's place now. Its pose is fixed in the scene.
 */
function freeKeyBase(path: TrackPath, atM: number, frame: LocalFrame, sample: HeightSampler | null, options: FilmViewOptions): KeyBase {
  const target = markerAt(path, atM / Math.max(1, path.lengthM), frame, sample, options.exaggeration, options.liftM)
  return { target, reference: keyReferenceAt(path, atM, frame), autoDistanceM: autoDistanceM(path) * focalDolly(focalOf(options)), wide: 0, orbitRad: 0 }
}

/**
 * Camera of the 'free' style at film time `timeS`: it follows nothing but the keyframes. Without any, the overview of
 * the whole track, looking along the start's direction of travel; else the first key's pose up to its time, the last
 * one's after it, eased from one to the next in between by smootherstep over the film time (so it keeps gliding
 * through a stop, while the marker holds; kept above the ground halfway, as `keyPoseAt` does). Stops, smoothing and
 * the flight styles' motions do not move it.
 */
function freeView(
  path: TrackPath,
  clock: FilmClock,
  timeS: number,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
): FilmView {
  const followed = options.follow?.(progress) ?? null
  const marker =
    followed && !followed.markerOnFilm
      ? markerAt(followed.path, followed.progress, frame, sample, options.exaggeration, options.liftM)
      : markerAt(path, progress, frame, sample, options.exaggeration, options.liftM)
  const keys = clock.cameraKeys
  const poseOf = (key: FilmCameraKey) => keyView(freeKeyBase(path, key.atM, frame, sample, options), keyFraming(key))
  if (keys.length === 0) {
    const along = { target: new Vector3(), position: keyReferenceAt(path, 0, frame).negate() }
    return { ...overviewView(path, frame, sample, options.exaggeration, options.aspect, along, undefined, focalOf(options)), marker }
  }
  const next = keys.findIndex((k) => k.timeS > timeS)
  if (next === 0) return { ...poseOf(keys[0]), marker }
  if (next === -1) return { ...poseOf(keys[keys.length - 1]), marker }
  const a = keys[next - 1]
  const b = keys[next]
  const u = b.timeS > a.timeS ? (timeS - a.timeS) / (b.timeS - a.timeS) : 1
  const view = blendViews(poseOf(a), poseOf(b), smootherstep(u), frame, null, options.exaggeration)
  return { target: view.target, position: keyClearance(view.position, 4 * u * (1 - u), frame, sample, options.exaggeration), marker }
}

/**
 * The route whose high view is on at film time `timeS` (metres of the path) and how far the camera is up (0..1): during
 * the night pause before a day with `view`, that day; « À la suite », during the night of a junction with `view`, the
 * stage it ends. The camera rises over the dusk, holds over the night and comes back down over the dawn (the parts of
 * `film.nights`, as the sun reads them, but never shorter than DAY_VIEW_MIN_SHARE of the pause), null outside.
 */
export function dayViewAt(clock: Pick<FilmClock, 'days' | 'nights' | 'junctions'>, timeS: number): { fromM: number; toM: number; k: number; day?: ClockDay } | null {
  const night = nightAt(clock, timeS)
  if (!night) return null
  const day = clock.days.find((d) => d.night === night && d.view)
  const j = day ? -1 : clock.junctions.findIndex((junction) => junction.view && junction.startS === night.startS)
  if (!day && j < 0) return null
  const route = day ? { fromM: day.startM, toM: day.endM, day } : { fromM: clock.junctions[j - 1]?.atM ?? 0, toM: clock.junctions[j].atM }
  const pauseS = night.endS - night.startS
  const parts = night.duskS + night.nightS + night.dawnS
  const scale = parts > 0 ? pauseS / parts : 0
  const up = Math.min(Math.max(night.duskS * scale, DAY_VIEW_MIN_SHARE * pauseS), 0.5 * pauseS)
  const down = Math.min(Math.max(night.dawnS * scale, DAY_VIEW_MIN_SHARE * pauseS), 0.5 * pauseS)
  const k = smootherstep((timeS - night.startS) / up) * (1 - smootherstep((timeS - (night.endS - down)) / down))
  return { ...route, k }
}

/** How long the camera takes to rise over the stage at the start of « Revoir l'étape finie » (seconds, at most). */
const RECAP_RISE_S = 2.5

/**
 * « Revoir l'étape finie » without a night: from the start of its pause (`ClockJunction.recap`, just before the cut) to
 * the cut, the camera up over the stage that ends (rising over RECAP_RISE_S, at most 60 % of the pause), then the
 * passage takes the next stage from the flight camera (under the dip of a fade, at once for a cut); null outside.
 */
export function recapViewAt(clock: Pick<FilmClock, 'junctions'>, timeS: number): { fromM: number; toM: number; k: number } | null {
  const j = clock.junctions.findIndex((junction) => junction.recap !== undefined && timeS >= junction.recap.startS && timeS < junction.holdStartS)
  if (j < 0) return null
  const { recap, atM } = clock.junctions[j]
  const rise = Math.min(RECAP_RISE_S, 0.6 * (recap!.endS - recap!.startS))
  return { fromM: clock.junctions[j - 1]?.atM ?? 0, toM: atM, k: rise > 0 ? smootherstep((timeS - recap!.startS) / rise) : 1 }
}

/** The high view of a route on at `timeS`: a day's or a stage's over a night (`dayViewAt`), or a stage's before its passage (`recapViewAt`). */
export function highViewAt(clock: Pick<FilmClock, 'days' | 'nights' | 'junctions'>, timeS: number): { fromM: number; toM: number; k: number } | null {
  return dayViewAt(clock, timeS) ?? recapViewAt(clock, timeS)
}

/** « Bilan »: the overview of `region` (a region's tracks as one path), north up (the camera stands south of it). */
function bilanView(region: TrackPath, held: FollowedFlight, frame: LocalFrame, sample: HeightSampler | null, options: FilmViewOptions): FilmView {
  const north = { target: new Vector3(), position: new Vector3(0, 0, 1) }
  const view = overviewView(region, frame, sample, options.exaggeration, options.aspect, north, undefined, focalOf(options))
  return { ...view, marker: markerAt(held.path, held.progress, frame, sample, options.exaggeration, options.liftM) }
}

/**
 * Camera at film time `timeS` and `progress` (the store's: the export nudges it to re-place the camera). The time-based
 * flight styles follow the flight time, so they start where the opening hands over. The aim and the camera follow the
 * progress smoothed in film time (`timeSmoothing.ts`; stops keep the marker's progress and time). The keyframes take
 * the flight camera to their exact pose (`keyView`; eased in and out over `cameraKeyEaseM`, kept above the ground
 * halfway between two). With several tracks the flight camera flies what `options.follow` gives, the shots still frame
 * the film track; smoothed progresses are never averaged across a stage cut or a change of leader.
 */
export function computeFilmView(
  path: TrackPath,
  clock: FilmClock,
  timeS: number,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
): FilmView {
  const { pins } = options
  if (!pins || pins.length === 0) return computeFlownView(path, clock, timeS, progress, frame, sample, options)
  const held = options.follow?.(progress)
  const view = computeFlownView(path, clock, timeS, progress, frame, sample, options, held)
  if (held?.overview) return view
  // the turn is the flight's: it fades with the flight's share of the view (the opening and closing shots and the high views
  // of the nights blend it in and out, so the aim never jumps at their edges), and the camera keys take it away as they take
  // the view over
  const state = clock.stateAt(timeS)
  let flight = 1
  if (state.phase === 'opening' || state.phase === 'closing') {
    const shot = state.phase === 'opening' ? clock.opening : clock.closing
    const wide = shotWeight(shot, state.phase, state.localS, state.lengthS)
    flight = state.phase === 'opening' ? wide : 1 - wide
  } else {
    const high = highViewAt(clock, timeS)
    if (high) flight = 1 - high.k
  }
  const easeM = cameraKeyEaseM(path.lengthM, options.durationS ?? DEFAULT_FLYOVER_DURATION_S)
  const keyed = keyPoseAt(clock.cameraKeys, progress * path.lengthM, easeM)
  return aimTowardsPins(view, pins, timeS, frame, sample, options.exaggeration, options.liftM, flight * (1 - (keyed?.weight ?? 0)), {
    aspect: options.aspect,
    fovDeg: fovDegOf(focalOf(options)),
  })
}

function computeFlownView(
  path: TrackPath,
  clock: FilmClock,
  timeS: number,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
  held = options.follow?.(progress),
): FilmView {
  // « Bilan »: the camera holds the high view of the region whatever the shot, stop or key; the marker is on the outing being drawn
  if (held?.overview) return bilanView(held.overview, held, frame, sample, options)
  const state = clock.stateAt(timeS)
  const { aspect, region } = options
  const flight = options.camera?.style === 'free' ? freeView(path, clock, timeS, progress, frame, sample, options) : keyedFlight()
  function keyedFlight(): FilmView {
    const { flight: filmFlight, base, keyTurn } = flightAt(path, clock, state, progress, frame, sample, options)
    const easeM = cameraKeyEaseM(path.lengthM, options.durationS ?? DEFAULT_FLYOVER_DURATION_S)
    const keyed = keyPoseAt(clock.cameraKeys, progress * path.lengthM, easeM, keyTurn)
    if (!keyed || keyed.weight <= 0) return filmFlight
    // around the reference that calms the view, turned to the one each key was taken with (eased from one key to the next)
    const heading = Math.atan2(base.reference.x, -base.reference.z) + keyed.turn
    const pose = keyView({ ...base, reference: new Vector3(Math.sin(heading), 0, -Math.cos(heading)) }, keyed.framing)
    // blended without a clearance of its own: `keyClearance` gives it one that is none at the exact poses
    const blended = blendViews(filmFlight, pose, keyed.weight, frame, null, options.exaggeration)
    const edge = keyed.weight < 1 ? Math.min(keyed.weight, 1 - keyed.weight) : keyed.free
    return { target: blended.target, position: keyClearance(blended.position, edge, frame, sample, options.exaggeration), marker: filmFlight.marker, rollRad: (filmFlight.rollRad ?? 0) * (1 - keyed.weight) }
  }
  /** `view` with the flight's roll taken away as the flight leaves it: `share` of it (the shots and the high views are level) */
  const withRoll = (view: CameraView, share: number): FilmView => ({ ...view, marker: flight.marker, rollRad: (flight.rollRad ?? 0) * share })
  if (state.phase !== 'opening' && state.phase !== 'closing') {
    const view = highViewAt(clock, timeS)
    if (!view) return flight
    // the night before a day (or after a stage): up to a high view of its route, held, and back down to the marker at dawn
    const high = overviewView(path, frame, sample, options.exaggeration, aspect, flight, { fromM: view.fromM, toM: view.toM }, focalOf(options))
    return withRoll(liftedBlend(flight, high, view.k, flight, frame, sample, options.exaggeration, focalOf(options)), 1 - view.k)
  }

  const phase = state.phase
  const shot = phase === 'opening' ? clock.opening : clock.closing
  const overview =
    shot.style === 'situation'
      ? regionView(path, frame, sample, options.exaggeration, aspect, flight, {
          height: shot.startHeight,
          region: shot.highlight ? region : null,
          framing: shot,
          focalMm: focalOf(options),
        })
      : overviewView(path, frame, sample, options.exaggeration, aspect, flight, undefined, focalOf(options))
  // the shot `localS` seconds in: the wide view (turned by a 'balayage'), the blend's weight and the blend itself
  const shotAt = (localS: number) => {
    const turned = shot.style === 'balayage' ? turnedView(overview, sweepRad(phase, localS, state.lengthS)) : overview
    // turned, the overview may look from behind a slope: kept above the ground like the others
    const wide =
      turned === overview ? overview : { target: turned.target, position: keepAboveGround(turned.position, frame, sample, options.exaggeration) }
    const k = shotWeight(shot, phase, localS, state.lengthS)
    const [from, to] = phase === 'opening' ? [wide, flight] : [flight, wide]
    return { k, from, to, blended: blendViews(from, to, k, frame, sample, options.exaggeration, true) }
  }
  const now = shotAt(state.localS)
  const flightShare = phase === 'opening' ? now.k : 1 - now.k
  if (!(now.k > 0 && now.k < 1)) return withRoll(now.blended, flightShare)
  return withRoll(liftedBlend(now.from, now.to, now.k, flight, frame, sample, options.exaggeration, focalOf(options)), flightShare)
}
