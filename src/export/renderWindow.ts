/**
 * Desktop: « File de rendus » in a small window of its own, like a render queue beside an editor. The main window
 * opens it with « Lancer la file » (`openRenderWindow`); it loads the same app with `?file-de-rendus`, which shows only
 * the 3D view and a progress bar (`isRenderWindow`, App.tsx), renders the queue the way the main window used to
 * (`runInRenderWindow`: the same `runRenderQueue`, the same export, so the same speed), then closes. The main window
 * stays free: editing goes on there, its preview kept light meanwhile (`useRenderElsewhere`). The two windows share
 * the queue through the storage (queue.ts `installQueueSync`).
 */
import { errorMessage } from '../core/errors'
import { t } from '../i18n'
import { getPlatform } from '../platform'
import { reuseFolder } from '../platform/folder'
import { showToast } from '../ui/toast'

export const RENDER_WINDOW_LABEL = 'file-de-rendus'
const RENDER_WINDOW_QUERY = 'file-de-rendus'
/** size of the window, in logical pixels: the film is rendered at its own size whatever this one is */
export const RENDER_WINDOW_SIZE = { width: 480, height: 340 }

/** This page is the render window. */
export function isRenderWindow(scope: { location?: Pick<Location, 'search'> } = globalThis): boolean {
  return new URLSearchParams(scope.location?.search ?? '').has(RENDER_WINDOW_QUERY)
}

/** Open the render window, or bring it to the front when it is open; false when it could not be made. */
export async function openRenderWindow(): Promise<boolean> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const open = await WebviewWindow.getByLabel(RENDER_WINDOW_LABEL)
    if (open) {
      await open.unminimize().catch(() => undefined)
      await open.setFocus()
      return true
    }
    const window = new WebviewWindow(RENDER_WINDOW_LABEL, {
      url: `index.html?${RENDER_WINDOW_QUERY}`,
      title: t('export.queue.windowTitle'),
      ...RENDER_WINDOW_SIZE,
      minWidth: 320,
      minHeight: 240,
    })
    return await new Promise<boolean>((resolve) => {
      void window.once('tauri://created', () => resolve(true))
      void window.once('tauri://error', (event) => {
        console.warn('[file de rendus] fenêtre impossible :', event.payload)
        resolve(false)
      })
    })
  } catch (error) {
    console.warn('[file de rendus] fenêtre impossible :', errorMessage(error))
    return false
  }
}

/** Bring the render window to the front, when it is open. */
export async function showRenderWindow(): Promise<void> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const open = await WebviewWindow.getByLabel(RENDER_WINDOW_LABEL)
    await open?.unminimize().catch(() => undefined)
    await open?.setFocus()
  } catch {
    // no window: nothing to show
  }
}

/** Seconds the window stays open after the run, so its last state can be read. */
export const CLOSE_AFTER_MS = 4000

/**
 * The render window's whole job, once, at start: render the queue into the folder the main window chose, then close.
 * The folder was picked in the main window (it is in the app's fs scope); gone meanwhile, nothing is rendered.
 */
export async function runInRenderWindow(): Promise<void> {
  // the queue's code comes with the export panel's: not in the first chunk of the app
  const { QUEUE_FOLDER_KEY, installQueueSync, runRenderQueue } = await import('./queue')
  const stopSync = installQueueSync(true)
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const folder = await reuseFolder(getPlatform().storage.get(QUEUE_FOLDER_KEY), exists)
    if (!folder) showToast({ kind: 'error', text: t('export.queue.folderGone') })
    else await runRenderQueue({ folder, save: () => undefined, sharesProgress: true })
  } catch (error) {
    showToast({ kind: 'error', text: errorMessage(error) })
  } finally {
    stopSync()
  }
  setTimeout(() => {
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())
  }, CLOSE_AFTER_MS)
}
