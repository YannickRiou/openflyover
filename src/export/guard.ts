/**
 * Keeps a phone alive through an export and notices when it was not: the screen stays on while the film renders (a
 * locked screen or a backgrounded app suspends the page and loses the GPU context), and a flag in the tab's
 * sessionStorage tells the next start that the last export never ended (the browser killed the tab: memory, or the
 * screen locked). The last `MAX_STEPS` breadcrumbs (steps of the export or page events, memory counters) and the
 * diagnostic report of the export (diagnostic.ts) are kept beside it: iOS kills a tab short of memory without any page
 * event, so the export notes its own steps. Nothing here throws: no Wake Lock API or no storage just means no protection.
 */
import { showToast } from '../ui/toast'
import { REPORT_KEY, collectDiagnostic, formatReport, parseReport, resultSection, showDiagnostic, withLastExport, withResult } from './diagnostic'
import type { DiagnosticReport } from './diagnostic'
import { isExportBusy, useExportStore } from './store'
import { t, withLanguage } from '../i18n'
import { formatDate } from '../i18n/format'
import { formatNumber } from '../ui/format'

export const EXPORT_RUNNING_KEY = 'openflyover.export.running'
export const BREADCRUMB_KEY = 'openflyover.breadcrumb'
/** breadcrumbs kept (the oldest go first) */
export const MAX_STEPS = 25

/** Rendered frames noted as a step: the first 3, then 1 in 10 from 50 to 200 (where an iPhone died), else 1 in 25. */
export function isExportStep(rendered: number): boolean {
  return rendered < 3 || rendered % (rendered >= 50 && rendered <= 200 ? 10 : 25) === 0
}

export function exportInterruptedText(): string {
  return t('export.guard.interrupted')
}

export type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The tab's sessionStorage, undefined where the browser refuses it. */
function tabStorage(): FlagStorage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Screen wake lock
// ---------------------------------------------------------------------------

interface SentinelLike {
  release(): Promise<void>
  addEventListener?(type: 'release', listener: () => void): void
}

