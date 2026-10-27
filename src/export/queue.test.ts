import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatform } from '../platform'
import {
  MAX_LISTED_ITEMS,
  MAX_QUEUE_ITEMS,
  MAX_SNAPSHOT_CHARS,
  MAX_STORED_CHARS,
  QUEUE_FOLDER_KEY,
  QUEUE_KEY,
  addOpenProject,
  askNotificationPermission,
  canMove,
  chooseQueueFolder,
  jobCount,
  moveItem,
  formatLabel,
  notifyWhenAway,
  parseQueue,
  runQueue,
  runRenderQueue,
  serialiseQueue,
  useQueueStore,
} from './queue'
import type { ItemOutcome, QueueItem } from './queue'
import { exportJob, useBatchStore } from './batch'
import { useMediaStore } from '../film/media'
import { IMAGERY_SOURCES } from '../terrain/sources'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'

// nothing renders in a test: a film is « made » at once, named after its job
vi.mock('./batch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./batch')>()),
  exportJob: vi.fn(async (job: { tag: string }) => ({ status: 'done', result: { fileName: `${job.tag}.mp4` } })),
}))
vi.mock('./trackFilms', () => ({
  loadTrackData: async () => undefined,
  shownFilm: () => ({ fps: 30, quality: 'high', encoding: {}, durationS: 10, progressAt: (t: number) => t, holdStartS: 1, holdEndS: 2 }),
}))

const selection = (formats: string[], extra: { still?: boolean; poster?: boolean } = {}) => ({ formats, still: false, poster: false, ...extra })

const item = (id: string, patch: Partial<QueueItem> = {}): QueueItem => ({
  id,
  name: `Projet ${id}`,
  formats: ['16:9@1080p'],
  status: 'pending',
  snapshot: `{"id":"${id}"}`,
  ...patch,
})

describe('stored form', () => {
  it('keeps the items and their snapshot', () => {
    const items = [item('a'), item('b', { status: 'done', snapshot: null, files: ['b.mp4'] }), item('c', { status: 'error', snapshot: null, error: 'boum' })]
    expect(parseQueue(serialiseQueue(items))).toEqual(items)
  })

  it('brings an item that was running back to « en attente », interrupted', () => {
    const [back] = parseQueue(serialiseQueue([item('a', { status: 'running', step: 2 })]))
    expect(back).toEqual({ ...item('a'), interrupted: true })
    // and it stays interrupted until it runs again
    expect(parseQueue(serialiseQueue([back]))[0].interrupted).toBe(true)
  })

  it('never throws on a damaged or foreign text', () => {
    for (const raw of [null, undefined, '', 'nope', '[]', '{"v":2,"items":[]}', '{"v":1}', '{"v":1,"items":3}']) expect(parseQueue(raw)).toEqual([])
  })

  it('drops the items that are not items, and the repeated ones', () => {
    const good = JSON.parse(serialiseQueue([item('a')])).items[0]
    const raw = JSON.stringify({ v: 1, items: [good, good, null, 4, { ...good, id: 'x', formats: [1] }, { ...good, id: 'y', status: 'weird' }, { id: 'z' }] })
    expect(parseQueue(raw).map((i) => i.id)).toEqual(['a'])
  })

  it('keeps only the snapshots that fit, and says so for the items that lose theirs', () => {
    const big = 'x'.repeat(MAX_SNAPSHOT_CHARS + 1)
    const third = 'y'.repeat(MAX_SNAPSHOT_CHARS)
    const items = [item('a', { snapshot: big }), item('b', { snapshot: third }), item('c', { snapshot: third }), item('d', { snapshot: third }), item('e', { snapshot: third })]
    const text = serialiseQueue(items)
    // 3 MB of room: three snapshots of 1 MB
    expect(text.length).toBeLessThan(MAX_STORED_CHARS + 2000)
    const back = parseQueue(text)
    expect(back.map((i) => i.status)).toEqual(['error', 'pending', 'pending', 'pending', 'error'])
    expect(back[0].error).toContain('trop gros')
  })

  it('drops the snapshot of a finished item and caps the length of the list', () => {
    const done = item('a', { status: 'done', snapshot: '{"keep":false}' })
    expect(parseQueue(serialiseQueue([done]))[0].snapshot).toBeNull()
    const many = Array.from({ length: MAX_LISTED_ITEMS + 5 }, (_, i) => item(String(i)))
    expect(parseQueue(serialiseQueue(many))).toHaveLength(MAX_LISTED_ITEMS)
  })
})

