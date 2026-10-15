/**
 * Pure part of « Rechercher une mise à jour » (desktop only, the plugin calls are in desktop.ts): what a check can
 * answer, the state the « Réglages » section shows, and the mapping from the plugin's results and failures to them.
 */
import { errorMessage } from '../core/errors'

/** The update the release feed announces. */
export interface UpdateInfo {
  version: string
  /** publication date (RFC 3339) when the feed gives one */
  date: string | null
  /** release notes (Markdown text) when the feed gives them */
  notes: string | null
}

/**
 * Answer of `Platform.checkForUpdate`, which never throws. `unavailable`: the updater is not set up in this build (no
 * signing key was configured, `updater.conf.json` not merged); `offline`: the release feed could not be reached.
 */
export type UpdateCheck =
  | { status: 'unavailable' }
  | { status: 'offline' }
  | { status: 'current' }
  | { status: 'available'; update: UpdateInfo }
  | { status: 'error'; message: string }

/** What an update download has received so far; `totalBytes` is null when the server does not say. */
export interface UpdateProgress {
  downloadedBytes: number
  totalBytes: number | null
}

/** What the section shows: the answer of a check, or a step of the work in progress. */
export type UpdateState = { status: 'idle' } | { status: 'checking' } | { status: 'installing'; percent: number | null } | UpdateCheck

/** The result of the plugin's `check()`: null when the app is up to date. */
export function checkOutcome(update: { version: string; date?: string; body?: string } | null): UpdateCheck {
  if (!update) return { status: 'current' }
  return { status: 'available', update: { version: update.version, date: update.date ?? null, notes: update.body?.trim() || null } }
}

/** Tauri rejects a command of a plugin that is not registered with « plugin updater not found ». */
const NOT_REGISTERED = /plugin (updater|process) not found/i
/** What a failed request to the release feed looks like (reqwest messages, a refused or unresolved connection). */
const NETWORK = /error sending request|dns|connect|network|timed out|timeout|offline|unreachable/i

/** A rejected `check()`: the plugin is absent from this build, there is no network, or it failed. `online`: `navigator.onLine`. */
export function failedCheck(error: unknown, online: boolean): UpdateCheck {
  const text = error instanceof Error ? error.message : String(error)
  if (NOT_REGISTERED.test(text)) return { status: 'unavailable' }
  if (!online || NETWORK.test(text)) return { status: 'offline' }
  return { status: 'error', message: errorMessage(error) }
}

/** The events of the plugin's download (`downloadAndInstall`). */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

/** Progress after one event. */
export function downloadProgress(previous: UpdateProgress, event: DownloadEvent): UpdateProgress {
  switch (event.event) {
    case 'Started':
      return { downloadedBytes: 0, totalBytes: event.data.contentLength ?? null }
    case 'Progress':
      return { ...previous, downloadedBytes: previous.downloadedBytes + event.data.chunkLength }
    default:
      return previous.totalBytes === null ? previous : { ...previous, downloadedBytes: previous.totalBytes }
  }
}

/** 0 to 100, null while the total is unknown. */
export function percentOf({ downloadedBytes, totalBytes }: UpdateProgress): number | null {
  return totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null
}

/** Release notes on a few lines: blank lines dropped, cut at a word near `max` characters with « … ». */
export function shortNotes(notes: string, max = 300): string {
  const text = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`
}

/** « Installer et redémarrer » works once an update is found, and not during an export. */
export function canInstallUpdate(state: UpdateState, exporting: boolean): boolean {
  return state.status === 'available' && !exporting
}

/** « Rechercher une mise à jour » works except while a check or an installation runs. */
export function canCheckUpdate(state: UpdateState): boolean {
  return state.status !== 'checking' && state.status !== 'installing'
}
