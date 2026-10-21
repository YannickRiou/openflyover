/**
 * Project document: one self-contained, versioned JSON file holding every setting, the tracks and the pictures of the
 * film (media table, `film/media.ts`). Pure functions: `serializeProject` / `parseProject`, settings sanitising and the
 * version migration chain. Applying a parsed project to the store lives in `apply.ts`.
 *
 * Settings are handled generically over the keys of `DEFAULT_SETTINGS`: a new setting is saved, validated (against the
 * type of its default) and restored without touching this file. Add an entry to `SETTING_CHECKS` only when a value of
 * the right type can still be invalid (enum, catalogue id, range).
 */
import { isRecord } from '../core/guards'
import type { Flight, StatsOverride, Track, TrackPoint, TrackSegment, Waypoint } from '../core/types'
import { sanitizeMediaTable, usedMedia } from '../film/media'
import type { MediaAsset, MediaTable } from '../film/media'
import { DEFAULT_JUNCTION, withStageSettingsMigrated } from '../film/junctions'
import { isValidFilm, withFilmDefaults } from '../film/model'
import { FLYOVER_DURATION_RANGE, isValidCamera, withCameraDefaults } from '../flyover/cameraSettings'
import { isValidPacing, withPacingDefaults } from '../flyover/pacing'
import { isValidRace } from '../flyover/race'
import { isSunDate } from '../flyover/sun'
import { TRACK_COLORS } from '../import'
import { buildTrack, isUtcOffsetMin, statsOverrideOf } from '../import/stats'
import { isValidVideoSettings, withVideoDefaults } from '../export/schedule'
import { LANDMARK_DENSITIES, LANDMARK_DISTANCE_RANGE, withLandmarkDefaults } from '../osm/landmarks'
import { OVERLAY_ANCHORS, isValidOverlay, withKnownStyle, withOverlayDefaults } from '../overlay/settings'
import { isValidPoster, withPosterDefaults } from '../poster/settings'
import { isValidGrading } from '../scene/grading'
import { isValidLens, withLensDefaults } from '../scene/lens'
import { isValidLabelSettings, withLabelDefaults } from '../scene/labelModel'
import { TRACK_COLOR_MODES } from '../flyover/trackColor'
import { isValidMarker, isValidTrackStyle, isValidTrackTail, withMarkerDefaults, withTrackStyleDefaults } from '../scene/markerSettings'
import { DEFAULT_PLAYBACK, DEFAULT_SETTINGS, PLAYBACK_SPEEDS } from '../state/store'
import type { AppState, Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { isImageryDate } from '../terrain/imageryDates'
import { isValidClouds, withCloudDefaults } from '../weather/sceneClouds'
import { PROJECT_EXTENSION } from './file'
import { t } from '../i18n'

export const PROJECT_FORMAT = 'openflyover-project'
export const PROJECT_VERSION = 3
/** Suffix of saved project files (`<name>.opnflvr`, see `file.ts`). */
export const PROJECT_FILE_SUFFIX = `.${PROJECT_EXTENSION}`
export const defaultProjectName = (): string => t('project.doc.defaultName')

/** Optional per-point values, stored as columns (null where a point has no value). */
const OPTIONAL_FIELDS = ['ele', 'time', 'hr', 'cad', 'power', 'temp'] as const
type OptionalField = (typeof OPTIONAL_FIELDS)[number]

/** Decimal places kept per column: 1e-7° ≈ 1 cm, centimetres for elevations, whole milliseconds. */
const DECIMALS: Record<'lon' | 'lat' | OptionalField, number> = {
  lon: 7,
  lat: 7,
  ele: 2,
  time: 0,
  hr: 2,
  cad: 2,
  power: 2,
  temp: 2,
}

/** One track segment, column-oriented (`lon[i]`, `lat[i]`, `ele[i]`… describe point i). */
export type ProjectSegment = { lon: number[]; lat: number[] } & Partial<Record<OptionalField, (number | null)[]>>

/** A track as stored in the file: stats and bounds are recomputed on load. */
export interface ProjectTrack {
  id: string
  name: string
  source: Track['source']
  activityType?: string
  color: string
  segments: ProjectSegment[]
  /** GPX waypoints (`Track.waypoints`), omitted when the track has none */
  waypoints?: Waypoint[]
  /** `Track.utcOffsetMin`, omitted when unknown */
  utcOffsetMin?: number
  /** `Track.timesEstimated`, omitted for recorded or untimed tracks */
  timesEstimated?: true
  /** `Track.elevationEstimated`, omitted for recorded elevations */
  elevationEstimated?: 'all' | 'gaps'
  /** `Track.flights`, omitted when the track stays on the ground */
  flights?: Flight[]
  /** `Track.statsOverride`, omitted when no figure is corrected */
  statsOverride?: StatsOverride
}

export interface ProjectDocument {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  name: string
  settings: Settings
  playback: { speed: number }
  tracks: ProjectTrack[]
  /** pictures, clips and sound files of the film by id (`film.media[].src`, `film.audio[].src`), omitted when it has none */
  media?: MediaTable
}

/** A parsed and validated project, ready to be applied to the store. */
export interface LoadedProject {
  name: string
  settings: Settings
  speed: number
  tracks: Track[]
  /** photos, clips and music of the film (empty when it has none) */
  media: MediaTable
  /** non-fatal problems (settings replaced by their default value), in French */
  warnings: string[]
}

export type ProjectSource = Pick<AppState, 'tracks' | 'settings' | 'playback'>

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Extra checks for settings whose type alone does not make them valid. */
export const SETTING_CHECKS: { [K in keyof Settings]?: (value: Settings[K]) => boolean } = {
  terrainSourceId: (id) => TERRAIN_SOURCES.some((s) => s.id === id),
  imagerySourceId: (id) => IMAGERY_SOURCES.some((s) => s.id === id),
  imageryDate: isImageryDate,
  imageryZoomOffset: (v) => v === 0 || v === 1 || v === 2,
  exaggeration: (v) => v > 0,
  sunHour: (v) => v >= 0 && v <= 24,
  sunDate: isSunDate,
  camera: isValidCamera,
  flyoverDurationS: (v) => v >= FLYOVER_DURATION_RANGE.min && v <= FLYOVER_DURATION_RANGE.max,
  pacing: isValidPacing,
  film: isValidFilm,
  exposureEv: (v) => v >= -4 && v <= 4,
  grading: isValidGrading,
  lens: isValidLens,
  weatherScene: (v) => v.strength >= 0 && v.strength <= 1,
  clouds: isValidClouds,
  water: (v) => v.strength >= 0 && v.strength <= 1,
  trackColorBy: (v) => (TRACK_COLOR_MODES as readonly string[]).includes(v),
  trackLegendAnchor: (v) => (OVERLAY_ANCHORS as readonly string[]).includes(v),
  overlay: isValidOverlay,
  video: isValidVideoSettings,
  poster: isValidPoster,
  landmarks: (v) =>
    v.maxDistanceM >= LANDMARK_DISTANCE_RANGE.min &&
    v.maxDistanceM <= LANDMARK_DISTANCE_RANGE.max &&
    (LANDMARK_DENSITIES as readonly string[]).includes(v.density) &&
    v.hiddenIds.every((id) => typeof id === 'string') &&
    v.pinnedIds.every((id) => typeof id === 'string'),
  race: isValidRace,
  trackStyle: isValidTrackStyle,
  trackTail: isValidTrackTail,
  marker: isValidMarker,
  labels: isValidLabelSettings,
}

/** Imagery sources taken out of the catalogue, and the source a saved project that used one opens with. */
const REMOVED_IMAGERY_SOURCES: Readonly<Record<string, string>> = {
  'eox-s2cloudless': 'arcgis-world-imagery',
  'ign-ortho-2000-2005': 'ign-ortho',
  'ign-ortho-1965-1980': 'ign-ortho',
  'ign-ortho-1950-1965': 'ign-ortho',
}

/**
 * Fill-ins for settings whose shape grew after projects were saved, applied to the raw value before it is
 * validated (e.g. overlay widgets added since: older projects and presets keep loading).
 */
export const SETTING_UPGRADES: { [K in keyof Settings]?: (raw: unknown) => unknown } = {
  // a removed imagery source opens in its successor: Sentinel-2 (EOX) in Esri World Imagery, the historical IGN photos in IGN BD ORTHO
  imagerySourceId: (raw) => (typeof raw === 'string' ? (REMOVED_IMAGERY_SOURCES[raw] ?? raw) : raw),
  camera: withCameraDefaults,
  // a style id that was dropped (never released) opens in its successor, in the overlay and on the poster
  overlay: (raw) => withOverlayDefaults(withKnownStyle(raw)),
  video: withVideoDefaults,
  film: withFilmDefaults,
  trackStyle: withTrackStyleDefaults,
  marker: withMarkerDefaults,
  poster: (raw) => withPosterDefaults(withKnownStyle(raw)),
  labels: withLabelDefaults,
  pacing: withPacingDefaults,
  landmarks: withLandmarkDefaults,
  clouds: withCloudDefaults,
  lens: withLensDefaults,
}


/** True when `value` has the JSON shape of `reference` (finite numbers, same keys for objects). */
function sameShape(value: unknown, reference: unknown): boolean {
  if (typeof reference === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (reference === null || typeof reference !== 'object') return typeof value === typeof reference
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(reference)) {
    return Array.isArray(value) && (reference.length === 0 || value.every((v) => sameShape(v, reference[0])))
  }
  if (Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.entries(reference).every(([k, ref]) => sameShape(record[k], ref))
}

export function isValidSetting<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  if (!sameShape(value, DEFAULT_SETTINGS[key])) return false
  const check = SETTING_CHECKS[key] as ((v: Settings[K]) => boolean) | undefined
  return check ? check(value as Settings[K]) : true
}

/**
 * Every key of `DEFAULT_SETTINGS` taken from `raw` when valid, else from `base`.
 * Unknown keys are ignored; `invalid` lists the keys present in `raw` but rejected.
 */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): { settings: Settings; invalid: string[] } {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {}
  const settings = { ...base }
  const invalid: string[] = []
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in record)) continue
    const upgrade = SETTING_UPGRADES[key]
    const value = upgrade ? upgrade(record[key]) : record[key]
    if (isValidSetting(key, value)) (settings as Record<string, unknown>)[key] = value
    else invalid.push(key)
  }
  // the transition and cards « À la suite » moved from `race` to the film's junction default
  return { settings: withStageSettingsMigrated(settings), invalid }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

