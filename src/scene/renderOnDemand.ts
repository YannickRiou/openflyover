/**
 * Rendering on demand: the canvas (`frameloop="demand"`) draws only while something moves, instead of 60 times a
 * second while the view sits still (ARCHITECTURE.md "On-demand rendering"). A frame is asked for every frame while the
 * film plays, tiles load or the camera fits; for WAKE_FRAMES frames after any change of the stores the scene reads
 * (`wakeScene`), long enough for the temporal upscaling of the clouds to fill (~16 frames); by the clouds until a still
 * view has averaged CLOUD_SETTLE_FRAMES frames; and by the orbit controls and R3F themselves.
 * The video export drives its frames itself (`frameloop` 'never', see ExportController). While the film plays on a phone
 * or tablet the preview is also capped at 60 frames per second, 30 with a light preview (`playbackFrameIntervalMs`).
 */
import { useEffect } from 'react'
import { addAfterEffect, addEffect, invalidate, useFrame, useThree } from '@react-three/fiber'
import { DefaultLoadingManager } from 'three'
import { deviceBudget } from '../core/deviceBudget'
import { isExportBusy, useExportStore } from '../export/store'
import { useRegionStore } from '../osm/region'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { useLabelSources } from './labelSources'
import { createFrameCap, currentPreviewRung, frameIntervalMs } from './previewQuality'
import { useTerrainContext } from './terrainContext'

/** Frames drawn after a change (~0.5 s at 60 frames per second). */
export const WAKE_FRAMES = 30
/** Longest time step a frame may take after an idle period (seconds): playback and animations do not jump. */
export const MAX_FRAME_DELTA_S = 0.25

let remaining = 0
/** true once no frame was asked for: the clock still counts the pause */
let idle = false
let sceneClock: { getDelta(): number } | null = null

/** Draw the next `frames` frames (default WAKE_FRAMES). */
export function wakeScene(frames = WAKE_FRAMES): void {
  remaining = Math.max(remaining, frames)
  // the first frame after a pause would get the whole pause as its time step: start the step from now
  if (idle) {
    sceneClock?.getDelta()
    idle = false
  }
  invalidate()
}

/** Time step of a frame, bounded: the first frame after an idle period would otherwise span the whole pause. */
export function frameDelta(delta: number): number {
  return Math.min(delta, MAX_FRAME_DELTA_S)
}

/** Shortest time (ms) between two frames now: the cap of a phone or tablet while the film plays, never during an export; 0 = none. */
export function playbackFrameIntervalMs(): number {
  if (!useAppStore.getState().playback.playing || isExportBusy(useExportStore.getState().phase)) return 0
  return frameIntervalMs(deviceBudget().kind, currentPreviewRung())
}

/**
 * Frame cap, at the start of each tick of R3F's loop: on a tick that comes too soon the frames asked for are dropped, so
 * the loop stops without drawing, and asked again at once, which draws the next tick. Done to the loop, not to the
 * invalidations: the clouds and the controls ask for frames too. True when the tick is held back.
 */
export function holdBackFrame(cap: ReturnType<typeof createFrameCap>, internal: { frames: number }, timestamp: number): boolean {
  if (cap.allow(timestamp, playbackFrameIntervalMs())) return false
  internal.frames = 0
  queueMicrotask(() => invalidate())
  return true
}

/** The loop's current tick drew nothing: the cap held it back (see `useRenderOnDemand`). */
let skipped = false

/** `addAfterEffect` for what follows the frames drawn (the loop also runs the tick the cap skips). */
export function addFrameEffect(callback: (timestamp: number) => void): () => void {
  return addAfterEffect((timestamp) => {
    if (!skipped) callback(timestamp)
  })
}

/** Still frames the preview clouds average before the scene may sleep (CloudsLayer): 32, 16 on a phone or tablet or with a light preview (`usePreviewBudget`). */
export const CLOUD_SETTLE_FRAMES = deviceBudget().cloudSettleFrames

/** Cloud pass of a preview frame (CloudsLayer). */
export interface PreviewCloudPass {
  /** temporal upscaling: one pixel in 16 marched per frame, the others reprojected */
  upscale: boolean
  /** weight of this frame in the running average of the frames (without upscaling) */
  alpha: number
  /** ask for one more frame */
  more: boolean
}

/**
 * Cloud pass of a preview frame whose view has not changed for `still` frames (0: it just changed). Temporal
 * upscaling is cheap while the view moves, but it never averages: each pixel keeps the one noisy ray marched for it,
 * a grain a still view would keep for good. Once still, every pixel of the pass is marched and the frames are
 * averaged (1/1 discards the upscaled history, then 1/2 … 1/`settleFrames`), frames asked for until then.
 */
export function previewCloudPass(still: number, settleFrames = CLOUD_SETTLE_FRAMES): PreviewCloudPass {
  if (still <= 0) return { upscale: true, alpha: 1, more: true }
  return { upscale: false, alpha: 1 / Math.min(still, settleFrames), more: still < settleFrames }
}

/** Keys of the app store whose change does not touch the scene (`terrainStats` is written by the scene itself). */
const QUIET_KEYS = new Set(['terrainStats', 'loading'])

/** True when a change of the app store from `previous` to `state` may change the scene (any key but the quiet ones). */
export function sceneChanged<T extends object>(state: T, previous: T): boolean {
  return (Object.keys(state) as (keyof T)[]).some((key) => !QUIET_KEYS.has(key as string) && state[key] !== previous[key])
}

/** Mounted once inside the terrain layer: keeps frames coming while needed (see above). */
export function useRenderOnDemand(): void {
  const { engine } = useTerrainContext()
  const clock = useThree((s) => s.clock)
  const internal = useThree((s) => s.internal)
  useEffect(() => {
    sceneClock = clock
    return () => {
      if (sceneClock === clock) sceneClock = null
    }
  }, [clock])

  useEffect(() => {
    const cap = createFrameCap()
    const stop = addEffect((timestamp) => {
      skipped = holdBackFrame(cap, internal, timestamp)
    })
    return () => {
      stop()
      skipped = false
    }
  }, [internal])

  useFrame(() => {
    const busy = useAppStore.getState().playback.playing || (engine?.stats.pendingTiles ?? 0) > 0
    if (remaining > 0) remaining--
    if (busy || remaining > 0) invalidate()
    else idle = true
  })

  useEffect(() => {
    const wake = () => wakeScene()
    const unsubscribe = [
      useAppStore.subscribe((state, previous) => {
        if (sceneChanged(state, previous)) wake()
      }),
      useWeatherStore.subscribe(wake),
      useRegionStore.subscribe(wake),
      useLabelSources.subscribe(wake),
      useExportStore.subscribe(wake),
    ]
    // textures of the sky and the clouds load through three's loaders
    const { onLoad, onProgress } = DefaultLoadingManager
    DefaultLoadingManager.onLoad = () => {
      onLoad?.()
      wake()
    }
    DefaultLoadingManager.onProgress = (...args) => {
      onProgress?.(...args)
      wake()
    }
    wake()
    return () => {
      for (const stop of unsubscribe) stop()
      DefaultLoadingManager.onLoad = onLoad
      DefaultLoadingManager.onProgress = onProgress
    }
  }, [])
}
