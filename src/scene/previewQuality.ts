/**
 * « Qualité de l'aperçu » (Réglages): a light preview draws fewer pixels, a coarser cloud pass, a smaller shadow map and
 * fewer trees. « Auto » judges the device by what it does, not by its name: the frame rate measured while the film
 * plays (`createRungGovernor`) takes the preview down a rung when it is too slow (1: light; 2, still below 24 frames per
 * second: fewer pixels while playing and the shadow map refreshed every second frame) and back up one rung when it
 * stays comfortable for a few seconds; « Légère » is rung 1 and « Complète » rung 0. A phone or tablet also draws at most
 * 60 frames per second while the film plays, 30 once light (`frameIntervalMs`). Only the preview
 * changes: the export (video, poster, « Capturer cette image ») sets its own pixel ratio (1) and cloud pass and takes the
 * device's shadow map and trees (`sceneBudget`), its films are the same. A plain module (no three.js): the diagnostic
 * report reads it.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { deviceBudget } from '../core/deviceBudget'
import type { DeviceBudget, DeviceKind } from '../core/deviceBudget'
import { usePreferences } from '../ui/preferences'
import type { PreviewQuality } from '../ui/shell'

/** 0: the device's own preview; 1: light; 2: lighter still while the film plays (« Auto » only). */
export type PreviewRung = 0 | 1 | 2

export type PreviewBudget = Pick<
  DeviceBudget,
  'maxPixelRatio' | 'movingPixelRatio' | 'cloudResolutionScale' | 'cloudSettleFrames' | 'shadowMapSize' | 'maxTrees'
>

/**
 * The light preview: a phone's pixel ratio while playing and its cloud pass, a shadow map of 2048² (~32 MB, not ~128 MB)
 * and half the computer's trees (the far forests thin first, forestPoints.ts); a device already lower keeps its own.
 */
export const LIGHT_PREVIEW: PreviewBudget = {
  maxPixelRatio: 1.5,
  movingPixelRatio: 1,
  cloudResolutionScale: 0.5,
  cloudSettleFrames: 16,
  shadowMapSize: 2048,
  maxTrees: 125_000,
}

/** Pixel ratio while moving at rung 2 (below 1: the canvas is drawn smaller than its CSS size). */
export const RUNG2_MOVING_PIXEL_RATIO = 0.75
/** Below this frame rate while the film plays, « Auto » lightens the preview. */
export const SLOW_PREVIEW_FPS = 30
/** Below this one at rung 1, « Auto » goes to rung 2. */
export const SLOWER_PREVIEW_FPS = 24
/** Mean frame rate (capped by 90 % of the frame cap) that counts as comfortable, for `RECOVER_WINDOWS` windows in a row. */
export const COMFORT_PREVIEW_FPS = 50
/** Windows (2 s each) of comfort before « Auto » steps back a rung; doubled by each step back, so no oscillation. */
export const RECOVER_WINDOWS = 3
/** Frame rate caps while the film plays on a phone or tablet: the device's own, and with a light preview. */
export const PLAYBACK_FPS = 60
export const LIGHT_PLAYBACK_FPS = 30
/** Time played (ms) the frame rate is judged over. */
export const SLOW_PREVIEW_WINDOW_MS = 2000
/** A longer gap between two frames is a pause (hidden tab, stop): the count starts again. */
const PAUSE_GAP_MS = 1000

/** The preview limits of `budget`, lowered to `LIGHT_PREVIEW` from rung 1, and to a smaller pixel ratio while moving at rung 2. */
export function previewBudget(budget: PreviewBudget, rung: PreviewRung): PreviewBudget {
  const { maxPixelRatio, movingPixelRatio, cloudResolutionScale, cloudSettleFrames, shadowMapSize, maxTrees } = budget
  if (rung === 0) return { maxPixelRatio, movingPixelRatio, cloudResolutionScale, cloudSettleFrames, shadowMapSize, maxTrees }
  return {
    maxPixelRatio: Math.min(maxPixelRatio, LIGHT_PREVIEW.maxPixelRatio),
    movingPixelRatio: Math.min(movingPixelRatio, rung === 2 ? RUNG2_MOVING_PIXEL_RATIO : LIGHT_PREVIEW.movingPixelRatio),
    cloudResolutionScale: Math.min(cloudResolutionScale, LIGHT_PREVIEW.cloudResolutionScale),
    cloudSettleFrames: Math.min(cloudSettleFrames, LIGHT_PREVIEW.cloudSettleFrames),
    shadowMapSize: Math.min(shadowMapSize, LIGHT_PREVIEW.shadowMapSize),
    maxTrees: Math.min(maxTrees, LIGHT_PREVIEW.maxTrees),
  }
}

/** Shadow map and trees to draw: the preview's, but always the device's own while exporting (video, poster, capture). */
export function sceneBudget(preview: PreviewBudget, exporting: boolean, device: PreviewBudget = deviceBudget()): Pick<PreviewBudget, 'shadowMapSize' | 'maxTrees'> {
  const { shadowMapSize, maxTrees } = exporting ? device : preview
  return { shadowMapSize, maxTrees }
}

/** Rung of the preview: « Légère » is 1, « Complète » 0, « Auto » the rung measured (`createRungGovernor`). */
export function previewRung(quality: PreviewQuality, measured: PreviewRung): PreviewRung {
  return quality === 'light' ? 1 : quality === 'full' ? 0 : measured
}

