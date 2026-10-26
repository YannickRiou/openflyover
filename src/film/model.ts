/**
 * The film: what the timeline arranges on top of the flight along the first track (« la base, c'est le GPX »).
 * Opening / closing shots, stops, speed portions, camera keys, texts, media, music and points of interest;
 * see ARCHITECTURE.md "Film and timeline".
 *
 * Part of `Settings` (key `film`): saved in the project, undone, read the same way by the preview and the export.
 * Ids are stable (`stop-3`, `text-1`, `auto-4520` for a generated stop) so the timeline can select an item across
 * edits. Pure module (no DOM, React, Three or store).
 */
import { isRecord, oneOf } from '../core/guards'
import { smootherstep } from '../core/math'
import { CAMERA_RANGES } from '../flyover/cameraSettings'
import { OVERLAY_ANCHORS, OVERLAY_FONT_IDS, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN, isHexColor, isValidOverrides } from '../overlay/settings'
import type { OverlayAnchor, OverlayFontId, OverlayOverrides } from '../overlay/settings'
import { isValidMarkerLook } from './markerKeys'
import type { FilmMarkerKey } from './markerKeys'
import { FILM_PARAMS, PARAM_SPECS } from './paramKeys'
import type { FilmParam, FilmParamKey } from './paramKeys'
import { t } from '../i18n'

export const SHOT_STYLES = ['aucune', 'descente', 'saut', 'situation', 'balayage'] as const
/**
 * 'descente': the camera glides from the overview down to the flight; 'saut': overview held, then a quick move;
 * 'situation': like 'descente', from much higher above the region (closing: back up to it); 'balayage': the
 * overview turns slowly around the track, then glides down to the flight (closing: up, then the turn).
 */
export type ShotStyle = (typeof SHOT_STYLES)[number]

export const SHOT_TRANSITIONS = ['enchaine', 'coupe', 'fondu-noir', 'fondu-blanc'] as const
/**
 * How a shot joins the flight (opening: at its end; closing: at its start). 'enchaine': one continuous camera move
 * (the shot's style); 'coupe': the wide view held over the whole shot, cut to (or from) the flight at the boundary;
 * 'fondu-noir' / 'fondu-blanc': the same cut, at the darkest (lightest) point of a dip of the image (`transitionDipAt`).
 */
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number]
export const SHOT_TRANSITION_LABELS: Record<ShotTransition, string> = {
  get enchaine() { return t('film.shotTransition.enchaine') },
  get coupe() { return t('film.shotTransition.coupe') },
  get 'fondu-noir'() { return t('film.shotTransition.fondu-noir') },
  get 'fondu-blanc'() { return t('film.shotTransition.fondu-blanc') },
}

export interface FilmShot {
  style: ShotStyle
  /** seconds at ×1 (unused with 'aucune') */
  durationS: number
  /** default 'enchaine' (films saved before the transitions keep their continuous move) */
  transition?: ShotTransition
  /** length of a dip, centred on the cut (seconds at ×1; default `DIP_DEFAULT_S`) */
  dipS?: number
  /** 'situation': how high the shot starts (default 'region') */
  startHeight?: StartHeight
  /** 'situation': highlight the administrative region of the outing (OpenStreetMap) and frame it; default off */
  highlight?: boolean
  /**
   * 'situation' with `highlight`: the place highlighted (« Lieu »), an OSM area containing the track ("relation/123",
   * "way/45"); absent = the automatic administrative region. One place per film: `setFilmPlace` writes both shots.
   */
  regionId?: string
  /**
   * 'situation': seconds the region view is held (« Maintien »: at the start of the opening, at the end of the
   * closing) within `durationS`; the rest is the move (« Plongée »). Default 0: one move over the whole shot.
   */
  holdS?: number
  /** 'situation', framing of the region view (« Cadrage », `SituationFraming`): all absent = the automatic framing */
  tiltDeg?: number
  distanceKm?: number
  heading?: SituationHeading
  bearingDeg?: number
  headroomPct?: number
  /**
   * light of the shot (« Soleil », flyover/sun.ts `shotSunDate`), any style but 'aucune'; absent: the flight's sun
   * ('survol'), except a 'situation' shot: « Plein jour », or 'accelere' when `moveSun`
   */
  sun?: ShotSun
  /** older projects, 'situation' only: « Faire bouger le soleil », read as `sun: 'accelere'` */
  moveSun?: boolean
  /** hours of daylight the sun runs over the shot in « Accéléré » (`SHOT_SUN_HOURS_RANGE`); absent: `SHOT_SUN_HOURS` (flyover/sun.ts) */
  sunHours?: number
}

export const SHOT_SUN_HOURS_RANGE = { min: 1, max: 12, step: 1 } as const

export const SHOT_SUNS = ['jour', 'survol', 'accelere'] as const
/** « Plein jour » (daylight easing into the flight's sun), « Heure du survol », « Accéléré » (a time lapse of `sunHours` hours). */
export type ShotSun = (typeof SHOT_SUNS)[number]

/**
 * Sun of a shot: its own choice, else the default of its style, unchanged for films saved before the choice was
 * offered for every style: a 'situation' shot in « Plein jour » (« Accéléré » with `moveSun`), the others hold the
 * flight's sun.
 */
export function shotSunOf(shot: Pick<FilmShot, 'style' | 'sun' | 'moveSun'>): ShotSun {
  if (shot.sun) return shot.sun
  if (shot.style !== 'situation') return 'survol'
  return shot.moveSun === true ? 'accelere' : 'jour'
}

export const SITUATION_HEADINGS = ['libre', 'boussole'] as const
/**
 * Heading of the region view: 'libre', from the side the flight camera looks from where the shot joins it (no turn
 * during the move); 'boussole', looking toward `bearingDeg` (0: north up).
 */
export type SituationHeading = (typeof SITUATION_HEADINGS)[number]
export const SITUATION_HEADING_LABELS: Record<SituationHeading, string> = {
  get libre() { return t('film.situationHeading.libre') },
  get boussole() { return t('film.situationHeading.boussole') },
}
/**
 * Framing of the region view of a 'situation' shot (flyover/filmCamera.ts `regionView`): tilt from the vertical
 * (default 90° − REGION_PITCH_DEG), distance in km (default: fitted to the region or the track, see « Hauteur »),
 * heading and its bearing, headroom (share of the frame height the region's centre sits below the middle).
 */
