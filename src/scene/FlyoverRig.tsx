/**
 * FlyoverRig — plays the film along the first track: advances the store's playback progress and film time on the film
 * clock (`film/clock.ts`), moves the marker on the draped track (`markerSprite.ts`) and drives the camera
 * (`flyover/filmCamera.ts`; with several tracks, `flyover/follow.ts` gives the stage or the racers). See
 * ARCHITECTURE.md "Flyover".
 *
 * The view is a pure function of the progress, the film time and the settings (no smoothing state), so the video
 * export renders any frame independently by setting both.
 *
 * The camera is driven while playing (orbit controls disabled) and whenever the progress, the film time of a view that
 * moves with time, or the camera and film settings change while paused; otherwise the user orbits freely, and on a
 * camera keyframe the view moved with the mouse is written into the key.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type PerspectiveCamera, type Sprite, type SpriteMaterial } from 'three'
import { markerAt, markerFadeM } from '../film/markerKeys'
import { pinsMoveWithTime } from '../film/photoPins'
import { useMediaStore } from '../film/media'
import { keyAt, updateCameraKey } from '../film/timeline'
import { captureKey, registerKeyCapture } from '../flyover/cameraKeys'
import { fovDegOf } from '../flyover/cameraSettings'
import { clampWorkArea, loopTime } from '../film/workArea'
import { filmViewMovesWithTime, highViewAt, lookAtView, situationFramingOf, situationTarget } from '../flyover/filmCamera'
import { smoothedTrackPath } from '../flyover/smooth'
import { registerFramingCapture, useRegionStore } from '../osm/region'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { filmFollow, filmViewAt, keyFramingOfView } from './filmView'
import { useTerrainContext } from './terrainContext'
import { frameDelta } from './renderOnDemand'
import { trackUnderMarker } from '../flyover/sequence'
import {
  figureHeading,
  leadMarkerColors,
  markerLook,
  pullMarkerForward,
  placeMarker,
  releaseMarkerTexture,
  showPastView,
  useMarkerImages,
  useMarkerLabelFont,
} from './markerSprite'
import { FIGURE_TURN_S, figureMotion } from './markerSettings'
import type { MarkerSettings } from './markerSettings'
import { editFilm, useFilmClock, useFilmTrack } from './usePacing'
import type { HeightSampler } from './trackLineSet'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** What FlyoverRig needs from the default controls (drei OrbitControls with makeDefault). */
interface DefaultControls {
  target: Vector3
  enabled: boolean
  /** `start` / `end` of a drag, wheel or pinch, `change` at each move of the camera */
  addEventListener?(type: 'start' | 'end' | 'change', listener: () => void): void
  removeEventListener?(type: 'start' | 'end' | 'change', listener: () => void): void
}

