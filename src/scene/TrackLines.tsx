/**
 * TrackLines — draws every loaded track draped on the terrain: one Line2 per segment (and its glow), depth-tested so
 * the relief hides the parts behind it (see "Track and marker" in ARCHITECTURE.md; styles in `trackLineStyle.ts`,
 * colours in `flyover/trackColor.ts`).
 *
 * The line objects, their draping and styles are in `trackLineSet.ts` (no React, so this file only exports the
 * component and keeps fast refresh); they are managed imperatively in one <group> and disposed on unmount.
 *
 * « Trace qui se dessine » cuts each track at its marker through a store subscription, so it applies in the very frame
 * FlyoverRig moves the marker (this component's frame callback runs before the rig's).
 */
import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import type { TerrainEngine } from '../core/types'
import { registerDrapeFlush, useExportStore } from '../export/store'
import { filmSequenceOf, orderedTracks } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import type { TrackStyle } from './markerSettings'
import { useTerrainContext } from './terrainContext'
import { wakeScene } from './renderOnDemand'
import { quantizedPixelSize, viewDistance } from './trackLineStyle'
import { useDebouncedCallback } from './useDebouncedCallback'
import { useRace } from './useRace'
import {
  REDRAPE_DEBOUNCE_MS,
  REDRAPE_MAX_WAIT_MS,
  applyExposure,
  applyResolution,
  applyTrackColors,
  applyTrackStyle,
  cutTrackLineSet,
  disposeTrackLineSet,
  drapeTrackLineSet,
  drawOnDistances,
  syncTrackLineSets,
  type TrackLineSet,
} from './trackLineSet'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** What the default controls (drei OrbitControls) expose here: the point the camera looks at. */
interface DefaultControls {
  target: Vector3
}

/** Style values the materials were last set for. */
interface AppliedStyle {
  style: TrackStyle
  renderScale: number
  pixelSize: number
}

export function TrackLines() {
  const tracks = useAppStore((s) => s.tracks)
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const colorBy = useAppStore((s) => s.settings.trackColorBy)
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  const race = useRace()
  const { engine, frame } = useTerrainContext()
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as DefaultControls | null

  const groupRef = useRef<Group>(null)
  const setsRef = useRef<Map<string, TrackLineSet>>(new Map())
  const sizeRef = useRef(size)
  /** exposure the line colours were last compensated for (NaN = after a rebuild) */
  const exposureRef = useRef(Number.NaN)
  /** style the materials were last set for (null = after a rebuild) */
  const styleRef = useRef<AppliedStyle | null>(null)
  const raceRef = useRef(race)

  useEffect(() => {
    raceRef.current = race
  }, [race])

  // « Trace qui se dessine »: each set cut at its marker (cutTrackLineSet does nothing when unchanged).
  const refreshDrawOn = useCallback(() => {
    const { tracks: current, playback, settings } = useAppStore.getState()
    // the distances are in the order of the stages « À la suite »
    const flown = orderedTracks(current, settings.race)
    const distances = settings.trackStyle.drawOn
      ? drawOnDistances(flown, playback.progress, settings.race.enabled ? raceRef.current : null, filmSequenceOf(current, settings.race))
      : null
    flown.forEach((track, i) => {
      const set = setsRef.current.get(track.id)
      if (set) cutTrackLineSet(set, distances?.[i] ?? Infinity)
    })
  }, [])

  // the progress set by FlyoverRig during this frame, before it is rendered
  useEffect(() => useAppStore.subscribe(refreshDrawOn), [refreshDrawOn])

  // Keep the material resolution in sync with the canvas size (Line2 also refreshes it before each
  // render, this covers objects that are not rendered yet).
  useEffect(() => {
    sizeRef.current = size
    applyResolution(setsRef.current.values(), size.width, size.height)
  }, [size])

  const drapeAll = useCallback((current: TerrainEngine | null, factor: number) => {
    for (const set of setsRef.current.values()) drapeTrackLineSet(set, current, factor)
    wakeScene()
  }, [])

  // Build / rebuild the lines, then drape them with the current terrain and exaggeration.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const { width, height } = sizeRef.current
    syncTrackLineSets(group, setsRef.current, tracks, frame, width, height, smoothingM)
    exposureRef.current = Number.NaN
    styleRef.current = null
    drapeAll(engine, exaggeration)
  }, [tracks, frame, engine, exaggeration, drapeAll, smoothingM])

  // Colours: after the build above (same commit), only when the mode or the set of lines changes.
  useEffect(() => {
    applyTrackColors(setsRef.current.values(), colorBy)
    exposureRef.current = Number.NaN
  }, [tracks, frame, colorBy, smoothingM])

  useFrame(({ gl, camera, size: canvas }) => {
    const { renderScale } = useExportStore.getState()
    const style = useAppStore.getState().settings.trackStyle
    const pixelSize = style.dash === 'plein' ? 0 : quantizedPixelSize(viewDistance(camera, controls?.target ?? null), camera, canvas.height)
    const applied = styleRef.current
    if (!applied || applied.style !== style || applied.renderScale !== renderScale || applied.pixelSize !== pixelSize) {
      styleRef.current = { style, renderScale, pixelSize }
      applyTrackStyle(setsRef.current.values(), style, renderScale, pixelSize)
      // the glow colour is applied with the exposure
      exposureRef.current = Number.NaN
    }
    // after a rebuild or a re-drape (the subscription covers the progress and settings)
    refreshDrawOn()
    if (gl.toneMappingExposure === exposureRef.current) return
    exposureRef.current = gl.toneMappingExposure
    applyExposure(setsRef.current.values(), gl.toneMappingExposure, style.glowColor)
  })

  // Re-drape (debounced, with a bounded wait so a long tile stream cannot starve it) whenever the engine
  // reports new or removed tiles.
  const redrape = useDebouncedCallback(drapeAll, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)
  // the video export runs the pending re-drape right away instead of waiting for the debounce
  useEffect(
    () =>
      registerDrapeFlush(() => {
        const pending = redrape.isPending()
        redrape.flush()
        return pending
      }),
    [redrape],
  )

  useEffect(() => {
    if (!engine) return
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, redrape])

  // Release every Three resource on unmount (also exercised by StrictMode's simulated unmount).
  useEffect(
    () => () => {
      for (const set of setsRef.current.values()) disposeTrackLineSet(set)
      setsRef.current.clear()
    },
    [],
  )

  return <group ref={groupRef} name="track-lines" />
}
