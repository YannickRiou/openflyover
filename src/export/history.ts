/**
 * History of past renders (« Historique des rendus » of the export panel): the last `HISTORY_LIMIT` exports with the
 * output, the real time they took and a curated summary of the settings that change the render time, to compare speed
 * and settings and to put those settings back (`reuseSettings`). Pure (tested): the summary, the entry, the cap, the
 * tolerant parsing and the formatting; `historyStore.ts` keeps the list in the platform storage.
 *
 * Small on purpose: no track, no coordinate, no project, only values of the settings (`RenderSettings`).
 */
import { t } from '../i18n'
import { formatDate } from '../i18n/format'
import { formatNumber, formatPercent } from '../ui/format'
import type { CameraStyle } from '../flyover/cameraSettings'
import { CAMERA_STYLES, CAMERA_STYLE_LABELS } from '../flyover/cameraSettings'
import { FOREST_DENSITY_RANGE } from '../osm/forest'
import { SHUTTER_SUBFRAMES, isValidLens } from '../scene/lens'
import type { LensSettings } from '../scene/lens'
import type { VideoEncoderKind } from '../platform/platform'
import type { Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { SNOW_MODES } from '../weather/snowLine'
import type { SnowMode } from '../weather/snowLine'
import { CLOUD_MODES, CLOUD_QUALITIES, SEA_RENDERS } from '../weather/sceneClouds'
import type { CloudMode, CloudQuality, SeaRender } from '../weather/sceneClouds'
import { HANDOVER_METHODS, type HandoverMethod } from './handover'
import { CLOUD_QUALITY_NAMES, QUALITY_NAMES, effectiveRender } from './qualityTier'
import { VIDEO_ASPECTS, VIDEO_FPS, VIDEO_QUALITIES, VIDEO_RESOLUTIONS, videoSize } from './schedule'
import type { VideoAspect, VideoQuality, VideoResolution } from './schedule'
import type { ExportRequest, ExportResult, ExportTimings } from './store'

export const HISTORY_KEY = 'openflyover.exportHistory.v1'
/** Renders kept (the oldest go first). */
export const HISTORY_LIMIT = 20
/** Size cap of the stored list (UTF-8 bytes): an entry is about 0.7 KB, long names and errors are cut anyway. */
export const HISTORY_MAX_BYTES = 40_000
export const HISTORY_VERSION = 1

const MAX_NAME = 80
const MAX_ERROR = 120

export type RenderOutcome = 'done' | 'canceled' | 'error'
const OUTCOMES: readonly RenderOutcome[] = ['done', 'canceled', 'error']

/** The settings that change the time of a render, as they were (every field optional: a stored one may lack some). */
export interface RenderSettings {
  atmosphere?: boolean
  shadows?: boolean
  sunHour?: number
  /** `YYYY-MM-DD`, '' = the day of the outing */
  sunDate?: string
  sunFromTrack?: boolean
  /** `quality` is the one the export used (the export quality's, or the one chosen by hand: `tier.cloudsByHand`) */
  clouds?: { mode: CloudMode; quality: CloudQuality; coverage: number; seaRender: SeaRender }
  /**
   * What the export quality decided (qualityTier.ts): the most renders per frame it allowed the motion blur, and
   * whether the clouds' quality was chosen by hand over it. Absent in entries recorded before; added without a new
   * `HISTORY_VERSION` (every reader ignores a field it does not know).
   */
  tier?: { subFrames: number; cloudsByHand: boolean }
  lens?: LensSettings
  /** imagery (map style) and terrain source ids */
  imagery?: string
  imageryZoom?: 0 | 1 | 2
  terrain?: string
  water?: boolean
  /** 4.0 layers, absent in the entries recorded before (added without a new `HISTORY_VERSION`): the snow's mode, the forests */
  snow?: SnowMode
  forest?: { enabled: boolean; density: number }
  camera?: CameraStyle
}

export interface HistoryEntry {
  id: string
  /** end of the render, ms since 1970 */
  at: number
  /** name of the film (file name without extension) */
  name: string
  outcome: RenderOutcome
  error?: string
  /** real time from the first frame to the end (confirmation dialogs excluded), ms */
  wallMs: number
  /** frames of the film, encoded when it ended, distinct images rendered (held frames reuse the previous one) */
  frames: number
  encoded: number
  rendered: number
  /** where the time went (ms): scene + WebGL render, waiting for tiles, composing and encoding */
  renderMs: number
  waitMs: number
  encodeMs: number
  /**
   * Split of the render and encoding time (`ExportTimings`): renders made, GPU time measured (`gpuRenders` of them,
   * 0 where the browser has no timer queries), waiting for the GPU after the render, composing, video frame, waiting
   * for the encoder. 0 in entries recorded before (added without a new `HISTORY_VERSION`).
   */
  renders: number
  gpuMs: number
  gpuRenders: number
  gpuWaitMs: number
  composeMs: number
  frameMs: number
  encodeWaitMs: number
  /** frames whose tiles were still loading at the per-frame timeout, frames with tiles given up on (either fails the export) */
  timeouts: number
  givenUp: number
  /** film duration, held frames included (s) */
  filmS: number
  width: number
  height: number
  fps: number
  quality: VideoQuality
  aspect?: VideoAspect
  resolution?: VideoResolution
  /** the overlay alone over a transparent background */
  overlayOnly?: true
  /** 'mp4/avc' ...; absent when the render did not finish */
  codec?: string
  bytes?: number
  encoder?: 'webcodecs' | 'native'
  /** the browser encoded on the GPU's encoder (`prefer-hardware`) */
  hardware?: true
  /** the way the frames reached the encoder, the fastest measured on the device (`handover.ts`) */
  handover?: HandoverMethod
  settings: RenderSettings
}

/** The settings of `settings` that change the render time, with the values an export of `quality` really used. */
export function summariseSettings(settings: Settings, quality: VideoQuality = settings.video.quality): RenderSettings {
  const { mode, coverage, seaRender } = settings.clouds
  const used = effectiveRender(quality, settings.clouds)
  return {
    atmosphere: settings.atmosphere,
    shadows: settings.shadows,
    sunHour: settings.sunHour,
    sunDate: settings.sunDate,
    sunFromTrack: settings.sunFromTrack,
    clouds: { mode, quality: used.cloudsQuality, coverage, seaRender },
    tier: { subFrames: used.maxSubFrames, cloudsByHand: used.cloudsByHand },
    lens: { ...settings.lens },
    imagery: settings.imagerySourceId,
    imageryZoom: settings.imageryZoomOffset,
    terrain: settings.terrainSourceId,
    water: settings.water.enabled,
    snow: settings.snow.mode,
    forest: { enabled: settings.forest.enabled, density: settings.forest.density },
    camera: settings.camera.style,
  }
}

/** What an export leaves behind, collected by the recorder from the export store. */
export interface RenderRecord {
  request: Pick<ExportRequest, 'width' | 'height' | 'fps' | 'quality' | 'baseName' | 'overlayOnly'>
  outcome: RenderOutcome
  error?: string
  wallMs: number
  frames: number
  encoded: number
  timings: ExportTimings
  result: Pick<ExportResult, 'codec' | 'sizeBytes' | 'hardware'> | null
  encoder: VideoEncoderKind
  settings: Settings
  /** ms since 1970 */
  at: number
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const round = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)

let counter = 0

export function entryOf(record: RenderRecord): HistoryEntry {
  const { request, timings, result } = record
  const { width, height, fps } = request
  const format = formatOf(width, height)
  return {
    id: `${record.at.toString(36)}${(counter++).toString(36)}`,
    at: record.at,
    name: cut(request.baseName, MAX_NAME),
    outcome: record.outcome,
    ...(record.error && { error: cut(record.error, MAX_ERROR) }),
    wallMs: round(record.wallMs),
    frames: round(record.frames),
    encoded: round(record.encoded),
    rendered: round(timings.rendered),
    renderMs: round(timings.renderMs),
    waitMs: round(timings.waitMs),
    encodeMs: round(timings.encodeMs),
    renders: round(timings.renders),
    gpuMs: round(timings.gpuMs),
    gpuRenders: round(timings.gpuRenders),
    gpuWaitMs: round(timings.gpuWaitMs),
    composeMs: round(timings.composeMs),
    frameMs: round(timings.frameMs),
    encodeWaitMs: round(timings.encodeWaitMs),
    timeouts: round(timings.timeouts),
    givenUp: round(timings.givenUp),
    filmS: fps > 0 ? Math.round((record.frames / fps) * 10) / 10 : 0,
    width,
    height,
    fps,
    quality: request.quality,
    ...format,
    ...(request.overlayOnly && { overlayOnly: true as const }),
    ...(record.outcome === 'done' && result && { codec: result.codec, bytes: round(result.sizeBytes) }),
    ...(record.encoder && { encoder: record.encoder }),
    ...(result?.hardware && { hardware: true as const }),
    ...(timings.handover && { handover: timings.handover }),
    settings: summariseSettings(record.settings, request.quality),
  }
}

/** Aspect and resolution class of a size (as `videoSize` makes it on this device), nothing for an unknown one. */
function formatOf(width: number, height: number): { aspect: VideoAspect; resolution: VideoResolution } | undefined {
  for (const a of VIDEO_ASPECTS) {
    for (const r of VIDEO_RESOLUTIONS) {
      const size = videoSize(a.id, r.id)
      if (size.width === width && size.height === height) return { aspect: a.id, resolution: r.id }
    }
  }
  return undefined
}

/** UTF-8 size of the stored list. */
function storedBytes(entries: readonly HistoryEntry[]): number {
  return new TextEncoder().encode(serialiseHistory(entries)).length
}

/** The newest `limit` entries (the list is newest first), fewer when the list would exceed `maxBytes`. */
export function trim(entries: readonly HistoryEntry[], limit = HISTORY_LIMIT, maxBytes = HISTORY_MAX_BYTES): HistoryEntry[] {
  const kept = entries.slice(0, Math.max(0, limit))
  while (kept.length > 1 && storedBytes(kept) > maxBytes) kept.pop()
  return kept
}

/** `entry` at the head of `entries`, then trimmed. */
export function recordEntry(entries: readonly HistoryEntry[], entry: HistoryEntry, limit = HISTORY_LIMIT, maxBytes = HISTORY_MAX_BYTES): HistoryEntry[] {
  return trim([entry, ...entries.filter((e) => e.id !== entry.id)], limit, maxBytes)
}

export function serialiseHistory(entries: readonly HistoryEntry[]): string {
  return JSON.stringify({ v: HISTORY_VERSION, entries })
}

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const oneOf = <T extends string | number>(v: unknown, values: readonly T[]): T | undefined => values.find((x) => x === v)

function parseSettings(raw: unknown): RenderSettings {
  if (!isRecord(raw)) return {}
  const out: RenderSettings = {}
  const set = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K] | undefined) => {
    if (value !== undefined) out[key] = value
  }
  set('atmosphere', bool(raw.atmosphere))
  set('shadows', bool(raw.shadows))
  const sunHour = num(raw.sunHour)
  set('sunHour', sunHour !== undefined && sunHour >= 0 && sunHour <= 24 ? sunHour : undefined)
  set('sunDate', typeof raw.sunDate === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(raw.sunDate) ? raw.sunDate : undefined)
  set('sunFromTrack', bool(raw.sunFromTrack))
  const c = raw.clouds
  if (isRecord(c)) {
    const mode = oneOf(c.mode, CLOUD_MODES)
    const quality = oneOf(c.quality, CLOUD_QUALITIES)
    const seaRender = oneOf(c.seaRender, SEA_RENDERS)
    const coverage = num(c.coverage)
    if (mode && quality && seaRender && coverage !== undefined && coverage >= 0 && coverage <= 1) set('clouds', { mode, quality, coverage, seaRender })
  }
  if (isRecord(raw.tier)) {
    const subFrames = num(raw.tier.subFrames)
    const cloudsByHand = bool(raw.tier.cloudsByHand)
    if (subFrames !== undefined && Number.isInteger(subFrames) && subFrames >= 1 && subFrames <= SHUTTER_SUBFRAMES && cloudsByHand !== undefined) {
      set('tier', { subFrames, cloudsByHand })
    }
  }
  if (isRecord(raw.lens)) {
    const { shutter, bloom, bloomRadius, flare, depthOfField } = raw.lens
    const lens = { shutter: num(shutter), bloom: num(bloom), bloomRadius: num(bloomRadius), flare: num(flare), depthOfField: num(depthOfField) }
    if (Object.values(lens).every((v) => v !== undefined) && isValidLens(lens as LensSettings)) set('lens', lens as LensSettings)
  }
  set('imagery', text(raw.imagery, 60))
  set('imageryZoom', oneOf(raw.imageryZoom, [0, 1, 2] as const))
  set('terrain', text(raw.terrain, 60))
  set('water', bool(raw.water))
  set('snow', oneOf(raw.snow, SNOW_MODES))
  if (isRecord(raw.forest)) {
    const enabled = bool(raw.forest.enabled)
    const density = num(raw.forest.density)
    if (enabled !== undefined && density !== undefined && density >= FOREST_DENSITY_RANGE.min && density <= FOREST_DENSITY_RANGE.max) set('forest', { enabled, density })
  }
  set('camera', oneOf(raw.camera, CAMERA_STYLES))
  return out
}

