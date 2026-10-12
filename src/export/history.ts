/**
 * History of past renders (« Historique des rendus » of the export panel): the last `HISTORY_LIMIT` exports with the
 * output, the real time they took and a curated summary of the settings that change the render time, to compare speed
 * and settings and to put those settings back (`reuseSettings`). Pure (tested): the summary, the entry, the cap, the
 * tolerant parsing and the formatting; `historyStore.ts` keeps the list in the platform storage.
 *
 * Small on purpose: no track, no coordinate, no project, only values of the settings (`RenderSettings`).
 */
import type { CameraStyle } from '../flyover/cameraSettings'
import { CAMERA_STYLES, CAMERA_STYLE_LABELS } from '../flyover/cameraSettings'
import { SHUTTER_SUBFRAMES, isValidLens } from '../scene/lens'
import type { LensSettings } from '../scene/lens'
import type { VideoEncoderKind } from '../platform/platform'
import type { Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { CLOUD_MODES, CLOUD_QUALITIES, SEA_RENDERS } from '../weather/sceneClouds'
import type { CloudMode, CloudQuality, SeaRender } from '../weather/sceneClouds'
import { effectiveRender } from './qualityTier'
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
   * 0 where the browser has no timer queries), composing, video frame, waiting for the encoder. 0 in entries recorded
   * before (added without a new `HISTORY_VERSION`).
   */
  renders: number
  gpuMs: number
  gpuRenders: number
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
  if (s.camera !== undefined && s.camera !== current.camera.style) next.camera = { ...current.camera, style: s.camera }
  return next
}

function same(a: object, b: object, keys: string[] = Object.keys(a)): boolean {
  return keys.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
}

// ---------------------------------------------------------------------------
// Formatting (French, no Intl: same output on every ICU build)
// ---------------------------------------------------------------------------

