/**
 * Film overlay ("habillage") settings: style, widgets and their options. Part of `Settings` (key `overlay`),
 * so they are saved in the project document, undone, and read the same way by the preview and the export.
 *
 * Card timings are fractions of the flight (0 = start, 1 = end) so the cards keep their place at any duration;
 * the opening card starts with the film (opening shot included) and the closing card lasts until its end.
 * Pure module (no DOM, no React).
 */
import { isRecord } from '../core/guards'
import { t } from '../i18n'

export const OVERLAY_STYLES = ['editorial', 'broadcast', 'app', 'neon', 'cinema', 'journal', 'tableau'] as const
export type OverlayStyleId = (typeof OVERLAY_STYLES)[number]

export const OVERLAY_STYLE_LABELS: Record<OverlayStyleId, string> = {
  get editorial() { return t('overlay.style.editorial') },
  get broadcast() { return t('overlay.style.broadcast') },
  get app() { return t('overlay.style.app') },
  get neon() { return t('overlay.style.neon') },
  get cinema() { return t('overlay.style.cinema') },
  get journal() { return t('overlay.style.journal') },
  get tableau() { return t('overlay.style.tableau') },
}

/** Styles that existed for a short while and were dropped, each with the style an old project is opened in. */
const REMOVED_STYLES: Readonly<Record<string, OverlayStyleId>> = { sport: 'broadcast', mono: 'editorial', topo: 'editorial', magazine: 'editorial' }

/** Raw overlay or poster settings of an older project with a removed style id replaced by its successor (`SETTING_UPGRADES`). */
export function withKnownStyle(raw: unknown): unknown {
  if (!isRecord(raw) || typeof raw.style !== 'string') return raw
  const successor = Object.hasOwn(REMOVED_STYLES, raw.style) ? REMOVED_STYLES[raw.style] : undefined
  return successor ? { ...raw, style: successor } : raw
}

/** What keeps the text readable in a style without panel: a blurred rounded rectangle, the text's shadow, or its outline. */
export const TEXT_BACKINGS = ['blur', 'shadow', 'outline'] as const
export type TextBacking = (typeof TEXT_BACKINGS)[number]
export const DEFAULT_TEXT_BACKING: TextBacking = 'blur'

export const TEXT_BACKING_LABELS: Record<TextBacking, string> = {
  get blur() { return t('overlay.backing.blur') },
  get shadow() { return t('overlay.backing.shadow') },
  get outline() { return t('overlay.backing.outline') },
}

/** Kinds of 3D label, each with its own colour (the stripe, the dot and the pin of the label; same ids as `LandmarkKind`). */
export const LABEL_KINDS = ['climb', 'pass', 'peak', 'waypoint', 'water', 'hut', 'place', 'other', 'poi', 'km', 'endpoint'] as const
export type LabelKind = (typeof LABEL_KINDS)[number]

export const LABEL_KIND_LABELS: Record<LabelKind, string> = {
  get climb() { return t('overlay.labelKind.climb') },
  get pass() { return t('overlay.labelKind.pass') },
  get peak() { return t('overlay.labelKind.peak') },
  get waypoint() { return t('overlay.labelKind.waypoint') },
  get water() { return t('overlay.labelKind.water') },
  get hut() { return t('overlay.labelKind.hut') },
  get place() { return t('overlay.labelKind.place') },
  get other() { return t('overlay.labelKind.other') },
  get poi() { return t('overlay.labelKind.poi') },
  get km() { return t('overlay.labelKind.km') },
  get endpoint() { return t('overlay.labelKind.endpoint') },
}

/** The nine anchors of the safe area. */
export const OVERLAY_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number]

export const OVERLAY_ANCHOR_LABELS: Record<OverlayAnchor, string> = {
  get 'top-left'() { return t('overlay.anchor.top-left') },
  get 'top-center'() { return t('overlay.anchor.top-center') },
  get 'top-right'() { return t('overlay.anchor.top-right') },
  get 'middle-left'() { return t('overlay.anchor.middle-left') },
  get center() { return t('overlay.anchor.center') },
  get 'middle-right'() { return t('overlay.anchor.middle-right') },
  get 'bottom-left'() { return t('overlay.anchor.bottom-left') },
  get 'bottom-center'() { return t('overlay.anchor.bottom-center') },
  get 'bottom-right'() { return t('overlay.anchor.bottom-right') },
}

