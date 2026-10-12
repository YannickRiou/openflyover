/**
 * The overlay styles. They belong to the film, not to the interface: their colours are chosen for
 * legibility over any imagery, from the same family as the charte « Carte alpine » (paper, ink, trail red).
 * Sizes are in overlay units (1 u = 1 % of the shorter side of the frame).
 */
import type { LabelKind, OverlayFontId, OverlayOverrides, OverlayStyleId, TextBacking } from './settings'

export interface OverlayPanelStyle {
  fill: string
  /** hairline border, none when undefined */
  stroke?: string
  /** corner radius (u) */
  radius: number
  /** drop shadow under the panel */
  shadow?: { color: string; blur: number; offsetY: number }
}

/** The 3D labels in a style (see `Labels.tsx`): ink-like panel, text, corner radius (px) and the accent of each kind. */
export interface LabelStyle {
  /** '#rrggbb' */
  panel: string
  text: string
  radius: number
  accents: Readonly<Record<LabelKind, string>>
}

/** Accents of a label style from five roles: climbs, passes and points of interest; summits and ends; waypoints and water; huts and km; places. */
function kindAccents(a: { strong: string; peak: string; cool: string; soft: string; muted: string }): Record<LabelKind, string> {
  return {
    climb: a.strong,
    pass: a.strong,
    poi: a.strong,
    peak: a.peak,
    endpoint: a.peak,
    waypoint: a.cool,
    water: a.cool,
    hut: a.soft,
    km: a.soft,
    place: a.muted,
    other: a.muted,
  }
}

export interface OverlayTheme {
  titleFamily: string
  titleWeight: number
  titleUppercase: boolean
  bodyFamily: string
  numberFamily: string
  numberWeight: number
  labelWeight: number
  labelUppercase: boolean
  /** letter spacing of labels (em) */
  labelTracking: number
  text: string
  textSoft: string
  accent: string
  /** panel behind each widget; none = text on the image with a soft dark scrim and shadow */
  panel: OverlayPanelStyle | null
  /** one panel for all counters (true) or one per counter */
  groupedCounters: boolean
  /** shadow under the text (u), for the styles without panel */
  textShadow?: { color: string; blur: number }
  /** what backs the text of a style without panel (user choice; absent = `DEFAULT_TEXT_BACKING`) */
  textBacking?: TextBacking
  /** accent bar on the leading edge of panels and cards (u), 0 = none */
  accentBar: number
  profile: { area: string; played: string; line: string; marker: string; markerRing: string }
  /** mini-map: route still ahead, covered part, start and end dots (ringed with `profile.markerRing`) */
  minimap: { route: string; covered: string; start: string; end: string }
  /** source credits: subtle backing and text, legible on snow as on forest */
  credits: { fill: string; text: string }
  /** photo card of the timeline: mat around the picture (pad and radii in u), caption colour on the mat */
  photo: OverlayPhotoStyle
  /** the 3D labels of the scene */
  label: LabelStyle
}

export interface OverlayPhotoStyle {
  mat: string
  stroke?: string
  pad: number
  radius: number
  imageRadius: number
  caption: string
  shadow?: { color: string; blur: number; offsetY: number }
}

export const FRAUNCES = '"Fraunces", Georgia, serif'
export const PLEX = '"IBM Plex Sans", system-ui, sans-serif'
export const PLEX_CONDENSED = '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif'

/** Families of the fonts the user can pick (`OverlayOverrides`): bundled faces, or system ones with fallbacks. */
export const OVERLAY_FONT_FAMILIES: Record<OverlayFontId, string> = {
  fraunces: FRAUNCES,
  plex: PLEX,
  'plex-condensed': PLEX_CONDENSED,
  georgia: 'Georgia, "Times New Roman", serif',
  system: 'system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
}

export const PAPER = '#F5F2EA'
export const INK = '#1C2A33'
export const INK_SOFT = '#55626B'
export const TRAIL_RED = '#C23B22'
export const TRAIL_RED_LIGHT = '#FF8A5C'
export const GLACIER = '#A9CCD9'
const MOSS = '#3F6B4A'
export const SPORT_ORANGE = '#FF6B2C'
export const TOPO_RUST = '#A64A24'
export const TOPO_PAPER = '#F0E8D3'
export const TOPO_BROWN = '#5B4A3A'
export const NEON_CYAN = '#5EF0FF'
const NEON_MAGENTA = '#FF4FD8'

