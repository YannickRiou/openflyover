/**
 * Keyframes of the film (« Images clés », `FilmCameraKey`): camera poses pinned along the track, eased from one to the
 * next. Pure module without three.js, so the panels can use it without loading the 3D engine.
 */
import { smootherstep } from '../core/math'
import type { FilmCameraKey } from '../film/model'
import type { CameraSettings } from './cameraSettings'

/** The camera eases into the first camera key and back out of the last one over this (seconds at the base speed). */
export const CAMERA_KEY_EASE_S = 3

type Framing = Pick<CameraSettings, 'distance' | 'pitchDeg' | 'headingOffsetDeg'>

/** `a` → `b` at `k` (0..1): linear, the heading the shorter way round. */
function blendFraming(a: Framing, b: Framing, k: number): Framing {
  const turn = ((((b.headingOffsetDeg - a.headingOffsetDeg) % 360) + 540) % 360) - 180
  return {
    distance: a.distance + (b.distance - a.distance) * k,
    pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k,
    headingOffsetDeg: a.headingOffsetDeg + turn * k,
  }
}

/** Length of the ease into the first camera key and out of the last (metres): CAMERA_KEY_EASE_S at the base speed. */
export function cameraKeyEaseM(lengthM: number, durationS: number): number {
  return Math.max(1, (lengthM * CAMERA_KEY_EASE_S) / Math.max(1, durationS))
}

/**
 * Camera settings at `atM` metres along the track with the camera keys (`keys` sorted by position): between two
 * keys, eased from one to the next by smootherstep (still at each key: no jerk); over `easeM` before the first key,
 * from the film's settings to it, and over `easeM` after the last one back to them; elsewhere the film's settings.
 */
export function keyedCamera(camera: CameraSettings, keys: readonly FilmCameraKey[], atM: number, easeM: number): CameraSettings {
  if (keys.length === 0) return camera
  const first = keys[0]
  const last = keys[keys.length - 1]
  const next = keys.findIndex((k) => k.atM > atM)
  let framing: Framing
  if (next === 0) framing = blendFraming(camera, first, smootherstep(1 - (first.atM - atM) / easeM))
  else if (next === -1) framing = blendFraming(last, camera, smootherstep((atM - last.atM) / easeM))
  else {
    const a = keys[next - 1]
    const b = keys[next]
    framing = blendFraming(a, b, smootherstep((atM - a.atM) / (b.atM - a.atM)))
  }
  return { ...camera, ...framing }
}

/** Pose of a keyframe, without its place (`FilmCameraKey`). */
export type KeyFraming = Required<Pick<FilmCameraKey, 'distance' | 'pitchDeg' | 'headingOffsetDeg' | 'aimRightM' | 'aimAheadM'>>

export const keyFraming = (k: FilmCameraKey): KeyFraming => ({
  distance: k.distance,
  pitchDeg: k.pitchDeg,
  headingOffsetDeg: k.headingOffsetDeg,
  aimRightM: k.aimRightM ?? 0,
  aimAheadM: k.aimAheadM ?? 0,
})

/**
 * Keyframe pose at `atM` metres along the track (`keys` sorted by position), null without keys: between two keys,
 * from one to the next by smootherstep (as `keyedCamera`), `weight` 1; before the first and after the last, that
 * key's pose with `weight` easing from 0 (the film's camera) over `easeM`. `free` = how far from a key the pose is
 * (0 at a key, 1 halfway between two): the share of the ground clearance it gets.
 */
export function keyPoseAt(keys: readonly FilmCameraKey[], atM: number, easeM: number): { framing: KeyFraming; weight: number; free: number } | null {
  if (keys.length === 0) return null
  const next = keys.findIndex((k) => k.atM > atM)
  if (next === 0) return { framing: keyFraming(keys[0]), weight: smootherstep(1 - (keys[0].atM - atM) / easeM), free: 0 }
  const last = keys[keys.length - 1]
  if (next === -1) return { framing: keyFraming(last), weight: 1 - smootherstep((atM - last.atM) / easeM), free: 0 }
  const a = keyFraming(keys[next - 1])
  const b = keyFraming(keys[next])
  const u = (atM - keys[next - 1].atM) / (keys[next].atM - keys[next - 1].atM)
  const k = smootherstep(u)
  const framing = {
    ...blendFraming(a, b, k),
    aimRightM: a.aimRightM + (b.aimRightM - a.aimRightM) * k,
    aimAheadM: a.aimAheadM + (b.aimAheadM - a.aimAheadM) * k,
  }
  return { framing, weight: 1, free: 4 * u * (1 - u) }
}

/** The 3D view as a keyframe at the marker, null when there is no flight to frame. */
export type KeyCapture = () => { atM: number; framing: KeyFraming } | null
let keyCapture: KeyCapture | null = null

/**
 * « Ajouter une image clé »: the scene (scene/FlyoverRig.tsx) registers how to read its camera, so the UI does not load
 * three.js.
 */
export function registerKeyCapture(capture: KeyCapture): () => void {
  keyCapture = capture
  return () => {
    if (keyCapture === capture) keyCapture = null
  }
}

export function captureKey(): ReturnType<KeyCapture> {
  return keyCapture?.() ?? null
}
