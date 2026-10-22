/**
 * OpenStreetMap landmarks along a track: pure post-processing of the features returned by `overpass.ts`.
 * Each feature is projected on the track (distance and position along it, on the scale of `buildTrackPath`, so
 * `alongM / lengthM` is a playback progress), filtered by kind and `maxDistanceM`, deduplicated by name within
 * `DEDUPE_RADIUS_M` and the best `maxCount` kept by `landmarkPriority` (a share of them kept for places, `PLACE_SHARE`),
 * ordered along the track. The pinned ones (`pinnedIds`) are exempt from the cap and the deduplication; the dismissed ones
 * are left out after the cap, so they do not free a slot for another.
 * See ARCHITECTURE.md "OpenStreetMap landmarks".
 *
 * Priority range [0, 50): below the GPX waypoints and the climbs of the 3D labels. Peaks rank by elevation (a proxy for
 * prominence) and closeness, places by population. No React, no DOM, no network.
 */
import type { LonLatBounds, Track } from '../core/types'
import type { TrackPath } from '../flyover/path'
import { recordText, recordsOf } from '../import/records'
import type { RecordKind } from '../import/records'
import type { LandmarkKind as LabelKind, LandmarkLabel } from '../scene/labelModel'
import { formatNumber } from '../ui/format'
import { MAX_LANDMARK_DISTANCE_M, M_PER_DEG, planarDistanceM, type OsmFeature, type OsmKind } from './overpass'
import { t } from '../i18n'

/** Sizes of the places offered apart (« Villes » holds the OSM cities and towns). */
export type PlaceSize = 'city' | 'village' | 'hamlet'

export const PLACE_SIZES: readonly PlaceSize[] = ['city', 'village', 'hamlet']

export const PLACE_SIZE_LABELS: Readonly<Record<PlaceSize, string>> = {
  get city() { return t('landmarks.placeSize.city') },
  get village() { return t('landmarks.placeSize.village') },
  get hamlet() { return t('landmarks.placeSize.hamlet') },
}

/** Size of a place from its OSM `place` value (`OsmFeature.detail`). */
export function placeSizeOf(detail: string | undefined): PlaceSize {
  return detail === 'city' || detail === 'town' ? 'city' : detail === 'village' ? 'village' : 'hamlet'
}

/** Most landmarks kept per track by default (the scene stays readable): the « Normal » density. */
export const MAX_LANDMARKS = 40

/** How many landmarks the app keeps per track: the most important ones (rank, closeness to the track, kind) up to the count of the density. */
export type LandmarkDensity = 'few' | 'normal' | 'many'

export const LANDMARK_DENSITIES: readonly LandmarkDensity[] = ['few', 'normal', 'many']

/** Landmarks kept per track (and in the 3D labels) at each density. */
export const LANDMARK_DENSITY_COUNTS: Readonly<Record<LandmarkDensity, number>> = { few: 15, normal: MAX_LANDMARKS, many: 80 }

export const DENSITY_LABELS: Readonly<Record<LandmarkDensity, string>> = {
  get few() { return t('landmarks.density.few') },
  get normal() { return t('landmarks.density.normal') },
  get many() { return t('landmarks.density.many') },
}

/** The density an older project's `maxCount` is closest to (the midpoints between the counts split them). */
function densityFromCount(maxCount: number): LandmarkDensity {
  return maxCount < 28 ? 'few' : maxCount < 60 ? 'normal' : 'many'
}

export interface LandmarkSettings {
  enabled: boolean
  kinds: Record<OsmKind, boolean>
  /** which places are shown when `kinds.place` is on */
  places: Record<PlaceSize, boolean>
  /** largest distance between a landmark and the track (metres) */
  maxDistanceM: number
  /**
   * ids of the labels hidden by the user (kept in the project): OSM ids ("node/123") of landmarks and ids ("poi-2") of
   * points of interest
   */
  hiddenIds: string[]
  /** OSM ids of the landmarks listed when the user last showed or hid labels: the others are new (« nouveau ») */
  seenIds: string[]
  /** OSM ids in the order the user ranked them (first = most important); empty until the first move, the others follow their own importance */
  rank: string[]
  /** OSM ids the user dismissed with the cross: left out of the list and the labels until « Relancer la recherche » */
  dismissedIds: string[]
  /** how many landmarks are kept per track and in the 3D labels, the « Toujours » ones included (they are always kept, even beyond it) */
  density: LandmarkDensity
  /** OSM ids set to « Toujours »: kept whatever the cap and the deduplication, above the others when labels overlap (« Garder les Toujours » dismisses the others); never also in `hiddenIds` */
  pinnedIds: string[]
}

