/**
 * TrackLines — draws every loaded track draped on the terrain: one Line2 per segment (and its glow), depth-tested so
 * the relief hides the parts behind it; a flight also gets its curtain and its ground shadow (see "Track and marker" in ARCHITECTURE.md; styles in `trackLineStyle.ts`,
 * colours in `flyover/trackColor.ts`).
 *
 * The line objects, their draping and styles are in `trackLineSet.ts` (no React, so this file only exports the
 * component and keeps fast refresh); they are managed imperatively in one <group> and disposed on unmount.
 *
 * « Trace qui se dessine » cuts each track at its marker (and « Traînée » its start) through a store subscription, so
 * it applies in the very frame FlyoverRig moves the marker (this component's frame callback runs before the rig's).
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
  applyFlightDepth,
  applyResolution,
  applyTrackColors,
  applyTrackStyle,
  cutTrackLineSet,
  dimTrackLineSet,
  disposeTrackLineSet,
  curtainLengthM,
  drapeTrackLineSet,
  drawOnDistances,
  syncTrackLineSets,
  type TrackLineSet,
} from './trackLineSet'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Share of its colours an outing already drawn keeps in a « Bilan ». */
const BILAN_DIM = 0.45

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
  const curtainM = curtainLengthM(useAppStore((s) => s.settings.trackStyle.flightCurtainM))
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
    const sequence = filmSequenceOf(current, settings.race)
    // « Bilan »: the outings draw themselves one after the other whatever the setting, the finished ones dimmer, without a tail
    const bilan = sequence?.bilan !== undefined
    const distances = settings.trackStyle.drawOn || bilan ? drawOnDistances(flown, playback.progress, settings.race.enabled ? raceRef.current : null, sequence) : null
    // « Traînée »: only with the draw-on
    const trailM = distances && settings.trackTail.enabled && !bilan ? settings.trackTail.lengthM : Infinity
    flown.forEach((track, i) => {
      const set = setsRef.current.get(track.id)
      if (!set) return
      cutTrackLineSet(set, distances?.[i] ?? Infinity, trailM)
      const stage = sequence?.stages[i]
      dimTrackLineSet(set, bilan && stage && i < flown.length - 1 && (distances?.[i] ?? 0) >= stage.endM - stage.startM ? BILAN_DIM : 1)
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

  const drapeAll = useCallback((current: TerrainEngine | null, factor: number, curtain: number) => {
    for (const set of setsRef.current.values()) drapeTrackLineSet(set, current, factor, curtain)
    wakeScene()
  }, [])

  /** terrain, exaggeration and curtain length the lines were last draped with */
  const drapedWith = useRef<{ engine: TerrainEngine | null; exaggeration: number; curtainM: number } | null>(null)
  // Build / rebuild the lines, then drape them with the current terrain and exaggeration: all of them when these
  // changed, else only the ones built (a recolour rebuilds nothing, and drapes nothing).
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const { width, height } = sizeRef.current
    const built = syncTrackLineSets(group, setsRef.current, tracks, frame, width, height, smoothingM)
    exposureRef.current = Number.NaN
    styleRef.current = null
    const last = drapedWith.current
    if (!last || last.engine !== engine || last.exaggeration !== exaggeration || last.curtainM !== curtainM) {
      drapedWith.current = { engine, exaggeration, curtainM }
      drapeAll(engine, exaggeration, curtainM)
    } else if (built.length > 0) {
      for (const set of built) drapeTrackLineSet(set, engine, exaggeration, curtainM)
      wakeScene()
    } else wakeScene()
  }, [tracks, frame, engine, exaggeration, drapeAll, smoothingM, curtainM])

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
    // a flight's width is the user's at the distance the camera looks at (the dashes' scale reference too)
    applyFlightDepth(setsRef.current.values(), viewDistance(camera, controls?.target ?? null))
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
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration, curtainM))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, curtainM, redrape])

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
