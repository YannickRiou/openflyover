/**
 * Camera of the film: the flight camera (`computeCameraView`) during the flight, with the framing of the camera
 * keys (`keyedCamera`), an overview of the whole track for the opening and closing shots, the camera of each stop
 * ('orbite', 'large', 'fixe'). A pure function of the film time, the progress, the settings and the terrain sampler,
 * like the flight camera: the export renders any frame alone. Shots and transitions: ARCHITECTURE.md "Film and timeline".
 *
 * Overview: target = centre of the track's box, distance = OVERVIEW_DISTANCE_FACTOR x box diagonal (more for a frame
 * taller than wide, so 9:16 keeps the whole track), on the side the flight camera looks from where the shot joins
 * the flight (no turn during the transition). The transition lerps the target, nlerps the direction, interpolates the
 * distance geometrically (smootherstep), stays MIN_GROUND_CLEARANCE_M above the ground and, in between, on a glide
 * slope over the flight camera and clear of the relief on the way (`clearOnTheWay`). A shot that cuts ('coupe',
 * dips to black or white) holds its wide view and cuts at the boundary with the flight (`shotWeight`).
 */
import { Vector3 } from 'three'
import { clamp, smootherstep } from '../core/math'
import type { LocalFrame, LonLat } from '../core/types'
import type { ClockStop, FilmClock, FilmState } from '../film/clock'
import { CAMERA_KEY_RANGES, SITUATION_DISTANCE_KM_RANGE, SITUATION_TILT_DEFAULT_DEG, SITUATION_TILT_RANGE, shotCuts, situationTiming } from '../film/model'
import type { FilmShot, ShotStyle, SituationFraming, StartHeight } from '../film/model'
import type { HeightSampler } from '../scene/trackLineSet'
import {
  LINE_OF_SIGHT_MIN_CLEARANCE_M,
  MIN_GROUND_CLEARANCE_M,
  autoDistanceM,
  computeCameraView,
  headingWindowM,
  movesWithTime,
  smoothHeadingAt,
  type CameraView,
  type CameraViewOptions,
} from './camera'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S, type CameraSettings } from './cameraSettings'
import { pathHeightM } from './flights'
import { samplePath, type TrackPath } from './path'
import { cameraKeyEaseM, keyPoseAt, type KeyFraming } from './cameraKeys'
import { smoothsInTime, timeSmoothing } from './timeSmoothing'

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
/** Vertical field of view of the scene camera (scene/FlyoverCanvas.tsx, offline/plan.ts). */
export const CAMERA_FOV_DEG = 50
/** 'balayage' shot: turn of the overview around its target (degrees), share of the shot it takes. */
export const SWEEP_DEG = 75
export const SWEEP_SHARE = 0.6
/** Glide slope (degrees above the horizon) a shot's camera keeps over the flight view it moves to or from. */
export const SHOT_GLIDE_DEG = 15
/** A shot's camera clears the ground under it, and the line to its aim, by this share of its distance (at least the flight's). */
export const SHOT_CLEARANCE_SHARE = 0.08
/** Samples of the relief along the line of sight of a shot's camera, up to 90% of the way to its aim. */
const SHOT_SIGHT_SAMPLES = 16
/** The glide and the clearances ease in over this share of the shot's blend at each end (the end views are untouched). */
const SHOT_EASE_SHARE = 0.1
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
 * True when the view changes with the film time alone (progress unchanged): shots, orbiting or widening stops, every
 * stop with a smoothing in time, orbit / cinema.
 */