export const OVERLAY_THEMES: Record<OverlayStyleId, OverlayTheme> = {
  // light serif titles straight on the image, generous spacing
  editorial: {
    titleFamily: FRAUNCES,
    titleWeight: 300,
    titleUppercase: false,
    bodyFamily: PLEX,
    numberFamily: FRAUNCES,
    numberWeight: 500,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.16,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.86)',
    accent: TRAIL_RED_LIGHT,
    panel: null,
    groupedCounters: true,
    textShadow: { color: 'rgba(0, 0, 0, 0.6)', blur: 0.9 },
    accentBar: 0,
    profile: {
      area: 'rgba(255, 255, 255, 0.28)',
      played: 'rgba(255, 255, 255, 0.7)',
      line: '#FFFFFF',
      marker: TRAIL_RED_LIGHT,
      markerRing: '#FFFFFF',
    },
    minimap: { route: 'rgba(255, 255, 255, 0.5)', covered: TRAIL_RED_LIGHT, start: MOSS, end: '#FFFFFF' },
    credits: { fill: 'rgba(16, 25, 31, 0.6)', text: '#FFFFFF' },
    // white print mat, like a photo laid on the map
    photo: { mat: '#FFFFFF', pad: 0.8, radius: 0.3, imageRadius: 0, caption: INK, shadow: { color: 'rgba(0, 0, 0, 0.35)', blur: 2, offsetY: 0.4 } },
    // the labels as they always were: ink panel, white text
    label: { panel: INK, text: '#FFFFFF', radius: 5, accents: kindAccents({ strong: TRAIL_RED_LIGHT, peak: '#FFFFFF', cool: GLACIER, soft: '#EAE4D6', muted: '#D6CDBB' }) },
  },
  // dark glass panels, condensed figures, trail-red bar
  broadcast: {
    titleFamily: PLEX_CONDENSED,
    titleWeight: 700,
    titleUppercase: true,
    bodyFamily: PLEX_CONDENSED,
    numberFamily: PLEX_CONDENSED,
    numberWeight: 600,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.1,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.78)',
    accent: TRAIL_RED_LIGHT,
    panel: { fill: 'rgba(16, 25, 31, 0.78)', stroke: 'rgba(255, 255, 255, 0.14)', radius: 0.5 },
    groupedCounters: true,
    accentBar: 0.6,
    profile: {
      area: 'rgba(255, 255, 255, 0.2)',
      played: TRAIL_RED_LIGHT,
      line: '#FFFFFF',
      marker: TRAIL_RED_LIGHT,
      markerRing: '#FFFFFF',
    },
    minimap: { route: 'rgba(255, 255, 255, 0.4)', covered: TRAIL_RED_LIGHT, start: MOSS, end: '#FFFFFF' },
    credits: { fill: 'rgba(16, 25, 31, 0.7)', text: '#FFFFFF' },
    photo: { mat: 'rgba(16, 25, 31, 0.78)', stroke: 'rgba(255, 255, 255, 0.14)', pad: 0.6, radius: 0.5, imageRadius: 0.2, caption: '#FFFFFF' },
    label: { panel: INK, text: '#FFFFFF', radius: 3, accents: kindAccents({ strong: TRAIL_RED_LIGHT, peak: '#FFFFFF', cool: GLACIER, soft: '#EAE4D6', muted: '#D6CDBB' }) },
  },
  // pale rounded cards, like a navigation app
  app: {
    titleFamily: PLEX,
    titleWeight: 600,
    titleUppercase: false,
    bodyFamily: PLEX,
    numberFamily: PLEX,
    numberWeight: 600,
    labelWeight: 500,
    labelUppercase: false,
    labelTracking: 0,
    text: INK,
    textSoft: INK_SOFT,
    accent: TRAIL_RED,
    panel: {
      fill: 'rgba(245, 242, 234, 0.94)',
      radius: 1.6,
      shadow: { color: 'rgba(0, 0, 0, 0.28)', blur: 1.6, offsetY: 0.3 },
    },
    groupedCounters: false,
    accentBar: 0,
    profile: { area: GLACIER, played: TRAIL_RED, line: INK, marker: TRAIL_RED, markerRing: PAPER },
    minimap: { route: 'rgba(28, 42, 51, 0.35)', covered: TRAIL_RED, start: MOSS, end: INK },
    credits: { fill: 'rgba(245, 242, 234, 0.82)', text: INK },
    photo: {
      mat: 'rgba(245, 242, 234, 0.94)',
      pad: 0.8,
      radius: 1.6,
      imageRadius: 1,
      caption: INK,
      shadow: { color: 'rgba(0, 0, 0, 0.28)', blur: 1.6, offsetY: 0.3 },
    },
    label: { panel: PAPER, text: INK, radius: 8, accents: kindAccents({ strong: TRAIL_RED, peak: INK, cool: '#3E7C97', soft: '#7A6F5A', muted: INK_SOFT }) },
  },
  // bold and sporty: heavy condensed capitals on solid dark blocks, a thick orange edge
  sport: {
    titleFamily: PLEX_CONDENSED,
    titleWeight: 700,
    titleUppercase: true,
    bodyFamily: PLEX_CONDENSED,
    numberFamily: PLEX_CONDENSED,
    numberWeight: 700,
    labelWeight: 600,
    labelUppercase: true,
    labelTracking: 0.08,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.8)',
    accent: SPORT_ORANGE,
    panel: { fill: 'rgba(12, 18, 23, 0.9)', radius: 0.2 },
    groupedCounters: false,
    accentBar: 1.1,
    profile: { area: 'rgba(255, 107, 44, 0.3)', played: SPORT_ORANGE, line: '#FFFFFF', marker: SPORT_ORANGE, markerRing: '#FFFFFF' },
    minimap: { route: 'rgba(255, 255, 255, 0.45)', covered: SPORT_ORANGE, start: MOSS, end: '#FFFFFF' },
    credits: { fill: 'rgba(12, 18, 23, 0.72)', text: '#FFFFFF' },
    photo: { mat: 'rgba(12, 18, 23, 0.9)', pad: 0.6, radius: 0.2, imageRadius: 0, caption: '#FFFFFF' },
    label: { panel: '#0C1217', text: '#FFFFFF', radius: 2, accents: kindAccents({ strong: SPORT_ORANGE, peak: '#FFFFFF', cool: GLACIER, soft: '#EAE4D6', muted: '#D6CDBB' }) },
  },
  // minimal: monospaced figures straight on the image, no panel, white only
  mono: {
    titleFamily: OVERLAY_FONT_FAMILIES.mono,
    titleWeight: 500,
    titleUppercase: false,
    bodyFamily: OVERLAY_FONT_FAMILIES.mono,
    numberFamily: OVERLAY_FONT_FAMILIES.mono,
    numberWeight: 500,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.12,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.8)',
    accent: '#FFFFFF',
    panel: null,
    groupedCounters: true,
    textShadow: { color: 'rgba(0, 0, 0, 0.65)', blur: 1 },
    accentBar: 0,
    profile: { area: 'rgba(255, 255, 255, 0.18)', played: 'rgba(255, 255, 255, 0.85)', line: '#FFFFFF', marker: '#FFFFFF', markerRing: 'rgba(0, 0, 0, 0.6)' },
    minimap: { route: 'rgba(255, 255, 255, 0.45)', covered: '#FFFFFF', start: 'rgba(255, 255, 255, 0.6)', end: '#FFFFFF' },
    credits: { fill: 'rgba(16, 25, 31, 0.6)', text: '#FFFFFF' },
    photo: { mat: '#FFFFFF', pad: 0.5, radius: 0, imageRadius: 0, caption: INK, shadow: { color: 'rgba(0, 0, 0, 0.35)', blur: 2, offsetY: 0.4 } },
    label: { panel: '#10191F', text: '#FFFFFF', radius: 1, accents: kindAccents({ strong: '#FFFFFF', peak: '#FFFFFF', cool: '#C9D3D9', soft: '#AAB5BC', muted: '#8E999F' }) },
  },
  // topographic sheet: map paper with a brown hairline, serif titles, rust contour accent
  topo: {
    titleFamily: FRAUNCES,
    titleWeight: 500,
    titleUppercase: false,
    bodyFamily: PLEX,
    numberFamily: FRAUNCES,
    numberWeight: 500,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.12,
    text: INK,
    textSoft: TOPO_BROWN,
    accent: TOPO_RUST,
    panel: { fill: 'rgba(240, 232, 211, 0.95)', stroke: 'rgba(122, 84, 52, 0.7)', radius: 0.3 },
    groupedCounters: true,
    accentBar: 0,
    profile: { area: '#CBD9B0', played: TOPO_RUST, line: INK, marker: TOPO_RUST, markerRing: TOPO_PAPER },
    minimap: { route: 'rgba(28, 42, 51, 0.4)', covered: TOPO_RUST, start: MOSS, end: INK },
    credits: { fill: 'rgba(240, 232, 211, 0.85)', text: INK },
    photo: { mat: 'rgba(240, 232, 211, 0.95)', stroke: 'rgba(122, 84, 52, 0.7)', pad: 0.8, radius: 0.3, imageRadius: 0, caption: INK },
    label: { panel: TOPO_PAPER, text: INK, radius: 2, accents: kindAccents({ strong: TOPO_RUST, peak: INK, cool: '#2F6F8F', soft: '#7A5434', muted: '#5B6B4A' }) },
  },
  // night neon: deep blue glass with a glowing cyan edge, magenta marker
  neon: {
    titleFamily: PLEX_CONDENSED,
    titleWeight: 700,
    titleUppercase: true,
    bodyFamily: PLEX_CONDENSED,
    numberFamily: PLEX_CONDENSED,
    numberWeight: 600,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.14,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.8)',
    accent: NEON_CYAN,
    panel: {
      fill: 'rgba(7, 10, 26, 0.84)',
      stroke: 'rgba(94, 240, 255, 0.75)',
      radius: 0.8,
      shadow: { color: 'rgba(94, 240, 255, 0.5)', blur: 2.4, offsetY: 0 },
    },
    groupedCounters: true,
    accentBar: 0,
    profile: { area: 'rgba(94, 240, 255, 0.2)', played: NEON_CYAN, line: '#FFFFFF', marker: NEON_MAGENTA, markerRing: '#FFFFFF' },
    minimap: { route: 'rgba(255, 255, 255, 0.4)', covered: NEON_CYAN, start: NEON_MAGENTA, end: '#FFFFFF' },
    credits: { fill: 'rgba(7, 10, 26, 0.78)', text: '#FFFFFF' },
    photo: {
      mat: 'rgba(7, 10, 26, 0.84)',
      stroke: 'rgba(94, 240, 255, 0.75)',
      pad: 0.6,
      radius: 0.8,
      imageRadius: 0.3,
      caption: '#FFFFFF',
      shadow: { color: 'rgba(94, 240, 255, 0.5)', blur: 2.4, offsetY: 0 },
    },
    label: { panel: '#070A1A', text: '#FFFFFF', radius: 4, accents: kindAccents({ strong: NEON_MAGENTA, peak: '#FFFFFF', cool: NEON_CYAN, soft: '#B8A4FF', muted: '#8FA3C8' }) },
  },
  // magazine: square white sheets, bold serif headline, tracked small capitals, red edge
  magazine: {
    titleFamily: FRAUNCES,
    titleWeight: 700,
    titleUppercase: false,
    bodyFamily: PLEX,
    numberFamily: FRAUNCES,
    numberWeight: 600,
    labelWeight: 600,
    labelUppercase: true,
    labelTracking: 0.18,
    text: INK,
    textSoft: INK_SOFT,
    accent: TRAIL_RED,
    panel: { fill: 'rgba(255, 255, 255, 0.96)', radius: 0, shadow: { color: 'rgba(0, 0, 0, 0.3)', blur: 1.2, offsetY: 0.3 } },
    groupedCounters: true,
    accentBar: 0.4,
    profile: { area: '#E7E1D3', played: TRAIL_RED, line: INK, marker: TRAIL_RED, markerRing: '#FFFFFF' },
    minimap: { route: 'rgba(28, 42, 51, 0.35)', covered: TRAIL_RED, start: MOSS, end: INK },
    credits: { fill: 'rgba(255, 255, 255, 0.85)', text: INK },
    photo: { mat: '#FFFFFF', pad: 0.9, radius: 0, imageRadius: 0, caption: INK, shadow: { color: 'rgba(0, 0, 0, 0.3)', blur: 1.2, offsetY: 0.3 } },
    label: { panel: '#FFFFFF', text: INK, radius: 0, accents: kindAccents({ strong: TRAIL_RED, peak: INK, cool: '#3E7C97', soft: '#7A6F5A', muted: INK_SOFT }) },
  },
}

