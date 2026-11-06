/**
 * « Rapport de diagnostic »: the device, the export asked and every setting that weighs on memory, as plain text to
 * paste in a bug report. Snapshot taken when an export starts (guard.ts, tab's sessionStorage), shown by « Détails » of
 * an interrupted export and by « Afficher le rapport » (Projet tab) with the steps of the export.
 * Building and formatting are pure (tested). No coordinate, no track, place, project or file name: the user pastes it.
 * The report stays in French whatever the language of the interface: it is read by the maintainers (`withLanguage`).
 */
import { create } from 'zustand'
import { deviceBudget } from '../core/deviceBudget'
import type { DeviceBudget, DeviceKind } from '../core/deviceBudget'
import { currentPreviewBudget, currentPreviewRung } from '../scene/previewQuality'
import type { PreviewRung } from '../scene/previewQuality'
import type { Track } from '../core/types'
import { isAudioAsset, isVideoAsset, useMediaStore, usedMedia } from '../film/media'
import type { MediaTable } from '../film/media'
import { getPlatform } from '../platform'
import { withLanguage } from '../i18n'
import type { VideoEncoderKind } from '../platform'
import { isIdentityGrading } from '../scene/grading'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { tileWorkerStatus } from '../terrain/tileWorkerStatus'
import type { TileWorkerStatus } from '../terrain/tileWorkerStatus'
import { deviceBitrateCap, targetBitrate } from './encoder'
import { OUTCOME_LABELS, handoverLabel, settingsDetails, shadowSummary, summariseSettings, timingsSummary } from './history'
import { effectiveRender } from './qualityTier'
import { buildFrameSchedule, videoEncoding, videoSize } from './schedule'
import type { ExportRequest, ExportState } from './store'

/** package.json version, set by vite.config.ts */
declare const __APP_VERSION__: string

/** sessionStorage key of the report taken when the last export started (steps excluded) */
export const REPORT_KEY = 'openflyover.diagnostic'
/** longest value kept (user agent, GPU name) */
const MAX_VALUE = 200
/** sessionStorage key of « Export de test sans encodage » (this tab only, never in the project) */
export const NO_ENCODING_KEY = 'openflyover.export.noEncoding'

/**
 * sessionStorage key of the wait for the GPU before each frame of an export is composed (this tab only, never in the
 * project): '1' keeps it on a computer too (it tells how long the GPU takes, `gpuWaitMs`, at the price of an export about
 * three times slower on a graphics card of 2016, #434), '0' drops it on a phone or tablet. Set from the console or, where
 * there is none (a phone), by `?export-gpu-wait=on|off|default` in the page address (`applyGpuWaitParam`).
 */
export const GPU_WAIT_KEY = 'openflyover.export.gpuWait'

type TestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function tabStorage(): TestStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

export type GpuWaitSetting = 'on' | 'off' | null

/** What this tab asks for the wait for the GPU before composing a frame (`GPU_WAIT_KEY`); null: the device's default. */
export function gpuWaitSetting(storage: TestStorage | undefined = tabStorage()): GpuWaitSetting {
  try {
    const value = storage?.getItem(GPU_WAIT_KEY)
    return value === '1' ? 'on' : value === '0' ? 'off' : null
  } catch {
    return null
  }
}

/** Whether an export waits for the GPU before composing each frame: as asked, else yes on a phone or tablet, no on a computer. */
export function waitsForGpuFor(kind: DeviceKind, setting: GpuWaitSetting): boolean {
  return setting === null ? kind !== 'desktop' : setting === 'on'
}

/**
 * `?export-gpu-wait=on|off|default` in the page address sets `GPU_WAIT_KEY` for this tab, to compare two exports on a
 * phone, which has no console: nothing without the parameter, so a computer never changes by itself.
 */
