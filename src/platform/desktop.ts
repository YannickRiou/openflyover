/**
 * Desktop platform (Tauri v2): native open / save dialogs, files read and written by the fs plugin. The Tauri
 * packages are imported on first use, only inside the desktop app. A path picked in a dialog is added to the fs scope
 * by the dialog plugin, so the capabilities (src-tauri/capabilities) grant no other path.
 * Storage stays localStorage: the webview keeps it in the app data folder. A film is written while it is encoded
 * through a file handle (`open`, `seek`, `write`), removed if the export does not finish. Offline tiles are files
 * under `<app data>/tiles/`, « Mes projets » under `<app data>/projects/` (the only folders the capability adds to the
 * fs scope). Closing the window waits for `guardClose` (last write, question when something would be lost). « Rechercher
 * une mise à jour » goes through the updater and process plugins, when the build has them (src-tauri/updater.conf.json).
 */
import { droppedFiles, fileNameOf, keyValueStore, mimeTypeOf, rememberFileTarget, saveFilters } from './platform'
import type { Capabilities, DocumentOutcome, FileFilter, FileTarget, Platform, SaveDocumentOptions, SaveFileOptions, SaveOutcome, WritableFile } from './platform'
import { joinPath } from './folder'
import { createDesktopLibraryFiles, createProjectLibrary } from './projectLibrary'
import { createDesktopTileCache } from './tileCache'
import { checkOutcome, downloadProgress, failedCheck } from './updater'
import type { UpdateProgress } from './updater'
import type { Update } from '@tauri-apps/plugin-updater'
import { t } from '../i18n'

const dialogFilters = (filters: readonly FileFilter[]) => filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }))

async function saveBlob(data: Blob, options: SaveFileOptions): Promise<SaveOutcome> {
  const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
  const path = await save({ defaultPath: options.fileName, filters: dialogFilters(saveFilters(options)) })
  if (!path) return { saved: false }
  await writeFile(path, new Uint8Array(await data.arrayBuffer()))
  return { saved: true, fileName: fileNameOf(path) }
}

/** Target of a file the desktop app can write again: its path (in the fs scope: picked in a dialog, or opened by the OS). */
export interface DesktopFileTarget extends FileTarget {
  readonly path: string
}

const desktopTarget = (path: string): DesktopFileTarget => ({ fileName: fileNameOf(path), path })

type ReadFile = (path: string) => Promise<BlobPart>

/** The file at `path` as a `File` that remembers where it came from (`fileTargetOf`). */
async function fileAt(path: string, readFile: ReadFile): Promise<File> {
  const name = fileNameOf(path)
  const file = new File([await readFile(path)], name, { type: mimeTypeOf(name) })
  rememberFileTarget(file, desktopTarget(path))
  return file
}

/** The files at `paths` (each remembers its path), the fs plugin loaded once. */
export async function readPathsAsFiles(paths: readonly string[]): Promise<File[]> {
  if (paths.length === 0) return []
  const { readFile } = await import('@tauri-apps/plugin-fs')
  return Promise.all(paths.map((path) => fileAt(path, readFile)))
}

/**
 * `saveDocument`: the path of the target, else the save dialog (on the folder of the target when asked again). A write
 * that fails with the file gone (folder removed, drive unplugged) opens the dialog; any other failure throws.
 */
async function saveDocument(produce: () => Promise<Blob>, options: SaveDocumentOptions): Promise<DocumentOutcome> {
  const [{ save }, { writeFile, exists }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
  const previous = (options.target as DesktopFileTarget | null | undefined)?.path
  const ask = async () => save({ defaultPath: previous ?? options.fileName, filters: dialogFilters(saveFilters(options)) })
  let path = previous && !options.ask ? previous : await ask()
  if (!path) return { saved: false }
  const bytes = new Uint8Array(await (await produce()).arrayBuffer())
  try {
    await writeFile(path, bytes)
  } catch (error) {
    // the file is still there (or that cannot be told): a real failure (disk full, access), the project stays as it was
    if (path !== previous || options.ask || (await exists(path).catch(() => true))) throw error
    const chosen = await ask()
    if (!chosen) return { saved: false }
    path = chosen
    await writeFile(path, bytes)
  }
  return { saved: true, fileName: fileNameOf(path), target: desktopTarget(path) }
}

/** Where the last film was saved (its folder), to open the dialog there next time. */
const LAST_FILM_FOLDER_KEY = 'openflyover.lastFilmFolder'

async function createWritableFile(options: SaveFileOptions): Promise<WritableFile | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const storage = keyValueStore(globalThis.localStorage ?? null)
  const folder = storage.get(LAST_FILM_FOLDER_KEY)
  const path = await save({ defaultPath: folder ? joinPath(folder, options.fileName) : options.fileName, filters: dialogFilters(saveFilters(options)) })
  if (!path) return null
  storage.set(LAST_FILM_FOLDER_KEY, path.slice(0, path.length - fileNameOf(path).length).replace(/[\\/]+$/, '') || path)
  return openWritablePath(path)
}

