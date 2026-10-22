import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTLE,
  REPLACE_EPSILON,
  REPLACE_TOLERANCE_M,
  composeFrame,
  composeOverlayFrame,
  createWorkerSleep,
  renderSettledFrame,
  settle,
  tileFailureMessage,
  wait,
  yieldToEventLoop,
  type RenderFrameDeps,
} from './capture'
import { ExportCanceledError } from './encoder'

/**
 * Fake scene on a virtual clock: each render takes 10 ms, `wait` advances the clock, the view's tiles are
 * ready from `1000 + loadedAt` (which leaves a re-drape pending), the camera placement drifts by `drift` m.
 */
function fakeScene({
  loadedAt = 0,
  canceled = (): boolean => false,
  drift = 0,
  clouds = false,
  missing = 0,
  lateRequest = false,
} = {}) {
  let clock = 1000
  let drapePending = false
  const renders: number[] = []
  /** `final` flag of each render */
  const finals: boolean[] = []
  const progress: number[] = []
  const flushes: boolean[] = []
  let tileUpdates = 0
  /** the selection of the first final render asks for tiles that arrive 100 ms later (the view moved since the last check) */
  let lateUntil = 0
  const deps: RenderFrameDeps = {
    advance: (final) => {
      finals.push(final)
      clock += 10
      if (loadedAt > 0 && renders.length > 0 && clock >= loadedAt + 1000 && renders.at(-1)! < loadedAt + 1000) drapePending = true
      renders.push(clock)
      if (lateRequest && final && lateUntil === 0) lateUntil = clock + 100
    },
    separateFinal: () => clouds,
    updateTiles: () => {
      tileUpdates++
    },
    pendingTiles: () => (clock < loadedAt + 1000 || clock < lateUntil ? 2 : 0),
    missingTiles: () => missing,
    flushDrapes: () => {
      const ran = drapePending
      drapePending = false
      flushes.push(ran)
      return ran
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
    isCanceled: canceled,
    setProgress: (p) => progress.push(p),
    cameraDrift: () => drift,
  }
  return { deps, renders, finals, progress, flushes, tileUpdates: () => tileUpdates }
}

describe('settle', () => {
  it('renders once when the terrain is already complete', async () => {
    const { deps, renders, flushes } = fakeScene()
    expect(await settle(deps)).toBe(true)
    expect(renders).toHaveLength(1)
    expect(flushes).toEqual([false])
  })

  it('polls until the view has its tiles, then re-drapes and renders once more', async () => {
    const { deps, renders, flushes } = fakeScene({ loadedAt: 200 })
    expect(await settle(deps)).toBe(true)
    expect(deps.now()).toBeGreaterThanOrEqual(1200)
    expect(deps.now()).toBeLessThan(1200 + 60)
    expect(flushes).toEqual([true])
    // the last render follows the flush
    expect(renders.length).toBeGreaterThan(2)
  })

  it('only requests tiles while they load: renders the first frame, the settled one and the re-drape', async () => {
    const { deps, renders, tileUpdates } = fakeScene({ loadedAt: 1000 })
    expect(await settle(deps)).toBe(true)
    expect(renders).toHaveLength(3)
    expect(renders[1]).toBeGreaterThanOrEqual(2000)
    expect(tileUpdates()).toBeGreaterThan(50)
  })

  it('honours a minimum number of renders', async () => {
    const { deps, renders } = fakeScene()
    await settle(deps, { ...DEFAULT_SETTLE, minAdvances: 3 })
    expect(renders).toHaveLength(3)
  })

  it('gives up after the timeout, still flushing the re-drapes', async () => {
    const { deps, renders, flushes } = fakeScene({ loadedAt: 60_000 })
    expect(await settle(deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })).toBe(false)
    expect(deps.now()).toBeLessThan(1000 + 600)
    expect(flushes).toHaveLength(1)
    // the captured frame is rendered at the timeout, with the tiles there by then
    expect(renders).toHaveLength(2)
    expect(renders[1]).toBeGreaterThanOrEqual(1000 + 500)
  })

  it('throws when canceled', async () => {
    const { deps } = fakeScene({ loadedAt: 60_000, canceled: () => true })
    await expect(settle(deps)).rejects.toBeInstanceOf(ExportCanceledError)
  })
})

