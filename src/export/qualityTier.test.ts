import { describe, expect, it } from 'vitest'
import { SHUTTER_SUBFRAMES } from '../scene/lens'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import { EXPORT_SAMPLES } from '../weather/sceneClouds'
import { QUALITY_TIERS, effectiveRender, isCustomised, presetBadge, qualityTier } from './qualityTier'
import { VIDEO_QUALITIES } from './schedule'
import type { VideoQuality } from './schedule'

const settings = (quality: VideoQuality, patch: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  atmosphere: true,
  video: { ...DEFAULT_SETTINGS.video, quality },
  ...patch,
})
const withCloudQuality = (q: Settings['clouds']['quality'], mode: Settings['clouds']['mode'] = 'meteo') => ({
  clouds: { ...DEFAULT_SETTINGS.clouds, mode, quality: q },
})

describe('quality tiers', () => {
  it('maps each quality to a clouds quality and a sub-frame cap', () => {
    expect(QUALITY_TIERS).toEqual({
      standard: { cloudsQuality: 'low', maxSubFrames: 4 },
      high: { cloudsQuality: 'medium', maxSubFrames: 8 },
      max: { cloudsQuality: 'high', maxSubFrames: 8 },
    })
    // the default project (quality Haute) keeps the clouds and the 8 sub-frames of before the tiers
    expect(qualityTier('high').maxSubFrames).toBe(SHUTTER_SUBFRAMES)
    expect(EXPORT_SAMPLES[qualityTier('standard').cloudsQuality]).toBe(16)
    expect(EXPORT_SAMPLES[qualityTier('high').cloudsQuality]).toBe(24)
    expect(EXPORT_SAMPLES[qualityTier('max').cloudsQuality]).toBe(32)
  })

  it('never raises the sub-frames above the full 8, and gets heavier with the quality', () => {
    for (const q of VIDEO_QUALITIES) expect(qualityTier(q).maxSubFrames).toBeLessThanOrEqual(SHUTTER_SUBFRAMES)
    const samples = VIDEO_QUALITIES.map((q) => EXPORT_SAMPLES[qualityTier(q).cloudsQuality])
    expect(samples).toEqual([...samples].sort((a, b) => a - b))
  })

  it('is a pure function: the same quality gives the same tier, an unknown one the default', () => {
    expect(qualityTier('standard')).toBe(qualityTier('standard'))
    expect(qualityTier('ultra' as VideoQuality)).toBe(QUALITY_TIERS.high)
  })
})

describe('effectiveRender', () => {
  it("follows the quality while the clouds are on 'auto'", () => {
    for (const q of VIDEO_QUALITIES) {
      expect(effectiveRender(q, { quality: 'auto' })).toEqual({ ...QUALITY_TIERS[q], cloudsByHand: false })
    }
  })

  it('lets a quality chosen by hand win over the tier, in both directions', () => {
    expect(effectiveRender('max', { quality: 'low' })).toEqual({ cloudsQuality: 'low', maxSubFrames: 8, cloudsByHand: true })
    expect(effectiveRender('standard', { quality: 'high' })).toEqual({ cloudsQuality: 'high', maxSubFrames: 4, cloudsByHand: true })
  })
})

describe('badges', () => {
  it('says the clouds quality is imposed by the export quality, with its name', () => {
    expect(presetBadge(settings('standard'), 'clouds')).toEqual({ kind: 'preset', text: 'Imposé par Standard' })
    expect(presetBadge(settings('high'), 'clouds')).toEqual({ kind: 'preset', text: 'Imposé par Haute' })
    expect(presetBadge(settings('max'), 'clouds')).toEqual({ kind: 'preset', text: 'Imposé par Maximale' })
  })

  it('reads « Personnalisé » once the clouds quality was chosen by hand, even when it equals the tier', () => {
    expect(presetBadge(settings('max', withCloudQuality('low')), 'clouds')).toEqual({ kind: 'custom', text: 'Personnalisé' })
    expect(presetBadge(settings('high', withCloudQuality('medium')), 'clouds')?.kind).toBe('custom')
    expect(isCustomised(settings('max', withCloudQuality('low')))).toBe(true)
    expect(isCustomised(settings('max'))).toBe(false)
  })

  it('shows nothing where the quality changes nothing', () => {
    // no clouds (switched off or no atmosphere): no badge, and the selector is not customised by a hidden value
    expect(presetBadge(settings('standard', withCloudQuality('auto', 'aucun')), 'clouds')).toBeNull()
    expect(presetBadge(settings('standard', { atmosphere: false }), 'clouds')).toBeNull()
    expect(isCustomised(settings('standard', withCloudQuality('low', 'aucun')))).toBe(false)
    expect(isCustomised(settings('standard', { atmosphere: false, ...withCloudQuality('low') }))).toBe(false)
  })

  it('badges the motion blur only while the quality lowers its 8 sub-frames', () => {
    const blurred = { lens: { ...DEFAULT_SETTINGS.lens, shutter: 0.5 } }
    expect(presetBadge(settings('standard', blurred), 'shutter')).toEqual({ kind: 'preset', text: 'Imposé par Standard' })
    expect(presetBadge(settings('standard'), 'shutter')).toBeNull()
    expect(presetBadge(settings('high', blurred), 'shutter')).toBeNull()
    expect(presetBadge(settings('max', blurred), 'shutter')).toBeNull()
  })
})
