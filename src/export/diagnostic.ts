/**
 * « Rapport de diagnostic »: the device, the export asked and every setting that weighs on memory, as plain text to
 * paste in a bug report. Snapshot taken when an export starts (guard.ts, tab's sessionStorage), shown by « Détails » of
 * an interrupted export and by « Afficher le rapport » (Projet tab) with the steps of the export.
 * Building and formatting are pure (tested). No coordinate, no track, place, project or file name: the user pastes it.
 */
import { create } from 'zustand'
import { deviceBudget } from '../core/deviceBudget'
import type { DeviceBudget } from '../core/deviceBudget'
import type { Track } from '../core/types'
import { isAudioAsset, isVideoAsset, useMediaStore, usedMedia } from '../film/media'
import type { MediaTable } from '../film/media'
import { getPlatform } from '../platform'
import type { VideoEncoderKind } from '../platform'
import { isIdentityGrading } from '../scene/grading'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { deviceBitrateCap, videoBitrate } from './encoder'
import { settingsDetails, summariseSettings } from './history'
import { effectiveRender } from './qualityTier'
import { buildFrameSchedule, videoSize } from './schedule'
import type { ExportRequest } from './store'

/** package.json version, set by vite.config.ts */
declare const __APP_VERSION__: string

/** sessionStorage key of the report taken when the last export started (steps excluded) */
export const REPORT_KEY = 'openflyover.diagnostic'
/** longest value kept (user agent, GPU name) */
const MAX_VALUE = 200
/** sessionStorage key of « Export de test sans encodage » (this tab only, never in the project) */
export const NO_ENCODING_KEY = 'openflyover.export.noEncoding'

type TestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function tabStorage(): TestStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

/** « Export de test sans encodage »: the film exports render and compose every frame but encode none (debug A/B). */
export function noEncodingTest(storage: TestStorage | undefined = tabStorage()): boolean {
  try {
    return storage?.getItem(NO_ENCODING_KEY) === '1'
  } catch {
    return false
  }
}

export function setNoEncodingTest(on: boolean, storage: TestStorage | undefined = tabStorage()): void {
  try {
    if (on) storage?.setItem(NO_ENCODING_KEY, '1')
    else storage?.removeItem(NO_ENCODING_KEY)
  } catch {
    // no storage: the switch stays off
  }
}

export type ReportRow = [label: string, value: string]

export interface ReportSection {
  title: string
  rows: ReportRow[]
}

export interface DiagnosticReport {
  /** when it was made (ISO) */
  at: string
  sections: ReportSection[]
  /** steps of the export and page events, oldest first, already worded (guard.ts) */
  steps?: string[]
}

export interface GpuInfo {
  maxTextureSize: number
  /** unmasked renderer where the browser gives it, else the masked one */
  renderer: string
  /** MSAA of the canvas in use */
  antialias: boolean
}

export type ReportRequest = Pick<
  ExportRequest,
  'width' | 'height' | 'fps' | 'quality' | 'durationS' | 'progressAt' | 'holdStartS' | 'holdEndS' | 'still' | 'destination' | 'overlayOnly'
>

export interface DiagnosticInput {
  /** ms since 1970 */
  now: number
  version: string
  desktop: boolean
  encoder: VideoEncoderKind
  canStreamToDisk: boolean
  userAgent?: string
  screen?: { width: number; height: number }
  viewport?: { width: number; height: number }
  pixelRatio?: number
  /** `navigator.deviceMemory` (Chrome only) */
  memoryGb?: number
  cores?: number
  budget: DeviceBudget
  gpu: GpuInfo | null
  settings: Settings
  tracks: readonly Pick<Track, 'segments'>[]
  media: MediaTable
  /** the export being started; none: the export the current settings would make */
  request?: ReportRequest
  /** « Export de test sans encodage » is on */
  noEncoding?: boolean
}

const yes = (v: boolean) => (v ? 'oui' : 'non')
const comma = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')
const mb = (bytes: number) => `${comma(bytes / 1e6)} Mo`
const mbits = (bits: number) => (Number.isFinite(bits) ? `${comma(bits / 1e6)} Mbit/s` : 'aucun plafond')
const cut = (text: string) => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text)