describe('renderSettledFrame', () => {
  it('sets the progress once when the placement does not move', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 100, drift: REPLACE_TOLERANCE_M / 2 })
    expect(await renderSettledFrame(0.25, deps)).toBe('complete')
    expect(progress).toEqual([0.25])
  })

  it('places the camera again when the final terrain moves it', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 100, drift: 5 })
    expect(await renderSettledFrame(0.25, deps)).toBe('complete')
    expect(progress).toEqual([0.25, 0.25 + REPLACE_EPSILON])
  })

  it('does not place the camera again after a timeout', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 60_000, drift: 5 })
    expect(await renderSettledFrame(0.25, deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })).toBe('timeout')
    expect(progress).toEqual([0.25])
  })

  it('nudges backwards at the end of the track', async () => {
    const { deps, progress } = fakeScene({ drift: 5 })
    await renderSettledFrame(1, deps)
    expect(progress).toEqual([1, 1 - REPLACE_EPSILON])
  })
})

describe('renderSettledFrame with clouds', () => {
  const withClouds = { ...DEFAULT_SETTLE }

  it('renders once without clouds, then once with them, when the terrain is already complete', async () => {
    const { deps, finals } = fakeScene({ clouds: true })
    expect(await renderSettledFrame(0.25, deps, withClouds)).toBe('complete')
    expect(finals).toEqual([false, true])
  })

  it('computes the clouds once however many renders the tiles and the re-drape take', async () => {
    const { deps, finals, flushes } = fakeScene({ clouds: true, loadedAt: 1000, drift: 5 })
    expect(await renderSettledFrame(0.25, deps, withClouds)).toBe('complete')
    expect(finals.filter(Boolean)).toHaveLength(1)
    // the final render is the last one, after the re-drapes
    expect(finals.at(-1)).toBe(true)
    expect(finals.length).toBeGreaterThan(3)
    expect(flushes.at(-1)).toBe(false)
  })

  it('renders the final frame at the timeout too', async () => {
    const { deps, finals } = fakeScene({ clouds: true, loadedAt: 60_000, drift: 5 })
    expect(await renderSettledFrame(0.25, deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })).toBe('timeout')
    expect(finals.at(-1)).toBe(true)
    expect(finals.filter(Boolean)).toHaveLength(1)
  })

  it('leaves the renders as they were without clouds: every render is a final one', async () => {
    const { deps, finals, renders } = fakeScene({ loadedAt: 1000 })
    await renderSettledFrame(0.25, deps)
    expect(renders).toHaveLength(3)
    expect(finals.every(Boolean)).toBe(true)
  })

  it('places the camera again before the final render', async () => {
    const { deps, finals, progress } = fakeScene({ clouds: true, loadedAt: 100, drift: 5 })
    await renderSettledFrame(0.25, deps, withClouds)
    expect(progress).toEqual([0.25, 0.25 + REPLACE_EPSILON])
    expect(finals.slice(0, -1).every((f) => !f)).toBe(true)
  })
})

describe('renderSettledFrame, the view is final at the capture', () => {
  it('waits up to 5 min by default, a frame of a slow host included', async () => {
    expect(DEFAULT_SETTLE.timeoutMs).toBe(300_000)
    const { deps } = fakeScene({ loadedAt: 200_000 })
    expect(await renderSettledFrame(0.25, deps)).toBe('complete')
    expect(deps.now()).toBeGreaterThanOrEqual(201_000)
  })

  it('reports the frame incomplete when tiles of the view were given up on', async () => {
    const { deps } = fakeScene({ missing: 2 })
    expect(await renderSettledFrame(0.25, deps)).toBe('missing')
  })

  it('settles and renders again when the final render selected tiles nobody waited for', async () => {
    const { deps, finals } = fakeScene({ clouds: true, lateRequest: true })
    expect(await renderSettledFrame(0.25, deps)).toBe('complete')
    // the captured render is the last one and follows the end of the wait
    expect(finals.filter(Boolean)).toHaveLength(2)
    expect(finals.at(-1)).toBe(true)
    expect(deps.pendingTiles()).toBe(0)
  })

  it('spends one timeout on a frame, not one per settle', async () => {
    const { deps } = fakeScene({ loadedAt: 400, drift: 5 })
    expect(await renderSettledFrame(0.25, deps, { ...DEFAULT_SETTLE, timeoutMs: 500, minAdvances: 1 })).toBe('complete')
    const slow = fakeScene({ loadedAt: 450, drift: 5, lateRequest: true, clouds: true })
    const start = slow.deps.now()
    await renderSettledFrame(0.25, slow.deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })
    expect(slow.deps.now() - start).toBeLessThan(500 + 100)
  })
})

