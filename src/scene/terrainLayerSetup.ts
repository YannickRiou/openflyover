/**
 * What `TerrainLayer` builds its engine from: the area of the tracks, the options driven by the settings and the
 * stats it pushes to the store. Pure (unit-tested), kept apart from the component so its file only exports components.
 */
import { deviceBudget } from '../core/deviceBudget'
import type { LonLatBounds, TerrainEngineOptions, TerrainStats } from '../core/types'
import { expandBounds } from '../geo/ellipsoid'
import type { Film } from '../film/model'
import { REGION_AREA_MARGIN_M } from '../flyover/filmCamera'
import { AREA_MARGIN_M, AREA_MIN_SIZE_M } from '../terrain/engine'
import { DEFAULT_DEM_CLEAN, sameDemClean } from '../terrain/demClean'
import { datedImagerySource } from '../terrain/imageryDates'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import type { Settings } from '../state/store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Screen-space error threshold handed to the engine (pixels). */
export const ERROR_TARGET_PX = 3
/** How often terrain stats are pushed to the store (seconds): 4 Hz. */
export const STATS_INTERVAL_S = 0.25

export const EMPTY_TERRAIN_STATS: TerrainStats = { visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 }

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** True when `inner` lies entirely inside `outer` (no antimeridian handling). */
export function boundsContain(outer: LonLatBounds, inner: LonLatBounds): boolean {
  return (
    inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north
  )
}

/** Area of the engine; with a detail area, the rest of `area` stays coarse (`OUTER_MAX_ZOOM` of terrain/engine.ts). */
export interface EngineArea {
  area: LonLatBounds
  detailArea?: LonLatBounds
}

/** The film opens or closes on the region view (a 'situation' shot). */
export function usesRegionView(film: Pick<Film, 'opening' | 'closing'>): boolean {
  return film.opening.style === 'situation' || film.closing.style === 'situation'
}

/**
 * Area of the tracks `bounds`: AREA_MARGIN_M around them (at least AREA_MIN_SIZE_M across); for a region view,
 * that becomes the detail area of a much larger one (REGION_AREA_MARGIN_M around them), coarse beyond it.
 */
export function engineAreaFor(bounds: LonLatBounds, regionView: boolean): EngineArea {
  const area = expandBounds(bounds, AREA_MARGIN_M, AREA_MIN_SIZE_M)
  return regionView ? { area: expandBounds(bounds, REGION_AREA_MARGIN_M), detailArea: area } : { area }
}

/**
 * Area the engine should be built for: keep the previous area while it still covers the desired one and has the
 * same kind (avoids tearing the whole terrain down for a nearby track), otherwise switch to the desired area.
 */
export function resolveEngineArea(previous: EngineArea | null, desired: EngineArea): EngineArea {
  if (!previous || !boundsContain(previous.area, desired.area)) return desired
  if (!previous.detailArea || !desired.detailArea) return previous.detailArea === desired.detailArea ? previous : desired
  return boundsContain(previous.detailArea, desired.detailArea) ? previous : desired
}

export function statsEqual(a: TerrainStats, b: TerrainStats): boolean {
  return (
    a.visibleTiles === b.visibleTiles &&
    a.loadedTiles === b.loadedTiles &&
    a.pendingTiles === b.pendingTiles &&
    a.failedTiles === b.failedTiles &&
    a.lodFactor === b.lodFactor
  )
}

/** The subset of engine options that is driven by the user settings. */
export type EngineSettingsOptions = Pick<
  TerrainEngineOptions,
  'terrain' | 'imagery' | 'imageryZoomOffset' | 'exaggeration' | 'wireframe' | 'demClean'
>

export function engineOptionsFromSettings(settings: Settings): EngineSettingsOptions {
  return {
    terrain: getTerrainSource(settings.terrainSourceId),
    imagery: datedImagerySource(getImagerySource(settings.imagerySourceId), settings.imageryDate),
    // « Très fin » (1024 px textures) is too heavy for a phone's GPU memory
    imageryZoomOffset: Math.min(settings.imageryZoomOffset, deviceBudget().maxImageryZoomOffset),
    exaggeration: settings.exaggeration,
    wireframe: settings.wireframe,
    demClean: settings.demClean,
  }
}

/** Keys of `next` whose value differs from `prev` (sources compared by id), or null when nothing changed. */
export function diffEngineOptions(
  prev: EngineSettingsOptions,
  next: EngineSettingsOptions,
): Partial<EngineSettingsOptions> | null {
  const partial: Partial<EngineSettingsOptions> = {}
  let changed = false
  if (prev.terrain.id !== next.terrain.id) {
    partial.terrain = next.terrain
    changed = true
  }
  if (prev.imagery.id !== next.imagery.id) {
    partial.imagery = next.imagery
    changed = true
  }
  if (prev.imageryZoomOffset !== next.imageryZoomOffset) {
    partial.imageryZoomOffset = next.imageryZoomOffset
    changed = true
  }
  if (prev.exaggeration !== next.exaggeration) {
    partial.exaggeration = next.exaggeration
    changed = true
  }
  if (prev.wireframe !== next.wireframe) {
    partial.wireframe = next.wireframe
    changed = true
  }
  if (!sameDemClean(prev.demClean ?? DEFAULT_DEM_CLEAN, next.demClean ?? DEFAULT_DEM_CLEAN)) {
    partial.demClean = next.demClean
    changed = true
  }
  return changed ? partial : null
}

