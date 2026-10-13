/**
 * « Mes projets » on the app side: the list and the entry of the open project (`useLibraryStore`), keeping the open
 * project in the library, and its autosave a few seconds after each change (never during an export): a project with a
 * track gets its entry by itself, and the id of the open entry is remembered to reopen it at the next start. Storage is
 * the platform's `projectLibrary` (src/platform/projectLibrary.ts). Opening an entry goes through `openProject`.
 * Closing the window or tab writes the last change first, and asks when something would be lost (`installCloseGuard`);
 * closing the open project does the same (`projectCloseLoss`, `closeProject` in projectActions.ts).
 */
import { errorMessage } from '../core/errors'
import { create } from 'zustand'
import type { Track } from '../core/types'
import { useMediaStore } from '../film/media'
import { t } from '../i18n'
import { getPlatform } from '../platform'
import type { KeyValueStore, Platform, ProjectEntry, ProjectLibrary } from '../platform'
import { sortProjectEntries } from '../platform/projectLibrary'
import { projectFileName, serializeProjectBlob } from '../project/document'
import { useAppStore } from '../state/store'
import type { AppState } from '../state/store'
import { formatDistance, formatNumber } from './format'
import { effectiveProjectName, isProjectDirty } from './shell'
import type { SavedProject } from './shell'
import { showToast } from './toast'

/** Wait after the last change before saving the open entry. */
export const AUTOSAVE_DELAY_MS = 3000
/** `getPlatform().storage` key of the entry open when the app was last left */
export const LAST_PROJECT_KEY = 'openflyover.lastProject.v1'

/** "Tour du Mont-Blanc · 42,3 km", "… · 3 traces" when there are several; the track name only when the project has another. */
export function projectSummary(tracks: readonly Track[], projectName = ''): string {
  const first = tracks[0]
  if (!first) return t('project.library.noTrack')
  const distance = formatDistance(first.stats.distanceM)
  const summary = first.name === projectName ? distance : `${first.name} · ${distance}`
  return tracks.length > 1 ? t('project.library.summaryMany', { summary, count: tracks.length }) : summary
}

/** 12 300 -> "12 Ko", 4 500 000 -> "4,5 Mo". */
export function formatProjectSize(bytes: number): string {
  return bytes < 1e6 ? t('format.kilobytes', { value: formatNumber(Math.max(1, bytes / 1e3)) }) : t('format.megabytes', { value: formatNumber(bytes / 1e6, 1) })
}

export interface AutosaveOptions {
  delayMs: number
  /** false while a save must wait (export running): tried again after another delay */
  canSave(): boolean
  save(): Promise<void>
  /** first failure since the last success: one message, not one per attempt */
  onError(error: unknown): void
}

export interface Autosave {
  /** the project changed: save after `delayMs` without another change */
  changed(): void
  /** save now if a save is waiting, then resolve once no save is running */
  flush(): Promise<void>
  cancel(): void
}

export function createAutosave({ delayMs, canSave, save, onError }: AutosaveOptions): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** saves run one after the other */
  let queue: Promise<void> = Promise.resolve()
  let failing = false

  const attempt = async () => {
    try {
      await save()
      failing = false
    } catch (error) {
      if (!failing) onError(error)
      failing = true
    }
  }
  const run = (): Promise<void> => {
    timer = null
    if (!canSave()) {
      schedule()
      return queue
    }
    queue = queue.then(attempt)
    return queue
  }
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const schedule = () => {
    cancel()
    timer = setTimeout(() => void run(), delayMs)
  }

  return {
    changed: schedule,
    flush() {
      if (timer === null) return queue
      cancel()
      return run()
    },
    cancel,
  }
}

// ---------------------------------------------------------------------------
// Store and actions
// ---------------------------------------------------------------------------

interface LibraryState {
  /** most recent first */
  entries: ProjectEntry[]
  /** entry of the open project, null when it is not kept in « Mes projets » */
  currentId: string | null
}

export const useLibraryStore = create<LibraryState>()(() => ({ entries: [], currentId: null }))

/** settings, tracks and name of the open project at its last write to the library (compared by reference) */
let kept: SavedProject | null = null
/** counts the projects opened, so that a write finishing after another project was opened leaves it alone */
let openedCount = 0
/** the open project's entry was deleted: it gets no new one by itself (« Garder dans Mes projets » still can) */
let leftOut = false

