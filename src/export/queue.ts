/**
 * « File de rendus »: several projects rendered one after the other, without you in front of the screen. Each item keeps
 * the exact text of `serializeProject` taken when it was added (a later edit does not change its film), the formats
 * ticked in « Plusieurs formats » and its status. The queue is kept in the platform `storage` like the render history
 * (`parseQueue` never throws): a run cut short by closing the app comes back as « en attente », « interrompu », and starts
 * again from the first image (no resume inside a film). See ARCHITECTURE.md "Video export".
 *
 * Pure (tested): the stored form, `runQueue` (sequencing with an injected runner), `mergeQueue`. `runRenderQueue` drives
 * the app: it loads each snapshot the way « Ouvrir » does, renders its films through `exportJob` (batch.ts, one export at
 * a time, the view restored after each), then puts back the project that was open. The batch store is held « running »
 * for the whole run, so the rest of the app is as busy as during a batch (no autosave, no edit, the same cancel button).
 *
 * Desktop: the run goes on in a window of its own, « File de rendus » (renderWindow.ts), while the main window stays free
 * for editing. Each snapshot is a file of the app data folder (`queueSnapshots`, no size limit, read by that window), and
 * both windows keep the same queue through the shared storage (`installQueueSync`): the main window adds, removes and
 * reorders, the render window owns the status of what it renders and writes its progress (`percent`).
 */
import { create } from 'zustand'
import { errorMessage } from '../core/errors'
import { isRecord } from '../core/guards'
import { useMediaStore } from '../film/media'
import { t } from '../i18n'
import { getPlatform } from '../platform'
import type { Capabilities } from '../platform/platform'
import { pickFolder, reuseFolder } from '../platform/folder'
import { createDesktopLibraryFiles } from '../platform/projectLibrary'
import type { WritableFolder } from '../platform/folder'
import { applyProject } from '../project/apply'
import { parseProject, serializeProject } from '../project/document'
import { getSettingsHistory } from '../project/history'
import { useRenderElsewhere } from '../scene/previewQuality'
import { useAppStore } from '../state/store'
import { effectiveProjectName } from '../ui/shell'
import { startPoster } from '../poster/export'
import { showToast } from '../ui/toast'
import { buildBatchJobs, exportJob, runBatch, trackOutcome, useBatchStore } from './batch'
import type { BatchSelection } from './batch'
import { containerFor } from './nativeEncoder'
import { videoEncoding } from './schedule'
import { isExportBusy, useExportStore } from './store'
import type { ExportResult } from './store'
import { loadTrackData, shownFilm } from './trackFilms'

export const QUEUE_KEY = 'openflyover.renderQueue.v1'
const QUEUE_VERSION = 1
/** items still to render (the finished and failed ones stay listed without counting), and items listed in all */
export const MAX_QUEUE_ITEMS = 20
export const MAX_LISTED_ITEMS = 100
/** longest snapshot kept after the app is closed (characters of JSON), and all of them together: the storage holds ~5 MB */
export const MAX_SNAPSHOT_CHARS = 1_000_000
export const MAX_STORED_CHARS = 3_000_000

export type QueueStatus = 'pending' | 'running' | 'done' | 'error'

export interface QueueItem {
  id: string
  /** name of the project, also the start of its file names */
  name: string
  /** `formatKey`s of its films ('16:9@1080p'); may be empty when only the still image or the poster is queued */
  formats: string[]
  /** the still image of the project is queued too (at `progress`, in the format of « Vidéo ») */
  still?: boolean
  /** the poster is queued too */
  poster?: boolean
  /** playback position when the project was added (not part of the project): where the still image and the poster look */
  progress?: number
  status: QueueStatus
  /** why it failed */
  error?: string
  /** exact text of `serializeProject`; null once rendered, or when it was too big to be kept after closing the app */
  snapshot: string | null
  /** back to « en attente » after the app was closed while it ran */
  interrupted?: boolean
  /** files written (or downloaded) */
  files?: string[]
  /** film being rendered (1-based), while it runs */
  step?: number
  /** part of that film done (0..1), while it runs in the render window */
  percent?: number
  /** desktop: the snapshot is a file of the app data folder (`queueSnapshots`), `snapshot` only a copy in memory */
  stored?: boolean
}

// ---------------------------------------------------------------------------
// Stored form
// ---------------------------------------------------------------------------

/**
 * The text kept in the storage. A snapshot is kept only for an item still to render, if it is under
 * `MAX_SNAPSHOT_CHARS` and the ones before it leave room under `MAX_STORED_CHARS`: the others come back as failed
 * (`parseQueue`), to be added again.
 */
