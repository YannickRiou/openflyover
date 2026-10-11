import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import { renderWeight, tabHasHeavySetting, weightOf } from './renderCost'

const base = DEFAULT_SETTINGS
const withClouds = (patch: Partial<typeof base.clouds>) => ({ ...base, clouds: { ...base.clouds, ...patch } })
const withLens = (patch: Partial<typeof base.lens>) => ({ ...base, lens: { ...base.lens, ...patch } })
const tier = (settings: typeof base, key: Parameters<typeof weightOf>[1]) => weightOf(settings, key).tier

describe('renderWeight', () => {
  it('clouds: none or no atmosphere show nothing, the surface is light, volumetric follows the export quality', () => {
    expect(tier(withClouds({ mode: 'aucun' }), 'clouds')).toBe(0)
    expect(tier({ ...base, atmosphere: false }, 'clouds')).toBe(0)
    expect(tier(withClouds({ mode: 'mer', seaRender: 'surface', quality: 'high' }), 'clouds')).toBe(1)
    expect(tier(withClouds({ mode: 'mer', seaRender: 'volume', quality: 'high' }), 'clouds')).toBe(3)
    expect([
      tier(withClouds({ quality: 'low' }), 'clouds'),
      tier(withClouds({ quality: 'medium' }), 'clouds'),
      tier(withClouds({ quality: 'high' }), 'clouds'),
    ]).toEqual([1, 2, 3])
  })

  it('clouds tips give the real number of slices, only where there is one', () => {
    expect(weightOf(withClouds({ quality: 'medium' }), 'clouds').tip).toContain('×24')
    expect(weightOf(withClouds({ mode: 'mer', seaRender: 'surface' }), 'clouds').tip).not.toContain('×')
    expect(weightOf(withClouds({ mode: 'aucun' }), 'clouds').tip).toBe('')
  })

  it('weighs the effective export: the quality decides the clouds on auto and caps the sub-frames, the tip says so', () => {
    const at = (quality: 'standard' | 'high' | 'max', patch = {}) => ({ ...base, video: { ...base.video, quality }, ...patch })
    expect([tier(at('standard'), 'clouds'), tier(at('high'), 'clouds'), tier(at('max'), 'clouds')]).toEqual([1, 2, 3])
    expect(weightOf(at('standard'), 'clouds').tip).toContain('×16')
    expect(weightOf(at('standard'), 'clouds').tip).toContain('imposé par la qualité Standard')
    // chosen by hand: the hand wins and the tip does not claim the quality
    const byHand = at('standard', { clouds: { ...base.clouds, quality: 'high' } })
    expect(tier(byHand, 'clouds')).toBe(3)
    expect(weightOf(byHand, 'clouds').tip).toContain('×32')
    expect(weightOf(byHand, 'clouds').tip).not.toContain('imposé')
    // motion blur: 4 sub-frames in Standard is one tier lighter, and depth of field repeats 4 times
    const blurred = (quality: 'standard' | 'high' | 'max') => at(quality, { lens: { ...base.lens, shutter: 0.5, depthOfField: 0.5 } })
    expect(tier(blurred('standard'), 'shutter')).toBe(2)
    expect(weightOf(blurred('standard'), 'shutter').tip).toContain('×4')
    expect(weightOf(blurred('standard'), 'shutter').tip).toContain('imposé par la qualité Standard')
    expect(weightOf(blurred('standard'), 'depthOfField').tip).toContain('4 rendus')
    expect(tier(blurred('high'), 'shutter')).toBe(3)
    expect(weightOf(blurred('max'), 'shutter').tip).not.toContain('imposé')
    // the dot of the tab follows the effective weight
    expect(tabHasHeavySetting(blurred('standard'), 'objectif')).toBe(false)
    expect(tabHasHeavySetting(blurred('high'), 'objectif')).toBe(true)
  })

  it('motion blur: off is nothing, any amount is the 8 sub-frames', () => {
    expect(tier(withLens({ shutter: 0 }), 'shutter')).toBe(0)
    expect(weightOf(withLens({ shutter: 0.05 }), 'shutter')).toMatchObject({ tier: 3 })
    expect(weightOf(withLens({ shutter: 1 }), 'shutter').tip).toContain('×8')
  })

  it('depth of field: one tier higher while the shutter repeats it', () => {
    expect(tier(withLens({ depthOfField: 0 }), 'depthOfField')).toBe(0)
    expect(tier(withLens({ depthOfField: 0.5 }), 'depthOfField')).toBe(1)
    expect(tier(withLens({ depthOfField: 0.5, shutter: 0.5 }), 'depthOfField')).toBe(2)
  })

  it('export format: pixels per frame (720p / 1080p / 1440p and 4K) and frame rate', () => {
    const video = (patch: Partial<typeof base.video>) => ({ ...base, video: { ...base.video, aspect: '16:9' as const, ...patch } })
    expect(['720p', '1080p', '1440p', '4k'].map((resolution) => tier(video({ resolution: resolution as never }), 'resolution'))).toEqual([
      1, 2, 3, 3,
    ])
    expect(weightOf(video({ resolution: '1080p' }), 'resolution').tip).toContain('×2,25')
    expect(weightOf(video({ resolution: '1440p' }), 'resolution').tip).toContain('×4 ')
    expect([24, 30, 60].map((fps) => tier(video({ fps: fps as never }), 'fps'))).toEqual([1, 1, 2])
  })

  it('the default project shows no heaviest tier', () => {
    expect(Object.values(renderWeight(base)).some((w) => w.tier === 3)).toBe(false)
  })
})

describe('tabHasHeavySetting', () => {
  it('lights the tab of a setting at its heaviest tier only', () => {
    expect(tabHasHeavySetting(base, 'meteo')).toBe(false)
    expect(tabHasHeavySetting(base, 'objectif')).toBe(false)
    expect(tabHasHeavySetting(withClouds({ quality: 'high' }), 'meteo')).toBe(true)
    expect(tabHasHeavySetting(withClouds({ quality: 'high' }), 'objectif')).toBe(false)
    expect(tabHasHeavySetting(withLens({ shutter: 0.5 }), 'objectif')).toBe(true)
    // depth of field alone peaks at tier 2
    expect(tabHasHeavySetting(withLens({ depthOfField: 1, shutter: 0 }), 'objectif')).toBe(false)
    expect(tabHasHeavySetting(withLens({ shutter: 0.5 }), 'carte')).toBe(false)
  })
})