export const DEFAULT_LANDMARK_SETTINGS: LandmarkSettings = {
  enabled: true,
  kinds: {
    peak: true,
    pass: true,
    hut: true,
    lake: true,
    waterfall: false,
    place: true,
    viewpoint: false,
    glacier: false,
    waterPoint: false,
  },
  places: { city: true, village: true, hamlet: true },
  maxDistanceM: 1500,
  hiddenIds: [],
  seenIds: [],
  rank: [],
  dismissedIds: [],
  density: 'normal',
  pinnedIds: [],
}

/**
 * The settings of an older project with the kinds added since set to their default (« Points d'eau »), every place
 * size, no hidden or pinned landmark, none seen and the « Normal » density. A saved `kinds.place` is kept (off for most older projects: their landmarks
 * do not change). Seen ids that are not strings are dropped (only the « nouveau » badges depend on them). A saved `maxCount`
 * becomes the nearest density; a landmark both hidden and pinned is « Jamais » (hidden wins).
 */
export function withLandmarkDefaults(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const { maxCount, ...settings } = raw as { kinds?: unknown; places?: unknown; seenIds?: unknown; density?: unknown; maxCount?: unknown; hiddenIds?: unknown; pinnedIds?: unknown }
  if (settings.kinds === null || typeof settings.kinds !== 'object') return raw
  const places =
    settings.places === undefined
      ? DEFAULT_LANDMARK_SETTINGS.places
      : settings.places !== null && typeof settings.places === 'object'
        ? { ...DEFAULT_LANDMARK_SETTINGS.places, ...settings.places }
        : settings.places
  const seenIds = Array.isArray(settings.seenIds) ? settings.seenIds.filter((id) => typeof id === 'string') : []
  const density = settings.density ?? (typeof maxCount === 'number' ? densityFromCount(maxCount) : 'normal')
  const hidden = new Set(Array.isArray(settings.hiddenIds) ? settings.hiddenIds : [])
  // anything else than a list is left for the validation of the project to reject
  const pinnedIds = Array.isArray(settings.pinnedIds) ? settings.pinnedIds.filter((id) => !hidden.has(id)) : (settings.pinnedIds ?? [])
  return { hiddenIds: [], rank: [], dismissedIds: [], ...settings, density, pinnedIds, kinds: { ...DEFAULT_LANDMARK_SETTINGS.kinds, ...settings.kinds }, places, seenIds }
}

/** The state of a landmark in the list: left to the app (« Auto »), kept and put first (« Toujours »), or never shown (« Jamais »). */
export type LandmarkMode = 'auto' | 'always' | 'never'

export const LANDMARK_MODES: readonly LandmarkMode[] = ['auto', 'always', 'never']

export const MODE_LABELS: Readonly<Record<LandmarkMode, string>> = {
  get auto() { return t('landmarks.mode.auto') },
  get always() { return t('landmarks.mode.always') },
  get never() { return t('landmarks.mode.never') },
}

/** The mode of `id` (hidden wins over pinned, which a saved project never has both). */
export function landmarkMode(settings: Pick<LandmarkSettings, 'hiddenIds' | 'pinnedIds'>, id: string): LandmarkMode {
  return settings.hiddenIds.includes(id) ? 'never' : settings.pinnedIds.includes(id) ? 'always' : 'auto'
}

/** The mode after `mode` when the button of a row is pressed: Auto, Toujours, Jamais, Auto… */
export function nextMode(mode: LandmarkMode): LandmarkMode {
  return LANDMARK_MODES[(LANDMARK_MODES.indexOf(mode) + 1) % LANDMARK_MODES.length]
}

/**
 * The settings with the labels `ids` (OSM ids of landmarks, ids of points of interest) set to `mode`, and the landmarks
 * `listed` now (OSM ids) seen: landmarks found later (wider distance, another type) are Auto, shown, as new ones.
 */