function parseEntry(raw: unknown): HistoryEntry | null {
  if (!isRecord(raw)) return null
  const outcome = oneOf(raw.outcome, OUTCOMES)
  const quality = oneOf(raw.quality, VIDEO_QUALITIES)
  const [id, at, name, width, height, fps] = [text(raw.id, 40), num(raw.at), text(raw.name, MAX_NAME), num(raw.width), num(raw.height), num(raw.fps)]
  if (!outcome || !quality || !id || at === undefined || name === undefined || !width || !height || !fps || width <= 0 || height <= 0 || fps <= 0) return null
  const count = (v: unknown) => Math.max(0, num(v) ?? 0)
  const aspect = oneOf(raw.aspect, VIDEO_ASPECTS.map((a) => a.id))
  const resolution = oneOf(raw.resolution, VIDEO_RESOLUTIONS.map((r) => r.id))
  const error = text(raw.error, MAX_ERROR)
  const codec = text(raw.codec, 30)
  const bytes = num(raw.bytes)
  const encoder = oneOf(raw.encoder, ['webcodecs', 'native'] as const)
  const handover = oneOf(raw.handover, HANDOVER_METHODS)
  return {
    id,
    at,
    name,
    outcome,
    ...(error && { error }),
    wallMs: count(raw.wallMs),
    frames: count(raw.frames),
    encoded: count(raw.encoded),
    rendered: count(raw.rendered),
    renderMs: count(raw.renderMs),
    waitMs: count(raw.waitMs),
    encodeMs: count(raw.encodeMs),
    renders: count(raw.renders),
    gpuMs: count(raw.gpuMs),
    gpuRenders: count(raw.gpuRenders),
    gpuWaitMs: count(raw.gpuWaitMs),
    composeMs: count(raw.composeMs),
    frameMs: count(raw.frameMs),
    encodeWaitMs: count(raw.encodeWaitMs),
    timeouts: count(raw.timeouts),
    givenUp: count(raw.givenUp),
    filmS: count(raw.filmS),
    width,
    height,
    fps,
    quality,
    ...(aspect && resolution && { aspect, resolution }),
    ...(raw.overlayOnly === true && { overlayOnly: true as const }),
    ...(codec && { codec }),
    ...(bytes !== undefined && bytes >= 0 && { bytes }),
    ...(encoder && { encoder }),
    ...(raw.hardware === true && { hardware: true as const }),
    ...(handover && { handover }),
    settings: parseSettings(raw.settings),
  }
}

