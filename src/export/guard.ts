/**
 * Keeps a phone alive through an export and notices when it was not: the screen stays on while the film renders (a
 * locked screen or a backgrounded app suspends the page and loses the GPU context), and a flag in the tab's
 * sessionStorage tells the next start that the last export never ended (the browser killed the tab: memory, or the
 * screen locked). The last `MAX_STEPS` breadcrumbs (steps of the export or page events, memory counters) and the
 * diagnostic report of the export (diagnostic.ts) are kept beside it: iOS kills a tab short of memory without any page
 * event, so the export notes its own steps. Nothing here throws: no Wake Lock API or no storage just means no protection.
 */
import { showToast } from '../ui/toast'
import { REPORT_KEY, collectDiagnostic, formatReport, parseReport, showDiagnostic, withLastExport } from './diagnostic'
import type { DiagnosticReport } from './diagnostic'
import { isExportBusy, useExportStore } from './store'

export const EXPORT_RUNNING_KEY = 'openflyover.export.running'
export const BREADCRUMB_KEY = 'openflyover.breadcrumb'
/** breadcrumbs kept (the oldest go first) */
export const MAX_STEPS = 15

export const EXPORT_INTERRUPTED_TEXT =
  'Le dernier export a été interrompu (mémoire insuffisante ou écran verrouillé). Essayez 720p, sans nuages, ou gardez l’écran allumé.'

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
  /** JS heap in use, MB (`performance.memory`: Chrome only) */
  heapMb?: number
}

let probe: (() => Pick<Breadcrumb, 'textures' | 'geometries' | 'tiles' | 'pending'>) | null = null

/** The scene registers how to read its memory counters (renderer.info, loaded tiles). */
export function setBreadcrumbProbe(read: typeof probe): void {
  probe = read
}

function heapMb(): number | undefined {
  const used = (globalThis.performance as { memory?: { usedJSHeapSize?: number } } | undefined)?.memory?.usedJSHeapSize
  return typeof used === 'number' ? Math.round(used / 1e6) : undefined
}

/** Adds a step to the breadcrumbs of the tab (the last `MAX_STEPS` are kept). */
export function writeBreadcrumb(event: string, storage: FlagStorage | undefined = tabStorage(), now = Date.now()): void {
  try {
    const heap = heapMb()
    const crumb: Breadcrumb = { event: event.slice(0, 80), at: now, ...probe?.(), ...(heap !== undefined && { heapMb: heap }) }
    storage?.setItem(BREADCRUMB_KEY, JSON.stringify([...readBreadcrumbs(storage), crumb].slice(-MAX_STEPS)))
  } catch {
    // diagnostic only
  }
}

/** « pagehide à 12:03:44 · 212 textures, 140 géométries, 96 tuiles, 3 en attente, 310 Mo de tas JS » */
export function describeBreadcrumb(crumb: Breadcrumb): string {
  const time = new Date(crumb.at).toLocaleTimeString('fr-FR')
  const counts = [
    crumb.textures !== undefined && `${crumb.textures} textures`,
    crumb.geometries !== undefined && `${crumb.geometries} géométries`,
    crumb.tiles !== undefined && `${crumb.tiles} tuiles`,
    crumb.pending !== undefined && `${crumb.pending} en attente`,
    crumb.heapMb !== undefined && `${crumb.heapMb} Mo de tas JS`,
  ].filter(Boolean)
  return `${crumb.event} à ${time}${counts.length > 0 ? ` · ${counts.join(', ')}` : ''}`
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
  return formatReport({ ...(report ?? collectDiagnostic()), steps: steps.map(describeBreadcrumb) })
}

/** « Afficher le rapport » (Projet tab): the report made now, with the export section and the steps of the last export. */
export function currentReport(storage: FlagStorage | undefined = tabStorage()): string {
  let last: DiagnosticReport | null = null
  try {
    last = parseReport(storage?.getItem(REPORT_KEY))
  } catch {
    // no storage: no last export
  }
  return formatReport({ ...withLastExport(collectDiagnostic(), last), steps: readBreadcrumbs(storage).map(describeBreadcrumb) })
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
    text: EXPORT_INTERRUPTED_TEXT,
    ...(report !== null && { action: { label: 'Détails', run: () => showDiagnostic(report) } }),
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