export function applyGpuWaitParam(search: string, storage: TestStorage | undefined = tabStorage()): void {
  const value = new URLSearchParams(search).get('export-gpu-wait')
  if (value !== 'on' && value !== 'off' && value !== 'default') return
  try {
    if (value === 'default') storage?.removeItem(GPU_WAIT_KEY)
    else storage?.setItem(GPU_WAIT_KEY, value === 'on' ? '1' : '0')
  } catch {
    // no storage: the default stays
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
  /** the browser measures the GPU time of a render (`hasGpuTimer`): not Safari, hence not an iPhone */
  timerQueries?: boolean
}

export type ReportRequest = Pick<
  ExportRequest,
  'width' | 'height' | 'fps' | 'quality' | 'durationS' | 'progressAt' | 'holdStartS' | 'holdEndS' | 'still' | 'destination' | 'overlayOnly' | 'encoding'
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
  /** the terrain workers (`tileWorkerStatus`) */
  tileWorkers?: TileWorkerStatus
  /** what this tab asks for the wait for the GPU (`gpuWaitSetting`) */
  gpuWait?: GpuWaitSetting
  /** rung of the preview now (`currentPreviewRung`): a lightened preview also lowers the clouds of an export */
  previewRung?: PreviewRung
}

const yes = (v: boolean) => (v ? 'oui' : 'non')
const comma = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')
const mb = (bytes: number) => `${comma(bytes / 1e6)} Mo`
const mbits = (bits: number) => (Number.isFinite(bits) ? `${comma(bits / 1e6)} Mbit/s` : 'aucun plafond')
const cut = (text: string) => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text)

/** « actifs (3), 120 tuiles construites », « non pris en charge », … */
function workersLabel({ state, workers, built }: TileWorkerStatus): string {
  if (state === 'active') return `actifs (${workers}), ${built} tuile${built > 1 ? 's' : ''} construite${built > 1 ? 's' : ''}`
  if (state === 'unsupported') return 'non pris en charge par ce navigateur : les tuiles sont construites par la page'
  if (state === 'dropped') return 'abandonnés après une erreur ou un résultat différent : les tuiles sont construites par la page'
  return 'pas encore utilisés'
}

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
    ['Temps de la carte graphique mesurable', gpu?.timerQueries === undefined ? 'inconnu' : yes(gpu.timerQueries)],
    ['Workers du terrain', input.tileWorkers ? workersLabel(input.tileWorkers) : 'inconnus'],
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

function exportRows({ request, settings, budget, canStreamToDisk, noEncoding, gpuWait, previewRung }: DiagnosticInput): ReportRow[] {
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
  if (previewRung !== undefined) {
    // the measures of « Coût des couches » only compare when this is the same from one report to the next
    const scale = budget.exportCloudResolutionScale
    const every = budget.exportCloudShadowEvery
    const shadow = every > 1 ? `, ombre une tranche sur ${every}` : ''
    rows.push(['Nuages de l’export', `${Math.round(scale * 100)} % de la résolution${shadow} (aperçu ${previewRung === 0 ? 'complet' : `allégé, palier ${previewRung}`})`])
  }
  // the encoder's bitrate for H.264 (the codec chosen is in the steps), or the one set by hand
  const cap = deviceBitrateCap(budget, canStreamToDisk)
  const encoding = request ? request.encoding : videoEncoding(settings.video)
  const options = { width: size.width, height: size.height, fps, quality, encoding }
  const bitrate = targetBitrate(options, 'avc', cap)
  const manual = encoding?.bitrateMbps !== null && encoding?.bitrateMbps !== undefined
  rows.push([
    manual ? 'Débit vidéo (manuel)' : 'Débit vidéo (H.264)',
    `${mbits(bitrate)}${bitrate < targetBitrate(options, 'avc', Infinity) ? `, plafonné à ${mbits(cap)}` : ''}`,
  ])
  if (encoding) {
    rows.push(['Encodage', `codec ${encoding.codec}, image clé toutes les ${comma(encoding.keyframeIntervalS)} s, son ${encoding.audioKbps} kbit/s`])
  }
  rows.push(['Destination', request ? (request.destination ? 'fichier sur le disque' : 'mémoire') : canStreamToDisk ? 'disque (au choix)' : 'mémoire'])
  if (noEncoding) rows.push(['Encodage', 'désactivé (test)'])
  const waits = waitsForGpuFor(budget.kind, gpuWait ?? null)
  rows.push([
    'Attente de la carte graphique',
    `${yes(waits)} (${gpuWait ? 'demandée dans cet onglet' : budget.kind === 'desktop' ? 'ordinateur : par défaut' : 'téléphone ou tablette : par défaut'})`,
  ])
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
  return withLanguage('fr', () => buildFrenchReport(input))
}

