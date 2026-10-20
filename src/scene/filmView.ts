import type { Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import type { FilmClock } from '../film/clock'
import type { KeyFraming } from '../flyover/cameraKeys'
import { computeFilmView, keyFramingAt, type FilmView, type FilmViewOptions } from '../flyover/filmCamera'
import { filmFollowOf, type FollowFlight } from '../flyover/follow'
import type { TrackPath } from '../flyover/path'
import { useRegionStore } from '../osm/region'
import { useAppStore } from '../state/store'
import { LINE_LIFT_M, type HeightSampler } from './trackLineSet'

/**
 * Per engine, one height sampler for every view and how many times its terrain changed (tiles loaded or dropped): the
 * film camera keeps what it computed with a sampler from frame to frame, up to date with the version (`computeFilmView`).
 */
const terrains = new WeakMap<TerrainEngine, { sampler: HeightSampler; version: number }>()

function terrainOf(engine: TerrainEngine) {
  let terrain = terrains.get(engine)
  if (!terrain) {
    const created = { sampler: (lon: number, lat: number) => engine.sampleHeight(lon, lat), version: 0 }
    engine.onChange(() => created.version++)
    terrains.set(engine, created)
    terrain = created
  }
  return terrain
}

/** What the flight camera follows, the same function while the tracks and the race settings stay the same (as above). */
let followed: { inputs: readonly unknown[]; follow: FollowFlight | null } | undefined

export function filmFollow(tracks: Parameters<typeof filmFollowOf>[0], race: Parameters<typeof filmFollowOf>[1], smoothingM: number) {
  const inputs = [tracks, race, smoothingM]
  if (!followed || followed.inputs.some((input, i) => input !== inputs[i])) followed = { inputs, follow: filmFollowOf(tracks, race, smoothingM) }
  return followed.follow
}

/** Terrain sampler and film view options from the settings and the terrain loaded now. */
function viewInputs(engine: TerrainEngine | null, aspect: number, follow?: FollowFlight | null) {
  const { settings, tracks } = useAppStore.getState()
  const terrain = engine ? terrainOf(engine) : null
  const options: FilmViewOptions = {
    exaggeration: settings.exaggeration,
    liftM: LINE_LIFT_M,
    camera: settings.camera,
    durationS: settings.flyoverDurationS,
    aspect,
    region: useRegionStore.getState().frame,
    follow: follow === undefined ? filmFollow(tracks, settings.race, settings.trackStyle.smoothingM) : follow,
    terrainVersion: terrain?.version,
  }
  return { sampler: terrain?.sampler ?? null, options }
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
