/**
 * Look of the tracks and of the progress markers (« Trace » and « Marqueur », Trace tab): settings types, defaults
 * (the look before these settings existed), ranges, French labels, and the checks and upgrades used by the
 * project document. Pure: no Three.js, no DOM, so the store and the interface can import it cheaply.
 */
import { inRange, isRecord, oneOf, withDefaults } from '../core/guards'
import { isHexColor } from '../overlay/settings'
import { t } from '../i18n'
import { TRACK_COLOR_MODES } from '../flyover/trackColor'
import type { TrackMetric } from '../flyover/trackColor'
import type { FilmClock } from '../film/clock'

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
  /** « Comète » (with `drawOn`): a luminous trail that thins out behind the marker while the line draws itself */
  comet: boolean
  /** « Longueur de la comète »: metres of track behind the marker */
  cometLengthM: number
  /** « Intensité de la comète », 0..1 */
  cometIntensity: number
  /** positions averaged over this many metres of track against GPS jitter (`flyover/smooth.ts`), 0 = as recorded */
  smoothingM: number
  /** « Rideau sous le vol »: a translucent wall from a flight down to the relief (only with flights) */
  flightCurtain: boolean
  /** « Longueur du rideau »: how far the curtain falls under the line (metres), `TRACK_CURTAIN_RANGE.max` = down to the ground */
  flightCurtainM: number
  /** « Ombre au sol du vol »: the flight projected on the relief as a soft dark line (only with flights) */
  flightShadow: boolean
}

export const TRACK_WIDTH_RANGE = { min: 1, max: 12, step: 0.5 } as const
export const TRACK_SMOOTHING_RANGE = { min: 0, max: 300, step: 10 } as const
/** « Longueur du rideau »: the maximum means « Jusqu'au sol » */
export const TRACK_CURTAIN_RANGE = { min: 20, max: 1000, step: 10 } as const
export const TRACK_GLOW_INTENSITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const
export const TRACK_GLOW_WIDTH_RANGE = { min: 6, max: 64, step: 2 } as const
export const TRACK_COMET_LENGTH_RANGE = { min: 50, max: 2000, step: 50 } as const
export const TRACK_COMET_INTENSITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const

export const DEFAULT_TRACK_STYLE: TrackStyle = {
  width: 4,
  dash: 'plein',
  glow: false,
  glowIntensity: 0.75,
  glowWidth: 24,
  glowColor: '',
  drawOn: false,
  comet: false,
  cometLengthM: 300,
  cometIntensity: 0.8,
  smoothingM: 0,
  flightCurtain: true,
  flightCurtainM: TRACK_CURTAIN_RANGE.max,
  flightShadow: true,
}

/**
 * « Traînée » (with `drawOn`): each track is drawn over the last `lengthM` metres behind its marker only, so a loop
 * or a track that passes twice the same place stays readable. A distance, like the cut at the marker: the preview and
 * the export draw the same trail, and nothing moves while the film is paused. Tracks drawn whole stay whole.
 */
export interface TrackTailSettings {
  enabled: boolean
  /** length of the trail behind the marker, along the track (metres) */
  lengthM: number
}

/**
 * « Ruban de données » (`settings.trackRibbon`): a translucent wall along the track whose height and colour follow one
 * recorded quantity (the same as « Colorer selon »: speed, slope, heart rate…), over the value range shared by the tracks.
 */
export interface TrackRibbonSettings {
  enabled: boolean
  metric: TrackMetric
  /** height of the wall at the highest value (metres, in the scene) */
  heightM: number
}

export const TRACK_RIBBON_HEIGHT_RANGE = { min: 20, max: 1000, step: 10 } as const

export const DEFAULT_TRACK_RIBBON: TrackRibbonSettings = { enabled: false, metric: 'speed', heightM: 250 }

export function isValidTrackRibbon(ribbon: TrackRibbonSettings): boolean {
  return (TRACK_COLOR_MODES as readonly string[]).includes(ribbon.metric) && ribbon.metric !== ('none' as string) && inRange(ribbon.heightM, TRACK_RIBBON_HEIGHT_RANGE)
}

export const TRACK_TAIL_LENGTH_RANGE = { min: 100, max: 20_000, step: 100 } as const