export const COUNTER_IDS = ['distance', 'altitude', 'ascent', 'slope', 'time', 'clock', 'speed', 'pace', 'heartRate', 'power', 'temperature'] as const
/** Counters added after the first saved format: off in older projects and presets (`withOverlayDefaults`). */
const COUNTERS_ADDED: readonly CounterId[] = ['slope', 'clock', 'pace', 'power', 'temperature']
export type CounterId = (typeof COUNTER_IDS)[number]

/** Size multiplier of a widget (1 = default size). */
export const WIDGET_SIZE_MIN = 0.2
export const WIDGET_SIZE_MAX = 2
/** Opening card: shown from the start until `end` (fraction of the flyover). */
export const TITLE_END_MIN = 0.01
export const TITLE_END_MAX = 0.3
/** Fade-out of the closing and opening cards, as a fraction of the flight (the fade-in is `CARD_FADE_IN` of the drawing). */
export const CARD_FADE_OUT = 0.025
/** Closing card: shown from `start` to the end. */
export const END_START_MIN = 0.6
export const END_START_MAX = 0.99
/** Elevation profile size, as fractions of the frame width / height. */
export const PROFILE_WIDTH_MIN = 0.1
export const PROFILE_WIDTH_MAX = 0.6
export const PROFILE_HEIGHT_MIN = 0.05
export const PROFILE_HEIGHT_MAX = 0.3
/** Corners where the source credits can sit (along the edge, outside the safe area). */
export const CREDITS_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const
export type CreditsPosition = (typeof CREDITS_POSITIONS)[number]
/** Longest side of the logo kept in the settings (pixels). */
export const LOGO_MAX_SIZE_PX = 512
/** Largest free offset of a widget from its anchor, either way (pixels of the exported film). */
export const OFFSET_MAX_PX = 10000

/** Fonts the user can pick for the titles or the figures: the bundled faces, then a few system families. */
export const OVERLAY_FONT_IDS = ['fraunces', 'plex', 'plex-condensed', 'georgia', 'system', 'mono'] as const
export type OverlayFontId = (typeof OVERLAY_FONT_IDS)[number]

export const OVERLAY_FONT_LABELS: Record<OverlayFontId, string> = {
  get fraunces() { return t('overlay.font.fraunces') },
  get plex() { return t('overlay.font.plex') },
  get 'plex-condensed'() { return t('overlay.font.plex-condensed') },
  get georgia() { return t('overlay.font.georgia') },
  get system() { return t('overlay.font.system') },
  get mono() { return t('overlay.font.mono') },
}

/**
 * The user's own touches on top of the chosen style; a missing field keeps the style's value.
 * Colours are '#rrggbb' (what `<input type="color">` gives).
 */
export interface OverlayOverrides {
  accent?: string
  text?: string
  /** panel behind the widgets (styles with a panel only) */
  panel?: string
  /** 0–1 */
  panelOpacity?: number
  titleFont?: OverlayFontId
  numberFont?: OverlayFontId
  /** what backs the text in a style without panel (absent = `DEFAULT_TEXT_BACKING`) */
  textBacking?: TextBacking
}

/**
 * Free position of a widget: pixels of the exported film (`settings.video`) from the corner of the safe area at its
 * anchor, towards the inside of the frame (to the right / down on a centred axis); scaled with the frame elsewhere.
 */
export interface WidgetOffset {
  x: number
  y: number
}

interface Placed {
  enabled: boolean
  anchor: OverlayAnchor
  /** free position (out of its anchor's stack, may overlap the others); absent = stacked at its anchor */
  offset?: WidgetOffset
  /** this widget's own colours and fonts, on top of the overlay's (`OverlaySettings.overrides`); absent = the same */
  overrides?: OverlayOverrides
}

interface Sized extends Placed {
  /** multiplier, WIDGET_SIZE_MIN–WIDGET_SIZE_MAX */
  size: number
}

/** Where a card of the film is, in film seconds from the first frame: set by placing its block on the timeline. */
export interface CardWindow {
  startS: number
  endS: number
  /** the card reaches the end of the film: it keeps its length and stays there when the film gets shorter or longer */
  toEnd?: boolean
}
/** Longest film time a card window may reach (seconds). */
export const CARD_WINDOW_MAX_S = 7200

