/**
 * Look of the interface on this device (« Réglages » tab, « Apparence » section): light / dark / system theme, accent
 * colour, colour of the bar and the rail. Part of the preferences (`preferences.ts`), not of the project.
 * Pure: `applyAppearance` writes an attribute and CSS custom properties on the root element; the dark and compact
 * variants themselves are in `theme.css` and `appearance.css`. The 3D view and the film overlay are not concerned.
 */
import { isRecord } from '../core/guards'
import { t } from '../i18n'

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]


export interface Appearance {
  theme: Theme
  /** '#rrggbb', the colour of primary buttons and selections (`--color-accent`) */
  accent: string
  /** '#rrggbb', the colour of the top bar, the rail and the status bar (`--surface-chrome`) */
  chrome: string
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'light', accent: '#b9391f', chrome: '#1b2832' }

/** Accent colours offered beside the free picker; each keeps white text at 4.5:1 or more as it is. */
export const ACCENT_PRESETS: readonly { color: string; label: string }[] = [
  { color: '#b9391f', get label() { return t('settings.preferences.accent.red') } },
  { color: '#2f6a8a', get label() { return t('settings.preferences.accent.blue') } },
  { color: '#3a6446', get label() { return t('settings.preferences.accent.green') } },
  { color: '#8a5700', get label() { return t('settings.preferences.accent.amber') } },
  { color: '#7a3b69', get label() { return t('settings.preferences.accent.plum') } },
  { color: '#4a55b8', get label() { return t('settings.preferences.accent.indigo') } },
  { color: '#00766f', get label() { return t('settings.preferences.accent.turquoise') } },
  { color: '#4e5c65', get label() { return t('settings.preferences.accent.slate') } },
]

/** Colours offered for the bar and the rail; the secondary text of the bar keeps 4.5:1 on each. */
export const CHROME_PRESETS: readonly { color: string; label: string }[] = [
  { color: '#1b2832', get label() { return t('settings.preferences.chrome.ink') } },
  { color: '#113b54', get label() { return t('settings.preferences.chrome.navy') } },
  { color: '#024442', get label() { return t('settings.preferences.chrome.pine') } },
  { color: '#3b1d38', get label() { return t('settings.preferences.chrome.plum') } },
  { color: '#2b2f33', get label() { return t('settings.preferences.chrome.graphite') } },
]

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number]

const WHITE = '#ffffff'
const BLACK = '#000000'
/** secondary text on the bar (`--color-glacier`) */
const GLACIER = '#a9ccd9'
/** surfaces of the dark theme (`theme.css`): panel and card, the accent shown on them stays readable */
const DARK_PANEL = '#151c22'
const DARK_CARD = '#1f2a32'
const MIN_CONTRAST = 4.5

const HEX = /^#[0-9a-f]{6}$/

/** '#rrggbb' of any case, the lower-case form; null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().toLowerCase()
  return HEX.test(hex) ? hex : null
}

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb

const toHex = (rgb: Rgb) => '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')

/** `a` moved toward `b` by `t` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const [ca, cb] = [toRgb(a), toRgb(b)]
  return toHex(ca.map((c, i) => c + (cb[i] - c) * t) as unknown as Rgb)
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two '#rrggbb' colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `hex` darkened, as little as possible, until it keeps `min` contrast against `against` (the colour itself when it already does). */
function darkenUntil(hex: string, against: string, min: number): string {
  for (let t = 0; t < 1; t += 0.02) {
    const c = mixHex(hex, BLACK, t)
    if (contrastRatio(c, against) >= min) return c
  }
  return BLACK
}

/** `hex` lightened, as little as possible, until it keeps `min` contrast against each of `backgrounds`. */
function lightenUntil(hex: string, backgrounds: readonly string[], min: number): string {
  for (let t = 0; t < 1; t += 0.02) {
    const c = mixHex(hex, WHITE, t)
    if (backgrounds.every((bg) => contrastRatio(c, bg) >= min)) return c
  }
  return WHITE
}