const projectOf = (state: AppState): SavedProject => ({ settings: state.settings, tracks: state.tracks, name: state.projectName })

function putEntry(entry: ProjectEntry): void {
  const { entries } = useLibraryStore.getState()
  useLibraryStore.setState({ entries: sortProjectEntries([entry, ...entries.filter((e) => e.id !== entry.id)]) })
}

/** Thumbnail of the 3D view for the entry, undefined when it cannot be taken (the save goes on without it). */
async function viewThumbnail(): Promise<string | undefined> {
  try {
    // the scene's chunk: loaded already whenever there is a view to take
    const { captureThumbnail } = await import('../scene/thumbnail')
    return (await captureThumbnail()) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Write the open project to entry `id` (a new one when null), with a thumbnail of the view; it becomes the open entry
 * and the top bar shows it saved, unless another project was opened during the write.
 */
async function writeOpenProject(library: ProjectLibrary, id: string | null): Promise<ProjectEntry> {
  const state = useAppStore.getState()
  const snapshot: AppState['savedProject'] = { settings: state.settings, tracks: state.tracks, name: state.projectName }
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const text = serializeProjectBlob(state, name, useMediaStore.getState().table)
  const opened = openedCount
  const thumbnail = await viewThumbnail()
  const entry = await library.save(id, {
    name,
    summary: projectSummary(state.tracks, name),
    text,
    // the view of another project opened meanwhile is not this one's
    thumbnail: opened === openedCount ? thumbnail : undefined,
  })
  putEntry(entry)
  if (opened === openedCount) {
    // a change made during the write differs from `snapshot`: saved again by the autosave
    kept = snapshot
    useAppStore.setState({ savedProject: snapshot })
    useLibraryStore.setState({ currentId: entry.id })
  }
  return entry
}

/** The open project now is entry `id` (null: not kept); called by `openProject` once the project is applied. */
export function setOpenEntry(id: string | null): void {
  openedCount++
  leftOut = false
  kept = id === null ? null : projectOf(useAppStore.getState())
  useLibraryStore.setState({ currentId: id })
}

export async function refreshLibrary(): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library) return
  try {
    useLibraryStore.setState({ entries: await library.list() })
  } catch (err) {
    showToast({ kind: 'error', text: t('project.library.readFailed', { error: errorMessage(err) }) })
  }
}

/** true while « Garder dans Mes projets » writes: a second click would create a second entry */
let keeping = false

/** « Garder dans Mes projets »: a new entry for the open project, saved automatically from now on. */
export async function keepOpenProject(): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library || keeping) return
  keeping = true
  leftOut = false
  try {
    // the autosave may be writing the entry already
    await flushAutosave()
    const { currentId, entries } = useLibraryStore.getState()
    const entry = entries.find((e) => e.id === currentId) ?? (await writeOpenProject(library, null))
    showToast({ kind: 'success', text: t('project.library.kept', { name: entry.name }) })
  } catch (err) {
    showToast({ kind: 'error', text: t('project.library.keepFailed', { error: errorMessage(err) }) })
  } finally {
    keeping = false
  }
}

/** The document of `entry` as a file for `openProject`, null (with a toast) when it cannot be read. */
export async function libraryFile(entry: ProjectEntry): Promise<File | null> {
  const library = getPlatform().projectLibrary
  if (!library) return null
  try {
    return new File([await library.load(entry.id)], projectFileName(entry.name), { type: 'application/json' })
  } catch (err) {
    showToast({ kind: 'error', text: t('project.actions.openFailed', { fileName: entry.name, reason: errorMessage(err) }) })
    return null
  }
}

/** Rename an entry; the open one also takes the name in the top bar (its document follows at the autosave). */
export async function renameEntry(entry: ProjectEntry, name: string): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library) return
  try {
    const renamed = await library.rename(entry.id, name)
    putEntry(renamed)
    if (useLibraryStore.getState().currentId === entry.id) useAppStore.getState().setProjectName(renamed.name)
  } catch (err) {
    showToast({ kind: 'error', text: t('project.library.renameFailed', { name: entry.name, error: errorMessage(err) }) })
  }
}

