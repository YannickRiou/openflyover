/**
 * Keeps a phone alive through an export and notices when it was not: the screen stays on while the film renders (a
 * locked screen or a backgrounded app suspends the page and loses the GPU context), and a flag in the tab's
 * sessionStorage tells the next start that the last export never ended (the browser killed the tab: memory, or the
 * screen locked). A small breadcrumb (last page event, memory counters) is kept beside it for the diagnosis.
 * Nothing here throws: no Wake Lock API or no storage just means no protection.
 */
import { showToast } from '../ui/toast'
import { isExportBusy, useExportStore } from './store'

export const EXPORT_RUNNING_KEY = 'openflyover.export.running'
export const BREADCRUMB_KEY = 'openflyover.breadcrumb'

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
}

let probe: (() => Pick<Breadcrumb, 'textures' | 'geometries' | 'tiles'>) | null = null

/** The scene registers how to read its memory counters (renderer.info, loaded tiles). */
export function setBreadcrumbProbe(read: typeof probe): void {
  probe = read
}

export function writeBreadcrumb(event: string, storage: FlagStorage | undefined = tabStorage(), now = Date.now()): void {
  try {
    const crumb: Breadcrumb = { event, at: now, ...probe?.() }
    storage?.setItem(BREADCRUMB_KEY, JSON.stringify(crumb))
  } catch {
    // diagnostic only
  }
}

/** « pagehide à 12:03:44 · 212 textures, 140 géométries, 96 tuiles » */
export function describeBreadcrumb(crumb: Breadcrumb): string {
  const time = new Date(crumb.at).toLocaleTimeString('fr-FR')
  const counts = [
    crumb.textures !== undefined && `${crumb.textures} textures`,
    crumb.geometries !== undefined && `${crumb.geometries} géométries`,
    crumb.tiles !== undefined && `${crumb.tiles} tuiles`,
  ].filter(Boolean)
  return `${crumb.event} à ${time}${counts.length > 0 ? ` · ${counts.join(', ')}` : ''}`
}

function readBreadcrumb(storage: FlagStorage): Breadcrumb | null {
  try {
    const crumb = JSON.parse(storage.getItem(BREADCRUMB_KEY) ?? 'null') as Breadcrumb | null
    return crumb && typeof crumb.event === 'string' && typeof crumb.at === 'number' ? crumb : null
  } catch {
    return null
  }
}

/** True once when the previous page lifetime of this tab died in the middle of an export (the flag is then cleared). */
export function takeInterruptedExport(storage: FlagStorage | undefined = tabStorage()): { breadcrumb: Breadcrumb | null } | null {
  try {
    if (!storage || storage.getItem(EXPORT_RUNNING_KEY) === null) return null
    storage.removeItem(EXPORT_RUNNING_KEY)
    return { breadcrumb: readBreadcrumb(storage) }
  } catch {
    return null
  }
}

/** At start-up: say so when the last export was cut short, with the last breadcrumb a click away. */
export function reportInterruptedExport(storage?: FlagStorage): boolean {
  const interrupted = takeInterruptedExport(storage)
  if (!interrupted) return false
  const { breadcrumb } = interrupted
  showToast({
    kind: 'error',
    text: EXPORT_INTERRUPTED_TEXT,
    ...(breadcrumb && {
      action: { label: 'Détails', run: () => showToast({ kind: 'info', text: `Dernier événement de la page : ${describeBreadcrumb(breadcrumb)}` }) },
    }),
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
    } catch {
      // no flag: an interruption goes unnoticed
    }
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
