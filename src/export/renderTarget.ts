/**
 * The length of a render, said before the start (ROADMAP 7.0): the target is minutes of rendering per minute of film
 * (10 on a phone or a tablet, 30 on a computer); above it, the settings that would make the render faster. Pure
 * (tested): the panel (`ExportPanel`) shows the sentence and the buttons, each button is a normal setting change.
 */
import type { DeviceKind } from '../core/deviceBudget'
import { CLOUD_QUALITIES } from '../weather/sceneClouds'
import type { CloudQuality } from '../weather/sceneClouds'
import type { Settings } from '../state/store'
import { effectiveRender } from './qualityTier'
import { VIDEO_QUALITIES, VIDEO_RESOLUTIONS, videoSize } from './schedule'

/** Minutes of rendering allowed for one minute of film. */
export function targetMinutesPerFilmMinute(kind: DeviceKind): number {
  return kind === 'desktop' ? 30 : 10
}

/** Seconds of rendering allowed for a film of `filmSeconds`. */
export function targetRenderSeconds(kind: DeviceKind, filmSeconds: number): number {
  return targetMinutesPerFilmMinute(kind) * filmSeconds
}

/** True when the estimate is above the target; no estimate (no history), no warning. */
export function exceedsTarget(estimateS: number | null, kind: DeviceKind, filmSeconds: number): boolean {
  return estimateS !== null && filmSeconds > 0 && estimateS > targetRenderSeconds(kind, filmSeconds)
}

export type SpeedUp =
  | { kind: 'quality'; quality: Settings['video']['quality'] }
  | { kind: 'size'; resolution: Settings['video']['resolution'] }
  | { kind: 'clouds'; quality: CloudQuality }

type Input = Pick<Settings, 'atmosphere' | 'clouds' | 'lens'> & { video: Pick<Settings['video'], 'quality' | 'resolution' | 'aspect'> }

/** Settings that make the render faster in this state: only those that change what is rendered, none already at the floor. */
export function speedUps(settings: Input, maxShortSide?: number): SpeedUp[] {
  const { video, clouds } = settings
  const out: SpeedUp[] = []
  const cloudsShown = settings.atmosphere && clouds.mode !== 'aucun'
  const now = effectiveRender(video.quality, clouds)

  const qi = VIDEO_QUALITIES.indexOf(video.quality)
  if (qi > 0) {
    const lower = VIDEO_QUALITIES[qi - 1]
    const next = effectiveRender(lower, clouds)
    const lighter = (cloudsShown && next.cloudsQuality !== now.cloudsQuality) || (settings.lens.shutter > 0 && next.maxSubFrames < now.maxSubFrames)
    if (lighter) out.push({ kind: 'quality', quality: lower })
  }

  const ri = VIDEO_RESOLUTIONS.findIndex((r) => r.id === video.resolution)
  if (ri > 0) {
    const area = (id: Settings['video']['resolution']) => {
      const s = videoSize(video.aspect, id, maxShortSide)
      return s.width * s.height
    }
    const lower = VIDEO_RESOLUTIONS[ri - 1].id
    if (area(lower) < area(video.resolution)) out.push({ kind: 'size', resolution: lower })
  }

  const ci = CLOUD_QUALITIES.indexOf(now.cloudsQuality)
  if (cloudsShown && ci > 0) out.push({ kind: 'clouds', quality: CLOUD_QUALITIES[ci - 1] })
  return out
}