export type SituationFraming = Pick<FilmShot, 'tiltDeg' | 'distanceKm' | 'heading' | 'bearingDeg' | 'headroomPct'>
/** Ranges of the framing fields (also their validity in a loaded project). */
export const SITUATION_TILT_RANGE = { min: 1, max: 60, step: 1 } as const
/** Tilt of the region view without a framing (flyover/filmCamera.ts `REGION_PITCH_DEG` = 90° − this above the horizon). */
export const SITUATION_TILT_DEFAULT_DEG = 25
export const SITUATION_DISTANCE_KM_RANGE = { min: 5, max: 400, step: 5 } as const
export const SITUATION_BEARING_RANGE = { min: 0, max: 359, step: 1 } as const
export const SITUATION_HEADROOM_RANGE = { min: 0, max: 30, step: 1 } as const

export const START_HEIGHTS = ['region', 'pays'] as const
/** Height of the region view of a 'situation' shot (flyover/filmCamera.ts `regionDistanceM`). */
export type StartHeight = (typeof START_HEIGHTS)[number]
export const START_HEIGHT_LABELS: Record<StartHeight, string> = {
  get region() { return t('film.startHeight.region') },
  get pays() { return t('film.startHeight.pays') },
}

/** The film opens or closes on a 'situation' shot that highlights the region (osm/region.ts is then asked for it). */
export function highlightsRegion(film: Pick<Film, 'opening' | 'closing'>): boolean {
  return [film.opening, film.closing].some((shot) => shot.style === 'situation' && shot.highlight === true)
}
/** Place chosen for the region highlight (`regionId` of the first shot that highlights it), null: automatic. */
export function filmRegionId(film: Pick<Film, 'opening' | 'closing'>): string | null {
  const shot = [film.opening, film.closing].find((s) => s.style === 'situation' && s.highlight === true)
  return shot?.regionId ?? null
}
/** Form of a stored place: an OSM relation or way. */
export const isRegionId = (v: unknown): v is string => typeof v === 'string' && /^(relation|way)\/\d+$/.test(v)
/** Duration given to a shot switched to 'situation' while it had its default duration (seconds): the dive is long. */
export const SITUATION_DURATION_S = 9
/** Hold on the region view of a 'situation' shot (seconds; also its validity range in a loaded project). */
export const SITUATION_HOLD_RANGE = { min: 0, max: 10, step: 0.5 } as const

/** Hold of a 'situation' shot and its move (seconds), within its duration: hold + move = `durationS`. */
export function situationTiming(shot: Pick<FilmShot, 'durationS' | 'holdS'>): { holdS: number; moveS: number } {
  const holdS = Math.min(Math.max(0, shot.holdS ?? 0), shot.durationS)
  return { holdS, moveS: shot.durationS - holdS }
}

/** Length of a dip to black or white (also its validity range in a loaded project), seconds. */
export const DIP_DURATION_RANGE = { min: 0.3, max: 2, step: 0.1 } as const
export const DIP_DEFAULT_S = 1

export const STOP_CAMERAS = ['film', 'orbite', 'large', 'fixe'] as const
/**
 * Camera during a stop. 'film': the flight camera goes on (the marker holds, so does the camera, but the orbit and
 * cinema styles keep moving); 'orbite': the camera turns around the stop and comes back; 'large': it pulls back and
 * up and comes back; 'fixe': the framing holds, the motion of the orbit and cinema styles too.
 */
export type StopCamera = (typeof STOP_CAMERAS)[number]
export const STOP_CAMERA_LABELS: Record<StopCamera, string> = {
  get film() { return t('film.stopCamera.film') },
  get orbite() { return t('film.stopCamera.orbite') },
  get large() { return t('film.stopCamera.large') },
  get fixe() { return t('film.stopCamera.fixe') },
}

export const STOP_SOURCES = ['climb', 'landmark', 'waypoint', 'manual'] as const
export type StopSourceKind = (typeof STOP_SOURCES)[number]

export interface FilmStop {
  id: string
  /** distance along the first track (metres, same scale as `buildTrackPath`) */
  atM: number
  /** time added to the film (seconds at ×1, eases in and out included) */
  durationS: number
  camera: StopCamera
  label?: string
  /** what the stop was made for: climb index, OSM id, waypoint index */
  source?: { kind: StopSourceKind; ref?: string }
}

export interface FilmText {
  id: string
  /** film time of its appearance and how long it stays (seconds at ×1) */
  startS: number
  durationS: number
  text: string
  subtitle?: string
  /** same placement as the overlay text widget: one of the nine anchors, size multiplier */
  anchor: OverlayAnchor
  size: number
  /** its own text colour '#rrggbb' and font; absent = those of the overlay */
  color?: string
  font?: OverlayFontId
  /** stop the text is attached to (`attachToStop`): it follows the stop when it moves, free again once it is gone */
  stopId?: string
}