export function withMode(settings: LandmarkSettings, ids: readonly string[], mode: LandmarkMode, listed: readonly string[]): LandmarkSettings {
  const changed = new Set(ids)
  const others = (list: readonly string[]) => list.filter((id) => !changed.has(id))
  return {
    ...settings,
    hiddenIds: mode === 'never' ? [...others(settings.hiddenIds), ...changed] : others(settings.hiddenIds),
    pinnedIds: mode === 'always' ? [...others(settings.pinnedIds), ...changed] : others(settings.pinnedIds),
    seenIds: [...new Set([...settings.seenIds, ...listed])],
  }
}

/**
 * The settings with every landmark of `listed` (OSM ids, every track, shown or hidden) dismissed but the pinned ones
 * (« Garder les épinglés »); the dismissed ones leave the hidden and ranked ids, as with the cross.
 */
export function withPinnedOnly(settings: LandmarkSettings, listed: readonly string[]): LandmarkSettings {
  const pinned = new Set(settings.pinnedIds)
  const dismissed = new Set(listed.filter((id) => !pinned.has(id)))
  return {
    ...settings,
    hiddenIds: settings.hiddenIds.filter((id) => !dismissed.has(id)),
    rank: settings.rank.filter((id) => !dismissed.has(id)),
    dismissedIds: [...new Set([...settings.dismissedIds, ...dismissed])],
  }
}

/**
 * `landmarks` ranked by the user: the importances of the ranked ones are given back in the order of `rank`, strictly
 * decreasing, so the labels and the list follow it; the others keep theirs.
 */
export function withRank(landmarks: readonly Landmark[], rank: readonly string[]): Landmark[] {
  const position = new Map(rank.map((id, i) => [id, i]))
  const ranked = landmarks.filter((l) => position.has(l.id)).sort((a, b) => position.get(a.id)! - position.get(b.id)!)
  const values = ranked.map((l) => l.priority).sort((a, b) => b - a)
  const given = new Map<string, number>()
  ranked.forEach((l, i) => given.set(l.id, i === 0 ? values[0] : Math.min(values[i], given.get(ranked[i - 1].id)! - RANK_STEP)))
  return landmarks.map((l) => (given.has(l.id) ? withLandmarkFields(l, { priority: given.get(l.id)! }) : l))
}

/**
 * `landmark` with some fields replaced. Unlike a spread it keeps the getters of `name` and `text`, which read the
 * language and the number format when shown (a copy would freeze them in the language of the moment).
 */
export function withLandmarkFields(landmark: Landmark, fields: Partial<Landmark>): Landmark {
  return Object.defineProperties({} as Landmark, { ...Object.getOwnPropertyDescriptors(landmark), ...Object.getOwnPropertyDescriptors(fields) })
}

/** Gap between two ranked landmarks of the same importance. */
const RANK_STEP = 1e-3

/** The ids of `ordered` with `id` one place `up` (earlier) or down; the same order when it cannot move. */
export function movedInRank(ordered: readonly string[], id: string, up: boolean): string[] {
  const from = ordered.indexOf(id)
  const to = up ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= ordered.length) return [...ordered]
  const next = [...ordered]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** The landmarks of `listed` (OSM ids) not seen yet; none before the user first showed or hid labels. */
export function newLandmarkIds(settings: Pick<LandmarkSettings, 'seenIds'>, listed: readonly string[]): Set<string> {
  if (settings.seenIds.length === 0) return new Set()
  const seen = new Set(settings.seenIds)
  return new Set(listed.filter((id) => !seen.has(id)))
}

/**
 * The settings with one place size shown or not (chips « Villes », « Villages », « Hameaux »): `kinds.place` is on
 * while one size is. Showing a size while places are off shows that size alone.
 */
export function withPlaceSize<T extends Pick<LandmarkSettings, 'kinds' | 'places'>>(settings: T, size: PlaceSize, on: boolean): T {
  const base = settings.kinds.place || !on ? settings.places : { city: false, village: false, hamlet: false }
  const places = { ...base, [size]: on }
  return { ...settings, places, kinds: { ...settings.kinds, place: PLACE_SIZES.some((s) => places[s]) } }
}

/** Allowed `maxDistanceM` (metres); the upper bound is what one query covers. */
export const LANDMARK_DISTANCE_RANGE = { min: 100, max: MAX_LANDMARK_DISTANCE_M, step: 100 } as const

