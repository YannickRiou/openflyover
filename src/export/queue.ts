/**
 * « File de rendus »: several projects rendered one after the other, without you in front of the screen. Each item keeps
 * the exact text of `serializeProject` taken when it was added (a later edit does not change its film), the formats
 * ticked in « Plusieurs formats » and its status. The queue is kept in the platform `storage` like the render history
 * (`parseQueue` never throws): a run cut short by closing the app comes back as « en attente », « interrompu », and starts
 * again from the first image (no resume inside a film). See ARCHITECTURE.md "Video export".
 *
 * Pure (tested): the stored form, `runQueue` (sequencing with an injected runner). `runRenderQueue` drives the app: it
 * loads each snapshot the way « Ouvrir » does, renders its films through `exportJob` (batch.ts, one export at a time, the
 * view restored after each), then puts back the project that was open. The batch store is held « running » for the whole
 * run, so the rest of the app is as busy as during a batch (no autosave, no edit, the same cancel button).
 */
import { create } from 'zustand'
import { errorMessage } from '../core/errors'
import { isRecord } from '../core/guards'
import { useMediaStore } from '../film/media'
import { t } from '../i18n'
import { getPlatform } from '../platform'
import type { WritableFolder } from '../platform/folder'
import { applyProject } from '../project/apply'
import { parseProject, serializeProject } from '../project/document'
import { getSettingsHistory } from '../project/history'
import { imageryChoiceKept, keepImageryChoice, useAppStore } from '../state/store'
import { effectiveProjectName } from '../ui/shell'
import { showToast } from '../ui/toast'
import { buildBatchJobs, exportJob, runBatch, trackOutcome, useBatchStore } from './batch'
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
  /** `formatKey`s of its films ('16:9@1080p') */
  formats: string[]
  status: QueueStatus
  /** why it failed */
  error?: string
  /** exact text of `serializeProject`; null once rendered, or when it was too big to be kept after closing the app */
  snapshot: string | null
  /** back to « en attente » after the app was closed while it ran */
  interrupted?: boolean
  /** files written (or downloaded) */
  files?: string[]
  /** film being rendered (1-based), while it runs; not kept */
  step?: number
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
  const stored = items.slice(0, MAX_LISTED_ITEMS).map(({ id, name, formats, status, error, snapshot, interrupted, files }) => {
    const waiting = status === 'pending' || status === 'running'
    const keep = waiting && snapshot !== null && snapshot.length <= Math.min(MAX_SNAPSHOT_CHARS, room)
    if (keep) room -= snapshot.length
    return { id, name, formats, status, error, interrupted, files, snapshot: keep ? snapshot : null }
  })
  return JSON.stringify({ v: QUEUE_VERSION, items: stored })
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

function parseItem(raw: unknown): QueueItem | null {
  if (!isRecord(raw)) return null
  const { id, name, formats, status, error, snapshot, interrupted, files } = raw
  if (typeof id !== 'string' || typeof name !== 'string' || !isStrings(formats)) return null
  if (status !== 'pending' && status !== 'running' && status !== 'done' && status !== 'error') return null
  const head = { id, name, formats, snapshot: typeof snapshot === 'string' ? snapshot : null }
  if (status === 'done') return { ...head, status, ...(isStrings(files) ? { files } : {}) }
  if (status === 'error') return { ...head, status, ...(typeof error === 'string' ? { error } : {}) }
  if (head.snapshot === null) return { ...head, status: 'error', error: t('export.queue.tooBig') }
  // a run cut short: the film starts again from its first image
  return { ...head, status: 'pending', ...(status === 'running' || interrupted === true ? { interrupted: true } : {}) }
}

/** The queue stored in `raw`; empty when there is none or it is damaged. A render interrupted comes back « en attente ». */
export function parseQueue(raw: string | null | undefined): QueueItem[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!isRecord(data) || data.v !== QUEUE_VERSION || !Array.isArray(data.items)) return []
    const seen = new Set<string>()
    const items: QueueItem[] = []
    for (const raw of data.items) {
      const item = parseItem(raw)
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
  /** a run is going on (between two items too) */
  running: boolean
  /** false when the queue is full */
  add(item: QueueItem): boolean
  /** an item that is not running */
  remove(id: string): void
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
    set({ items: get().items.filter((i) => i.id !== id || i.status === 'running') })
  },
  patch(id, patch) {
    set({ items: get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })
  },
}))

useQueueStore.subscribe((state, previous) => {
  if (state.items !== previous.items) write(state.items)
})

/** « 16:9@1080p » -> « 16:9 1080p » */
export const formatLabel = (key: string): string => key.replace('@', ' ')

/** The open project, as it is now, added to the queue with the films `formats`; its name, or null when the queue is full. */
export function addOpenProject(formats: readonly string[]): string | null {
  const state = useAppStore.getState()
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const added = useQueueStore.getState().add({
    id: crypto.randomUUID(),
    name,
    formats: [...formats],
    status: 'pending',
    snapshot: serializeProject(state, name, useMediaStore.getState().table),
  })
  return added ? name : null
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

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
  // the queued projects set their imagery source through `setSetting`, which would count as the user's choice
  const imageryChosen = imageryChoiceKept()
  return () => {
    keepImageryChoice(imageryChosen)
    useMediaStore.getState().replace(media)
    useAppStore.setState(kept)
    useAppStore.getState().requestFit()
  }
}

export interface QueueRunOptions {
  /** receives every film; null: each film is handed to `save` (download) */
  folder: WritableFolder | null
  save(result: ExportResult): void
}

/** Replace the project shown by the snapshot of an item (as « Ouvrir » does, without the toast); throws when it cannot be read. */
function showSnapshot(text: string): void {
  const project = parseProject(text)
  applyProject(project)
  useAppStore.getState().setProjectName(project.name)
}

async function renderItem(item: QueueItem, { folder, save }: QueueRunOptions, canceled: () => boolean): Promise<ItemOutcome> {
  if (item.snapshot === null) return { status: 'error', error: t('export.queue.tooBig') }
  showSnapshot(item.snapshot)
  await loadTrackData(canceled)
  const { video } = useAppStore.getState().settings
  const jobs = buildBatchJobs({ formats: item.formats, still: false, poster: false }, video)
  if (jobs.length === 0) return { status: 'error', error: t('export.queue.noFilm') }
  const ctx = {
    projectName: item.name,
    film: shownFilm(),
    still: { progress: 0, type: 'image/png' as const },
    folder,
    containerOf: containerFor({ ...video, encoding: videoEncoding(video) }),
    startPoster: async () => false,
    save,
    canceled,
  }
  const films = await runBatch(jobs, {
    run: (job) => exportJob(job, ctx),
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
  try {
    await runQueue({
      items: () => useQueueStore.getState().items,
      patch: (id, patch) => useQueueStore.getState().patch(id, patch),
      run: (item) => renderItem(item, options, canceled),
      canceled,
    })
  } finally {
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
  showToast({ kind: failed > 0 ? 'error' : left > 0 ? 'info' : 'success', text })
  notifyWhenAway(text)
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
