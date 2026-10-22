/**
 * Frame capture helpers of the video export (no React): render a progress until the terrain is complete,
 * then compose the WebGL image and the optional 2D overlay into the encoder canvas (or the overlay alone over a
 * transparent background).
 */
import type { OverlayTime } from '../overlay/draw'
import type { TileFailure } from '../terrain/engine'
import { ExportCanceledError } from './encoder'
import { t } from '../i18n'

/** Where a composed frame is: its progress and its place in the film (film time, clock lengths). */
export interface FrameAt {
  progress: number
  time: OverlayTime
}

/** 2D film overlay (titles, widgets, texts, credits) drawn over each frame, at the video resolution. */
export type DrawOverlay = (ctx: OffscreenCanvasRenderingContext2D, at: FrameAt, width: number, height: number) => void

export interface SettleOptions {
  /**
   * Renders per frame at least. One is enough: in a single `advance` the flyover rig places the camera before
   * TerrainLayer selects the tiles for it (useFrame order), and the shadows and post-process follow the camera.
   */
  minAdvances: number
  /** stop waiting for the terrain after this long (per frame): the export then fails (`tileFailureMessage`) */
  timeoutMs: number
  /** wait between tile requests while tiles are loading */
  pollMs: number
}

/**
 * 5 min per frame: longer than two retry chains of the engine in a row (8 attempts over ~2.2 min each, engine.ts), so a
 * tile that may still come is waited for, and a view whose tiles keep failing ends on « given up » (named tiles)
 * rather than on this timeout.
 */
export const DEFAULT_SETTLE: SettleOptions = { minAdvances: 1, timeoutMs: 300_000, pollMs: 16 }

/** Offset used to make the flyover rig place the camera again at (almost) the same progress. */
export const REPLACE_EPSILON = 1e-9
/** The camera is placed again only when the final terrain moves its placement by more than this (metres). */
export const REPLACE_TOLERANCE_M = 1

export interface SettleDeps {
  /** render one frame (R3F `advance`); `final`: the frame that gets captured, the only one that pays for the clouds */
  advance(final: boolean): void
  /** the clouds have slices to compute: only the last render of a frame is made with them (`renderSettledFrame`) */
  separateFinal(): boolean
  /** request the tiles of the current camera without rendering (`engine.update`) */
  updateTiles(): void
  /**
   * tiles the current view still waits for (`stats.pendingVisibleTiles`): loading or queued with their imagery, retries of
   * failed ones included, and any that the selection of the last update would still request
   */
  pendingTiles(): number
  /** tiles of the view that will not get any better (`stats.missingVisibleTiles`): given up on, or without all their imagery */
  missingTiles?(): number
  /** run the debounced re-drapes of the track and labels now; true when one ran */
  flushDrapes(): boolean
  now(): number
  wait(ms: number): Promise<void>
  isCanceled(): boolean
}

export interface RenderFrameDeps extends SettleDeps {
  setProgress(progress: number): void
  /**
   * How far (metres) the camera placement for the current progress, computed with the terrain loaded now,
   * is from the placement in use (position, and target off the line of sight).
   */
  cameraDrift(): number
}

/**
 * Render until the view waits for no tile (at least `minAdvances` renders), then run the pending re-drapes
 * and render once more if one ran. While tiles load, only their requests follow (`updateTiles`, no render):
 * the next render comes once the view has them, or at the timeout. Resolves true when settled, false on
 * timeout; throws ExportCanceledError when canceled. With `separateFinal` these renders are all intermediate
 * (no clouds, no render after the re-drapes): `renderSettledFrame` makes the final one. Otherwise the last frame
 * is still in the WebGL drawing buffer when the promise settles: capture it right away, without awaiting
 * anything else first.
 */
export async function settle(deps: SettleDeps, options: SettleOptions = DEFAULT_SETTLE): Promise<boolean> {
  const start = deps.now()
  const timedOut = () => deps.now() - start >= options.timeoutMs
  const deferred = deps.separateFinal()
  for (let n = 1; ; n++) {
    deps.advance(!deferred)
    const done = n >= options.minAdvances && deps.pendingTiles() === 0
    if (done || timedOut()) {
      if (deps.flushDrapes() && !deferred) deps.advance(true)
      return done
    }
    do {
      if (deps.isCanceled()) throw new ExportCanceledError()
      await deps.wait(deps.pendingTiles() > 0 ? options.pollMs : 0)
      deps.updateTiles()
    } while (deps.pendingTiles() > 0 && !timedOut())
  }
}