/** The accent darkened just enough for white text on it to keep 4.5:1 (a button, a selected switch). */
export function clampAccent(hex: string): string {
  return darkenUntil(hex, WHITE, MIN_CONTRAST)
}

/** The bar colour darkened just enough for its secondary text (glacier, and so white too) to keep 4.5:1. */
export function clampChrome(hex: string): string {
  return darkenUntil(hex, GLACIER, MIN_CONTRAST)
}

export interface AccentScale {
  /** fill with white text */
  accent: string
  /** hover of the fill, darker */
  strong: string
  /** selected tile or chip background, in the surface of the theme */
  tint: string
  /** accent on the bar and, in the dark theme, on panels: lightened to keep 4.5:1 there */
  light: string
}

/** The `--color-accent*` scale of an accent colour for the bar colour `chrome` and a light or dark panel. */
export function deriveAccent(hex: string, dark: boolean, chrome: string): AccentScale {
  const accent = clampAccent(hex)
  const tint = dark ? mixHex(DARK_PANEL, accent, 0.22) : mixHex(WHITE, accent, 0.14)
  const backgrounds = dark ? [chrome, DARK_CARD, tint] : [chrome]
  return { accent, strong: mixHex(accent, BLACK, 0.2), tint, light: lightenUntil(accent, backgrounds, MIN_CONTRAST) }
}

/** The bar colour (clamped) and the raised one of its menus and toasts. */
export function deriveChrome(hex: string): { chrome: string; raised: string } {
  const chrome = clampChrome(hex)
  return { chrome, raised: mixHex(chrome, WHITE, 0.06) }
}

// ---------------------------------------------------------------------------
// Parsing and application
// ---------------------------------------------------------------------------

/** The appearance of `raw` (the stored value), the defaults for anything missing or malformed. */
export function parseAppearance(raw: unknown): Appearance {
  const v = isRecord(raw) ? raw : {}
  return {
    theme: THEMES.find((t) => t === v.theme) ?? DEFAULT_APPEARANCE.theme,
    accent: normalizeHex(v.accent) ?? DEFAULT_APPEARANCE.accent,
    chrome: normalizeHex(v.chrome) ?? DEFAULT_APPEARANCE.chrome,
  }
}

/** Whether the theme in force is dark, the system's scheme being `systemDark`. */
export const isDarkTheme = (theme: Theme, systemDark: boolean) => (theme === 'system' ? systemDark : theme === 'dark')

/**
 * Put `appearance` on `root`: `data-theme` ('light' or 'dark', the system's resolved) and the CSS
 * custom properties of the accent and the bar colour. A colour left at its default sets nothing, so the palette of
 * `theme.css` applies as designed.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance, systemDark: boolean): void {
  const dark = isDarkTheme(appearance.theme, systemDark)
  root.dataset.theme = dark ? 'dark' : 'light'
  const customChrome = appearance.chrome !== DEFAULT_APPEARANCE.chrome
  // the lightened accent depends on the bar colour, the tint of the dark theme on the accent: both follow either
  const customAccent = appearance.accent !== DEFAULT_APPEARANCE.accent || customChrome
  const chrome = deriveChrome(appearance.chrome)
  const accent = deriveAccent(appearance.accent, dark, chrome.chrome)
  const vars: Record<string, string | null> = {
    '--surface-chrome': customChrome ? chrome.chrome : null,
    '--surface-chrome-raised': customChrome ? chrome.raised : null,
    '--color-accent': customAccent ? accent.accent : null,
    '--color-accent-strong': customAccent ? accent.strong : null,
    '--color-accent-tint': customAccent ? accent.tint : null,
    '--color-accent-light': customAccent ? accent.light : null,
  }
  for (const [name, value] of Object.entries(vars)) {
    if (value === null) root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
  // browser UI colour of the installed app follows the bar
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', customChrome ? chrome.chrome : DEFAULT_APPEARANCE.chrome)
}