function deviceRows(input: DiagnosticInput): ReportRow[] {
  const { budget, gpu, screen, viewport } = input
  const rows: ReportRow[] = [
    ['Version', `${input.version}, ${input.desktop ? 'application de bureau' : 'site web'}`],
    ['Navigateur', input.userAgent ?? 'inconnu'],
    ['Écran', screen ? `${screen.width} × ${screen.height}, densité ${input.pixelRatio ?? 1}` : 'inconnu'],
    ['Fenêtre', viewport ? `${viewport.width} × ${viewport.height}` : 'inconnue'],
    ['Mémoire annoncée', input.memoryGb === undefined ? 'inconnue' : `${input.memoryGb} Go`],
    ['Cœurs', input.cores === undefined ? 'inconnu' : String(input.cores)],
    ['Encodeur vidéo', input.encoder ?? 'aucun'],
    ['Écriture directe sur le disque', yes(input.canStreamToDisk)],
    ['Carte graphique', gpu?.renderer || 'inconnue'],
    ['Texture max', gpu ? `${gpu.maxTextureSize} px` : 'inconnue'],
    ['Anticrénelage du canevas', gpu ? yes(gpu.antialias) : 'inconnu'],
  ]
  // every field of the budget, by its name in the code, the kind first
  const { kind, ...limits } = budget
  rows.push(['budget.kind', kind])
  for (const [key, value] of Object.entries(limits)) {
    const shown = typeof value === 'number' && !Number.isFinite(value) ? 'illimité' : String(value)
    rows.push([`budget.${key}`, shown])
  }
  return rows
}

function exportRows({ request, settings, budget, canStreamToDisk, noEncoding }: DiagnosticInput): ReportRow[] {
  const size = request ?? videoSize(settings.video.aspect, settings.video.resolution, budget.maxExportShortSide)
  const fps = request?.fps ?? settings.video.fps
  const quality = request?.quality ?? settings.video.quality
  const kind = request?.overlayOnly
    ? 'habillage seul'
    : request?.still
      ? request.still.compose || request.still.drawView
        ? 'affiche'
        : 'image fixe'
      : 'film'
  const rows: ReportRow[] = [
    ['Demande', request ? kind : 'aucune (réglages actuels)'],
    ['Taille', `${size.width} × ${size.height}`],
    ['Images par seconde', String(fps)],
    ['Qualité', quality],
  ]
  const used = effectiveRender(quality, settings.clouds)
  rows.push(['Rendu effectif', `nuages ${used.cloudsQuality}${used.cloudsByHand ? ' (choisie)' : ''}, ${used.maxSubFrames} rendus par image au plus`])
  // the encoder's bitrate for H.264 (the codec chosen is in the steps)
  const cap = deviceBitrateCap(budget, canStreamToDisk)
  const bitrate = videoBitrate(size.width, size.height, fps, quality, 'avc', cap)
  rows.push(['Débit vidéo (H.264)', `${mbits(bitrate)}${bitrate < videoBitrate(size.width, size.height, fps, quality, 'avc', Infinity) ? `, plafonné à ${mbits(cap)}` : ''}`])
  rows.push(['Destination', request ? (request.destination ? 'fichier sur le disque' : 'mémoire') : canStreamToDisk ? 'disque (au choix)' : 'mémoire'])
  if (noEncoding) rows.push(['Encodage', 'désactivé (test)'])
  if (request && !request.still) {
    let frames = 0
    try {
      frames = buildFrameSchedule(request).length
    } catch {
      // an invalid request fails at its start anyway
    }
    rows.push(['Durée du film', `${comma(frames / fps)} s, ${frames} images`])
    if (!request.overlayOnly) {
      const bytes = (bitrate * frames) / fps / 8
      rows.push(['Taille estimée', `${mb(bytes)}${!request.destination && bytes > budget.memoryWarnBytes ? ' (au-delà de l’alerte mémoire)' : ''}`])
    }
  }
  return rows
}

