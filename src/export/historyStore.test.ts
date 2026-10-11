import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatform } from '../platform'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { HISTORY_KEY, HISTORY_LIMIT, parseHistory } from './history'
import { installExportHistory, useExportHistory } from './historyStore'
import { resetExportStore, useExportStore, type ExportRequest } from './store'

const REQUEST: Omit<ExportRequest, 'id'> = {
  width: 1920,
  height: 1080,
  fps: 30,
  quality: 'high',
  durationS: 10,
  holdStartS: 1,
  holdEndS: 2,
  baseName: 'Tour',
}
const RESULT = { url: null, fileName: 'Tour.mp4', mimeType: 'video/mp4', sizeBytes: 5_000_000, codec: 'mp4/avc', incompleteFrames: 0 }

let clock = 0
let stop: () => void

/** An export that starts at `startMs` (ms on the fake clock) and ends with `end`. */
function run(end: (store: ReturnType<typeof useExportStore.getState>) => void, request: Omit<ExportRequest, 'id'> = REQUEST, wallMs = 5000) {
  const store = useExportStore.getState()
  store.start(request)
  const id = useExportStore.getState().request!.id
  // a confirmation dialog before the first frame: not counted
  clock += 60_000
  useExportStore.getState().begin(id, 100, clock)
  clock += wallMs
  end(useExportStore.getState())
}

beforeEach(() => {
  clock = 1000
  resetExportStore()
  getPlatform().storage.remove(HISTORY_KEY)
  useExportHistory.setState({ entries: [] })
  useAppStore.setState({ settings: DEFAULT_SETTINGS })
  stop = installExportHistory(() => clock)
})
afterEach(() => stop())

describe('render recorder', () => {
  it('records a finished export with its real time, without the wait before the first frame', () => {
    run((s) => {
      s.reportFrame(100, clock, { rendered: 60, renderMs: 1, waitMs: 2, encodeMs: 3, timeouts: 0 })
      s.complete(RESULT)
    })
    const [entry] = useExportHistory.getState().entries
    expect(entry).toMatchObject({ name: 'Tour', outcome: 'done', wallMs: 5000, frames: 100, encoded: 100, rendered: 60, codec: 'mp4/avc', bytes: 5_000_000 })
    expect(entry.settings.shadows).toBe(DEFAULT_SETTINGS.shadows)
    // kept in the platform storage
    expect(parseHistory(getPlatform().storage.get(HISTORY_KEY))).toHaveLength(1)
  })

  it('records an error with its message and the frames done', () => {
    run((s) => {
      s.reportFrame(40, clock)
      s.fail('WebGL perdu')
    })
    expect(useExportHistory.getState().entries[0]).toMatchObject({ outcome: 'error', error: 'WebGL perdu', encoded: 40, frames: 100 })
  })

  it('records a cancel, but not one before the first frame', () => {
    run((s) => s.canceled())
    expect(useExportHistory.getState().entries[0].outcome).toBe('canceled')
    useExportStore.getState().start(REQUEST)
    useExportStore.getState().cancel()
    expect(useExportHistory.getState().entries).toHaveLength(1)
  })

  it('does not record a still image', () => {
    run((s) => s.complete(RESULT), { ...REQUEST, still: { progress: 0.5, type: 'image/png' } })
    expect(useExportHistory.getState().entries).toHaveLength(0)
  })

  it('records every file of a batch and caps the list', () => {
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) run((s) => s.complete(RESULT), { ...REQUEST, baseName: `Film ${i}` })
    const { entries } = useExportHistory.getState()
    expect(entries).toHaveLength(HISTORY_LIMIT)
    expect(entries[0].name).toBe(`Film ${HISTORY_LIMIT + 2}`)
  })

  it('removes one entry and clears the list', () => {
    run((s) => s.complete(RESULT))
    run((s) => s.complete(RESULT), { ...REQUEST, baseName: 'Autre' })
    const [newest, older] = useExportHistory.getState().entries
    useExportHistory.getState().remove(newest.id)
    expect(useExportHistory.getState().entries.map((e) => e.id)).toEqual([older.id])
    expect(parseHistory(getPlatform().storage.get(HISTORY_KEY))).toHaveLength(1)
    useExportHistory.getState().clear()
    expect(useExportHistory.getState().entries).toEqual([])
    expect(getPlatform().storage.get(HISTORY_KEY)).toBeNull()
  })

  it('survives corrupted storage', () => {
    getPlatform().storage.set(HISTORY_KEY, '{broken')
    run((s) => s.complete(RESULT))
    expect(useExportHistory.getState().entries).toHaveLength(1)
  })
})