function encodeSegment(segment: TrackSegment): ProjectSegment {
  const points = segment.points
  const out: ProjectSegment = {
    lon: points.map((p) => round(p.lon, DECIMALS.lon)),
    lat: points.map((p) => round(p.lat, DECIMALS.lat)),
  }
  for (const field of OPTIONAL_FIELDS) {
    if (!points.some((p) => p[field] !== undefined)) continue
    out[field] = points.map((p) => {
      const v = p[field]
      return v === undefined || !Number.isFinite(v) ? null : round(v, DECIMALS[field])
    })
  }
  return out
}

function encodeWaypoint(w: Waypoint): Waypoint {
  const out: Waypoint = { lon: round(w.lon, DECIMALS.lon), lat: round(w.lat, DECIMALS.lat), name: w.name }
  if (w.ele !== undefined && Number.isFinite(w.ele)) out.ele = round(w.ele, DECIMALS.ele)
  return out
}

export function toProjectDocument(state: ProjectSource, name: string, media: MediaTable = {}): ProjectDocument {
  const pictures = usedMedia(state.settings.film, media)
  const doc: ProjectDocument = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: name.trim() || defaultProjectName(),
    settings: { ...state.settings },
    playback: { speed: state.playback.speed },
    tracks: state.tracks.map((track) => {
      const segments = track.segments.map(encodeSegment)
      const out: ProjectTrack = { id: track.id, name: track.name, source: track.source, color: track.color, segments }
      if (track.activityType) out.activityType = track.activityType
      if (track.waypoints?.length) out.waypoints = track.waypoints.map(encodeWaypoint)
      if (track.utcOffsetMin !== undefined) out.utcOffsetMin = track.utcOffsetMin
      if (track.timesEstimated) out.timesEstimated = true
      if (track.elevationEstimated) out.elevationEstimated = track.elevationEstimated
      if (track.flights?.length) out.flights = track.flights
      if (track.statsOverride) out.statsOverride = track.statsOverride
      return out
    }),
  }
  if (Object.keys(pictures).length > 0) doc.media = pictures
  return doc
}

