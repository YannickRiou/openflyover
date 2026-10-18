/**
 * Look of the tracks and of the progress markers (« Trace » and « Marqueur », Trace tab): settings types, defaults
 * (the look before these settings existed), ranges, French labels, and the checks and upgrades used by the
 * project document. Pure: no Three.js, no DOM, so the store and the interface can import it cheaply.
 */
import { inRange, isRecord, oneOf, withDefaults } from '../core/guards'
import { isHexColor } from '../overlay/settings'
import { t } from '../i18n'

// ---------------------------------------------------------------------------
// Track style
// ---------------------------------------------------------------------------

export const TRACK_DASHES = ['plein', 'tirets', 'points'] as const
export type TrackDash = (typeof TRACK_DASHES)[number]

export interface TrackStyle {
  /** line width in pixels of a 1080-pixel frame (times the export render scale, like the labels) */
  width: number
  dash: TrackDash
  /** soft halo around the line, hidden by the relief like the line */
  glow: boolean
  /** strength of the halo, 0..1 (« Intensité du halo ») */
  glowIntensity: number
  /** full width of the halo in pixels of a 1080-pixel frame, like `width` */
  glowWidth: number
  /** '#rrggbb', '' = the colour of the track (or of its colouring by a metric) */
  glowColor: string
  /** « trace qui se dessine »: only the part already travelled by the marker is drawn */
  drawOn: boolean
  /** positions averaged over this many metres of track against GPS jitter (`flyover/smooth.ts`), 0 = as recorded */
  smoothingM: number
}

export const TRACK_WIDTH_RANGE = { min: 1, max: 12, step: 0.5 } as const
export const TRACK_SMOOTHING_RANGE = { min: 0, max: 300, step: 10 } as const
export const TRACK_GLOW_INTENSITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const
export const TRACK_GLOW_WIDTH_RANGE = { min: 6, max: 64, step: 2 } as const

export const DEFAULT_TRACK_STYLE: TrackStyle = {
  width: 4,
  dash: 'plein',
  glow: false,
  glowIntensity: 0.75,
  glowWidth: 24,
  glowColor: '',
  drawOn: false,
  smoothingM: 0,
}

export const TRACK_DASH_LABELS: Record<TrackDash, string> = {
  get plein() { return t('marker.dash.plein') },
  get tirets() { return t('marker.dash.tirets') },
  get points() { return t('marker.dash.points') },
}

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

export const MARKER_KINDS = ['boule', 'figurine', 'image'] as const
export type MarkerKind = (typeof MARKER_KINDS)[number]

export const MARKER_FIGURES = [
  'randonneur',
  'alpiniste',
  'coureur',
  'traileur',
  'cycliste',
  'vae',
  'bikepacking',
  'vtt',
  'skieur',
  'ski-rando',
  'nageur',
  'kayak',
  'cavalier',
  'parapente',
  'moto',
  'voiture',
  'avion',
] as const
export type MarkerFigure = (typeof MARKER_FIGURES)[number]
/** 'auto': the figure of the track's activity (`figureOfActivity`), each racer its own. */
export const MARKER_FIGURE_CHOICES = ['auto', ...MARKER_FIGURES] as const
export type MarkerFigureChoice = (typeof MARKER_FIGURE_CHOICES)[number]

/** Look of a ball: plain disc (as before), a soft halo, or a ring pulsing outwards. */
export const MARKER_BALL_STYLES = ['plat', 'halo', 'pulsation'] as const
export type MarkerBallStyle = (typeof MARKER_BALL_STYLES)[number]

/** Outline of a figure badge: disc, map pin (its tip on the track), rounded square, or the figure alone, outlined. */
export const MARKER_SHAPES = ['rond', 'epingle', 'carre', 'contour'] as const
export type MarkerShape = (typeof MARKER_SHAPES)[number]

/** Text under the markers: none, the track's name, or a free text on the lead (the racers show their track's name). */
export const MARKER_LABEL_MODES = ['aucune', 'nom', 'texte'] as const
export type MarkerLabelMode = (typeof MARKER_LABEL_MODES)[number]