/**
 * The window as it is in a film `totalS` long, which may not be the one it was placed in (the flyover duration, a
 * shot or a stop changed since): a window that reached the end of the film keeps its length and stays at the end;
 * any other one that would go past the end slides back to it; it is never longer than the film.
 */
export function fitWindow(window: CardWindow, totalS: number): CardWindow {
  const length = Math.min(window.endS - window.startS, totalS)
  if (window.toEnd) return { startS: totalS - length, endS: totalS, toEnd: true }
  if (window.endS <= totalS) return window
  return { startS: totalS - length, endS: totalS }
}

export interface TitleCardSettings extends Sized, CardExtras {
  /** '' = name of the track */
  title: string
  subtitle: string
  /** prefix the subtitle with the date of the track (when it has one) */
  showDate: boolean
  /** end of the card, fraction of the flight after the opening shot (until its block is placed: `window`) */
  end: number
  /** where the block is on the timeline; absent: from the first frame to `end` */
  window?: CardWindow
}

/** Figures a card can show, in the order it draws them. */
export const CARD_FIGURES = ['distance', 'ascent', 'descent', 'maxAltitude', 'minAltitude', 'time', 'maxSpeed', 'avgSpeed', 'avgPace', 'date'] as const
export type CardFigure = (typeof CARD_FIGURES)[number]
/** The figures of the closing card until others are chosen: those it always showed. */
export const END_CARD_FIGURES: readonly CardFigure[] = ['distance', 'ascent', 'maxAltitude', 'time', 'maxSpeed']
/** Longest free line of a card (characters). */
export const CARD_LINE_MAX = 120

/** What a card shows besides its title, chosen in its inspector; absent = not shown (`figures`: the card's own). */
export interface CardExtras {
  /** the figures, drawn in the order of CARD_FIGURES */
  figures?: CardFigure[]
  /** a line of the user's own under the title */
  line?: string
  /** a picture above the title (PNG data URL, like the logo) */
  image?: string
  /** the elevation profile of the whole track under the figures */
  showProfile?: boolean
  /** the plan view of the whole track under the figures */
  showMinimap?: boolean
}

export interface EndCardSettings extends Sized, CardExtras {
  /** '' = name of the track */
  title: string
  /** start of the card, fraction of the flight (shown until the end of the film, closing shot included; until its block is placed: `window`) */
  start: number
  /** where the block is on the timeline; absent: from `start` to the last frame */
  window?: CardWindow
  /** weather summary line of the outing (when known) */
  showWeather: boolean
  /** « Générique »: one name or line per line, rolling up under the card to the end of the film; absent or blank = none */
  credits?: string
}

/** Longest rolling credits kept (characters). */
export const END_CREDITS_MAX = 2000

export interface CountersSettings extends Sized {
  fields: Record<CounterId, boolean>
}

export interface ProfileSettings extends Placed {
  /** fraction of the frame width */
  width: number
  /** fraction of the frame height */
  height: number
  /** '#rrggbb' of the position dot; absent or '' = the colour of the 3D marker */
  markerColor?: string
}

export interface LogoSettings extends Sized {
  /** PNG data URL ('' = none), at most LOGO_MAX_SIZE_PX on its longest side: projects stay self-contained */
  image: string
  /** 0–1 */
  opacity: number
}

export interface TextSettings extends Sized {
  text: string
}

export interface MiniMapSettings extends Sized {
  /** small north arrow beside the map (north is always up) */
  northArrow: boolean
  /** '#rrggbb' of the position dot; absent or '' = the colour of the 3D marker */
  markerColor?: string
}

/**
 * Credits of the map, relief, weather and OpenStreetMap sources burned into every frame (their licences require
 * attribution in the published film). Independent of `enabled`: drawn even without the rest of the overlay.
 */
export interface CreditsSettings {
  enabled: boolean
  position: CreditsPosition
}

