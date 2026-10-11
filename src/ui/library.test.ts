import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_SETTINGS } from '../state/store'
import { keyValueStore } from '../platform'
import { createDesktopLibraryFiles, createProjectLibrary, createWebLibraryFiles } from '../platform/projectLibrary'
import type { LibraryFiles } from '../platform/projectLibrary'
import {
  LAST_PROJECT_KEY,
  autosaveWrites,
  closeLoss,
  confirmClose,
  createAutosave,
  formatProjectSize,
  lastOpenProject,
  projectSummary,
  rememberOpenEntry,
  settleWithin,
} from './library'
import type { CloseLoss, CloseSteps } from './library'

const track = (name: string, distanceM: number) => ({ name, stats: { distanceM } }) as Track

describe('« Mes projets »: entry text', () => {
  it('summary: first track and its distance, the count when there are several', () => {
    expect(projectSummary([])).toBe('Aucune trace')
    expect(projectSummary([track('Tour du Mont-Blanc', 42_300)])).toBe('Tour du Mont-Blanc · 42,3 km')
    expect(projectSummary([track('Jour 1', 850), track('Jour 2', 9000), track('Jour 3', 1)])).toBe('Jour 1 · 850 m · 3 traces')
    expect(projectSummary([track('Tour du Mont-Blanc', 42_300)], 'Tour du Mont-Blanc')).toBe('42,3 km')
  })

  it('size in Ko below a megabyte, in Mo above', () => {
    expect(formatProjectSize(200)).toBe('1 Ko')
    expect(formatProjectSize(12_300)).toBe('12 Ko')
    expect(formatProjectSize(4_500_000)).toBe('4,5 Mo')
  })
})

