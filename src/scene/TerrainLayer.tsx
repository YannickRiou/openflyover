/**
 * TerrainLayer — owns the terrain engine lifecycle (create / configure / dispose) and shares the engine and the local
 * tangent frame with sibling scene components through React context.
 *
 * The engine is created in an effect, never in useMemo: React StrictMode double-invokes effects, and "create in the
 * effect body, dispose in its cleanup" is the only pattern that cannot leak GPU resources.
 * It is recreated only when the local frame changes, when the tracks grow outside its area or when a 'situation' shot
 * is added or removed (`engineAreaFor`); settings changes go through `engine.setOptions`.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import type { LocalFrame, TerrainEngine, TerrainStats } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { createTerrainEngine, restoreEngineImagery } from '../terrain/engine'
import { createTileFetcher } from '../terrain/fetch'
import { exportLodHeight } from '../export/schedule'
import { isExportBusy, useExportStore } from '../export/store'
import { playsBilan } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import { TerrainEngineContext, type TerrainContextValue } from './terrainContext'
import {
  EMPTY_TERRAIN_STATS,
  ERROR_TARGET_PX,
  STATS_INTERVAL_S,
  diffEngineOptions,
  engineAreaFor,
  engineOptionsFromSettings,
  resolveEngineArea,
  statsEqual,
  usesRegionView,
  type EngineArea,
  type EngineSettingsOptions,
} from './terrainLayerSetup'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TerrainLayerProps {
  /** Scene components that need the engine (TrackLines, CameraRig...). */
  children?: ReactNode
}

interface AppliedOptions {
  engine: TerrainEngine
  options: EngineSettingsOptions
}

/**
 * The tiles already decoded outlive the engine: one fetcher for every engine of the session, so a rebuilt engine (a
 * track added or removed, a « Depuis la région » shot switched) finds them without asking the network or the HTTP
 * cache again, as the export finds the preview's. Bounded like any fetcher (`deviceBudget().tileBitmaps`), emptied when
 * no track is left.
 */
let sharedFetcher: ReturnType<typeof createTileFetcher> | undefined

export function TerrainLayer({ children }: TerrainLayerProps) {
  const frameOrigin = useAppStore((s) => s.frameOrigin)
  const bounds = useAppStore((s) => s.bounds)
  const settings = useAppStore((s) => s.settings)
  // a « Bilan » looks at its regions from high up, like a region view: a wide area, coarse beyond the tracks
  const regionView = useAppStore((s) => usesRegionView(s.settings.film) || playsBilan(s.settings.race, s.tracks.length))
  const setTerrainStats = useAppStore((s) => s.setTerrainStats)

  // Local frame: depends on the origin values only, so a store update that keeps the same origin
  // does not rebuild the frame (and therefore does not recreate the engine).
  const originLon = frameOrigin?.lon
  const originLat = frameOrigin?.lat
  const frame = useMemo<LocalFrame | null>(
    () => (originLon === undefined || originLat === undefined ? null : createLocalFrame(originLon, originLat)),
    [originLon, originLat],
  )

  // Area of interest: sticky while the previous area still covers the tracks. The previous area is
  // kept in state and adjusted during render (React's "store information from previous renders"
  // pattern): the extra render only happens when the area actually changes.
  const desiredArea = useMemo<EngineArea | null>(
    () => (bounds ? engineAreaFor(bounds, regionView) : null),
    [bounds, regionView],
  )
  const [previousArea, setPreviousArea] = useState<EngineArea | null>(null)
  const area = desiredArea ? resolveEngineArea(previousArea, desiredArea) : null
  if (area !== previousArea) setPreviousArea(area)

  // Engine lifecycle.
  const [engine, setEngine] = useState<TerrainEngine | null>(null)
  const appliedRef = useRef<AppliedOptions | null>(null)
  const lastStatsRef = useRef<TerrainStats | null>(null)
  const statsClockRef = useRef(0)

  useEffect(() => {
    if (!frame || !area) {
      sharedFetcher?.clear()
      return undefined
    }
    sharedFetcher ??= createTileFetcher()
    // Read the settings imperatively: they are forwarded by the effect below, so they must not be a
    // dependency here (a settings change must never recreate the engine).
    const options = engineOptionsFromSettings(useAppStore.getState().settings)
    const created = createTerrainEngine({ frame, ...area, errorTargetPx: ERROR_TARGET_PX, ...options }, { fetcher: sharedFetcher })
    appliedRef.current = { engine: created, options }
    lastStatsRef.current = null
    statsClockRef.current = 0
    // oxlint-disable-next-line react/set-state-in-effect -- publishes the engine this effect creates (a WebGL resource disposed in the cleanup below)
    setEngine(created)

    return () => {
      setEngine((current) => (current === created ? null : current))
      if (appliedRef.current?.engine === created) appliedRef.current = null
      created.group.removeFromParent()
      created.dispose()
      lastStatsRef.current = null
      setTerrainStats({ ...EMPTY_TERRAIN_STATS })
    }
  }, [frame, area, setTerrainStats])

  // A new WebGL context has none of the textures: the imagery canvases released after their upload are drawn again.
  const domElement = useThree((s) => s.gl)?.domElement
  useEffect(() => {
    if (!engine || !domElement) return undefined
    const restore = () => restoreEngineImagery(engine)
    domElement.addEventListener('webglcontextrestored', restore)
    return () => domElement.removeEventListener('webglcontextrestored', restore)
  }, [engine, domElement])

  // Forward settings changes (only the keys that actually changed).
  useEffect(() => {
    if (!engine) return
    const next = engineOptionsFromSettings(settings)
    const applied = appliedRef.current
    const partial = applied && applied.engine === engine ? diffEngineOptions(applied.options, next) : next
    if (!partial) return
    engine.setOptions(partial)
    appliedRef.current = { engine, options: next }
  }, [engine, settings])

  // Per-frame update + throttled stats (4 Hz, only when values change).
  useFrame(({ camera, size }, delta) => {
    if (!engine) return
    const perspective = camera as PerspectiveCamera
    if (!perspective.isPerspectiveCamera) return
    // the canvas has the film's size during an export: a phone picks its tiles for a lower view (fewer in memory)
    const exporting = isExportBusy(useExportStore.getState().phase)
    engine.update(perspective, exporting ? exportLodHeight(size.height) : size.height)

    statsClockRef.current += delta
    if (statsClockRef.current < STATS_INTERVAL_S) return
    statsClockRef.current = 0
    const stats = engine.stats
    if (lastStatsRef.current && statsEqual(lastStatsRef.current, stats)) return
    const snapshot: TerrainStats = { ...stats }
    lastStatsRef.current = snapshot
    setTerrainStats(snapshot)
  })

  const value = useMemo<TerrainContextValue>(() => ({ engine, frame }), [engine, frame])

  return (
    <TerrainEngineContext.Provider value={value}>
      {engine && <primitive key={engine.group.uuid} object={engine.group} dispose={null} />}
      {children}
    </TerrainEngineContext.Provider>
  )
}
