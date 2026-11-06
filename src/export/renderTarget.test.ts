import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import { exceedsTarget, speedUps, targetRenderSeconds } from './renderTarget'

type Over = { quality?: 'standard' | 'high' | 'max'; resolution?: '720p' | '1080p' | '4k'; cloudQ?: 'auto' | 'low' | 'medium' | 'high'; shutter?: number; atmosphere?: boolean }

const base = (over: Over = {}) => ({
  atmosphere: over.atmosphere ?? true,
  lens: { ...DEFAULT_SETTINGS.lens, shutter: over.shutter ?? 0 },
  clouds: { ...DEFAULT_SETTINGS.clouds, mode: 'meteo' as const, quality: over.cloudQ ?? 'auto' },
  video: { ...DEFAULT_SETTINGS.video, aspect: '16:9' as const, quality: over.quality ?? 'high', resolution: over.resolution ?? '1080p' },
})

describe('render target', () => {
  it('scales the target to the film: 10 min per film minute on a phone, 30 on a computer', () => {
    expect(targetRenderSeconds('phone', 60)).toBe(600)
    expect(targetRenderSeconds('tablet', 120)).toBe(1200)
    expect(targetRenderSeconds('desktop', 30)).toBe(900)
  })

  it('exceeds only above the target, never without an estimate', () => {
    expect(exceedsTarget(null, 'phone', 60)).toBe(false)
    expect(exceedsTarget(600, 'phone', 60)).toBe(false)
    expect(exceedsTarget(601, 'phone', 60)).toBe(true)
    expect(exceedsTarget(601, 'desktop', 60)).toBe(false)
  })

  it('offers quality, size and clouds when each lowers the render', () => {
    expect(speedUps(base()).map((a) => a.kind)).toEqual(['quality', 'size', 'clouds'])
  })

  it('offers nothing already at the floor', () => {
    expect(speedUps(base({ quality: 'standard', resolution: '720p' }))).toEqual([])
  })

  it('no clouds offer without clouds, no quality offer when it changes nothing', () => {
    expect(speedUps({ ...base({ resolution: '720p' }), atmosphere: false })).toEqual([])
    expect(speedUps(base({ resolution: '720p', quality: 'max', cloudQ: 'low' }))).toEqual([])
  })

  it('a size above the device limit is not a smaller render', () => {
    expect(speedUps(base({ resolution: '4k' }), 1080).map((a) => a.kind)).not.toContain('size')
    expect(speedUps(base({ resolution: '1080p' }), 1080).map((a) => a.kind)).toContain('size')
  })

  it('the lower values', () => {
    expect(speedUps(base({ quality: 'max', cloudQ: 'high' }))).toContainEqual({ kind: 'clouds', quality: 'medium' })
    expect(speedUps(base())).toContainEqual({ kind: 'size', resolution: '720p' })
  })
})
