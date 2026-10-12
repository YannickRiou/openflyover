/**
 * Desktop: project files the system asks the app to open (double-click on a `.opnflvr`, « Ouvrir avec… », a file given
 * on the command line; on macOS also while the app runs). The Rust side (src-tauri/src/opened.rs) adds each path to the
 * fs scope and queues it; `takeOpenedFiles` drains the queue (once at start-up, then each time the event
 * `OPENED_FILES_EVENT` says the system sent more) and reads the files, which remember their path (`fileTargetOf`), so
 * « Enregistrer » writes them again in place. Nothing happens on the website.
 */
import { errorMessage } from '../core/errors'
import { readPathsAsFiles } from './desktop'
import { fileNameOf, isTauriRuntime } from './platform'

/** Event emitted by the Rust side when paths were queued while the app runs. */
export const OPENED_FILES_EVENT = 'openflyover://opened-files'

export interface OpenedFilesBridge {
  /** paths queued by the system since the last call */
  take(): Promise<string[]>
  /** `listener` is called on each `OPENED_FILES_EVENT`; the returned function stops it */
  listen(listener: () => void): Promise<() => void>
  read(path: string): Promise<File>
}

const tauriBridge: OpenedFilesBridge = {
  async take() {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<string[]>('opened_files')) ?? []
  },
  async listen(listener) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen(OPENED_FILES_EVENT, listener)
  },
  read: async (path) => (await readPathsAsFiles([path]))[0],
}

/**
 * The files the system asked the app to open since the last call. A file that cannot be read is left out and
 * reported to `fail` with its name and the reason.
 */
export async function takeOpenedFiles(
  fail: (fileName: string, reason: string) => void,
  bridge: OpenedFilesBridge = tauriBridge,
  scope: object = globalThis,
): Promise<File[]> {
  if (!isTauriRuntime(scope)) return []
  let paths: string[]
  try {
    paths = await bridge.take()
  } catch {
    // an app built without the command: nothing was handed over
    return []
  }
  const files: File[] = []
  for (const path of paths) {
    try {
      files.push(await bridge.read(path))
    } catch (error) {
      fail(fileNameOf(path), errorMessage(error))
    }
  }
  return files
}

/** Call `onFiles` with the files the system hands over while the app runs; returns the function that stops listening. */
export function watchOpenedFiles(
  onFiles: (files: File[]) => void,
  fail: (fileName: string, reason: string) => void,
  bridge: OpenedFilesBridge = tauriBridge,
  scope: object = globalThis,
): () => void {
  if (!isTauriRuntime(scope)) return () => undefined
  const listening = bridge
    .listen(() => {
      void takeOpenedFiles(fail, bridge, scope).then((files) => {
        if (files.length > 0) onFiles(files)
      })
    })
    .catch(() => () => undefined)
  return () => void listening.then((stop) => stop())
}