/**
 * The entries of a stored list, newest first, capped. Never throws: unreadable text, another version or a corrupted
 * entry gives an empty list or leaves that entry out.
 */
export function parseHistory(raw: string | null | undefined, limit = HISTORY_LIMIT, maxBytes = HISTORY_MAX_BYTES): HistoryEntry[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.v !== HISTORY_VERSION || !Array.isArray(data.entries)) return []
    const seen = new Set<string>()
    const entries: HistoryEntry[] = []
    for (const item of data.entries) {
      const entry = parseEntry(item)
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id)
        entries.push(entry)
      }
    }
    return trim(entries.sort((a, b) => b.at - a.at), limit, maxBytes)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Reuse
// ---------------------------------------------------------------------------

/**
 * `current` with the export options (format, frame rate, quality) and the render settings of `entry` put back, and
 * nothing else (the style of the camera, not its distance; whether the water shows, not its look). A value the entry
 * lacks, or that this version no longer knows (a source removed), is left as it is. Unchanged groups keep their
 * reference, so `applySettings` only touches what differs.
 */
export function reuseSettings(entry: HistoryEntry, current: Settings): Settings {
  const s = entry.settings
  const next: Settings = { ...current }
  const video = {
    ...current.video,
    ...(entry.aspect && entry.resolution && { aspect: entry.aspect, resolution: entry.resolution }),
    ...((VIDEO_FPS as readonly number[]).includes(entry.fps) && { fps: entry.fps as Settings['video']['fps'] }),
    quality: entry.quality,
  }
  if (!same(video, current.video)) next.video = video
  if (s.atmosphere !== undefined) next.atmosphere = s.atmosphere
  if (s.shadows !== undefined) next.shadows = s.shadows
  if (s.sunHour !== undefined) next.sunHour = s.sunHour
  if (s.sunDate !== undefined) next.sunDate = s.sunDate
  if (s.sunFromTrack !== undefined) next.sunFromTrack = s.sunFromTrack
  if (s.clouds) {
    // taken from the export quality, not chosen by hand: back to 'auto' (an entry without `tier` recorded a fixed quality)
    const clouds = { ...s.clouds, quality: s.tier?.cloudsByHand === false ? ('auto' as const) : s.clouds.quality }
    if (!same(clouds, current.clouds, Object.keys(clouds))) next.clouds = { ...current.clouds, ...clouds }
  }
  if (s.lens && !same(s.lens, current.lens)) next.lens = { ...s.lens }
  if (s.imagery !== undefined && IMAGERY_SOURCES.some((src) => src.id === s.imagery)) next.imagerySourceId = s.imagery
  if (s.imageryZoom !== undefined) next.imageryZoomOffset = s.imageryZoom
  if (s.terrain !== undefined && TERRAIN_SOURCES.some((src) => src.id === s.terrain)) next.terrainSourceId = s.terrain
  if (s.water !== undefined && s.water !== current.water.enabled) next.water = { ...current.water, enabled: s.water }
  if (s.snow !== undefined && s.snow !== current.snow.mode) next.snow = { ...current.snow, mode: s.snow }
  if (s.forest && !same(s.forest, current.forest)) next.forest = { ...current.forest, ...s.forest }
  if (s.camera !== undefined && s.camera !== current.camera.style) next.camera = { ...current.camera, style: s.camera }
  return next
}

