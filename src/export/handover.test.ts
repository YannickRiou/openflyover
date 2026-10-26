import { describe, expect, it, vi } from 'vitest'
import { HANDOVER_SAMPLES, createChooser, createFrameHandover, type HandoverMethod } from './handover'

/** Runs the chooser over frames costing `cost[method]` ms; the methods in the order it asked for them. */
function run(methods: HandoverMethod[], cost: Partial<Record<HandoverMethod, number | number[]>>, frames = 30) {
  const chooser = createChooser(methods)
  const asked: HandoverMethod[] = []
  const seen: Record<string, number> = {}
  for (let i = 0; i < frames; i++) {
    const method = chooser.next()
    asked.push(method)
    const c = cost[method] ?? 1
    seen[method] = (seen[method] ?? -1) + 1
    chooser.record(Array.isArray(c) ? c[seen[method] % c.length] : c)
  }
  return { chooser, asked }
}

describe('createChooser', () => {
  it('warms up with the reference, then times each method on its own frames', () => {
    const { asked } = run(['offscreen', 'canvas', 'bitmap'], {})
    expect(asked.slice(0, 1 + 3 * HANDOVER_SAMPLES)).toEqual([
      'offscreen', // warm-up, not timed
      ...Array(3).fill('offscreen'),
      ...Array(3).fill('canvas'),
      ...Array(3).fill('bitmap'),
    ])
  })

  it('keeps the fastest method for the rest of the film', () => {
    const { chooser, asked } = run(['offscreen', 'canvas', 'bitmap'], { offscreen: 12, canvas: 4, bitmap: 8 })
    expect(chooser.chosen()).toBe('canvas')
    expect(asked.slice(10).every((m) => m === 'canvas')).toBe(true)
    expect(chooser.medians()).toEqual([
      ['offscreen', 12],
      ['canvas', 4],
      ['bitmap', 8],
    ])
  })

  it('keeps the reference unless another method is clearly faster (noise)', () => {
    expect(run(['offscreen', 'canvas'], { offscreen: 10, canvas: 9.5 }).chooser.chosen()).toBe('offscreen')
    expect(run(['offscreen', 'canvas'], { offscreen: 10, canvas: 8.5 }).chooser.chosen()).toBe('canvas')
  })

  it('judges a method by its median: one slow frame does not condemn it', () => {
    expect(run(['offscreen', 'canvas'], { offscreen: 10, canvas: [4, 90, 4] }).chooser.chosen()).toBe('canvas')
  })

  it('is not decided before every method was timed', () => {
    const chooser = createChooser(['offscreen', 'canvas'])
    for (let i = 0; i < 6; i++) {
      chooser.next()
      chooser.record(5)
      expect(chooser.chosen()).toBeNull()
    }
    chooser.next()
    chooser.record(5)
    expect(chooser.chosen()).toBe('offscreen')
  })

  it('does nothing with a single method', () => {
    const chooser = createChooser(['offscreen'])
    expect(chooser.chosen()).toBe('offscreen')
    expect(chooser.next()).toBe('offscreen')
    chooser.record(3)
    expect(chooser.medians()).toEqual([])
  })

  it('skips a method that failed', () => {
    const chooser = createChooser(['offscreen', 'canvas', 'bitmap'])
    const asked: HandoverMethod[] = []
    for (let i = 0; i < 20; i++) {
      const method = chooser.next()
      asked.push(method)
      if (method === 'canvas') chooser.drop('canvas')
      else chooser.record(method === 'bitmap' ? 1 : 10)
    }
    expect(chooser.chosen()).toBe('bitmap')
    expect(asked.at(-1)).toBe('bitmap')
  })
})

/** A fake surface: a canvas and the context composing into it. */
const surface = (name: string) => ({ canvas: { name } as unknown as HTMLCanvasElement, ctx: { name } as unknown as CanvasRenderingContext2D })

function handoverWith(options: { measure?: boolean; bitmapOf?: ((c: OffscreenCanvas) => Promise<ImageBitmap>) | null; page?: boolean } = {}) {
  const compositor = { name: 'offscreen' } as unknown as OffscreenCanvas
  const ctx = { name: 'offscreen' } as unknown as OffscreenCanvasRenderingContext2D
  const page = surface('canvas')
  const onChosen = vi.fn()
  const handover = createFrameHandover({
    compositor,
    ctx,
    width: 320,
    height: 180,
    measure: options.measure ?? true,
    onChosen,
    pageCanvas: () => (options.page === false ? null : page),
    bitmapOf: options.bitmapOf === undefined ? async () => ({ name: 'bitmap' }) as unknown as ImageBitmap : options.bitmapOf,
  })
  return { handover, compositor, ctx, page, onChosen }
}