/**
 * Font faces drawn by the overlay. A canvas does not trigger web font downloads by itself: they are
 * requested with `document.fonts.load` before the first frame (see `loadOverlayFonts`).
 */
export const OVERLAY_FONTS: readonly string[] = [
  `300 32px ${FRAUNCES}`,
  `500 32px ${FRAUNCES}`,
  `600 32px ${FRAUNCES}`,
  `700 32px ${FRAUNCES}`,
  `500 32px ${PLEX}`,
  `600 32px ${PLEX}`,
  `500 32px ${PLEX_CONDENSED}`,
  `600 32px ${PLEX_CONDENSED}`,
  `700 32px ${PLEX_CONDENSED}`,
]

// ---------------------------------------------------------------------------
// User overrides
// ---------------------------------------------------------------------------

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** '#rrggbb', 'rgb(r, g, b)' or 'rgba(r, g, b, a)' (the forms used by the themes); null otherwise. */
export function parseColor(css: string): Rgba | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css)
  if (hex) return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css)
  if (!fn) return null
  return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
}

/** Opaque part of a colour as '#rrggbb' (what a colour input shows), black when unreadable. */
export function toHex(css: string): string {
  const c = parseColor(css) ?? { r: 0, g: 0, b: 0, a: 1 }
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/** '#rrggbb' at opacity `alpha` -> 'rgba(r, g, b, alpha)'. */
function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseColor(hex) ?? { r: 0, g: 0, b: 0 }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Colour and opacity of the style's panel, '#rrggbb' and 0–1; null for a style without panel. */
export function panelColorOf(theme: OverlayTheme): { color: string; opacity: number } | null {
  if (!theme.panel) return null
  return { color: toHex(theme.panel.fill), opacity: parseColor(theme.panel.fill)?.a ?? 1 }
}

/** Opacity of the secondary text (labels, units) derived from a chosen text colour. */
const SOFT_TEXT_ALPHA = 0.8

/** Secondary text (labels, units, subtitles) of a chosen text colour '#rrggbb'. */
export function softTextOf(hex: string): string {
  return withAlpha(hex, SOFT_TEXT_ALPHA)
}

/**
 * Theme drawn for a style and the user's overrides, the same for the preview and the export. The accent also
 * recolours what the style drew in its accent (profile, mini-map), the text colour the secondary text, and the
 * panel colour the photo cards' mat (styles with a panel only: a style without panel keeps its look).
 */
export function resolveOverlayTheme(style: OverlayStyleId, overrides: OverlayOverrides | undefined): OverlayTheme {
  const base = OVERLAY_THEMES[style] ?? OVERLAY_THEMES.editorial
  if (!overrides || Object.keys(overrides).length === 0) return base
  const { accent, text, titleFont, numberFont } = overrides
  const theme: OverlayTheme = { ...base, profile: { ...base.profile }, minimap: { ...base.minimap }, photo: { ...base.photo } }
  if (accent) {
    const followAccent = (c: string) => (c === base.accent ? accent : c)
    theme.accent = accent
    theme.profile.played = followAccent(base.profile.played)
    theme.profile.marker = followAccent(base.profile.marker)
    theme.minimap.covered = followAccent(base.minimap.covered)
  }
  if (text) {
    theme.text = text
    theme.textSoft = softTextOf(text)
  }
  const stylePanel = panelColorOf(base)
  if (base.panel && stylePanel && (overrides.panel || overrides.panelOpacity !== undefined)) {
    const fill = withAlpha(overrides.panel ?? stylePanel.color, overrides.panelOpacity ?? stylePanel.opacity)
    theme.panel = { ...base.panel, fill }
    theme.photo.mat = fill
  }
  if (overrides.textBacking) theme.textBacking = overrides.textBacking
  if (titleFont) theme.titleFamily = OVERLAY_FONT_FAMILIES[titleFont]
  if (numberFont) theme.numberFamily = OVERLAY_FONT_FAMILIES[numberFont]
  return theme
}

/** Labels of the style, each kind in the user's colour when it chose one (`OverlaySettings.labelColors`). */
export function resolveLabelStyle(style: OverlayStyleId, labelColors: Partial<Record<LabelKind, string>> | undefined): LabelStyle {
  const { label } = OVERLAY_THEMES[style] ?? OVERLAY_THEMES.editorial
  return labelColors && Object.keys(labelColors).length > 0 ? { ...label, accents: { ...label.accents, ...labelColors } } : label
}