export const KIND_LABELS: Readonly<Record<OsmKind, string>> = {
  get peak() { return t('landmarks.kind.peak') },
  get pass() { return t('landmarks.kind.pass') },
  get hut() { return t('landmarks.kind.hut') },
  get lake() { return t('landmarks.kind.lake') },
  get waterfall() { return t('landmarks.kind.waterfall') },
  get place() { return t('landmarks.kind.place') },
  get viewpoint() { return t('landmarks.kind.viewpoint') },
  get glacier() { return t('landmarks.kind.glacier') },
  get waterPoint() { return t('landmarks.kind.waterPoint') },
}

/** Name of one landmark of each kind (badge of the lists). */
export const KIND_BADGES: Readonly<Record<Landmark['kind'], string>> = {
  get record() { return t('landmarks.badge.record') },
  get peak() { return t('landmarks.badge.peak') },
  get pass() { return t('landmarks.badge.pass') },
  get hut() { return t('landmarks.badge.hut') },
  get lake() { return t('landmarks.badge.lake') },
  get waterfall() { return t('landmarks.badge.waterfall') },
  get place() { return t('landmarks.badge.place') },
  get viewpoint() { return t('landmarks.badge.viewpoint') },
  get glacier() { return t('landmarks.badge.glacier') },
  get waterPoint() { return t('landmarks.badge.waterPoint') },
}

/** Share of `MAX_LANDMARKS` kept for places when there are enough of them (they rank below every other kind). */
export const PLACE_SHARE = 0.25
/** Two features with the same name closer than this are one landmark (metres). */
export const DEDUPE_RADIUS_M = 1000
/** A pass closer than this to the track is crossed by it (metres). */
export const CROSSED_PASS_M = 150

export interface Landmark {
  /** OSM id ("node/123"), or `record:<track id>:<kind>` for a record of the outing */
  id: string
  /** an OpenStreetMap kind, or 'record': a feat found in the track itself (`recordLandmarks`) */
  kind: OsmKind | 'record'
  /** which record it is, when `kind` is 'record' */
  recordKind?: RecordKind
  name: string
  lon: number
  lat: number
  /** elevation from the OSM `ele` tag (metres), undefined when absent or unreadable */
  ele?: number
  /** distance to the track (metres) */
  distanceM: number
  /** position of the nearest point of the track, from its start (metres) */
  alongM: number
  priority: number
  /** French label: « Col de Voza · 1 653 m », « Refuge du Nid d'Aigle » */
  text: string
}

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

/**
 * Metres from an OSM `ele` value: "1653", "4808.73", "1 653 m", "1653m", "1,653", "1653,5", "5400 ft".
 * Undefined when unreadable or outside [-500, 9000] m.
 */