describe('old stored queues', () => {
  it('opens an item stored before stills and posters existed, unchanged', () => {
    const old = JSON.stringify({ v: 1, items: [{ id: 'a', name: 'Vieux', formats: ['16:9@720p'], status: 'pending', snapshot: '{}' }] })
    expect(parseQueue(old)).toEqual([{ id: 'a', name: 'Vieux', formats: ['16:9@720p'], status: 'pending', snapshot: '{}' }])
  })

  it('keeps the still image, the poster and their position, and ignores what is not valid', () => {
    const items = [item('a', { formats: [], still: true, poster: true, progress: 0.4 })]
    expect(parseQueue(serialiseQueue(items))).toEqual(items)
    const junk = JSON.parse(serialiseQueue([item('b')])).items[0]
    const [back] = parseQueue(JSON.stringify({ v: 1, items: [{ ...junk, still: 'yes', poster: 1, progress: 7 }] }))
    expect(back).toEqual(item('b'))
  })

  it('counts the films, the still image and the poster as its jobs', () => {
    expect(jobCount(item('a', { formats: ['16:9@720p', '9:16@720p'], still: true, poster: true }))).toBe(4)
    expect(jobCount(item('a'))).toBe(1)
  })
})

describe('moveItem', () => {
  const ids = (items: readonly QueueItem[]) => items.map((i) => i.id)
  const items = [item('a'), item('b', { status: 'done', snapshot: null }), item('c'), item('d')]

  it('swaps a waiting item with the nearest waiting one, over the finished ones', () => {
    expect(ids(moveItem(items, 'c', -1))).toEqual(['c', 'b', 'a', 'd'])
    expect(ids(moveItem(items, 'a', 1))).toEqual(['c', 'b', 'a', 'd'])
    expect(ids(moveItem(items, 'd', -1))).toEqual(['a', 'b', 'd', 'c'])
  })

  it('does not move the first one up, the last one down, nor an item that is not waiting', () => {
    expect(moveItem(items, 'a', -1)).toBe(items)
    expect(moveItem(items, 'd', 1)).toBe(items)
    expect(moveItem(items, 'b', 1)).toBe(items)
    expect(moveItem(items, 'zzz', 1)).toBe(items)
    expect(canMove(items, 'a', -1)).toBe(false)
    expect(canMove(items, 'a', 1)).toBe(true)
    expect(canMove([item('r', { status: 'running' }), item('p')], 'p', -1)).toBe(false)
  })

  it('is kept: the store moves it and the order is stored', () => {
    useQueueStore.setState({ items: [item('a'), item('b')], running: false })
    useQueueStore.getState().move('b', -1)
    expect(ids(useQueueStore.getState().items)).toEqual(['b', 'a'])
    expect(ids(parseQueue(getPlatform().storage.get(QUEUE_KEY)))).toEqual(['b', 'a'])
  })
})

describe('chooseQueueFolder', () => {
  const folder = (path?: string) => ({ name: 'Films', path, createFile: vi.fn() })
  const deps = (stored: string | null, there: boolean | Error) => {
    const store = new Map<string, string>(stored ? [[QUEUE_FOLDER_KEY, stored]] : [])
    return {
      store,
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: string) => store.set(key, value),
      exists: vi.fn(async () => {
        if (there instanceof Error) throw there
        return there
      }),
      pick: vi.fn(async (_startIn?: string) => folder('/home/films-2') as never),
    }
  }

  it('desktop: reuses the folder of the last run when it is still there, without asking', async () => {
    const d = deps('/home/films', true)
    const chosen = await chooseQueueFolder({ isDesktop: true }, d)
    expect(chosen?.path).toBe('/home/films')
    expect(d.pick).not.toHaveBeenCalled()
  })

  it('desktop: asks again, from the old folder, when it is gone or out of reach, and remembers the new one', async () => {
    for (const there of [false, new Error('forbidden path')]) {
      const d = deps('/home/films', there)
      expect((await chooseQueueFolder({ isDesktop: true }, d))?.path).toBe('/home/films-2')
      expect(d.pick).toHaveBeenCalledWith('/home/films')
      expect(d.store.get(QUEUE_FOLDER_KEY)).toBe('/home/films-2')
    }
  })

  it('desktop: asks the first time, and keeps nothing when the dialog is closed', async () => {
    const d = deps(null, true)
    d.pick.mockResolvedValueOnce(null as never)
    expect(await chooseQueueFolder({ isDesktop: true }, d)).toBeNull()
    expect(d.exists).not.toHaveBeenCalled()
    expect(d.store.size).toBe(0)
  })

  it('web: always asks, remembers nothing', async () => {
    const d = deps(null, true)
    d.pick.mockResolvedValueOnce(folder() as never)
    await chooseQueueFolder({ isDesktop: false }, d)
    expect(d.pick).toHaveBeenCalledWith()
    expect(d.exists).not.toHaveBeenCalled()
    expect(d.store.size).toBe(0)
  })
})