describe('createFrameHandover', () => {
  it('hands over what the method composed in: its context, then its canvas', async () => {
    const { handover, compositor, ctx, page } = handoverWith()
    // warm-up and three frames of the reference, then three of the page canvas, then three of the bitmap
    for (let i = 0; i < 4; i++) {
      expect(handover.begin()).toBe(ctx)
      expect(await handover.take()).toBe(compositor)
      handover.record(5)
    }
    for (let i = 0; i < 3; i++) {
      expect(handover.begin()).toBe(page.ctx)
      expect(await handover.take()).toBe(page.canvas)
      handover.record(5)
    }
    expect(handover.begin()).toBe(ctx)
    expect(await handover.take()).toEqual({ name: 'bitmap' })
  })

  it('a held frame is handed over from where the last frame was composed', async () => {
    const { handover, page } = handoverWith()
    for (let i = 0; i < 4; i++) {
      handover.begin()
      handover.record(5)
    }
    handover.begin()
    expect(await handover.take()).toBe(page.canvas)
    // no begin: the image was not composed again
    expect(await handover.take()).toBe(page.canvas)
  })

  it('announces its choice once, with the times of each method', async () => {
    const { handover, onChosen } = handoverWith()
    for (let i = 0; i < 20; i++) {
      const composedIn = handover.begin() as unknown as { name: string }
      await handover.take()
      handover.record(composedIn.name === 'canvas' ? 4 : 12)
    }
    expect(onChosen).toHaveBeenCalledTimes(1)
    expect(onChosen).toHaveBeenCalledWith('canvas', expect.arrayContaining([['canvas', 4]]))
  })

  it('frees the page canvas when it is not the one kept', async () => {
    const { handover, page } = handoverWith()
    Object.assign(page.canvas, { width: 320, height: 180 })
    for (let i = 0; i < 20; i++) {
      handover.begin()
      await handover.take()
      handover.record(5)
    }
    expect(page.canvas).toMatchObject({ width: 0, height: 0 })
  })

  it('without a page canvas or bitmaps, only the OffscreenCanvas is used and nothing is announced', async () => {
    const { handover, compositor, ctx, onChosen } = handoverWith({ page: false, bitmapOf: null })
    for (let i = 0; i < 20; i++) {
      expect(handover.begin()).toBe(ctx)
      expect(await handover.take()).toBe(compositor)
      handover.record(5)
    }
    expect(onChosen).not.toHaveBeenCalled()
  })

  it('an encoder that reads only its canvas is not measured', async () => {
    const { handover, compositor, ctx, onChosen } = handoverWith({ measure: false })
    for (let i = 0; i < 20; i++) {
      expect(handover.begin()).toBe(ctx)
      expect(await handover.take()).toBe(compositor)
      handover.record(5)
    }
    expect(onChosen).not.toHaveBeenCalled()
  })

  it('a bitmap that cannot be made falls back to a canvas, for good', async () => {
    const bitmapOf = vi.fn(async () => {
      throw new Error('no bitmap')
    })
    const { handover, compositor, page, onChosen } = handoverWith({ bitmapOf })
    const sources: unknown[] = []
    for (let i = 0; i < 20; i++) {
      handover.begin()
      sources.push(await handover.take())
      handover.record(5)
    }
    expect(bitmapOf).toHaveBeenCalledTimes(1)
    expect(sources.every((source) => source === compositor || source === page.canvas)).toBe(true)
    expect(onChosen).toHaveBeenCalledTimes(1)
  })

  it('closes a bitmap once handed over, and only a bitmap', () => {
    const { handover } = handoverWith()
    const close = vi.fn()
    class FakeBitmap {
      close = close
    }
    vi.stubGlobal('ImageBitmap', FakeBitmap)
    try {
      handover.release(new FakeBitmap() as unknown as ImageBitmap)
      handover.release({} as unknown as HTMLCanvasElement)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