export function parseEle(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  let text = raw.trim().toLowerCase()
  let factor = 1
  if (/(ft|feet|foot|')$/.test(text)) {
    factor = 0.3048
    text = text.replace(/(ft|feet|foot|')$/, '')
  }
  text = text.replace(/m$/, '').replace(/[\s  ]/g, '')
  if (/^-?\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, '')
  else text = text.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined
  const metres = Number(text) * factor
  return metres >= -500 && metres <= 9000 ? metres : undefined
}

// ---------------------------------------------------------------------------
// Projection on the track
// ---------------------------------------------------------------------------

/** Distance (metres) from (lon, lat) to the path, and position along it of the nearest point. */
export function projectOnPath(path: TrackPath, lon: number, lat: number): { distanceM: number; alongM: number } {
  if (path.count === 0) return { distanceM: Infinity, alongM: 0 }
  const k = Math.cos((lat * Math.PI) / 180) * M_PER_DEG
  const x = (i: number) => (path.lon[i] - lon) * k
  const y = (i: number) => (path.lat[i] - lat) * M_PER_DEG
  let best = Math.hypot(x(0), y(0))
  let along = 0
  for (let i = 1; i < path.count; i++) {
    const ax = x(i - 1)
    const ay = y(i - 1)
    const dx = x(i) - ax
    const dy = y(i) - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best) {
      best = d
      along = path.dist[i - 1] + t * (path.dist[i] - path.dist[i - 1])
    }
  }
  return { distanceM: best, alongM: along }
}

// ---------------------------------------------------------------------------
// Priority and text
// ---------------------------------------------------------------------------

const PLACE_RANK: Readonly<Record<string, number>> = { city: 9, town: 6, village: 3, hamlet: 0 }

/** Inhabitants from an OSM `population` value: "1250", "12 345", "12,345", "12.345"; undefined otherwise. */
export function parsePopulation(raw: string | undefined): number | undefined {
  const text = raw?.trim().replace(/[\s  ,.']/g, '')
  if (!text || !/^\d+$/.test(text)) return undefined
  const n = Number(text)
  return n > 0 ? n : undefined
}

/** Rank of a place in [0, 10]: from its population when tagged (100 → 0, 1 000 → 3, 10 000 → 6, 100 000 → 9), else its type. */
function placeRank(detail: string | undefined, population: number | undefined): number {
  if (population !== undefined) return Math.min(10, Math.max(0, 3 * Math.log10(population) - 6))
  return PLACE_RANK[detail ?? ''] ?? 0
}

/**
 * Importance in [0, 50): a base per kind, plus elevation for summits and passes (population for places), minus up
 * to 8 points with the distance to the track (at 3 km).
 */
export function landmarkPriority(
  kind: OsmKind,
  ele: number | undefined,
  distanceM: number,
  detail?: string,
  population?: number,
): number {
  const far = Math.min(8, distanceM / 375)
  const high = ele === undefined ? 0 : Math.min(8, Math.max(0, ele / 1000) * 1.6)
  let p: number
  switch (kind) {
    case 'pass':
      p = distanceM <= CROSSED_PASS_M ? 40 + high : 24 + high - far
      break
    case 'peak':
      p = 28 + high - far
      break
    case 'hut':
      p = 22 - far
      break
    case 'lake':
      p = 18 - far
      break
    case 'glacier':
    case 'waterfall':
    case 'viewpoint':
      p = 14 - far
      break
    case 'place':
      p = 6 + placeRank(detail, population) - far
      break
    case 'waterPoint':
      p = 10 - far
      break
  }
  return Math.min(49.9, Math.max(0, p))
}

/** « Col de Voza · 1 653 m » for summits and passes with an elevation, the name alone otherwise. */
export function landmarkText(kind: OsmKind, name: string, ele: number | undefined): string {
  if ((kind === 'peak' || kind === 'pass') && ele !== undefined) return `${name} · ${formatNumber(ele)} m`
  return name
}

function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Distance (metres) from a point to a box (0 inside), equirectangular around the point. */
function boxGapM(p: { lon: number; lat: number }, b: LonLatBounds): number {
  const k = Math.cos((p.lat * Math.PI) / 180)
  const dx = Math.max(b.west - p.lon, 0, p.lon - b.east) * k
  const dy = Math.max(b.south - p.lat, 0, p.lat - b.north)
  return Math.hypot(dx, dy) * M_PER_DEG
}

/** Distance (metres) from the path to a box (0 when the path enters it), on the plane tangent at the box centre. */
export function pathBoxDistanceM(path: TrackPath, box: LonLatBounds): number {
  const k = Math.cos((((box.south + box.north) / 2) * Math.PI) / 180) * M_PER_DEG
  const x0 = box.west * k
  const x1 = box.east * k
  const y0 = box.south * M_PER_DEG
  const y1 = box.north * M_PER_DEG
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]
  let best = Infinity
  for (let i = 0; i < path.count; i++) {
    const bx = path.lon[i] * k
    const by = path.lat[i] * M_PER_DEG
    best = Math.min(best, Math.hypot(Math.max(x0 - bx, 0, bx - x1), Math.max(y0 - by, 0, by - y1)))
    if (i === 0 || best === 0) continue
    const ax = path.lon[i - 1] * k
    const ay = path.lat[i - 1] * M_PER_DEG
    // the segment crosses the box (Liang-Barsky clipping), else its nearest point to the box is an end or faces a corner
    const dx = bx - ax
    const dy = by - ay
    let t0 = 0
    let t1 = 1
    for (const [p, q] of [
      [-dx, ax - x0],
      [dx, x1 - ax],
      [-dy, ay - y0],
      [dy, y1 - ay],
    ]) {
      if (p === 0) {
        if (q < 0) t0 = 2
      } else if (p < 0) t0 = Math.max(t0, q / p)
      else t1 = Math.min(t1, q / p)
    }
    if (t0 <= t1) return 0
    const len2 = dx * dx + dy * dy
    for (const [cx, cy] of corners) {
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0
      best = Math.min(best, Math.hypot(ax + t * dx - cx, ay + t * dy - cy))
    }
  }
  return best
}

/**
 * The first `maxCount` of `sorted` (most important first), keeping up to `PLACE_SHARE` of them for places: they rank
 * below every other kind and would otherwise always be cut first.
 */
function capWithPlaces<T extends { kind: OsmKind | 'record' }>(sorted: readonly T[], maxCount: number): T[] {
  const places = sorted.filter((l) => l.kind === 'place').length
  const othersMax = maxCount - Math.min(places, Math.round(maxCount * PLACE_SHARE))
  const kept: T[] = []
  let others = 0
  for (const l of sorted) {
    if (kept.length >= maxCount) break
    if (l.kind !== 'place') {
      if (others >= othersMax) continue
      others++
    }
    kept.push(l)
  }
  return kept
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Landmarks of one track from its OSM features, filtered, deduplicated, capped and ordered along it. A place mapped
 * as an area is as far from the track as its bounding box (0 when the track goes through it).
 */
export function buildLandmarks(
  features: readonly OsmFeature[],
  path: TrackPath,
  settings: Pick<LandmarkSettings, 'kinds' | 'places' | 'maxDistanceM'> &
    Partial<Pick<LandmarkSettings, 'pinnedIds' | 'dismissedIds'>> & { /** from the density, `LANDMARK_DENSITY_COUNTS` */ maxCount?: number },
): Landmark[] {
  const maxCount = settings.maxCount ?? MAX_LANDMARKS
  const pinned = new Set(settings.pinnedIds)
  const dismissed = new Set(settings.dismissedIds)
  const candidates: Landmark[] = []
  const areas = new Map<Landmark, LonLatBounds>()
  for (const f of features) {
    if (!settings.kinds[f.kind]) continue
    if (f.kind === 'place' && !settings.places[placeSizeOf(f.detail)]) continue
    const projected = projectOnPath(path, f.lon, f.lat)
    const distanceM = f.area ? Math.min(projected.distanceM, pathBoxDistanceM(path, f.area)) : projected.distanceM
    if (!(distanceM <= settings.maxDistanceM)) continue
    const ele = parseEle(f.ele)
    const landmark: Landmark = {
      id: f.id,
      kind: f.kind,
      name: f.name,
      lon: f.lon,
      lat: f.lat,
      distanceM,
      alongM: projected.alongM,
      priority: landmarkPriority(f.kind, ele, distanceM, f.detail, parsePopulation(f.population)),
      // read when shown: the elevation follows the number format of the language
      get text() {
        return landmarkText(f.kind, f.name, ele)
      },
    }
    if (ele !== undefined) landmark.ele = ele
    if (f.area) areas.set(landmark, f.area)
    candidates.push(landmark)
  }
  // a place mapped both as a node and as an area is one landmark: same name, the node in (or near) the area's box
  const gapM = (a: Landmark, b: Landmark): number => {
    const boxA = areas.get(a)
    const boxB = areas.get(b)
    return Math.min(planarDistanceM(a, b), boxA ? boxGapM(b, boxA) : Infinity, boxB ? boxGapM(a, boxB) : Infinity)
  }

  // most important first, so a duplicate is always the less important one; ties: with elevation, closer
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.ele !== undefined) - Number(a.ele !== undefined) ||
      a.distanceM - b.distanceM ||
      (a.id < b.id ? -1 : 1),
  )
  // the pinned ones first: never dropped as duplicates, they win over an unpinned duplicate
  const keptPinned = candidates.filter((c) => pinned.has(c.id))
  const unique: Landmark[] = [...keptPinned]
  const names: string[] = unique.map((c) => normaliseName(c.name))
  const others: Landmark[] = []
  for (const c of candidates) {
    if (pinned.has(c.id)) continue
    const name = normaliseName(c.name)
    if (unique.some((k, i) => names[i] === name && gapM(k, c) < DEDUPE_RADIUS_M)) continue
    unique.push(c)
    names.push(name)
    others.push(c)
  }
  // the dismissed ones count under the cap (they do not free a slot for another), then leave
  return [...keptPinned, ...capWithPlaces(others, Math.max(0, maxCount - keptPinned.length))]
    .filter((l) => !dismissed.has(l.id))
    .sort((a, b) => a.alongM - b.alongM || b.priority - a.priority)
}

/** A highest point this close to a summit landmark is that summit, not a record (metres). */
export const RECORD_SUMMIT_M = 200

/** Importance of the records, among the landmarks: the feats of the outing (steepest, fastest, highest) then the others. */
const RECORD_PRIORITY: Readonly<Record<string, number>> = { steepestClimb: 32, fastestDescent: 32, highest: 32 }
const RECORD_PRIORITY_OTHER = 26

/**
 * The records of `track` (`import/records.ts`) as landmarks, ordered along it, at the places the points give: always at
 * the track (distance 0), the highest point left out when a summit of `landmarks` is within `RECORD_SUMMIT_M` of it.
 * Their id is made of the track's, so the mode, the rank and the stops of a record follow it as for any landmark.
 */
export function recordLandmarks(track: Track, landmarks: readonly Landmark[]): Landmark[] {
  const summits = landmarks.filter((l) => l.kind === 'peak')
  return recordsOf(track)
    .filter((r) => r.kind !== 'highest' || !summits.some((s) => planarDistanceM(s, r) <= RECORD_SUMMIT_M))
    .map((r): Landmark => {
      const landmark: Landmark = {
        id: `record:${track.id}:${r.kind}`,
        kind: 'record',
        recordKind: r.kind,
        // read when shown: the text follows the language and the number format
        get name() {
          return recordText(r)
        },
        lon: r.lon,
        lat: r.lat,
        distanceM: 0,
        alongM: r.alongM,
        priority: RECORD_PRIORITY[r.kind] ?? RECORD_PRIORITY_OTHER,
        get text() {
          return recordText(r)
        },
      }
      if (r.kind === 'highest' || r.kind === 'lowest') landmark.ele = r.value
      return landmark
    })
    .sort((a, b) => a.alongM - b.alongM)
}

/** The landmarks the user left visible and those hidden by id, both in the incoming order. */
export function splitHidden(
  landmarks: readonly Landmark[],
  hiddenIds: readonly string[],
): { shown: Landmark[]; hidden: Landmark[] } {
  const ids = new Set(hiddenIds)
  const shown: Landmark[] = []
  const hidden: Landmark[] = []
  for (const l of landmarks) (ids.has(l.id) ? hidden : shown).push(l)
  return { shown, hidden }
}

// ---------------------------------------------------------------------------
// 3D labels
// ---------------------------------------------------------------------------

const LABEL_KINDS: Readonly<Record<OsmKind, LabelKind>> = {
  peak: 'peak',
  pass: 'pass',
  hut: 'hut',
  lake: 'water',
  waterfall: 'water',
  place: 'place',
  viewpoint: 'other',
  glacier: 'other',
  waterPoint: 'water',
}

/** Added to the priority of the label of a « Toujours » landmark: it wins over the waypoints (50) and the kilometres, and loses to the endpoints (150) and the points of interest (200). */
export const PINNED_LABEL_BOOST = 100

/**
 * Labels of the landmarks of every track: one per OSM element (highest priority kept), at most `maxCount` (a share
 * kept for places, as in `buildLandmarks`) besides the pinned ones, which are always kept and, when labels overlap on
 * screen, win over every other landmark (`PINNED_LABEL_BOOST`).
 */
export function landmarkLabels(
  perTrack: readonly (readonly Landmark[])[],
  maxCount = MAX_LANDMARKS,
  pinnedIds: readonly string[] = [],
): LandmarkLabel[] {
  const byId = new Map<string, Landmark>()
  for (const list of perTrack) {
    for (const l of list) {
      const seen = byId.get(l.id)
      if (!seen || l.priority > seen.priority) byId.set(l.id, l)
    }
  }
  const pinned = new Set(pinnedIds)
  const sorted = [...byId.values()].sort((a, b) => b.priority - a.priority)
  const keptPinned = sorted.filter((l) => pinned.has(l.id))
  const others = capWithPlaces(
    sorted.filter((l) => !pinned.has(l.id)),
    Math.max(0, maxCount - keptPinned.length),
  )
  return [...keptPinned, ...others].sort((a, b) => b.priority - a.priority).map((l) => {
      const label: LandmarkLabel = {
        id: `osm:${l.id}`,
        lon: l.lon,
        lat: l.lat,
        text: l.text,
        // a record is drawn like a place of the user's, with a trophy
        kind: l.kind === 'record' ? 'poi' : LABEL_KINDS[l.kind],
        priority: pinned.has(l.id) ? l.priority + PINNED_LABEL_BOOST : l.priority,
      }
      if (l.kind === 'record') label.icon = 'trophee'
      if (l.ele !== undefined) label.ele = l.ele
      return label
    })
}
