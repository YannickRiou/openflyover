/**
 * The render history (`history.ts`) kept in the platform storage (localStorage on the web, the webview's on the desktop),
 * and the recorder that writes an entry when an export ends. Nothing here throws: a storage that refuses a write keeps
 * the list in memory for the session (`keyValueStore`).
 *
 * The recorder watches the export store: the run starts at `begin` (phase 'rendering', after every confirmation
 * dialog), so its wall-clock time is the render alone; it ends on done / error / canceled. Batches go through the same
 * store, one entry per file. Still images are not recorded.
 */
import { create } from 'zustand'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { HISTORY_KEY, entryOf, parseHistory, recordEntry, serialiseHistory } from './history'
import type { HistoryEntry, RenderOutcome, RenderRecord } from './history'
import { useExportStore } from './store'
import type { ExportRequest } from './store'

export interface HistoryState {
  /** newest first */
  entries: HistoryEntry[]
  add(entry: HistoryEntry): void
  remove(id: string): void
  clear(): void
}

function read(): HistoryEntry[] {
  try {
    return parseHistory(getPlatform().storage.get(HISTORY_KEY))
  } catch {
    return []
  }
}

function write(entries: HistoryEntry[]): void {
  try {
    if (entries.length === 0) getPlatform().storage.remove(HISTORY_KEY)
    else getPlatform().storage.set(HISTORY_KEY, serialiseHistory(entries))
  } catch {
    // storage unavailable: the list stays in memory for this session
  }
}

/** Every change starts from the stored list, so a second window's entries are not lost. */
export const useExportHistory = create<HistoryState>()((set) => {
  const change = (fn: (entries: HistoryEntry[]) => HistoryEntry[]) => {
    const entries = fn(read())
    write(entries)
    set({ entries })
  }
  return {
    entries: read(),
    add: (entry) => change((entries) => recordEntry(entries, entry)),
    remove: (id) => change((entries) => entries.filter((e) => e.id !== id)),
    clear: () => change(() => []),
  }
})

/** The render being recorded, taken at its first frame. */
interface Run {
  request: ExportRequest
  startedAt: number
  settings: Settings
}

const OUTCOMES: Partial<Record<string, RenderOutcome>> = { done: 'done', error: 'error', canceled: 'canceled' }

/** Start watching the export store (once, at start-up); returns the unsubscribe function. */
export function installExportHistory(now: () => number = () => performance.now()): () => void {
  let run: Run | null = null
  return useExportStore.subscribe((state, previous) => {
    if (state.phase === previous.phase) return
    if (state.phase === 'rendering') {
      const { request } = state
      run = request && !request.still ? { request, startedAt: now(), settings: useAppStore.getState().settings } : null
      return
    }
    const outcome = OUTCOMES[state.phase]
    if (!outcome || !run) return
    const { request, startedAt, settings } = run
    run = null
    const encoder = getPlatform().capabilities.videoEncoder
    const record: RenderRecord = {
      request,
      outcome,
      error: state.error ?? undefined,
      wallMs: now() - startedAt,
      frames: state.frameCount,
      encoded: outcome === 'done' ? state.frameCount : state.frame,
      timings: state.timings,
      result: state.result,
      encoder,
      settings,
      at: Date.now(),
    }
    try {
      useExportHistory.getState().add(entryOf(record))
    } catch (error) {
      console.warn('[export] historique non écrit :', error)
    }
  })
}
