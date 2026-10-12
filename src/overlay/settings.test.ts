import { describe, expect, it } from 'vitest'
import { isValidSetting, sanitizeSettings } from '../project/document'
import {
  DEFAULT_OVERLAY,
  LABEL_KINDS,
  OFFSET_MAX_PX,
  OVERLAY_STYLES,
  isValidOverlay,
  widgetOverrides,
  withLabelColor,
  withOverlayDefaults,
  withOverrides,
  withWidgetOffset,
  withWidgetOverrides,
} from './settings'
import type { OverlaySettings } from './settings'
import { LABEL_KIND_ACCENTS } from '../scene/labelModel'
import { OVERLAY_FONT_FAMILIES, OVERLAY_THEMES, parseColor, resolveLabelStyle, resolveOverlayTheme, toHex } from './themes'

const withPatch = (patch: (o: OverlaySettings) => void): OverlaySettings => {
  const copy = structuredClone(DEFAULT_OVERLAY)
  patch(copy)
  return copy
}

describe('overlay settings', () => {
  it('accepts the defaults', () => {
    expect(isValidOverlay(DEFAULT_OVERLAY)).toBe(true)
    expect(isValidSetting('overlay', DEFAULT_OVERLAY)).toBe(true)
  })

  it('rejects unknown styles and anchors, out-of-range values and foreign logos', () => {
    expect(isValidOverlay(withPatch((o) => (o.style = 'nope' as OverlaySettings['style'])))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.counters.anchor = 'nowhere' as OverlaySettings['counters']['anchor'])))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.title.end = 0.9)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.end.start = 0.1)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.text.size = 5)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.profile.width = 1)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.logo.image = 'https://example.org/logo.png')))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.logo.image = 'data:image/png;base64,iVBORw0KGgo=')))).toBe(true)
  })

  it('is restored from a project, or replaced by the default when a widget is malformed', () => {
    const custom = withPatch((o) => {
      o.enabled = true
      o.style = 'broadcast'
      o.counters.fields.heartRate = true
    })
    expect(sanitizeSettings({ overlay: custom }).settings.overlay).toEqual(custom)
    const broken = { ...custom, counters: { ...custom.counters, fields: { distance: true } } }
    const { settings, invalid } = sanitizeSettings({ overlay: broken })
    expect(settings.overlay).toEqual(DEFAULT_OVERLAY)
    expect(invalid).toEqual(['overlay'])
  })

  it('loads an overlay saved before the mini-map, credits and leaderboard with their defaults', () => {
    const custom = withPatch((o) => {
      o.enabled = true
      o.style = 'app'
    })
    const { minimap: _minimap, credits: _credits, leaderboard: _leaderboard, ...old } = custom
    const { settings, invalid } = sanitizeSettings({ overlay: old })
    expect(invalid).toEqual([])
    expect(settings.overlay).toEqual({ ...custom, minimap: DEFAULT_OVERLAY.minimap, credits: DEFAULT_OVERLAY.credits, leaderboard: DEFAULT_OVERLAY.leaderboard })
    expect(settings.overlay.minimap.enabled).toBe(false)
    expect(settings.overlay.credits).toEqual({ enabled: true, position: 'bottom-right' })
    expect(settings.overlay.leaderboard).toEqual({ enabled: false, anchor: 'middle-right', size: 1 })
    // only the widgets added since are filled in
    expect(withOverlayDefaults(custom)).toBe(custom)
    expect(withOverlayDefaults('x')).toBe('x')
    const { counters: _counters, ...missingCounters } = old
    expect(sanitizeSettings({ overlay: missingCounters }).invalid).toEqual(['overlay'])
  })

  it('validates the credits', () => {
    expect(isValidOverlay(withPatch((o) => (o.credits.position = 'top-left')))).toBe(true)
    expect(isValidOverlay(withPatch((o) => (o.credits.position = 'center' as OverlaySettings['credits']['position'])))).toBe(false)
    expect(sanitizeSettings({ overlay: { ...DEFAULT_OVERLAY, credits: { enabled: 'yes', position: 'top-left' } } }).invalid).toEqual(['overlay'])
  })

  it('validates the mini-map', () => {
    expect(isValidOverlay(withPatch((o) => (o.minimap.anchor = 'nowhere' as OverlaySettings['minimap']['anchor'])))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.minimap.size = 3)))).toBe(false)
    const broken = { ...DEFAULT_OVERLAY, minimap: { enabled: true, anchor: 'top-left', size: 1 } }
    expect(sanitizeSettings({ overlay: broken }).invalid).toEqual(['overlay'])
  })


  it('validates the leaderboard', () => {
    expect(isValidOverlay(withPatch((o) => (o.leaderboard.size = 9)))).toBe(false)
  })

  it('validates the logo opacity, and fills it in for an overlay saved before it', () => {
    expect(DEFAULT_OVERLAY.logo.opacity).toBe(1)
    expect(isValidOverlay(withPatch((o) => (o.logo.opacity = 0)))).toBe(true)
    expect(isValidOverlay(withPatch((o) => (o.logo.opacity = 1.2)))).toBe(false)
    const custom = withPatch((o) => (o.logo.size = 1.5))
    const { opacity: _opacity, ...oldLogo } = custom.logo
    const { settings, invalid } = sanitizeSettings({ overlay: { ...custom, logo: oldLogo } })
    expect(invalid).toEqual([])
    expect(settings.overlay).toEqual(custom)
  })
})

