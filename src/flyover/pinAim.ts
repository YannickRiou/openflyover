/**
 * « Photos sur le terrain »: where a photo pin stands in the local frame, and the turn of the camera towards the pins
 * (`film/photoPins.ts` gives their weights). Pure: a function of the film time, the pins and the terrain, so the
 * preview, the lens effects and the video export place the same camera.
 */
import { Vector3 } from 'three'
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

/**
 * `view` with its aim point turned towards the pins at film time `timeS` (the camera does not move), by `strength`
 * (1: the full turn, 0: none; the camera keys take the turn away as they take the view over). The same `view` object
 * when no pin pulls.
 */
export function aimTowardsPins<T extends CameraView>(
  view: T,
  pins: readonly AimPin[],
  timeS: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  liftM: number,
  strength = 1,
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
  return { ...view, target }
}