/** 'image': a photo; 'video': a video clip (with its sound unless muted, see `clipHasSound`). */
export const MEDIA_KINDS = ['image', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_LAYOUTS = ['plein-ecran', 'carte'] as const
/** 'plein-ecran': the photo covers the 3D view; 'carte': a framed photo card at an anchor of the overlay. */
export type MediaLayout = (typeof MEDIA_LAYOUTS)[number]

export interface FilmMedia {
  id: string
  /** film time of its appearance and how long it stays (seconds at ×1) */
  startS: number
  durationS: number
  kind: MediaKind
  /** id of the picture in the media table of the project document */
  src: string
  layout: MediaLayout
  /** card placement (one of the nine anchors) and size multiplier; the caption of a full-screen photo goes there too */
  anchor: OverlayAnchor
  size: number
  /** slow zoom and pan over a full-screen photo (not used by a video) */
  kenBurns: boolean
  caption?: string
  /** video: where the clip starts and ends in the file (seconds; default its start and its end) */
  inS?: number
  outS?: number
  /** video: its sound left out (true for clips saved before the sound was handled: their films stay as they were) */
  muted?: boolean
  /** video: volume of its sound, 0 (silent) to 1 (as recorded, the default) */
  volume?: number
  /** video synced with the recorded track (« Caler sur le parcours »), see `MediaSync` */
  sync?: MediaSync
  /** stop the medium is attached to, like a text's (an attached photo is shown during the hold of the stop) */
  stopId?: string
}

/**
 * A clip synced with the recorded track: when it was recorded and how its time follows the flight. Its place on
 * the timeline is set by `syncClipPlacement` (film/timeline.ts) when it is synced or its offset changes.
 */
export interface MediaSync {
  /** recording start of the clip (ms since epoch, from the file) */
  startMs: number
  /** correction of the camera clock (seconds; positive: the clip was recorded later than its file says) */
  offsetS: number
  /**
   * the clip's time follows the flight: the frame shown is the one recorded when the athlete was where the marker
   * is (slow-downs, speed portions and stops of the film included; during a stop the frame holds)
   */
  follow: boolean
}

/** Range of the clock correction of a synced clip (seconds): a day either way covers time zones. */
export const SYNC_OFFSET_RANGE = { min: -86_400, max: 86_400 } as const

export interface FilmSpeed {
  id: string
  /** portion of the first track (metres, `fromM` < `toM`) */
  fromM: number
  toM: number
  /** local ground speed multiplied by this (2 = twice as fast, 0.5 = half as fast) */
  factor: number
}

export interface FilmAudio {
  id: string
  /** id of the sound file in the media table of the project document */
  src: string
  /** film time at which it starts and how long it plays (seconds at ×1; never past the end of the file) */
  startS: number
  durationS: number
  /** where it starts in the file (seconds) */
  inS: number
  /** 0 (silent) to 1 (as recorded) */
  volume: number
  /** linear fades at its start and its end (seconds; shortened in proportion when they overlap) */
  fadeInS: number
  fadeOutS: number
}

/** Volume and fades of a music clip added on the timeline. */
export const AUDIO_DEFAULTS: Pick<FilmAudio, 'volume' | 'fadeInS' | 'fadeOutS'> = { volume: 1, fadeInS: 0.5, fadeOutS: 2 }
/** Ranges of a music clip (also its validity ranges in a loaded project), seconds. */
export const AUDIO_DURATION_RANGE = { min: 0.5, max: 3600 } as const
export const FADE_RANGE = { min: 0, max: 30, step: 0.5 } as const

/** A point of interest placed by hand: a name at a place on the ground, shown as a label in the view and the film. */
export const POI_ICONS = ['epingle', 'refuge', 'bivouac', 'sommet', 'vue', 'photo', 'drapeau', 'eau', 'repas', 'trophee'] as const
export type PoiIcon = (typeof POI_ICONS)[number]
export const POI_ICON_LABELS: Record<PoiIcon, string> = {
  get epingle() { return t('landmarks.poiIcon.epingle') },
  get refuge() { return t('landmarks.poiIcon.refuge') },
  get bivouac() { return t('landmarks.poiIcon.bivouac') },
  get sommet() { return t('landmarks.poiIcon.sommet') },
  get vue() { return t('landmarks.poiIcon.vue') },
  get photo() { return t('landmarks.poiIcon.photo') },
  get drapeau() { return t('landmarks.poiIcon.drapeau') },
  get eau() { return t('landmarks.poiIcon.eau') },
  get repas() { return t('landmarks.poiIcon.repas') },
  get trophee() { return t('landmarks.poiIcon.trophee') },
}

export interface FilmPoi {
  id: string
  lon: number
  lat: number
  name: string
  /** pictogram of its label; absent = 'epingle' */
  icon?: PoiIcon
}

/**
 * A keyframe (« Image clé »): the exact pose of the flight camera at a place of the first track, around the film's
 * aim point there. `distance` (× the automatic distance), `pitchDeg` (above the horizon) and `headingOffsetDeg` (from
 * the track's direction of travel, `keyReferenceAt`) place the camera around the aim point shifted by `aimRightM` /
 * `aimAheadM` (a panned view; absent = 0). At the key the film shows that pose; it eases from one key to the next,
 * and from the film's camera into the first key and back after the last one (`computeFilmView`).
 */
export interface FilmCameraKey {
  id: string
  /** distance along the first track (metres, same scale as `buildTrackPath`) */
  atM: number
  distance: number
  pitchDeg: number
  headingOffsetDeg: number
  aimRightM?: number
  aimAheadM?: number
}

/** Validity ranges of a keyframe: any view the 3D orbit can take (the inspector sliders keep the camera ranges). */
export const CAMERA_KEY_RANGES = {
  distance: { min: 0.01, max: 1000 },
  pitchDeg: { min: 0, max: 90 },
  aimM: { min: -1e6, max: 1e6 },
} as const

/** Range of the speed factor (also its validity range in a loaded project). */
export const SPEED_FACTOR_RANGE = { min: 0.25, max: 4 } as const
/** Shortest speed portion made on the timeline (metres). */
export const MIN_SPEED_SPAN_M = 50

/** Sound of a video clip added on the timeline: heard, as recorded. */
export const VIDEO_SOUND_DEFAULTS: Pick<FilmMedia, 'muted' | 'volume'> = { muted: false, volume: 1 }

/** Placement of a photo added on the timeline (and of a medium saved before these fields existed). */
export const MEDIA_DEFAULTS: Pick<FilmMedia, 'layout' | 'anchor' | 'size' | 'kenBurns'> = {
  layout: 'plein-ecran',
  anchor: 'bottom-left',
  size: 1,
  kenBurns: true,
}

/**
 * The nights of a multi-day track (« Jours et nuits », Lumière tab): where the recording rests overnight, the flight
 * pauses for `duskS` + `nightS` + `dawnS` seconds while the sun sets, the night passes and the sun rises again
 * (flyover/nights.ts, `nightSunDate`); added to the film whatever « Garder la durée ».
 */
export interface FilmNights {
  enabled: boolean
  duskS: number
  nightS: number
  dawnS: number
  /** nights removed on the timeline (`nightKey`: the date of their sunset); absent: none */
  skipped?: string[]
}
/** Range of each part of a night (seconds at ×1; also their validity range in a loaded project). */
export const NIGHT_PART_RANGE = { min: 0, max: 20, step: 0.5 } as const
/** The three parts of a night, with their label and tip in the settings and in the inspector of a « Nuit » junction. */
export const NIGHT_PARTS: { key: 'duskS' | 'nightS' | 'dawnS'; label: string; tip: string }[] = [
  { key: 'duskS', get label() { return t('light.nights.dusk') }, get tip() { return t('light.nights.duskTip') } },
  { key: 'nightS', get label() { return t('light.nights.night') }, get tip() { return t('light.nights.nightTip') } },
  { key: 'dawnS', get label() { return t('light.nights.dawn') }, get tip() { return t('light.nights.dawnTip') } },
]
export const DEFAULT_NIGHTS: FilmNights = { enabled: true, duskS: 3, nightS: 2, dawnS: 3 }

/** The figures a day card can show under « Jour n »: the date, the day's distance, climb, time on the move, start time and weather. */
export const DAY_CARD_FIELDS = ['date', 'distance', 'ascent', 'duration', 'start', 'weather'] as const
export type DayCardField = (typeof DAY_CARD_FIELDS)[number]
/** How long a day card stays (seconds at ×1; also its validity range in a loaded project). */
export const DAY_CARD_DURATION_RANGE = { min: 2, max: 15, step: 0.5 } as const

/**
 * The card that opens each day of a multi-day track (« Cartes de jour »): drawn from the track and the clock at every
 * frame like the card of a stage « À la suite » (so it follows the track, the nights and the weather), not baked into
 * the texts. `view`: during the night before the day, the camera rises to a high view of that day's route, holds, and
 * dives back to the marker at dawn; the card shows over it.
 */
export interface FilmDayCards {
  enabled: boolean
  durationS: number
  anchor: OverlayAnchor
  size: number
  fields: Record<DayCardField, boolean>
  /** title with `{n}` (day number), `{count}` (days) and `{date}`; absent: « Jour n » */
  title?: string
  /** the colours, fonts and text backing of the day cards over the overlay's (« Couleurs et polices »); absent: the overlay's */
  overrides?: OverlayOverrides
  view: boolean
}
/** Names of the figures of a day or stage card (their chips). */
export const DAY_CARD_FIELD_LABELS: Record<DayCardField, string> = {
  get date() { return t('light.days.field.date') },
  get distance() { return t('light.days.field.distance') },
  get ascent() { return t('light.days.field.ascent') },
  get duration() { return t('light.days.field.duration') },
  get start() { return t('light.days.field.start') },
  get weather() { return t('light.days.field.weather') },
}

/** The figures of a stage card that does not choose them: those it always showed. */
export const STAGE_CARD_FIELDS: Record<DayCardField, boolean> = { date: true, distance: true, ascent: true, duration: false, start: false, weather: false }

export const DEFAULT_DAY_CARDS: FilmDayCards = {
  enabled: false,
  durationS: 5,
  anchor: 'center',
  size: 1,
  fields: { date: true, distance: true, ascent: true, duration: false, start: false, weather: false },
  view: false,
}

export const JUNCTION_KINDS = ['coupe', 'fondu-noir', 'fondu-blanc', 'nuit'] as const
/**
 * How the film passes from a stage to the next one « À la suite » (« Passage », `FilmJunction`): 'coupe', a hard cut
 * (no time); 'fondu-noir' / 'fondu-blanc', a dip held on the film clock for `holdS` seconds (the stage card lives inside
 * it). 'nuit' is what the clock plays where a junction passes the night (`FilmJunction.night`: dusk, night, dawn of
 * `film.nights`); stored only by projects before v6 (`withNightAndRecapOnTheirOwn` makes it a fade with `night`).
 */
export type JunctionKind = (typeof JUNCTION_KINDS)[number]
/** The « Passage » a junction chooses (the night is a choice of its own). */
export const PASSAGE_KINDS = ['coupe', 'fondu-noir', 'fondu-blanc'] as const satisfies readonly JunctionKind[]
/** How long « Revoir l'étape finie » holds the high view of the stage before the passage (seconds, added to the film). */
export const RECAP_S = 4
export const JUNCTION_KIND_LABELS: Record<JunctionKind, string> = {
  get coupe() { return t('film.junctionKind.coupe') },
  get 'fondu-noir'() { return t('film.junctionKind.fondu-noir') },
  get 'fondu-blanc'() { return t('film.junctionKind.fondu-blanc') },
  get nuit() { return t('film.junctionKind.nuit') },
}
/** Time a junction is held on the clock (seconds; also its validity range in a loaded project, 0 is « Coupe »). */
export const JUNCTION_HOLD_RANGE = { min: 0.5, max: 10, step: 0.1 } as const
/** Length of a stage card (seconds; also its validity range in a loaded project) and its default. */
export const JUNCTION_CARD_RANGE = { min: 1, max: 15, step: 0.5 } as const
export const JUNCTION_CARD_DEFAULT_S = 5
/** Flight time of one stage « À la suite » set by hand (seconds; also its validity range in a loaded project). */
export const STAGE_DURATION_RANGE = { min: 5, max: 600, step: 0.1 } as const

/**
 * The card of a stage « À la suite »: shown from the middle of the junction before it (the start of the flight for the
 * first stage) until `durationS` into the stage's flight. Without `text` it shows what the stage is (name, « Étape 2 sur
 * 3 · date » and the figures of `fields`); with it, `text` and `subtitle` where `{name} {n} {count} {date} {distance}
 * {ascent}` are filled in. Placement and style as a `FilmText`. What `junctionCardOf` reads: the film stores only what a
 * card changes (`StoredStageCard`) over the common card (`JunctionDefault.cardSettings`).
 */
export interface JunctionCard {
  enabled: boolean
  durationS: number
  text?: string
  subtitle?: string
  anchor: OverlayAnchor
  size: number
  color?: string
  font?: OverlayFontId
  /** the figures of the automatic card, like a day card's; absent: `STAGE_CARD_FIELDS` (name, date, distance, D+) */
  fields?: Record<DayCardField, boolean>
}

/**
 * The junction after the stage of track `afterTrackId` (keyed by the track, so it survives a reorder). A field it does
 * not set is the default one (`Film.junctionDefault`; `junctionOf` reads them all).
 */
export interface FilmJunction {
  id: string
  afterTrackId: string
  kind?: JunctionKind
  /** seconds held on the clock: 0 for 'coupe' */
  holdS?: number
  /** « Passer la nuit »: the night between the two stages, when they are on two days */
  night?: boolean
  /** « Revoir l'étape finie »: the camera rises over the stage that ends before the passage (during the night if it passes one) */
  recap?: boolean
  /** the card of the stage that follows: what it changes over the common card */
  card?: StoredStageCard
}

/**
 * What a stage card sets of its own (« réglage propre »), the rest coming from the common card: `enabled` alone hides or
 * shows that card; an empty `text`, `subtitle`, `color` or `font` goes back to the automatic card, the overlay's colour
 * or font where the common card sets one.
 */
export type StoredStageCard = Partial<JunctionCard>

/**
 * Transition and card of the junctions without a `FilmJunction` of their own (`card`: the stage cards are shown;
 * `cardSettings`: what every card shows, where and how long, « Trace › Plusieurs traces », absent: `DEFAULT_STAGE_CARD`).
 */
export interface JunctionDefault {
  kind: JunctionKind
  holdS: number
  card: boolean
  /** « Passer la nuit » (absent: yes) and « Revoir l'étape finie » (absent: no) of the junctions that do not choose */
  night?: boolean
  recap?: boolean
  cardSettings?: Partial<Omit<JunctionCard, 'enabled'>>
}

export interface Film {
  opening: FilmShot
  closing: FilmShot
  /** stops generated at the highlights (passes, summits, records: `autoStops`; `stops` ignored) until the user edits them */
  autoStops: boolean
  /** highlights closer than this make one automatic stop (metres; absent: `AUTO_STOP_GROUP_M`), kept by older projects */
  autoStopGroupM?: number
  /** the generated stops also come at the places the track goes through: villages, huts, lakes, waterfalls, viewpoints (absent: no) */
  autoStopsPlaces?: boolean
  stops: FilmStop[]
  /** sorted by position or not, never overlapping */
  speeds: FilmSpeed[]
  /** sorted by position or not */
  cameraKeys: FilmCameraKey[]
  /** values of speed, exposure, sun hour and grading pinned along the first track (`paramKeys.ts`), sorted or not */
  paramKeys: FilmParamKey[]
  /** places where the marker changes its look, cross-faded (`markerKeys.ts`), sorted or not */
  markerKeys: FilmMarkerKey[]
  texts: FilmText[]
  media: FilmMedia[]
  /** music of the soundtrack (they may overlap: mixed) */
  audio: FilmAudio[]
  /** the music is lowered while a video clip with sound plays (« Baisser toutes les musiques sous les vidéos ») */
  duckMusic: boolean
  /** points of interest placed by hand (labels only: they change neither the flight nor its time) */
  pois: FilmPoi[]
  /** nights of a multi-day track shown as pauses; off for the films saved before it (their timing stays) */
  nights: FilmNights
  /** the cards of the days of a multi-day track (absent: none, as `DEFAULT_DAY_CARDS`) */
  dayCards?: FilmDayCards
  /** junctions between the stages « À la suite » that differ from the default (`junctionOf` reads them), by track */
  junctions?: FilmJunction[]
  /** default transition and card of the junctions (absent: `DEFAULT_JUNCTION`, or what `race.stageTransition` said) */
  junctionDefault?: JunctionDefault
  /** card of the first stage, what it changes over the common card (absent: the common card, `junctionCardOf`) */
  firstCard?: StoredStageCard
  /**
   * flight time of the stages « À la suite » whose duration is set (seconds, by track id; absent or missing: the stage's
   * share of the flyover duration, proportional to its distance, as ever); read with a sequence only (`stageSpecsOf`)
   */
  stageDurations?: Record<string, number>
}

/** Slider ranges (also the validity ranges of a loaded project), seconds. */
export const SHOT_DURATION_RANGE = { min: 0.5, max: 30, step: 0.5 } as const
export const STOP_DURATION_RANGE = { min: 0.5, max: 60, step: 0.5 } as const
export const ITEM_DURATION_RANGE = { min: 0.5, max: 600, step: 0.5 } as const
/** Length of a generated stop ('temps-forts') and of a stop added on the timeline (seconds). */
export const AUTO_STOP_S = 4

export const DEFAULT_FILM: Film = {
  opening: { style: 'descente', durationS: 6 },
  closing: { style: 'descente', durationS: 5 },
  autoStops: true,
  stops: [],
  speeds: [],
  cameraKeys: [],
  paramKeys: [],
  markerKeys: [],
  texts: [],
  media: [],
  audio: [],
  duckMusic: false,
  pois: [],
  nights: DEFAULT_NIGHTS,
}

/**
 * Time in the file of a video shown at film time `timeS`: its start in the file (`inS`) plus the time since the
 * clip appeared, held at its end in the file (`outS`; past the end of the file, its last frame is held). A synced
 * clip following the flight (`sync.follow`) shows instead what it recorded at `recordedMs`, the recorded instant
 * under the marker at that film time (ms since epoch; without it, as an unsynced clip), within `inS` and `outS`.
 */
export function clipTimeS(media: Pick<FilmMedia, 'startS' | 'inS' | 'outS' | 'sync'>, timeS: number, recordedMs?: number): number {
  const follows = media.sync?.follow && recordedMs !== undefined && Number.isFinite(recordedMs)
  const t = follows
    ? Math.max(media.inS ?? 0, (recordedMs - media.sync!.startMs) / 1000 - media.sync!.offsetS)
    : (media.inS ?? 0) + Math.max(0, timeS - media.startS)
  return media.outS === undefined ? t : Math.min(t, media.outS)
}

/**
 * The clip is heard in the film: a video not muted, at a volume above 0, not following the flight (its time in the
 * file then runs at the pace of the marker: resampled, its sound would be ugly, so it stays silent, in the preview
 * as in the export). A clip without `muted` was saved before the sound was handled: silent.
 */
export function clipHasSound(media: Pick<FilmMedia, 'kind' | 'muted' | 'volume' | 'sync'>): boolean {
  return media.kind === 'video' && media.muted === false && (media.volume ?? 1) > 0 && !media.sync?.follow
}

/** Film time taken by an opening or closing shot. */
export function shotDurationS(shot: FilmShot): number {
  return shot.style === 'aucune' ? 0 : shot.durationS
}

/** The shot cuts to or from the flight ('coupe' and the dips) instead of moving into it. */
export function shotCuts(shot: FilmShot): boolean {
  return (shot.transition ?? 'enchaine') !== 'enchaine'
}

/** Colour of the dip of a shot, null without one (no dip transition, or no shot). */
export function shotDipColor(shot: FilmShot): 'black' | 'white' | null {
  if (shotDurationS(shot) === 0) return null
  return shot.transition === 'fondu-noir' ? 'black' : shot.transition === 'fondu-blanc' ? 'white' : null
}

/** Full-frame colour layer over the image at a film time. */
export interface TransitionDip {
  color: 'black' | 'white'
  /** 0 (clear) to 1 (the whole frame of that colour) */
  alpha: number
}

/** Opacity of a dip `lengthS` long centred on `cutS`, at `timeS`: 0 outside, up to 1 at the cut by smootherstep, symmetric. */
export function dipAlpha(timeS: number, cutS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  return smootherstep(1 - Math.abs(timeS - cutS) / (lengthS / 2))
}

/**
 * Dip of the image at film time `time.timeS`, null when none: the opening's centred on the start of the flight
 * (`openingS`), the closing's on its end; the stronger one where they meet (a very short flight). A pure function of
 * the film time, drawn by the overlay in the preview and the export alike.
 */
export function transitionDipAt(
  film: Pick<Film, 'opening' | 'closing'>,
  time: { timeS: number; openingS: number; flightS: number },
): TransitionDip | null {
  let dip: TransitionDip | null = null
  const cuts: [FilmShot, number][] = [
    [film.opening, time.openingS],
    [film.closing, time.openingS + time.flightS],
  ]
  for (const [shot, cutS] of cuts) {
    const color = shotDipColor(shot)
    const alpha = color ? dipAlpha(time.timeS, cutS, shot.dipS ?? DIP_DEFAULT_S) : 0
    if (color && alpha > (dip?.alpha ?? 0)) dip = { color, alpha }
  }
  return dip
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export type FilmItemKind = 'stop' | 'speed' | 'camera' | 'param' | 'marker' | 'text' | 'media' | 'music' | 'poi'

/** Next free id `<kind>-<n>` of the film (one more than the highest number used by that kind). */
export function nextFilmId(film: Film, kind: FilmItemKind): string {
  const lanes = {
    stop: film.stops,
    speed: film.speeds,
    camera: film.cameraKeys,
    param: film.paramKeys,
    marker: film.markerKeys,
    text: film.texts,
    media: film.media,
    music: film.audio,
    poi: film.pois,
  }
  const items: readonly { id: string }[] = lanes[kind]
  const pattern = new RegExp(`^${kind}-(\\d+)$`)
  let max = 0
  for (const { id } of items) {
    const match = pattern.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${kind}-${max + 1}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const within = (v: unknown, min: number, max: number) => typeof v === 'number' && v >= min && v <= max
const optionalString = (v: unknown) => v === undefined || typeof v === 'string'
const isId = (v: unknown) => typeof v === 'string' && v !== ''
const optionalId = (v: unknown) => v === undefined || isId(v)

export function isValidShot(shot: unknown): shot is FilmShot {
  return (
    isRecord(shot) &&
    oneOf(SHOT_STYLES, shot.style) &&
    within(shot.durationS, SHOT_DURATION_RANGE.min, SHOT_DURATION_RANGE.max) &&
    (shot.transition === undefined || oneOf(SHOT_TRANSITIONS, shot.transition)) &&
    (shot.dipS === undefined || within(shot.dipS, DIP_DURATION_RANGE.min, DIP_DURATION_RANGE.max)) &&
    (shot.startHeight === undefined || oneOf(START_HEIGHTS, shot.startHeight)) &&
    (shot.highlight === undefined || typeof shot.highlight === 'boolean') &&
    (shot.regionId === undefined || isRegionId(shot.regionId)) &&
    (shot.holdS === undefined || within(shot.holdS, SITUATION_HOLD_RANGE.min, SITUATION_HOLD_RANGE.max)) &&
    (shot.tiltDeg === undefined || within(shot.tiltDeg, SITUATION_TILT_RANGE.min, SITUATION_TILT_RANGE.max)) &&
    (shot.distanceKm === undefined || within(shot.distanceKm, SITUATION_DISTANCE_KM_RANGE.min, SITUATION_DISTANCE_KM_RANGE.max)) &&
    (shot.heading === undefined || oneOf(SITUATION_HEADINGS, shot.heading)) &&
    (shot.bearingDeg === undefined || within(shot.bearingDeg, SITUATION_BEARING_RANGE.min, SITUATION_BEARING_RANGE.max)) &&
    (shot.headroomPct === undefined || within(shot.headroomPct, SITUATION_HEADROOM_RANGE.min, SITUATION_HEADROOM_RANGE.max)) &&
    (shot.moveSun === undefined || typeof shot.moveSun === 'boolean') &&
    (shot.sun === undefined || oneOf(SHOT_SUNS, shot.sun)) &&
    (shot.sunHours === undefined || within(shot.sunHours, SHOT_SUN_HOURS_RANGE.min, SHOT_SUN_HOURS_RANGE.max))
  )
}

export function isValidStop(stop: unknown): stop is FilmStop {
  if (!isRecord(stop)) return false
  const source = stop.source
  return (
    isId(stop.id) &&
    within(stop.atM, 0, Number.MAX_VALUE) &&
    within(stop.durationS, STOP_DURATION_RANGE.min, STOP_DURATION_RANGE.max) &&
    oneOf(STOP_CAMERAS, stop.camera) &&
    optionalString(stop.label) &&
    (source === undefined || (isRecord(source) && oneOf(STOP_SOURCES, source.kind) && optionalString(source.ref)))
  )
}

export function isValidSpeed(speed: unknown): speed is FilmSpeed {
  return (
    isRecord(speed) &&
    isId(speed.id) &&
    within(speed.fromM, 0, Number.MAX_VALUE) &&
    within(speed.toM, 0, Number.MAX_VALUE) &&
    (speed.toM as number) > (speed.fromM as number) &&
    within(speed.factor, SPEED_FACTOR_RANGE.min, SPEED_FACTOR_RANGE.max)
  )
}

export function isValidPoi(poi: unknown): poi is FilmPoi {
  return (
    isRecord(poi) &&
    isId(poi.id) &&
    within(poi.lon, -180, 180) &&
    within(poi.lat, -90, 90) &&
    typeof poi.name === 'string' &&
    (poi.icon === undefined || oneOf(POI_ICONS, poi.icon))
  )
}

export function isValidCameraKey(key: unknown): key is FilmCameraKey {
  if (!isRecord(key)) return false
  const { distance, pitchDeg, aimM } = CAMERA_KEY_RANGES
  const { headingOffsetDeg } = CAMERA_RANGES
  return (
    isId(key.id) &&
    within(key.atM, 0, Number.MAX_VALUE) &&
    within(key.distance, distance.min, distance.max) &&
    within(key.pitchDeg, pitchDeg.min, pitchDeg.max) &&
    within(key.headingOffsetDeg, headingOffsetDeg.min, headingOffsetDeg.max) &&
    (key.aimRightM === undefined || within(key.aimRightM, aimM.min, aimM.max)) &&
    (key.aimAheadM === undefined || within(key.aimAheadM, aimM.min, aimM.max))
  )
}

export function isValidParamKey(key: unknown): key is FilmParamKey {
  if (!isRecord(key) || !oneOf(FILM_PARAMS, key.param)) return false
  const { min, max } = PARAM_SPECS[key.param as FilmParam]
  return isId(key.id) && within(key.atM, 0, Number.MAX_VALUE) && within(key.value, min, max)
}

export function isValidMarkerKey(key: unknown): key is FilmMarkerKey {
  return isRecord(key) && isId(key.id) && within(key.atM, 0, Number.MAX_VALUE) && isValidMarkerLook(key)
}

/** No two portions overlap (they may touch). */
function apart(speeds: readonly FilmSpeed[]): boolean {
  const sorted = [...speeds].sort((a, b) => a.fromM - b.fromM)
  return sorted.every((s, i) => i === 0 || sorted[i - 1].toM <= s.fromM)
}

/** Shared by texts and media: id, start in film time, duration. */
function isValidTimed(item: Record<string, unknown>): boolean {
  return isId(item.id) && within(item.startS, 0, Number.MAX_VALUE) && within(item.durationS, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max)
}

export function isValidText(text: unknown): text is FilmText {
  return (
    isRecord(text) &&
    isValidTimed(text) &&
    typeof text.text === 'string' &&
    optionalString(text.subtitle) &&
    oneOf(OVERLAY_ANCHORS, text.anchor) &&
    within(text.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) &&
    (text.color === undefined || isHexColor(text.color)) &&
    (text.font === undefined || oneOf(OVERLAY_FONT_IDS, text.font)) &&
    optionalId(text.stopId)
  )
}

export function isValidMedia(media: unknown): media is FilmMedia {
  if (!isRecord(media)) return false
  const inS = media.inS ?? 0
  return (
    isValidTimed(media) &&
    oneOf(MEDIA_KINDS, media.kind) &&
    isId(media.src) &&
    oneOf(MEDIA_LAYOUTS, media.layout) &&
    oneOf(OVERLAY_ANCHORS, media.anchor) &&
    within(media.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) &&
    typeof media.kenBurns === 'boolean' &&
    optionalString(media.caption) &&
    within(inS, 0, Number.MAX_VALUE) &&
    (media.outS === undefined || within(media.outS, (inS as number) + 0.01, Number.MAX_VALUE)) &&
    (media.muted === undefined || typeof media.muted === 'boolean') &&
    (media.volume === undefined || within(media.volume, 0, 1)) &&
    (media.sync === undefined || isValidSync(media.sync)) &&
    optionalId(media.stopId)
  )
}

function isValidSync(sync: unknown): sync is MediaSync {
  return (
    isRecord(sync) &&
    typeof sync.startMs === 'number' &&
    Number.isFinite(sync.startMs) &&
    within(sync.offsetS, SYNC_OFFSET_RANGE.min, SYNC_OFFSET_RANGE.max) &&
    typeof sync.follow === 'boolean'
  )
}

export function isValidAudio(audio: unknown): audio is FilmAudio {
  return (
    isRecord(audio) &&
    isId(audio.id) &&
    isId(audio.src) &&
    within(audio.startS, 0, Number.MAX_VALUE) &&
    within(audio.durationS, AUDIO_DURATION_RANGE.min, AUDIO_DURATION_RANGE.max) &&
    within(audio.inS, 0, Number.MAX_VALUE) &&
    within(audio.volume, 0, 1) &&
    within(audio.fadeInS, FADE_RANGE.min, FADE_RANGE.max) &&
    within(audio.fadeOutS, FADE_RANGE.min, FADE_RANGE.max)
  )
}

const isDayCardFields = (fields: unknown) =>
  isRecord(fields) && DAY_CARD_FIELDS.every((field) => typeof (fields as Record<string, unknown>)[field] === 'boolean')

export function isValidDayCards(cards: unknown): cards is FilmDayCards {
  return (
    isRecord(cards) &&
    typeof cards.enabled === 'boolean' &&
    within(cards.durationS, DAY_CARD_DURATION_RANGE.min, DAY_CARD_DURATION_RANGE.max) &&
    oneOf(OVERLAY_ANCHORS, cards.anchor) &&
    within(cards.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) &&
    isDayCardFields(cards.fields) &&
    optionalString(cards.title) &&
    isValidOverrides(cards.overrides) &&
    typeof cards.view === 'boolean'
  )
}

export function isValidNights(nights: FilmNights): boolean {
  const part = (v: unknown) => within(v, NIGHT_PART_RANGE.min, NIGHT_PART_RANGE.max)
  return (
    typeof nights.enabled === 'boolean' &&
    part(nights.duskS) &&
    part(nights.nightS) &&
    part(nights.dawnS) &&
    (nights.skipped === undefined || (Array.isArray(nights.skipped) && nights.skipped.every((k) => typeof k === 'string')))
  )
}

/** A stored stage card or the common card's settings: each field it sets is valid (an empty colour or font: the overlay's). */
export function isValidJunctionCard(card: unknown): card is StoredStageCard {
  return (
    isRecord(card) &&
    (card.enabled === undefined || typeof card.enabled === 'boolean') &&
    (card.durationS === undefined || within(card.durationS, JUNCTION_CARD_RANGE.min, JUNCTION_CARD_RANGE.max)) &&
    optionalString(card.text) &&
    optionalString(card.subtitle) &&
    (card.anchor === undefined || oneOf(OVERLAY_ANCHORS, card.anchor)) &&
    (card.size === undefined || within(card.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX)) &&
    (card.color === undefined || card.color === '' || isHexColor(card.color)) &&
    (card.font === undefined || card.font === '' || oneOf(OVERLAY_FONT_IDS, card.font)) &&
    (card.fields === undefined || isDayCardFields(card.fields))
  )
}

export function isValidJunction(junction: unknown): junction is FilmJunction {
  return (
    isRecord(junction) &&
    isId(junction.id) &&
    isId(junction.afterTrackId) &&
    (junction.kind === undefined || oneOf(JUNCTION_KINDS, junction.kind)) &&
    (junction.holdS === undefined || junction.holdS === 0 || within(junction.holdS, JUNCTION_HOLD_RANGE.min, JUNCTION_HOLD_RANGE.max)) &&
    (junction.night === undefined || typeof junction.night === 'boolean') &&
    (junction.recap === undefined || typeof junction.recap === 'boolean') &&
    (junction.card === undefined || isValidJunctionCard(junction.card))
  )
}

function isValidJunctionDefault(d: unknown): d is JunctionDefault {
  return (
    isRecord(d) &&
    oneOf(JUNCTION_KINDS, d.kind) &&
    (d.holdS === 0 || within(d.holdS, JUNCTION_HOLD_RANGE.min, JUNCTION_HOLD_RANGE.max)) &&
    typeof d.card === 'boolean' &&
    (d.night === undefined || typeof d.night === 'boolean') &&
    (d.recap === undefined || typeof d.recap === 'boolean') &&
    (d.cardSettings === undefined || (isValidJunctionCard(d.cardSettings) && !('enabled' in d.cardSettings)))
  )
}

/** The optional junction and stage fields, when present: valid, one junction per track. */
function hasValidJunctions(film: Film): boolean {
  if (film.junctions !== undefined) {
    if (!Array.isArray(film.junctions) || !film.junctions.every(isValidJunction)) return false
    if (new Set(film.junctions.map((j) => j.afterTrackId)).size !== film.junctions.length) return false
  }
  return (
    (film.junctionDefault === undefined || isValidJunctionDefault(film.junctionDefault)) &&
    (film.firstCard === undefined || isValidJunctionCard(film.firstCard)) &&
    (film.stageDurations === undefined ||
      (isRecord(film.stageDurations) && Object.entries(film.stageDurations).every(([id, s]) => isId(id) && within(s, STAGE_DURATION_RANGE.min, STAGE_DURATION_RANGE.max))))
  )
}

/**
 * Value checks of a film whose top-level shape already matches `DEFAULT_FILM` (see `SETTING_CHECKS` in the
 * project document): shots, every item of every lane, speed portions apart, ids unique across the film.
 */
export function isValidFilm(film: Film): boolean {
  if (!isValidShot(film.opening) || !isValidShot(film.closing) || typeof film.autoStops !== 'boolean') return false
  if (film.dayCards !== undefined && !isValidDayCards(film.dayCards)) return false
  if (typeof film.duckMusic !== 'boolean') return false
  if (film.autoStopGroupM !== undefined && !within(film.autoStopGroupM, 100, 10_000)) return false
  if (film.autoStopsPlaces !== undefined && typeof film.autoStopsPlaces !== 'boolean') return false
  if (!film.stops.every(isValidStop) || !film.texts.every(isValidText) || !film.media.every(isValidMedia)) return false
  if (!film.speeds.every(isValidSpeed) || !apart(film.speeds) || !film.audio.every(isValidAudio)) return false
  if (!film.cameraKeys.every(isValidCameraKey) || !film.pois.every(isValidPoi) || !isValidNights(film.nights)) return false
  if (!film.paramKeys.every(isValidParamKey) || !film.markerKeys.every(isValidMarkerKey)) return false
  if (!hasValidJunctions(film)) return false
  const ids = [...film.stops, ...film.speeds, ...film.cameraKeys, ...film.paramKeys, ...film.markerKeys, ...film.texts, ...film.media, ...film.audio, ...film.pois].map((item) => item.id)
  return new Set(ids).size === ids.length
}

/**
 * Fill-in of a film saved before a field existed (`SETTING_UPGRADES`): missing fields from `DEFAULT_FILM`. Films saved before
 * music, camera keys, parameter, marker keys, points of interest or nights get none of them, and old video clips stay silent
 * (`muted: true`), so they look and sound as saved. The `epochs` key of earlier versions, the `landmarkTitles` flag
 * (« Ralentir et titrer aux repères », removed) and the `autoMode` of projects up to v6 (`MIGRATIONS[6]`) are dropped:
 * the slow-downs and titles that option had written stay in `speeds` and `texts` as ordinary items. A text or a
 * medium attached to a stop the film does not own (generated stops, unknown id) is loaded free.
 */
export function withFilmDefaults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const { epochs: _epochs, landmarkTitles: _landmarkTitles, autoMode: _autoMode, ...saved } = raw
  const film: Record<string, unknown> = {
    ...DEFAULT_FILM,
    nights: { ...DEFAULT_NIGHTS, enabled: false },
    ...saved,
  }
  const own = film.autoStops === false && Array.isArray(film.stops) ? film.stops.filter(isRecord).map((s) => s.id) : []
  const attached = (item: unknown) => {
    if (!isRecord(item) || !('stopId' in item) || own.includes(item.stopId)) return item
    const { stopId: _, ...free } = item
    return free
  }
  if (Array.isArray(film.texts)) film.texts = film.texts.map(attached)
  if (Array.isArray(film.media)) film.media = film.media.map((m: unknown) => attached(withMediaDefaults(m)))
  return film
}

function withMediaDefaults(media: unknown): unknown {
  if (!isRecord(media)) return media
  const silent = media.kind === 'video' && media.muted === undefined ? { muted: true } : {}
  return { ...MEDIA_DEFAULTS, ...media, ...silent }
}