describe('free position of a widget', () => {
  it('is absent by default, set and dropped by withWidgetOffset', () => {
    expect(DEFAULT_OVERLAY.counters.offset).toBeUndefined()
    const moved = withWidgetOffset(DEFAULT_OVERLAY, 'logo', { x: 120, y: -8 })
    expect(moved.logo).toEqual({ ...DEFAULT_OVERLAY.logo, offset: { x: 120, y: -8 } })
    expect(moved.counters).toBe(DEFAULT_OVERLAY.counters)
    const back = withWidgetOffset(moved, 'logo', null)
    expect(back).toEqual(DEFAULT_OVERLAY)
    expect('offset' in back.logo).toBe(false)
  })

  it('is restored from a project when valid, and rejects the overlay when not', () => {
    const custom = withWidgetOffset(withWidgetOffset(DEFAULT_OVERLAY, 'title', { x: 0, y: 40 }), 'profile', { x: -OFFSET_MAX_PX, y: 3.5 })
    expect(sanitizeSettings({ overlay: custom }).settings.overlay).toEqual(custom)
    for (const bad of [null, [], { x: 1 }, { x: 1, y: '2' }, { x: 1, y: OFFSET_MAX_PX + 1 }, { x: 1, y: 2, z: 3 }]) {
      const overlay = { ...DEFAULT_OVERLAY, text: { ...DEFAULT_OVERLAY.text, offset: bad } }
      expect(isValidOverlay(overlay as OverlaySettings)).toBe(false)
      expect(sanitizeSettings({ overlay }).invalid).toEqual(['overlay'])
    }
  })
})

describe('overlay overrides', () => {
  const withOverridesRaw = (overrides: unknown) => ({ ...DEFAULT_OVERLAY, overrides })

  it('are absent by default and restored from a project when valid', () => {
    expect(DEFAULT_OVERLAY.overrides).toBeUndefined()
    const custom = withOverridesRaw({ accent: '#12ab9C', text: '#000000', panel: '#ffffff', panelOpacity: 0.5, titleFont: 'georgia', numberFont: 'mono' })
    expect(sanitizeSettings({ overlay: custom }).settings.overlay).toEqual(custom)
  })

  it('reject malformed colours, opacities, fonts and unknown fields', () => {
    for (const bad of [null, [], 'red', { accent: 'red' }, { text: '#fff' }, { panelOpacity: 1.5 }, { titleFont: 'Comic Sans' }, { shadow: '#000000' }, { toString: '#000000' }]) {
      const { settings, invalid } = sanitizeSettings({ overlay: withOverridesRaw(bad) })
      expect(invalid).toEqual(['overlay'])
      expect(settings.overlay).toEqual(DEFAULT_OVERLAY)
    }
  })

  it('are patched field by field, and dropped once empty so the overlay equals the defaults again', () => {
    const accent = withOverrides(DEFAULT_OVERLAY, { accent: '#00ff00' })
    expect(accent.overrides).toEqual({ accent: '#00ff00' })
    const both = withOverrides(accent, { titleFont: 'plex' })
    expect(both.overrides).toEqual({ accent: '#00ff00', titleFont: 'plex' })
    expect(withOverrides(both, { titleFont: undefined }).overrides).toEqual({ accent: '#00ff00' })
    expect(withOverrides(both, null)).toEqual(DEFAULT_OVERLAY)
    expect('overrides' in withOverrides(accent, { accent: undefined })).toBe(false)
  })
})