export const DEFAULT_TRACK_TAIL: TrackTailSettings = { enabled: false, lengthM: 1000 }

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
  /** a 'figurine' marker bounces and sways as it walks at the marker's pace (`figureMotion`) */
  animated: boolean
  /** a 'figurine' that has a 3D model (`markerModels.ts`) is drawn as that model, facing along the track; the others keep their pictogram */
  model3d: boolean
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
  model3d: false,
  color: '#FFFFFF',
  ballStyle: 'plat',
  figureColor: '#1C2A33',
  shape: 'rond',
  label: 'aucune',
  labelText: '',
  stick: false,
}

/**
 * An animated figure walks at the pace of the marker on its track: FIGURE_STEPS_PER_S steps per second of film at the
 * film's average pace, more when the flight goes faster and fewer when it slows down (the pace to the power
 * FIGURE_PACE_EXPONENT, kept between FIGURE_STEPS_MIN and FIGURE_STEPS_MAX: a speed portion never makes it frantic).
 * It stands still, upright, while the marker does (stops, nights, holds); the bounce (FIGURE_LIFT, a fraction of the
 * badge) and the sway (FIGURE_SWAY_RAD) ease in and out over FIGURE_EASE_S.
 */
const FIGURE_STEPS_PER_S = 2
const FIGURE_STEPS_MIN = 1.2
const FIGURE_STEPS_MAX = 3.2
const FIGURE_PACE_EXPONENT = 0.4
const FIGURE_LIFT = 0.08
const FIGURE_SWAY_RAD = (5 * Math.PI) / 180
/** Below this pace (a fraction of the film's average pace) the figure is still; from FIGURE_FULL_PACE it walks fully. */
const FIGURE_STILL_PACE = 0.02
const FIGURE_FULL_PACE = 0.3
const FIGURE_EASE_S = 0.4
/** Step of the table of the walk (film seconds): the phase is interpolated between its entries. */
const FIGURE_TABLE_STEP_S = 1 / 30
/** A figure turns round (its pictogram flips) over this long (film seconds). */
export const FIGURE_TURN_S = 0.25

/** What the walk needs of the film clock. */
export type FigureClock = Pick<FilmClock, 'progressAtTime' | 'totalTime'>

/** The walk over the whole film: steps taken so far and how fully the figure walks, at each step of the table. */
interface FigureTable {
  steps: Float64Array
  strength: Float64Array
  /** steps taken while the marker moves: stands still with it (the pedals of a 3D model) */
  rolled: Float64Array
}

const figureTables = new WeakMap<FigureClock, FigureTable>()

const smoothstep = (from: number, to: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return k * k * (3 - 2 * k)
}

/** `values` averaged over the last FIGURE_EASE_S (before the film, its first value): the walk follows the pace, never leads it. */
function easedOver(values: readonly number[]): Float64Array {
  const k = Math.round(FIGURE_EASE_S / FIGURE_TABLE_STEP_S)
  const out = new Float64Array(values.length)
  let sum = k * (values[0] ?? 0)
  values.forEach((value, i) => {
    sum += value - (i >= k ? values[i - k] : values[0])
    out[i] = sum / k
  })
  return out
}

/**
 * The walk of the film of `clock`, built once per clock: the marker's pace (progress per second, against the pace it
 * keeps while it moves) gives a target strength and cadence at each step of the table, both eased; the cadence is
 * summed into the steps taken so far. The phase is thus continuous, and the same for any frame rendered alone.
 */