describe('renderSettledFrame, final render first (the previous frame needed no wait)', () => {
  it('renders once, with the clouds, when the view has its tiles', async () => {
    const { deps, finals } = fakeScene({ clouds: true })
    expect(await renderSettledFrame(0.25, deps, DEFAULT_SETTLE, true)).toBe('complete')
    expect(finals).toEqual([true])
  })

  it('goes the usual way, ending on a final render, when that render asks for tiles', async () => {
    const { deps, finals } = fakeScene({ clouds: true, loadedAt: 100 })
    expect(await renderSettledFrame(0.25, deps, DEFAULT_SETTLE, true)).toBe('complete')
    expect(finals[0]).toBe(true)
    expect(finals.at(-1)).toBe(true)
    expect(finals.slice(1, -1).every((f) => !f)).toBe(true)
  })

  it('goes the usual way when the camera must be placed again', async () => {
    const { deps, finals, progress } = fakeScene({ clouds: true, drift: 5 })
    await renderSettledFrame(0.25, deps, DEFAULT_SETTLE, true)
    expect(progress).toEqual([0.25, 0.25 + REPLACE_EPSILON])
    expect(finals.at(-1)).toBe(true)
  })

  it('changes nothing without clouds', async () => {
    const { deps, finals } = fakeScene()
    await renderSettledFrame(0.25, deps, DEFAULT_SETTLE, true)
    expect(finals).toEqual([true])
  })
})

describe('tileFailureMessage', () => {
  const failure = (tile: string, givenUp = true) => ({ tile, host: 'data.geopf.fr', layer: 'imagerie', cause: 'HTTP 503', attempts: 8, givenUp })

  it('names the host, the tile and the cause of the tiles given up on', () => {
    const text = tileFailureMessage('missing', 12, [failure('14/8345/5843')], 0, 300_000)
    expect(text).toContain("Tuiles introuvables pour l'image 12")
    expect(text).toContain('data.geopf.fr, tuile 14/8345/5843 (imagerie) : HTTP 503, 8 essais')
    expect(text).toContain('Export arrêté')
  })

  it('counts the tiles past the first three, and says how long the frame waited', () => {
    const text = tileFailureMessage('timeout', 3, ['1/0/0', '1/0/1', '1/1/0', '1/1/1', '2/0/0'].map((t) => failure(t, false)), 7, 300_000)
    expect(text).toContain("après 5 min pour l'image 3 (7 en attente)")
    expect(text).toContain('et 2 autres')
    expect(tileFailureMessage('timeout', 3, [], 7, 300_000)).toMatch(/en attente\)\. Export/)
  })
})