/** The file `path` shown in the system's file manager (the opener plugin: the file is selected in its folder). */
async function revealFile(path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('plugin:opener|reveal_item_in_dir', { paths: [path] })
}

/** The file at `path` (created or emptied), open for writing; removed by `discard`. */
export async function openWritablePath(path: string): Promise<WritableFile> {
  const fs = await import('@tauri-apps/plugin-fs')
  const file = await fs.open(path, { write: true, create: true, truncate: true })
  /** cursor of the handle: a seek only for the header patches */
  let cursor = 0
  let state: 'open' | 'closed' | 'discarded' = 'open'
  return {
    fileName: fileNameOf(path),
    path,
    async write(data, position) {
      if (position !== cursor) await file.seek(position, fs.SeekMode.Start)
      for (let offset = 0; offset < data.length; ) {
        const written = await file.write(data.subarray(offset))
        if (written <= 0) throw new Error(t('platform.error.writeStopped'))
        offset += written
      }
      cursor = position + data.length
    },
    async close() {
      await file.close()
      state = 'closed'
    },
    async discard() {
      if (state !== 'open') return
      state = 'discarded'
      await file.close().catch(() => undefined)
      await fs.remove(path).catch(() => undefined)
    },
  }
}

/**
 * Look for an update when asked, and install the one found. The plugins are Rust-side and registered only in builds
 * made with updater.conf.json: without them the commands reject with « plugin updater not found » (`failedCheck`).
 */
function desktopUpdater(): Pick<Platform, 'checkForUpdate' | 'installUpdate'> {
  /** the update the last check found: it holds a resource on the Rust side, which `installUpdate` uses */
  let found: Update | null = null
  return {
    async checkForUpdate() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        await found?.close().catch(() => undefined)
        found = null
        found = await check()
        return checkOutcome(found)
      } catch (error) {
        found = null
        return failedCheck(error, globalThis.navigator?.onLine !== false)
      }
    },
    async installUpdate(onProgress) {
      const update = found
      if (!update) throw new Error(t('platform.error.noUpdate'))
      const { relaunch } = await import('@tauri-apps/plugin-process')
      let progress: UpdateProgress = { downloadedBytes: 0, totalBytes: null }
      await update.downloadAndInstall((event) => {
        progress = downloadProgress(progress, event)
        onProgress?.(progress)
      })
      found = null
      // Windows: the installer has already closed the app and starts it again, this is not reached
      await relaunch()
    },
  }
}

export function createDesktopPlatform(capabilities: Capabilities): Platform {
  return {
    capabilities,
    storage: keyValueStore(globalThis.localStorage ?? null),
    async openFiles({ filters, multiple = false }) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = (await open({ multiple, directory: false, filters: dialogFilters(filters) })) as string | string[] | null
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked]
      return readPathsAsFiles(paths)
    },
    saveFile: saveBlob,
    async saveUrl(url, options) {
      return saveBlob(await (await fetch(url)).blob(), options)
    },
    saveDocument,
    createWritableFile,
    revealFile,
    droppedFiles,
    tileCache: createDesktopTileCache(() => import('@tauri-apps/plugin-fs')),
    projectLibrary: createProjectLibrary(createDesktopLibraryFiles(() => import('@tauri-apps/plugin-fs'))),
    guardClose(beforeClose) {
      // with this listener the window no longer closes on its own: Tauri calls it, then `destroy` unless prevented
      const listening = import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(async (event) => {
          if (!(await beforeClose().catch(() => true))) event.preventDefault()
        }),
      )
      return () => void listening.then((unlisten) => unlisten())
    },
    ...desktopUpdater(),
    async ask({ title, text, yes, no, cancel }) {
      const { message } = await import('@tauri-apps/plugin-dialog')
      const buttons = no === undefined ? { ok: yes, cancel } : { yes, no, cancel }
      const answer = await message(text, { title, kind: 'warning', buttons })
      return answer === yes ? 'yes' : answer === no ? 'no' : 'cancel'
    },
  }
}