/**
 * The document as pieces to join: header and settings indented, one line per track, then one line per picture, `asset`
 * giving the piece of each picture (its JSON, or a stored copy of it).
 */
function projectPieces<P extends string | Blob>(state: ProjectSource, name: string, media: MediaTable, asset: (a: MediaAsset) => P): (string | P)[] {
  const { tracks, media: pictures, ...head } = toProjectDocument(state, name, media)
  const headJson = JSON.stringify(head, null, 2)
  const tracksJson = tracks.length === 0 ? '[]' : `[\n${tracks.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]`
  const entries = Object.entries(pictures ?? {})
  // headJson ends with "\n}"
  const start = `${headJson.slice(0, -2)},\n  "tracks": ${tracksJson}`
  if (entries.length === 0) return [`${start}\n}\n`]
  const lines = entries.flatMap(([id, a], i) => [`${i === 0 ? '' : ',\n'}    ${JSON.stringify(id)}: `, asset(a)])
  return [`${start},\n  "media": {\n`, ...lines, '\n  }\n}\n']
}

/** JSON text of the project. */
export function serializeProject(state: ProjectSource, name: string, media: MediaTable = {}): string {
  return projectPieces(state, name, media, (a) => JSON.stringify(a)).join('')
}

/** JSON of each picture, clip and sound as bytes, made once (a table entry is replaced, never changed). */
const assetBlobs = new WeakMap<MediaAsset, Blob>()