/** 92 s -> « 1:32 », 3 725 s -> « 1:02:05 ». */
export function formatWall(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

const comma = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')

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

export function formatSpeed(entry: HistoryEntry): string {
  const perImage = secondsPerImage(entry)
  // no-break spaces: the figure and its unit never wrap apart
  return perImage === null ? '' : `${comma(perImage)}\u00a0s\u00a0/\u00a0image`
}

/** « 14/10/2026 18:32 » */
export function formatWhen(at: number): string {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`
}

export const OUTCOME_LABELS: Record<RenderOutcome, string> = { done: 'réussi', canceled: 'annulé', error: 'échoué' }
const QUALITY_LABELS: Record<VideoQuality, string> = { standard: 'Standard', high: 'Haute', max: 'Maximale' }
const MODE_LABELS: Record<CloudMode, string> = { meteo: 'météo', manuel: 'manuel', mer: 'mer de nuages', aucun: 'aucun' }
const CLOUD_QUALITY_LABELS: Record<CloudQuality, string> = { low: 'rapide', medium: 'moyenne', high: 'fine' }
const ZOOM_LABELS = ['normal', 'fin', 'très fin'] as const
const ENCODER_LABELS = { webcodecs: 'WebCodecs (navigateur)', native: 'ffmpeg du système' } as const
const CODEC_LABELS: Record<string, string> = { 'mp4/avc': 'MP4 (H.264)', 'mp4/hevc': 'MP4 (HEVC)', 'webm/vp9': 'WebM (VP9)', 'webm/vp8': 'WebM (VP8)' }

const percent = (v: number) => `${Math.round(v * 100)} %`
const hour = (h: number) => `${Math.floor(Math.round(h * 60) / 60)} h ${String(Math.round(h * 60) % 60).padStart(2, '0')}`

/** « 1920 × 1080, 30 i/s, Haute » */
export function formatOutput(entry: HistoryEntry): string {
  return `${entry.width} × ${entry.height}, ${entry.fps} i/s, ${QUALITY_LABELS[entry.quality]}`
}

/** The costly options on one line: « Nuages fins · Ombres · Flou de bougé 50 % ». « Réglages de base » when none. */
export function settingsSummary(settings: RenderSettings): string {
  const { atmosphere, shadows, clouds, lens } = settings
  const parts: string[] = []
  if (atmosphere === false) parts.push('Sans atmosphère')
  else {
    if (clouds && clouds.mode !== 'aucun') parts.push(`Nuages ${CLOUD_QUALITY_LABELS[clouds.quality]}`)
    if (shadows) parts.push('Ombres')
  }
  if (lens) {
    if (lens.shutter > 0) parts.push(`Flou de bougé ${percent(lens.shutter)}`)
    if (lens.depthOfField > 0) parts.push('Profondeur de champ')
    if (lens.bloom > 0) parts.push('Halo')
    if (lens.flare > 0 && atmosphere !== false) parts.push('Reflet d’objectif')
  }
  return parts.join(' · ') || 'Réglages de base'
}

/** Every recorded setting as label / value rows (the expandable detail). */
export function settingsDetails(settings: RenderSettings): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const yes = (v: boolean) => (v ? 'oui' : 'non')
  const { atmosphere, shadows, clouds, lens, tier, sunHour, sunDate, sunFromTrack, imagery, imageryZoom, terrain, water, camera } = settings
  if (atmosphere !== undefined) rows.push({ label: 'Atmosphère', value: yes(atmosphere) })
  if (shadows !== undefined) rows.push({ label: 'Ombres', value: yes(shadows) })
  if (clouds) rows.push({ label: 'Nuages', value: clouds.mode === 'aucun' ? 'aucun' : `${MODE_LABELS[clouds.mode]}, qualité ${CLOUD_QUALITY_LABELS[clouds.quality]}${tier?.cloudsByHand ? ' (choisie)' : ''}` })
  if (lens) {
    rows.push({ label: 'Flou de bougé', value: lens.shutter > 0 ? `${percent(lens.shutter)}${tier ? `, ${tier.subFrames} rendus par image au plus` : ''}` : 'non' })
    rows.push({ label: 'Profondeur de champ', value: lens.depthOfField > 0 ? percent(lens.depthOfField) : 'non' })
    rows.push({ label: 'Halo lumineux', value: lens.bloom > 0 ? `${percent(lens.bloom)}, rayon ${percent(lens.bloomRadius)}` : 'non' })
    rows.push({ label: 'Reflet d’objectif', value: lens.flare > 0 ? percent(lens.flare) : 'non' })
  }
  if (sunFromTrack !== undefined || sunHour !== undefined || sunDate !== undefined) {
    const when = sunFromTrack ? 'heure de la sortie' : sunHour === undefined ? '' : `${hour(sunHour)} solaire`
    rows.push({ label: 'Soleil', value: [when, sunDate ? `le ${sunDate}` : sunFromTrack ? '' : 'jour de la sortie'].filter(Boolean).join(', ') })
  }
  if (imagery !== undefined) {
    const name = IMAGERY_SOURCES.find((s) => s.id === imagery)?.name ?? imagery
    rows.push({ label: 'Fond de carte', value: imageryZoom === undefined ? name : `${name}, détail ${ZOOM_LABELS[imageryZoom]}` })
  }
  if (terrain !== undefined) rows.push({ label: 'Relief', value: TERRAIN_SOURCES.find((s) => s.id === terrain)?.name ?? terrain })
  if (water !== undefined) rows.push({ label: 'Plans d’eau', value: yes(water) })
  if (camera) rows.push({ label: 'Caméra', value: CAMERA_STYLE_LABELS[camera] })
  return rows
}

type TimingSplit = Pick<
  ExportTimings,
  'rendered' | 'renders' | 'renderMs' | 'gpuMs' | 'gpuRenders' | 'waitMs' | 'encodeMs' | 'composeMs' | 'frameMs' | 'encodeWaitMs'
>

/**
 * Where the time of a render went, on one line: « rendu 50,0 s (GPU 21,3 s), 1,4 rendu par image, tuiles 30,0 s,
 * composition 6,0 s, image vidéo 1,5 s, attente de l'encodeur 2,5 s ». The GPU time when measured: without it, the
 * composition also holds the wait for the GPU to finish the render (it reads the WebGL image). A split recorded before
 * the composition was measured apart gives « composition et encodage ».
 */
export function timingsSummary(t: TimingSplit): string {
  const s = (ms: number) => `${comma(ms / 1000)} s`
  // a few queries may be lost (GPU reset, the last ones): the measured average over every render
  const gpu = t.gpuRenders > 0 ? ` (GPU ${t.gpuRenders < t.renders ? '≈ ' : ''}${s((t.gpuMs * Math.max(t.renders, t.gpuRenders)) / t.gpuRenders)})` : ''
  const parts = [`rendu ${s(t.renderMs)}${gpu}`]
  if (t.renders > 0 && t.rendered > 0) parts.push(`${comma(t.renders / t.rendered)} rendu${t.renders >= 2 * t.rendered ? 's' : ''} par image`)
  parts.push(`tuiles ${s(t.waitMs)}`)
  if (t.composeMs + t.frameMs + t.encodeWaitMs > 0) {
    parts.push(`composition ${s(t.composeMs)}`, `image vidéo ${s(t.frameMs)}`, `attente de l'encodeur ${s(t.encodeWaitMs)}`)
  } else parts.push(`composition et encodage ${s(t.encodeMs)}`)
  return parts.join(', ')
}

