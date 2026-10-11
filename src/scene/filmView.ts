import type { Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import type { FilmClock } from '../film/clock'
import type { KeyFraming } from '../flyover/cameraKeys'
import { computeFilmView, keyFramingAt, type FilmView, type FilmViewOptions } from '../flyover/filmCamera'
import { filmFollowOf, type FollowFlight } from '../flyover/follow'
import type { TrackPath } from '../flyover/path'
import { useRegionStore } from '../osm/region'
import { useAppStore } from '../state/store'
import { LINE_LIFT_M, type HeightSampler } from './TrackLines'

/** Terrain sampler and film view options from the settings and the terrain loaded now. */
function viewInputs(engine: TerrainEngine | null, aspect: number, follow?: FollowFlight | null) {
  const { settings, tracks } = useAppStore.getState()
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  const options: FilmViewOptions = {
    exaggeration: settings.exaggeration,
    liftM: LINE_LIFT_M,
    camera: settings.camera,
    durationS: settings.flyoverDurationS,
    aspect,
    region: useRegionStore.getState().frame,
    follow: follow === undefined ? filmFollowOf(tracks, settings.race, settings.trackStyle.smoothingM) : follow,
  }
  return { sampler, options }
}

/** Camera placement of the film (preview and export) at `progress` and film time `timeS` with the terrain loaded now. */
export function filmViewAt(
  path: TrackPath,
  clock: FilmClock,
  progress: number,
  timeS: number | null,
  frame: LocalFrame,
  engine: TerrainEngine | null,
  aspect: number,
  follow?: FollowFlight | null,
): FilmView {
  const { sampler, options } = viewInputs(engine, aspect, follow)
  return computeFilmView(path, clock, timeS ?? clock.timeAtProgress(progress), progress, frame, sampler, options)
}

/** Keyframe pose of the camera at `position` looking toward `lookAt`, at `progress` and film time `timeS` (`keyFramingAt`). */
export function keyFramingOfView(
  path: TrackPath,
  clock: FilmClock,
  progress: number,
  timeS: number | null,
  frame: LocalFrame,
  engine: TerrainEngine | null,
  follow: FollowFlight | null,
  position: Vector3,
  lookAt: Vector3,
): KeyFraming {
  const { sampler, options } = viewInputs(engine, 1, follow)
  return keyFramingAt(path, clock, timeS ?? clock.timeAtProgress(progress), progress, frame, sampler, options, position, lookAt)
}
