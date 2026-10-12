/**
 * OpenStreetMap landmarks along a track: pure post-processing of the features returned by `overpass.ts`.
 * Each feature is projected on the track (distance and position along it, on the scale of `buildTrackPath`, so
 * `alongM / lengthM` is a playback progress), filtered by kind and `maxDistanceM`, deduplicated by name within
 * `DEDUPE_RADIUS_M` and the best `maxCount` kept by `landmarkPriority` (a share of them kept for places, `PLACE_SHARE`),
 * ordered along the track.
 * See ARCHITECTURE.md "OpenStreetMap landmarks".
 *
 * Priority range [0, 50): below the GPX waypoints and the climbs of the 3D labels. Peaks rank by elevation (a proxy for
 * prominence) and closeness, places by population. No React, no DOM, no network.
 */
import type { LonLatBounds } from '../core/types'
import type { TrackPath } from '../flyover/path'
import type { LandmarkKind as LabelKind, LandmarkLabel } from '../scene/labelModel'
import { formatNumber } from '../ui/format'
import { MAX_LANDMARK_DISTANCE_M, M_PER_DEG, planarDistanceM, type OsmFeature, type OsmKind } from './overpass'

/** Sizes of the places offered apart (« Villes » holds the OSM cities and towns). */
export type PlaceSize = 'city' | 'village' | 'hamlet'

export const PLACE_SIZES: readonly PlaceSize[] = ['city', 'village', 'hamlet']

export const PLACE_SIZE_LABELS: Readonly<Record<PlaceSize, string>> = { city: 'Villes', village: 'Villages', hamlet: 'Hameaux' }

/** Size of a place from its OSM `place` value (`OsmFeature.detail`). */
export function placeSizeOf(detail: string | undefined): PlaceSize {
  return detail === 'city' || detail === 'town' ? 'city' : detail === 'village' ? 'village' : 'hamlet'
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
}

/**
 * The settings of an older project with the kinds added since set to their default (« Points d'eau »), every place
 * size, no hidden landmark and none seen. A saved `kinds.place` is kept (off for most older projects: their landmarks
 * do not change). Seen ids that are not strings are dropped (only the « nouveau » badges depend on them).
 */
export function withLandmarkDefaults(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const settings = raw as { kinds?: unknown; places?: unknown; seenIds?: unknown }
  if (settings.kinds === null || typeof settings.kinds !== 'object') return raw
  const places =
    settings.places === undefined
      ? DEFAULT_LANDMARK_SETTINGS.places
      : settings.places !== null && typeof settings.places === 'object'
        ? { ...DEFAULT_LANDMARK_SETTINGS.places, ...settings.places }
        : settings.places
  const seenIds = Array.isArray(settings.seenIds) ? settings.seenIds.filter((id) => typeof id === 'string') : []
  return { hiddenIds: [], ...settings, kinds: { ...DEFAULT_LANDMARK_SETTINGS.kinds, ...settings.kinds }, places, seenIds }
}

/**
 * The settings with the labels `ids` hidden (`hide`) or shown again, and the landmarks `listed` now (OSM ids) seen:
 * landmarks found later (wider distance, another type) are shown, as new ones.
 */
export function withHidden(settings: LandmarkSettings, ids: readonly string[], hide: boolean, listed: readonly string[]): LandmarkSettings {
  const changed = new Set(ids)
  const rest = settings.hiddenIds.filter((id) => !changed.has(id))
  return { ...settings, hiddenIds: hide ? [...rest, ...changed] : rest, seenIds: [...new Set([...settings.seenIds, ...listed])] }
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
  peak: 'Sommets',
  pass: 'Cols',
  hut: 'Refuges',
  lake: 'Lacs',
  waterfall: 'Cascades',
  place: 'Villes, villages et hameaux',
  viewpoint: 'Points de vue',
  glacier: 'Glaciers',
  waterPoint: "Points d'eau",
}

/** Name of one landmark of each kind (badge of the lists). */
export const KIND_BADGES: Readonly<Record<OsmKind, string>> = {
  peak: 'Sommet',
  pass: 'Col',
  hut: 'Refuge',
  lake: 'Lac',
  waterfall: 'Cascade',
  place: 'Lieu',
  viewpoint: 'Vue',
  glacier: 'Glacier',
  waterPoint: 'Eau',
}

/** Most landmarks kept per track (the scene stays readable). */
export const MAX_LANDMARKS = 40
/** Share of `MAX_LANDMARKS` kept for places when there are enough of them (they rank below every other kind). */
export const PLACE_SHARE = 0.25
/** Two features with the same name closer than this are one landmark (metres). */
export const DEDUPE_RADIUS_M = 1000
/** A pass closer than this to the track is crossed by it (metres). */
export const CROSSED_PASS_M = 150

export interface Landmark {
  /** OSM id ("node/123") */
  id: string
  kind: OsmKind
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
function capWithPlaces<T extends { kind: OsmKind }>(sorted: readonly T[], maxCount: number): T[] {
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
  settings: Pick<LandmarkSettings, 'kinds' | 'places' | 'maxDistanceM'>,
  maxCount = MAX_LANDMARKS,
): Landmark[] {
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
      text: landmarkText(f.kind, f.name, ele),
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
  const unique: Landmark[] = []
  const names: string[] = []
  for (const c of candidates) {
    const name = normaliseName(c.name)
    if (unique.some((k, i) => names[i] === name && gapM(k, c) < DEDUPE_RADIUS_M)) continue
    unique.push(c)
    names.push(name)
  }
  return capWithPlaces(unique, maxCount).sort((a, b) => a.alongM - b.alongM || b.priority - a.priority)
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

/**
 * Labels of the landmarks of every track: one per OSM element (highest priority kept), at most `maxCount` (a share
 * kept for places, as in `buildLandmarks`).
 */
export function landmarkLabels(perTrack: readonly (readonly Landmark[])[], maxCount = MAX_LANDMARKS): LandmarkLabel[] {
  const byId = new Map<string, Landmark>()
  for (const list of perTrack) {
    for (const l of list) {
      const seen = byId.get(l.id)
      if (!seen || l.priority > seen.priority) byId.set(l.id, l)
    }
  }
  return capWithPlaces(
    [...byId.values()].sort((a, b) => b.priority - a.priority),
    maxCount,
  ).map((l) => {
      const label: LandmarkLabel = {
        id: `osm:${l.id}`,
        lon: l.lon,
        lat: l.lat,
        text: l.text,
        kind: LABEL_KINDS[l.kind],
        priority: l.priority,
      }
      if (l.ele !== undefined) label.ele = l.ele
      return label
    })
}
