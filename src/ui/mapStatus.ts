/**
 * What the status bar says, pure: the map state (« Carte · 72 % » / « Carte prête », derived from the terrain stats;
 * the caller passes the time, so the smoothing is testable), the chips of the other fetches, the performance readout
 * and the short credits of the active sources.
 */
import type { TerrainStats } from '../core/types'
import { t } from '../i18n'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { formatBytes, formatNumber } from './format'
import type { PerfItem, StatusChip } from './shell'

/** A load shorter than this never shows: a small camera move stays « Carte prête ». */
export const MAP_LOADING_DELAY_MS = 500
/** Shown progress stops here until the view has every tile (never « 100 % » while loading). */
const MAX_LOADING_PROGRESS = 0.99

export type MapPhase = 'idle' | 'loading' | 'ready'

export interface MapStatus {
  /** state of the tiles: nothing yet, view still waiting for tiles, view complete */
  phase: MapPhase
  /** state on screen: a load is shown only once it lasts MAP_LOADING_DELAY_MS */
  shown: MapPhase
  /** share of the view drawn, 0–0.99 while loading and never going back during one load; 1 when ready */
  progress: number
  /** start of the current load, ms */
  since: number
  failed: number
}

export const IDLE_MAP_STATUS: MapStatus = { phase: 'idle', shown: 'idle', progress: 0, since: 0, failed: 0 }

/** Share of the current view already final: drawn tiles over drawn + awaited ones. */
export function viewProgress(stats: TerrainStats): number {
  const pending = stats.pendingVisibleTiles ?? stats.pendingTiles
  const total = stats.visibleTiles + pending
  return total > 0 ? stats.visibleTiles / total : 1
}

export function nextMapStatus(prev: MapStatus, stats: TerrainStats, nowMs: number): MapStatus {
  const failed = stats.failedTiles
  const pending = stats.pendingVisibleTiles ?? stats.pendingTiles
  if (stats.visibleTiles === 0 && stats.loadedTiles === 0 && pending === 0 && failed === 0) return IDLE_MAP_STATUS
  if (pending === 0) return { phase: 'ready', shown: 'ready', progress: 1, since: 0, failed }

  const raw = Math.min(viewProgress(stats), MAX_LOADING_PROGRESS)
  const continuing = prev.phase === 'loading'
  const since = continuing ? prev.since : nowMs
  const progress = continuing ? Math.max(prev.progress, raw) : raw
  // until the delay, the previous resting state stays on screen (nothing at the very start, « Carte prête » later)
  const shown = nowMs - since >= MAP_LOADING_DELAY_MS ? 'loading' : continuing ? prev.shown : prev.phase
  return { phase: 'loading', shown, progress, since, failed }
}

// ---------------------------------------------------------------------------
// Chips of the other fetches (« Réglages » › « Barre d'état »)
// ---------------------------------------------------------------------------

export type ChipTone = 'loading' | 'ready' | 'attention' | 'muted'

export interface FetchChip {
  label: string
  tone: ChipTone
  /** the state in words (tooltip, screen readers) */
  tip: string
}

const CHIP_LABELS: Record<StatusChip, string> = {
  get weather() { return t('settings.preferences.status.weather') },
  get landmarks() { return t('settings.preferences.status.landmarks') },
  get region() { return t('settings.preferences.status.region') },
  get water() { return t('settings.preferences.status.water') },
}
const CHIP_SOURCES: Record<StatusChip, string> = {
  get weather() { return t('status.source.weather') },
  get landmarks() { return t('status.source.landmarks') },
  get region() { return t('status.source.region') },
  get water() { return t('status.source.water') },
}

/**
 * Chip of a fetch from the status of its store (weather, landmarks, region, water), null while idle. « unavailable »
 * (untimed track) and « none » (no region around the track) are not errors.
 */