function same(a: object, b: object, keys: string[] = Object.keys(a)): boolean {
  return keys.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
}

// ---------------------------------------------------------------------------
// Formatting (in the language of the interface)
// ---------------------------------------------------------------------------

/** 92 s -> « 1:32 », 3 725 s -> « 1:02:05 ». */
export function formatWall(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

const comma = (n: number, digits = 1) => formatNumber(n, digits)

/** Seconds per distinct image rendered (held frames are free), null when nothing was rendered. */
export function secondsPerImage(entry: Pick<HistoryEntry, 'wallMs' | 'rendered'>): number | null {
  return entry.rendered > 0 ? entry.wallMs / 1000 / entry.rendered : null
}

/** Seconds per rendered image and per megapixel, null when nothing was rendered. */
export function secondsPerMegapixel(entry: Pick<HistoryEntry, 'wallMs' | 'rendered' | 'width' | 'height'>): number | null {
  const perImage = secondsPerImage(entry)
  const mp = (entry.width * entry.height) / 1e6
  return perImage === null || mp <= 0 ? null : perImage / mp
}

/**
 * Seconds per frame and per megapixel of the last film rendered through to the end (what `filmRate` measures while a film
 * is exported: render, tile wait and encoding over all its frames), read from the history so that the time of a film is
 * known from the start of a session; null when no such render is in it. The overlay alone is not a film.
 */
export function rateFromHistory(entries: readonly RateEntry[]): number | null {
  const last = lastFilm(entries)
  return last ? (last.renderMs + last.waitMs + last.encodeMs) / 1000 / last.frames / ((last.width * last.height) / 1e6) : null
}

type RateEntry = Pick<HistoryEntry, 'at' | 'outcome' | 'overlayOnly' | 'frames' | 'renderMs' | 'waitMs' | 'encodeMs' | 'width' | 'height'>

/** The last film rendered through to the end, the one `rateFromHistory` reads. */
export function lastFilm<T extends RateEntry>(entries: readonly T[]): T | undefined {
  let last: T | undefined
  for (const entry of entries) {
    const spentMs = entry.renderMs + entry.waitMs + entry.encodeMs
    if (entry.outcome === 'done' && !entry.overlayOnly && entry.frames > 0 && spentMs > 0 && entry.width * entry.height > 0 && (!last || entry.at > last.at)) last = entry
  }
  return last
}

/**
 * Extra cost of the 4.0 layers on the time of a frame, as fractions of it. Where they come from (ARCHITECTURE « Forests »,
 * « Snow »): the forests add about 16 % of triangles to the scene at 60 trees per hectare (130,000 trees in range, 15,000 in
 * view, +0.43 M over 2.7 M), taken as 15 % of the frame at that density and proportional to it; the snow is one more term in
 * the terrain's fragment shader, 3 %. Estimates, not measures: tile waiting and encoding, which they do not change, are
 * part of the frame too.
 */
export const FOREST_COST_AT_60 = 0.15
export const SNOW_COST = 0.03

/** Time of a frame with these layers relative to one without; null when the layers are not known (an entry from before). */
export function layersCost(settings: Pick<RenderSettings, 'snow' | 'forest'>): number | null {
  const { snow, forest } = settings
  if (snow === undefined || forest === undefined) return null
  return 1 + (forest.enabled ? (FOREST_COST_AT_60 * forest.density) / 60 : 0) + (snow !== 'aucune' ? SNOW_COST : 0)
}

/** What to multiply the rate of a film rendered with the layers `from` by for a film with `to`; 1 when `from` is not known. */
export function layersRatio(from: Pick<RenderSettings, 'snow' | 'forest'>, to: Pick<RenderSettings, 'snow' | 'forest'>): number {
  const [before, after] = [layersCost(from), layersCost(to)]
  return before === null || after === null ? 1 : after / before
}

/**
 * Seconds a film of `frames` frames of `width` × `height` takes at `secondsPerMegapixel` per frame (`filmRate`), times
 * `ratio` (`layersRatio`: the film is not rendered with the forests and the snow of the one the rate comes from).
 */
export function estimateRenderSeconds(secondsPerMegapixel: number, frames: number, width: number, height: number, ratio = 1): number {
  return secondsPerMegapixel * frames * ((width * height) / 1e6) * ratio
}

export function formatSpeed(entry: HistoryEntry): string {
  const perImage = secondsPerImage(entry)
  // no-break spaces: the figure and its unit never wrap apart
  return perImage === null ? '' : t('export.history.speedPerImage', { value: comma(perImage) })
}

/** « 14/10/2026 18:32 » */
export function formatWhen(at: number): string {
  return formatDate(at, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export const OUTCOME_LABELS: Record<RenderOutcome, string> = {
  get done() { return t('export.history.outcome.done') },
  get canceled() { return t('export.history.outcome.canceled') },
  get error() { return t('export.history.outcome.error') },
}
const MODE_LABELS: Record<CloudMode, string> = {
  get meteo() { return t('export.history.mode.meteo') },
  get manuel() { return t('export.history.mode.manuel') },
  get mer() { return t('export.history.mode.mer') },
  get aucun() { return t('export.history.mode.aucun') },
}
/** « rapide », « moyenne », « fine » (the names of the export panel in lower case) */
const cloudQualityLabel = (quality: CloudQuality) => CLOUD_QUALITY_NAMES[quality].toLowerCase()
const ZOOM_KEYS = ['export.history.zoom.0', 'export.history.zoom.1', 'export.history.zoom.2'] as const
/** « méthode canevas de la page » */
const HANDOVER_KEYS = {
  offscreen: 'export.history.handover.offscreen',
  canvas: 'export.history.handover.canvas',
  bitmap: 'export.history.handover.bitmap',
} as const
export const handoverLabel = (method: HandoverMethod) => t('export.history.row.handoverValue', { method: t(HANDOVER_KEYS[method]) })
const ENCODER_KEYS = { webcodecs: 'export.history.encoder.webcodecs', native: 'export.history.encoder.native' } as const
const CODEC_LABELS: Record<string, string> = { 'mp4/avc': 'MP4 (H.264)', 'mp4/hevc': 'MP4 (HEVC)', 'mp4/av1': 'MP4 (AV1)', 'png/png': 'PNG', 'webm/vp9': 'WebM (VP9)', 'webm/vp8': 'WebM (VP8)' }

const percent = (v: number) => formatPercent(Math.round(v * 100) / 100)
const hour = (h: number) => t('format.clock', { hours: Math.floor(Math.round(h * 60) / 60), minutes: String(Math.round(h * 60) % 60).padStart(2, '0') })

/** « 1920 × 1080, 30 i/s, Haute » */
export function formatOutput(entry: HistoryEntry): string {
  return t('export.history.output', { width: entry.width, height: entry.height, fps: entry.fps, quality: QUALITY_NAMES[entry.quality] })
}

/** The costly options on one line: « Nuages fins · Ombres · Flou de bougé 50 % ». « Réglages de base » when none. */
export function settingsSummary(settings: RenderSettings): string {
  const { atmosphere, shadows, clouds, lens } = settings
  const parts: string[] = []
  if (atmosphere === false) parts.push(t('export.history.summary.noAtmosphere'))
  else {
    if (clouds && clouds.mode !== 'aucun') parts.push(t('export.history.summary.clouds', { quality: cloudQualityLabel(clouds.quality) }))
    if (shadows) parts.push(t('export.history.summary.shadows'))
  }
  if (lens) {
    if (lens.shutter > 0) parts.push(t('export.history.summary.shutter', { percent: percent(lens.shutter) }))
    if (lens.depthOfField > 0) parts.push(t('export.history.summary.dof'))
    if (lens.bloom > 0) parts.push(t('export.history.summary.bloom'))
    if (lens.flare > 0 && atmosphere !== false) parts.push(t('export.history.summary.flare'))
  }
  return parts.join(' · ') || t('export.history.summary.basic')
}

/** Every recorded setting as label / value rows (the expandable detail). */
export function settingsDetails(settings: RenderSettings): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const yes = (v: boolean) => (v ? t('export.history.yes') : t('export.history.no'))
  const no = t('export.history.no')
  const { atmosphere, shadows, clouds, lens, tier, sunHour, sunDate, sunFromTrack, imagery, imageryZoom, terrain, water, snow, forest, camera } = settings
  if (atmosphere !== undefined) rows.push({ label: t('export.history.detail.atmosphere'), value: yes(atmosphere) })
  if (shadows !== undefined) rows.push({ label: t('export.history.detail.shadows'), value: yes(shadows) })
  if (clouds) {
    const cloudsText = t(tier?.cloudsByHand ? 'export.history.detail.cloudsValueChosen' : 'export.history.detail.cloudsValue', {
      mode: MODE_LABELS[clouds.mode],
      quality: cloudQualityLabel(clouds.quality),
    })
    rows.push({ label: t('export.history.detail.clouds'), value: clouds.mode === 'aucun' ? MODE_LABELS.aucun : cloudsText })
  }
  if (lens) {
    const shutter = tier ? t('export.history.detail.shutterTier', { percent: percent(lens.shutter), n: tier.subFrames }) : percent(lens.shutter)
    rows.push({ label: t('export.history.detail.shutter'), value: lens.shutter > 0 ? shutter : no })
    rows.push({ label: t('export.history.detail.dof'), value: lens.depthOfField > 0 ? percent(lens.depthOfField) : no })
    rows.push({ label: t('export.history.detail.bloom'), value: lens.bloom > 0 ? t('export.history.detail.bloomValue', { percent: percent(lens.bloom), radius: percent(lens.bloomRadius) }) : no })
    rows.push({ label: t('export.history.detail.flare'), value: lens.flare > 0 ? percent(lens.flare) : no })
  }
  if (sunFromTrack !== undefined || sunHour !== undefined || sunDate !== undefined) {
    const when = sunFromTrack ? t('export.history.detail.sunOuting') : sunHour === undefined ? '' : t('export.history.detail.sunSolar', { hour: hour(sunHour) })
    const day = sunDate ? t('export.history.detail.sunDate', { date: sunDate }) : sunFromTrack ? '' : t('export.history.detail.sunDay')
    rows.push({ label: t('export.history.detail.sun'), value: [when, day].filter(Boolean).join(', ') })
  }
  if (imagery !== undefined) {
    const name = IMAGERY_SOURCES.find((s) => s.id === imagery)?.name ?? imagery
    rows.push({ label: t('export.history.detail.imagery'), value: imageryZoom === undefined ? name : t('export.history.detail.imageryZoom', { name, zoom: t(ZOOM_KEYS[imageryZoom]) }) })
  }
  if (terrain !== undefined) rows.push({ label: t('export.history.detail.terrain'), value: TERRAIN_SOURCES.find((s) => s.id === terrain)?.name ?? terrain })
  if (water !== undefined) rows.push({ label: t('export.history.detail.water'), value: yes(water) })
  // the layers of 4.0: an older render did not record them
  rows.push({ label: t('export.history.detail.snow'), value: snow === undefined ? '—' : t(`light.snow.mode.${snow}`) })
  rows.push({
    label: t('export.history.detail.forest'),
    value: forest === undefined ? '—' : forest.enabled ? t('light.forest.densityValue', { n: forest.density }) : no,
  })
  if (camera) rows.push({ label: t('export.history.detail.camera'), value: CAMERA_STYLE_LABELS[camera] })
  return rows
}

type TimingSplit = Pick<
  ExportTimings,
  'rendered' | 'renders' | 'renderMs' | 'gpuMs' | 'gpuRenders' | 'waitMs' | 'encodeMs' | 'composeMs' | 'frameMs' | 'encodeWaitMs'
> &
  Partial<Pick<ExportTimings, 'gpuWaitMs'>>

/**
 * Where the time of a render went, on one line: « rendu 50,0 s (GPU 21,3 s), 1,4 rendu par image, tuiles 30,0 s,
 * attente de la carte graphique 4,0 s, composition 6,0 s, image vidéo 1,5 s, attente de l'encodeur 2,5 s ». The wait for
 * the graphics card (the end of the last render of each image) is apart where it was measured (absent from a split
 * recorded before); the GPU time when measured. A split recorded before the composition was measured apart gives
 * « composition et encodage ».
 */
export function timingsSummary(timings: TimingSplit): string {
  const s = (ms: number) => t('format.seconds', { value: comma(ms / 1000) })
  // a few queries may be lost (GPU reset, the last ones): the measured average over every render
  const gpu =
    timings.gpuRenders > 0
      ? t('export.history.timings.gpu', {
          approx: timings.gpuRenders < timings.renders ? '≈ ' : '',
          time: s((timings.gpuMs * Math.max(timings.renders, timings.gpuRenders)) / timings.gpuRenders),
        })
      : ''
  const parts = [t('export.history.timings.render', { time: s(timings.renderMs), gpu })]
  if (timings.renders > 0 && timings.rendered > 0) {
    const ratio = timings.renders / timings.rendered
    parts.push(t('export.history.timings.perImage', { count: ratio, ratio: comma(ratio) }))
  }
  parts.push(t('export.history.timings.tiles', { time: s(timings.waitMs) }))
  if (timings.composeMs + timings.frameMs + timings.encodeWaitMs > 0) {
    if (timings.gpuWaitMs) parts.push(t('export.history.timings.gpuWait', { time: s(timings.gpuWaitMs) }))
    parts.push(
      t('export.history.timings.compose', { time: s(timings.composeMs) }),
      t('export.history.timings.videoFrame', { time: s(timings.frameMs) }),
      t('export.history.timings.encoderWait', { time: s(timings.encodeWaitMs) }),
    )
  } else parts.push(t('export.history.timings.composeEncode', { time: s(timings.encodeMs) }))
  return parts.join(', ')
}

/**
 * What the shadow pass draws per render, on one line: « ombres : 96 tuiles (31 hors champ), 410 k triangles (120 k hors
 * champ) par rendu ». Empty when no shadow was drawn.
 */
export function shadowSummary(
  timings: Pick<ExportTimings, 'renders' | 'shadowTiles' | 'shadowTriangles' | 'shadowOffscreenTiles' | 'shadowOffscreenTriangles'>,
): string {
  if (timings.renders === 0 || timings.shadowTiles === 0) return ''
  const per = (n: number) => Math.round(n / timings.renders)
  const k = (n: number) => `${Math.round(per(n) / 1000)}\u00a0k`
  return t('export.history.shadows', {
    tiles: per(timings.shadowTiles),
    offTiles: per(timings.shadowOffscreenTiles),
    triangles: k(timings.shadowTriangles),
    offTriangles: k(timings.shadowOffscreenTriangles),
  })
}

/** Rows of the technical detail of a render: output, film, speed, encoder. */
export function entryDetails(entry: HistoryEntry): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const output = formatOutput(entry)
  rows.push({ label: t('export.history.row.output'), value: entry.overlayOnly ? t('export.history.row.outputOverlay', { output }) : output })
  if (entry.codec) rows.push({ label: t('export.history.row.format'), value: CODEC_LABELS[entry.codec] ?? entry.codec })
  if (entry.bytes !== undefined) rows.push({ label: t('export.history.row.size'), value: t('export.history.row.sizeValue', { value: comma(entry.bytes / 1e6) }) })
  rows.push({
    label: t('export.history.row.film'),
    value: t('export.history.row.filmValue', { duration: comma(entry.filmS), frames: entry.frames, rendered: entry.rendered }),
  })
  const mp = secondsPerMegapixel(entry)
  if (mp !== null) rows.push({ label: t('export.history.row.speed'), value: t('export.history.speedMp', { speed: formatSpeed(entry), value: comma(mp) }) })
  if (entry.renderMs + entry.waitMs + entry.encodeMs > 0) rows.push({ label: t('export.history.row.breakdown'), value: timingsSummary(entry) })
  if (entry.timeouts > 0) rows.push({ label: t('export.history.row.timeouts'), value: t('export.history.row.frames', { count: entry.timeouts }) })
  if (entry.givenUp > 0) rows.push({ label: t('export.history.row.givenUp'), value: t('export.history.row.frames', { count: entry.givenUp }) })
  if (entry.encoder) {
    const encoder = t(ENCODER_KEYS[entry.encoder])
    rows.push({ label: t('export.history.row.encoder'), value: entry.hardware ? t('export.history.row.encoderHardware', { encoder }) : encoder })
  }
  if (entry.handover) rows.push({ label: t('export.history.row.handover'), value: handoverLabel(entry.handover) })
  return rows
}