describe('runQueue', () => {
  /** A queue in memory; `outcomes` by id, a throw for an id listed in `throws`. */
  function fakeRunner(items: QueueItem[], outcomes: Record<string, ItemOutcome | 'throw'>, cancelAfter = Infinity) {
    const state = { items, ran: [] as string[], cancel: false }
    return {
      state,
      runner: {
        items: () => state.items,
        patch: (id: string, patch: Partial<QueueItem>) => {
          state.items = state.items.map((i) => (i.id === id ? { ...i, ...patch } : i))
        },
        run: async (it: QueueItem) => {
          state.ran.push(it.id)
          if (state.ran.length >= cancelAfter) state.cancel = true
          const outcome = outcomes[it.id]
          if (outcome === 'throw') throw new Error('lecture impossible')
          return outcome ?? { status: 'done' as const, files: [`${it.id}.mp4`] }
        },
        canceled: () => state.cancel,
      },
    }
  }

  it('renders the items in order and marks them done, snapshot released', async () => {
    const { state, runner } = fakeRunner([item('a'), item('b')], {})
    await runQueue(runner)
    expect(state.ran).toEqual(['a', 'b'])
    expect(state.items.map((i) => [i.status, i.files, i.snapshot])).toEqual([
      ['done', ['a.mp4'], null],
      ['done', ['b.mp4'], null],
    ])
  })

  it('marks a failed item (returned or thrown) and goes on', async () => {
    const { state, runner } = fakeRunner([item('a'), item('b'), item('c')], { a: { status: 'error', error: 'pas de codec' }, b: 'throw' })
    await runQueue(runner)
    expect(state.items.map((i) => i.status)).toEqual(['error', 'error', 'done'])
    expect(state.items.map((i) => i.error)).toEqual(['pas de codec', 'lecture impossible', undefined])
  })

  it('skips the items that are not waiting, and runs again only what is left', async () => {
    const { state, runner } = fakeRunner([item('a', { status: 'done', snapshot: null }), item('b', { status: 'error', snapshot: null }), item('c', { interrupted: true })], {})
    await runQueue(runner)
    expect(state.ran).toEqual(['c'])
    expect(state.items[2].interrupted).toBeUndefined()
  })

  it('puts the item canceled back to « en attente » and leaves the others untouched', async () => {
    const { state, runner } = fakeRunner([item('a'), item('b'), item('c')], { b: { status: 'canceled' } })
    await runQueue(runner)
    expect(state.ran).toEqual(['a', 'b'])
    expect(state.items.map((i) => i.status)).toEqual(['done', 'pending', 'pending'])
    expect(state.items[1].snapshot).not.toBeNull()
  })

  it('stops between two items when a cancel was asked', async () => {
    const { state, runner } = fakeRunner([item('a'), item('b')], {}, 1)
    await runQueue(runner)
    expect(state.items.map((i) => i.status)).toEqual(['done', 'pending'])
  })

  it('takes an item added or removed during the run into account', async () => {
    const { state, runner } = fakeRunner([item('a'), item('b')], {})
    const run = runner.run
    runner.run = async (it) => {
      if (it.id === 'a') state.items = [...state.items.filter((i) => i.id !== 'b'), item('c')]
      return run(it)
    }
    await runQueue(runner)
    expect(state.ran).toEqual(['a', 'c'])
  })
})

describe('queue store', () => {
  beforeEach(() => {
    useQueueStore.setState({ items: [], running: false })
    getPlatform().storage.remove(QUEUE_KEY)
  })

  it('writes every change to the platform storage, and nothing once it is empty', () => {
    useQueueStore.getState().add(item('a'))
    expect(parseQueue(getPlatform().storage.get(QUEUE_KEY)).map((i) => i.id)).toEqual(['a'])
    useQueueStore.getState().patch('a', { status: 'running' })
    expect(JSON.parse(getPlatform().storage.get(QUEUE_KEY)!).items[0].status).toBe('running')
    useQueueStore.getState().patch('a', { status: 'pending' })
    useQueueStore.getState().remove('a')
    expect(getPlatform().storage.get(QUEUE_KEY)).toBeNull()
  })

  it('counts only the items still to render against the cap', () => {
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) expect(useQueueStore.getState().add(item(String(i), { status: 'done', snapshot: null }))).toBe(true)
    // finished and failed items stay listed without counting
    expect(useQueueStore.getState().add(item('next'))).toBe(true)
    expect(useQueueStore.getState().items).toHaveLength(MAX_QUEUE_ITEMS + 1)
  })

  it('refuses an item when the queue is full, and never removes the one that runs', () => {
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) expect(useQueueStore.getState().add(item(String(i)))).toBe(true)
    expect(useQueueStore.getState().add(item('late'))).toBe(false)
    useQueueStore.getState().patch('0', { status: 'running' })
    useQueueStore.getState().remove('0')
    expect(useQueueStore.getState().items).toHaveLength(MAX_QUEUE_ITEMS)
    useQueueStore.getState().remove('1')
    expect(useQueueStore.getState().items).toHaveLength(MAX_QUEUE_ITEMS - 1)
  })
})

