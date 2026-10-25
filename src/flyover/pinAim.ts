/**
 * « Photos sur le terrain »: where a photo pin stands in the local frame, and the turn of the camera towards the pins
 * (`film/photoPins.ts` gives their weights). Pure: a function of the film time, the pins and the terrain, so the
 * preview, the lens effects and the video export place the same camera.
 */
import { Vector3 } from 'three'
import { clamp } from '../core/math'
import type { LocalFrame } from '../core/types'
import { PIN_AIM_RAISE, pinAims, type PhotoPin } from '../film/photoPins'
import type { HeightSampler } from '../scene/trackLineSet'
import type { CameraView } from './camera'

export type AimPin = Pick<PhotoPin, 'startS' | 'endS' | 'lon' | 'lat' | 'ele'>

/** Local position of the foot of a pin: on the (exaggerated) ground, `liftM` above it like the track line. */
export function pinLocalPosition(
  pin: Pick<PhotoPin, 'lon' | 'lat' | 'ele'>,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  liftM: number,
  out: Vector3,
): Vector3 {
  const ground = sample?.(pin.lon, pin.lat) ?? pin.ele ?? 0
  return frame.toLocal(pin.lon, pin.lat, ground * exaggeration + liftM, out)
}

const foot = new Vector3()

/** The marker may be pushed this far toward the edge of the frame (normalised device coordinate, 1 = the edge) by the turn to a pin. */
export const PIN_MARKER_MARGIN = 0.8

/**
 * `aim` (the usual aim `from` turned toward the pins), with its turn limited so that the marker stays within the frame
 * (a cone of PIN_MARKER_MARGIN of the frame's smaller half field of view around the direction of the marker, less what
 * the usual aim is off it already): the turn is left alone up to half that angle, then saturates toward it (the same
 * slope at the join, no kink). The turn goes on along the same arc, so the aim stays a smooth function of the pull,
 * whatever the marker and the pins do.
 */
function keepMarkerNear(aim: Vector3, from: Vector3, marker: Vector3, position: Vector3, keep: { aspect: number; fovDeg: number }): Vector3 {
  const angleBetween = (a: Vector3, b: Vector3) => Math.acos(clamp(a.dot(b), -1, 1))
  const usual = from.clone().sub(position).normalize()
  const ray = aim.clone().sub(position)
  const length = ray.length()
  const turned = ray.divideScalar(Math.max(length, 1e-9))
  const half = Math.atan(PIN_MARKER_MARGIN * Math.tan((keep.fovDeg / 2) * (Math.PI / 180)) * Math.min(1, keep.aspect))
  const room = Math.max(0, half - angleBetween(usual, marker.clone().sub(position).normalize()))
  const turn = angleBetween(usual, turned)
  if (turn <= room / 2) return aim
  const free = room / 2
  const kept = room > 1e-6 ? free + (room - free) * (1 - Math.exp(-(turn - free) / (room - free))) : 0
  // along the arc from the usual aim to the turned one, `kept` of the way round
  const sin = Math.sin(turn)
  const dir = sin < 1e-6 ? usual : usual.multiplyScalar(Math.sin(turn - kept) / sin).addScaledVector(turned, Math.sin(kept) / sin)
  return position.clone().addScaledVector(dir, length)
}

/**
 * `view` with its aim point turned towards the pins at film time `timeS` (the camera does not move), by `strength`
 * (1: the full turn, 0: none; the camera keys take the turn away as they take the view over). The same `view` object
 * when no pin pulls. With `keep` (the frame's aspect and field of view) the turn stops where the marker would pass
 * PIN_MARKER_MARGIN of the frame (`keepMarkerNear`): a pin ahead of or behind the marker took it out of the default
 * view, and behind the camera with the lively presets (1.7 out of 1 for the default camera on the sample).
 */
export function aimTowardsPins<T extends CameraView & { marker?: Vector3 }>(
  view: T,
  pins: readonly AimPin[],
  timeS: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  liftM: number,
  strength = 1,
  keep?: { aspect: number; fovDeg: number },
): T {
  if (strength <= 0) return view
  const aims = pinAims(pins, timeS)
  if (aims.length === 0) return view
  const target = view.target.clone()
  for (const { pin, share } of aims) {
    pinLocalPosition(pin, frame, sample, exaggeration, liftM, foot)
    // the picture floats above the foot of the post: aim a little over it
    foot.y += view.position.distanceTo(foot) * PIN_AIM_RAISE
    target.addScaledVector(foot.sub(view.target), share * strength)
  }
  return { ...view, target: keep && view.marker ? keepMarkerNear(target, view.target, view.marker, view.position, keep) : target }
}