export interface MarkerSettings {
  kind: MarkerKind
  /** pictogram of a 'figurine' marker */
  figure: MarkerFigureChoice
  /** picture of an 'image' marker: small square PNG data URL, '' = none (the marker is then a ball) */
  image: string
  /** multiplier of the on-screen size (1 = the ball of a 1000-pixel frame, about 14 pixels across) */
  size: number
  /** a 'figurine' marker bounces and sways with the film time (`figureMotion`) */
  animated: boolean
  /**
   * '#rrggbb' of the ball and of the ring of a figure or picture badge, '' = the colour of the track. The lead
   * marker's only: the racers keep the colour of their own track.
   */
  color: string
  ballStyle: MarkerBallStyle
  /** '#rrggbb' of the disc of a figure badge (of the figure itself with 'contour'), '' = the colour of the track */
  figureColor: string
  shape: MarkerShape
  label: MarkerLabelMode
  /** text of the 'texte' label, MARKER_LABEL_MAX_CHARS at most */
  labelText: string
  /** the badge stands on a stick above the track, its shadow on the ground at the foot */
  stick: boolean
}

export const MARKER_SIZE_RANGE = { min: 0.5, max: 3, step: 0.25 } as const

/** Bound on the stored picture: a 128-pixel PNG is far below, a pasted photo is not. */
export const MARKER_IMAGE_MAX_CHARS = 300_000
/** Longest text under a marker (a longer track name is cut with an ellipsis). */
export const MARKER_LABEL_MAX_CHARS = 40

/** White ball, ink figure badge edged in white (`BADGE_WHITE`, `BADGE_INK` of markerBadge.ts): the look before these settings. */
export const DEFAULT_MARKER: MarkerSettings = {
  kind: 'boule',
  figure: 'auto',
  image: '',
  size: 1,
  animated: false,
  color: '#FFFFFF',
  ballStyle: 'plat',
  figureColor: '#1C2A33',
  shape: 'rond',
  label: 'aucune',
  labelText: '',
  stick: false,
}

/** Steps of an animated figure per second of film, height of its bounce (fraction of the badge) and sway (radians). */
const FIGURE_STEPS_PER_S = 2
const FIGURE_LIFT = 0.08
const FIGURE_SWAY_RAD = (5 * Math.PI) / 180

/**
 * Bounce and sway of an animated figure at film time `timeS`: a function of the time alone, so a paused film keeps
 * its pose and every export frame is the same as the preview. `lift` in [0, FIGURE_LIFT], one bounce per step.
 */
export function figureMotion(timeS: number): { lift: number; tilt: number } {
  const phase = Math.PI * FIGURE_STEPS_PER_S * timeS
  return { lift: FIGURE_LIFT * Math.abs(Math.sin(phase)), tilt: FIGURE_SWAY_RAD * Math.sin(phase) }
}

/** One pulse of a 'pulsation' ball every PULSE_PERIOD_S of film, drawn in PULSE_STEPS steps. */
export const PULSE_PERIOD_S = 1.5
const PULSE_STEPS = 45

/** Phase in [0, 1) of the pulse at film time `timeS`: like `figureMotion`, a function of the film time alone. */
export function pulsePhase(timeS: number): number {
  const turns = timeS / PULSE_PERIOD_S
  return Math.floor((turns - Math.floor(turns)) * PULSE_STEPS) / PULSE_STEPS
}

/** The marker changes with the film time alone (an animated figure, a pulsing ball): a held export frame is not reused. */
export function markerMovesWithTime(marker: MarkerSettings): boolean {
  return marker.kind === 'figurine' ? marker.animated : marker.ballStyle === 'pulsation'
}

/**
 * Figure of an activity type (GPX <type>, FIT sport, Strava sport in snake case), the first pattern that matches;
 * the hiker when unknown. Same idea as `planActivityOf` (plan/timing.ts), with more activities.
 */
const ACTIVITY_FIGURES: readonly (readonly [RegExp, MarkerFigure])[] = [
  [/swim|natation|nage/, 'nageur'],
  [/kayak|cano[eë]|paddl|raft|rowing|aviron/, 'kayak'],
  [/backcountry|ski_?tour|skitour|ski de rando|splitboard/, 'ski-rando'],
  [/ski|snowboard/, 'skieur'],
  [/trail/, 'traileur'],
  [/run|course|jog/, 'coureur'],
  [/horse|equestr|[ée]questre|cheval/, 'cavalier'],
  [/motorcycl|moto/, 'moto'],
  [/\be[-_ ]?bik|lectri|\bvae\b/, 'vae'],
  [/mountain_?bik|mtb|vtt/, 'vtt'],
  [/gravel|cycl|bik|ride|v[ée]lo/, 'cycliste'],
  [/mountaineer|alpinis|climb|escalade/, 'alpiniste'],
  // kite: a rider under a wing on its lines, the nearest figure
  [/paraglid|parapente|hang_?glid|deltaplane|kite/, 'parapente'],
  [/fly|avion|aviation/, 'avion'],
  [/driv|voiture/, 'voiture'],
]