export interface OverlaySettings {
  enabled: boolean
  style: OverlayStyleId
  title: TitleCardSettings
  end: EndCardSettings
  counters: CountersSettings
  profile: ProfileSettings
  logo: LogoSettings
  text: TextSettings
  /** weather under the marker: condition, temperature, wind (Open-Meteo, when the outing's weather is known) */
  weather: Sized
  /** plan view of the whole track, covered part and marker */
  minimap: MiniMapSettings
  /** ghost race: tracks ranked at the marker, with their gap to the first (2+ tracks, race on) */
  leaderboard: Sized
  credits: CreditsSettings
  /** colours and fonts changed on top of the style; absent = the style as designed */
  overrides?: OverlayOverrides
  /** colour of the 3D labels by kind, on top of the style's; a missing kind keeps the style's */
  labelColors?: Partial<Record<LabelKind, string>>
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  enabled: false,
  style: 'editorial',
  title: { enabled: false, anchor: 'center', size: 1, title: '', subtitle: '', showDate: true, end: 0.1 },
  end: { enabled: false, anchor: 'center', size: 1, title: '', start: 0.9, showWeather: true },
  counters: {
    enabled: true,
    anchor: 'top-left',
    size: 1,
    fields: { distance: true, altitude: true, ascent: true, slope: false, time: true, clock: false, speed: false, pace: false, heartRate: false, power: false, temperature: false },
  },
  profile: { enabled: true, anchor: 'top-right', width: 0.3, height: 0.12 },
  logo: { enabled: false, anchor: 'bottom-right', size: 1, image: '', opacity: 1 },
  text: { enabled: false, anchor: 'bottom-left', size: 1, text: '' },
  weather: { enabled: false, anchor: 'top-left', size: 1 },
  minimap: { enabled: false, anchor: 'bottom-right', size: 1, northArrow: true },
  leaderboard: { enabled: false, anchor: 'middle-right', size: 1 },
  credits: { enabled: true, position: 'bottom-right' },
}

/** Widgets a style places: its anchors and sizes are applied when the style is chosen (`withStyleLayout`). */
export const LAID_OUT_WIDGETS = ['title', 'end', 'counters', 'profile', 'minimap', 'weather'] as const
export type LaidOutWidget = (typeof LAID_OUT_WIDGETS)[number]

/** Where a style puts its widgets, and where it draws them itself as part of its structure (bars, sheet, band). */
export interface StyleLayout {
  title: { anchor: OverlayAnchor; size: number }
  end: { anchor: OverlayAnchor; size: number }
  counters: { anchor: OverlayAnchor; size: number }
  profile: { anchor: OverlayAnchor; width: number; height: number }
  minimap: { anchor: OverlayAnchor; size: number }
  weather: { anchor: OverlayAnchor; size: number }
  /** anchors at which a widget sits in the structure of the style; at any other (or with a free offset) it stays an ordinary widget */
  slots: Record<LaidOutWidget, readonly OverlayAnchor[]>
}

const LEFT_COLUMN: readonly OverlayAnchor[] = ['top-left', 'middle-left', 'bottom-left']

/** Styles with a structure of their own; the others draw the widgets where the user's anchors put them. */
export const STYLE_LAYOUTS: Partial<Record<OverlayStyleId, StyleLayout>> = {
  // letterbox bars: figures as a subtitle line in the bottom bar, profile on its top edge, weather and map in the top bar
  cinema: {
    title: { anchor: 'center', size: 1 },
    end: { anchor: 'center', size: 1 },
    counters: { anchor: 'bottom-center', size: 1 },
    profile: { anchor: 'bottom-center', width: 0.3, height: 0.05 },
    minimap: { anchor: 'top-right', size: 0.5 },
    weather: { anchor: 'top-left', size: 1 },
    slots: { title: [], end: [], counters: ['bottom-center'], profile: ['bottom-center'], minimap: ['top-right'], weather: ['top-left'] },
  },
  // a paper sheet down the left edge: title, list of figures, map and profile one under the other
  journal: {
    title: { anchor: 'top-left', size: 1 },
    end: { anchor: 'top-left', size: 1 },
    counters: { anchor: 'middle-left', size: 1 },
    profile: { anchor: 'bottom-left', width: 0.2, height: 0.12 },
    minimap: { anchor: 'middle-left', size: 1 },
    weather: { anchor: 'middle-left', size: 1 },
    slots: { title: LEFT_COLUMN, end: LEFT_COLUMN, counters: LEFT_COLUMN, profile: LEFT_COLUMN, minimap: LEFT_COLUMN, weather: LEFT_COLUMN },
  },
  // a dark band along the bottom: big figures over the profile; title stripe at the top left, round map at the top right
  tableau: {
    title: { anchor: 'top-left', size: 1 },
    end: { anchor: 'center', size: 1 },
    counters: { anchor: 'bottom-center', size: 1 },
    profile: { anchor: 'bottom-center', width: 0.6, height: 0.2 },
    minimap: { anchor: 'top-right', size: 1 },
    weather: { anchor: 'top-center', size: 1 },
    slots: { title: ['top-left'], end: [], counters: ['bottom-center'], profile: ['bottom-center'], minimap: ['top-right'], weather: [] },
  },
}