/**
 * Same document as `serializeProject`, as a Blob that reuses the stored bytes of each medium: a clip of tens of MB is
 * neither re-serialised nor copied by each autosave, and the Blob needs no JS string, UTF-8 copy or `Response` copy.
 */
export function serializeProjectBlob(state: ProjectSource, name: string, media: MediaTable = {}): Blob {
  return new Blob(
    projectPieces(state, name, media, (a) => {
      let blob = assetBlobs.get(a)
      if (!blob) assetBlobs.set(a, (blob = new Blob([JSON.stringify(a)])))
      return blob
    }),
    { type: 'application/json' },
  )
}

/** File name for a project: characters forbidden by common file systems replaced by "-". */
export function projectFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()
    .replace(/^\.+/, '')
  return `${safe || 'projet'}${PROJECT_FILE_SUFFIX}`
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export type ProjectMigration = (doc: Record<string, unknown>) => Record<string, unknown>

/** `MIGRATIONS[n]` upgrades a document from version n to n + 1. */
export const MIGRATIONS: Readonly<Record<number, ProjectMigration>> = {
  // v2: the film's automatic stops no longer need the pacing; a v1 project without a film keeps the stops of its
  // pacing (`withFilmDefaults` completes the film from the defaults)
  1: (doc) => (isRecord(doc.settings) && !('film' in doc.settings) ? { ...doc, settings: { ...doc.settings, film: { autoMode: 'rythme' } } } : doc),
  // v3: a junction left to the default no longer turns into a night by itself; the default says it (`junctionPlan`)
  2: withExplicitNightJunctions,
}

/**
 * Before v3, with « Montrer les nuits » on, a junction left to the default passed the night at its cut whatever the
 * default said. The default is written so the film stays the same: « Nuit » for a fade to black (a « Nuit » without a
 * night is that fade), a fade to black with the nights off (the default is now « Nuit »). The default a project saved
 * before the junctions kept in `race` is read the way `withStageSettingsMigrated` reads it.
 */