export function serialiseQueue(items: readonly QueueItem[]): string {
  let room = MAX_STORED_CHARS
  const list = items.slice(0, MAX_LISTED_ITEMS).map(({ id, name, formats, still, poster, progress, status, error, snapshot, interrupted, files, stored, step, percent }) => {
    const waiting = status === 'pending' || status === 'running'
    // a snapshot in a file is not copied into the storage
    const keep = waiting && !stored && snapshot !== null && snapshot.length <= Math.min(MAX_SNAPSHOT_CHARS, room)
    if (keep) room -= snapshot.length
    const running = status === 'running' ? { step, percent } : {}
    return { id, name, formats, still, poster, progress, status, error, interrupted, files, stored, ...running, snapshot: keep ? snapshot : null }
  })
  return JSON.stringify({ v: QUEUE_VERSION, items: list })
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

function parseItem(raw: unknown, live: boolean): QueueItem | null {
  if (!isRecord(raw)) return null
  const { id, name, formats, still, poster, progress, status, error, snapshot, interrupted, files, stored, step, percent } = raw
  if (typeof id !== 'string' || typeof name !== 'string' || !isStrings(formats)) return null
  if (status !== 'pending' && status !== 'running' && status !== 'done' && status !== 'error') return null
  const head = {
    id,
    name,
    formats,
    snapshot: typeof snapshot === 'string' ? snapshot : null,
    ...(still === true ? { still } : {}),
    ...(poster === true ? { poster } : {}),
    ...(typeof progress === 'number' && progress >= 0 && progress <= 1 ? { progress } : {}),
    ...(stored === true ? { stored } : {}),
  }
  if (status === 'done') return { ...head, status, ...(isStrings(files) ? { files } : {}) }
  if (status === 'error') return { ...head, status, ...(typeof error === 'string' ? { error } : {}) }
  // read by the other window while the render window runs it
  if (live && status === 'running')
    return {
      ...head,
      status,
      ...(typeof step === 'number' ? { step } : {}),
      ...(typeof percent === 'number' && percent >= 0 && percent <= 1 ? { percent } : {}),
    }
  if (head.snapshot === null && !head.stored) return { ...head, status: 'error', error: t('export.queue.tooBig') }
  // a run cut short: the film starts again from its first image
  return { ...head, status: 'pending', ...(status === 'running' || interrupted === true ? { interrupted: true } : {}) }
}

/**
 * The queue stored in `raw`; empty when there is none or it is damaged. A render interrupted comes back « en attente »;
 * `live`: read while the render window may be running it, a render going on stays « en cours ».
 */
export function parseQueue(raw: string | null | undefined, live = false): QueueItem[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.v !== QUEUE_VERSION || !Array.isArray(data.items)) return []
    const seen = new Set<string>()
    const items: QueueItem[] = []
    for (const raw of data.items) {
      const item = parseItem(raw, live)
      if (item && !seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
    }
    return items.slice(0, MAX_LISTED_ITEMS)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Sequencing
// ---------------------------------------------------------------------------

export type ItemOutcome = { status: 'done'; files: string[] } | { status: 'error'; error: string } | { status: 'canceled' }

export interface QueueRunner {
  /** the queue now: an item removed or added during the run is taken into account */
  items(): readonly QueueItem[]
  patch(id: string, patch: Partial<QueueItem>): void
  /** render one item; a throw counts as its failure */
  run(item: QueueItem): Promise<ItemOutcome>
  canceled(): boolean
}

/**
 * Render the items still « en attente » one after the other, in order. A failed item is marked and the run goes on; a
 * cancel (during an item or between two) stops the run and puts the item running back to « en attente ».
 */
export async function runQueue(runner: QueueRunner): Promise<void> {
  for (;;) {
    if (runner.canceled()) return
    const item = runner.items().find((i) => i.status === 'pending')
    if (!item) return
    runner.patch(item.id, { status: 'running', error: undefined, interrupted: undefined, step: undefined })
    let outcome: ItemOutcome
    try {
      outcome = await runner.run(item)
    } catch (error) {
      outcome = { status: 'error', error: errorMessage(error) }
    }
    if (outcome.status === 'canceled') return runner.patch(item.id, { status: 'pending', step: undefined })
    runner.patch(item.id, { ...outcome, snapshot: null, step: undefined })
  }
}

/** Films, still image and poster of an item: its jobs (`buildBatchJobs`). */
export const jobCount = (item: Pick<QueueItem, 'formats' | 'still' | 'poster'>): number =>
  item.formats.length + (item.still ? 1 : 0) + (item.poster ? 1 : 0)

/** Index of the nearest « en attente » item before (`-1`) or after (`1`) the one at `index`, or -1. */
function neighbour(items: readonly QueueItem[], index: number, direction: -1 | 1): number {
  for (let i = index + direction; i >= 0 && i < items.length; i += direction) if (items[i].status === 'pending') return i
  return -1
}

/** True when the item `id` is « en attente » and has another one waiting before (`-1`) or after (`1`) it. */
export function canMove(items: readonly QueueItem[], id: string, direction: -1 | 1): boolean {
  const index = items.findIndex((i) => i.id === id)
  return index >= 0 && items[index].status === 'pending' && neighbour(items, index, direction) >= 0
}

/** The items with `id` swapped with the nearest « en attente » item before or after it (the rendered ones stay in place); the same array when it cannot move. */
export function moveItem(items: readonly QueueItem[], id: string, direction: -1 | 1): readonly QueueItem[] {
  if (!canMove(items, id, direction)) return items
  const from = items.findIndex((i) => i.id === id)
  const to = neighbour(items, from, direction)
  const moved = [...items]
  moved[from] = items[to]
  moved[to] = items[from]
  return moved
}

/**
 * The queue of this window once the other one wrote `remote` (render window: `rendering`). The main window takes it as
 * it is, keeping the snapshots it holds in memory. The render window keeps the status of the items it rendered or
 * renders (the other window may still list them « en attente ») and takes the rest: items added, removed, reordered.
 */
export function mergeQueue(local: readonly QueueItem[], remote: readonly QueueItem[], rendering: boolean): QueueItem[] {
  const mine = new Map(local.map((i) => [i.id, i]))
  if (!rendering) return remote.map((i) => (i.snapshot === null && mine.get(i.id)?.snapshot ? { ...i, snapshot: mine.get(i.id)!.snapshot } : i))
  const owned = (i: QueueItem | undefined) => i !== undefined && i.status !== 'pending'
  const merged = remote.map((i) => (owned(mine.get(i.id)) ? mine.get(i.id)! : i))
  // never drop the item being rendered
  const running = local.filter((i) => i.status === 'running' && !remote.some((r) => r.id === i.id))
  return [...merged, ...running]
}

// ---------------------------------------------------------------------------
// Snapshots in files (desktop)
// ---------------------------------------------------------------------------

/** Snapshots of the queue as files, by item id. */
export interface QueueSnapshots {
  write(id: string, text: string): Promise<void>
  /** null when it is not there */
  read(id: string): Promise<string | null>
  remove(id: string): Promise<void>
}

const snapshotName = (id: string) => `queue-${id.replace(/[^a-z0-9-]/gi, '')}.snapshot.json`

/** Desktop: `<app data>/projects/queue-<id>.snapshot.json` (beside « Mes projets », whose list reads only its entries). */
export function createQueueSnapshots(files = createDesktopLibraryFiles(() => import('@tauri-apps/plugin-fs'))): QueueSnapshots {
  return {
    write: (id, text) => files.write(snapshotName(id), text),
    read: async (id) => (await (await files.read(snapshotName(id)))?.text()) ?? null,
    remove: (id) => files.remove(snapshotName(id)),
  }
}

let snapshots: QueueSnapshots | null = null
const queueSnapshots = (): QueueSnapshots | null => (getPlatform().capabilities.isDesktop ? (snapshots ??= createQueueSnapshots()) : null)
/** snapshot writes not finished yet: the render window must not start before them */
const writing = new Set<Promise<unknown>>()

/** Once every snapshot added so far is written. */
export async function snapshotsWritten(): Promise<void> {
  await Promise.all([...writing])
}

function forgetSnapshot(item: QueueItem): void {
  if (item.stored) void queueSnapshots()?.remove(item.id).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function read(): QueueItem[] {
  try {
    return parseQueue(getPlatform().storage.get(QUEUE_KEY))
  } catch {
    return []
  }
}

function write(items: readonly QueueItem[]): void {
  try {
    if (items.length === 0) getPlatform().storage.remove(QUEUE_KEY)
    else getPlatform().storage.set(QUEUE_KEY, serialiseQueue(items))
  } catch {
    // storage unavailable: the queue stays in memory for this session
  }
}

export interface QueueState {
  items: QueueItem[]
  /** a run is going on in this window (between two items too) */
  running: boolean
  /** false when the queue is full */
  add(item: QueueItem): boolean
  /** an item that is not running */
  remove(id: string): void
  /** an item « en attente » one place earlier (-1) or later (1) among those waiting */
  move(id: string, direction: -1 | 1): void
  patch(id: string, patch: Partial<QueueItem>): void
}

export const useQueueStore = create<QueueState>()((set, get) => ({
  items: read(),
  running: false,
  add(item) {
    // only the items still to render count: finished and failed ones stay listed, the oldest go past `MAX_LISTED_ITEMS`
    const items = get().items
    if (items.filter((i) => i.status === 'pending' || i.status === 'running').length >= MAX_QUEUE_ITEMS) return false
    const finished = items.filter((i) => i.status === 'done' || i.status === 'error')
    const dropped = new Set(finished.slice(0, Math.max(0, items.length + 1 - MAX_LISTED_ITEMS)))
    set({ items: [...items.filter((i) => !dropped.has(i)), item] })
    return true
  },
  remove(id) {
    const gone = get().items.find((i) => i.id === id && i.status !== 'running')
    if (gone) forgetSnapshot(gone)
    set({ items: get().items.filter((i) => i.id !== id || i.status === 'running') })
  },
  move(id, direction) {
    const items = get().items
    const moved = moveItem(items, id, direction)
    if (moved !== items) set({ items: [...moved] })
  },
  patch(id, patch) {
    set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
  },
}))

/** the items came from the other window: not written back */
let fromOtherWindow = false

useQueueStore.subscribe((state, previous) => {
  if (state.items !== previous.items && !fromOtherWindow) write(state.items)
})

/** Storage key the main window sets to stop the run of the render window. */
export const QUEUE_CANCEL_KEY = 'openflyover.renderQueue.cancel'
/** Storage key the render window sets at the end of its run: the message, shown in the main window. */
export const QUEUE_DONE_KEY = 'openflyover.renderQueue.done'

/**
 * Desktop: keep the queue of this window in step with the other one through the shared storage (`storage` events come
 * from the other windows only). `rendering`: this is the render window (it also stops its run when asked). Once, at start.
 */
export function installQueueSync(rendering: boolean, scope: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === QUEUE_KEY) {
      const items = mergeQueue(useQueueStore.getState().items, parseQueue(event.newValue, true), rendering)
      fromOtherWindow = true
      try {
        useQueueStore.setState({ items })
      } finally {
        fromOtherWindow = false
      }
      if (!rendering) useRenderElsewhere.setState({ active: items.some((i) => i.status === 'running') })
    } else if (event.key === QUEUE_CANCEL_KEY && rendering && event.newValue !== null) useBatchStore.getState().cancel()
    else if (event.key === QUEUE_DONE_KEY && !rendering && event.newValue) {
      const { text, kind } = JSON.parse(event.newValue) as { text: string; kind: 'success' | 'error' | 'info' }
      showToast({ kind, text })
    }
  }
  scope.addEventListener('storage', onStorage)
  return () => scope.removeEventListener('storage', onStorage)
}

/** Main window: ask the render window to stop its run. */
export function cancelRenderWindow(): void {
  getPlatform().storage.set(QUEUE_CANCEL_KEY, String(Date.now()))
}

/** « 16:9@1080p » -> « 16:9 1080p » */
export const formatLabel = (key: string): string => key.replace('@', ' ')

/** The open project, as it is now, added to the queue with the films, still image and poster of `selection`; its name, or null when the queue is full. */
export function addOpenProject(selection: BatchSelection): string | null {
  const state = useAppStore.getState()
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const id = crypto.randomUUID()
  const snapshot = serializeProject(state, name, useMediaStore.getState().table)
  const files = queueSnapshots()
  const added = useQueueStore.getState().add({
    id,
    name,
    formats: [...selection.formats],
    ...(selection.still ? { still: true } : {}),
    ...(selection.poster ? { poster: true } : {}),
    ...(selection.still || selection.poster ? { progress: state.playback.progress } : {}),
    status: 'pending',
    snapshot,
    ...(files ? { stored: true } : {}),
  })
  if (added && files) {
    const written = files.write(id, snapshot).catch((error: unknown) => {
      // kept in memory: rendered in this window only
      console.warn('[file de rendus] copie du projet impossible à écrire :', errorMessage(error))
      useQueueStore.getState().patch(id, { stored: undefined })
    })
    writing.add(written)
    void written.finally(() => writing.delete(written))
  }
  return added ? name : null
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** Desktop: the folder of the last queue, kept for the next « Lancer la file » (the web cannot keep a handle). */
export const QUEUE_FOLDER_KEY = 'openflyover.renderQueue.folder'

export interface QueueFolderDeps {
  get(key: string): string | null
  set(key: string, value: string): unknown
  exists(dir: string): Promise<boolean>
  pick(startIn?: string): Promise<WritableFolder | null>
}

/**
 * The folder for the films of a run. Web: asked each time (call it from the click, before any await). Desktop: the folder
 * of the last run, when it is still there and the app may write in it; else asked again (the dialog opens in the old
 * one) and remembered. Null: the dialog was closed, nothing starts.
 */
export async function chooseQueueFolder(
  capabilities: Pick<Capabilities, 'isDesktop'>,
  deps: QueueFolderDeps = {
    get: (key) => getPlatform().storage.get(key),
    set: (key, value) => getPlatform().storage.set(key, value),
    exists: async (dir) => (await import('@tauri-apps/plugin-fs')).exists(dir),
    pick: (startIn) => pickFolder(capabilities, globalThis, startIn),
  },
): Promise<WritableFolder | null> {
  if (!capabilities.isDesktop) return deps.pick()
  const remembered = deps.get(QUEUE_FOLDER_KEY)
  const kept = await reuseFolder(remembered, deps.exists)
  if (kept) return kept
  const picked = await deps.pick(remembered ?? undefined)
  if (picked?.path) deps.set(QUEUE_FOLDER_KEY, picked.path)
  return picked
}

/** What the app shows, to put it back after the run: the project open, its pictures, its place in the library are untouched. */
function keepOpenProject(): () => void {
  const s = useAppStore.getState()
  const kept = {
    tracks: s.tracks,
    bounds: s.bounds,
    frameOrigin: s.frameOrigin,
    settings: s.settings,
    playback: s.playback,
    projectName: s.projectName,
    projectFile: s.projectFile,
    savedProject: s.savedProject,
    filmSelection: s.filmSelection,
    filmKeys: s.filmKeys,
    workArea: s.workArea,
  }
  const media = useMediaStore.getState().table
  return () => {
    useMediaStore.getState().replace(media)
    useAppStore.setState(kept)
    useAppStore.getState().requestFit()
  }
}

export interface QueueRunOptions {
  /** receives every film; null: each film is handed to `save` (download) */
  folder: WritableFolder | null
  save(result: ExportResult): void
  /** render window: the part of the film done is written to the item (`percent`) for the main window */
  sharesProgress?: boolean
}

/** Shortest time between two writes of `percent` (the whole queue goes to the storage each time). */
export const PERCENT_EVERY_MS = 1000

/** Replace the project shown by the snapshot of an item (as « Ouvrir » does, without the toast); throws when it cannot be read. */
function showSnapshot(text: string): void {
  const project = parseProject(text)
  applyProject(project)
  useAppStore.getState().setProjectName(project.name)
}

async function renderItem(item: QueueItem, { folder, save }: QueueRunOptions, canceled: () => boolean): Promise<ItemOutcome> {
  const snapshot = item.snapshot ?? (item.stored ? await queueSnapshots()?.read(item.id) : null)
  if (!snapshot) return { status: 'error', error: t('export.queue.tooBig') }
  showSnapshot(snapshot)
  await loadTrackData(canceled)
  const { video } = useAppStore.getState().settings
  const jobs = buildBatchJobs({ formats: item.formats, still: item.still === true, poster: item.poster === true }, video)
  if (jobs.length === 0) return { status: 'error', error: t('export.queue.noFilm') }
  const ctx = {
    projectName: item.name,
    film: shownFilm(),
    still: { progress: item.progress ?? 0, type: 'image/png' as const },
    folder,
    containerOf: containerFor({ ...video, encoding: videoEncoding(video) }),
    // the poster looks where the project was when it was added
    startPoster: () => {
      useAppStore.getState().setProgress(item.progress ?? 0)
      return startPoster()
    },
    save,
    canceled,
  }
  const films = await runBatch(jobs, {
    run: (job) => {
      // the format ticked for the queue overrides the project's: it is shown at that format (the frame, the overlay's
      // reference size, the cards), as if the project had been made in it; the poster keeps the project's own
      const { settings, setSetting } = useAppStore.getState()
      setSetting('video', job.kind === 'poster' ? video : { ...settings.video, aspect: job.aspect, resolution: job.resolution })
      return exportJob(job, ctx)
    },
    canceled,
    report: (list) => useQueueStore.getState().patch(item.id, { step: Math.max(1, list.findIndex((f) => f.status === 'running') + 1) }),
  })
  const outcome = trackOutcome(films)
  if (outcome.status === 'canceled') return { status: 'canceled' }
  if (outcome.status === 'error') return { status: 'error', error: outcome.error ?? t('export.batch.failed') }
  return { status: 'done', files: films.flatMap((f) => (f.result ? [f.result.fileName] : [])) }
}

/** « Lancer la file »: render the items « en attente », then put back the project that was open. Resolves once the run is over (false when it could not start: the app is busy). */
export async function runRenderQueue(options: QueueRunOptions): Promise<boolean> {
  const batch = useBatchStore.getState()
  if (batch.phase === 'running' || isExportBusy(useExportStore.getState().phase)) return false
  const started = useQueueStore.getState().items.filter((i) => i.status === 'pending').map((i) => i.id)
  if (started.length === 0) return false
  const putBack = keepOpenProject()
  // nothing recorded in the undo history while the queue's projects are shown
  const resume = getSettingsHistory().suspend()
  batch.hold(options.folder?.name ?? null)
  useQueueStore.setState({ running: true })
  const canceled = () => useBatchStore.getState().cancelRequested
  let lastPercent = 0
  const stopPercent = options.sharesProgress
    ? useExportStore.subscribe(({ frame, frameCount }) => {
        const item = useQueueStore.getState().items.find((i) => i.status === 'running')
        if (!item || frameCount <= 0 || Date.now() - lastPercent < PERCENT_EVERY_MS) return
        lastPercent = Date.now()
        useQueueStore.getState().patch(item.id, { percent: frame / frameCount })
      })
    : () => {}
  try {
    await runQueue({
      items: () => useQueueStore.getState().items,
      patch: (id, patch) => useQueueStore.getState().patch(id, patch),
      run: async (item) => {
        const outcome = await renderItem(item, options, canceled)
        if (outcome.status !== 'canceled') forgetSnapshot(item)
        return outcome
      },
      canceled,
    })
  } finally {
    stopPercent()
    putBack()
    resume()
    useQueueStore.setState({ running: false })
    useBatchStore.getState().release()
  }
  announceQueue(started)
  return true
}

/** Message at the end of a run (the items of this run only), and a system notification when the window is not in front. */
function announceQueue(ids: readonly string[]): void {
  const items = useQueueStore.getState().items.filter((i) => ids.includes(i.id))
  const count = (status: QueueStatus) => items.filter((i) => i.status === status).length
  const [done, failed, left] = [count('done'), count('error'), count('pending')]
  const text =
    left > 0
      ? t('export.queue.stopped', { done, left })
      : failed > 0
        ? t('export.queue.failedSome', { done, failed })
        : t('export.queue.finished')
  const kind = failed > 0 ? 'error' : left > 0 ? 'info' : 'success'
  showToast({ kind, text })
  notifyWhenAway(text)
  // render window: the main window says it too
  try {
    getPlatform().storage.set(QUEUE_DONE_KEY, JSON.stringify({ text, kind, at: Date.now() }))
  } catch {
    // storage unavailable: the message stays in this window
  }
}

// ---------------------------------------------------------------------------
// System notification (web only: the desktop app has no notification plugin)
// ---------------------------------------------------------------------------

type NotificationScope = { Notification?: typeof Notification; document?: Pick<Document, 'hasFocus' | 'visibilityState'> }

/** Ask the browser's permission to notify, when the user starts a queue (a click is needed); nothing on the desktop. */
export function askNotificationPermission(scope: NotificationScope = globalThis): void {
  if (getPlatform().capabilities.isDesktop) return
  try {
    if (scope.Notification?.permission === 'default') void scope.Notification.requestPermission().catch(() => undefined)
  } catch {
    // no notification: the toast is all there is
  }
}

/** A notification when the window is hidden or not in focus and the user allowed it. */
export function notifyWhenAway(body: string, scope: NotificationScope = globalThis): void {
  if (getPlatform().capabilities.isDesktop) return
  const doc = scope.document
  if (doc && doc.visibilityState === 'visible' && doc.hasFocus()) return
  try {
    if (scope.Notification?.permission === 'granted') new scope.Notification('OpenFlyover', { body })
  } catch {
    // some browsers only notify through a service worker: the toast is all there is
  }
}