export function fetchChip(chip: StatusChip, status: string, message: string | null = null): FetchChip | null {
  const label = CHIP_LABELS[chip]
  const source = CHIP_SOURCES[chip]
  switch (status) {
    case 'loading':
      return { label, tone: 'loading', tip: t('status.chip.loading', { source }) }
    case 'ready':
      return { label, tone: 'ready', tip: t('status.chip.ready', { source }) }
    case 'error':
      return { label, tone: 'attention', tip: message ?? t('status.chip.error', { source }) }
    case 'unavailable':
    case 'none':
      return { label, tone: 'muted', tip: message ?? t('status.chip.none', { source }) }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Performance readout
// ---------------------------------------------------------------------------

/** Machine load read by the desktop app (src-tauri/src/system.rs). */
export interface SystemStats {
  usedMemoryBytes: number
  totalMemoryBytes: number
  cpuPercent: number
}

/** One reading, every part optional (unknown here or not read yet). */
export interface PerfSample {
  /** frames drawn by the 3D view over the last second */
  fps?: number
  textures?: number
  geometries?: number
  tiles?: number
  /** JavaScript heap in use (Chromium only) */
  heapBytes?: number
  system?: SystemStats
}

/** 312 Mo, 8,2 Go (312 MB, 8.2 GB) */
export const formatMemory = formatBytes

/** The parts of the readout `shown` asks for and `sample` knows, in a fixed order. */
export function perfParts(sample: PerfSample, shown: Record<PerfItem, boolean>): string[] {
  const parts: string[] = []
  if (shown.fps && sample.fps !== undefined) parts.push(sample.fps > 0 ? t('status.perf.fps', { value: formatNumber(sample.fps) }) : t('status.perf.idle'))
  if (shown.gpu && sample.textures !== undefined && sample.geometries !== undefined) {
    parts.push(t('status.perf.gpu', { textures: formatNumber(sample.textures), geometries: formatNumber(sample.geometries) }))
  }
  if (shown.tiles && sample.tiles !== undefined) parts.push(t('status.perf.tiles', { value: formatNumber(sample.tiles) }))
  if (shown.memory && sample.heapBytes !== undefined) parts.push(t('status.perf.js', { value: formatMemory(sample.heapBytes) }))
  if (shown.system && sample.system) {
    const { usedMemoryBytes, totalMemoryBytes, cpuPercent } = sample.system
    parts.push(t('status.perf.ram', { used: formatMemory(usedMemoryBytes), total: formatMemory(totalMemoryBytes) }), t('status.perf.cpu', { value: formatNumber(cpuPercent) }))
  }
  return parts
}

// ---------------------------------------------------------------------------
// Short credits of the active sources: always on the status bar, the full lines in « Sources et licences »
// ---------------------------------------------------------------------------

export interface CreditItem {
  text: string
  /** licence or attribution page */
  href?: string
  /** data providers that may fold into an expandable element on a narrow status bar (Esri) */
  more?: string
}

const OSM_CREDIT: CreditItem = { text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' }
const OPEN_METEO_CREDIT: CreditItem = { text: 'Open-Meteo', href: 'https://open-meteo.com/' }
const IGN_CREDIT: CreditItem[] = [{ text: '© IGN' }]
const SWISSTOPO_CREDIT: CreditItem[] = [{ text: '© swisstopo' }]

/** Short names of the `attribution` of each source of `terrain/sources.ts`, by id. */
export const SOURCE_CREDITS: Readonly<Record<string, readonly CreditItem[]>> = {
  mapterhorn: [{ text: '© Mapterhorn', href: 'https://mapterhorn.com/attribution' }],
  'aws-terrarium': [{ text: 'Mapzen / AWS Terrain Tiles' }],
  'ign-ortho': IGN_CREDIT,
  'ign-plan': IGN_CREDIT,
  swisstopo: SWISSTOPO_CREDIT,
  'swisstopo-carte': SWISSTOPO_CREDIT,
  'arcgis-world-imagery': [{ text: 'Powered by Esri', more: 'Esri, Vantor, Earthstar Geographics, GIS User Community' }],
  'basemap-at': [{ text: 'basemap.at', href: 'https://basemap.at/' }],
  'gsi-photo': [{ text: 'GSI Japan', href: 'https://maps.gsi.go.jp/development/ichiran.html' }],
  'usgs-imagery': [{ text: 'USGS', href: 'https://www.usgs.gov/' }],
  opentopomap: [OSM_CREDIT, { text: '© OpenTopoMap', href: 'https://opentopomap.org/about' }],
}

export interface CreditSourceIds {
  terrainSourceId: string
  imagerySourceId: string
  /** weather data loaded */
  weather: boolean
  /** OpenStreetMap data shown: landmarks, water or the highlighted region */
  osm: boolean
}

/** Short credits of the active sources, OpenStreetMap first, each once; a source without a short name keeps its full attribution. */
export function compactCredits({ terrainSourceId, imagerySourceId, weather, osm }: CreditSourceIds): CreditItem[] {
  const imagery = getImagerySource(imagerySourceId)
  const terrain = getTerrainSource(terrainSourceId)
  const items = [
    ...(osm ? [OSM_CREDIT] : []),
    ...(SOURCE_CREDITS[imagery.id] ?? [{ text: imagery.attribution }]),
    ...(SOURCE_CREDITS[terrain.id] ?? [{ text: terrain.attribution }]),
    ...(weather ? [OPEN_METEO_CREDIT] : []),
  ]
  return items.filter((item, i) => items.findIndex((other) => other.text === item.text) === i)
}
