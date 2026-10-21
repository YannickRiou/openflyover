/**
 * Film overlay drawing: one pure, synchronous function of (frame values, settings, frame size) onto a 2D canvas
 * context. The preview and the video export call the same `drawOverlay`, so the film shows what the preview shows.
 *
 * Every dimension derives from the frame size: 1 u = 1 % of its shorter side, safe margins = 5 % of each side.
 * No DOM access: fonts and the logo image are loaded beforehand (`assets.ts`). What is timed in film seconds reads
 * the film time of the frame (`OverlayTime`); the live values follow the progress (`OverlayFrame`).
 * Photos and video clips of the timeline are drawn even while the rest of the overlay is off.
 */
import type { ClockJunction } from '../film/clock'
import { MISSING_COLOR } from '../flyover/trackColor'
import type { TrackLegend } from '../flyover/trackColor'
import { fillTemplate } from '../film/junctions'
import { clipTimeS } from '../film/model'
import type { DayCardField, FilmMedia, FilmText, TransitionDip } from '../film/model'
import type { DayFigures } from '../film/days'
import { getLanguage, t } from '../i18n'
import type { MessageKey } from '../i18n'
import { formatDate } from '../i18n/format'
import { formatClock, formatDistance, formatDuration, formatNumber, formatPace } from '../ui/format'
import { openMeteoAttribution } from '../weather/openMeteo'
import type { WeatherSummary } from '../weather/series'
import { recordedAtProgress } from './data'
import type { LeaderboardRow, OverlayFrame, OverlayTrack } from './data'
import type { CardExtras, CardFigure, CardWindow, CounterId, CreditsPosition, EndCardSettings, LaidOutWidget, TitleCardSettings, OverlayAnchor, OverlayFontId, OverlaySettings, PlacedWidget, StyledWidget, WidgetOffset } from './settings'
import { CARD_FIGURES, COUNTER_IDS, DEFAULT_TEXT_BACKING, END_CARD_FIGURES, fitWindow, inStyleSlot, widgetOverrides } from './settings'
import { OVERLAY_FONT_FAMILIES, resolveOverlayTheme, softTextOf } from './themes'
import type { OverlayTheme } from './themes'
import { styleStructure } from './structures'
import type { Rect, Structure } from './structures'

/** On screen (preview) or offscreen (video export). */
export type OverlayContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Size of the frame in the context's user units (CSS pixels in the preview, video pixels in the export). */
export interface OverlaySize {
  width: number
  height: number
}

/** A decoded image and its size. */
export interface OverlayImage {
  image: CanvasImageSource
  width: number
  height: number
}

/** Decoded images used by the overlay (loaded asynchronously before drawing). */
export interface OverlayAssets {
  logo?: OverlayImage | null
  /** decoded picture of a photo of the timeline (`FilmMedia.src`), undefined while it is not loaded */
  photo?: (src: string) => OverlayImage | undefined
  /** frame of a video clip of the timeline at `clipS` seconds in its file (`clipTimeS`), undefined while it is not ready */
  video?: (item: FilmMedia, clipS: number) => OverlayImage | undefined
  /** decoded picture of a card (`CardExtras.image`), undefined while it is not loaded */
  cardImage?: (dataUrl: string) => OverlayImage | undefined
}

/** Where a frame is in the film: film time and the lengths of the film clock (seconds at ×1). */
export interface OverlayTime {
  /** film time of the frame, from the very first frame (opening shot included) */
  timeS: number
  /** opening shot, flight (stops included) and whole film */
  openingS: number
  flightS: number
  totalS: number
  /** film times of the cuts between stages « À la suite » (none otherwise) */
  cutsS?: readonly number[]
  /** the junctions at those cuts, in the same order: the dip of a held transition, the end of a stage card */
  junctions?: readonly OverlayJunction[]
  /** film times the cards of the days of a multi-day track appear (`ClockDay.cardS`; none otherwise) */
  dayCardsS?: readonly number[]
}

/** What the overlay reads of a junction placed on the clock (`ClockJunction`). */
export type OverlayJunction = Pick<ClockJunction, 'kind' | 'startS' | 'holdStartS' | 'holdEndS' | 'endS'>

/** What the overlay reads from the film clock (`FilmClock`). */
export interface OverlayClock {
  openingS: number
  flightS: number
  totalTime(): number
  timeAtProgress(progress: number): number
  cuts?: readonly { timeS: number }[]
  junctions?: readonly OverlayJunction[]
  days?: readonly { cardS: number }[]
}

/** Film time of a frame shown at `progress` and film time `timeS` (null: set from the progress, as the playback does). */
export function overlayTime(clock: OverlayClock, progress: number, timeS: number | null): OverlayTime {
  const time: OverlayTime = { timeS: timeS ?? clock.timeAtProgress(progress), openingS: clock.openingS, flightS: clock.flightS, totalS: clock.totalTime() }
  if (clock.cuts && clock.cuts.length > 0) time.cutsS = clock.cuts.map((c) => c.timeS)
  if (clock.junctions && clock.junctions.length > 0) time.junctions = clock.junctions
  if (clock.days && clock.days.length > 0) time.dayCardsS = clock.days.map((d) => d.cardS)
  return time
}

/** A film reduced to its flight, one second long: film time = progress (no clock at hand, tests). */
export function progressTime(progress: number): OverlayTime {
  return { timeS: progress, openingS: 0, flightS: 1, totalS: 1 }
}

/** What the overlay draws beyond the values of the track. */
export interface OverlayExtras {
  /** where the frame is in the film; default `progressTime(frame.progress)` */
  time?: OverlayTime
  /** texts of the timeline (`settings.film.texts`), drawn inside their window */
  texts?: readonly FilmText[]
  /** photos and clips of the timeline (`settings.film.media`), drawn inside their window once their picture or frame is loaded */
  media?: readonly FilmMedia[]
  /** credits of the sources in the film (`overlayCredits`), drawn while `settings.credits` is on */
  credits?: readonly string[]
  /** ghost-race leaderboard at the frame's progress (`leaderboardRows`), drawn while `settings.leaderboard` is on */
  leaderboard?: readonly LeaderboardRow[]
  /** dip to black or white of a shot transition at the frame's time (`transitionDipAt`), drawn even while the overlay is off */
  dip?: TransitionDip | null
  /** card of the stage starting « À la suite » (`stageCardAt`), drawn inside its window, over the dip, even while the overlay is off */
  stage?: StageCard | null
  /** card of the day starting in a multi-day track (`dayCardAt`), drawn inside its window */
  day?: DayCard | null
  /** size of the exported film, which the free offsets of the widgets are measured in; default: the drawn frame */
  exportSize?: OverlaySize
  /** colour of the 3D marker ('#rrggbb'): the position dot of the profile and the mini-map, until they have their own */
  markerColor?: string
  /** legend of the track colouring (`trackLegend`) and its place, drawn even while the overlay is off */
  trackLegend?: OverlayTrackLegend | null
}

/** Legend of the track colouring as the overlay draws it: the values, and the anchor chosen for it. */
export interface OverlayTrackLegend extends TrackLegend {
  anchor: OverlayAnchor
}

/**
 * Card of a stage « À la suite »: name, number, date and figures of its track, shown from `startS` for `durationS`,
 * as the automatic card, or as `text` and `subtitle` (`fillTemplate`) when the film gives them.
 */
export interface StageCard {
  name: string
  /** 0 for the first stage */
  index: number
  count: number
  /** recorded start (ms since epoch) */
  startTime?: number
  distanceM: number
  ascentM?: number
  startS: number
  durationS: number
  anchor: OverlayAnchor
  size: number
  text?: string
  subtitle?: string
  color?: string
  font?: OverlayFontId
}

/** Card of a day of a multi-day track (`dayCardAt`): its figures and how the film wants them shown, from `startS` for `durationS`. */
export interface DayCard {
  figures: DayFigures
  startS: number
  durationS: number
  anchor: OverlayAnchor
  size: number
  fields: Readonly<Record<DayCardField, boolean>>
  /** title with `{n}`, `{count}` and `{date}` (`fillTemplate`); absent: « Jour n » */
  title?: string
}

/** Safe area: 5 % of the frame on each side. */
export const SAFE_MARGIN = 0.05
/** Fade lengths of the cards, as fractions of the flight. */
export const CARD_FADE_IN = 0.01
export const CARD_FADE_OUT = 0.025
/** Fade in and out of a timeline text or photo (seconds, at most a quarter of its duration each). */
export const TEXT_FADE_S = 0.4
/** Ken Burns move of a full-screen photo: zoom at one end (1 at the other), largest pan (fraction of the picture side). */
export const KEN_BURNS_ZOOM = 1.1
const KEN_BURNS_PAN = 0.04
/** Smallest elevation range drawn full height (a flat track stays flat), as in the timeline profile. */
export const PROFILE_MIN_SPAN_M = 100
/** Longer side of the mini-map at size 1 (u), and its most elongated box (longer side / shorter side). */
const MINIMAP_SIDE_U = 20
const MINIMAP_MAX_RATIO = 1.6

