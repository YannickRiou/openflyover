/**
 * How a composed frame reaches the video encoder (WebCodecs): the fastest way depends on the browser and the device, so
 * the export measures them on its first frames and keeps the fastest (ARCHITECTURE.md « Export vidéo », image vidéo).
 * All of them hand over the same pixels: the same composition (`composeFrame`) in a sRGB canvas without alpha.
 *  - `offscreen`: an OffscreenCanvas composes, `VideoFrame` reads it (the reference, and what the ffmpeg path keeps).
 *  - `canvas`: a canvas of the page (not shown) composes, `VideoFrame` reads it (accelerated in Safari).
 *  - `bitmap`: the OffscreenCanvas composes, `createImageBitmap` copies it, `VideoFrame` reads the bitmap.
 */
import type { Context2D } from './capture'

export const HANDOVER_METHODS = ['offscreen', 'canvas', 'bitmap'] as const
export type HandoverMethod = (typeof HANDOVER_METHODS)[number]

/** Composed frames timed per method (after the first one, which warms up). */
export const HANDOVER_SAMPLES = 3
/** A method replaces the reference only when its median time is under this share of the reference's (noise). */
const MARGIN = 0.9

export interface HandoverChooser {
  /** the method for the next composed frame */
  next(): HandoverMethod
  /** time of that frame (composing and handing over, ms), for the method `next` gave */
  record(ms: number): void
  /** a method that failed is out */
  drop(method: HandoverMethod): void
  /** the choice, once every method was timed */
  chosen(): HandoverMethod | null
  /** median time (ms) of each method timed */
  medians(): [HandoverMethod, number][]
}

const median = (values: readonly number[]) => (values.length === 0 ? Infinity : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)])

/** The choice among `methods` (the first is the reference): one frame to warm up with it, then `samples` frames each. */
export function createChooser(methods: readonly HandoverMethod[], samples = HANDOVER_SAMPLES): HandoverChooser {
  const times = new Map(methods.map((method) => [method, [] as number[]]))
  const dropped = new Set<HandoverMethod>()
  const plan = methods.length > 1 ? [methods[0], ...methods.flatMap((method) => Array<HandoverMethod>(samples).fill(method))] : []
  let step = 0
  let chosen: HandoverMethod | null = methods.length > 1 ? null : methods[0]
  const skip = () => {
    while (step < plan.length && dropped.has(plan[step])) step++
  }
  const decide = (): HandoverMethod => {
    const [reference, ...others] = methods.filter((method) => !dropped.has(method))
    let best = reference
    for (const method of others) if (median(times.get(method)!) < (best === reference ? MARGIN : 1) * median(times.get(best)!)) best = method
    return best
  }
  return {
    next() {
      skip()
      if (step < plan.length) return plan[step]
      return (chosen ??= decide())
    },
    record(ms) {
      if (step >= plan.length) return
      if (step > 0) times.get(plan[step])!.push(ms)
      step++
    },
    drop: (method) => void dropped.add(method),
    chosen() {
      skip()
      return chosen ?? (step >= plan.length ? (chosen = decide()) : null)
    },
    medians: () => [...times].filter(([, v]) => v.length > 0).map(([method, v]) => [method, median(v)]),
  }
}

/** Where a frame is composed, and what the encoder reads. */
interface Surface {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: Context2D
}

/** A canvas of the page, not attached, with the context attributes of the OffscreenCanvas of the export. */
function pageCanvas(width: number, height: number): Surface | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  return ctx ? { canvas, ctx } : null
}

export interface FrameHandover {
  /** the context to compose the next frame in: where its method has it composed */
  begin(): Context2D
  /** what the encoder reads for the current frame (the last composed one, also for a held frame); `release` it afterwards */
  take(): CanvasImageSource | Promise<CanvasImageSource>
  release(source: CanvasImageSource): void
  /** time of the frame just composed and handed over (ms): holds are not timed */
  record(ms: number): void
}

export interface HandoverOptions {
  compositor: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  width: number
  height: number
  /** the encoder reads any canvas (WebCodecs): the methods are timed; else only the OffscreenCanvas is used */
  measure: boolean
  /** the method kept, once timed, with the median time (ms) of each */
  onChosen?(method: HandoverMethod, medians: [HandoverMethod, number][]): void
  /** a test hands its own */
  pageCanvas?: typeof pageCanvas
  bitmapOf?: ((canvas: OffscreenCanvas) => Promise<ImageBitmap>) | null
}

export function createFrameHandover(options: HandoverOptions): FrameHandover {
  const { compositor, ctx, width, height, measure, onChosen } = options
  const surfaces = new Map<HandoverMethod, Surface>([['offscreen', { canvas: compositor, ctx }]])
  const bitmapOf = options.bitmapOf === undefined ? (typeof createImageBitmap === 'function' ? (c: OffscreenCanvas) => createImageBitmap(c) : null) : options.bitmapOf
  if (measure) {
    const page = (options.pageCanvas ?? pageCanvas)(width, height)
    if (page) surfaces.set('canvas', page)
    if (bitmapOf) surfaces.set('bitmap', surfaces.get('offscreen')!)
  }
  const chooser = createChooser([...surfaces.keys()])
  let method: HandoverMethod = 'offscreen'
  let announced = surfaces.size === 1
  /** the bitmap could not be made: the OffscreenCanvas is read instead, for good */
  let bitmapFailed = false
  const fallback = () => {
    bitmapFailed = true
    chooser.drop('bitmap')
    return compositor
  }
  return {
    begin() {
      method = chooser.next()
      return surfaces.get(method)!.ctx
    },
    take() {
      if (method !== 'bitmap' || !bitmapOf || bitmapFailed) return surfaces.get(method)!.canvas
      // the bitmap is a copy taken now: the composition may be drawn again while it is encoded
      try {
        return bitmapOf(compositor).catch(fallback)
      } catch {
        return fallback()
      }
    },
    release(source) {
      if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
    },
    record(ms) {
      chooser.record(ms)
      const chosen = announced ? null : chooser.chosen()
      if (chosen) {
        announced = true
        // the canvas of the page that lost holds a frame of memory for nothing
        const page = surfaces.get('canvas')
        if (page && chosen !== 'canvas') page.canvas.width = page.canvas.height = 0
        onChosen?.(chosen, chooser.medians())
      }
    },
  }
}