export function FlyoverRig() {
  const track = useFilmTrack()
  const tracks = useAppStore((s) => s.tracks)
  const race = useAppStore((s) => s.settings.race)
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  const { engine, frame } = useTerrainContext()
  const controls = useThree((s) => s.controls) as unknown as DefaultControls | null

  // the marker and the camera follow the same smoothed positions as the drawn line (TrackLines)
  const path = useMemo(() => (track ? smoothedTrackPath(track, smoothingM) : null), [track, smoothingM])
  // the same function as the other views' (`filmFollow`), so the film camera keeps what it computed (`computeFilmView`)
  const follow = useMemo(() => filmFollow(tracks, race, smoothingM), [tracks, race, smoothingM])
  const clock = useFilmClock()
  /** clock the store's film time was computed with */
  const clockRef = useRef(clock)
  const markerRef = useRef<Sprite>(null)
  /** the look the marker leaves while it cross-fades into the next one (marker keys) */
  const fadeRef = useRef<Sprite>(null)
  const baseImage = useAppStore((s) => s.settings.marker.image)
  const markerKeys = useAppStore((s) => s.settings.film.markerKeys)
  const pictures = useMediaStore((s) => s.table)
  const markerImages = useMarkerImages(
    useMemo(() => [baseImage, ...markerKeys.map((k) => (k.imageId ? (pictures[k.imageId]?.data ?? '') : ''))], [baseImage, markerKeys, pictures]),
  )
  useMarkerLabelFont(useAppStore((s) => s.settings.marker.label !== 'aucune'))
  /** view the camera was last placed for; start at the mount values so the initial fit is kept */
  const { playback: mount, settings: mountSettings } = useAppStore.getState()
  const mountTimeS = mount.timeS ?? clock.timeAtProgress(mount.progress)
  const appliedRef = useRef({
    progress: mount.progress,
    timeS: mountTimeS,
    timed: filmViewMovesWithTime(clock.stateAt(mountTimeS), mountSettings.camera) || highViewAt(clock, mountTimeS) !== null,
  })
  const appliedSettingsRef = useRef(mountSettings)
  const appliedRegionRef = useRef(useRegionStore.getState().frame)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    const sprites = [markerRef.current, fadeRef.current]
    return () => sprites.forEach(releaseMarkerTexture)
  }, [])

  // « Capturer la vue actuelle »: the framing of this camera around the target of the region view
  useEffect(() => {
    if (!path || path.count === 0 || !frame) return
    return registerFramingCapture((highlighted) => {
      const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
      const { exaggeration } = useAppStore.getState().settings
      const region = highlighted ? useRegionStore.getState().frame : null
      return situationFramingOf(camera.position, situationTarget(path, frame, sampler, exaggeration, region))
    })
  }, [path, frame, engine, camera])

  // « Ajouter une image clé »: the pose of this camera at the playhead, as the film will show it at the keyframe
  useEffect(() => {
    if (!path || path.count === 0 || !frame) return
    return registerKeyCapture(() => {
      const { progress, timeS } = useAppStore.getState().playback
      const lookAt = controls?.target ?? camera.getWorldDirection(new Vector3()).add(camera.position)
      const framing = keyFramingOfView(path, clock, progress, timeS, frame, engine, follow, camera.position, lookAt)
      return { atM: progress * path.lengthM, framing }
    })
  }, [path, frame, engine, camera, controls, clock, follow])

  // The camera keyframe the playhead is on (reached with the arrows) follows the view while it is moved with the mouse:
  // each move of the camera writes its pose into the key, live, so the inspector shows it; one undo step per gesture.
  const keyGestureRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!path || path.count === 0 || !frame || !controls?.addEventListener) return
    const follow = () => {
      if (!keyGestureRef.current) return
      const { playback } = useAppStore.getState()
      const current = clockRef.current
      const key = keyAt(current.cameraKeys, Math.min(playback.timeS ?? current.timeAtProgress(playback.progress), current.totalTime()))
      const captured = key && captureKey()
      if (key && captured) editFilm((f) => ({ film: updateCameraKey(f, key.id, captured.framing) }), { step: false })
    }
    const start = () => {
      keyGestureRef.current ??= getSettingsHistory().beginGesture()
      // the hand takes the camera over: no more bank (the film's roll is not a key's)
      camera.up.set(0, 1, 0)
    }
    const end = () => {
      follow()
      keyGestureRef.current?.()
      keyGestureRef.current = null
    }
    controls.addEventListener?.('start', start)
    controls.addEventListener?.('change', follow)
    controls.addEventListener?.('end', end)
    return () => {
      controls.removeEventListener?.('start', start)
      controls.removeEventListener?.('change', follow)
      controls.removeEventListener?.('end', end)
    }
  }, [path, frame, controls, camera])

  useFrame(({ camera, size, gl, controls: orbit }, delta) => {
    const store = useAppStore.getState()
    const { playing, speed } = store.playback
    const { settings } = store
    // « Focale »: the lens of the film, in the preview and in the export (it draws with this camera; R3F keeps the fov through
    // a resize). The projection matrix is what the labels, the marker and the terrain's level of detail read.
    const lens = camera as PerspectiveCamera
    const fov = fovDegOf(settings.camera.focalMm)
    if (lens.isPerspectiveCamera && lens.fov !== fov) {
      lens.fov = fov
      lens.updateProjectionMatrix()
    }
    // after a change of the film, keep the film time (the timeline edits in film time) and take its progress
    if (clockRef.current !== clock) {
      clockRef.current = clock
      const { timeS } = store.playback
      if (timeS !== null) {
        const t = Math.min(timeS, clock.totalTime())
        store.setProgress(clock.progressAtTime(t), t < clock.totalTime() ? t : null)
      }
    }
    if (playing) {
      const { progress, timeS } = useAppStore.getState().playback
      // resynchronise after a scrub or a change of the film (no film time)
      const from = timeS === null ? clock.positionAt(progress) : { timeS, progress }
      const position = clock.advance(from, frameDelta(delta), speed)
      // the work area loops: past its out point the playback comes back to the in point
      const area = clampWorkArea(store.workArea, clock.totalTime())
      const wrapped = area ? loopTime(from.timeS, position.timeS, area) : null
      if (wrapped !== null) store.setProgress(clock.progressAtTime(wrapped), wrapped)
      // the film ends at its total time, after the closing: without a film time, progress 1 stops the playback
      else store.setProgress(position.progress, position.timeS < clock.totalTime() ? position.timeS : null)
    }
    const { progress, timeS: storedTimeS } = useAppStore.getState().playback
    const timeS = storedTimeS ?? clock.timeAtProgress(progress)

    const orbitControls = orbit as unknown as DefaultControls | null
    if (orbitControls) orbitControls.enabled = !playing
    const marker = markerRef.current
    const leaving = fadeRef.current
    if (!marker || !leaving) return
    if (!path || path.count === 0 || !frame) {
      marker.visible = false
      leaving.visible = false
      return
    }

    // the highlighted region a 'situation' shot frames, once loaded (osm/region.ts)
    const region = useRegionStore.getState().frame
    // the export places its camera with the same function
    const aspect = size.height > 0 ? size.width / size.height : 1
    const view = filmViewAt(path, clock, progress, timeS, frame, engine, aspect, follow)
    marker.visible = true

    const applied = appliedSettingsRef.current
    const cameraChanged =
      settings.camera !== applied.camera ||
      settings.flyoverDurationS !== applied.flyoverDurationS ||
      settings.film !== applied.film ||
      settings.race !== applied.race ||
      settings.labels.photoPins !== applied.labels.photoPins ||
      region !== appliedRegionRef.current
    const placed = appliedRef.current
    // the turn towards a photo's pin follows the film time, even while the marker holds
    const timed =
      filmViewMovesWithTime(clock.stateAt(timeS), settings.camera) ||
      highViewAt(clock, timeS) !== null ||
      pinsMoveWithTime(settings.labels, settings.film)
    const moved = progress !== placed.progress || ((timed || placed.timed) && timeS !== placed.timeS)
    if (playing || moved || cameraChanged) {
      appliedRef.current = { progress, timeS, timed }
      appliedSettingsRef.current = settings
      appliedRegionRef.current = region
      camera.position.copy(view.position)
      lookAtView(camera, view)
      orbitControls?.target.copy(view.target)
    }
    // after the camera move: the figure faces the way the track runs in this very frame; the colour, figure and name
    // of the track under the marker (the stage « À la suite »)
    const under = trackUnderMarker(store.tracks, settings.race, progress)?.track ?? track
    const imageOf = (id: string) => useMediaStore.getState().table[id]?.data ?? ''
    const blend = markerAt(settings.film, settings.marker, progress * path.lengthM, markerFadeM(path.lengthM, clock.flightS), imageOf)
    const exposureGain = 1 / gl.toneMappingExposure
    // the figure turns round over FIGURE_TURN_S: the film camera that long ago tells where the track ran then (the
    // racers read it too); not while the camera is the user's (moved away from the film's by orbiting a paused film)
    const pastS = timeS - FIGURE_TURN_S
    const figure = settings.marker.kind === 'figurine' || blend.from.kind === 'figurine' || blend.to.kind === 'figurine'
    const past = figure && camera.position.distanceToSquared(view.position) < 1 ? filmViewAt(path, clock, clock.progressAtTime(Math.max(0, pastS)), Math.max(0, pastS), frame, engine, aspect, follow) : null
    showPastView(pastS, past)
    const distanceAt = (t: number) => clock.progressAtTime(Math.max(0, t)) * path.lengthM
    const draw = (sprite: Sprite, look: MarkerSettings, weight: number) => {
      const heading = look.kind === 'figurine' ? figureHeading(path, distanceAt, timeS, view.marker, frame, camera, past, settings.exaggeration) : null
      const colors = leadMarkerColors(look, under?.color ?? '#FFFFFF')
      const shown = markerLook(look, under, true, markerImages.get(look.image) ?? null)
      placeMarker(sprite, view.marker, camera, shown, colors, heading?.facing ?? 1, exposureGain, timeS, heading?.lean, shown.animated ? figureMotion(clock, timeS) : undefined)
      pullMarkerForward(sprite, camera)
      ;(sprite.material as SpriteMaterial).opacity = weight
    }
    // a change of look: the new one fades in over the old, which stays opaque until it is settled
    leaving.visible = blend.mix < 1
    if (leaving.visible) draw(leaving, blend.from, 1)
    draw(marker, blend.to, blend.mix)
  })

  // unlit and drawn over the terrain (cut by the relief in front of it): readable on the track colour and on dark forest alike
  return (
    <>
      <sprite ref={fadeRef} name="flyover-marker-from" visible={false} renderOrder={2}>
        <spriteMaterial depthWrite={false} />
      </sprite>
      <sprite ref={markerRef} name="flyover-marker" visible={false} renderOrder={2}>
        <spriteMaterial depthWrite={false} />
      </sprite>
    </>
  )
}