export function figureOfActivity(activityType: string | undefined): MarkerFigure {
  const type = activityType?.toLowerCase() ?? ''
  return ACTIVITY_FIGURES.find(([pattern]) => pattern.test(type))?.[1] ?? 'randonneur'
}

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = {
  get boule() { return t('marker.kind.boule') },
  get figurine() { return t('marker.kind.figurine') },
  get image() { return t('marker.kind.image') },
}

export const MARKER_FIGURE_LABELS: Record<MarkerFigureChoice, string> = {
  get auto() { return t('marker.figure.auto') },
  get randonneur() { return t('marker.figure.randonneur') },
  get alpiniste() { return t('marker.figure.alpiniste') },
  get coureur() { return t('marker.figure.coureur') },
  get traileur() { return t('marker.figure.traileur') },
  get cycliste() { return t('marker.figure.cycliste') },
  get vae() { return t('marker.figure.vae') },
  get bikepacking() { return t('marker.figure.bikepacking') },
  get vtt() { return t('marker.figure.vtt') },
  get skieur() { return t('marker.figure.skieur') },
  get 'ski-rando'() { return t('marker.figure.ski-rando') },
  get nageur() { return t('marker.figure.nageur') },
  get kayak() { return t('marker.figure.kayak') },
  get cavalier() { return t('marker.figure.cavalier') },
  get parapente() { return t('marker.figure.parapente') },
  get moto() { return t('marker.figure.moto') },
  get voiture() { return t('marker.figure.voiture') },
  get avion() { return t('marker.figure.avion') },
}

export const MARKER_BALL_STYLE_LABELS: Record<MarkerBallStyle, string> = {
  get plat() { return t('marker.ball.plat') },
  get halo() { return t('marker.ball.halo') },
  get pulsation() { return t('marker.ball.pulsation') },
}

export const MARKER_SHAPE_LABELS: Record<MarkerShape, string> = {
  get rond() { return t('marker.shape.rond') },
  get epingle() { return t('marker.shape.epingle') },
  get carre() { return t('marker.shape.carre') },
  get contour() { return t('marker.shape.contour') },
}

export const MARKER_LABEL_MODE_LABELS: Record<MarkerLabelMode, string> = {
  get aucune() { return t('marker.labelMode.aucune') },
  get nom() { return t('marker.labelMode.nom') },
  get texte() { return t('marker.labelMode.texte') },
}

// ---------------------------------------------------------------------------
// Project document: value checks (the JSON shape is checked against the defaults) and upgrades
// ---------------------------------------------------------------------------


export function isValidTrackStyle(style: TrackStyle): boolean {
  return (
    inRange(style.width, TRACK_WIDTH_RANGE) &&
    oneOf(TRACK_DASHES, style.dash) &&
    inRange(style.smoothingM, TRACK_SMOOTHING_RANGE) &&
    inRange(style.glowIntensity, TRACK_GLOW_INTENSITY_RANGE) &&
    inRange(style.glowWidth, TRACK_GLOW_WIDTH_RANGE) &&
    (style.glowColor === '' || isHexColor(style.glowColor))
  )
}

const isTrackOrHexColor = (color: string) => color === '' || isHexColor(color)

export function isValidMarker(marker: MarkerSettings): boolean {
  const image = marker.image === '' || (marker.image.startsWith('data:image/') && marker.image.length <= MARKER_IMAGE_MAX_CHARS)
  return (
    oneOf(MARKER_KINDS, marker.kind) &&
    oneOf(MARKER_FIGURE_CHOICES, marker.figure) &&
    image &&
    inRange(marker.size, MARKER_SIZE_RANGE) &&
    isTrackOrHexColor(marker.color) &&
    oneOf(MARKER_BALL_STYLES, marker.ballStyle) &&
    isTrackOrHexColor(marker.figureColor) &&
    oneOf(MARKER_SHAPES, marker.shape) &&
    oneOf(MARKER_LABEL_MODES, marker.label) &&
    marker.labelText.length <= MARKER_LABEL_MAX_CHARS
  )
}

export const withTrackStyleDefaults = withDefaults(DEFAULT_TRACK_STYLE)
const withMarkerFields = withDefaults(DEFAULT_MARKER)

/** A saved marker completed with the defaults; the 'anneau' ball style (dropped in 2.1.1) opens as 'plat'. */
export function withMarkerDefaults(raw: unknown): unknown {
  const marker = withMarkerFields(raw)
  return isRecord(marker) && marker.ballStyle === 'anneau' ? { ...marker, ballStyle: 'plat' } : marker
}