/**
 * What the shadow pass draws per render, on one line: « ombres : 96 tuiles (31 hors champ), 410 k triangles (120 k hors
 * champ) par rendu ». Empty when no shadow was drawn.
 */
export function shadowSummary(
  t: Pick<ExportTimings, 'renders' | 'shadowTiles' | 'shadowTriangles' | 'shadowOffscreenTiles' | 'shadowOffscreenTriangles'>,
): string {
  if (t.renders === 0 || t.shadowTiles === 0) return ''
  const per = (n: number) => Math.round(n / t.renders)
  const k = (n: number) => `${Math.round(per(n) / 1000)}\u00a0k`
  return `ombres : ${per(t.shadowTiles)} tuiles (${per(t.shadowOffscreenTiles)} hors champ), ${k(t.shadowTriangles)} triangles (${k(t.shadowOffscreenTriangles)} hors champ) par rendu`
}

/** Rows of the technical detail of a render: output, film, speed, encoder. */
export function entryDetails(entry: HistoryEntry): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  rows.push({ label: 'Sortie', value: `${formatOutput(entry)}${entry.overlayOnly ? ', habillage seul' : ''}` })
  if (entry.codec) rows.push({ label: 'Format', value: CODEC_LABELS[entry.codec] ?? entry.codec })
  if (entry.bytes !== undefined) rows.push({ label: 'Taille', value: `${comma(entry.bytes / 1e6)} Mo` })
  rows.push({ label: 'Film', value: `${comma(entry.filmS)} s, ${entry.frames} images (${entry.rendered} rendues)` })
  const mp = secondsPerMegapixel(entry)
  if (mp !== null) rows.push({ label: 'Vitesse', value: `${formatSpeed(entry)}, ${comma(mp)}\u00a0s\u00a0/\u00a0Mpx` })
  if (entry.renderMs + entry.waitMs + entry.encodeMs > 0) rows.push({ label: 'Répartition', value: timingsSummary(entry) })
  if (entry.timeouts > 0) rows.push({ label: 'Tuiles encore en chargement au délai', value: `${entry.timeouts} image(s)` })
  if (entry.givenUp > 0) rows.push({ label: 'Tuiles abandonnées', value: `${entry.givenUp} image(s)` })
  if (entry.encoder) rows.push({ label: 'Encodeur', value: `${ENCODER_LABELS[entry.encoder]}${entry.hardware ? ', encodeur matériel' : ''}` })
  return rows
}