function settingsRows({ settings, tracks, media, request }: DiagnosticInput): ReportRow[] {
  const quality = request?.quality ?? settings.video.quality
  const rows: ReportRow[] = settingsDetails(summariseSettings(settings, quality)).map(({ label, value }): ReportRow => [label, value])
  const { clouds, labels, marker, trackStyle, overlay, film } = settings
  if (clouds.mode !== 'aucun') rows.push(['Couverture des nuages', `${Math.round(clouds.coverage * 100)} %${clouds.mode === 'mer' ? `, mer ${clouds.seaRender === 'surface' ? 'en nappe' : 'en volume'}` : ''}`])
  rows.push(['Exagération du relief', `× ${comma(settings.exaggeration, 2)}`])
  const shown = [
    labels.climbs && 'sommets',
    labels.waypoints && 'points du fichier',
    labels.kmStep > 0 && `bornes ${labels.kmStep} km`,
    labels.endpoints && 'départ et arrivée',
    labels.photos && 'photos',
  ].filter(Boolean)
  rows.push(['Étiquettes', shown.length > 0 ? shown.join(', ') : 'aucune'])
  rows.push(['Repères OpenStreetMap', settings.landmarks.enabled ? `oui, ${Object.values(settings.landmarks.kinds).filter(Boolean).length} types` : 'non'])
  rows.push(['Trace', `halo ${yes(trackStyle.glow)}, qui se dessine ${yes(trackStyle.drawOn)}`])
  rows.push(['Marqueur', marker.kind === 'figurine' ? `figurine${marker.animated ? ' animée' : ''}` : marker.kind])
  rows.push(['Étalonnage des couleurs', isIdentityGrading(settings.grading) ? 'neutre' : settings.grading.preset])
  rows.push(['Météo de la sortie', yes(settings.weather.enabled)])
  rows.push(['Course en parallèle', yes(settings.race.enabled)])
  const points = tracks.reduce((sum, t) => sum + t.segments.reduce((n, s) => n + s.points.length, 0), 0)
  rows.push(['Traces', `${tracks.length}, ${points} points`])
  // how many of each kind the film uses and their weight in the table, never their content
  const used = Object.values(usedMedia(film, media))
  const count = { photo: 0, video: 0, audio: 0 }
  let bytes = 0
  for (const asset of used) {
    count[isVideoAsset(asset) ? 'video' : isAudioAsset(asset) ? 'audio' : 'photo']++
    // data URL in base64: 4 characters for 3 bytes
    bytes += (asset.data.length * 3) / 4
  }
  rows.push(['Médias du film', `${count.photo} photo(s), ${count.video} vidéo(s), ${count.audio} musique(s), ${mb(bytes)}`])
  rows.push(['Textes du film', String(film.texts.length)])
  const widgets = Object.values(overlay).filter((w) => typeof w === 'object' && w !== null && (w as { enabled?: unknown }).enabled === true).length
  rows.push(['Habillage', overlay.enabled ? `oui, ${widgets} élément(s)` : 'non'])
  return rows
}

/** The report of `input`, without the steps. */
export function buildReport(input: DiagnosticInput): DiagnosticReport {
  const sections: ReportSection[] = [
    { title: 'Appareil', rows: deviceRows(input) },
    { title: 'Export', rows: exportRows(input) },
    { title: 'Réglages', rows: settingsRows(input) },
  ]
  return {
    at: new Date(input.now).toISOString(),
    sections: sections.map((s) => ({ ...s, rows: s.rows.map(([label, value]): ReportRow => [label, cut(value)]) })),
  }
}

/** `now` with the export section of `last` (the report of the last export) as « Dernier export ». */
export function withLastExport(now: DiagnosticReport, last: DiagnosticReport | null): DiagnosticReport {
  const rows = last?.sections.find((s) => s.title === 'Export')?.rows
  if (!last || !rows) return now
  return { ...now, sections: [...now.sections, { title: 'Dernier export', rows: [['Commencé le', last.at], ...rows] }] }
}