/** Placement of the styles without a structure: the defaults of a new project. */
const FREE_LAYOUT: StyleLayout = {
  title: { anchor: DEFAULT_OVERLAY.title.anchor, size: DEFAULT_OVERLAY.title.size },
  end: { anchor: DEFAULT_OVERLAY.end.anchor, size: DEFAULT_OVERLAY.end.size },
  counters: { anchor: DEFAULT_OVERLAY.counters.anchor, size: DEFAULT_OVERLAY.counters.size },
  profile: { anchor: DEFAULT_OVERLAY.profile.anchor, width: DEFAULT_OVERLAY.profile.width, height: DEFAULT_OVERLAY.profile.height },
  minimap: { anchor: DEFAULT_OVERLAY.minimap.anchor, size: DEFAULT_OVERLAY.minimap.size },
  weather: { anchor: DEFAULT_OVERLAY.weather.anchor, size: DEFAULT_OVERLAY.weather.size },
  slots: { title: [], end: [], counters: [], profile: [], minimap: [], weather: [] },
}

/**
 * `overlay` in `style`, with the style's placement of its widgets (anchors, sizes, no free offset) when the style
 * changes; going from a style with a structure to one without puts them back where a new project has them.
 * Nothing is touched while the style stays the same, so the user's own positions are kept.
 */
export function withStyleLayout(overlay: OverlaySettings, style: OverlayStyleId): OverlaySettings {
  if (overlay.style === style) return overlay
  const layout = STYLE_LAYOUTS[style] ?? (STYLE_LAYOUTS[overlay.style] ? FREE_LAYOUT : undefined)
  if (!layout) return { ...overlay, style }
  const place = <K extends LaidOutWidget>(key: K): OverlaySettings[K] => {
    const { offset: _offset, ...rest } = overlay[key]
    return { ...rest, ...layout[key] } as OverlaySettings[K]
  }
  return { ...overlay, style, title: place('title'), end: place('end'), counters: place('counters'), profile: place('profile'), minimap: place('minimap'), weather: place('weather') }
}

/** Is widget `key` where the structure of the style draws it (a slot of the style, no free offset)? Else it is an ordinary widget. */
export function inStyleSlot(overlay: OverlaySettings, key: LaidOutWidget): boolean {
  const layout = STYLE_LAYOUTS[overlay.style]
  return layout !== undefined && !overlay[key].offset && layout.slots[key].includes(overlay[key].anchor)
}

/** Widgets added after the first saved format: missing from older projects and presets. */
const OVERLAY_ADDED_KEYS: readonly (keyof OverlaySettings)[] = ['minimap', 'credits', 'leaderboard']

/**
 * Raw overlay settings of an older project or preset with the widgets (and the logo opacity) added since filled in
 * with their defaults, so they still load. Applied before the shape check: anything else (other keys, a present but
 * malformed widget) is left as is and still rejected.
 */
export function withOverlayDefaults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const missing = OVERLAY_ADDED_KEYS.filter((key) => !(key in raw))
  const filled = missing.length === 0 ? raw : { ...Object.fromEntries(missing.map((key) => [key, DEFAULT_OVERLAY[key]])), ...raw }
  const logo = raw.logo
  const withLogo = isRecord(logo) && !('opacity' in logo) ? { ...filled, logo: { ...logo, opacity: DEFAULT_OVERLAY.logo.opacity } } : filled
  // the counters added since: off
  const counters = raw.counters
  const fields = isRecord(counters) ? counters.fields : undefined
  if (!isRecord(counters) || !isRecord(fields) || COUNTERS_ADDED.every((id) => id in fields)) return withLogo
  return { ...withLogo, counters: { ...counters, fields: { ...Object.fromEntries(COUNTERS_ADDED.map((id) => [id, false])), ...fields } } }
}

