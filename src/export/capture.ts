/**
 * Frame capture helpers of the video export (no React): render a progress until the terrain is complete,
 * then compose the WebGL image and the optional 2D overlay into the encoder canvas (or the overlay alone over a
 * transparent background).
 */
import type { OverlayTime } from '../overlay/draw'
import { ExportCanceledError } from './encoder'

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
  /** give up waiting for the terrain after this long (per frame) and capture what is there */
  timeoutMs: number
  /** wait between tile requests while tiles are loading */
  pollMs: number
}

export const DEFAULT_SETTLE: SettleOptions = { minAdvances: 1, timeoutMs: 45_000, pollMs: 16 }

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

/**
 * Show `progress` and wait for its terrain. The camera is placed once per progress change with the heights
 * loaded at that moment: when the final terrain moves that placement by more than REPLACE_TOLERANCE_M, it is
 * placed once more (at a progress REPLACE_EPSILON away, invisible) so the ground clearance uses the final
 * terrain. Not after a timeout: the terrain would not settle any better the second time. Then, when the clouds
 * have slices to compute (`separateFinal`), the one final render that is captured: they run once per frame
 * whatever the number of settle renders. That render selects the tiles once more: if its selection asks for any
 * (the view moved since the last check), the frame settles again and is rendered again. One timeout covers all of it.
 * Resolves false when the view was not final at the capture: timeout, or tiles given up on (`missingTiles`).
 */
export async function renderSettledFrame(
  progress: number,
  deps: RenderFrameDeps,
  options: SettleOptions = DEFAULT_SETTLE,
): Promise<boolean> {
  const start = deps.now()
  const left = (): SettleOptions => ({ ...options, timeoutMs: Math.max(0, options.timeoutMs - (deps.now() - start)) })
  const deferred = deps.separateFinal()
  deps.setProgress(progress)
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
  return complete && (deps.missingTiles?.() ?? 0) === 0
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

/** Resolve after `ms`; 0 yields to the event loop through a message port (not throttled in background tabs). */
export function wait(ms: number): Promise<void> {
  if (ms > 0) return new Promise((resolve) => setTimeout(resolve, ms))
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