/** Delete an entry; the open project stays open, no longer kept. */
export async function deleteEntry(entry: ProjectEntry): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library) return
  try {
    if (useLibraryStore.getState().currentId === entry.id) {
      // no longer kept first, then wait for a write in progress: it would bring the entry back after the removal
      setOpenEntry(null)
      leftOut = true
      await flushAutosave()
    }
    await library.remove(entry.id)
    useLibraryStore.setState({ entries: useLibraryStore.getState().entries.filter((e) => e.id !== entry.id) })
    showToast({ kind: 'success', text: t('project.library.removed', { name: entry.name }) })
  } catch (err) {
    showToast({ kind: 'error', text: t('project.library.deleteFailed', { name: entry.name, error: errorMessage(err) }) })
  }
}

let autosave: Autosave | null = null

/** Save a waiting change of the open entry now (before another project replaces it). */
export function flushAutosave(): Promise<void> {
  return autosave?.flush() ?? Promise.resolve()
}

/**
 * Whether the autosave writes `project`: its entry `id` when it changed since `written` (its last write), else a new
 * entry once it has a track, when `keepNew` (not left out of « Mes projets », no « Garder » writing it).
 */
export function autosaveWrites(project: SavedProject, id: string | null, written: SavedProject | null, keepNew: boolean): boolean {
  if (id !== null) return written !== null && isProjectDirty(project, written)
  return keepNew && project.tracks.length > 0
}

/** Remember the open entry for the next start (null: none). */
export function rememberOpenEntry(storage: KeyValueStore, id: string | null): void {
  if (id === null) storage.remove(LAST_PROJECT_KEY)
  else storage.set(LAST_PROJECT_KEY, id)
}

/** The entry open when the app was last left, and its document; null when there is none or it is gone. */
export async function lastOpenProject(
  platform: Pick<Platform, 'storage' | 'projectLibrary'> = getPlatform(),
): Promise<{ entry: ProjectEntry; file: File } | null> {
  const library = platform.projectLibrary
  const id = platform.storage.get(LAST_PROJECT_KEY)
  if (!library || id === null) return null
  try {
    const entry = (await library.list()).find((e) => e.id === id)
    if (!entry) {
      rememberOpenEntry(platform.storage, null)
      return null
    }
    return { entry, file: new File([await library.load(id)], projectFileName(entry.name), { type: 'application/json' }) }
  } catch (err) {
    // unreadable now: kept for the next start
    console.warn('[projets] dernier projet illisible :', errorMessage(err))
    return null
  }
}

/**
 * Keep the open project in « Mes projets » (its entry made once it has a track), saved a few seconds after each change
 * unless `canSave` says to wait; the open entry is remembered for the next start. Once, by `App`.
 */
export function installLibraryAutosave(canSave: () => boolean): () => void {
  const { projectLibrary: library, storage } = getPlatform()
  if (!library) return () => {}
  const saver = createAutosave({
    delayMs: AUTOSAVE_DELAY_MS,
    canSave,
    async save() {
      const id = useLibraryStore.getState().currentId
      if (autosaveWrites(projectOf(useAppStore.getState()), id, kept, !leftOut && !keeping)) await writeOpenProject(library, id)
    },
    onError: (err) => showToast({ kind: 'error', text: t('project.library.autosaveFailed', { error: errorMessage(err) }) }),
  })
  autosave = saver
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    const keptOrKeepable = useLibraryStore.getState().currentId !== null || state.tracks.length > 0
    if (keptOrKeepable && isProjectDirty(projectOf(state), projectOf(previous))) saver.changed()
  })
  const forget = useLibraryStore.subscribe((state, previous) => {
    if (state.currentId !== previous.currentId) rememberOpenEntry(storage, state.currentId)
  })
  return () => {
    unsubscribe()
    forget()
    saver.cancel()
    if (autosave === saver) autosave = null
  }
}

// ---------------------------------------------------------------------------
// Closing the window or tab
// ---------------------------------------------------------------------------

/** Longest wait for the last write when the desktop window closes: it closes anyway after that. */
export const CLOSE_FLUSH_TIMEOUT_MS = 4000