/**
 * Overlay settings with `patch` applied to the overrides (null: back to the style). Unset fields are dropped, and
 * the key itself once nothing is left, so the style as designed equals the defaults again (« modifié » marker).
 */
export function withOverrides(overlay: OverlaySettings, patch: OverlayOverrides | null): OverlaySettings {
  const { overrides, ...rest } = overlay
  const kept = mergeOverrides(overrides, patch)
  return kept ? { ...rest, overrides: kept } : rest
}

/** `overrides` patched (null: none left), fields set to undefined dropped; undefined once nothing is left. */
function mergeOverrides(overrides: OverlayOverrides | undefined, patch: OverlayOverrides | null): OverlayOverrides | undefined {
  const merged = patch === null ? {} : { ...overrides, ...patch }
  const kept: OverlayOverrides = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined))
  return Object.keys(kept).length > 0 ? kept : undefined
}

/** Widgets whose colours and fonts can differ from the rest of the overlay (the logo is an image). */
export const STYLED_WIDGETS = ['title', 'end', 'counters', 'profile', 'weather', 'minimap', 'leaderboard', 'text'] as const
export type StyledWidget = (typeof STYLED_WIDGETS)[number]

/** `overlay` with the overrides of widget `key` patched like `withOverrides` (null: back to the overlay's). */
export function withWidgetOverrides(overlay: OverlaySettings, key: StyledWidget, patch: OverlayOverrides | null): OverlaySettings {
  const { overrides, ...rest } = overlay[key]
  const kept = mergeOverrides(overrides, patch)
  return { ...overlay, [key]: kept ? { ...rest, overrides: kept } : rest }
}

/** Widgets laid out at an anchor, which can leave its stack for a free position (`offset`). */
export const PLACED_WIDGETS = ['title', 'end', 'counters', 'profile', 'logo', 'text', 'weather', 'minimap', 'leaderboard'] as const
export type PlacedWidget = (typeof PLACED_WIDGETS)[number]

/** `overlay` with widget `key` at the free position `offset`, or back in its anchor's stack (null: the key dropped). */
export function withWidgetOffset(overlay: OverlaySettings, key: PlacedWidget, offset: WidgetOffset | null): OverlaySettings {
  const { offset: _offset, ...rest } = overlay[key]
  return { ...overlay, [key]: offset ? { ...rest, offset } : rest }
}

/** Overrides drawn for widget `key`: the overlay's, then the widget's own; undefined when neither has any. */
export function widgetOverrides(overlay: OverlaySettings, key: StyledWidget): OverlayOverrides | undefined {
  const own = overlay[key].overrides
  return own ? { ...overlay.overrides, ...own } : overlay.overrides
}

const within = (v: number, min: number, max: number) => v >= min && v <= max
const isAnchor = (v: string) => (OVERLAY_ANCHORS as readonly string[]).includes(v)
const validSized = (w: Sized) => isAnchor(w.anchor) && within(w.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX)

const OVERRIDE_CHECKS: { [K in keyof OverlayOverrides]-?: (v: unknown) => boolean } = {
  accent: isHexColor,
  text: isHexColor,
  panel: isHexColor,
  panelOpacity: (v) => typeof v === 'number' && within(v, 0, 1),
  titleFont: (v) => (OVERLAY_FONT_IDS as readonly unknown[]).includes(v),
  numberFont: (v) => (OVERLAY_FONT_IDS as readonly unknown[]).includes(v),
  textBacking: (v) => (TEXT_BACKINGS as readonly unknown[]).includes(v),
}

/** '#rrggbb' (either case). */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}

/**
 * Overrides read from a project: absent, or an object of known fields with valid values. Not covered by the
 * shape check of the project document (the key is optional), so everything is checked here.
 */
export function isValidOverrides(o: unknown): boolean {
  if (o === undefined) return true
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false
  return Object.entries(o).every(([key, value]) => Object.hasOwn(OVERRIDE_CHECKS, key) && OVERRIDE_CHECKS[key as keyof OverlayOverrides](value))
}

/** Position dot colour read from a project: absent, '' (the marker's) or '#rrggbb'. */
function isValidDotColor(v: unknown): boolean {
  return v === undefined || v === '' || isHexColor(v)
}