/** Shortest time (ms) between two frames while the film plays: 0 on a computer, 1000 / 60 or, from rung 1, 1000 / 30 on a phone or tablet. */
export function frameIntervalMs(kind: DeviceKind, rung: PreviewRung): number {
  return kind === 'desktop' ? 0 : 1000 / (rung > 0 ? LIGHT_PLAYBACK_FPS : PLAYBACK_FPS)
}

/**
 * `autoUpdate` and `needsUpdate` of the sun's shadow map for the frame number `frame`: drawn on each frame, or, when
 * `halved` (rung 2 while the film plays), on every second one and on the first, while the map does not exist yet. A frame
 * that does not draw it samples the previous one, with its own matrix.
 */
export function shadowRefresh(halved: boolean, frame: number, mapReady: boolean): { autoUpdate: boolean; needsUpdate: boolean } {
  return { autoUpdate: !halved, needsUpdate: halved && (!mapReady || frame % 2 === 0) }
}

/**
 * Keeps the frames at least `interval` ms apart on a display that ticks faster (`allow(now, interval)` at each tick,
 * ms). The next frame is due `interval` after the last one was due, so a 90 Hz display averages the cap (a frame every
 * 11 or 22 ms for 60) rather than dropping to half; a stall does not bring a burst of frames. 0: no cap.
 */
export function createFrameCap(): { allow(nowMs: number, interval: number): boolean } {
  let due: number | undefined
  return {
    allow(now, interval) {
      if (interval <= 0) {
        due = undefined
        return true
      }
      // a millisecond of slack: a tick lands a hair before its due time as often as a hair after
      if (due !== undefined && now + 1 < due) return false
      due = due === undefined ? now + interval : Math.max(due + interval, now)
      return true
    },
  }
}

/**
 * Mean and median frame time (ms) of each `SLOW_PREVIEW_WINDOW_MS` of the frames drawn while the film plays (`frame(now)`,
 * ms; undefined until the window is full). The median: a tile decoding now and then does not count. A gap over a second
 * restarts the count.
 */
function createFrameWindow(): { frame(nowMs: number): { medianMs: number; meanMs: number } | undefined } {
  let last: number | undefined
  let deltas: number[] = []
  let total = 0
  return {
    frame(nowMs) {
      const delta = last === undefined ? undefined : nowMs - last
      last = nowMs
      if (delta === undefined) return undefined
      if (delta > PAUSE_GAP_MS) {
        deltas = []
        total = 0
        return undefined
      }
      deltas.push(delta)
      total += delta
      if (total < SLOW_PREVIEW_WINDOW_MS) return undefined
      const sorted = deltas.sort((a, b) => a - b)
      const found = { medianMs: sorted[Math.floor(sorted.length / 2)], meanMs: total / deltas.length }
      deltas = []
      total = 0
      return found
    },
  }
}

/**
 * Rung of « Auto », from the frames drawn while the film plays (`frame(now, capFps)`: the time of the frame, ms, and the
 * rate the frame cap allows, Infinity without one; returns the rung). Down one rung when a window's median is under
 * `SLOW_PREVIEW_FPS` (rung 0) or `SLOWER_PREVIEW_FPS` (rung 1); up one when its mean has been at `COMFORT_PREVIEW_FPS`
 * (90 % of the cap if lower, since a capped preview cannot go beyond it) for `RECOVER_WINDOWS` windows in a row, a wait
 * that doubles each time so a device that cannot hold the heavier rung does not flip-flop. The count starts again at a rung change.
 */
export function createRungGovernor(): { frame(nowMs: number, capFps?: number): PreviewRung } {
  const window = createFrameWindow()
  let rung: PreviewRung = 0
  let comfortable = 0
  let wait = RECOVER_WINDOWS
  return {
    frame(nowMs, capFps = Infinity) {
      const found = window.frame(nowMs)
      if (!found) return rung
      if (rung < 2 && 1000 / found.medianMs < (rung === 0 ? SLOW_PREVIEW_FPS : SLOWER_PREVIEW_FPS)) {
        rung++
        comfortable = 0
      } else if (rung > 0 && 1000 / found.meanMs >= Math.min(COMFORT_PREVIEW_FPS, 0.9 * capFps)) {
        if (++comfortable >= wait) {
          rung--
          comfortable = 0
          wait *= 2
        }
      } else comfortable = 0
      return rung
    },
  }
}

/** Rung « Auto » measured during this session (`MeasurePreview`, FlyoverCanvas.tsx). */
export const usePreviewMeasure = create<{ rung: PreviewRung }>()(() => ({ rung: 0 }))

/** Rung of the preview now. */
export function currentPreviewRung(): PreviewRung {
  return previewRung(usePreferences.getState().previewQuality, usePreviewMeasure.getState().rung)
}

/** Preview limits now (the diagnostic report). */
export function currentPreviewBudget(): PreviewBudget {
  return previewBudget(deviceBudget(), currentPreviewRung())
}

/** Preview limits, again when the setting or the measure changes. */
export function usePreviewBudget(): PreviewBudget {
  const quality = usePreferences((s) => s.previewQuality)
  const measured = usePreviewMeasure((s) => s.rung)
  return useMemo(() => previewBudget(deviceBudget(), previewRung(quality, measured)), [quality, measured])
}