/** What closing now would lose: the film being exported, else changes not saved (« Modifié »); null when nothing. */
export type CloseLoss = 'export' | 'changes' | null

export function closeLoss({ exporting, dirty }: { exporting: boolean; dirty: boolean }): CloseLoss {
  return exporting ? 'export' : dirty ? 'changes' : null
}

/** Resolves once `promise` settles, or after `ms` at the latest. */
export function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, ms)
    promise.then(done, done)
  })
}

export interface CloseSteps {
  /** write the change waiting for the autosave */
  flush(): Promise<void>
  loss(): CloseLoss
  ask(loss: 'export' | 'changes'): Promise<'save' | 'close' | 'cancel'>
  /** « Enregistrer » (file) */
  save(): Promise<void>
}

/**
 * Desktop window asked to close: true to close it. The last change of a project kept in « Mes projets » is written
 * first (no question then); otherwise a question when something would be lost.
 */
export async function confirmClose(steps: CloseSteps, timeoutMs = CLOSE_FLUSH_TIMEOUT_MS): Promise<boolean> {
  await settleWithin(steps.flush(), timeoutMs)
  const loss = steps.loss()
  if (loss === null) return true
  const answer = await steps.ask(loss)
  if (answer !== 'save') return answer === 'close'
  await steps.save()
  // save dialog closed or write failed: still « Modifié », the window stays open
  return steps.loss() === null
}

const isOpenProjectDirty = () => {
  const state = useAppStore.getState()
  return isProjectDirty(projectOf(state), state.savedProject)
}

/**
 * What closing the open project (« Fermer le projet », « Nouveau projet ») would lose, once its waiting change is
 * written: its changes saved nowhere. A project emptied of its tracks loses nothing (its entry or file keeps them).
 */
export function projectCloseLoss(): CloseLoss {
  const dirty = useAppStore.getState().tracks.length > 0 && isOpenProjectDirty()
  return closeLoss({ exporting: false, dirty })
}

/** The question asked before closing the open project or the window when its changes would be lost. */
export function unsavedChangesText(): string {
  const state = useAppStore.getState()
  return t('project.library.unsaved', { name: effectiveProjectName(state.projectName, state.tracks[0]?.name) })
}

/** The question of the desktop window, answered with the step of `confirmClose`. */
async function askBeforeClose(ask: NonNullable<Platform['ask']>, loss: 'export' | 'changes'): Promise<'save' | 'close' | 'cancel'> {
  if (loss === 'export') {
    const answer = await ask({
      title: t('project.library.closeDuringExport'),
      text: t('project.library.exportLost'),
      yes: t('project.library.closeAnyway'),
      cancel: t('common.cancel'),
    })
    return answer === 'yes' ? 'close' : 'cancel'
  }
  const answer = await ask({
    title: t('project.library.closeQuestion'),
    text: unsavedChangesText(),
    yes: t('common.save'),
    no: t('project.library.closeNoSave'),
    cancel: t('common.cancel'),
  })
  return answer === 'yes' ? 'save' : answer === 'no' ? 'close' : 'cancel'
}

/**
 * Nothing lost on closing. Page hidden or left: the waiting change is written at once (web: not awaited, a Cache
 * Storage write started there usually ends, but nothing guarantees it). Web: the browser's « quitter le site ? »
 * (its own text) when something would be lost. Desktop: `confirmClose`. Once, by `App`.
 */
export function installCloseGuard(exporting: () => boolean, save: () => Promise<void>): () => void {
  const platform = getPlatform()
  const loss = () => closeLoss({ exporting: exporting(), dirty: isOpenProjectDirty() })
  const flush = () => void flushAutosave()
  const flushIfHidden = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    flush()
    if (loss() === null) return
    event.preventDefault()
    // older browsers ask only when it is set
    event.returnValue = true
  }
  const { ask } = platform
  const stopGuard =
    ask && platform.guardClose
      ? platform.guardClose(() => confirmClose({ flush: flushAutosave, loss, ask: (l) => askBeforeClose(ask, l), save }))
      : null
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', flushIfHidden)
  if (!stopGuard) window.addEventListener('beforeunload', onBeforeUnload)
  return () => {
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', flushIfHidden)
    window.removeEventListener('beforeunload', onBeforeUnload)
    stopGuard?.()
  }
}