describe('widget overrides', () => {
  it('are patched on one widget, merged over the overlay\'s, dropped once empty', () => {
    const base = withOverrides(DEFAULT_OVERLAY, { accent: '#00ff00', titleFont: 'plex' })
    const counters = withWidgetOverrides(base, 'counters', { accent: '#0000ff' })
    expect(counters.counters.overrides).toEqual({ accent: '#0000ff' })
    expect(widgetOverrides(counters, 'counters')).toEqual({ accent: '#0000ff', titleFont: 'plex' })
    expect(widgetOverrides(counters, 'profile')).toEqual(base.overrides)
    expect(withWidgetOverrides(counters, 'counters', null)).toEqual(base)
    expect('overrides' in withWidgetOverrides(counters, 'counters', { accent: undefined }).counters).toBe(false)
  })

  it('are restored from a project when valid, and reject the overlay when not', () => {
    const custom = withWidgetOverrides(DEFAULT_OVERLAY, 'minimap', { text: '#123456', numberFont: 'mono' })
    expect(sanitizeSettings({ overlay: custom }).settings.overlay).toEqual(custom)
    const bad = { ...DEFAULT_OVERLAY, minimap: { ...DEFAULT_OVERLAY.minimap, overrides: { accent: 'red' } } }
    expect(isValidOverlay(bad as OverlaySettings)).toBe(false)
    expect(sanitizeSettings({ overlay: bad }).invalid).toEqual(['overlay'])
  })
})

describe('resolveOverlayTheme', () => {
  it('is the style itself without overrides', () => {
    expect(resolveOverlayTheme('broadcast', undefined)).toBe(OVERLAY_THEMES.broadcast)
    expect(resolveOverlayTheme('app', {})).toBe(OVERLAY_THEMES.app)
  })

  it('recolours the accent and what the style drew in it', () => {
    const theme = resolveOverlayTheme('broadcast', { accent: '#00ff00' })
    expect(theme.accent).toBe('#00ff00')
    expect(theme.profile.played).toBe('#00ff00')
    expect(theme.profile.marker).toBe('#00ff00')
    expect(theme.minimap.covered).toBe('#00ff00')
    // what was not the accent is kept
    expect(theme.profile.line).toBe(OVERLAY_THEMES.broadcast.profile.line)
    expect(resolveOverlayTheme('editorial', { accent: '#00ff00' }).profile.played).toBe(OVERLAY_THEMES.editorial.profile.played)
    // the style itself is untouched
    expect(OVERLAY_THEMES.broadcast.accent).not.toBe('#00ff00')
  })

  it('derives the secondary text from the text colour', () => {
    const theme = resolveOverlayTheme('app', { text: '#102030' })
    expect(theme.text).toBe('#102030')
    expect(parseColor(theme.textSoft)).toEqual({ r: 16, g: 32, b: 48, a: 0.8 })
  })

  it('changes the colour or the opacity of the panel, and the photo mat with it', () => {
    const broadcast = OVERLAY_THEMES.broadcast
    const colour = resolveOverlayTheme('broadcast', { panel: '#ffffff' })
    expect(parseColor(colour.panel?.fill ?? '')).toEqual({ r: 255, g: 255, b: 255, a: parseColor(broadcast.panel?.fill ?? '')?.a })
    expect(colour.panel?.radius).toBe(broadcast.panel?.radius)
    expect(colour.photo.mat).toBe(colour.panel?.fill)
    const opacity = resolveOverlayTheme('broadcast', { panelOpacity: 0.3 })
    expect(toHex(opacity.panel?.fill ?? '')).toBe(toHex(broadcast.panel?.fill ?? ''))
    expect(parseColor(opacity.panel?.fill ?? '')?.a).toBe(0.3)
    // a style without panel keeps its look
    const editorial = resolveOverlayTheme('editorial', { panel: '#ffffff', panelOpacity: 1 })
    expect(editorial.panel).toBeNull()
    expect(editorial.photo).toEqual(OVERLAY_THEMES.editorial.photo)
  })

  it('swaps the title and number fonts only', () => {
    const theme = resolveOverlayTheme('editorial', { titleFont: 'plex-condensed', numberFont: 'mono' })
    expect(theme.titleFamily).toBe(OVERLAY_FONT_FAMILIES['plex-condensed'])
    expect(theme.numberFamily).toBe(OVERLAY_FONT_FAMILIES.mono)
    expect(theme.bodyFamily).toBe(OVERLAY_THEMES.editorial.bodyFamily)
  })

  it('reads the colours of the themes', () => {
    expect(toHex('#FFFFFF')).toBe('#ffffff')
    expect(toHex('rgba(16, 25, 31, 0.78)')).toBe('#10191f')
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('red')).toBeNull()
  })
})

