/**
 * Poster (« Affiche ») settings: paper format, style, title, subtitle and the key figures shown. Part of `Settings`
 * (key `poster`), so they are saved in the project document and undone like the others; a preset keeps only the
 * style (the title belongs to the project). Pure module (no DOM, no React).
 */
import { withDefaults } from '../core/guards'
import { t } from '../i18n'
import type { OverlayStyleId } from '../overlay/settings'

/**
 * Paper formats at 300 dpi (A4 2480 × 3508 px, A3 3508 × 4960 px: the long side capped at 4960 px), and a square
 * picture for social networks.
 */
export const POSTER_FORMATS = [
  { id: 'a4-portrait', get label() { return t('poster.format.a4-portrait') }, width: 2480, height: 3508 },
  { id: 'a4-landscape', get label() { return t('poster.format.a4-landscape') }, width: 3508, height: 2480 },
  { id: 'a3-portrait', get label() { return t('poster.format.a3-portrait') }, width: 3508, height: 4960 },
  { id: 'a3-landscape', get label() { return t('poster.format.a3-landscape') }, width: 4960, height: 3508 },
  { id: 'square', get label() { return t('poster.format.square') }, width: 2160, height: 2160 },
] as const
export type PosterFormatId = (typeof POSTER_FORMATS)[number]['id']

/** The styles of the film overlay, as posters. */
export const POSTER_STYLES = ['editorial', 'broadcast', 'app', 'neon', 'cinema', 'journal', 'tableau'] as const satisfies readonly OverlayStyleId[]
export type PosterStyleId = (typeof POSTER_STYLES)[number]

/**
 * Arrangement of a poster: the view in a printed margin (editorial), over a text band (broadcast) or under a card
 * (app); between two black bands, the text in the lower one (cinema); beside a paper column (journal); over a dark
 * band of big figures (tableau).
 */
export type PosterLayoutId = 'editorial' | 'broadcast' | 'app' | 'cinema' | 'journal' | 'tableau'
export const POSTER_LAYOUTS: Record<PosterStyleId, PosterLayoutId> = {
  editorial: 'editorial',
  broadcast: 'broadcast',
  app: 'app',
  neon: 'broadcast',
  cinema: 'cinema',
  journal: 'journal',
  tableau: 'tableau',
}

/** The 3D view of the poster: every track framed from the south (« Vue d'ensemble »), or the camera as it is now. */
export const POSTER_VIEWS = ['overview', 'camera'] as const
export type PosterView = (typeof POSTER_VIEWS)[number]
export const POSTER_VIEW_LABELS: Record<PosterView, string> = {
  get overview() { return t('poster.view.overview') },
  get camera() { return t('poster.view.camera') },
}

/** File type of the poster and of the still image (« Image fixe »). */
export const POSTER_TYPES = ['image/png', 'image/jpeg'] as const
export type PosterType = (typeof POSTER_TYPES)[number]

export const POSTER_FIGURES = ['distance', 'ascent', 'time', 'maxAltitude', 'climbs'] as const
export type PosterFigureId = (typeof POSTER_FIGURES)[number]

export const POSTER_FIGURE_LABELS: Record<PosterFigureId, string> = {
  get distance() { return t('poster.figure.distance') },
  get ascent() { return t('poster.figure.ascent') },
  get time() { return t('poster.figure.time') },
  get maxAltitude() { return t('poster.figure.maxAltitude') },
  get climbs() { return t('poster.figure.climbs') },
}

export interface PosterSettings {
  format: PosterFormatId
  style: PosterStyleId
  /** '' = name of the project */
  title: string
  /** line under the title, before the date ('' = date only) */
  subtitle: string
  figures: Record<PosterFigureId, boolean>
  /** weather of the day under the profile (when the outing's weather is known) */
  weather: boolean
  /** « Carte à plat »: the view is a map seen from straight above (imagery tiles), not the 3D overview */
  flat: boolean
  /** the 3D view (not the flat map): the overview of every track, or the camera as it is now */
  view: PosterView
  /** PNG (lossless) or JPEG (smaller), for the poster and the still image */
  type: PosterType
}

export const DEFAULT_POSTER: PosterSettings = {
  format: 'a4-portrait',
  style: 'editorial',
  title: '',
  subtitle: '',
  figures: { distance: true, ascent: true, time: true, maxAltitude: true, climbs: true },
  weather: true,
  flat: false,
  view: 'overview',
  type: 'image/png',
}

/** Pixel size of a format. */
export function posterSize(format: PosterFormatId): { width: number; height: number } {
  const found = POSTER_FORMATS.find((f) => f.id === format) ?? POSTER_FORMATS[0]
  return { width: found.width, height: found.height }
}

/** Value checks once the JSON shape matches `DEFAULT_POSTER` (`SETTING_CHECKS`): format, style, view and type ids. */
export function isValidPoster(p: PosterSettings): boolean {
  return (
    POSTER_FORMATS.some((f) => f.id === p.format) &&
    (POSTER_STYLES as readonly string[]).includes(p.style) &&
    (POSTER_VIEWS as readonly string[]).includes(p.view) &&
    (POSTER_TYPES as readonly string[]).includes(p.type)
  )
}

/** Fields missing from a poster saved before they were added, taken from `DEFAULT_POSTER` (`SETTING_UPGRADES`). */
export const withPosterDefaults = withDefaults(DEFAULT_POSTER)