function withExplicitNightJunctions(doc: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(doc.settings)) return doc
  const settings = doc.settings
  const film = isRecord(settings.film) ? settings.film : {}
  const race = isRecord(settings.race) ? settings.race : {}
  const nightsOn = isRecord(film.nights) && film.nights.enabled === true
  const fromRace = race.stageTransition !== undefined || race.stageCards !== undefined
  const kind = typeof race.stageTransition === 'string' ? race.stageTransition : 'fondu-noir'
  const saved = isRecord(film.junctionDefault)
    ? film.junctionDefault
    : { kind, holdS: kind === 'coupe' ? 0 : DEFAULT_JUNCTION.holdS, card: fromRace ? race.stageCards !== false : DEFAULT_JUNCTION.card }
  const junctionDefault = nightsOn && saved.kind === 'fondu-noir' ? { ...saved, kind: 'nuit' } : saved
  if (!fromRace && !isRecord(film.junctionDefault) && junctionDefault.kind === DEFAULT_JUNCTION.kind) return doc
  return { ...doc, settings: { ...settings, film: { ...film, junctionDefault } } }
}

/** Run the migrations from `doc.version` up to `target`; the returned document has `version: target`. */
export function migrateProject(
  doc: Record<string, unknown>,
  migrations: Readonly<Record<number, ProjectMigration>> = MIGRATIONS,
  target: number = PROJECT_VERSION,
): Record<string, unknown> {
  const version = doc.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(t('project.doc.versionInvalid'))
  }
  if (version > target) {
    throw new Error(t('project.doc.versionNewer', { version, target }))
  }
  let current = doc
  for (let v = version; v < target; v++) {
    const migrate = migrations[v]
    if (!migrate) throw new Error(t('project.doc.migrateFailed', { from: v, to: v + 1 }))
    current = { ...migrate(current), version: v + 1 }
  }
  return current
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function decodeSegment(raw: unknown, where: string): TrackSegment {
  if (!isRecord(raw)) throw new Error(t('project.doc.segmentInvalid', { where }))
  const { lon, lat } = raw
  if (!Array.isArray(lon) || !Array.isArray(lat) || lon.length !== lat.length) {
    throw new Error(t('project.doc.columnsMissing', { where }))
  }
  const points: TrackPoint[] = []
  for (let i = 0; i < lon.length; i++) {
    const x = lon[i]
    const y = lat[i]
    if (typeof x !== 'number' || typeof y !== 'number' || !(Math.abs(x) <= 180) || !(Math.abs(y) <= 90)) {
      throw new Error(t('project.doc.pointInvalid', { where, n: i + 1 }))
    }
    points.push({ lon: x, lat: y })
  }
  for (const field of OPTIONAL_FIELDS) {
    const column = raw[field]
    if (column === undefined) continue
    if (!Array.isArray(column) || column.length !== points.length) {
      throw new Error(t('project.doc.columnInvalid', { where, field, count: points.length }))
    }
    column.forEach((v: unknown, i) => {
      if (v === null) return
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(t('project.doc.valueInvalid', { where, field, n: i + 1 }))
      }
      points[i][field] = v
    })
  }
  return { points }
}

function decodeWaypoint(raw: unknown, where: string): Waypoint {
  if (!isRecord(raw)) throw new Error(t('project.doc.descriptionInvalid', { where }))
  const { lon, lat, ele, name } = raw
  if (typeof lon !== 'number' || typeof lat !== 'number' || !(Math.abs(lon) <= 180) || !(Math.abs(lat) <= 90)) {
    throw new Error(t('project.doc.coordsInvalid', { where }))
  }
  const waypoint: Waypoint = { lon, lat, name: typeof name === 'string' ? name : '' }
  if (typeof ele === 'number' && Number.isFinite(ele)) waypoint.ele = ele
  return waypoint
}

function isFlight(raw: unknown): raw is Flight {
  if (!isRecord(raw)) return false
  const { startM, endM, offsetM } = raw
  return typeof startM === 'number' && typeof endM === 'number' && typeof offsetM === 'number' && Number.isFinite(startM + endM + offsetM) && startM <= endM
}

