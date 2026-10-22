/** Where a photo pin stands on the relief (shared by the pins and the camera that turns towards them). */
import type { Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import type { PhotoPin } from '../film/photoPins'
import { samplePath, type TrackPath } from '../flyover/path'
import { LINE_LIFT_M } from './trackLineSet'

/** Local position of a pin: the track point `pin.atM` along `path`, on the (exaggerated) terrain. */
export function pinPosition(
  pin: Pick<PhotoPin, 'atM'>,
  path: TrackPath,
  frame: LocalFrame,
  engine: TerrainEngine | null,
  exaggeration: number,
  out: Vector3,
): Vector3 {
  const at = samplePath(path, pin.atM)
  const ground = engine?.sampleHeight(at.lon, at.lat) ?? at.ele ?? 0
  return frame.toLocal(at.lon, at.lat, ground * exaggeration + LINE_LIFT_M, out)
}
