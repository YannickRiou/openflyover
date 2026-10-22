/**
 * « Film automatique »: three gabarits (templates) that set, in one go, what makes a film look finished: its length, the
 * camera, the pacing, the overlay style, the opening title and the closing card with their figures, the day or stage
 * cards and the format of the export. A gabarit only fills the settings that already exist (`autoFilmSettings`); what
 * the user wrote (titles, lines, credits, pictures) and the stops placed by hand are never touched. No music.
 * Pure module (no DOM, React or store): ARCHITECTURE.md "Automatic film".
 */
import { clamp } from '../core/math'
import { withPlatformPreset } from '../export/schedule'
import type { PlatformPresetId } from '../export/schedule'
import { CAMERA_PRESETS } from '../flyover/cameraSettings'
import { END_START_MAX, END_START_MIN, TITLE_END_MAX, TITLE_END_MIN, withStyleLayout } from '../overlay/settings'
import type { CardFigure, OverlayStyleId } from '../overlay/settings'
import type { Settings } from '../state/store'
import { t } from '../i18n'
import { withDefaultCard } from './junctions'
import { DEFAULT_DAY_CARDS } from './model'
import type { Film } from './model'

export const AUTO_FILM_IDS = ['reel', 'resume', 'souvenir'] as const
export type AutoFilmId = (typeof AUTO_FILM_IDS)[number]

export interface AutoFilmTemplate {
  /** the whole film, seconds: the opening shot, the flight and the closing shot (nights and stage transitions come on top) */
  totalS: number
  openingS: number
  closingS: number
  /** the one-click format of « Vidéo » › « Format » */
  platform: PlatformPresetId
  /** id of a `CAMERA_PRESETS` entry */
  camera: string
  style: OverlayStyleId
  counters: boolean
  /** the closing card's figures */
  figures: readonly CardFigure[]
  /** a stop at every pass and summit (otherwise none) */
  stops: boolean
  /** slow down on the climbs */
  slowMotion: boolean
  /** a card for each day of a multi-day track, and at the start of each stage « À la suite » */
  cards: boolean
}

export const AUTO_FILM_TEMPLATES: Record<AutoFilmId, AutoFilmTemplate> = {
  reel: { totalS: 30, openingS: 3, closingS: 3, platform: 'vertical', camera: 'fast-drone', style: 'app', counters: false, figures: ['distance', 'ascent', 'maxAltitude'], stops: false, slowMotion: false, cards: false },
  resume: { totalS: 60, openingS: 5, closingS: 5, platform: 'youtube', camera: 'helicopter', style: 'broadcast', counters: true, figures: ['distance', 'ascent', 'maxAltitude', 'time'], stops: true, slowMotion: false, cards: true },
  souvenir: { totalS: 180, openingS: 6, closingS: 6, platform: 'youtube', camera: 'cinema', style: 'cinema', counters: true, figures: ['distance', 'ascent', 'descent', 'maxAltitude', 'time'], stops: true, slowMotion: true, cards: true },
}

export const AUTO_FILM_LABELS: Record<AutoFilmId, string> = {
  get reel() { return t('film.auto.reel.name') },
  get resume() { return t('film.auto.resume.name') },
  get souvenir() { return t('film.auto.souvenir.name') },
}

/** One plain sentence on what the gabarit makes. */
export const AUTO_FILM_HINTS: Record<AutoFilmId, string> = {
  get reel() { return t('film.auto.reel.hint') },
  get resume() { return t('film.auto.resume.hint') },
  get souvenir() { return t('film.auto.souvenir.hint') },
}

/** What the cards stay on screen after the opening and closing shots (seconds). */
const CARD_TAIL_S = 3
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** What the gabarit needs to know of the track: its days (a multi-day track) and whether the stages play « À la suite ». */
export interface AutoFilmContext {
  days: number
  stages: boolean
}

/**
 * `settings` with gabarit `id` applied: length (the flyover is the total minus the two shots), camera, slow-downs, stops,
 * overlay (on, style, counters, opening title with the date, closing card with its figures), day or stage cards and the
 * format of the video. Left as they are: the titles, subtitle, lines, pictures and credits of the cards, the free text,
 * the logo, the stops placed by hand, the places the user gave the cards on the timeline, the style of the opening and
 * closing shots (only their length follows), the own duration of stages « À la suite », the film's other items.
 */
export function autoFilmSettings(settings: Settings, id: AutoFilmId, context: AutoFilmContext): Settings {
  const tpl = AUTO_FILM_TEMPLATES[id]
  const durationS = tpl.totalS - tpl.openingS - tpl.closingS
  const camera = CAMERA_PRESETS.find((p) => p.id === tpl.camera)?.camera ?? settings.camera
  const pacing = { ...settings.pacing, keepDuration: true, enabled: tpl.slowMotion, ...(tpl.slowMotion && { climbs: true, landmarks: false, slowFactor: 0.5 }) }

  let film: Film = {
    ...settings.film,
    // the style of a shot the user chose stays (« Situation », « Balayage », transitions…): only its length follows; no shot becomes « Descente »
    opening: { ...settings.film.opening, style: settings.film.opening.style === 'aucune' ? 'descente' : settings.film.opening.style, durationS: tpl.openingS },
    closing: { ...settings.film.closing, style: settings.film.closing.style === 'aucune' ? 'descente' : settings.film.closing.style, durationS: tpl.closingS },
  }
  // stops made by hand are the user's work: the generated ones are the only ones a gabarit replaces
  if (film.autoStops || film.stops.length === 0) film = tpl.stops ? { ...film, autoStops: true, autoMode: 'temps-forts', stops: [] } : { ...film, autoStops: false, stops: [] }
  if (context.stages) film = withDefaultCard(film, tpl.cards)
  else if (context.days >= 2) film = { ...film, dayCards: { ...(film.dayCards ?? DEFAULT_DAY_CARDS), enabled: tpl.cards } }

  const styled = withStyleLayout(settings.overlay, tpl.style)
  const overlay = {
    ...styled,
    enabled: true,
    title: { ...styled.title, enabled: true, showDate: true, end: round3(clamp(CARD_TAIL_S / durationS, TITLE_END_MIN, TITLE_END_MAX)) },
    end: { ...styled.end, enabled: true, figures: [...tpl.figures], start: round3(clamp(1 - CARD_TAIL_S / durationS, END_START_MIN, END_START_MAX)) },
    counters: { ...styled.counters, enabled: tpl.counters },
  }

  return { ...settings, flyoverDurationS: durationS, camera: { ...camera }, pacing, film, overlay, video: withPlatformPreset(settings.video, tpl.platform) }
}