export function filmViewMovesWithTime(state: FilmState, camera: CameraSettings): boolean {
  if (state.phase === 'opening' || state.phase === 'closing') return true
  if (state.phase === 'stop' && (state.stop?.camera === 'orbite' || state.stop?.camera === 'large' || smoothsInTime(camera))) return true
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

const boxes = new WeakMap<TrackPath, WeakMap<LocalFrame, TrackBox>>()

/** Box of the track in the local frame (cached per path and frame). */
export function trackBox(path: TrackPath, frame: LocalFrame): TrackBox {
  let perFrame = boxes.get(path)
  if (!perFrame) boxes.set(path, (perFrame = new WeakMap()))
  const cached = perFrame.get(frame)
  if (cached) return cached
  const box: TrackBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minEle: NaN, maxEle: NaN }
  const p = new Vector3()
  for (let i = 0; i < path.count; i++) {
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
  perFrame.set(frame, box)
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

/** Distance factor for a frame taller than wide (9:16 keeps the whole track). */
const portraitFactor = (aspect: number) => (aspect > 0 && aspect < 1 ? 1 / aspect : 1)

/** Distance of the overview from the centre of a track box `diagonal` long (relief included). */
export function overviewDistanceM(diagonal: number, aspect: number): number {
  return Math.max(OVERVIEW_MIN_DISTANCE_M, OVERVIEW_DISTANCE_FACTOR * diagonal * portraitFactor(aspect))
}

/**
 * Farthest flat ground in the frame from the target, per metre of camera distance, for a camera `pitchDeg` above
 * the horizon (more than half the field of view: no sky) and a frame of `aspect`: the top or bottom corners.
 */
export function groundReach(pitchDeg: number, aspect: number): number {
  const sin = Math.sin(pitchDeg * DEG)
  const cos = Math.cos(pitchDeg * DEG)
  const t = Math.tan((CAMERA_FOV_DEG / 2) * DEG)
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
): number {
  const overview = overviewDistanceM(diagonal, aspect)
  const regional = region
    ? (REGION_FIT_MARGIN * Math.max(region.widthM, region.heightM)) / (2 * Math.tan((CAMERA_FOV_DEG / 2) * DEG))
    : clamp(REGION_DISTANCE_FACTOR * diagonal, REGION_MIN_DISTANCE_M, REGION_MAX_DISTANCE_M)
  const wanted = chosenM ?? regional * portraitFactor(aspect) * (height === 'pays' ? COUNTRY_DISTANCE_FACTOR : 1)
  const reachM = halfSideM + REGION_REACH_M - offsetM
  return Math.max(overview, Math.min(wanted, reachM / groundReach(pitchDeg, aspect)))
}

/** Centre of the track's box on the ground, the box diagonal (relief included) and its smaller half side. */
function trackFraming(path: TrackPath, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number) {
  const box = trackBox(path, frame)
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
 * Overview of the whole track for a frame of `aspect` (width / height), seen from the side the `joined` flight
 * view looks from.
 */
export function overviewView(
  path: TrackPath,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  aspect: number,
  joined: CameraView,
): CameraView {
  const { target, diagonal } = trackFraming(path, frame, sample, exaggeration)
  return viewFromSide(target, sideOf(joined), OVERVIEW_PITCH_DEG, overviewDistanceM(diagonal, aspect), frame, sample, exaggeration)
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
  }: { height?: StartHeight; region?: RegionFrame | null; framing?: SituationFraming } = {},
): CameraView {
  const track = trackFraming(path, frame, sample, exaggeration)
  const target = region ? situationTarget(path, frame, sample, exaggeration, region) : track.target
  const offsetM = Math.hypot(target.x - track.target.x, target.z - track.target.z)
  const pitchDeg = framing.tiltDeg === undefined ? REGION_PITCH_DEG : 90 - framing.tiltDeg
  const chosenM = framing.distanceKm === undefined ? undefined : framing.distanceKm * 1000
  const distance = regionDistanceM(track.diagonal, track.halfSideM, aspect, height, region ?? undefined, offsetM, pitchDeg, chosenM)
  // 'boussole': looking toward the bearing (+X east, -Z north), so the camera stands on the opposite side
  const bearing = (framing.bearingDeg ?? 0) * DEG
  const side = framing.heading === 'boussole' ? new Vector3(-Math.sin(bearing), 0, Math.cos(bearing)) : sideOf(joined)
  const view = viewFromSide(target, side, pitchDeg, distance, frame, sample, exaggeration)
  const headroom = (framing.headroomPct ?? 0) / 100
  if (headroom <= 0) return view
  // up in the frame: perpendicular to the line of sight, in its vertical plane
  const back = view.position.clone().sub(view.target).normalize()
  const up = UP.clone().addScaledVector(back, -back.y).normalize()
  const shift = up.multiplyScalar(2 * headroom * distance * Math.tan((CAMERA_FOV_DEG / 2) * DEG))
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

/** View `k` of the way from `a` to `b` (exactly `a` at 0 and `b` at 1). */
export function blendViews(
  a: CameraView,
  b: CameraView,
  k: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
): CameraView {
  if (k <= 0) return a
  if (k >= 1) return b
  const target = a.target.clone().lerp(b.target, k)
  const fromA = a.position.clone().sub(a.target)
  const fromB = b.position.clone().sub(b.target)
  const da = Math.max(1, fromA.length())
  const db = Math.max(1, fromB.length())
  const direction = fromA.divideScalar(da).lerp(fromB.divideScalar(db), k)
  if (direction.lengthSq() < 1e-12) direction.copy(UP)
  const distance = da ** (1 - k) * db ** k
  const position = target.clone().addScaledVector(direction.normalize(), distance)
  return { target, position: keepAboveGround(position, frame, sample, exaggeration) }
}

/**
 * `view`, a blend `k` (0..1, exclusive) of the way between a wide view and the `flight` view, raised so that its
 * camera stays on a glide slope of SHOT_GLIDE_DEG over the flight camera (no dive far from it), clears the ground
 * under it by SHOT_CLEARANCE_SHARE of its distance and does not hide its aim behind the relief (the straight line of
 * the blend knows nothing of the terrain between the two views). Eased in and out over SHOT_EASE_SHARE of the blend.
 */
function clearOnTheWay(
  view: CameraView,
  flight: CameraView,
  k: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
): CameraView {
  const share = smootherstep(Math.min(k, 1 - k) / SHOT_EASE_SHARE)
  if (share <= 0) return view
  const { position, target } = view
  let floorY = flight.position.y + Math.hypot(position.x - flight.position.x, position.z - flight.position.z) * Math.tan(SHOT_GLIDE_DEG * DEG)
  if (sample) {
    const clearance = Math.max(MIN_GROUND_CLEARANCE_M, SHOT_CLEARANCE_SHARE * position.distanceTo(target))
    const point = new Vector3()
    for (let i = 0; i <= SHOT_SIGHT_SAMPLES; i++) {
      const f = (0.9 * i) / SHOT_SIGHT_SAMPLES
      const at = frame.toLonLat(point.lerpVectors(position, target, f))
      const ground = sample(at.lon, at.lat)
      if (ground === undefined) continue
      // the line from the camera to the aim, at f of the way, must pass `clearance · (1 − f)` over the ground there
      const need = frame.toLocal(at.lon, at.lat, ground * exaggeration).y + Math.max(clearance * (1 - f), LINE_OF_SIGHT_MIN_CLEARANCE_M)
      floorY = Math.max(floorY, (need - target.y * f) / (1 - f))
    }
  }
  if (floorY <= position.y) return view
  return { target, position: position.clone().setY(position.y + (floorY - position.y) * share) }
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
): CameraView {
  if (group.length < 2) return view
  const points = group.map((g) => frame.toLocal(g.lon, g.lat, (sample?.(g.lon, g.lat) ?? g.ele ?? 0) * exaggeration))
  const target = points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(points.length)
  const spread = Math.max(...points.map((p) => Math.hypot(p.x - target.x, p.z - target.z)))
  const back = view.position.clone().sub(view.target)
  const fit = (GROUP_FRAMING_MARGIN * spread * portraitFactor(aspect)) / Math.tan((CAMERA_FOV_DEG / 2) * DEG)
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
}

export interface FilmViewOptions extends Omit<CameraViewOptions, 'timeS' | 'orbitRad'> {
  /** width / height of the frame (overview framing) */
  aspect: number
  /** administrative region of the outing, framed by a 'situation' shot that highlights it (osm/region.ts) */
  region?: RegionFrame | null
  /** what the flight camera follows at a film progress (null or absent: the film track itself) */
  follow?: ((progress: number) => FollowedFlight | null) | null
}

export interface FilmView extends CameraView {
  /** marker position on the draped track (the target only during the flight) */
  marker: Vector3
}

/**
 * What a keyframe pose is placed around: the film's aim point, the direction of travel, the automatic distance, and a
 * stop's widening (0..1) and orbit (radians).
 */
export interface KeyBase {
  target: Vector3
  reference: Vector3
  autoDistanceM: number
  wide: number
  orbitRad: number
}

/**
 * Direction of travel a keyframe's heading is measured from at `d` metres: the default turn window averaged over four
 * of them, set by the track alone, so a keyframe keeps its pose when the camera settings change.
 */
export function keyReferenceAt(path: TrackPath, d: number, frame: LocalFrame): Vector3 {
  const w = headingWindowM(path, DEFAULT_CAMERA)
  return smoothHeadingAt(path, d, w, 4 * w, frame)
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

/** The flight camera at a film state, before the keyframes, and what a keyframe is placed around there. */
function flightAt(
  path: TrackPath,
  clock: FilmClock,
  state: FilmState,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
): { flight: FilmView; base: KeyBase } {
  const { aspect, region: _region, follow, ...flightOptions } = options
  const stop = state.stop
  const settings = options.camera ?? DEFAULT_CAMERA
  const wide = stop?.camera === 'large' ? stopBump(state.localS, state.lengthS) : 0
  const camera = wide > 0 ? widenedCamera(settings, wide) : settings
  const orbitRad = stop?.camera === 'orbite' ? stopOrbitRad(stop.addedS, state.localS, state.lengthS) : 0
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
  const flown = computeCameraView(flightPath, followed?.progress ?? progress, frame, sample, {
    ...flightOptions,
    camera,
    orbitRad,
    ...smoothing,
    aimProgress: along(smoothing.aimProgress),
    cameraProgress: along(smoothing.cameraProgress),
  })
  const marker = followed?.markerOnFilm ? markerAt(path, progress, frame, sample, options.exaggeration, options.liftM) : flown.marker
  const framed = followed?.group ? framedGroup(flown, followed.group, frame, sample, options.exaggeration, aspect) : flown
  const flight = followed ? { ...framed, marker } : flown
  const reference = keyReferenceAt(flightPath, (followed?.progress ?? progress) * flightPath.lengthM, frame)
  return { flight, base: { target: flight.target, reference, autoDistanceM: autoDistanceM(flightPath), wide, orbitRad } }
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
  const { base } = flightAt(path, clock, clock.stateAt(timeS), progress, frame, sample, options)
  const f = keyFramingFrom(base, position, lookAt)
  const { distance, pitchDeg } = CAMERA_KEY_RANGES
  return { ...f, distance: clamp(f.distance, distance.min, distance.max), pitchDeg: clamp(f.pitchDeg, pitchDeg.min, pitchDeg.max) }
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
  const state = clock.stateAt(timeS)
  const { aspect, region } = options
  const { flight: filmFlight, base } = flightAt(path, clock, state, progress, frame, sample, options)
  const easeM = cameraKeyEaseM(path.lengthM, options.durationS ?? DEFAULT_FLYOVER_DURATION_S)
  const keyed = keyPoseAt(clock.cameraKeys, progress * path.lengthM, easeM)
  let flight = filmFlight
  if (keyed && keyed.weight > 0) {
    const pose = keyView(base, keyed.framing)
    if (keyed.free > 0) {
      const kept = keepAboveGround(pose.position.clone(), frame, sample, options.exaggeration)
      pose.position.y += (kept.y - pose.position.y) * keyed.free
    }
    flight = { ...blendViews(filmFlight, pose, keyed.weight, frame, sample, options.exaggeration), marker: filmFlight.marker }
  }
  if (state.phase !== 'opening' && state.phase !== 'closing') return flight

  const shot = state.phase === 'opening' ? clock.opening : clock.closing
  const overview =
    shot.style === 'situation'
      ? regionView(path, frame, sample, options.exaggeration, aspect, flight, {
          height: shot.startHeight,
          region: shot.highlight ? region : null,
          framing: shot,
        })
      : overviewView(path, frame, sample, options.exaggeration, aspect, flight)
  const turned = shot.style === 'balayage' ? turnedView(overview, sweepRad(state.phase, state.localS, state.lengthS)) : overview
  // turned, the overview may look from behind a slope: kept above the ground like the others
  const wide =
    turned === overview ? overview : { target: turned.target, position: keepAboveGround(turned.position, frame, sample, options.exaggeration) }
  const k = shotWeight(shot, state.phase, state.localS, state.lengthS)
  const blended =
    state.phase === 'opening'
      ? blendViews(wide, flight, k, frame, sample, options.exaggeration)
      : blendViews(flight, wide, k, frame, sample, options.exaggeration)
  const view = k > 0 && k < 1 ? clearOnTheWay(blended, flight, k, frame, sample, options.exaggeration) : blended
  return { ...view, marker: flight.marker }
}