/** How a frame was captured: its view final, or not after the timeout, or with tiles given up on. */
export type FrameOutcome = 'complete' | 'timeout' | 'missing'

/**
 * Show `progress` and wait for its terrain. The camera is placed once per progress change with the heights
 * loaded at that moment: when the final terrain moves that placement by more than REPLACE_TOLERANCE_M, it is
 * placed once more (at a progress REPLACE_EPSILON away, invisible) so the ground clearance uses the final
 * terrain. Not after a timeout: the terrain would not settle any better the second time. Then, when the clouds
 * have slices to compute (`separateFinal`), the one final render that is captured: they run once per frame
 * whatever the number of settle renders. That render selects the tiles once more: if its selection asks for any
 * (the view moved since the last check), the frame settles again and is rendered again. One timeout covers all of it.
 * `finalFirst` (the previous frame needed no wait): with the clouds, the final render comes first; when it asks for
 * no tile, runs no re-drape and leaves the camera in place, it is the very image the usual way would capture (same
 * camera, tiles and drapes: the extra render without the clouds changed nothing), so the frame costs one render
 * instead of two. Otherwise the frame goes the usual way (that render was an intermediate one).
 * Resolves 'timeout' or 'missing' (tiles given up on, `missingTiles`) when the view was not final at the capture.
 */
export async function renderSettledFrame(
  progress: number,
  deps: RenderFrameDeps,
  options: SettleOptions = DEFAULT_SETTLE,
  finalFirst = false,
): Promise<FrameOutcome> {
  const start = deps.now()
  const left = (): SettleOptions => ({ ...options, timeoutMs: Math.max(0, options.timeoutMs - (deps.now() - start)) })
  const outcome = (complete: boolean): FrameOutcome => (!complete ? 'timeout' : (deps.missingTiles?.() ?? 0) > 0 ? 'missing' : 'complete')
  const deferred = deps.separateFinal()
  deps.setProgress(progress)
  if (deferred && finalFirst && options.minAdvances <= 1) {
    deps.advance(true)
    if (deps.pendingTiles() === 0 && !deps.flushDrapes() && deps.cameraDrift() <= REPLACE_TOLERANCE_M) return outcome(true)
  }
  let complete = await settle(deps, options)
  if (complete && deps.cameraDrift() > REPLACE_TOLERANCE_M) {
    deps.setProgress(progress < 1 ? progress + REPLACE_EPSILON : progress - REPLACE_EPSILON)
    complete = await settle(deps, left())
  }
  if (deferred) deps.advance(true)
  while (complete && deps.pendingTiles() > 0) {
    complete = await settle(deps, left())
    if (deferred) deps.advance(true)
  }
  return outcome(complete)
}

/** Tiles named in the error, the others counted. */
const NAMED_TILES = 3

/**
 * Error of an export stopped on a frame without its terrain (`frame` counted from 1): the tiles given up on, or still
 * loading at the timeout, with their host and cause.
 */
export function tileFailureMessage(
  outcome: Exclude<FrameOutcome, 'complete'>,
  frame: number,
  failures: readonly TileFailure[],
  pending: number,
  timeoutMs: number,
): string {
  const named = failures.slice(0, NAMED_TILES).map((f) => t('export.capture.failure', { count: f.attempts, host: f.host, tile: f.tile, layer: f.layer, cause: f.cause, attempts: f.attempts }))
  const more = failures.length - named.length
  const list = [...named, ...(more > 0 ? [t('export.capture.more', { count: more })] : [])].join(' ; ')
  const head =
    outcome === 'missing'
      ? t('export.capture.missing', { frame })
      : t('export.capture.timeout', { min: Math.round(timeoutMs / 60_000), frame, pending })
  return list ? t('export.capture.stoppedList', { head, list }) : t('export.capture.stopped', { head })
}

/** Sky gradient behind a transparent canvas (mirrors the CSS background of FlyoverCanvas: glacier → paper). */
const SKY_GRADIENT: readonly [string, string] = ['#A9CCD9', '#F5F2EA']

/** Fill a box with the sky gradient, top to bottom (behind a film frame, or the poster's placeholder view). */
export function fillSky(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sky = ctx.createLinearGradient(0, y, 0, y + height)
  sky.addColorStop(0, SKY_GRADIENT[0])
  sky.addColorStop(1, SKY_GRADIENT[1])
  ctx.fillStyle = sky
  ctx.fillRect(x, y, width, height)
}