/** Label colours read from a project: absent, or an object of known kinds with '#rrggbb' values. */
export function isValidLabelColors(o: unknown): boolean {
  if (o === undefined) return true
  return isRecord(o) && Object.entries(o).every(([kind, color]) => (LABEL_KINDS as readonly string[]).includes(kind) && isHexColor(color))
}

/** `overlay` with the colour of label `kind` set to `color` ('#rrggbb'), or back to the style's (null); the key dropped once none is left. */
export function withLabelColor(overlay: OverlaySettings, kind: LabelKind, color: string | null): OverlaySettings {
  const { labelColors, ...rest } = overlay
  const kept = Object.fromEntries(Object.entries({ ...labelColors, [kind]: color }).filter(([, v]) => v !== null)) as Partial<Record<LabelKind, string>>
  return Object.keys(kept).length > 0 ? { ...rest, labelColors: kept } : rest
}

const isOffsetValue = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= OFFSET_MAX_PX

/** Free position read from a project: absent, or exactly `{ x, y }` within ±OFFSET_MAX_PX (not covered by the shape check). */
export function isValidOffset(o: unknown): boolean {
  if (o === undefined) return true
  return isRecord(o) && Object.keys(o).length === 2 && isOffsetValue(o.x) && isOffsetValue(o.y)
}

const isLogoImage = (image: string) => image === '' || /^data:image\/(png|jpeg|webp);base64,/.test(image)

const validExtras = (c: CardExtras) =>
  (c.figures === undefined ||
    (Array.isArray(c.figures) && c.figures.every((f, i) => (CARD_FIGURES as readonly string[]).includes(f) && c.figures?.indexOf(f) === i))) &&
  (c.line === undefined || (typeof c.line === 'string' && c.line.length <= CARD_LINE_MAX)) &&
  (c.image === undefined || (typeof c.image === 'string' && isLogoImage(c.image))) &&
  (c.showProfile === undefined || typeof c.showProfile === 'boolean') &&
  (c.showMinimap === undefined || typeof c.showMinimap === 'boolean')

const validWindow = (w: CardWindow | undefined) =>
  w === undefined ||
  (isRecord(w) && typeof w.startS === 'number' && typeof w.endS === 'number' && within(w.startS, 0, CARD_WINDOW_MAX_S) && within(w.endS, 0, CARD_WINDOW_MAX_S) && w.endS > w.startS && (w.toEnd === undefined || typeof w.toEnd === 'boolean'))

/**
 * Value checks of overlay settings whose JSON shape is already known to match `DEFAULT_OVERLAY`
 * (see `SETTING_CHECKS` in the project document): enumerations, ranges, logo format, colour and font overrides.
 */
export function isValidOverlay(o: OverlaySettings): boolean {
  return (
    (OVERLAY_STYLES as readonly string[]).includes(o.style) &&
    validSized(o.title) &&
    within(o.title.end, TITLE_END_MIN, TITLE_END_MAX) &&
    validWindow(o.title.window) &&
    validExtras(o.title) &&
    validSized(o.end) &&
    within(o.end.start, END_START_MIN, END_START_MAX) &&
    validWindow(o.end.window) &&
    (o.end.credits === undefined || (typeof o.end.credits === 'string' && o.end.credits.length <= END_CREDITS_MAX)) &&
    validExtras(o.end) &&
    validSized(o.counters) &&
    isAnchor(o.profile.anchor) &&
    within(o.profile.width, PROFILE_WIDTH_MIN, PROFILE_WIDTH_MAX) &&
    within(o.profile.height, PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX) &&
    validSized(o.logo) &&
    isLogoImage(o.logo.image) &&
    within(o.logo.opacity, 0, 1) &&
    validSized(o.text) &&
    validSized(o.weather) &&
    validSized(o.minimap) &&
    isValidDotColor(o.profile.markerColor) &&
    isValidDotColor(o.minimap.markerColor) &&
    validSized(o.leaderboard) &&
    (CREDITS_POSITIONS as readonly string[]).includes(o.credits.position) &&
    isValidOverrides(o.overrides) &&
    isValidLabelColors(o.labelColors) &&
    STYLED_WIDGETS.every((key) => isValidOverrides(o[key].overrides)) &&
    PLACED_WIDGETS.every((key) => isValidOffset(o[key].offset))
  )
}
