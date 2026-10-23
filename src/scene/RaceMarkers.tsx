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
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Sprite } from 'three'
import { pathHeightM } from '../flyover/flights'
import { raceAt } from '../flyover/race'
import { useAppStore } from '../state/store'
import { markerLook, placeMarker, pullMarkerForward, racerMarkerColors, releaseMarkerTexture, screenHeading } from './markerSprite'
import { useTerrainContext } from './terrainContext'
import { LINE_LIFT_M, type HeightSampler } from './trackLineSet'
import { useFilmClock } from './usePacing'
import { useRace } from './useRace'

export function RaceMarkers() {
  const tracks = useAppStore((s) => s.tracks)
  const enabled = useAppStore((s) => s.settings.race.enabled)
  const race = useRace()
  const { engine, frame } = useTerrainContext()
  const groupRef = useRef<Group>(null)
  /** marker of tracks[i + 1] */
  const markersRef = useRef<(Sprite | null)[]>([])
  const clock = useFilmClock()

  useFrame(({ camera, gl }) => {
    const group = groupRef.current
    if (!group) return
    group.visible = enabled && race !== null && frame !== null
    if (!group.visible || !race || !frame) return
    const { playback, settings } = useAppStore.getState()
    const markers = markersRef.current
    for (const marker of markers) if (marker) marker.visible = false
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
      const heading = settings.marker.kind === 'figurine' ? screenHeading(path, racer.distanceM, position, frame, camera, settings.exaggeration) : null
      const look = markerLook(settings.marker, track, false)
      placeMarker(marker, position, camera, look, racerMarkerColors(track.color), heading?.left ?? false, gain, timeS, heading?.lean)
      pullMarkerForward(marker, camera)
      marker.visible = true
    }
  })

  return (
    <group ref={groupRef} name="race-markers" visible={false}>
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