export interface WakeLockHost {
  navigator?: { wakeLock?: { request(type: 'screen'): Promise<SentinelLike> } }
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

export interface ScreenWakeLock {
  /** keep the screen on until `release` (asked again when the page comes back to the foreground) */
  hold(): void
  release(): void
}

export function createScreenWakeLock(host: WakeLockHost = globalThis as WakeLockHost): ScreenWakeLock {
  const api = host.navigator?.wakeLock
  const doc = host.document
  let wanted = false
  let pending = false
  let sentinel: SentinelLike | null = null

  const request = async () => {
    if (!api || !wanted || pending || sentinel || doc?.visibilityState === 'hidden') return
    pending = true
    try {
      const lock = await api.request('screen')
      if (!wanted) return void (await lock.release())
      sentinel = lock
      // the browser drops it by itself when the page is hidden: asked again on return
      lock.addEventListener?.('release', () => {
        if (sentinel === lock) sentinel = null
      })
    } catch {
      // refused (battery saver, no permission): the export goes on without
    } finally {
      pending = false
    }
  }
  const onVisible = () => {
    if (doc?.visibilityState === 'visible') void request()
  }

  return {
    hold() {
      if (wanted) return
      wanted = true
      doc?.addEventListener('visibilitychange', onVisible)
      void request()
    },
    release() {
      if (!wanted) return
      wanted = false
      doc?.removeEventListener('visibilitychange', onVisible)
      const lock = sentinel
      sentinel = null
      lock?.release().catch(() => undefined)
    },
  }
}

// ---------------------------------------------------------------------------
// Interrupted export
// ---------------------------------------------------------------------------

/** What the page knew when it last heard from the browser (a few bytes of sessionStorage). */
export interface Breadcrumb {
  event: string
  at: number
  textures?: number
  geometries?: number
  tiles?: number
  /** tiles loading or queued by the view */
  pending?: number
  /** factor on the terrain's error target that keeps a phone's tiles under its budget (1: full detail) */
  lod?: number
  /** JS heap in use, MB (`performance.memory`: Chrome only) */
  heapMb?: number
  /** decoded tile bitmaps in the LRU and their approximate MB */
  bitmaps?: number
  bitmapMb?: number
  /** decoded elevation grids */
  grids?: number
  /** frames handed to the video encoder and not yet out as packets, and its `encodeQueueSize` */
  inFlight?: number
  queue?: number
  /** re-drapes run since the previous breadcrumb */
  drapes?: number
}

type Counters = Omit<Breadcrumb, 'event' | 'at' | 'heapMb'>

let probe: (() => Counters) | null = null
let exportProbe: (() => Counters) | null = null

/** The scene registers how to read its memory counters (renderer.info, loaded tiles). */
export function setBreadcrumbProbe(read: typeof probe): void {
  probe = read
}

/** A running export adds its own counters (terrain caches, encoder, re-drapes); null when it ends. */
export function setExportProbe(read: typeof exportProbe): void {
  exportProbe = read
}

function heapMb(): number | undefined {
  const used = (globalThis.performance as { memory?: { usedJSHeapSize?: number } } | undefined)?.memory?.usedJSHeapSize
  return typeof used === 'number' ? Math.round(used / 1e6) : undefined
}

/** Adds a step to the breadcrumbs of the tab (the last `MAX_STEPS` are kept). */
export function writeBreadcrumb(event: string, storage: FlagStorage | undefined = tabStorage(), now = Date.now()): void {
  try {
    const heap = heapMb()
    const crumb: Breadcrumb = { event: event.slice(0, 80), at: now, ...probe?.(), ...exportProbe?.(), ...(heap !== undefined && { heapMb: heap }) }
    storage?.setItem(BREADCRUMB_KEY, JSON.stringify([...readBreadcrumbs(storage), crumb].slice(-MAX_STEPS)))
  } catch {
    // diagnostic only
  }
}

/**
 * « image 100 / 1848 à 16:12:25 · 136 tex, 126 géo, 161 tuiles (12 en attente), 180 bitmaps ~45 Mo, 160 grilles,
 * 4 en vol, file 2, 37 re-drapages, 310 Mo de tas JS, +11,0 s » (the time since `previous`)
 */
export function describeBreadcrumb(crumb: Breadcrumb, previous?: Breadcrumb): string {
  // a line of the diagnostic report: French whatever the language of the interface
  return withLanguage('fr', () => describeFrenchBreadcrumb(crumb, previous))
}

function describeFrenchBreadcrumb(crumb: Breadcrumb, previous?: Breadcrumb): string {
  const time = formatDate(crumb.at, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const has = (n: number | undefined): n is number => n !== undefined
  const elapsedS = previous ? (crumb.at - previous.at) / 1000 : undefined
  const counts = [
    has(crumb.textures) && `${crumb.textures} tex`,
    has(crumb.geometries) && t('export.crumb.geometries', { n: crumb.geometries }),
    has(crumb.tiles) && (has(crumb.pending) ? t('export.crumb.tilesPending', { n: crumb.tiles, pending: crumb.pending }) : t('export.crumb.tiles', { n: crumb.tiles })),
    !has(crumb.tiles) && has(crumb.pending) && t('export.crumb.pending', { n: crumb.pending }),
    has(crumb.lod) && crumb.lod !== 1 && t('export.crumb.lod', { value: formatNumber(crumb.lod, 1) }),
    has(crumb.bitmaps) && (has(crumb.bitmapMb) ? t('export.crumb.bitmapsSize', { n: crumb.bitmaps, mb: crumb.bitmapMb }) : t('export.crumb.bitmaps', { n: crumb.bitmaps })),
    has(crumb.grids) && t('export.crumb.grids', { n: crumb.grids }),
    has(crumb.inFlight) && t('export.crumb.inFlight', { n: crumb.inFlight }),
    has(crumb.queue) && t('export.crumb.queue', { n: crumb.queue }),
    has(crumb.drapes) && t('export.crumb.drapes', { n: crumb.drapes }),
    has(crumb.heapMb) && t('export.crumb.heap', { mb: crumb.heapMb }),
    has(elapsedS) && `+${formatNumber(elapsedS, 1)} s`,
  ].filter(Boolean)
  return `${t('export.crumb.line', { event: crumb.event, time })}${counts.length > 0 ? ` · ${counts.join(', ')}` : ''}`
}

/** The breadcrumbs worded, each with the time since the one before. */
export function describeSteps(crumbs: readonly Breadcrumb[]): string[] {
  return crumbs.map((crumb, i) => describeBreadcrumb(crumb, crumbs[i - 1]))
}

const isCrumb = (c: Breadcrumb | null): c is Breadcrumb => !!c && typeof c.event === 'string' && typeof c.at === 'number'

/** The breadcrumbs of the tab, oldest first. */
export function readBreadcrumbs(storage: FlagStorage | undefined = tabStorage()): Breadcrumb[] {
  try {
    const raw = JSON.parse(storage?.getItem(BREADCRUMB_KEY) ?? '[]') as Breadcrumb | Breadcrumb[] | null
    // a single one: written before the steps were kept
    return (Array.isArray(raw) ? raw : [raw]).filter(isCrumb).slice(-MAX_STEPS)
  } catch {
    return []
  }
}

/** The report of the last export of the tab with its steps (« Détails » of an interrupted export). */
function lastExportReport(storage: FlagStorage | undefined): string | null {
  const steps = readBreadcrumbs(storage)
  const report = parseReport(storage?.getItem(REPORT_KEY))
  if (!report && steps.length === 0) return null
  return formatReport({ ...(report ?? collectDiagnostic()), steps: describeSteps(steps) })
}

/** « Afficher le rapport » (Projet tab): the report made now, with the export section and the steps of the last export. */
export function currentReport(storage: FlagStorage | undefined = tabStorage()): string {
  let last: DiagnosticReport | null = null
  try {
    last = parseReport(storage?.getItem(REPORT_KEY))
  } catch {
    // no storage: no last export
  }
  return formatReport({ ...withLastExport(collectDiagnostic(), last), steps: describeSteps(readBreadcrumbs(storage)) })
}

/** True once when the previous page lifetime of this tab died in the middle of an export (the flag is then cleared). */
export function takeInterruptedExport(storage: FlagStorage | undefined = tabStorage()): { breadcrumb: Breadcrumb | null } | null {
  try {
    if (!storage || storage.getItem(EXPORT_RUNNING_KEY) === null) return null
    storage.removeItem(EXPORT_RUNNING_KEY)
    return { breadcrumb: readBreadcrumbs(storage).at(-1) ?? null }
  } catch {
    return null
  }
}

/** At start-up: say so when the last export was cut short, with its diagnostic report a click away. */
export function reportInterruptedExport(storage: FlagStorage | undefined = tabStorage()): boolean {
  if (!takeInterruptedExport(storage)) return false
  let report: string | null = null
  try {
    report = lastExportReport(storage)
  } catch {
    // no report: the toast alone
  }
  showToast({
    kind: 'error',
    text: exportInterruptedText(),
    ...(report !== null && { action: { label: t('export.guard.details'), run: () => showDiagnostic(report) } }),
  })
  return true
}

/**
 * Watch the export store (once, at start-up): the screen stays on and the flag is set while an export is busy, both
 * undone when it ends, whatever the way. Also records the breadcrumbs. Returns the stop function.
 */
export function installExportGuard(
  lock: ScreenWakeLock = createScreenWakeLock(),
  storage: FlagStorage | undefined = tabStorage(),
  // `pagehide` fires on the window, `freeze` (Page Lifecycle) on the document
  targets: { pagehide?: EventTarget; freeze?: EventTarget } = { pagehide: globalThis.window, freeze: globalThis.document },
): () => void {
  const crumb = (e: Event) => writeBreadcrumb(e.type, storage)
  targets.pagehide?.addEventListener('pagehide', crumb)
  targets.freeze?.addEventListener('freeze', crumb)
  const unsubscribe = useExportStore.subscribe((state, previous) => {
    const busy = isExportBusy(state.phase)
    if (busy === isExportBusy(previous.phase)) return
    try {
      if (busy) storage?.setItem(EXPORT_RUNNING_KEY, String(Date.now()))
      else storage?.removeItem(EXPORT_RUNNING_KEY)
      // the breadcrumbs and report of an earlier export would be taken for this one's
      if (busy) storage?.removeItem(BREADCRUMB_KEY)
      if (busy) storage?.removeItem(REPORT_KEY)
    } catch {
      // no flag: an interruption goes unnoticed
    }
    try {
      if (busy) storage?.setItem(REPORT_KEY, JSON.stringify(collectDiagnostic(state.request ?? undefined)))
      // the end: how it went and where the time went, beside the export it describes
      const report = busy ? null : parseReport(storage?.getItem(REPORT_KEY))
      if (report) storage?.setItem(REPORT_KEY, JSON.stringify(withResult(report, resultSection(state))))
    } catch {
      // diagnostic only
    }
    if (busy) writeBreadcrumb('export : démarrage', storage)
    if (busy) lock.hold()
    else lock.release()
  })
  return () => {
    unsubscribe()
    lock.release()
    targets.pagehide?.removeEventListener('pagehide', crumb)
    targets.freeze?.removeEventListener('freeze', crumb)
  }
}