/** Short labels drawn in the film. */
export const COUNTER_LABELS: Record<CounterId, string> = {
  get distance() { return t('overlay.draw.counter.distance') },
  get altitude() { return t('overlay.draw.counter.altitude') },
  get ascent() { return t('overlay.draw.counter.ascent') },
  get time() { return t('overlay.draw.counter.time') },
  get speed() { return t('overlay.draw.counter.speed') },
  get heartRate() { return t('overlay.draw.counter.heartRate') },
  get slope() { return t('overlay.draw.counter.slope') },
  get clock() { return t('overlay.draw.counter.clock') },
  get pace() { return t('overlay.draw.counter.pace') },
  get power() { return t('overlay.draw.counter.power') },
  get temperature() { return t('overlay.draw.counter.temperature') },
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** smoothstep over [0, length]; a step at 0 for a zero length */
const ramp = (x: number, length: number) => (length > 0 ? smoothstep(x / length) : x > 0 ? 1 : 0)

/**
 * Opening card: fades in from the first frame of the film, out before `end` of the flight (fraction of the
 * flight after the opening shot); so it is shown over the whole opening shot, then a little into the flight.
 */
export function titleCardOpacity(time: OverlayTime, end: number): number {
  const endS = time.openingS + end * time.flightS
  const t = time.timeS
  if (t >= endS) return 0
  const fadeIn = Math.min(CARD_FADE_IN * time.flightS, endS / 4)
  const fadeOut = Math.min(CARD_FADE_OUT * time.flightS, endS / 3)
  return ramp(t, fadeIn) * ramp(endS - t, fadeOut)
}

/** Closing card: fades in after `start` of the flight, stays until the end of the film (closing shot included). */
export function endCardOpacity(time: OverlayTime, start: number): number {
  const startS = time.openingS + start * time.flightS
  return time.timeS <= startS ? 0 : ramp(time.timeS - startS, CARD_FADE_OUT * time.flightS)
}

/**
 * Opacity of the opening card of `card` (its settings): where its block was placed on the timeline (`window`) it fades
 * in and out inside it; else as `titleCardOpacity`, from the first frame to `end` of the flight.
 */
export function titleCardOpacityOf(time: OverlayTime, card: Pick<TitleCardSettings, 'end' | 'window'>): number {
  if (!card.window) return titleCardOpacity(time, card.end)
  const { startS, endS } = fitWindow(card.window, time.totalS)
  const t = time.timeS
  if (t < startS || t >= endS) return 0
  const fadeIn = Math.min(CARD_FADE_IN * time.flightS, (endS - startS) / 4)
  const fadeOut = Math.min(CARD_FADE_OUT * time.flightS, (endS - startS) / 3)
  return ramp(t - startS, fadeIn) * ramp(endS - t, fadeOut)
}

/**
 * Opacity of the closing card: placed on the timeline (`window`) it fades in and out inside it (it stays to the last
 * frame when its window ends with the film); else as `endCardOpacity`, from `start` of the flight to the end.
 */
export function endCardOpacityOf(time: OverlayTime, card: Pick<EndCardSettings, 'start' | 'window'>): number {
  if (!card.window) return endCardOpacity(time, card.start)
  const { startS, endS } = fitWindow(card.window, time.totalS)
  const t = time.timeS
  if (t <= startS || (t >= endS && endS < time.totalS)) return 0
  const fade = CARD_FADE_OUT * time.flightS
  return ramp(t - startS, fade) * (endS >= time.totalS ? 1 : ramp(endS - t, fade))
}

/** Lines of the rolling credits: trimmed, blank ones dropped. */
export function creditLines(credits: string | undefined): string[] {
  return (credits ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
}

/**
 * How far the rolling credits are, 0–1: the card first holds still while it fades in, then card and credits roll
 * up until the end of the film (the last line leaves the frame on the last frame).
 */
export function creditsRollProgress(time: OverlayTime, start: number, window?: CardWindow): number {
  const placed = window && fitWindow(window, time.totalS)
  const startS = placed ? placed.startS : time.openingS + start * time.flightS
  const rollS = (placed ? Math.min(placed.endS, time.totalS) : time.totalS) - startS
  const holdS = CARD_FADE_OUT * time.flightS
  if (rollS <= holdS) return 0
  return Math.min(1, Math.max(0, (time.timeS - startS - holdS) / (rollS - holdS)))
}

/**
 * Opacity of the opening or closing card at film time `time` (the larger one), 0 while the overlay is off. Pure
 * function of the time and the settings: the live widgets give way to the cards.
 */
export function cardOpacityAt(time: OverlayTime, settings: OverlaySettings): number {
  if (!settings.enabled) return 0
  const title = settings.title.enabled ? titleCardOpacityOf(time, settings.title) : 0
  const end = settings.end.enabled ? endCardOpacityOf(time, settings.end) : 0
  return Math.max(title, end)
}

/** Opacity of a timeline text at film time `timeS`: 0 outside [startS, startS + durationS), short fades at both ends. */
export function filmTextOpacity(text: Pick<FilmText, 'startS' | 'durationS'>, timeS: number): number {
  const local = timeS - text.startS
  if (local < 0 || local >= text.durationS) return 0
  const fade = Math.min(TEXT_FADE_S, text.durationS / 4)
  return ramp(local, fade) * ramp(text.durationS - local, fade)
}

/**
 * Opacities of what the overlay times in film seconds at `time` (opening and closing cards, timeline texts and
 * photos, the dip of a shot transition, plus the time itself while a full-screen photo moves or a video clip plays):
 * two frames of one progress with the same values draw the same overlay, so the export may repeat a held frame.
 */
export function overlayTimedState(
  settings: OverlaySettings,
  texts: readonly FilmText[],
  time: OverlayTime,
  media: readonly FilmMedia[] = [],
  dipAlpha = 0,
): number[] {
  const photos = media.flatMap((item) => {
    const opacity = filmTextOpacity(item, time.timeS)
    const moving = item.kind === 'video' || (item.layout === 'plein-ecran' && item.kenBurns)
    return opacity > 0 && moving ? [opacity, time.timeS] : [opacity]
  })
  const dip = dipAlpha > 0 ? [dipAlpha] : []
  if (!settings.enabled) return [...photos, ...dip]
  const title = settings.title.enabled ? titleCardOpacityOf(time, settings.title) : 0
  const end = settings.end.enabled ? endCardOpacityOf(time, settings.end) : 0
  // the rolling credits move while the card is on
  const roll = end > 0 && creditLines(settings.end.credits).length > 0 ? [creditsRollProgress(time, settings.end.start, settings.end.window)] : []
  return [title, end, ...roll, ...texts.map((text) => filmTextOpacity(text, time.timeS)), ...photos, ...dip]
}

/** Part of a picture drawn over the frame (source rectangle of `drawImage`). */
export interface Crop {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * Part of a picture (`iw` × `ih`) shown over a whole frame (`fw` × `fh`) at `t` ∈ [0, 1] of its window: cropped to
 * cover the frame and, with the Ken Burns `move`, zoomed in or out between 1 and `KEN_BURNS_ZOOM` and panned
 * diagonally at constant speed, the direction picked from `seed` (each photo moves its own way, the same in every
 * frame); centred and still without it. Always inside the picture.
 */
export function kenBurnsCrop(iw: number, ih: number, fw: number, fh: number, t: number, seed: number, move: boolean): Crop {
  const cover = Math.max(fw / iw, fh / ih)
  const variant = ((Math.trunc(seed) % 8) + 8) % 8
  const e = move ? Math.min(1, Math.max(0, t)) : 0.5
  const zoom = move ? (variant % 2 === 0 ? 1 + (KEN_BURNS_ZOOM - 1) * e : KEN_BURNS_ZOOM - (KEN_BURNS_ZOOM - 1) * e) : 1
  const sw = Math.min(iw, fw / (cover * zoom))
  const sh = Math.min(ih, fh / (cover * zoom))
  // -1 .. 1 across the window, at most the slack on each side
  const f = 2 * e - 1
  const panX = (variant & 2 ? 1 : -1) * f * Math.min((iw - sw) / 2, KEN_BURNS_PAN * iw)
  const panY = (variant & 4 ? 1 : -1) * f * Math.min((ih - sh) / 2, KEN_BURNS_PAN * ih)
  return { sx: (iw - sw) / 2 + panX, sy: (ih - sh) / 2 + panY, sw, sh }
}

/** Small stable number from an id (the Ken Burns direction of a photo). */
function seedOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Seconds -> "1:05:09" (hours always shown, so the counter keeps its width). */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Recorded instant -> "12 juillet 2025" ("1er" for the first day) or "12 July 2025", browser time zone. */
export function formatLongDate(ms: number): string {
  const date = new Date(ms)
  const day = date.getDate()
  return t('overlay.draw.date', { day: day === 1 ? t('overlay.draw.firstDay') : day, month: formatDate(ms, { month: 'long' }), year: date.getFullYear() })
}

export interface CounterText {
  value: string
  unit: string
}

/** "12,4 km" -> { value: "12,4", unit: "km" } (the unit follows the last ordinary space). */
export function splitUnit(text: string): CounterText {
  const i = text.lastIndexOf(' ')
  return i < 0 ? { value: text, unit: '' } : { value: text.slice(0, i), unit: text.slice(i + 1) }
}

/** "≈ " before a time estimated from a planned departure, nothing before a recorded one. */
function estimatedMark(track: OverlayTrack): string {
  return track.stats.timesEstimated ? '≈ ' : ''
}

/** Text of a counter at this frame; null when the track does not record what it needs. */
export function counterText(id: CounterId, frame: OverlayFrame): CounterText | null {
  switch (id) {
    case 'distance':
      return splitUnit(formatDistance(frame.distanceM))
    case 'altitude':
      return frame.ele === undefined ? null : { value: formatNumber(frame.ele), unit: 'm' }
    case 'ascent':
      return frame.ascentM === undefined ? null : { value: formatNumber(frame.ascentM), unit: 'm' }
    case 'time':
      return frame.elapsedS === undefined ? null : { value: estimatedMark(frame.track) + formatElapsed(frame.elapsedS), unit: '' }
    case 'speed':
      return frame.speedKmh === undefined ? null : { value: formatNumber(frame.speedKmh, 1), unit: 'km/h' }
    case 'heartRate':
      return frame.heartRate === undefined ? null : { value: formatNumber(frame.heartRate), unit: 'bpm' }
    case 'slope':
      return frame.slopePct === undefined ? null : { value: formatNumber(frame.slopePct), unit: '%' }
    case 'clock':
      return frame.clockMs === undefined ? null : { value: estimatedMark(frame.track) + formatClock(frame.clockMs), unit: '' }
    case 'pace': {
      // stopped: the pace of a walker who does not move would be endless
      const pace = formatPace(frame.speedKmh)
      return frame.speedKmh === undefined ? null : { value: pace ?? '–', unit: 'min/km' }
    }
    case 'power':
      return frame.powerW === undefined ? null : { value: formatNumber(frame.powerW), unit: 'W' }
    case 'temperature':
      return frame.temperatureC === undefined ? null : { value: formatNumber(frame.temperatureC), unit: '°C' }
  }
}

/** Widest text a counter takes during the flyover, so its cell keeps one width (digits measured as "0"). */
function counterTemplate(id: CounterId, track: OverlayTrack): CounterText {
  const s = track.stats
  switch (id) {
    case 'distance':
      return splitUnit(formatDistance(Math.max(s.distanceM, 999)))
    case 'altitude':
      return { value: formatNumber(s.maxEleM ?? 0), unit: 'm' }
    case 'ascent':
      return { value: formatNumber(s.ascentM ?? 0), unit: 'm' }
    case 'time':
      return { value: estimatedMark(track) + formatElapsed(s.durationS ?? 0), unit: '' }
    case 'speed':
      return { value: formatNumber(Math.max(10, s.maxSpeedKmh ?? 0), 1), unit: 'km/h' }
    case 'heartRate':
      return { value: '000', unit: 'bpm' }
    case 'slope':
      return { value: '−00', unit: '%' }
    case 'clock':
      return { value: estimatedMark(track) + formatClock(Date.UTC(2000, 0, 1, 23, 59)), unit: '' }
    case 'pace':
      return { value: '00:00', unit: 'min/km' }
    case 'power':
      return { value: '0000', unit: 'W' }
    case 'temperature':
      return { value: '−00', unit: '°C' }
  }
}

export interface LayoutItem {
  anchor: OverlayAnchor
  width: number
  height: number
  /** free position in frame units, from the anchor's corner of the safe area towards the inside (right / down when centred) */
  offset?: WidgetOffset
}

/**
 * Top-left corner of each item inside the safe area. Items sharing an anchor are stacked vertically in
 * order, `gap` apart: from the top edge, the bottom edge or around the middle; aligned left, centred or right.
 * An item with an `offset` leaves the stack (the others close up as if it were not there): it sits alone at its
 * anchor, moved by the offset, and may overlap the others. `area` replaces the safe area (what a style's structure
 * leaves of the frame).
 */
export function layoutWidgets(items: readonly LayoutItem[], size: OverlaySize, gap: number, area?: Rect): { x: number; y: number }[] {
  const left = area ? area.x : size.width * SAFE_MARGIN
  const right = area ? area.x + area.w : size.width * (1 - SAFE_MARGIN)
  const top = area ? area.y : size.height * SAFE_MARGIN
  const bottom = area ? area.y + area.h : size.height * (1 - SAFE_MARGIN)
  const out = items.map(() => ({ x: 0, y: 0 }))
  const groups = new Map<OverlayAnchor, number[]>()
  items.forEach((item, i) => {
    if (!item.offset) groups.set(item.anchor, [...(groups.get(item.anchor) ?? []), i])
  })
  const place = (anchor: OverlayAnchor, indices: readonly number[], dx: number, dy: number) => {
    const [row, column] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-')
    const total = indices.reduce((sum, i) => sum + items[i].height, 0) + gap * (indices.length - 1)
    let y = row === 'top' ? top + dy : row === 'bottom' ? bottom - total - dy : (top + bottom) / 2 - total / 2 + dy
    for (const i of indices) {
      const w = items[i].width
      out[i].x = column === 'left' ? left + dx : column === 'right' ? right - w - dx : size.width / 2 - w / 2 + dx
      out[i].y = y
      y += items[i].height + gap
    }
  }
  for (const [anchor, indices] of groups) place(anchor, indices, 0, 0)
  items.forEach(({ anchor, offset }, i) => {
    if (offset) place(anchor, [i], offset.x, offset.y)
  })
  return out
}

/** Horizontal alignment of a widget's content from its anchor. */
function alignOf(anchor: OverlayAnchor): CanvasTextAlign {
  return anchor.endsWith('left') ? 'left' : anchor.endsWith('right') ? 'right' : 'center'
}

const rowOf = (anchor: OverlayAnchor) => (anchor === 'center' ? 'middle' : anchor.split('-')[0])

/**
 * Widest each timeline text may be: the whole safe width while it is alone in its row (top, middle, bottom),
 * a third of it (less the gaps) beside a text at another anchor of the row, so they never overlap; texts sharing
 * an anchor are stacked.
 */
export function filmTextMaxWidths(anchors: readonly OverlayAnchor[], safeWidth: number, gap: number): number[] {
  return anchors.map((anchor) => {
    const shared = anchors.some((other) => other !== anchor && rowOf(other) === rowOf(anchor))
    return shared ? (safeWidth - 2 * gap) / 3 : safeWidth
  })
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

export interface Painter {
  ctx: OverlayContext2D
  theme: OverlayTheme
  /** overlay unit (1 % of the shorter side) */
  u: number
  /** device pixels per user unit: shadow blur and offsets ignore the transform */
  px: number
  size: OverlaySize
}

export interface TextStyle {
  family: string
  weight: number
  sizePx: number
  color: string
  uppercase?: boolean
  /** em */
  tracking?: number
  italic?: boolean
}

function applyFont(p: Painter, style: TextStyle): void {
  p.ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${style.sizePx}px ${style.family}`
  // letterSpacing: Chrome 99+, Firefox 115+, Safari 18+; plain spacing elsewhere
  if ('letterSpacing' in p.ctx) p.ctx.letterSpacing = `${(style.tracking ?? 0) * style.sizePx}px`
}

const caseOf = (text: string, style: TextStyle) => (style.uppercase ? text.toLocaleUpperCase(getLanguage()) : text)

export function measure(p: Painter, text: string, style: TextStyle): number {
  applyFont(p, style)
  return p.ctx.measureText(caseOf(text, style)).width
}

/** Text with its alphabetic baseline at y. */
export function fillText(p: Painter, text: string, x: number, y: number, style: TextStyle, align: CanvasTextAlign = 'left'): void {
  const { ctx, theme } = p
  applyFont(p, style)
  ctx.fillStyle = style.color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  const backing = theme.panel ? undefined : theme.textBacking
  if (theme.textShadow && backing === 'outline') {
    // outline only: a dark rim round the glyphs, no shadow
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = Math.max(0.2 * p.u, style.sizePx * 0.12)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.strokeText(caseOf(text, style), x, y)
  } else if (theme.textShadow) {
    // shadow only: darker and wider than the soft shadow that accompanies the blurred backing
    const alone = backing === 'shadow'
    ctx.shadowColor = alone ? 'rgba(0, 0, 0, 0.85)' : theme.textShadow.color
    ctx.shadowBlur = theme.textShadow.blur * (alone ? 1.5 : 1) * p.u * p.px
    ctx.shadowOffsetY = 0.1 * p.u * p.px
  }
  ctx.fillText(caseOf(text, style), x, y)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

function roundedRect(ctx: OverlayContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Background of a widget: the style's panel (with an accent bar on the `align` side when the style has one),
 * or, for the styles without panel, a discreet blurred rounded rectangle that keeps light text readable on snow
 * (none when the user chose the shadow or the outline of the text instead, see `fillText`).
 */
function drawPanel(p: Painter, x: number, y: number, w: number, h: number, align: CanvasTextAlign = 'left'): void {
  const { ctx, theme, u } = p
  const panel = theme.panel
  if (!panel) {
    if ((theme.textBacking ?? DEFAULT_TEXT_BACKING) !== 'blur') return
    // the rectangle is drawn off the canvas and only its blurred shadow lands in place (`ctx.filter` is missing in Safari)
    const away = p.size.width + w + 10 * u
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 4 * u * p.px
    ctx.shadowOffsetX = away * p.px
    ctx.shadowOffsetY = 0
    ctx.fillStyle = '#000000'
    roundedRect(ctx, x - away - 1.4 * u, y - 1 * u, w + 2.8 * u, h + 2 * u, 2.2 * u)
    ctx.fill()
    ctx.restore()
    return
  }
  ctx.save()
  roundedRect(ctx, x, y, w, h, panel.radius * u)
  if (panel.shadow) {
    ctx.shadowColor = panel.shadow.color
    ctx.shadowBlur = panel.shadow.blur * u * p.px
    ctx.shadowOffsetY = panel.shadow.offsetY * u * p.px
  }
  ctx.fillStyle = panel.fill
  ctx.fill()
  ctx.shadowColor = 'transparent'
  if (panel.stroke) {
    ctx.strokeStyle = panel.stroke
    ctx.lineWidth = Math.max(0.1 * u, 1 / p.px)
    ctx.stroke()
  }
  if (theme.accentBar > 0) {
    ctx.clip()
    ctx.fillStyle = theme.accent
    const bar = theme.accentBar * u
    ctx.fillRect(align === 'right' ? x + w - bar : x, y, bar, h)
  }
  ctx.restore()
}

/** Words of `text` packed into lines no wider than `maxWidth` (a single long word overflows). */
export function wrapLines(p: Painter, text: string, maxWidth: number, style: TextStyle): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (!line || measure(p, candidate, style) <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** `text` cut with an ellipsis to fit `maxWidth`. */
export function truncate(p: Painter, text: string, maxWidth: number, style: TextStyle): string {
  if (measure(p, text, style) <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && measure(p, `${cut}…`, style) > maxWidth) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

export interface Widget extends LayoutItem {
  opacity: number
  draw(x: number, y: number): void
}

/** x of a line of text in a box, for an alignment. */
const alignX = (align: CanvasTextAlign, x: number, w: number) => (align === 'left' ? x : align === 'right' ? x + w : x + w / 2)

interface Cell {
  label: string
  value: string
  unit: string
  /** width reserved for value + unit */
  valueWidth: number
}

/** Shared layout of label-over-value cells (live counters, closing card statistics). */
function cellMetrics(p: Painter, scale: number) {
  const { theme, u } = p
  const label: TextStyle = {
    family: theme.bodyFamily,
    weight: theme.labelWeight,
    sizePx: 1.5 * u * scale,
    color: theme.textSoft,
    uppercase: theme.labelUppercase,
    tracking: theme.labelTracking,
  }
  const value: TextStyle = { family: theme.numberFamily, weight: theme.numberWeight, sizePx: 4.4 * u * scale, color: theme.text }
  const unit: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.9 * u * scale, color: theme.textSoft }
  const unitGap = 0.5 * u * scale
  // label caps, gap, value digits: alphabetic baselines from the top of the cell
  const labelBaseline = label.sizePx * 0.74
  const valueBaseline = labelBaseline + 1.2 * u * scale + value.sizePx * 0.74
  return { label, value, unit, unitGap, labelBaseline, valueBaseline, height: valueBaseline + 0.2 * u * scale }
}

function makeCell(p: Painter, m: ReturnType<typeof cellMetrics>, label: string, text: CounterText, template: CounterText): Cell {
  const digits = (s: string) => s.replace(/\d/g, '0')
  const valueWidth =
    Math.max(measure(p, digits(template.value), m.value), measure(p, digits(text.value), m.value)) +
    (text.unit ? m.unitGap + measure(p, text.unit, m.unit) : 0)
  return { label, value: text.value, unit: text.unit, valueWidth }
}

const cellWidth = (p: Painter, m: ReturnType<typeof cellMetrics>, cell: Cell) => Math.max(measure(p, cell.label, m.label), cell.valueWidth)

function drawCell(p: Painter, m: ReturnType<typeof cellMetrics>, cell: Cell, x: number, y: number, w: number, align: CanvasTextAlign): void {
  fillText(p, cell.label, alignX(align, x, w), y + m.labelBaseline, m.label, align)
  const valueW = measure(p, cell.value, m.value)
  const unitW = cell.unit ? m.unitGap + measure(p, cell.unit, m.unit) : 0
  const used = valueW + unitW
  // value + unit as one run, placed like the label
  const left = align === 'left' ? x : align === 'right' ? x + w - used : x + (w - used) / 2
  fillText(p, cell.value, left, y + m.valueBaseline, m.value, 'left')
  if (cell.unit) fillText(p, cell.unit, left + valueW + m.unitGap, y + m.valueBaseline, m.unit, 'left')
}

function countersWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number): Widget | null {
  const { counters } = settings
  const m = cellMetrics(p, counters.size)
  const cells: Cell[] = []
  for (const id of COUNTER_IDS) {
    if (!counters.fields[id]) continue
    const text = counterText(id, frame)
    if (text) cells.push(makeCell(p, m, COUNTER_LABELS[id], text, counterTemplate(id, frame.track)))
  }
  return cellsWidget(p, m, cells, counters.anchor, counters.size, opacity)
}

/** Weather under the marker: condition and temperature, wind speed and direction. */
function weatherWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number): Widget | null {
  const w = frame.weather
  if (!w) return null
  const { weather } = settings
  const m = cellMetrics(p, weather.size)
  const cells = [
    // the longest condition label sets the width: the panel does not jump when the sky changes
    makeCell(p, m, w.condition.label, { value: formatNumber(w.temperatureC), unit: '°C' }, { value: '-00', unit: '°C' }),
    makeCell(p, m, t('overlay.draw.wind', { dir: w.windFrom }).trim(), { value: formatNumber(w.windSpeedKmh), unit: 'km/h' }, { value: '000', unit: 'km/h' }),
  ]
  return cellsWidget(p, m, cells, weather.anchor, weather.size, opacity)
}

/** Row (or column, at the middle anchors) of label-over-value cells, in one panel or one panel each. */
function cellsWidget(
  p: Painter,
  m: ReturnType<typeof cellMetrics>,
  cells: Cell[],
  anchor: OverlayAnchor,
  s: number,
  opacity: number,
): Widget | null {
  const { theme, u, ctx } = p
  if (cells.length === 0) return null
  const vertical = anchor === 'middle-left' || anchor === 'middle-right'
  const align: CanvasTextAlign = vertical ? alignOf(anchor) : 'left'
  const grouped = theme.groupedCounters
  const padX = (theme.panel ? 2 : 0.5) * u * s
  const padY = (theme.panel ? 1.6 : 0.5) * u * s
  const gap = (grouped ? 3.2 : 1) * u * s
  const widths = cells.map((c) => cellWidth(p, m, c) + (grouped ? 0 : 2 * padX))
  const cellH = m.height + (grouped ? 0 : 2 * padY)
  const columnW = Math.max(...widths)
  const innerW = vertical ? columnW : widths.reduce((a, b) => a + b, 0) + gap * (cells.length - 1)
  const innerH = vertical ? cellH * cells.length + gap * (cells.length - 1) : cellH
  const extraX = grouped ? 2 * padX + (theme.accentBar ? theme.accentBar * u : 0) : 0
  const extraY = grouped ? 2 * padY : 0

  return {
    anchor,
    width: innerW + extraX,
    height: innerH + extraY,
    opacity,
    draw(x, y) {
      const barOffset = grouped && theme.accentBar && align !== 'right' ? theme.accentBar * u : 0
      if (grouped) drawPanel(p, x, y, innerW + extraX, innerH + extraY, align)
      let cx = x + (grouped ? padX + barOffset : 0)
      let cy = y + (grouped ? padY : 0)
      cells.forEach((cell, i) => {
        const w = vertical ? columnW : widths[i]
        if (!grouped) drawPanel(p, cx, cy, w, cellH)
        const inset = grouped ? 0 : padX
        drawCell(p, m, cell, cx + inset, cy + (grouped ? 0 : padY), w - 2 * inset, align)
        if (grouped && i < cells.length - 1) {
          // hairline separator in the middle of the gap
          ctx.save()
          ctx.fillStyle = theme.textSoft
          ctx.globalAlpha *= 0.35
          const t = Math.max(0.1 * u, 1 / p.px)
          if (vertical) ctx.fillRect(cx, cy + cellH + gap / 2 - t / 2, columnW, t)
          else ctx.fillRect(cx + w + gap / 2 - t / 2, cy, t, cellH)
          ctx.restore()
        }
        if (vertical) cy += cellH + gap
        else cx += w + gap
      })
    },
  }
}

function profileWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number, markerColor?: string): Widget | null {
  const profile = frame.track.profile
  if (!profile) return null
  const { theme, u, ctx, size } = p
  const { anchor, width, height } = settings.profile
  const w = width * size.width
  const h = height * size.height
  const pad = theme.panel ? 1.2 * u : 0
  return {
    anchor,
    width: w,
    height: h,
    opacity,
    draw(x, y) {
      drawPanel(p, x, y, w, h, alignOf(anchor))
      const barOffset = theme.panel && theme.accentBar && alignOf(anchor) !== 'right' ? theme.accentBar * u : 0
      const ix = x + pad + barOffset
      const iy = y + pad + 0.8 * u
      const iw = w - 2 * pad - (theme.accentBar && theme.panel ? theme.accentBar * u : 0)
      const ih = h - 2 * pad - 0.8 * u
      const { ele, minEle, maxEle } = profile
      const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
      const n = ele.length
      const xAt = (i: number) => ix + (i / (n - 1)) * iw
      const yAt = (e: number) => iy + ih * (1 - (e - minEle) / span)

      const area = () => {
        ctx.beginPath()
        let open = false
        for (let i = 0; i <= n; i++) {
          const known = i < n && !Number.isNaN(ele[i])
          if (known && !open) {
            ctx.moveTo(xAt(i), iy + ih)
            open = true
          }
          if (known) ctx.lineTo(xAt(i), yAt(ele[i]))
          else if (open) {
            ctx.lineTo(xAt(i - 1), iy + ih)
            ctx.closePath()
            open = false
          }
        }
      }
      ctx.save()
      area()
      ctx.fillStyle = theme.profile.area
      ctx.fill()
      const markerX = ix + frame.progress * iw
      ctx.save()
      ctx.beginPath()
      ctx.rect(ix, iy - u, markerX - ix, ih + 2 * u)
      ctx.clip()
      area()
      ctx.fillStyle = theme.profile.played
      ctx.fill()
      ctx.restore()
      // ridge line
      ctx.beginPath()
      let pen = false
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(ele[i])) {
          pen = false
          continue
        }
        if (pen) ctx.lineTo(xAt(i), yAt(ele[i]))
        else ctx.moveTo(xAt(i), yAt(ele[i]))
        pen = true
      }
      ctx.strokeStyle = theme.profile.line
      ctx.lineWidth = 0.22 * u
      ctx.lineJoin = 'round'
      ctx.stroke()
      // marker
      if (frame.ele !== undefined) {
        ctx.beginPath()
        ctx.arc(markerX, yAt(frame.ele), 0.9 * u, 0, Math.PI * 2)
        ctx.fillStyle = settings.profile.markerColor || markerColor || theme.profile.marker
        ctx.fill()
        ctx.lineWidth = 0.35 * u
        ctx.strokeStyle = theme.profile.markerRing
        ctx.stroke()
      }
      ctx.restore()
    },
  }
}

/** Plan view of the whole track: route ahead, covered part, start and end dots, marker, optional north arrow. */
export function minimapWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number, markerColor?: string): Widget | null {
  const { outline } = frame.track
  const point = frame.mapPoint
  if (!outline || !point) return null
  const { theme, u, ctx } = p
  const { anchor, size: s, northArrow } = settings.minimap
  // the box follows the shape of the track, within MINIMAP_MAX_RATIO
  const ratio = outline.height > 0 ? outline.width / outline.height : outline.width > 0 ? Infinity : 1
  const r = Math.min(MINIMAP_MAX_RATIO, Math.max(1 / MINIMAP_MAX_RATIO, ratio))
  const side = MINIMAP_SIDE_U * u * s
  const mapW = r >= 1 ? side : side * r
  const mapH = r >= 1 ? side / r : side
  const pad = (theme.panel ? 1.4 : 0.4) * u * s
  const bar = theme.panel ? theme.accentBar * u : 0
  const arrowW = northArrow ? 2.6 * u * s : 0
  const w = mapW + arrowW + 2 * pad + bar
  const h = mapH + 2 * pad
  // room for the marker inside the map box; aspect kept (same scale on both axes)
  const inset = 1.3 * u * s
  const scale = Math.min(
    outline.width > 0 ? (mapW - 2 * inset) / outline.width : Infinity,
    outline.height > 0 ? (mapH - 2 * inset) / outline.height : Infinity,
  )
  const k = Number.isFinite(scale) ? scale : 0

  return {
    anchor,
    width: w,
    height: h,
    opacity,
    draw(x, y) {
      const align = alignOf(anchor)
      drawPanel(p, x, y, w, h, align)
      const mx = x + pad + (align === 'right' ? 0 : bar)
      const my = y + pad
      const ox = mx + (mapW - outline.width * k) / 2
      const oy = my + (mapH - outline.height * k) / 2
      const px = (v: number) => ox + v * k
      const py = (v: number) => oy + v * k
      const n = outline.x.length

      ctx.save()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(px(outline.x[0]), py(outline.y[0]))
      for (let i = 1; i < n; i++) ctx.lineTo(px(outline.x[i]), py(outline.y[i]))
      ctx.strokeStyle = theme.minimap.route
      ctx.lineWidth = 0.35 * u * s
      ctx.stroke()
      // covered part: the kept points behind the marker, then the marker itself
      ctx.beginPath()
      ctx.moveTo(px(outline.x[0]), py(outline.y[0]))
      for (let i = 1; i < n && outline.dist[i] <= frame.distanceM; i++) ctx.lineTo(px(outline.x[i]), py(outline.y[i]))
      ctx.lineTo(px(point.x), py(point.y))
      ctx.strokeStyle = theme.minimap.covered
      ctx.lineWidth = 0.55 * u * s
      ctx.stroke()
      const dot = (cx: number, cy: number, radius: number, fill: string) => {
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.lineWidth = 0.3 * u * s
        ctx.strokeStyle = theme.profile.markerRing
        ctx.stroke()
      }
      dot(px(outline.x[n - 1]), py(outline.y[n - 1]), 0.6 * u * s, theme.minimap.end)
      dot(px(outline.x[0]), py(outline.y[0]), 0.6 * u * s, theme.minimap.start)
      dot(px(point.x), py(point.y), 0.9 * u * s, settings.minimap.markerColor || markerColor || theme.profile.marker)
      ctx.restore()

      if (northArrow) {
        // arrow pointing up over an "N", at the top of the column beside the map
        const cx = mx + mapW + arrowW / 2
        const top = my + 0.2 * u * s
        const arrowH = 1.6 * u * s
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(cx, top)
        ctx.lineTo(cx + 0.6 * u * s, top + arrowH)
        ctx.lineTo(cx, top + arrowH * 0.72)
        ctx.lineTo(cx - 0.6 * u * s, top + arrowH)
        ctx.closePath()
        ctx.fillStyle = theme.text
        ctx.fill()
        ctx.restore()
        const letter: TextStyle = { family: theme.bodyFamily, weight: theme.numberWeight, sizePx: 1.5 * u * s, color: theme.text }
        fillText(p, 'N', cx, top + arrowH + 0.5 * u * s + letter.sizePx * 0.74, letter, 'center')
      }
    },
  }
}

/** Narrowest track legend (u): the colour ramp stays readable. */
const TRACK_LEGEND_WIDTH_U = 22

/**
 * Legend of the track colouring: the quantity, its colour ramp over the shared range with the bounds and units
 * (the 2 % of extreme values on each side take the colour of the bounds), and the grey of the points without a value.
 */
function trackLegendWidget(p: Painter, legend: OverlayTrackLegend, opacity: number): Widget {
  const { theme, u, ctx } = p
  const { anchor, range } = legend
  const title: TextStyle = { family: theme.bodyFamily, weight: theme.numberWeight, sizePx: 1.8 * u, color: theme.text }
  const small: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.5 * u, color: theme.text }
  const pad = (theme.panel ? 1.4 : 0.4) * u
  const bar = theme.panel ? theme.accentBar * u : 0
  const format = (value: number) => `${formatNumber(value, legend.fractionDigits)} ${legend.unit}`
  const low = range ? format(range.min) : ''
  const high = range ? format(range.max) : ''
  const missing = legend.missing ? t(range ? 'track.legend.noValue' : 'track.legend.noData') : ''
  const swatchW = 2.4 * u
  const gap = 0.8 * u
  const innerW = Math.max(
    TRACK_LEGEND_WIDTH_U * u,
    measure(p, legend.label, title),
    range ? measure(p, low, small) + measure(p, high, small) + 2 * u : 0,
    missing ? swatchW + gap + measure(p, missing, small) : 0,
  )
  const titleH = title.sizePx
  const rampH = 1.2 * u
  const lineH = small.sizePx
  const innerH = titleH + (range ? gap + rampH + gap + lineH : 0) + (missing ? gap + lineH : 0)
  const w = innerW + 2 * pad + bar
  const h = innerH + 2 * pad

  return {
    anchor,
    width: w,
    height: h,
    opacity,
    draw(x, y) {
      const align = alignOf(anchor)
      drawPanel(p, x, y, w, h, align)
      const ix = x + pad + (align === 'right' ? 0 : bar)
      let cy = y + pad
      fillText(p, legend.label, ix, cy + titleH * 0.8, title)
      cy += titleH
      if (range) {
        cy += gap
        const ramp = ctx.createLinearGradient(ix, 0, ix + innerW, 0)
        legend.colormap.forEach((color, i) => ramp.addColorStop(i / Math.max(1, legend.colormap.length - 1), color))
        ctx.save()
        roundedRect(ctx, ix, cy, innerW, rampH, 0.3 * u)
        ctx.fillStyle = ramp
        ctx.fill()
        ctx.restore()
        cy += rampH + gap
        fillText(p, low, ix, cy + lineH * 0.8, small)
        fillText(p, high, ix + innerW, cy + lineH * 0.8, small, 'right')
        cy += lineH
      }
      if (missing) {
        cy += gap
        ctx.save()
        roundedRect(ctx, ix, cy + 0.2 * lineH, swatchW, 0.6 * lineH, 0.2 * u)
        ctx.fillStyle = MISSING_COLOR
        ctx.fill()
        ctx.lineWidth = Math.max(0.15 * u, 1 / p.px)
        ctx.strokeStyle = theme.text
        ctx.stroke()
        ctx.restore()
        fillText(p, missing, ix + swatchW + gap, cy + lineH * 0.8, small)
      }
    },
  }
}

const leaderboardTitle = () => t('overlay.draw.leaderboard')
/** Gap column wide enough for the usual gaps, so the panel keeps its width as they change. */
const LEADERBOARD_GAP_TEMPLATE = '+00 min 00'

/** Ghost race: « Classement » over one line per racer — rank, colour dot, name, gap to the first. */
function leaderboardWidget(p: Painter, rows: readonly LeaderboardRow[], settings: OverlaySettings, opacity: number): Widget | null {
  if (rows.length < 2) return null
  const { ctx, theme, u } = p
  const { anchor, size: s } = settings.leaderboard
  const heading: TextStyle = {
    family: theme.bodyFamily,
    weight: theme.labelWeight,
    sizePx: 1.5 * u * s,
    color: theme.textSoft,
    uppercase: theme.labelUppercase,
    tracking: theme.labelTracking,
  }
  const rank: TextStyle = { family: theme.numberFamily, weight: theme.numberWeight, sizePx: 2 * u * s, color: theme.text }
  const name: TextStyle = { family: theme.bodyFamily, weight: 500, sizePx: 2 * u * s, color: theme.text }
  const gap: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.7 * u * s, color: theme.textSoft }
  const names = rows.map((row) => truncate(p, row.name, 24 * u * s, name))
  const rankW = Math.max(...rows.map((row) => measure(p, String(row.rank), rank)))
  const nameW = Math.max(...names.map((n) => measure(p, n, name)))
  const gapW = Math.max(measure(p, LEADERBOARD_GAP_TEMPLATE, gap), ...rows.map((row) => measure(p, row.gap, gap)))
  const dot = 1.2 * u * s
  const colGap = 1.2 * u * s
  const lineH = 3.2 * u * s
  const headingH = heading.sizePx * 0.74 + 1.4 * u * s
  const innerW = Math.max(measure(p, leaderboardTitle(), heading), rankW + colGap + dot + colGap + nameW + 2 * colGap + gapW)
  const innerH = headingH + rows.length * lineH
  const pad = (theme.panel ? 1.6 : 0.5) * u * s
  const bar = theme.panel ? theme.accentBar * u : 0
  const align = alignOf(anchor)

  return {
    anchor,
    width: innerW + 2 * pad + bar,
    height: innerH + 2 * pad,
    opacity,
    draw(x, y) {
      drawPanel(p, x, y, innerW + 2 * pad + bar, innerH + 2 * pad, align)
      const ix = x + pad + (align === 'right' ? 0 : bar)
      fillText(p, leaderboardTitle(), ix, y + pad + heading.sizePx * 0.74, heading)
      rows.forEach((row, i) => {
        const middle = y + pad + headingH + (i + 0.5) * lineH
        // cap height centred on the row
        const baseline = middle + name.sizePx * 0.36
        fillText(p, String(row.rank), ix + rankW, baseline, rank, 'right')
        const dotX = ix + rankW + colGap + dot / 2
        ctx.beginPath()
        ctx.arc(dotX, middle, dot / 2, 0, Math.PI * 2)
        ctx.fillStyle = row.color
        ctx.fill()
        ctx.lineWidth = 0.2 * u * s
        ctx.strokeStyle = theme.profile.markerRing
        ctx.stroke()
        fillText(p, names[i], dotX + dot / 2 + colGap, baseline, name)
        fillText(p, row.gap, ix + innerW, baseline, gap, 'right')
      })
    },
  }
}

interface CardContent {
  title: string
  subtitle: string
  /** size of the title relative to the opening card */
  titleScale: number
  cells: Cell[]
  /** picture above the title (`CardExtras.image`) */
  image?: OverlayImage
  /** drawn side by side under the figures, without their own panel (profile, mini-map of the whole track) */
  below?: Widget[]
}

function cardWidget(
  p: Painter,
  content: CardContent,
  anchor: OverlayAnchor,
  scale: number,
  opacity: number,
  cellM?: ReturnType<typeof cellMetrics>,
): Widget {
  const { theme, u, size, ctx } = p
  const align = alignOf(anchor)
  const pad = theme.panel ? 3 * u * scale : 0
  const barW = theme.panel ? theme.accentBar * u : 0
  const maxW = Math.min(size.width * (1 - 2 * SAFE_MARGIN), size.width * 0.72) - 2 * pad - barW

  // title: wrapped on up to three lines, shrunk when longer
  const title: TextStyle = {
    family: theme.titleFamily,
    // a light face only holds at display size: the smaller closing title gets more weight
    weight: content.titleScale < 1 ? Math.max(theme.titleWeight, 500) : theme.titleWeight,
    sizePx: (theme.titleUppercase ? 5.6 : 6.6) * u * scale * content.titleScale,
    color: theme.text,
    uppercase: theme.titleUppercase,
    tracking: theme.titleTracking ?? (theme.titleUppercase ? 0.02 : -0.01),
  }
  let lines = content.title ? wrapLines(p, content.title, maxW, title) : []
  for (let i = 0; i < 4 && (lines.length > 3 || lines.some((l) => measure(p, l, title) > maxW)); i++) {
    title.sizePx *= 0.85
    lines = wrapLines(p, content.title, maxW, title)
  }
  const lineH = title.sizePx * 1.1
  const subtitle: TextStyle = {
    family: theme.bodyFamily,
    weight: theme.labelWeight,
    sizePx: 1.9 * u * scale,
    color: theme.textSoft,
    uppercase: theme.labelUppercase,
    tracking: theme.labelUppercase ? 0.18 : 0,
  }
  // one line each, `\n` between them (the date line and the free line of a card)
  const subs = content.subtitle.split('\n').filter(Boolean).map((line) => truncate(p, line, maxW, subtitle))
  const subLineH = subtitle.sizePx * 1.5
  const subH = subs.length ? (subs.length - 1) * subLineH + subtitle.sizePx * 0.78 : 0
  const ruleW = theme.panel ? 0 : 7 * u * scale
  const ruleGap = 2 * u * scale

  // statistics grid (closing card)
  const cellGap = 3.2 * u * scale
  const cellWs = cellM ? content.cells.map((c) => cellWidth(p, cellM, c)) : []
  const colW = cellWs.length ? Math.max(...cellWs) : 0
  const cols = Math.max(1, Math.min(content.cells.length, Math.floor((maxW + cellGap) / (colW + cellGap))))
  const rows = Math.ceil(content.cells.length / cols)
  const gridW = cols * colW + (cols - 1) * cellGap
  const gridH = cellM ? rows * cellM.height + (rows - 1) * 2 * u * scale : 0

  // picture above the title, as large as the logo at most
  const image = content.image && content.image.width > 0 && content.image.height > 0 ? content.image : undefined
  let imageH = image ? 9 * u * scale : 0
  let imageW = image ? (imageH * image.width) / image.height : 0
  if (imageW > Math.min(28 * u * scale, maxW)) {
    imageH *= Math.min(28 * u * scale, maxW) / imageW
    imageW = Math.min(28 * u * scale, maxW)
  }
  const below = content.below ?? []
  const belowW = below.reduce((sum, w) => sum + w.width, 0) + Math.max(0, below.length - 1) * cellGap
  const belowH = Math.max(0, ...below.map((w) => w.height))

  const titleW = Math.max(0, ...lines.map((l) => measure(p, l, title)))
  const subW = Math.max(0, ...subs.map((line) => measure(p, line, subtitle)))
  const innerW = Math.max(titleW, subW, gridW, ruleW, imageW, belowW)
  const titleH = lines.length ? (lines.length - 1) * lineH + title.sizePx * 0.78 : 0
  const parts = [imageH, titleH, subH, gridH, belowH].filter((h) => h > 0)
  const innerH = parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * (ruleW ? 2 * ruleGap : ruleGap * 1.4)

  return {
    anchor,
    width: innerW + 2 * pad + barW,
    height: innerH + 2 * pad,
    opacity,
    draw(x, y) {
      drawPanel(p, x, y, innerW + 2 * pad + barW, innerH + 2 * pad, align)
      const ix = x + pad + (align === 'right' ? 0 : barW)
      let cy = y + pad
      const between = ruleW ? 2 * ruleGap : ruleGap * 1.4
      const placeX = (w: number) => (align === 'left' ? ix : align === 'right' ? ix + innerW - w : ix + (innerW - w) / 2)
      if (image) {
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(image.image, placeX(imageW), cy, imageW, imageH)
        cy += imageH + between
      }
      lines.forEach((line, i) => fillText(p, line, alignX(align, ix, innerW), cy + title.sizePx * 0.78 + i * lineH, title, align))
      if (titleH) cy += titleH + between
      if (ruleW && titleH && (subH || cellM)) {
        // thin accent rule between the title and what follows
        ctx.fillStyle = theme.accent
        const t = 0.25 * u * scale
        ctx.fillRect(alignX(align, ix, innerW) - (align === 'center' ? ruleW / 2 : align === 'right' ? ruleW : 0), cy - between / 2 - t / 2, ruleW, t)
      }
      subs.forEach((line, i) => fillText(p, line, alignX(align, ix, innerW), cy + subtitle.sizePx * 0.78 + i * subLineH, subtitle, align))
      if (subH) cy += subH + between
      if (cellM) {
        const offset = align === 'left' ? 0 : align === 'right' ? innerW - gridW : (innerW - gridW) / 2
        content.cells.forEach((cell, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          // a short last row is centred like the card
          const rowCount = row === rows - 1 ? content.cells.length - row * cols : cols
          const rowShift = align === 'center' ? ((cols - rowCount) * (colW + cellGap)) / 2 : 0
          drawCell(p, cellM, cell, ix + offset + rowShift + col * (colW + cellGap), cy + row * (cellM.height + 2 * u * scale), colW, align)
        })
        if (gridH > 0) cy += gridH + between
      }
      let bx = placeX(belowW)
      for (const w of below) {
        w.draw(bx, cy + (belowH - w.height) / 2)
        bx += w.width + cellGap
      }
    },
  }
}

/** Text of the opening card: its title (the track's name by default) and the date and subtitle line. */
export function openingText(frame: OverlayFrame, settings: OverlaySettings): { title: string; subtitle: string } {
  const card = settings.title
  const start = frame.track.stats.startTime
  const date = card.showDate && start !== undefined ? formatLongDate(start) : ''
  return { title: card.title.trim() || frame.track.name, subtitle: [date, card.subtitle.trim()].filter(Boolean).join(' · ') }
}

function titleWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number, assets: OverlayAssets): Widget {
  const c = settings.title
  const text = openingText(frame, settings)
  const subtitle = [text.subtitle, c.line?.trim() ?? ''].filter(Boolean).join('\n')
  const figures = c.figures ?? []
  // without figures the card is laid out as it always was (no grid)
  const m = figures.length > 0 ? cellMetrics(p, c.size) : undefined
  const cells = m ? cardStats(frame.track.stats, figures).map(({ label, text }) => makeCell(p, m, label, text, text)) : []
  const image = c.image ? assets.cardImage?.(c.image) : undefined
  const below = cardGraphics(p, frame, settings, c, m ? figuresWidth(p, m, cells, c.size) : 0)
  return cardWidget(p, { title: text.title, subtitle, titleScale: 1, cells, image, below }, c.anchor, c.size, opacity, m)
}

/** Size of the text of a stage card the film words itself, relative to a timeline text: the title size of the automatic card. */
const STAGE_TEXT_SCALE = 1.65

/** What `{name} {n} {count} {date} {distance} {ascent}` stand for in the text of a stage card. */
function stageVariables(card: StageCard): Record<string, string> {
  return {
    name: card.name,
    n: String(card.index + 1),
    count: String(card.count),
    date: card.startTime !== undefined ? formatLongDate(card.startTime) : '',
    distance: formatDistance(card.distanceM),
    ascent: card.ascentM === undefined ? '' : `${formatNumber(card.ascentM)} m`,
  }
}

/**
 * Card of a stage « À la suite »: its name, « Étape 2 sur 3 · date », its distance and D+ (closing-card title size),
 * or the film's own text and subtitle with the stage's figures filled in.
 */
function stageWidget(p: Painter, card: StageCard, opacity: number, maxWidth: number): Widget | null {
  if (card.text !== undefined) {
    const vars = stageVariables(card)
    const item: FilmText = {
      id: '',
      startS: card.startS,
      durationS: card.durationS,
      text: fillTemplate(card.text, vars),
      subtitle: card.subtitle === undefined ? undefined : fillTemplate(card.subtitle, vars),
      anchor: card.anchor,
      size: card.size * STAGE_TEXT_SCALE,
      color: card.color,
      font: card.font,
    }
    return filmTextWidget(p, item, opacity, maxWidth)
  }
  const m = cellMetrics(p, card.size)
  const stats: [string, CounterText | null][] = [
    [t('overlay.draw.stat.distance'), splitUnit(formatDistance(card.distanceM))],
    [t('overlay.draw.stat.ascent'), card.ascentM === undefined ? null : { value: formatNumber(card.ascentM), unit: 'm' }],
  ]
  const cells = stats.flatMap(([label, text]) => (text ? [makeCell(p, m, label, text, text)] : []))
  const date = card.startTime !== undefined ? formatLongDate(card.startTime) : ''
  const subtitle = [t('overlay.draw.stageOf', { n: card.index + 1, count: card.count }), date].filter(Boolean).join(' · ')
  return cardWidget(p, { title: card.name, subtitle, titleScale: 0.6, cells }, card.anchor, card.size, opacity, m)
}

/**
 * Card of a day of a multi-day track: « Jour n » (or the film's title), under it the date and the weather of the day,
 * and the figures of the day the film chose (distance, climb, time, start) as cells.
 */
function dayWidget(p: Painter, card: DayCard, opacity: number): Widget {
  const { figures, fields } = card
  const date = figures.startTime !== undefined ? formatLongDate(figures.startTime) : ''
  const title = fillTemplate(card.title ?? t('film.defaultDay'), { n: String(figures.n), count: String(figures.count), date })
  const m = cellMetrics(p, card.size)
  const stats: [string, CounterText | null][] = [
    [t('overlay.draw.stat.distance'), fields.distance ? splitUnit(formatDistance(figures.distanceM)) : null],
    [t('overlay.draw.stat.ascent'), fields.ascent && figures.ascentM !== undefined ? { value: formatNumber(figures.ascentM), unit: 'm' } : null],
    [t('overlay.draw.stat.duration'), fields.duration && figures.durationS !== undefined ? { value: formatDuration(figures.durationS), unit: '' } : null],
    [t('overlay.draw.stat.start'), fields.start && figures.startTime !== undefined ? { value: formatClock(figures.startTime), unit: '' } : null],
  ]
  const cells = stats.flatMap(([label, text]) => (text ? [makeCell(p, m, label, text, text)] : []))
  const subtitle = [fields.date ? date : '', fields.weather ? weatherSummaryLine(figures.weather) : ''].filter(Boolean).join(' · ')
  return cardWidget(p, { title, subtitle, titleScale: 0.6, cells }, card.anchor, card.size, opacity, m)
}

/** Label of each figure a card can show. */
const CARD_FIGURE_KEYS: Record<CardFigure, MessageKey> = {
  distance: 'overlay.draw.stat.distance',
  ascent: 'overlay.draw.stat.ascent',
  descent: 'overlay.draw.stat.descent',
  maxAltitude: 'overlay.draw.stat.maxAltitude',
  minAltitude: 'overlay.draw.stat.minAltitude',
  time: 'overlay.draw.stat.duration',
  maxSpeed: 'overlay.draw.stat.maxSpeed',
  avgSpeed: 'overlay.draw.stat.avgSpeed',
  avgPace: 'overlay.draw.stat.avgPace',
  date: 'overlay.draw.stat.date',
}

/** Label of a figure on the cards (and of its chip in the inspector). */
export const cardFigureLabel = (id: CardFigure): string => t(CARD_FIGURE_KEYS[id])

/** The `figures` of a card the track records, in the order of CARD_FIGURES: label and text. */
export function cardStats(s: OverlayTrack['stats'], figures: readonly CardFigure[]): { label: string; text: CounterText }[] {
  const metres = (m: number | undefined): CounterText | null => (m === undefined ? null : { value: formatNumber(m), unit: 'm' })
  const timed = s.durationS !== undefined && s.durationS > 0 ? s.durationS : undefined
  const texts: Record<CardFigure, CounterText | null> = {
    distance: splitUnit(formatDistance(s.distanceM)),
    ascent: metres(s.ascentM),
    descent: metres(s.descentM),
    maxAltitude: metres(s.maxEleM),
    minAltitude: metres(s.minEleM),
    time: timed === undefined ? null : { value: formatDuration(timed), unit: '' },
    maxSpeed: s.maxSpeedKmh === undefined ? null : { value: formatNumber(s.maxSpeedKmh, 1), unit: 'km/h' },
    avgSpeed: timed === undefined || s.distanceM <= 0 ? null : { value: formatNumber((s.distanceM / timed) * 3.6, 1), unit: 'km/h' },
    avgPace: timed === undefined || s.distanceM <= 0 ? null : paceText((s.distanceM / timed) * 3.6),
    date: s.startTime === undefined ? null : { value: formatDate(s.startTime, { day: '2-digit', month: '2-digit', year: 'numeric' }), unit: '' },
  }
  return CARD_FIGURES.flatMap((id) => {
    const text = texts[id]
    return figures.includes(id) && text ? [{ label: cardFigureLabel(id), text }] : []
  })
}

/** A pace as a figure, null when too slow to mean anything. */
function paceText(kmh: number): CounterText | null {
  const pace = formatPace(kmh)
  return pace === null ? null : { value: pace, unit: 'min/km' }
}

/** Figures of a card: those chosen in its inspector; until then none on the opening card, the usual five on the closing one. */
export const cardFigures = (card: 'title' | 'end', c: CardExtras): readonly CardFigure[] => c.figures ?? (card === 'end' ? END_CARD_FIGURES : [])

/** The line under the title of the closing card: the user's own and the weather of the outing, when chosen. */
export function endLine(e: EndCardSettings, weather: WeatherSummary | undefined): string {
  return [e.line?.trim() ?? '', e.showWeather ? weatherSummaryLine(weather) : ''].filter(Boolean).join(' · ')
}

/** A card with a picture, the profile or the mini-map: drawn as a card, out of a style's structure. */
export const cardHasGraphics = (c: CardExtras): boolean => Boolean(c.image) || Boolean(c.showProfile) || Boolean(c.showMinimap)

/** Width the profile and mini-map of a card take: that of its figures in one row, within the card. */
function figuresWidth(p: Painter, m: ReturnType<typeof cellMetrics>, cells: readonly Cell[], size: number): number {
  const w = cells.reduce((sum, c) => sum + cellWidth(p, m, c), 0) + Math.max(0, cells.length - 1) * 3.2 * p.u * size
  return Math.min(w, p.size.width * 0.72, p.size.width * (1 - 2 * SAFE_MARGIN))
}

/** Profile and mini-map of the whole track inside a card: no panel of their own, the whole route covered, no marker. */
function cardGraphics(p: Painter, frame: OverlayFrame, settings: OverlaySettings, card: CardExtras & { size: number }, width: number): Widget[] {
  const bare: Painter = { ...p, theme: { ...p.theme, panel: null, textBacking: 'shadow' } }
  const { outline } = frame.track
  const last = outline && outline.x.length > 0 ? { x: outline.x[outline.x.length - 1], y: outline.y[outline.y.length - 1] } : undefined
  const whole: OverlayFrame = { ...frame, progress: 1, ele: undefined, distanceM: Number.POSITIVE_INFINITY, mapPoint: last }
  const out: Widget[] = []
  const map = card.showMinimap ? minimapWidget(bare, whole, { ...settings, minimap: { ...settings.minimap, size: card.size * 0.8, northArrow: false } }, 1) : null
  if (map) out.push(map)
  if (card.showProfile) {
    const w = Math.max(width - (map ? map.width + 3.2 * p.u * card.size : 0), 24 * p.u * card.size)
    const h = map ? map.height : 9 * p.u * card.size
    const profile = profileWidget(bare, whole, { ...settings, profile: { ...settings.profile, width: w / p.size.width, height: h / p.size.height } }, 1)
    if (profile) out.unshift(profile)
  }
  return out
}

function endWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number, assets: OverlayAssets): Widget {
  const e = settings.end
  const s = frame.track.stats
  const m = cellMetrics(p, e.size)
  const cells = cardStats(s, cardFigures('end', e)).map(({ label, text }) => makeCell(p, m, label, text, text))
  const image = e.image ? assets.cardImage?.(e.image) : undefined
  const below = cardGraphics(p, frame, settings, e, figuresWidth(p, m, cells, e.size))
  const subtitle = [e.line?.trim() ?? '', e.showWeather ? weatherSummaryLine(s.weather) : ''].filter(Boolean).join('\n')
  return cardWidget(p, { title: e.title.trim() || frame.track.name, subtitle, titleScale: 0.6, cells, image, below }, e.anchor, e.size, opacity, m)
}

/**
 * The closing card and the credits under it, centred, rolling up from the card's place in the middle of the frame
 * (`progress` 0) until the last line has left the top (`progress` 1).
 */
function drawCreditsRoll(p: Painter, card: Widget, lines: readonly string[], size: number, progress: number): void {
  const { ctx, theme, u } = p
  const style: TextStyle = { family: theme.bodyFamily, weight: 500, sizePx: 2.2 * u * size, color: theme.text }
  // readable over the relief without a panel
  const shadowed = { ...p, theme: { ...theme, textShadow: theme.textShadow ?? { color: 'rgba(0, 0, 0, 0.6)', blur: 0.5 } } }
  const lineH = style.sizePx * 1.5
  const gap = 3 * u * size
  const height = card.height + gap + lines.length * lineH
  const from = (p.size.height - card.height) / 2
  const top = from + (-height - from) * progress
  ctx.save()
  ctx.globalAlpha = card.opacity
  card.draw((p.size.width - card.width) / 2, top)
  lines.forEach((line, i) => fillText(shadowed, line, p.size.width / 2, top + card.height + gap + i * lineH + style.sizePx * 0.8, style, 'center'))
  ctx.restore()
}

/** "Ciel dégagé · 8 à 17 °C · vent jusqu'à 25 km/h"; '' without weather. */
export function weatherSummaryLine(summary: WeatherSummary | undefined): string {
  if (!summary) return ''
  const min = Math.round(summary.minTemperatureC)
  const max = Math.round(summary.maxTemperatureC)
  const temperature = min === max ? `${formatNumber(min)} °C` : t('overlay.draw.temperatureRange', { min: formatNumber(min), max: formatNumber(max) })
  return t('overlay.draw.weatherLine', { condition: summary.dominant.label, temperature, wind: formatNumber(summary.maxWindKmh) })
}

/** Source credit of the weather, small along the bottom edge (required by the Open-Meteo licence). */
function drawWeatherCredit(p: Painter): void {
  const { u, size } = p
  const style: TextStyle = { family: p.theme.bodyFamily, weight: 500, sizePx: 1.2 * u, color: '#FFFFFF' }
  const shadowed = { ...p, theme: { ...p.theme, textShadow: { color: 'rgba(0, 0, 0, 0.8)', blur: 0.5 } } }
  p.ctx.save()
  p.ctx.globalAlpha = 0.85
  fillText(shadowed, openMeteoAttribution(), size.width * (1 - SAFE_MARGIN), size.height - 1.4 * u, style, 'right')
  p.ctx.restore()
}

/**
 * Credits of the sources, small in a corner along the edge (outside the safe area), on a subtle backing of the
 * style that keeps them legible on snow as on forest; wrapped over the safe width (or `area`) when long.
 */
function drawCredits(p: Painter, credits: readonly string[], position: CreditsPosition, area?: Rect): void {
  const { ctx, theme, u, size } = p
  const style: TextStyle = { family: theme.bodyFamily, weight: 500, sizePx: 1.2 * u, color: theme.credits.text }
  const plain = { ...p, theme: { ...theme, textShadow: undefined } }
  const padX = 0.6 * u
  const padY = 0.3 * u
  const lineH = style.sizePx * 1.3
  const left = area ? area.x : size.width * SAFE_MARGIN
  const edgeRight = area ? area.x + area.w : size.width * (1 - SAFE_MARGIN)
  const lines = wrapLines(plain, credits.join(' · '), edgeRight - left - 2 * padX, style)
  const w = Math.max(...lines.map((line) => measure(plain, line, style))) + 2 * padX
  const h = lines.length * lineH + 2 * padY
  const right = position.endsWith('right')
  const x = right ? edgeRight - w : left
  const edge = 0.8 * u
  const y = position.startsWith('bottom') ? size.height - edge - h : edge
  ctx.save()
  roundedRect(ctx, x, y, w, h, 0.4 * u)
  ctx.fillStyle = theme.credits.fill
  ctx.fill()
  lines.forEach((line, i) => {
    // cap height centred in the line box
    const baseline = y + padY + i * lineH + (lineH + 0.72 * style.sizePx) / 2
    fillText(plain, line, right ? x + w - padX : x + padX, baseline, style, right ? 'right' : 'left')
  })
  ctx.restore()
}

function textWidget(p: Painter, settings: OverlaySettings): Widget | null {
  const { text } = settings
  const content = text.text.trim()
  if (!content) return null
  const { theme, u } = p
  const style: TextStyle = { family: theme.bodyFamily, weight: 500, sizePx: 2.4 * u * text.size, color: theme.text }
  const pad = theme.panel ? 1.4 * u * text.size : 0
  const maxW = p.size.width * (1 - 2 * SAFE_MARGIN) - 2 * pad
  const line = truncate(p, content, maxW, style)
  const w = measure(p, line, style)
  const align = alignOf(text.anchor)
  return {
    anchor: text.anchor,
    width: w + 2 * pad,
    height: style.sizePx * 0.95 + 2 * pad,
    opacity: 1,
    draw(x, y) {
      drawPanel(p, x, y, w + 2 * pad, style.sizePx * 0.95 + 2 * pad, align)
      fillText(p, line, x + pad, y + pad + style.sizePx * 0.75, style, 'left')
    },
  }
}

/** A text of the timeline, styled like the free text (up to two lines), its subtitle below in the label style. */
function filmTextWidget(p: Painter, item: FilmText, opacity: number, maxWidth: number): Widget | null {
  const content = item.text.trim()
  const subtitleText = item.subtitle?.trim() ?? ''
  if (!content && !subtitleText) return null
  const { theme, u } = p
  const s = item.size
  // its own colour and font, else the overlay's
  const family = item.font ? OVERLAY_FONT_FAMILIES[item.font] : theme.bodyFamily
  const main: TextStyle = { family, weight: 500, sizePx: 2.4 * u * s, color: item.color ?? theme.text }
  const subtitle: TextStyle = {
    family,
    weight: theme.labelWeight,
    sizePx: 1.6 * u * s,
    color: item.color ? softTextOf(item.color) : theme.textSoft,
    uppercase: theme.labelUppercase,
    tracking: theme.labelUppercase ? 0.12 : 0,
  }
  const pad = theme.panel ? 1.4 * u * s : 0
  const maxW = maxWidth - 2 * pad
  let lines = content ? wrapLines(p, content, maxW, main) : []
  if (lines.length > 2) lines = [lines[0], lines.slice(1).join(' ')]
  // the second line, or a single overlong word, cut with an ellipsis
  lines = lines.map((line) => truncate(p, line, maxW, main))
  const sub = subtitleText ? truncate(p, subtitleText, maxW, subtitle) : ''
  const lineH = main.sizePx * 1.2
  const gap = 0.8 * u * s
  const mainH = lines.length ? (lines.length - 1) * lineH + main.sizePx * 0.95 : 0
  const innerH = mainH + (sub ? (mainH ? gap : 0) + subtitle.sizePx * 0.95 : 0)
  const innerW = Math.max(0, ...lines.map((line) => measure(p, line, main)), sub ? measure(p, sub, subtitle) : 0)
  const align = alignOf(item.anchor)
  return {
    anchor: item.anchor,
    width: innerW + 2 * pad,
    height: innerH + 2 * pad,
    opacity,
    draw(x, y) {
      drawPanel(p, x, y, innerW + 2 * pad, innerH + 2 * pad, align)
      const tx = alignX(align, x + pad, innerW)
      lines.forEach((line, i) => fillText(p, line, tx, y + pad + main.sizePx * 0.75 + i * lineH, main, align))
      if (sub) fillText(p, sub, tx, y + pad + mainH + (mainH ? gap : 0) + subtitle.sizePx * 0.75, subtitle, align)
    },
  }
}

/** A full-screen photo (with its Ken Burns move) or video clip of the timeline, under everything else. */
function drawFullPhoto(p: Painter, item: FilmMedia, image: OverlayImage, opacity: number, timeS: number): void {
  const { ctx, size } = p
  if (image.width <= 0 || image.height <= 0) return
  const t = (timeS - item.startS) / item.durationS
  const c = kenBurnsCrop(image.width, image.height, size.width, size.height, t, seedOf(item.id), item.kind === 'image' && item.kenBurns)
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.image, c.sx, c.sy, c.sw, c.sh, 0, 0, size.width, size.height)
  ctx.restore()
}

/** A photo card of the timeline: the picture in the frame of the style, its caption below on one line. */
function photoCardWidget(p: Painter, item: FilmMedia, image: OverlayImage, opacity: number): Widget | null {
  if (image.width <= 0 || image.height <= 0) return null
  const { ctx, theme, u, size } = p
  const frame = theme.photo
  const s = item.size
  const pad = frame.pad * u * s
  const caption: TextStyle = { family: theme.bodyFamily, weight: 500, sizePx: 1.6 * u * s, color: frame.caption }
  const plain = { ...p, theme: { ...theme, textShadow: undefined } }
  const text = item.caption?.trim() ?? ''
  const gap = 0.7 * u * s
  const captionH = text ? gap + caption.sizePx * 0.95 : 0
  let h = 26 * u * s
  let w = (h * image.width) / image.height
  const maxW = Math.min(40 * u * s, size.width * (1 - 2 * SAFE_MARGIN) - 2 * pad)
  const maxH = size.height * (1 - 2 * SAFE_MARGIN) - 2 * pad - captionH
  const fit = Math.min(1, maxW / w, maxH / h)
  w *= fit
  h *= fit
  const line = text ? truncate(plain, text, w, caption) : ''
  const width = w + 2 * pad
  const height = h + 2 * pad + captionH
  const align = alignOf(item.anchor)
  return {
    anchor: item.anchor,
    width,
    height,
    opacity,
    draw(x, y) {
      ctx.save()
      roundedRect(ctx, x, y, width, height, frame.radius * u)
      if (frame.shadow) {
        ctx.shadowColor = frame.shadow.color
        ctx.shadowBlur = frame.shadow.blur * u * p.px
        ctx.shadowOffsetY = frame.shadow.offsetY * u * p.px
      }
      ctx.fillStyle = frame.mat
      ctx.fill()
      ctx.shadowColor = 'transparent'
      if (frame.stroke) {
        ctx.strokeStyle = frame.stroke
        ctx.lineWidth = Math.max(0.1 * u, 1 / p.px)
        ctx.stroke()
      }
      if (theme.accentBar > 0) {
        ctx.clip()
        ctx.fillStyle = theme.accent
        const bar = theme.accentBar * u
        ctx.fillRect(align === 'right' ? x + width - bar : x, y, bar, height)
      }
      ctx.restore()
      ctx.save()
      roundedRect(ctx, x + pad, y + pad, w, h, frame.imageRadius * u)
      ctx.clip()
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image.image, x + pad, y + pad, w, h)
      ctx.restore()
      if (line) fillText(plain, line, alignX(align, x + pad, w), y + pad + h + gap + caption.sizePx * 0.75, caption, align)
    },
  }
}

/** Full-frame layer of a dip to black or white. */
function drawDip({ ctx, size }: Painter, dip: TransitionDip): void {
  ctx.save()
  ctx.globalAlpha = dip.alpha
  ctx.fillStyle = dip.color
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.restore()
}

function logoWidget(p: Painter, settings: OverlaySettings, assets: OverlayAssets): Widget | null {
  const logo = assets.logo
  if (!logo || !settings.logo.image || logo.width <= 0 || logo.height <= 0) return null
  const { u, ctx } = p
  const s = settings.logo.size
  let h = 9 * u * s
  let w = (h * logo.width) / logo.height
  const maxW = 28 * u * s
  if (w > maxW) {
    h *= maxW / w
    w = maxW
  }
  return {
    anchor: settings.logo.anchor,
    width: w,
    height: h,
    opacity: settings.logo.opacity,
    draw(x, y) {
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(logo.image, x, y, w, h)
    },
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Draw the overlay of one frame. The context's current transform maps `size` (user units) onto the canvas;
 * the caller clears the canvas first (the overlay only adds). Synchronous and deterministic: the same
 * arguments always give the same image. The source credits, the photos of the timeline, the legend of the track
 * colouring and the dip of a shot transition are drawn even while the rest of the overlay is off. The dip covers everything but the credits: it is a
 * transition of the whole picture (widgets left over a black frame would float), short, and the credits the
 * licences require stay legible on top.
 */
export function drawOverlay(
  ctx: OverlayContext2D,
  frame: OverlayFrame,
  settings: OverlaySettings,
  size: OverlaySize,
  assets: OverlayAssets = {},
  extras: OverlayExtras = {},
): void {
  if (size.width <= 0 || size.height <= 0) return
  const credits = settings.credits.enabled ? [...(extras.credits ?? [])] : []
  const time = extras.time ?? progressTime(frame.progress)
  // photos and clips inside their window whose picture or frame is loaded (a clip following the flight: its frame
  // recorded under the marker)
  const recordedMs = extras.media?.some((m) => m.sync?.follow) ? recordedAtProgress(frame.track.path, frame.progress) : undefined
  const photos = (extras.media ?? []).flatMap((item) => {
    const opacity = filmTextOpacity(item, time.timeS)
    const visible = opacity > 0.001
    const image = !visible
      ? undefined
      : item.kind === 'video'
        ? assets.video?.(item, clipTimeS(item, time.timeS, recordedMs))
        : assets.photo?.(item.src)
    return image ? [{ item, opacity, image }] : []
  })
  const dip = extras.dip && extras.dip.alpha > 0.001 ? extras.dip : null
  // the first stage's card gives way to the title card of the film
  const stage = extras.stage && !(extras.stage.index === 0 && settings.enabled && settings.title.enabled) ? extras.stage : null
  const stageOpacity = stage ? filmTextOpacity(stage, time.timeS) : 0
  const day = extras.day ?? null
  const dayOpacity = day ? filmTextOpacity(day, time.timeS) : 0
  const legend = extras.trackLegend ?? null
  if (!settings.enabled && credits.length === 0 && photos.length === 0 && !dip && stageOpacity <= 0.001 && dayOpacity <= 0.001 && !legend) return
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const p: Painter = {
    ctx,
    theme: resolveOverlayTheme(settings.style, settings.overrides),
    u: Math.min(size.width, size.height) / 100,
    px: transform ? Math.hypot(transform.a, transform.b) || 1 : 1,
    size,
  }

  ctx.save()
  // full-screen photos under everything else
  let cover = 0
  for (const { item, opacity, image } of photos) {
    if (item.layout !== 'plein-ecran') continue
    drawFullPhoto(p, item, image, opacity, time.timeS)
    cover = Math.max(cover, opacity)
  }

  const widgets: Widget[] = []
  const add = (w: Widget | null) => {
    if (w && w.opacity > 0.001) widgets.push(w)
  }
  const texts: { item: FilmText; opacity: number }[] = []
  let roll: (() => void) | null = null
  let weather: Widget | null = null
  let weatherShown = false
  let endOpacity = 0
  let structure: Structure | null = null
  // live widgets give way to the full-screen photos and the stage cards (and, with the overlay on, to its cards)
  let live = 1 - Math.max(cover, stageOpacity)
  if (settings.enabled) {
    const titleOpacity = settings.title.enabled ? titleCardOpacityOf(time, settings.title) : 0
    endOpacity = settings.end.enabled ? endCardOpacityOf(time, settings.end) : 0
    const rolling = creditLines(settings.end.credits).length > 0
    // a widget in a slot of the style's structure is drawn by the structure, the others as ordinary widgets
    // a card with more than a style's structure shows is drawn as a card: credits, graphics, the opening's figures or line
    const ownCard = (key: LaidOutWidget) =>
      key === 'end'
        ? rolling || cardHasGraphics(settings.end)
        : key === 'title' && (cardHasGraphics(settings.title) || cardFigures('title', settings.title).length > 0 || Boolean(settings.title.line?.trim()))
    const slot = (key: LaidOutWidget) => inStyleSlot(settings, key) && !ownCard(key)
    // an opening card that is part of the structure, a header or a stripe, leaves them as they are
    live = 1 - Math.max(slot('title') ? 0 : titleOpacity, endOpacity, cover, stageOpacity)

    // a widget with its own colours or fonts draws with its own theme
    const of = (key: StyledWidget): Painter =>
      settings[key].overrides ? { ...p, theme: resolveOverlayTheme(settings.style, widgetOverrides(settings, key)) } : p
    // a widget at a free position: its offset in pixels of the exported film, scaled to this frame
    const exported = extras.exportSize
    const scale = exported && exported.width > 0 && exported.height > 0 ? Math.min(size.width, size.height) / Math.min(exported.width, exported.height) : 1
    const placed = (key: PlacedWidget, w: Widget | null): Widget | null => {
      const offset = settings[key].offset
      return w && offset ? { ...w, offset: { x: offset.x * scale, y: offset.y * scale } } : w
    }
    structure = styleStructure({ p, of, frame, settings, slot, live, titleOpacity, endOpacity, markerColor: extras.markerColor })
    if (titleOpacity > 0 && !slot('title')) add(placed('title', titleWidget(of('title'), frame, settings, titleOpacity, assets)))
    if (endOpacity > 0 && !slot('end')) {
      const card = endWidget(of('end'), frame, settings, endOpacity, assets)
      const credits = creditLines(settings.end.credits)
      // with credits, the card heads a roll drawn over the other widgets instead of being laid out with them
      if (credits.length === 0) add(placed('end', card))
      else roll = () => drawCreditsRoll(of('end'), card, credits, settings.end.size, creditsRollProgress(time, settings.end.start, settings.end.window))
    }
    if (settings.counters.enabled && live > 0 && !slot('counters')) add(placed('counters', countersWidget(of('counters'), frame, settings, live)))
    if (settings.profile.enabled && live > 0 && !slot('profile')) add(placed('profile', profileWidget(of('profile'), frame, settings, live, extras.markerColor)))
    weather = settings.weather.enabled && live > 0 && !slot('weather') ? placed('weather', weatherWidget(of('weather'), frame, settings, live)) : null
    add(weather)
    weatherShown = (weather !== null && weather.opacity > 0.001) || (slot('weather') && settings.weather.enabled && frame.weather !== undefined && live > 0.001)
    if (settings.minimap.enabled && live > 0 && !slot('minimap')) add(placed('minimap', minimapWidget(of('minimap'), frame, settings, live, extras.markerColor)))
    if (settings.leaderboard.enabled && live > 0) add(placed('leaderboard', leaderboardWidget(of('leaderboard'), extras.leaderboard ?? [], settings, live)))
    if (settings.text.enabled) add(placed('text', textWidget(of('text'), settings)))
    if (settings.logo.enabled) add(placed('logo', logoWidget(p, settings, assets)))
    // texts of the timeline inside their window
    for (const item of extras.texts ?? []) {
      const opacity = filmTextOpacity(item, time.timeS)
      if (opacity > 0.001) texts.push({ item, opacity })
    }
  }
  // the legend of the track colouring follows the colouring, overlay on or off
  if (legend && live > 0) add(trackLegendWidget(p, legend, live))
  // photo cards after the widgets of their anchor; the caption of a full-screen photo is drawn like a text
  for (const { item, opacity, image } of photos) {
    const caption = item.caption?.trim()
    if (item.layout === 'carte') add(photoCardWidget(p, item, image, opacity))
    else if (caption) texts.push({ item: { ...item, text: caption }, opacity })
  }
  // texts after the widgets of their anchor
  const maxWidths = filmTextMaxWidths(
    texts.map(({ item }) => item.anchor),
    structure ? structure.area.w : size.width * (1 - 2 * SAFE_MARGIN),
    2 * p.u,
  )
  texts.forEach(({ item, opacity }, i) => add(filmTextWidget(p, item, opacity, maxWidths[i])))

  const positions = layoutWidgets(widgets, size, 2 * p.u, structure?.area)
  // the structure of the style (bars, sheet, band and what sits in them) under the other widgets
  structure?.draw()
  widgets.forEach((widget, i) => {
    ctx.save()
    ctx.globalAlpha = widget.opacity
    widget.draw(positions[i].x, positions[i].y)
    ctx.restore()
  })
  roll?.()
  if (dip) drawDip(p, dip)
  // the card of a stage over the dip, which it lives in: laid out on its own
  if (stage && stageOpacity > 0.001) {
    const card = stageWidget(p, stage, stageOpacity, filmTextMaxWidths([stage.anchor], structure ? structure.area.w : size.width * (1 - 2 * SAFE_MARGIN), 2 * p.u)[0])
    if (card && card.opacity > 0.001) {
      const [at] = layoutWidgets([card], size, 2 * p.u, structure?.area)
      ctx.save()
      ctx.globalAlpha = card.opacity
      card.draw(at.x, at.y)
      ctx.restore()
    }
  }
  // the card of a day, laid out on its own like a stage's
  if (day && dayOpacity > 0.001) {
    const card = dayWidget(p, day, dayOpacity)
    const [at] = layoutWidgets([card], size, 2 * p.u, structure?.area)
    ctx.save()
    ctx.globalAlpha = card.opacity
    card.draw(at.x, at.y)
    ctx.restore()
  }
  if (weatherShown || (endOpacity > 0 && settings.end.showWeather && frame.track.stats.weather)) {
    // required by the Open-Meteo licence: with the other credits when they are drawn, else on its own
    if (!settings.credits.enabled) drawWeatherCredit(p)
    else if (!credits.includes(openMeteoAttribution())) credits.push(openMeteoAttribution())
  }
  if (credits.length > 0) drawCredits(p, credits, settings.credits.position, structure?.area)
  ctx.restore()
}
