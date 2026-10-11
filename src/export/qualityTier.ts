/**
 * Render tier of the export quality (« Standard / Haute / Maximale »): besides the bitrate (`encoder.ts`), the quality
 * picks how much the costly effects are computed in the export (ARCHITECTURE.md, « Qualité d'export »). A pure
 * function of the quality, applied at export time only: the project is never rewritten, the preview is unchanged.
 *
 * Precedence: a value chosen by hand wins over the tier. Only `settings.clouds.quality` can be chosen by hand ('auto'
 * follows the tier); the sub-frame cap has no setting of its own and only ever lowers the 8 of `SHUTTER_SUBFRAMES`.
 */
import { SHUTTER_SUBFRAMES } from '../scene/lens'
import type { Settings } from '../state/store'
import type { CloudQuality } from '../weather/sceneClouds'
import type { VideoQuality } from './schedule'

export interface QualityTier {
  /** export quality of the clouds (`EXPORT_SAMPLES` slices per frame) */
  cloudsQuality: CloudQuality
  /** most renders per frame with the motion blur on (`adaptiveShutterSamples`) */
  maxSubFrames: number
}

export const QUALITY_TIERS: Record<VideoQuality, QualityTier> = {
  standard: { cloudsQuality: 'low', maxSubFrames: 4 },
  high: { cloudsQuality: 'medium', maxSubFrames: SHUTTER_SUBFRAMES },
  max: { cloudsQuality: 'high', maxSubFrames: SHUTTER_SUBFRAMES },
}

/** Name of each quality in the UI (the badge « Imposé par Haute »). */
export const QUALITY_NAMES: Record<VideoQuality, string> = { standard: 'Standard', high: 'Haute', max: 'Maximale' }

/** Name of each clouds quality in the UI. */
export const CLOUD_QUALITY_NAMES: Record<CloudQuality, string> = { low: 'Rapide', medium: 'Moyenne', high: 'Fine' }

export const qualityTier = (quality: VideoQuality): QualityTier => QUALITY_TIERS[quality] ?? QUALITY_TIERS.high

type Input = Pick<Settings, 'atmosphere' | 'clouds' | 'lens' | 'video'>

/** What an export of `quality` really uses: the clouds' hand-chosen quality over the tier's, the tier's sub-frame cap. */
export function effectiveRender(quality: VideoQuality, clouds: Pick<Settings['clouds'], 'quality'>): QualityTier & { cloudsByHand: boolean } {
  const tier = qualityTier(quality)
  const cloudsByHand = clouds.quality !== 'auto'
  return { cloudsQuality: clouds.quality === 'auto' ? tier.cloudsQuality : clouds.quality, maxSubFrames: tier.maxSubFrames, cloudsByHand }
}

/** The settings rows a quality drives. */
export type PresetKnob = 'clouds' | 'shutter'

export interface PresetBadge {
  /** 'preset': taken from the quality; 'custom': chosen by hand, over the quality */
  kind: 'preset' | 'custom'
  text: string
}

/**
 * The badge of a driven row, null when the quality changes nothing there: no clouds (« Aucun », or no atmosphere), no
 * motion blur, or a sub-frame cap that is not below the full 8.
 */
export function presetBadge(settings: Input, knob: PresetKnob): PresetBadge | null {
  const name = QUALITY_NAMES[settings.video.quality] ?? QUALITY_NAMES.high
  if (knob === 'shutter') {
    const lowered = settings.lens.shutter > 0 && qualityTier(settings.video.quality).maxSubFrames < SHUTTER_SUBFRAMES
    return lowered ? { kind: 'preset', text: `Imposé par ${name}` } : null
  }
  if (!settings.atmosphere || settings.clouds.mode === 'aucun') return null
  return settings.clouds.quality === 'auto' ? { kind: 'preset', text: `Imposé par ${name}` } : { kind: 'custom', text: 'Personnalisé' }
}

/** A row driven by the quality was set by hand: the quality selector reads « Personnalisé ». */
export function isCustomised(settings: Input): boolean {
  return presetBadge(settings, 'clouds')?.kind === 'custom'
}