function figureTable(clock: FigureClock): FigureTable {
  const cached = figureTables.get(clock)
  if (cached) return cached
  const count = Math.ceil(clock.totalTime() / FIGURE_TABLE_STEP_S) + 1
  const progress = Array.from({ length: count }, (_, i) => clock.progressAtTime(i * FIGURE_TABLE_STEP_S))
  const speed = progress.map((p, i) => (i === 0 ? 0 : Math.max(0, (p - progress[i - 1]) / FIGURE_TABLE_STEP_S)))
  // the whole track over the time it takes to cover it: the average pace while it moves
  const movingS = speed.filter((v) => v > 1e-9).length * FIGURE_TABLE_STEP_S
  const pace = speed.map((v) => v * movingS)
  const strength = easedOver(pace.map((v) => smoothstep(FIGURE_STILL_PACE, FIGURE_FULL_PACE, v)))
  const cadence = easedOver(pace.map((v) => Math.min(FIGURE_STEPS_MAX, Math.max(FIGURE_STEPS_MIN, FIGURE_STEPS_PER_S * v ** FIGURE_PACE_EXPONENT))))
  const steps = new Float64Array(count)
  const rolled = new Float64Array(count)
  for (let i = 1; i < count; i++) {
    steps[i] = steps[i - 1] + cadence[i] * FIGURE_TABLE_STEP_S
    rolled[i] = rolled[i - 1] + cadence[i] * strength[i] * FIGURE_TABLE_STEP_S
  }
  const table = { steps, strength, rolled }
  figureTables.set(clock, table)
  return table
}

/**
 * Phase of the pedals of a 3D model at film time `timeS`: a turn (2π) every two steps of the walk, advancing only while the
 * marker moves, so the pedals stop with it. A function of the film clock and the time alone, like `figureMotion`.
 */
export function figureStride(clock: FigureClock, timeS: number): number {
  const { rolled } = figureTable(clock)
  const x = Math.min(Math.max(timeS / FIGURE_TABLE_STEP_S, 0), rolled.length - 1)
  const i = Math.floor(x)
  const j = Math.min(i + 1, rolled.length - 1)
  return Math.PI * (rolled[i] + (rolled[j] - rolled[i]) * (x - i))
}

/**
 * Bounce and sway of an animated figure at film time `timeS`: a function of the film clock and the time alone, so a
 * paused film keeps its pose and every export frame is the same as the preview. `lift` in [0, FIGURE_LIFT], one
 * bounce per step; both zero while the marker stands still.
 */
export function figureMotion(clock: FigureClock, timeS: number): { lift: number; tilt: number } {
  const { steps, strength } = figureTable(clock)
  const x = Math.min(Math.max(timeS / FIGURE_TABLE_STEP_S, 0), steps.length - 1)
  const i = Math.floor(x)
  const j = Math.min(i + 1, steps.length - 1)
  const k = x - i
  const phase = Math.PI * (steps[i] + (steps[j] - steps[i]) * k)
  const walk = strength[i] + (strength[j] - strength[i]) * k
  return { lift: FIGURE_LIFT * walk * Math.abs(Math.sin(phase)), tilt: FIGURE_SWAY_RAD * walk * Math.sin(phase) }
}

/** One pulse of a 'pulsation' ball every PULSE_PERIOD_S of film, drawn in PULSE_STEPS steps. */
export const PULSE_PERIOD_S = 1.5
const PULSE_STEPS = 45

/** Phase in [0, 1) of the pulse at film time `timeS`: a function of the film time alone. */
export function pulsePhase(timeS: number): number {
  const turns = timeS / PULSE_PERIOD_S
  return Math.floor((turns - Math.floor(turns)) * PULSE_STEPS) / PULSE_STEPS
}

/**
 * The marker changes with the film time alone (a walking figure, a figure that turns round, a pulsing ball): a held
 * export frame is not reused. A figure still turns round FIGURE_TURN_S after the track changes direction, so a stop that
 * begins may catch it half-way.
 */
export function markerMovesWithTime(marker: MarkerSettings): boolean {
  return marker.kind === 'figurine' || marker.ballStyle === 'pulsation'
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
    inRange(style.flightCurtainM, TRACK_CURTAIN_RANGE) &&
    inRange(style.glowIntensity, TRACK_GLOW_INTENSITY_RANGE) &&
    inRange(style.glowWidth, TRACK_GLOW_WIDTH_RANGE) &&
    inRange(style.cometLengthM, TRACK_COMET_LENGTH_RANGE) &&
    inRange(style.cometIntensity, TRACK_COMET_INTENSITY_RANGE) &&
    (style.glowColor === '' || isHexColor(style.glowColor))
  )
}

export function isValidTrackTail(tail: TrackTailSettings): boolean {
  return inRange(tail.lengthM, TRACK_TAIL_LENGTH_RANGE)
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
    typeof marker.model3d === 'boolean' &&
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