describe('notifications', () => {
  const doc = (visible: boolean, focus: boolean) => ({ visibilityState: visible ? ('visible' as const) : ('hidden' as const), hasFocus: () => focus })
  const fake = (permission: string) => {
    const shown: string[] = []
    const Notification = Object.assign(
      function (this: unknown, title: string, options: { body: string }) {
        shown.push(`${title}: ${options.body}`)
      },
      { permission, requestPermission: vi.fn(async () => 'granted') },
    )
    return { shown, Notification: Notification as unknown as typeof globalThis.Notification }
  }

  it('notifies when the window is hidden or out of focus, and only with the permission', () => {
    const away = fake('granted')
    notifyWhenAway('File terminée', { Notification: away.Notification, document: doc(false, false) })
    notifyWhenAway('File terminée', { Notification: away.Notification, document: doc(true, false) })
    expect(away.shown).toEqual(['OpenFlyover: File terminée', 'OpenFlyover: File terminée'])
    const denied = fake('denied')
    notifyWhenAway('x', { Notification: denied.Notification, document: doc(false, false) })
    expect(denied.shown).toEqual([])
  })

  it('does not notify while the window is in front', () => {
    const front = fake('granted')
    notifyWhenAway('x', { Notification: front.Notification, document: doc(true, true) })
    expect(front.shown).toEqual([])
  })

  it('asks the permission only when it was never answered', () => {
    const undecided = fake('default')
    askNotificationPermission({ Notification: undecided.Notification })
    expect(undecided.Notification.requestPermission).toHaveBeenCalledOnce()
    const granted = fake('granted')
    askNotificationPermission({ Notification: granted.Notification })
    expect(granted.Notification.requestPermission).not.toHaveBeenCalled()
    expect(() => askNotificationPermission({})).not.toThrow()
  })
})

