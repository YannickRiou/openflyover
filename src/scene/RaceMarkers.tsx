/**
 * RaceMarkers — ghost race (« course fantôme »): one marker on every track but the first, placed by
 * `raceAt(race, progress)` (see `flyover/race.ts`) for the current playback progress. Same kind of marker as the
 * lead (`settings.marker`, see `markerSprite.ts`: style, shape, stick) in the track's colour with an ink ring, the
 * figure of its own activity ('auto') and its own name as label; a picture stays the lead's own, so the racers then
 * show their ball. Same constant screen size as the lead marker, unlit, drawn over
 * the terrain but cut by the relief in front of it (`pullMarkerForward`), height = `pathHeightM` × exaggeration + LINE_LIFT_M like the lead marker (in the air on a flight).
 * The camera keeps following the first track (FlyoverRig); mounted after it so the progress and the camera of
 * this frame are used.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Vector3 } from 'three'
import type { Group, Sprite } from 'three'
import { pathHeightM } from '../flyover/flights'
import { raceAt } from '../flyover/race'
import { useAppStore } from '../state/store'
import { MODEL_BALLS, MODEL_REST_PHASE, figureHeading, litColor, markerLook, markerRadius, MARKER_DEPTH_PULL_M, pastViewAt, placeMarker, pullMarkerForward, racerMarkerColors, releaseMarkerTexture, trackDirection } from './markerSprite'
import { FIGURE_TURN_S, figureStride } from './markerSettings'
import { createMarkerModel, disposeMarkerModel, hasMarkerModel, standModel } from './markerModels'
import type { MarkerModel } from './markerModels'
import { useTerrainContext } from './terrainContext'
import { LINE_LIFT_M, type HeightSampler } from './trackLineSet'
import { useFilmClock } from './usePacing'
import { useRace } from './useRace'

const modelFill = new Color()
const modelAhead = new Vector3()
const modelAt = new Vector3()

export function RaceMarkers() {
  const tracks = useAppStore((s) => s.tracks)
  const enabled = useAppStore((s) => s.settings.race.enabled)
  const race = useRace()
  const { engine, frame } = useTerrainContext()
  const groupRef = useRef<Group>(null)
  /** marker of tracks[i + 1] */
  const markersRef = useRef<(Sprite | null)[]>([])
  const clock = useFilmClock()
  /** 3D models of the racers (`marker.model3d`), by track and figure */
  const modelGroupRef = useRef<Group>(null)
  const modelsRef = useRef(new Map<string, MarkerModel>())
  useEffect(() => {
    const models = modelsRef.current
    return () => {
      for (const model of models.values()) disposeMarkerModel(model)
      models.clear()
    }
  }, [])

  useFrame(({ camera, gl }) => {
    const group = groupRef.current
    if (!group) return
    group.visible = enabled && race !== null && frame !== null
    if (!group.visible || !race || !frame) return
    const { playback, settings } = useAppStore.getState()
    const markers = markersRef.current
    for (const marker of markers) if (marker) marker.visible = false
    for (const model of modelsRef.current.values()) model.root.visible = false
    // unlit colours divided by the exposure, as the track lines (see applyExposure)
    const gain = 1 / gl.toneMappingExposure
    const timeS = playback.timeS ?? clock.timeAtProgress(playback.progress)
    const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null

    for (const racer of raceAt(race, playback.progress)) {
      const marker = racer.index > 0 ? markers[racer.index - 1] : null
      const track = tracks[racer.index]
      if (!marker || !track) continue
      const { path } = race.tracks[racer.index]
      const height = pathHeightM(path, racer.distanceM, racer, sampler)
      const position = frame.toLocal(racer.lon, racer.lat, height * settings.exaggeration + LINE_LIFT_M, marker.position)
      // where this racer was at an earlier film time, for the side its figure faced then (`figureHeading`)
      const distanceAt = (t: number) =>
        t === timeS ? racer.distanceM : (raceAt(race, clock.progressAtTime(Math.max(0, t))).find((r) => r.index === racer.index)?.distanceM ?? racer.distanceM)
      const heading =
        settings.marker.kind === 'figurine'
          ? figureHeading(path, distanceAt, timeS, position, frame, camera, pastViewAt(timeS - FIGURE_TURN_S), settings.exaggeration)
          : null
      const look = markerLook(settings.marker, track, false)
      // a figurine with a 3D model is that model, standing on its point and facing along its track, in place of its sprite
      const models = modelsRef.current
      const modelGroup = modelGroupRef.current
      if (modelGroup && settings.marker.kind === 'figurine' && settings.marker.model3d && hasMarkerModel(look.figure)) {
        const key = `${track.id}:${look.figure}`
        let model = models.get(key)
        if (!model) {
          model = createMarkerModel(look.figure) ?? undefined
          if (model) {
            models.set(key, model)
            modelGroup.add(model.root)
          }
        }
        if (model) {
          const fill = litColor(racerMarkerColors(track.color).badgeFill, gain, modelFill)
          model.setColor(fill.r, fill.g, fill.b)
          model.pose(look.animated ? figureStride(clock, timeS) : MODEL_REST_PHASE)
          trackDirection(path, racer.distanceM, position, frame, settings.exaggeration, modelAhead)
          const height = MODEL_BALLS * markerRadius(camera, position, settings.marker.size)
          const distance = camera.position.distanceTo(position)
          const pull = distance > 0 ? 1 - Math.min(MARKER_DEPTH_PULL_M, distance / 2) / distance : 1
          modelAt.copy(position).sub(camera.position).multiplyScalar(pull).add(camera.position)
          standModel(model, modelAt, modelAhead, height * pull)
          model.root.visible = true
          continue
        }
      }
      placeMarker(marker, position, camera, look, racerMarkerColors(track.color), heading?.facing ?? 1, gain, timeS, heading?.lean)
      pullMarkerForward(marker, camera)
      marker.visible = true
    }
  })

  return (
    <group ref={groupRef} name="race-markers" visible={false}>
      <group ref={modelGroupRef} name="race-marker-models" />
      {tracks.slice(1).map((track, i) => (
        // over the terrain, under the lead marker (renderOrder 2)
        <sprite
          key={track.id}
          name={`race-marker-${track.id}`}
          visible={false}
          renderOrder={1.5}
          ref={(sprite) => {
            // the texture a pulsing ball drew for itself goes with its sprite
            if (!sprite) releaseMarkerTexture(markersRef.current[i] ?? null)
            markersRef.current[i] = sprite
          }}
        >
          <spriteMaterial depthWrite={false} />
        </sprite>
      ))}
    </group>
  )
}