function buildFrenchReport(input: DiagnosticInput): DiagnosticReport {
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

/** Title of the section added to the report of an export when it ends (`resultSection`). */
export const RESULT_TITLE = 'Résultat'
/** Longest error kept (the tiles an export could not get are named in it) */
const MAX_ERROR = 600

/**
 * « Résultat » of an export, added to its report when it ends: outcome and error (the hosts, tiles and causes when the
 * tiles failed), frames, where the time went (GPU, composing, video frame, encoder wait), the encoder.
 */
export function resultSection(state: Pick<ExportState, 'phase' | 'error' | 'frame' | 'frameCount' | 'timings' | 'result'>): ReportSection {
  return withLanguage('fr', () => frenchResultSection(state))
}

function frenchResultSection(state: Pick<ExportState, 'phase' | 'error' | 'frame' | 'frameCount' | 'timings' | 'result'>): ReportSection {
  const { phase, error, timings, result } = state
  const outcome = phase === 'done' || phase === 'error' || phase === 'canceled' ? OUTCOME_LABELS[phase] : phase
  const rows: ReportRow[] = [['Issue', outcome]]
  if (error) rows.push(['Erreur', error.length > MAX_ERROR ? `${error.slice(0, MAX_ERROR - 1)}…` : error])
  rows.push(['Images', `${state.frame} / ${state.frameCount}, ${timings.rendered} rendues, ${timings.renders} rendus`])
  rows.push(['Répartition', timingsSummary(timings)])
  const shadows = shadowSummary(timings)
  if (shadows) rows.push(['Ombres', shadows])
  if (timings.gpuRenders === 0) rows.push(['Temps GPU', "non mesuré (pas de requêtes de minuterie WebGL ici) : voir l'attente de la carte graphique"])
  rows.push(['Tuiles', `${timings.timeouts} image(s) au délai, ${timings.givenUp} image(s) aux tuiles abandonnées`])
  if (timings.handover) rows.push(['Image vidéo', handoverLabel(timings.handover)])
  if (result) rows.push(['Fichier', `${result.codec}${result.hardware ? ', encodeur matériel' : ''}`])
  return { title: RESULT_TITLE, rows }
}

/** `report` with its « Résultat » section (replaced when there is one). */
export function withResult(report: DiagnosticReport, result: ReportSection): DiagnosticReport {
  return { ...report, sections: [...report.sections.filter((s) => s.title !== RESULT_TITLE), result] }
}

/** `now` with the export and result sections of `last` (the report of the last export) as « Dernier export ». */
export function withLastExport(now: DiagnosticReport, last: DiagnosticReport | null): DiagnosticReport {
  const rows = last?.sections.find((s) => s.title === 'Export')?.rows
  if (!last || !rows) return now
  const result = last.sections.find((s) => s.title === RESULT_TITLE)?.rows ?? []
  return { ...now, sections: [...now.sections, { title: 'Dernier export', rows: [['Commencé le', last.at], ...rows, ...result] }] }
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

/**
 * The browser measures the GPU time of a render (`EXT_disjoint_timer_query_webgl2`, `gpuTimer.ts`): not Safari, hence not an
 * iPhone. Here and not in `gpuTimer.ts`, which loads with the export: this file is on the first screen.
 */
export function hasGpuTimer(gl: unknown): boolean {
  const ctx = gl as Partial<Pick<WebGL2RenderingContext, 'createQuery' | 'getExtension'>> | null
  if (!ctx || typeof ctx.createQuery !== 'function' || typeof ctx.getExtension !== 'function') return false
  try {
    return ctx.getExtension('EXT_disjoint_timer_query_webgl2') !== null
  } catch {
    return false
  }
}

/** What the canvas's WebGL context tells about the GPU. */
export function readGpuInfo(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuInfo {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
    renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ''),
    antialias: gl.getContextAttributes()?.antialias ?? false,
    timerQueries: hasGpuTimer(gl),
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
    // the preview limits in use: « Qualité de l'aperçu » and what « Auto » measured
    budget: { ...deviceBudget(), ...currentPreviewBudget() },
    gpu: gpuInfo(),
    settings,
    tracks,
    media: useMediaStore.getState().table,
    request,
    noEncoding: noEncodingTest(),
    tileWorkers: tileWorkerStatus(),
    gpuWait: gpuWaitSetting(),
    previewRung: currentPreviewRung(),
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