describe('overlay styles, text backing and label colours', () => {
  it.each(OVERLAY_STYLES)('style %s: a theme with every label kind, and a valid setting', (style) => {
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, style })).toBe(true)
    const { label } = OVERLAY_THEMES[style]
    for (const kind of LABEL_KINDS) expect(label.accents[kind]).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('keeps the labels of the default style as they always were', () => {
    expect(resolveLabelStyle('editorial', undefined).accents).toEqual(LABEL_KIND_ACCENTS)
  })

  it('validates the text backing and the label colours, and an old project without them', () => {
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, overrides: { textBacking: 'outline' } })).toBe(true)
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, overrides: { textBacking: 'glow' as 'blur' } })).toBe(false)
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, labelColors: { climb: '#112233' } })).toBe(true)
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, labelColors: { climb: 'red' } })).toBe(false)
    // position dot of the profile and the mini-map: absent, '' (the marker's) or '#rrggbb'
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, profile: { ...DEFAULT_OVERLAY.profile, markerColor: '#112233' }, minimap: { ...DEFAULT_OVERLAY.minimap, markerColor: '' } })).toBe(true)
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, minimap: { ...DEFAULT_OVERLAY.minimap, markerColor: 'blue' } })).toBe(false)
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, profile: { ...DEFAULT_OVERLAY.profile, markerColor: 7 as never } })).toBe(false)
    expect(isValidOverlay({ ...DEFAULT_OVERLAY, labelColors: { dragon: '#112233' } as never })).toBe(false)
    expect(isValidSetting('overlay', DEFAULT_OVERLAY)).toBe(true)
  })

  it('sets and drops the colour of a label kind, the key going with the last one', () => {
    const one = withLabelColor(DEFAULT_OVERLAY, 'peak', '#112233')
    expect(one.labelColors).toEqual({ peak: '#112233' })
    expect(resolveLabelStyle('app', one.labelColors).accents.peak).toBe('#112233')
    expect(resolveLabelStyle('app', one.labelColors).accents.climb).toBe(OVERLAY_THEMES.app.label.accents.climb)
    expect(withLabelColor(one, 'peak', null)).toEqual(DEFAULT_OVERLAY)
  })

  it('takes the text backing from the overrides', () => {
    expect(resolveOverlayTheme('editorial', { textBacking: 'shadow' }).textBacking).toBe('shadow')
    expect(resolveOverlayTheme('editorial', undefined).textBacking).toBeUndefined()
  })
})