/** Plain text, one « clé : valeur » per line, by section. */
export function formatReport(report: DiagnosticReport): string {
  const lines = ['Rapport de diagnostic OpenFlyover', `Fait le : ${report.at}`]
  for (const section of report.sections) {
    lines.push('', `[${section.title}]`, ...section.rows.map(([label, value]) => `${label} : ${value}`))
  }
  if (report.steps) {
    lines.push('', '[Étapes]', ...(report.steps.length > 0 ? report.steps.map((step, i) => `${i + 1} : ${step}`) : ['aucune']))
  }
  return lines.join('\n')
}

const isRow = (v: unknown): v is ReportRow => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string')

/** The stored report, null when there is none or it cannot be read. */
export function parseReport(raw: string | null | undefined): DiagnosticReport | null {
  try {
    const data = JSON.parse(raw ?? 'null') as { at?: unknown; sections?: unknown } | null
    if (!data || typeof data.at !== 'string' || !Array.isArray(data.sections)) return null
    const sections = data.sections.filter(
      (s): s is ReportSection => typeof s?.title === 'string' && Array.isArray(s.rows) && s.rows.every(isRow),
    )
    return { at: data.at, sections }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Live reading
// ---------------------------------------------------------------------------

/** What the canvas's WebGL context tells about the GPU. */
export function readGpuInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
    renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ''),
    antialias: gl.getContextAttributes()?.antialias ?? false,
  }
}

let gpuProbe: (() => GpuInfo) | null = null
let gpu: GpuInfo | null = null

/** The scene registers how to read the GPU (read once, at the first report). */
export function setGpuProbe(read: typeof gpuProbe): void {
  gpuProbe = read
  gpu = null
}

function gpuInfo(): GpuInfo | null {
  try {
    gpu ??= gpuProbe?.() ?? null
  } catch {
    // no context (lost): the report says « inconnue »
  }
  return gpu
}

/** The report of this device and the current settings, for `request` when an export starts. */
export function collectDiagnostic(request?: ReportRequest, now = Date.now()): DiagnosticReport {
  const scope = globalThis as {
    navigator?: { userAgent?: string; deviceMemory?: number; hardwareConcurrency?: number }
    screen?: { width: number; height: number }
    innerWidth?: number
    innerHeight?: number
    devicePixelRatio?: number
  }
  const { capabilities } = getPlatform()
  const { settings, tracks } = useAppStore.getState()
  return buildReport({
    now,
    version: __APP_VERSION__,
    desktop: capabilities.isDesktop,
    encoder: capabilities.videoEncoder,
    canStreamToDisk: capabilities.canStreamToDisk,
    userAgent: scope.navigator?.userAgent,
    screen: scope.screen && { width: scope.screen.width, height: scope.screen.height },
    viewport: scope.innerWidth === undefined ? undefined : { width: scope.innerWidth, height: scope.innerHeight ?? 0 },
    pixelRatio: scope.devicePixelRatio,
    memoryGb: scope.navigator?.deviceMemory,
    cores: scope.navigator?.hardwareConcurrency,
    budget: deviceBudget(),
    gpu: gpuInfo(),
    settings,
    tracks,
    media: useMediaStore.getState().table,
    request,
    noEncoding: noEncodingTest(),
  })
}

// ---------------------------------------------------------------------------
// Dialog (DiagnosticDialog.tsx, mounted once in App)
// ---------------------------------------------------------------------------

export const useDiagnosticStore = create<{ text: string | null }>(() => ({ text: null }))

/** Open the « Rapport de diagnostic » dialog on `text`. */
export function showDiagnostic(text: string): void {
  useDiagnosticStore.setState({ text })
}

export function closeDiagnostic(): void {
  useDiagnosticStore.setState({ text: null })
}

/** Copy `text` to the clipboard; false when it is missing or refused (the dialog then selects the text). */
export async function copyText(text: string, clipboard = globalThis.navigator?.clipboard): Promise<boolean> {
  try {
    if (!clipboard) return false
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