/** Encoder canvas content for one frame: sky gradient, WebGL image scaled to the video size, overlay. */
export function composeFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  at: FrameAt,
  width: number,
  height: number,
  drawOverlay?: DrawOverlay,
): void {
  fillSky(ctx, 0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  drawOverlayOn(ctx, at, width, height, drawOverlay)
}

/** Encoder canvas content for one frame of the overlay alone: cleared to transparent, then the overlay. */
export function composeOverlayFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  at: FrameAt,
  width: number,
  height: number,
  drawOverlay?: DrawOverlay,
): void {
  ctx.clearRect(0, 0, width, height)
  drawOverlayOn(ctx, at, width, height, drawOverlay)
}

/** The overlay drawn without leaking its context state (transforms, styles) into the next frame. */
function drawOverlayOn(
  ctx: OffscreenCanvasRenderingContext2D,
  at: FrameAt,
  width: number,
  height: number,
  drawOverlay?: DrawOverlay,
): void {
  if (!drawOverlay) return
  ctx.save()
  try {
    drawOverlay(ctx, at, width, height)
  } finally {
    ctx.restore()
  }
}

/**
 * Let the page handle its input and paint between two frames of an export: `scheduler.yield()` where the browser has
 * it (the continuation keeps its priority), else a message port (`wait(0)`, not throttled in background tabs).
 */
export function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  return typeof scheduler?.yield === 'function' ? scheduler.yield() : wait(0)
}

/** What `wait` reads of the page (a test hands its own). */
export interface WaitHost {
  /** the page is not shown: hidden tab, minimised or covered window */
  hidden(): boolean
  now(): number
  /** a timer that a hidden page does not throttle (`workerSleep`); null: none, the wait spins through message ports */
  sleep?(ms: number): Promise<void> | null
}

/**
 * A timer in a dedicated Web Worker. Chrome and Edge throttle the timers of a hidden page (once a second, once a minute
 * after five minutes: "intensive throttling") but not those of its dedicated workers, which run their own event loop at
 * full rate: the worker runs `setTimeout` and posts a message back, and a message is neither delayed nor throttled in a
 * hidden page (the same property `turn` relies on). `create` makes the worker (an inline Blob URL: the CSP of the desktop
 * app allows `worker-src blob:`); where it cannot (no Worker, CSP, a test), `sleep` returns null and `wait` falls back to
 * `turn`. A worker that fails after the start frees its pending sleeps early: the callers poll again.
 */
export function createWorkerSleep(create: () => Worker): (ms: number) => Promise<void> | null {
  let worker: Worker | null | undefined
  let next = 0
  const pending = new Map<number, () => void>()
  const give = () => {
    worker = null
    for (const resolve of pending.values()) resolve()
    pending.clear()
  }
  return (ms) => {
    if (worker === undefined) {
      try {
        worker = create()
        worker.onmessage = (event: MessageEvent<number>) => {
          pending.get(event.data)?.()
          pending.delete(event.data)
        }
        worker.onerror = give
      } catch {
        worker = null
      }
    }
    const current = worker
    if (!current) return null
    return new Promise((resolve) => {
      const id = next++
      pending.set(id, resolve)
      current.postMessage({ id, ms })
    })
  }
}

const WORKER_SOURCE = 'onmessage=(e)=>{const{id,ms}=e.data;setTimeout(()=>postMessage(id),ms)}'

const workerSleep = createWorkerSleep(() => new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))))

const pageHost: WaitHost = {
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  now: () => performance.now(),
  sleep: workerSleep,
}

/** One turn of the event loop through a message port: neither delayed nor throttled in a page that is not shown. */
function turn(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * Resolve after `ms`. A page that is shown waits with a timer. A hidden page cannot: its timers fire once a second at
 * best (once a minute after five minutes), which would slow the tile polls of an export a hundredfold, so it waits on
 * the timer of a worker (`createWorkerSleep`, no processor use), or, where no worker can be made, turn by turn through
 * message ports until the deadline (a processor core kept busy). 0 only yields to the event loop.
 */
export async function wait(ms: number, host: WaitHost = pageHost): Promise<void> {
  if (ms <= 0) return turn()
  if (!host.hidden()) return new Promise((resolve) => setTimeout(resolve, ms))
  const slept = host.sleep?.(ms)
  if (slept) return slept
  const deadline = host.now() + ms
  do await turn()
  while (host.now() < deadline)
}