describe('« Mes projets »: autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(canSave = () => true) {
    const save = vi.fn(async () => undefined)
    const onError = vi.fn()
    return { save, onError, autosave: createAutosave({ delayMs: 1000, canSave, save, onError }) }
  }

  it('saves once, a delay after the last change', async () => {
    const { save, autosave } = setup()
    autosave.changed()
    await vi.advanceTimersByTimeAsync(800)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(800)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
    autosave.changed()
    autosave.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('waits while saving is not allowed (export running)', async () => {
    let exporting = true
    const { save, autosave } = setup(() => !exporting)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(3000)
    expect(save).not.toHaveBeenCalled()
    exporting = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('one message per run of failures', async () => {
    const { save, onError, autosave } = setup()
    save.mockRejectedValue(new Error('disque plein'))
    for (let i = 0; i < 3; i++) {
      autosave.changed()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(save).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledTimes(1)
    save.mockResolvedValueOnce(undefined)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('flush saves a waiting change at once, and only then', async () => {
    const { save, autosave } = setup()
    await autosave.flush()
    expect(save).not.toHaveBeenCalled()
    autosave.changed()
    await autosave.flush()
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves never overlap', async () => {
    const { save, autosave } = setup()
    let running = 0
    let overlapped = false
    save.mockImplementation(async () => {
      running++
      overlapped ||= running > 1
      await new Promise((resolve) => setTimeout(resolve, 3000))
      running--
    })
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(overlapped).toBe(false)
  })
})

describe('closing the window or tab', () => {
  it('loses a running export first, else the changes not saved, else nothing', () => {
    expect(closeLoss({ exporting: false, dirty: false })).toBeNull()
    expect(closeLoss({ exporting: false, dirty: true })).toBe('changes')
    expect(closeLoss({ exporting: true, dirty: false })).toBe('export')
    expect(closeLoss({ exporting: true, dirty: true })).toBe('export')
  })

  describe('desktop window', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    /** `loss` after the flush; `afterSave` once « Enregistrer » ran */
    function steps(loss: CloseLoss, answer: 'save' | 'close' | 'cancel' = 'cancel', afterSave: CloseLoss = null) {
      let current = loss
      return {
        flush: vi.fn(async () => undefined),
        loss: () => current,
        ask: vi.fn(async () => answer),
        save: vi.fn(async () => {
          current = afterSave
        }),
      } satisfies CloseSteps
    }

    it('closes without a question once the last change is written', async () => {
      const s = steps(null)
      expect(await confirmClose(s)).toBe(true)
      expect(s.flush).toHaveBeenCalledTimes(1)
      expect(s.ask).not.toHaveBeenCalled()
    })

    it('asks when something would be lost: close, cancel, or save first', async () => {
      const close = steps('changes', 'close')
      expect(await confirmClose(close)).toBe(true)
      expect(close.ask).toHaveBeenCalledWith('changes')
      expect(await confirmClose(steps('export', 'cancel'))).toBe(false)
      const saved = steps('changes', 'save', null)
      expect(await confirmClose(saved)).toBe(true)
      expect(saved.save).toHaveBeenCalledTimes(1)
      // save dialog closed: still « Modifié »
      expect(await confirmClose(steps('changes', 'save', 'changes'))).toBe(false)
    })

    it('waits for a slow write a few seconds at most', async () => {
      const s = steps(null)
      s.flush.mockReturnValue(new Promise(() => undefined))
      const closing = confirmClose(s, 4000)
      let closed: boolean | null = null
      void closing.then((value) => (closed = value))
      await vi.advanceTimersByTimeAsync(3999)
      expect(closed).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(closed).toBe(true)
    })

    it('settleWithin: at once when the promise settles, failure included', async () => {
      let settled = false
      void settleWithin(Promise.reject(new Error('disque plein')), 4000).then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
    })
  })
})

describe('« Mes projets »: kept by itself, reopened at start', () => {
  const project = (tracks: Track[], name = '') => ({ settings: DEFAULT_SETTINGS, tracks, name })
  const one = [track('Jour 1', 850)]

  it('a project with a track gets an entry, unless left out; an empty one never', () => {
    expect(autosaveWrites(project(one), null, null, true)).toBe(true)
    expect(autosaveWrites(project([]), null, null, true)).toBe(false)
    expect(autosaveWrites(project(one), null, null, false)).toBe(false)
  })

  it('a kept project is written again only when it changed since its last write', () => {
    const written = project(one)
    expect(autosaveWrites(written, 'p1', written, true)).toBe(false)
    expect(autosaveWrites({ ...written, name: 'Tour' }, 'p1', written, true)).toBe(true)
    // never a second entry for a kept project, whatever `keepNew`
    expect(autosaveWrites({ ...written, name: 'Tour' }, 'p1', written, false)).toBe(true)
  })

  function memoryFiles(): LibraryFiles {
    const files = new Map<string, string>()
    return {
      names: async () => [...files.keys()],
      read: async (name) => files.get(name) ?? null,
      write: async (name, body) => void files.set(name, typeof body === 'string' ? body : await body.text()),
      remove: async (name) => void files.delete(name),
    }
  }

  it('writes the document as a Blob (autosave) without making a string of it: size and content as for the text', async () => {
    const projectLibrary = createProjectLibrary(memoryFiles(), () => 1, () => 'p1')
    const entry = await projectLibrary.save(null, { name: 'Tour', summary: '', text: new Blob(['{"é":', new Blob(['1}'])]) })
    expect(entry.sizeBytes).toBe(8)
    expect(await projectLibrary.load('p1')).toBe('{"é":1}')
    // same size as the string of the same document
    expect((await createProjectLibrary(memoryFiles(), () => 1, () => 'p2').save(null, { name: 'Tour', summary: '', text: '{"é":1}' })).sizeBytes).toBe(8)
  })

  it('a Blob reaches the web cache and the desktop file as the same bytes', async () => {
    const stored = new Map<string, Response>()
    const cache = { put: async (k: string, r: Response) => void stored.set(k, r), match: async (k: string) => stored.get(k)?.clone() }
    const web = createWebLibraryFiles({ open: async () => cache as unknown as Cache })
    await web.write('a.openflyover.json', new Blob(['{"é":', '1}']))
    expect(await web.read('a.openflyover.json')).toBe('{"é":1}')

    const written = new Map<string, Uint8Array>()
    const fs = {
      BaseDirectory: { AppData: 14 },
      exists: async () => true,
      mkdir: async () => undefined,
      writeFile: async (path: string, data: Uint8Array) => void written.set(path, data),
      rename: async (from: string, to: string) => void written.set(to, written.get(from)!),
      remove: async () => undefined,
    }
    await createDesktopLibraryFiles(async () => fs as never).write('a.openflyover.json', new Blob(['{"é":', '1}']))
    expect(new TextDecoder().decode(written.get('projects/a.openflyover.json'))).toBe('{"é":1}')
  })

  it('reopens the remembered entry with its document', async () => {
    const storage = keyValueStore(null)
    const projectLibrary = createProjectLibrary(memoryFiles(), () => 1, () => 'p1')
    await projectLibrary.save(null, { name: 'Tour', summary: '', text: '{"version":2}' })
    expect(await lastOpenProject({ storage, projectLibrary })).toBeNull()
    rememberOpenEntry(storage, 'p1')
    const last = await lastOpenProject({ storage, projectLibrary })
    expect(last?.entry.name).toBe('Tour')
    expect(await last?.file.text()).toBe('{"version":2}')
    rememberOpenEntry(storage, null)
    expect(storage.get(LAST_PROJECT_KEY)).toBeNull()
  })

  it('starts on the home screen when the entry is gone, and forgets it', async () => {
    const storage = keyValueStore(null)
    rememberOpenEntry(storage, 'gone')
    const projectLibrary = createProjectLibrary(memoryFiles())
    expect(await lastOpenProject({ storage, projectLibrary })).toBeNull()
    expect(storage.get(LAST_PROJECT_KEY)).toBeNull()
    // no library (page without Cache Storage): nothing to reopen
    expect(await lastOpenProject({ storage, projectLibrary: null })).toBeNull()
  })
})
