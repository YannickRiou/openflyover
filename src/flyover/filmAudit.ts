/**
 * Audit of the film camera: the film is replayed frame by frame with `computeFilmView` and the moments a viewer would
 * notice are listed, with their time: a jolt of the camera or of its aim, a whip of the view direction, the camera too
 * close to the ground, the marker out of the frame. Pure (no DOM, React or store): the terrain is the sampler it is
 * given. `replayFilm` places the camera, `auditPoses` reads the poses (testable on poses made by hand).
 */
import { PerspectiveCamera, Vector3 } from 'three'
import type { LocalFrame } from '../core/types'
import type { FilmClock } from '../film/clock'
import type { HeightSampler } from '../scene/trackLineSet'
import { MIN_TERRAIN_CLEARANCE_M } from './camera'
import { DEFAULT_FOCAL_MM, fovDegOf } from './cameraSettings'
import { computeFilmView, lookAtView, type FilmViewOptions } from './filmCamera'
import type { TrackPath } from './path'

export const AUDIT_KINDS = ['jolt', 'whip', 'low', 'marker-out'] as const
/** jolt: the camera or its aim changes its motion abruptly; whip: the view direction turns too fast; low: the camera is under its clearance above the terrain; marker-out: the marker leaves the frame */
export type AuditKind = (typeof AUDIT_KINDS)[number]

/** A stretch of the film (seconds) where `kind` happens, `worst` its largest measure (jolt: share of the distance, whip: degrees per second, low: metres short, marker-out: NDC). */
export interface AuditIssue {
  kind: AuditKind
  startS: number
  endS: number
  worst: number
}

const DEG = Math.PI / 180

/** Frames per second of the replay. */
export const AUDIT_FPS = 30
/**
 * A jolt: the change of the camera's (or the aim's) displacement from one frame to the next, as a share of the
 * camera's distance from its aim. A calm dive or flight stays under 0.006; a camera thrown up and back down by the
 * relief (#186, #213) reaches 0.03 to 0.1. The swing of the lively presets in a tight turn (« Oiseau », « Drone
 * rapide ») reaches 0.025 to 0.06: it is the preset, and it shows when the film is read, not in the shots.
 */
export const AUDIT_JOLT_LIMIT = 0.025
/**
 * A whip: the view direction turns faster than this (degrees per second), which the jolt under-reports (the positions
 * barely move while the direction swings round). A calm flight stays under 90 (a 540 km raid in 60 s: 68); the lively
 * presets (« Oiseau », « Drone rapide »), at ×4 or turning to a photo pin, reach 250 at most; camera keys whose heading
 * was read on the track 6 km around, over hairpins flown at 10 km per second of film, swung the view round at 315 to
 * 350 (110 once averaged over film time, `keyReferenceAt`, and 70 with the rest of the film).
 */
export const AUDIT_WHIP_LIMIT = 280
/** The camera may be this much under its clearance above the actual terrain (metres) before it counts as low. */
export const AUDIT_LOW_TOLERANCE_M = 1
/** The marker is out of the frame beyond this normalised device coordinate (the frame edge is 1). */
export const AUDIT_MARKER_LIMIT = 1
/** Flagged frames closer than this (seconds) make one issue. */
const MERGE_GAP_S = 0.5

/** The camera at one frame of the replay, and what the clock says there (a change of `state` is a junction). */
export interface AuditPose {
  position: Vector3
  target: Vector3
  marker: Vector3
  /** roll of the camera about its line of sight (radians, `FilmView.rollRad`); none when absent */
  rollRad?: number
  /** shot or stop the frame belongs to: the marker starts or stops moving where it changes, the camera follows at once */
  state: string
}

