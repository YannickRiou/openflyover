/**
 * « Qualité de l'aperçu » (Réglages): a light preview draws fewer pixels, a coarser cloud pass, a smaller shadow map and
 * fewer trees. « Auto » judges the
 * device by what it does, not by its name: the frame rate measured while the film plays (`createSlowPreviewDetector`),
 * and once too slow the preview stays light for the session; « Légère » and « Complète » force it. Only the preview
 * changes: the export (video, poster, « Capturer cette image ») sets its own pixel ratio (1) and cloud pass and takes the
 * device's shadow map and trees (`sceneBudget`), its films are the same. A plain module (no three.js): the diagnostic
 * report reads it.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { deviceBudget } from '../core/deviceBudget'
import type { DeviceBudget } from '../core/deviceBudget'
import { usePreferences } from '../ui/preferences'
import type { PreviewQuality } from '../ui/shell'

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

/** Below this frame rate while the film plays, « Auto » lightens the preview. */
export const SLOW_PREVIEW_FPS = 30
/** Time played (ms) the frame rate is judged over. */
export const SLOW_PREVIEW_WINDOW_MS = 2000
/** A longer gap between two frames is a pause (hidden tab, stop): the count starts again. */
const PAUSE_GAP_MS = 1000

/** The preview limits of `budget`, lowered to `LIGHT_PREVIEW` when `light`. */
export function previewBudget(budget: PreviewBudget, light: boolean): PreviewBudget {
  const { maxPixelRatio, movingPixelRatio, cloudResolutionScale, cloudSettleFrames, shadowMapSize, maxTrees } = budget
  if (!light) return { maxPixelRatio, movingPixelRatio, cloudResolutionScale, cloudSettleFrames, shadowMapSize, maxTrees }
  return {
    maxPixelRatio: Math.min(maxPixelRatio, LIGHT_PREVIEW.maxPixelRatio),
    movingPixelRatio: Math.min(movingPixelRatio, LIGHT_PREVIEW.movingPixelRatio),
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

/** Whether the preview is light: forced, or « Auto » and measured too slow. */
export function previewIsLight(quality: PreviewQuality, slow: boolean): boolean {
  return quality === 'light' || (quality === 'auto' && slow)
}

/**
 * Times of the frames drawn while the film plays (`frame(now)`, ms): true once `SLOW_PREVIEW_WINDOW_MS` of them have a
 * median frame time over 1 / `SLOW_PREVIEW_FPS` (the median: a tile decoding now and then does not count). A gap over
 * a second restarts the count.
 */
export function createSlowPreviewDetector(): { frame(nowMs: number): boolean } {
  let last: number | undefined
  let deltas: number[] = []
  let total = 0
  return {
    frame(nowMs) {
      const delta = last === undefined ? undefined : nowMs - last
      last = nowMs
      if (delta === undefined) return false
      if (delta > PAUSE_GAP_MS) {
        deltas = []
        total = 0
        return false
      }
      deltas.push(delta)
      total += delta
      if (total < SLOW_PREVIEW_WINDOW_MS) return false
      const sorted = deltas.sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      deltas = []
      total = 0
      return median > 1000 / SLOW_PREVIEW_FPS
    },
  }
}

/** « Auto » measured a preview too slow during this session (`MeasurePreview`, FlyoverCanvas.tsx). */
export const usePreviewMeasure = create<{ slow: boolean }>()(() => ({ slow: false }))

/** Preview limits now (the diagnostic report). */
export function currentPreviewBudget(): PreviewBudget {
  return previewBudget(deviceBudget(), previewIsLight(usePreferences.getState().previewQuality, usePreviewMeasure.getState().slow))
}

/** Preview limits, again when the setting or the measure changes. */
export function usePreviewBudget(): PreviewBudget {
  const quality = usePreferences((s) => s.previewQuality)
  const slow = usePreviewMeasure((s) => s.slow)
  return useMemo(() => previewBudget(deviceBudget(), previewIsLight(quality, slow)), [quality, slow])
}
