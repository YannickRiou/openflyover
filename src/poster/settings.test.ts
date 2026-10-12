import { describe, expect, it } from 'vitest'
import { isValidSetting, sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import { DEFAULT_POSTER, POSTER_FORMATS, isValidPoster, posterSize } from './settings'
import type { PosterSettings } from './settings'

describe('poster settings', () => {
  it('accepts the defaults and is part of the settings', () => {
    expect(isValidPoster(DEFAULT_POSTER)).toBe(true)
    expect(isValidSetting('poster', DEFAULT_POSTER)).toBe(true)
    expect(DEFAULT_SETTINGS.poster).toBe(DEFAULT_POSTER)
  })

  it('rejects unknown formats and styles, and a malformed value from a project', () => {
    expect(isValidPoster({ ...DEFAULT_POSTER, format: 'a0' as PosterSettings['format'] })).toBe(false)
    expect(isValidPoster({ ...DEFAULT_POSTER, style: 'neon' as PosterSettings['style'] })).toBe(false)
    const custom: PosterSettings = { ...DEFAULT_POSTER, format: 'square', style: 'app', title: 'Tour', figures: { ...DEFAULT_POSTER.figures, climbs: false } }
    expect(sanitizeSettings({ poster: custom }).settings.poster).toEqual(custom)
    const { settings, invalid } = sanitizeSettings({ poster: { ...custom, figures: { distance: true } } })
    expect(settings.poster).toBe(DEFAULT_POSTER)
    expect(invalid).toEqual(['poster'])
  })

  it('opens a poster saved before « Carte à plat » with the 3D view', () => {
    const older: Partial<PosterSettings> = { ...DEFAULT_POSTER, style: 'app', title: 'Tour' }
    delete older.flat
    const { settings, invalid } = sanitizeSettings({ poster: older })
    expect(invalid).toEqual([])
    expect(settings.poster).toEqual({ ...older, flat: false })
    expect(sanitizeSettings({ poster: { ...older, flat: true } }).settings.poster.flat).toBe(true)
    expect(sanitizeSettings({ poster: { ...older, flat: 'oui' } }).invalid).toEqual(['poster'])
  })

  it('opens a poster saved before the view and the image type with the overview in PNG', () => {
    const older: Partial<PosterSettings> = { ...DEFAULT_POSTER, title: 'Tour' }
    delete older.view
    delete older.type
    const { settings, invalid } = sanitizeSettings({ poster: older })
    expect(invalid).toEqual([])
    expect(settings.poster).toMatchObject({ title: 'Tour', view: 'overview', type: 'image/png' })
    expect(isValidPoster({ ...DEFAULT_POSTER, view: 'camera', type: 'image/jpeg' })).toBe(true)
    expect(isValidPoster({ ...DEFAULT_POSTER, view: 'top' as PosterSettings['view'] })).toBe(false)
    expect(isValidPoster({ ...DEFAULT_POSTER, type: 'image/webp' as PosterSettings['type'] })).toBe(false)
  })

  it('prints at 300 dpi, the long side at most 4960 px', () => {
    expect(posterSize('a4-portrait')).toEqual({ width: 2480, height: 3508 })
    expect(posterSize('a3-landscape')).toEqual({ width: 4960, height: 3508 })
    for (const f of POSTER_FORMATS) expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(4960)
    expect(posterSize('square')).toEqual({ width: 2160, height: 2160 })
  })
})