/** The camera of the film every frame between `fromS` and `toS` (default: the whole film). */
export function replayFilm(
  path: TrackPath,
  clock: FilmClock,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
  { fromS = 0, toS = clock.totalTime(), fps = AUDIT_FPS }: { fromS?: number; toS?: number; fps?: number } = {},
): AuditPose[] {
  const poses: AuditPose[] = []
  for (let i = 0, count = Math.max(0, Math.floor((toS - fromS) * fps)) + 1; i < count; i++) {
    const t = fromS + i / fps
    const { position, target, marker, rollRad } = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, sample, options)
    const state = clock.stateAt(t)
    poses.push({ position, target, marker, rollRad, state: `${state.phase}|${state.stop?.id ?? ''}` })
  }
  return poses
}

/**
 * The issues of `poses` (`fps` per second from `fromS`), in time order. Terrain the sampler cannot read (`undefined`)
 * is not flagged.
 */
export function auditPoses(
  poses: readonly AuditPose[],
  frame: LocalFrame,
  sample: HeightSampler | null,
  { exaggeration, aspect, camera: settings }: Pick<FilmViewOptions, 'exaggeration' | 'aspect' | 'camera'>,
  { fromS = 0, fps = AUDIT_FPS }: { fromS?: number; fps?: number } = {},
): AuditIssue[] {
  const issues: AuditIssue[] = []
  const add = (kind: AuditKind, atS: number, worst: number) => {
    const last = issues.findLast((issue) => issue.kind === kind)
    if (last && atS - last.endS <= MERGE_GAP_S) {
      last.endS = atS
      last.worst = Math.max(last.worst, worst)
    } else issues.push({ kind, startS: atS, endS: atS, worst })
  }
  const atJunction = (i: number) => [i - 2, i - 1, i + 1, i + 2].some((j) => poses[j] !== undefined && poses[j].state !== poses[i].state)
  const camera = new PerspectiveCamera(fovDegOf(settings?.focalMm ?? DEFAULT_FOCAL_MM), aspect)
  const scratch = new Vector3()
  const sightOf = (p: AuditPose) => new Vector3().subVectors(p.target, p.position).normalize()
  const ndc = new Vector3()
  for (let i = 0; i < poses.length; i++) {
    const t = fromS + i / fps
    const pose = poses[i]
    const before = poses[i - 1]
    const after = poses[i + 1]
    if (before && after && !atJunction(i)) {
      const distance = Math.max(1, pose.position.distanceTo(pose.target))
      for (const k of ['position', 'target'] as const) {
        // second difference: the change of the displacement from one frame to the next
        const jolt = scratch.copy(after[k]).add(before[k]).addScaledVector(pose[k], -2).length() / distance
        if (jolt > AUDIT_JOLT_LIMIT) add('jolt', t, jolt)
      }
      // turn rate of the view direction over the two frames around this one
      const whip = (sightOf(before).angleTo(sightOf(after)) / DEG) * (fps / 2)
      if (whip > AUDIT_WHIP_LIMIT) add('whip', t, whip)
    }
    if (sample) {
      const at = frame.toLonLat(pose.position)
      const ground = sample(at.lon, at.lat)
      if (ground !== undefined) {
        const short = MIN_TERRAIN_CLEARANCE_M - (at.height - ground * exaggeration)
        if (short > AUDIT_LOW_TOLERANCE_M) add('low', t, short)
      }
    }
    camera.position.copy(pose.position)
    lookAtView(camera, pose)
    camera.updateMatrixWorld()
    const ahead = ndc.copy(pose.marker).sub(pose.position).dot(scratch.copy(pose.target).sub(pose.position)) > 0
    const edge = ahead ? Math.max(Math.abs(ndc.copy(pose.marker).project(camera).x), Math.abs(ndc.y)) : Infinity
    if (edge > AUDIT_MARKER_LIMIT) add('marker-out', t, edge)
  }
  return issues
}

/** `replayFilm` then `auditPoses`: the issues of the film (or of its stretch from `fromS` to `toS`). */
export function auditFilmCamera(
  path: TrackPath,
  clock: FilmClock,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
  range: { fromS?: number; toS?: number; fps?: number } = {},
): AuditIssue[] {
  return auditPoses(replayFilm(path, clock, frame, sample, options, range), frame, sample, options, range)
}
