// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCENT_PRESETS,
  CHROME_PRESETS,
  DEFAULT_APPEARANCE,
  applyAppearance,
  clampAccent,
  clampChrome,
  contrastRatio,
  deriveAccent,
  deriveChrome,
  isDarkTheme,
  normalizeHex,
  parseAppearance,
} from './appearance'

describe('colour helpers', () => {
  it('measures the WCAG contrast ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    expect(contrastRatio('#b9391f', '#ffffff')).toBeCloseTo(5.73, 1)
  })

  it('accepts #rrggbb only, in lower case', () => {
    expect(normalizeHex('#B9391F')).toBe('#b9391f')
    expect(normalizeHex(' #00766f ')).toBe('#00766f')
    for (const bad of ['#fff', 'b9391f', '#gggggg', '', 12, null, undefined]) expect(normalizeHex(bad)).toBeNull()
  })
})

describe('accent colour', () => {
  it('keeps a colour that already holds white text, darkens one that does not', () => {
    expect(clampAccent('#b9391f')).toBe('#b9391f')
    for (const color of ['#ffee00', '#ffffff', '#7ec8e3', '#ff9b73']) {
      const clamped = clampAccent(color)
      expect(clamped).not.toBe(color)
      expect(contrastRatio(clamped, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('offers presets that need no clamping', () => {
    for (const { color } of ACCENT_PRESETS) expect(clampAccent(color)).toBe(color)
    expect(ACCENT_PRESETS[0].color).toBe(DEFAULT_APPEARANCE.accent)
  })

  it('derives the scale: white text on the accent and its hover, readable accent on the bar and on dark panels', () => {
    for (const hex of ['#b9391f', '#ffee00', '#4a55b8', '#ffffff']) {
      for (const dark of [false, true]) {
        const chrome = DEFAULT_APPEARANCE.chrome
        const scale = deriveAccent(hex, dark, chrome)
        expect(contrastRatio(scale.accent, '#ffffff')).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(scale.strong, '#ffffff')).toBeGreaterThanOrEqual(contrastRatio(scale.accent, '#ffffff'))
        expect(contrastRatio(scale.light, chrome)).toBeGreaterThanOrEqual(4.5)
        if (dark) {
          expect(contrastRatio(scale.light, '#151c22')).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(scale.light, '#1f2a32')).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(scale.light, scale.tint)).toBeGreaterThanOrEqual(4.5)
          // the dark tint is the panel colour with a touch of accent
          expect(contrastRatio('#ece8dd', scale.tint)).toBeGreaterThanOrEqual(4.5)
        } else {
          // text 1 of the light theme on the tint
          expect(contrastRatio('#1b2832', scale.tint)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('reproduces the designed dark tint for the default accent', () => {
    expect(deriveAccent(DEFAULT_APPEARANCE.accent, true, DEFAULT_APPEARANCE.chrome).tint).toBe('#392221')
  })
})

describe('bar colour', () => {
  it('keeps its secondary text readable', () => {
    for (const { color } of CHROME_PRESETS) expect(clampChrome(color)).toBe(color)
    expect(CHROME_PRESETS[0].color).toBe(DEFAULT_APPEARANCE.chrome)
    for (const color of ['#808080', '#ffffff', '#ffee00', '#3366ff']) {
      expect(contrastRatio(clampChrome(color), '#a9ccd9')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(clampChrome(color), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('derives a raised colour, lighter, for menus and toasts', () => {
    const { chrome, raised } = deriveChrome('#113b54')
    expect(chrome).toBe('#113b54')
    expect(contrastRatio(raised, '#ffffff')).toBeLessThan(contrastRatio(chrome, '#ffffff'))
    expect(contrastRatio(raised, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('parseAppearance', () => {
  it('reads each field, the default for anything missing, unknown or malformed', () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('dark')).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance([1])).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance({ theme: 'sepia', accent: 'rouge', chrome: '#123' })).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance({ theme: 'system', accent: '#2F6A8A', chrome: '#113b54', density: 'compact' })).toEqual({
      theme: 'system',
      accent: '#2f6a8a',
      chrome: '#113b54',
    })
    expect(parseAppearance({ theme: 'dark' })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark' })
  })
})

describe('applyAppearance', () => {
  const root = document.documentElement
  beforeEach(() => {
    root.removeAttribute('data-theme')
    root.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#1b2832">'
  })
  const themeColor = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')

  it('resolves the system theme with the scheme of the system', () => {
    expect(isDarkTheme('system', true)).toBe(true)
    expect(isDarkTheme('system', false)).toBe(false)
    expect(isDarkTheme('light', true)).toBe(false)
    expect(isDarkTheme('dark', false)).toBe(true)
    applyAppearance(root, { ...DEFAULT_APPEARANCE, theme: 'system' }, true)
    expect(root.dataset.theme).toBe('dark')
    applyAppearance(root, { ...DEFAULT_APPEARANCE, theme: 'system' }, false)
    expect(root.dataset.theme).toBe('light')
  })

  it('sets nothing but the attributes for the default colours', () => {
    applyAppearance(root, DEFAULT_APPEARANCE, false)
    expect(root.dataset.theme).toBe('light')
    expect(root.getAttribute('style') ?? '').toBe('')
    expect(themeColor()).toBe('#1b2832')
  })

  it('sets the accent scale and the bar colours of a custom choice, then removes them on the default', () => {
    applyAppearance(root, { ...DEFAULT_APPEARANCE, accent: '#4a55b8', chrome: '#113b54' }, false)
    expect(root.style.getPropertyValue('--color-accent')).toBe('#4a55b8')
    for (const name of ['--color-accent-strong', '--color-accent-tint', '--color-accent-light', '--surface-chrome', '--surface-chrome-raised']) {
      expect(root.style.getPropertyValue(name)).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(root.style.getPropertyValue('--surface-chrome')).toBe('#113b54')
    expect(themeColor()).toBe('#113b54')
    applyAppearance(root, DEFAULT_APPEARANCE, false)
    expect(root.getAttribute('style') ?? '').toBe('')
    expect(themeColor()).toBe('#1b2832')
  })

  it('clamps a free colour that would not hold white text', () => {
    applyAppearance(root, { ...DEFAULT_APPEARANCE, accent: '#ffee00' }, false)
    expect(contrastRatio(root.style.getPropertyValue('--color-accent'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('derives the tint for the theme in force', () => {
    const custom = { ...DEFAULT_APPEARANCE, accent: '#4a55b8' }
    applyAppearance(root, custom, false)
    const light = root.style.getPropertyValue('--color-accent-tint')
    applyAppearance(root, { ...custom, theme: 'dark' }, false)
    expect(root.style.getPropertyValue('--color-accent-tint')).not.toBe(light)
  })
})