describe('runRenderQueue', () => {
  beforeEach(() => {
    useQueueStore.setState({ items: [], running: false })
    vi.mocked(exportJob).mockClear()
  })

  it('shows each snapshot, renders its films, goes on after a failure and puts the open project back', async () => {
    // the queued projects use another imagery source than the one open now
    const imagery = useAppStore.getState().settings.imagerySourceId
    useAppStore.getState().setSetting('imagerySourceId', IMAGERY_SOURCES.find((s) => s.id !== imagery)!.id)
    useAppStore.getState().setProjectName('Sortie du samedi')
    expect(addOpenProject(selection(['16:9@720p', '9:16@720p']))).toBe('Sortie du samedi')
    useAppStore.getState().setProjectName('Autre')
    expect(addOpenProject(selection(['16:9@720p']))).toBe('Autre')
    useQueueStore.getState().add(item('bad', { snapshot: 'not json' }))
    // the project open before has a track, a picture, a work area and its own imagery source
    const track = buildTrack({ name: 'Trace', source: 'gpx', segments: [{ points: [{ lon: 6.87, lat: 45.92, ele: 1000 }, { lon: 6.88, lat: 45.93, ele: 1100 }] }] })
    useAppStore.getState().addTracks([track])
    useAppStore.getState().setProjectName('Ouvert avant')
    useAppStore.getState().setWorkArea({ inS: 1, outS: 3 })
    useMediaStore.getState().replace({ 'photo-1': { data: 'data:image/jpeg;base64,AAAA' } })
    useAppStore.getState().setSetting('imagerySourceId', imagery)
    const { settings, tracks, workArea } = useAppStore.getState()
    const media = useMediaStore.getState().table
    const shown: string[] = []
    const stop = useAppStore.subscribe((s, p) => {
      if (s.projectName !== p.projectName) shown.push(s.projectName)
    })
    await runRenderQueue({ folder: null, save: () => undefined })
    stop()

    const items = useQueueStore.getState().items
    expect(items.map((i) => i.status)).toEqual(['done', 'done', 'error'])
    expect(items[0].files).toEqual(['16x9-720p.mp4', '9x16-720p.mp4'])
    expect(items[0].snapshot).toBeNull()
    expect(items[2].error).toBeTruthy()
    // each project was shown under its own name, the last one is the unreadable item that never got there
    expect(shown.slice(0, 2)).toEqual(['Sortie du samedi', 'Autre'])
    expect(exportJob).toHaveBeenCalledTimes(3)
    // the project open before is back as it was, and the app is free again
    expect(useAppStore.getState().projectName).toBe('Ouvert avant')
    expect(useAppStore.getState().settings).toBe(settings)
    expect(useAppStore.getState().tracks).toBe(tracks)
    expect(useAppStore.getState().workArea).toBe(workArea)
    expect(useMediaStore.getState().table).toEqual(media)
    expect(useBatchStore.getState().phase).toBe('idle')
    expect(useQueueStore.getState().running).toBe(false)
  })

  it('renders each film at the format ticked for the queue, not the one of the project, and puts the project\'s own back', async () => {
    const setVideo = (aspect: '16:9' | '9:16') => useAppStore.getState().setSetting('video', { ...useAppStore.getState().settings.video, aspect })
    useAppStore.getState().setProjectName('Reel')
    setVideo('9:16')
    addOpenProject(selection(['16:9@1080p'], { poster: true }))
    useAppStore.getState().setProjectName('Paysage')
    setVideo('16:9')
    addOpenProject(selection(['9:16@1080p']))
    const seen: Array<[string, string, number, number]> = []
    const record = async (job: Parameters<typeof exportJob>[0]) => {
      seen.push([job.kind, useAppStore.getState().settings.video.aspect, ...('width' in job ? ([job.width, job.height] as const) : ([0, 0] as const))])
      return { status: 'done', result: { fileName: 'x.mp4' } } as never
    }
    vi.mocked(exportJob).mockImplementationOnce(record).mockImplementationOnce(record).mockImplementationOnce(record)
    await runRenderQueue({ folder: null, save: () => undefined })
    // the Reel project is shown in 16:9 for its film (its poster keeps 9:16), the 16:9 one in 9:16
    expect(seen).toEqual([['video', '16:9', 1920, 1080], ['poster', '9:16', 0, 0], ['video', '9:16', 1080, 1920]])
    expect(useAppStore.getState().settings.video.aspect).toBe('16:9')
  })

  it('renders the still image and the poster of an item next to its films, where the project was when added', async () => {
    useAppStore.getState().setProjectName('Avec image')
    useAppStore.getState().setProgress(0.4)
    addOpenProject(selection(['16:9@720p'], { still: true, poster: true }))
    addOpenProject(selection([], { poster: true }))
    await runRenderQueue({ folder: null, save: () => undefined })
    expect(vi.mocked(exportJob).mock.calls.map(([job]) => job.kind)).toEqual(['video', 'still', 'poster', 'poster'])
    const [, ctx] = vi.mocked(exportJob).mock.calls[1]
    expect(ctx.still.progress).toBe(0.4)
    const items = useQueueStore.getState().items
    expect(items.map((i) => i.status)).toEqual(['done', 'done'])
    expect(items[0].files).toHaveLength(3)
    expect(items[0].progress).toBe(0.4)
  })

  it('keeps the item canceled « en attente » and the others untouched', async () => {
    useAppStore.getState().setProjectName('A')
    addOpenProject(selection(['16:9@720p']))
    addOpenProject(selection(['16:9@720p']))
    vi.mocked(exportJob).mockImplementationOnce(async () => ({ status: 'canceled' }))
    await runRenderQueue({ folder: null, save: () => undefined })
    expect(useQueueStore.getState().items.map((i) => i.status)).toEqual(['pending', 'pending'])
    expect(useQueueStore.getState().items[0].snapshot).not.toBeNull()
    expect(useBatchStore.getState().phase).toBe('idle')
  })

  it('does nothing while another run holds the app', async () => {
    addOpenProject(selection(['16:9@720p']))
    useBatchStore.getState().hold(null)
    await runRenderQueue({ folder: null, save: () => undefined })
    useBatchStore.getState().release()
    expect(exportJob).not.toHaveBeenCalled()
    expect(useQueueStore.getState().items[0].status).toBe('pending')
  })
})

describe('formatLabel', () => {
  it('writes a format key as the drawer does', () => {
    expect(formatLabel('16:9@1080p')).toBe('16:9 1080p')
  })
})
