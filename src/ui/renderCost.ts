/**
 * Render weight of the settings that lengthen the export (the pictogram next to their name, the dot on their tab).
 * Tiers 0 (nothing shown) .. 3 (heaviest) are estimates derived from the factors of the code, to recalibrate on a real
 * GPU (ARCHITECTURE.md, « Poids de rendu »). A tip only gives « ≈ ×N » where N is a real multiplier of the code.
 */
import { videoSize } from '../export/schedule'
import { SHUTTER_SUBFRAMES } from '../scene/lens'
import type { Settings } from '../state/store'
import { EXPORT_SAMPLES } from '../weather/sceneClouds'
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
export const TIER_NAMES = ['aucun', 'léger', 'moyen', 'lourd'] as const

const LEAD = ['', 'Allonge un peu le rendu', 'Allonge le rendu', 'Allonge beaucoup le rendu'] as const
const weight = (tier: WeightTier, detail: string): Weight => ({
  tier,
  tip: tier ? `${LEAD[tier]} : ${detail}` : '',
})
const comma = (n: number) => String(n).replace('.', ',')

/** Clouds quality of the export: 16 / 24 / 32 noise slices per frame (`EXPORT_SAMPLES`). */
const CLOUD_QUALITY_TIER = { low: 1, medium: 2, high: 3 } as const

function cloudsWeight({ atmosphere, clouds }: Input): Weight {
  if (!atmosphere || clouds.mode === 'aucun') return weight(0, '')
  // the lit surface (« Nappe ») is one draw call
  if (clouds.mode === 'mer' && clouds.seaRender === 'surface') return weight(1, 'une seule surface à dessiner')
  const n = EXPORT_SAMPLES[clouds.quality]
  return weight(CLOUD_QUALITY_TIER[clouds.quality], `≈ ×${n} sur les nuages (${n} passes par image)`)
}

/** An open shutter renders every frame `SHUTTER_SUBFRAMES` times, whatever its amount. */
function shutterWeight({ lens }: Input): Weight {
  return weight(lens.shutter > 0 ? 3 : 0, `≈ ×${SHUTTER_SUBFRAMES} (${SHUTTER_SUBFRAMES} rendus par image)`)
}

/** One more full-frame blur per render; repeated at each sub-frame of the open shutter, so one tier higher. */
function depthOfFieldWeight({ lens }: Input): Weight {
  if (lens.depthOfField <= 0) return weight(0, '')
  return lens.shutter > 0
    ? weight(2, `refait à chacun des ${SHUTTER_SUBFRAMES} rendus de l’image (flou de bougé)`)
    : weight(1, 'un passage de flou en plus par rendu')
}

/** Pixels per frame against 720p (short side squared): 1, 2.25, 4, 9; a phone's smaller cap is applied. */
function resolutionWeight({ video }: Input): Weight {
  const { width, height } = videoSize(video.aspect, video.resolution)
  const short = Math.min(width, height)
  const ratio = Math.round((short / 720) ** 2 * 100) / 100
  const tier = short <= 720 ? 1 : short <= 1080 ? 2 : 3
  return weight(tier, ratio === 1 ? 'le moins de pixels (référence ×1)' : `≈ ×${comma(ratio)} de pixels par rapport au 720p`)
}

/** Frames to render against 30 fps: ×0.8, ×1, ×2. */
function fpsWeight({ video }: Input): Weight {
  return weight(
    video.fps >= 60 ? 2 : 1,
    video.fps === 30 ? 'référence ×1 (30 i/s)' : `≈ ×${comma(video.fps / 30)} d’images par rapport à 30 i/s`,
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