function decodeTrack(raw: unknown, index: number): Track {
  const label = t('project.doc.trackLabel', { n: index + 1 })
  if (!isRecord(raw)) throw new Error(t('project.doc.descriptionInvalid', { where: label }))
  if (typeof raw.id !== 'string' || raw.id === '') throw new Error(t('project.doc.idMissing', { label }))
  if (raw.source !== 'gpx' && raw.source !== 'fit' && raw.source !== 'strava') throw new Error(t('project.doc.sourceUnknown', { label }))
  if (!Array.isArray(raw.segments)) throw new Error(t('project.doc.segmentsMissing', { label }))
  const segments = raw.segments.map((s, i) => decodeSegment(s, t('project.doc.segmentOf', { label, n: i + 1 })))
  if (!segments.some((s) => s.points.length > 0)) throw new Error(t('project.doc.noPoint', { label }))

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : label
  const activityType = typeof raw.activityType === 'string' ? raw.activityType : undefined
  const track = buildTrack({ name, source: raw.source, segments, activityType })
  if (raw.waypoints !== undefined) {
    if (!Array.isArray(raw.waypoints)) throw new Error(t('project.doc.waypointsInvalid', { label }))
    if (raw.waypoints.length > 0) track.waypoints = raw.waypoints.map((w, i) => decodeWaypoint(w, t('project.doc.pointOf', { label, n: i + 1 })))
  }
  if (isUtcOffsetMin(raw.utcOffsetMin)) track.utcOffsetMin = raw.utcOffsetMin
  // estimated only means something on a timed track
  if (raw.timesEstimated === true && track.stats.startTime !== undefined) track.timesEstimated = true
  // computed only means something on a track with elevations
  if ((raw.elevationEstimated === 'all' || raw.elevationEstimated === 'gaps') && track.stats.maxEle !== undefined) {
    track.elevationEstimated = raw.elevationEstimated
  }
  // flights only mean something on a track with elevations; an invalid list is dropped (the track stays on the ground)
  if (Array.isArray(raw.flights) && raw.flights.length > 0 && raw.flights.every(isFlight) && track.stats.maxEle !== undefined) {
    track.flights = raw.flights.map(({ startM, endM, offsetM }) => ({ startM, endM, offsetM }))
  }
  const statsOverride = statsOverrideOf(raw.statsOverride)
  if (statsOverride) track.statsOverride = statsOverride
  track.id = raw.id
  track.color =
    typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : TRACK_COLORS[index % TRACK_COLORS.length]
  return track
}

/** The film without the photos, clips and music whose file is missing or unreadable; a warning for each kind dropped. */
function dropMissingMedia(film: Settings['film'], media: MediaTable, warnings: string[]): Settings['film'] {
  const kept = film.media.filter((m) => media[m.src])
  const removed = film.media.length - kept.length
  if (removed > 0) {
    warnings.push(t('project.doc.mediaDropped', { count: removed }))
  }
  const music = film.audio.filter((a) => media[a.src])
  const silenced = film.audio.length - music.length
  if (silenced > 0) {
    warnings.push(t('project.doc.musicDropped', { count: silenced }))
  }
  return removed > 0 || silenced > 0 ? { ...film, media: kept, audio: music } : film
}

/** Parse and validate a project file. Throws an Error with a French message when it cannot be opened. */
export function parseProject(text: string): LoadedProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(t('project.doc.notJson'))
  }
  if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
    throw new Error(t('project.doc.notProject'))
  }
  const doc = migrateProject(raw)

  if (!Array.isArray(doc.tracks)) throw new Error(t('project.doc.tracksMissing'))
  const tracks = doc.tracks.map(decodeTrack)
  const ids = new Set<string>()
  for (const track of tracks) {
    if (ids.has(track.id)) throw new Error(t('project.doc.duplicateId', { id: track.id }))
    ids.add(track.id)
  }

  const warnings: string[] = []
  const { settings, invalid } = sanitizeSettings(doc.settings)
  if (invalid.length > 0) {
    warnings.push(t('project.doc.settingsReplaced', { list: invalid.join(', ') }))
  }
  const media = sanitizeMediaTable(doc.media)
  settings.film = dropMissingMedia(settings.film, media, warnings)
  const rawSpeed = isRecord(doc.playback) ? doc.playback.speed : undefined
  const speedValid = typeof rawSpeed === 'number' && PLAYBACK_SPEEDS.includes(rawSpeed)
  if (rawSpeed !== undefined && !speedValid) warnings.push(t('project.doc.speedInvalid'))

  return {
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : defaultProjectName(),
    settings,
    speed: speedValid ? rawSpeed : DEFAULT_PLAYBACK.speed,
    tracks,
    media,
    warnings,
  }
}