describe('composeFrame', () => {
  function fakeContext() {
    const calls: string[] = []
    const ctx = {
      createLinearGradient: () => ({ addColorStop: () => calls.push('stop') }),
      fillRect: (...a: number[]) => calls.push(`fill ${a.join(' ')}`),
      clearRect: (...a: number[]) => calls.push(`clear ${a.join(' ')}`),
      drawImage: (_s: unknown, ...a: number[]) => calls.push(`draw ${a.join(' ')}`),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      fillStyle: '' as unknown,
    }
    return { ctx: ctx as unknown as OffscreenCanvasRenderingContext2D, calls }
  }

  it('paints the sky, scales the WebGL image to the video size and draws the overlay on top', () => {
    const { ctx, calls } = fakeContext()
    const overlay = vi.fn(() => calls.push('overlay'))
    const at = { progress: 0.5, time: { timeS: 12, openingS: 6, flightS: 20, totalS: 31 } }
    composeFrame(ctx, {} as CanvasImageSource, at, 320, 180, overlay)
    expect(calls).toEqual(['stop', 'stop', 'fill 0 0 320 180', 'draw 0 0 320 180', 'save', 'overlay', 'restore'])
    expect(overlay).toHaveBeenCalledWith(ctx, at, 320, 180)
  })

  it('restores the context when the overlay throws', () => {
    const { ctx, calls } = fakeContext()
    expect(() =>
      composeFrame(ctx, {} as CanvasImageSource, { progress: 0, time: { timeS: 0, openingS: 0, flightS: 1, totalS: 1 } }, 10, 10, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(calls.at(-1)).toBe('restore')
  })

  it('draws the overlay alone on a cleared, transparent canvas', () => {
    const { ctx, calls } = fakeContext()
    const overlay = vi.fn(() => calls.push('overlay'))
    const at = { progress: 0.5, time: { timeS: 12, openingS: 6, flightS: 20, totalS: 31 } }
    composeOverlayFrame(ctx, at, 320, 180, overlay)
    expect(calls).toEqual(['clear 0 0 320 180', 'save', 'overlay', 'restore'])
    expect(overlay).toHaveBeenCalledWith(ctx, at, 320, 180)
  })
})

describe('wait', () => {
  it('resolves with and without a delay', async () => {
    await expect(wait(0)).resolves.toBeUndefined()
    await expect(wait(1)).resolves.toBeUndefined()
  })

  it('waits with a timer while the page is shown', async () => {
    vi.useFakeTimers()
    try {
      let done = false
      void wait(50, { hidden: () => false, now: () => 0 }).then(() => (done = true))
      await vi.advanceTimersByTimeAsync(49)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits turn by turn, with no timer, while the page is hidden (its timers are throttled to 1 s)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      // the clock moves 1 ms per read: the wait ends by itself after a few turns
      let clock = 0
      await wait(16, { hidden: () => true, now: () => clock++ })
      expect(vi.getTimerCount()).toBe(0)
      expect(clock).toBeGreaterThan(16)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hidden page: waits on the timer of a worker, no timer and no spin', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const sleep = vi.fn(() => Promise.resolve())
      const now = vi.fn(() => 0)
      await wait(16, { hidden: () => true, now, sleep })
      expect(sleep).toHaveBeenCalledWith(16)
      expect(vi.getTimerCount()).toBe(0)
      expect(now).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hidden page, no worker: spins as before; shown page: a timer, never the worker', async () => {
    let clock = 0
    await wait(16, { hidden: () => true, now: () => clock++, sleep: () => null })
    expect(clock).toBeGreaterThan(16)
    vi.useFakeTimers()
    try {
      const sleep = vi.fn(() => Promise.resolve())
      void wait(5, { hidden: () => false, now: () => 0, sleep })
      await vi.advanceTimersByTimeAsync(5)
      expect(sleep).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('yields through scheduler.yield where the browser has it, else a message port', async () => {
    const scope = globalThis as { scheduler?: unknown }
    const saved = scope.scheduler
    try {
      const yielded = vi.fn(async () => undefined)
      scope.scheduler = { yield: yielded }
      await yieldToEventLoop()
      expect(yielded).toHaveBeenCalledOnce()
      scope.scheduler = undefined
      await expect(yieldToEventLoop()).resolves.toBeUndefined()
    } finally {
      scope.scheduler = saved
    }
  })
})

describe('createWorkerSleep', () => {
  /** a worker that answers each message by itself, in the order asked */
  function fakeWorker() {
    const worker = {
      onmessage: null as ((event: { data: number }) => void) | null,
      onerror: null as (() => void) | null,
      onmessageerror: null as (() => void) | null,
      posted: [] as { id: number; ms: number }[],
      postMessage(message: { id: number; ms: number }) {
        worker.posted.push(message)
      },
      answer(id: number) {
        worker.onmessage?.({ data: id })
      },
    }
    return worker
  }

  it('posts the delay to one worker, made once, and resolves on its answer', async () => {
    const worker = fakeWorker()
    const create = vi.fn(() => worker as unknown as Worker)
    const sleep = createWorkerSleep(create)
    let first = false
    let second = false
    void sleep(30)?.then(() => (first = true))
    void sleep(10)?.then(() => (second = true))
    expect(create).toHaveBeenCalledOnce()
    expect(worker.posted).toEqual([
      { id: 0, ms: 30 },
      { id: 1, ms: 10 },
    ])
    worker.answer(1)
    await Promise.resolve()
    expect([first, second]).toEqual([false, true])
    worker.answer(0)
    await Promise.resolve()
    expect(first).toBe(true)
  })

  it('returns null when the worker cannot be made, and asks only once', () => {
    const create = vi.fn(() => {
      throw new Error('blocked by the CSP')
    })
    const sleep = createWorkerSleep(create)
    expect(sleep(5)).toBeNull()
    expect(sleep(5)).toBeNull()
    expect(create).toHaveBeenCalledOnce()
  })

  it('frees the waits in progress when the worker fails, then returns null', async () => {
    const worker = fakeWorker()
    const sleep = createWorkerSleep(() => worker as unknown as Worker)
    const waiting = sleep(1000)
    worker.onerror?.()
    await expect(waiting).resolves.toBeUndefined()
    expect(sleep(5)).toBeNull()
  })

  it('frees the waits when the worker cannot read a message', async () => {
    const worker = fakeWorker()
    const sleep = createWorkerSleep(() => worker as unknown as Worker)
    const waiting = sleep(1000)
    worker.onmessageerror?.()
    await expect(waiting).resolves.toBeUndefined()
    expect(sleep(5)).toBeNull()
  })

  it('takes a worker that never replies for dead after the delay plus 2 s, and terminates it', async () => {
    vi.useFakeTimers()
    try {
      const worker = { ...fakeWorker(), terminate: vi.fn() }
      const sleep = createWorkerSleep(() => worker as unknown as Worker)
      let done = false
      void sleep(1000)?.then(() => (done = true))
      await vi.advanceTimersByTimeAsync(2999)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
      expect(worker.terminate).toHaveBeenCalledOnce()
      expect(sleep(5)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
