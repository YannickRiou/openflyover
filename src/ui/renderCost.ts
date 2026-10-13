/**
 * Render weight of the settings that lengthen the export (the pictogram next to their name, the dot on their tab).
 * Tiers 0 (nothing shown) .. 3 (heaviest) are estimates derived from the factors of the code, to recalibrate on a real
 * GPU (ARCHITECTURE.md, « Poids de rendu »). A tip only gives « ≈ ×N » where N is a real multiplier of the code.
 * The weights are those of the EFFECTIVE export (what the chosen quality really uses, qualityTier.ts), and say so.
 */
import { QUALITY_NAMES, effectiveRender, presetBadge } from '../export/qualityTier'
import { videoSize } from '../export/schedule'
import { t } from '../i18n'
import { SHUTTER_SUBFRAMES } from '../scene/lens'
import type { Settings } from '../state/store'
import { EXPORT_SAMPLES } from '../weather/sceneClouds'
import { formatShort } from './format'
import type { ShellTab } from './shell'

export type WeightKey = 'clouds' | 'shutter' | 'depthOfField' | 'resolution' | 'fps'
export type WeightTier = 0 | 1 | 2 | 3
export interface Weight {
  tier: WeightTier
  /** « Allonge … le rendu : … », '' at tier 0 */
  tip: string
}

type Input = Pick<Settings, 'atmosphere' | 'clouds' | 'lens' | 'video'>

/** Spoken name of a tier (« Poids de rendu : lourd »). */
export function tierName(tier: WeightTier): string {
  return t(`export.weight.tier.${tier}`)
}

const weight = (tier: WeightTier, detail: string): Weight => ({
  tier,
  tip: tier ? t('export.weight.tip', { lead: t(`export.weight.lead.${tier as 1 | 2 | 3}`), detail }) : '',
})

/** Clouds quality of the export: 16 / 24 / 32 noise slices per frame (`EXPORT_SAMPLES`). */
const CLOUD_QUALITY_TIER = { low: 1, medium: 2, high: 3 } as const

function cloudsWeight(input: Input): Weight {
  const { atmosphere, clouds, video } = input
  if (!atmosphere || clouds.mode === 'aucun') return weight(0, '')
  // the lit surface (« Nappe ») is one draw call
  if (clouds.mode === 'mer' && clouds.seaRender === 'surface') return weight(1, t('export.weight.surface'))
  const { cloudsQuality } = effectiveRender(video.quality, clouds)
  const n = EXPORT_SAMPLES[cloudsQuality]
  const from = presetBadge(input, 'clouds')?.kind === 'preset' ? t('export.weight.imposed', { quality: QUALITY_NAMES[video.quality] }) : ''
  return weight(CLOUD_QUALITY_TIER[cloudsQuality], t('export.weight.clouds', { n, from }))
}

/** An open shutter renders every frame up to `maxSubFrames` times (8, fewer in a lighter quality), whatever its amount. */
function shutterWeight(input: Input): Weight {
  const { lens, clouds, video } = input
  const { maxSubFrames: n } = effectiveRender(video.quality, clouds)
  const lowered = presetBadge(input, 'shutter') !== null
  const detail = lowered ? t('export.weight.shutterLowered', { n, quality: QUALITY_NAMES[video.quality] }) : t('export.weight.shutterRenders', { n })
  return weight(lens.shutter > 0 ? (n >= SHUTTER_SUBFRAMES ? 3 : 2) : 0, t('export.weight.shutter', { n, detail }))
}

/** One more full-frame blur per render; repeated at each sub-frame of the open shutter, so one tier higher. */
function depthOfFieldWeight({ lens, clouds, video }: Input): Weight {
  if (lens.depthOfField <= 0) return weight(0, '')
  const { maxSubFrames: n } = effectiveRender(video.quality, clouds)
  return lens.shutter > 0
    ? weight(2, t('export.weight.dofShutter', { n }))
    : weight(1, t('export.weight.dofOnly'))
}

/** Pixels per frame against 720p (short side squared): 1, 2.25, 4, 9; a phone's smaller cap is applied. */
function resolutionWeight({ video }: Input): Weight {
  const { width, height } = videoSize(video.aspect, video.resolution)
  const short = Math.min(width, height)
  const ratio = Math.round((short / 720) ** 2 * 100) / 100
  const tier = short <= 720 ? 1 : short <= 1080 ? 2 : 3
  return weight(tier, ratio === 1 ? t('export.weight.resolutionRef') : t('export.weight.resolution', { ratio: formatShort(ratio) }))
}

/** Frames to render against 30 fps: ×0.8, ×1, ×2. */
function fpsWeight({ video }: Input): Weight {
  return weight(
    video.fps >= 60 ? 2 : 1,
    video.fps === 30 ? t('export.weight.fpsRef') : t('export.weight.fps', { ratio: formatShort(video.fps / 30) }),
  )
}

const WEIGHTS: Record<WeightKey, (settings: Input) => Weight> = {
  clouds: cloudsWeight,
  shutter: shutterWeight,
  depthOfField: depthOfFieldWeight,
  resolution: resolutionWeight,
  fps: fpsWeight,
}

/** Weight of one setting. */
export const weightOf = (settings: Input, key: WeightKey): Weight => WEIGHTS[key](settings)

/** Weight of every setting that has one. */
export function renderWeight(settings: Input): Record<WeightKey, Weight> {
  return {
    clouds: cloudsWeight(settings),
    shutter: shutterWeight(settings),
    depthOfField: depthOfFieldWeight(settings),
    resolution: resolutionWeight(settings),
    fps: fpsWeight(settings),
  }
}

/** The settings of each tab that carry a weight (the export panel is not a tab). */
const TAB_WEIGHTS: Partial<Record<ShellTab, readonly WeightKey[]>> = {
  meteo: ['clouds'],
  objectif: ['shutter', 'depthOfField'],
}

/** A setting of the tab is at its heaviest tier (the dot on its tab). */
export function tabHasHeavySetting(settings: Input, tab: ShellTab): boolean {
  return (TAB_WEIGHTS[tab] ?? []).some((key) => weightOf(settings, key).tier === 3)
}
