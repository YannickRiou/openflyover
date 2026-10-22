/**
 * Values shown by the film overlay at a flyover progress: distance covered, altitude, cumulative D+,
 * elapsed recorded time, speed, heart rate, and the whole-track figures of the closing card; the lines of the
 * ghost-race leaderboard (`leaderboardRows`).
 *
 * `prepareOverlayTrack` does the per-track work once (path, cumulative ascent, smoothed speed and heart
 * rate per point); `overlayFrameAt` is then a cheap pure function of the progress, so the export can
 * compute any frame on its own. Pure functions (no DOM, no React, no Three).
 */
import type { Track } from '../core/types'
import { junctionCardOf } from '../film/junctions'
import { JUNCTION_CARD_DEFAULT_S, STAGE_CARD_FIELDS } from '../film/model'
import type { Film, FilmDayCards } from '../film/model'
import { addFigures, figuresBefore, outingFigures } from '../flyover/bilan'
import type { BilanRegion, OutingFigures } from '../flyover/bilan'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath } from '../flyover/path'
import type { ElevationProfile, TrackPath } from '../flyover/path'
import { rankRacers } from '../flyover/race'
import type { Racer } from '../flyover/race'
import { stageAt } from '../flyover/sequence'
import type { Sequence } from '../flyover/sequence'
import { metricValues } from '../flyover/trackColor'
import { ELEVATION_HYSTERESIS_M, smoothElevations } from '../import/stats'
import { osmAttribution } from '../osm/overpass'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { formatDate } from '../i18n/format'
import { formatDistance, formatDistanceGap, formatNumber, formatTimeGap } from '../ui/format'
import { openMeteoAttribution } from '../weather/openMeteo'
import { summarizeOuting, weatherWidgetData } from '../weather/series'
import type { WeatherSeries, WeatherSummary, WeatherWidgetData } from '../weather/series'
import type { DayCard, OverlayTime, StageCard } from './draw'
import type { DayFigures } from '../film/days'
import { t } from '../i18n'
import { formatList } from '../i18n/format'

/** Samples of the overlay elevation profile over the track. */
export const OVERLAY_PROFILE_SAMPLES = 240
/** Most points kept in the mini-map outline (every n-th point of the path, plus the last one). */
export const OVERLAY_MINIMAP_POINTS = 1500
/** metres per degree of latitude (spherical Earth, enough for a plan view) */
const M_PER_DEG = (6371008.8 * Math.PI) / 180

/**
 * Plan view of the track for the mini-map: local equirectangular projection (x east, y south, like a canvas)
 * normalised so the longer side of the bounding box measures 1. Aspect ratio preserved.
 */
export interface MiniMapOutline {
  /** projected points, every n-th point of the path and the last one */
  x: Float64Array
  y: Float64Array
  /** cumulative distance along the path at each kept point (metres) */
  dist: Float64Array
  /** size of the bounding box (longer side = 1, both 0 for a track that does not move) */
  width: number
  height: number
  /** projection: x = (lon - west) * kx, y = (north - lat) * ky */
  west: number
  north: number
  kx: number
  ky: number
}

export interface OverlayTrackStats {
  distanceM: number
  /** undefined when the track has no elevation */
  ascentM?: number
  descentM?: number
  maxEleM?: number
  minEleM?: number
  /** elapsed recorded time, start to end (seconds) */
  durationS?: number
  /** highest smoothed speed (km/h) */
  maxSpeedKmh?: number
  /** recorded time of the start (ms since epoch) */
  startTime?: number
  /** the times are estimated from a planned departure (`Track.timesEstimated`) */
  timesEstimated?: boolean
  /** weather of the outing, when its series is known */
  weather?: WeatherSummary
  /** « Bilan »: how many outings the film shows (the sequence's figures only) */
  outings?: number
}

export interface OverlayTrack {
  name: string
  path: TrackPath
  /** cumulative D+ at each path point (metres); NaN everywhere when the track has no elevation */
  ascent: Float64Array
  /** smoothed speed at each path point (km/h), NaN when unknown */
  speed: Float64Array
  /** heart rate averaged over a few seconds at each path point (bpm), NaN when unknown */
  heartRate: Float64Array
  /** slope (%), power (W) and temperature (°C) at each path point, NaN when unknown */
  slope: Float64Array
  power: Float64Array
  temperature: Float64Array
  profile?: ElevationProfile
  /** plan view of the track (mini-map), undefined without points */
  outline?: MiniMapOutline
  /** historical weather along the track (Open-Meteo), when fetched */
  weatherSeries?: WeatherSeries
  stats: OverlayTrackStats
}

/** Everything the overlay shows at one progress. */
export interface OverlayFrame {
  /** 0 = start of the flyover, 1 = end */
  progress: number
  track: OverlayTrack
  distanceM: number
  ele?: number
  ascentM?: number
  elapsedS?: number
  speedKmh?: number
  heartRate?: number
  slopePct?: number
  powerW?: number
  temperatureC?: number
  /** recorded time of day under the marker (ms since epoch) */
  clockMs?: number
  /** weather under the marker, when the track has a weather series */
  weather?: WeatherWidgetData
  /** position of the marker on the mini-map outline (same units as `track.outline`) */
  mapPoint?: { x: number; y: number }
  /** « Bilan »: what the outings drawn so far add up to, which the counters show instead of the outing under the marker's */
  cumul?: BilanCumul
}

/** The outings drawn so far in a « Bilan » (the one being drawn included) and their figures added up. */
export interface BilanCumul {
  outings: number
  distanceM: number
  ascentM?: number
  durationS?: number
}

/**
 * Cumulative ascent at each point of the flattened track, with the rule of `computeStats` (moving average,
 * then a climb only counts once it exceeds the hysteresis since the last accepted elevation, per segment):
 * the last value equals `track.stats.ascentM`. Points without elevation keep the running total.
 */
export function cumulativeAscent(track: Track): Float64Array {
  const out = new Float64Array(track.segments.reduce((n, s) => n + s.points.length, 0))
  let total = 0
  let offset = 0
  for (const segment of track.segments) {
    const points = segment.points
    const indices: number[] = []
    const elevations: number[] = []
    points.forEach((p, i) => {
      if (p.ele !== undefined && Number.isFinite(p.ele)) {
        indices.push(i)
        elevations.push(p.ele)
      }
    })
    const smoothed = smoothElevations(elevations)
    let reference = smoothed[0]
    let k = 0
    for (let i = 0; i < points.length; i++) {
      if (k < indices.length && indices[k] === i) {
        const delta = smoothed[k] - reference
        if (Math.abs(delta) > ELEVATION_HYSTERESIS_M) {
          if (delta > 0) total += delta
          reference = smoothed[k]
        }
        k++
      }
      out[offset + i] = total
    }
    offset += points.length
  }
  return out
}

function concat(parts: readonly Float64Array[], count: number): Float64Array {
  const out = new Float64Array(count)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function maxOf(values: Float64Array): number | undefined {
  let max = -Infinity
  for (const v of values) if (v > max) max = v
  return max > -Infinity ? max : undefined
}

/** Plan view of the path for the mini-map (see `MiniMapOutline`); undefined when the path has no point. */
export function miniMapOutline(path: TrackPath, maxPoints = OVERLAY_MINIMAP_POINTS): MiniMapOutline | undefined {
  const { count, lon, lat, dist } = path
  if (count === 0) return undefined
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (let i = 0; i < count; i++) {
    west = Math.min(west, lon[i])
    east = Math.max(east, lon[i])
    south = Math.min(south, lat[i])
    north = Math.max(north, lat[i])
  }
  const widthM = (east - west) * M_PER_DEG * Math.cos((((south + north) / 2) * Math.PI) / 180)
  const heightM = (north - south) * M_PER_DEG
  const longerM = Math.max(widthM, heightM)
  const unit = longerM > 0 ? 1 / longerM : 0
  const kx = (widthM > 0 ? widthM / (east - west) : 0) * unit
  const ky = M_PER_DEG * unit
  const step = Math.max(1, Math.ceil(count / Math.max(2, maxPoints - 1)))
  const kept: number[] = []
  for (let i = 0; i < count; i += step) kept.push(i)
  if (kept[kept.length - 1] !== count - 1) kept.push(count - 1)
  const x = new Float64Array(kept.length)
  const y = new Float64Array(kept.length)
  const keptDist = new Float64Array(kept.length)
  kept.forEach((i, k) => {
    x[k] = (lon[i] - west) * kx
    y[k] = (north - lat[i]) * ky
    keptDist[k] = dist[i]
  })
  return { x, y, dist: keptDist, width: widthM * unit, height: heightM * unit, west, north, kx, ky }
}

/** Per-track data of the overlay; `weather` is the series of the outing (`useWeatherStore`), when fetched. */
export function prepareOverlayTrack(track: Track, weather?: WeatherSeries | null): OverlayTrack {
  const path = buildTrackPath(track)
  const hasEle = track.stats.maxEle !== undefined
  const speed = concat(
    track.segments.map((s) => metricValues(s.points, 'speed')),
    path.count,
  )
  const heartRate = concat(
    track.segments.map((s) => metricValues(s.points, 'heartRate')),
    path.count,
  )
  const sensor = (metric: 'slope' | 'power' | 'temperature') =>
    concat(
      track.segments.map((s) => metricValues(s.points, metric)),
      path.count,
    )
  const ascent = hasEle ? cumulativeAscent(track) : new Float64Array(path.count).fill(Number.NaN)
  const weatherSeries = weather ?? undefined
  // figures corrected by hand (« Corriger les chiffres ») replace those of the points on the cards
  const o = track.statsOverride ?? {}
  return {
    name: track.name,
    path,
    weatherSeries,
    ascent,
    speed,
    heartRate,
    slope: sensor('slope'),
    power: sensor('power'),
    temperature: sensor('temperature'),
    profile: path.count > 0 ? elevationProfile(path, OVERLAY_PROFILE_SAMPLES) : undefined,
    outline: miniMapOutline(path),
    stats: {
      distanceM: o.distanceM ?? path.lengthM,
      ascentM: o.ascentM ?? (hasEle ? track.stats.ascentM : undefined),
      descentM: hasEle ? track.stats.descentM : undefined,
      maxEleM: o.maxEle ?? track.stats.maxEle,
      minEleM: track.stats.minEle,
      durationS: o.durationS ?? track.stats.durationS,
      maxSpeedKmh: o.maxSpeedKmh ?? maxOf(speed),
      startTime: track.stats.startTime,
      timesEstimated: track.timesEstimated,
      weather: weatherSeries && path.count > 0 ? summarizeOuting(weatherSeries, path) : undefined,
    },
  }
}

/** Last index whose distance is <= d (binary search), the next one and the fraction between them. */
function locate(dist: Float64Array, d: number): { a: number; b: number; t: number } {
  let lo = 0
  let hi = dist.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (dist[mid] <= d) lo = mid
    else hi = mid - 1
  }
  const b = Math.min(dist.length - 1, lo + 1)
  const span = dist[b] - dist[lo]
  return { a: lo, b, t: span > 0 ? (d - dist[lo]) / span : 0 }
}

/** Linear interpolation; the known side when the other one is NaN; undefined when both are. */
function lerpKnown(values: Float64Array, a: number, b: number, t: number): number | undefined {
  const va = values[a]
  const vb = values[b]
  if (Number.isNaN(va)) return Number.isNaN(vb) ? undefined : vb
  if (Number.isNaN(vb)) return va
  return va + (vb - va) * t
}

/** Overlay values at `progress` (clamped to [0, 1]) of the flyover, which runs at constant ground speed. */
/**
 * Recorded instant under the marker at `progress` (ms since epoch), at the distance `overlayFrameAt` gives it;
 * undefined for an untimed track. What a video clip following the flight shows (`clipTimeS`), the same for the
 * drawing and for the frames decoded by the export.
 */
export function recordedAtProgress(path: TrackPath, progress: number): number | undefined {
  if (path.count === 0) return undefined
  return recordedTimeAt(path, Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * path.lengthM)
}

export function overlayFrameAt(data: OverlayTrack, progress: number): OverlayFrame {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0))
  const { path } = data
  const distanceM = p * path.lengthM
  const frame: OverlayFrame = { progress: p, track: data, distanceM }
  if (path.count === 0) return frame

  const { a, b, t } = locate(path.dist, distanceM)
  const sample = samplePath(path, distanceM)
  frame.ele = sample.ele
  const { outline } = data
  if (outline) frame.mapPoint = { x: (sample.lon - outline.west) * outline.kx, y: (outline.north - sample.lat) * outline.ky }
  frame.ascentM = lerpKnown(data.ascent, a, b, t)
  frame.speedKmh = lerpKnown(data.speed, a, b, t)
  frame.heartRate = lerpKnown(data.heartRate, a, b, t)
  frame.slopePct = lerpKnown(data.slope, a, b, t)
  frame.powerW = lerpKnown(data.power, a, b, t)
  frame.temperatureC = lerpKnown(data.temperature, a, b, t)
  if (data.stats.startTime !== undefined) {
    const start = recordedTimeAt(path, 0)
    const now = recordedTimeAt(path, distanceM)
    if (start !== undefined && now !== undefined) frame.elapsedS = Math.max(0, (now - start) / 1000)
    if (now !== undefined) frame.clockMs = now
  }
  if (data.weatherSeries) frame.weather = weatherWidgetData(data.weatherSeries, path, p)
  return frame
}

/** Overlay data of the film: its track, and « À la suite » the sequence and each stage's own data. */
export interface OverlayFilm {
  whole: OverlayTrack
  sequence?: Sequence
  stages?: readonly OverlayTrack[]
  /** « Bilan »: the figures of the stages before each stage (`figuresBefore`) */
  before?: readonly OutingFigures[]
}

/**
 * `prepareOverlayTrack` of the film track, and of every stage of a sequence « À la suite ». `weather` is the series of
 * the track `weatherTrackId` (the first track of the list; absent: the first stage's), `stageWeather` those of the
 * others by track id (weather store).
 */
export function prepareOverlayFilm(
  track: Track,
  sequence: Sequence | null,
  weather?: WeatherSeries | null,
  stageWeather?: Readonly<Record<string, { series: WeatherSeries | null }>>,
  weatherTrackId?: string | null,
): OverlayFilm {
  if (!sequence) return { whole: prepareOverlayTrack(track, weather) }
  // a « Bilan » has no weather per outing: the first track's series would land on whichever stage has its id
  const stages = sequence.stages.map((s) =>
    prepareOverlayTrack(s.track, sequence.bilan ? undefined : (weatherTrackId === undefined ? s.index === 0 : s.track.id === weatherTrackId) ? weather : stageWeather?.[s.track.id]?.series),
  )
  const whole = prepareOverlayTrack(track)
  if (sequence.bilan) return { whole: { ...whole, stats: bilanStats(whole.stats, sequence) }, sequence, stages, before: figuresBefore(sequence.stages.map((s) => s.track)) }
  return { whole: { ...whole, stats: sequenceStats(whole.stats, sequence, stages) }, sequence, stages }
}

/** The figures of a « Bilan »: what the outings add up to (not what the sequence's points say: its time would span the year), the highest point, how many. */
function bilanStats(stats: OverlayTrackStats, sequence: Sequence): OverlayTrackStats {
  const total = addFigures(sequence.stages.map((s) => outingFigures(s.track)))
  const first = sequence.stages.find((s) => s.track.stats.startTime !== undefined)
  return {
    ...stats,
    distanceM: total.distanceM,
    ascentM: total.ascentM,
    durationS: total.durationS,
    maxEleM: total.maxEleM,
    startTime: first?.track.stats.startTime,
    outings: sequence.stages.length,
  }
}

/**
 * Figures of the whole sequence with the corrections of its stages: each corrected sum (distance, D+, time) moved by
 * the stage's correction, the highest point and speed taken over the stages as corrected.
 */
function sequenceStats(stats: OverlayTrackStats, sequence: Sequence, stages: readonly OverlayTrack[]): OverlayTrackStats {
  const corrected = sequence.stages.filter((s) => s.track.statsOverride)
  if (corrected.length === 0) return stats
  const out = { ...stats }
  for (const { track, index } of corrected) {
    const o = track.statsOverride ?? {}
    const hasEle = track.stats.maxEle !== undefined
    if (o.distanceM !== undefined) out.distanceM += o.distanceM - stages[index].path.lengthM
    if (o.ascentM !== undefined) out.ascentM = (out.ascentM ?? 0) + o.ascentM - (hasEle ? track.stats.ascentM : 0)
    if (o.durationS !== undefined) out.durationS = (out.durationS ?? 0) + o.durationS - (track.stats.durationS ?? 0)
  }
  const highest = (of: (s: OverlayTrackStats) => number | undefined) => {
    const values = stages.flatMap((s) => (of(s.stats) === undefined ? [] : [of(s.stats) as number]))
    return values.length > 0 ? Math.max(...values) : undefined
  }
  if (corrected.some((s) => s.track.statsOverride?.maxEle !== undefined)) out.maxEleM = highest((s) => s.maxEleM)
  if (corrected.some((s) => s.track.statsOverride?.maxSpeedKmh !== undefined)) out.maxSpeedKmh = highest((s) => s.maxSpeedKmh)
  return out
}

/**
 * Overlay values at film `progress`: those of the film track, or « À la suite » those of the stage under the marker
 * (its own distance, D+, time, profile and mini-map) with the name and figures of the whole sequence for the opening
 * and closing cards.
 */
export function overlayFilmFrameAt(film: OverlayFilm, progress: number): OverlayFrame {
  if (!film.sequence || !film.stages) return overlayFrameAt(film.whole, progress)
  const at = stageAt(film.sequence, Number.isFinite(progress) ? progress : 0)
  const frame = overlayFrameAt(film.stages[at.stage.index], at.progress)
  const out = { ...frame, track: { ...frame.track, name: film.whole.name, stats: film.whole.stats } }
  const before = film.before?.[at.stage.index]
  return before ? { ...out, cumul: cumulAt(before, film.sequence.stages[at.stage.index].track, at.stage.index, frame) } : out
}

/**
 * The figures of a « Bilan » at a frame: the outings before it (their corrected figures), and the one being drawn up to the
 * marker, scaled to its own corrected figures so that the count does not jump at the cut: what the points say of the part
 * drawn × corrected figure / what the points say of the whole outing.
 */
function cumulAt(before: OutingFigures, track: Track, index: number, frame: OverlayFrame): BilanCumul {
  const own = outingFigures(track)
  const scaled = (now: number | undefined, corrected: number | undefined, recorded: number | undefined) =>
    now === undefined ? undefined : corrected !== undefined && recorded !== undefined && recorded > 0 ? (now * corrected) / recorded : now
  const live = {
    distanceM: scaled(frame.distanceM, own.distanceM, frame.track.path.lengthM) ?? 0,
    ascentM: scaled(frame.ascentM, own.ascentM, track.stats.maxEle === undefined ? undefined : track.stats.ascentM),
    durationS: scaled(frame.elapsedS, own.durationS, track.stats.durationS),
  }
  const known = (sum: number | undefined, now: number | undefined) => (sum === undefined && now === undefined ? undefined : (sum ?? 0) + (now ?? 0))
  return {
    outings: index + 1,
    distanceM: before.distanceM + live.distanceM,
    ascentM: known(before.ascentM, live.ascentM),
    durationS: known(before.durationS, live.durationS),
  }
}

/** How long the card of a stage stays by default (seconds at ×1). */
export const STAGE_CARD_S = JUNCTION_CARD_DEFAULT_S

/**
 * Card of the stage starting at film time `time.timeS` « À la suite »: the first one with the flight, each other at
 * its cut (`time.cutsS`, the middle of the junction before it), until the card's own duration (`film`: `junctionCardOf`,
 * STAGE_CARD_S by default) after the stage's flight starts (the end of that junction), but not past the start of the
 * junction that follows; null outside these windows or when the card is switched off (`stageCardWindow`).
 */
export function stageCardAt(
  sequence: Sequence,
  time: OverlayTime,
  film: Pick<Film, 'junctions' | 'junctionDefault' | 'firstCard'> = {},
  weatherOf: (stage: number) => WeatherSummary | undefined = () => undefined,
): StageCard | null {
  const starts = [time.openingS, ...(time.cutsS ?? [])]
  let k = starts.length - 1
  while (k >= 0 && time.timeS < starts[k]) k--
  // a « Bilan » has a card for each region, once there are several: it belongs to the first outing of the region and outlasts it
  const { bilan } = sequence
  const region = bilan && sequence.stages[k] ? bilan.plan.regions[bilan.plan.regionOf[k]] : undefined
  if (bilan && (!region || bilan.plan.regions.length < 2)) return null
  if (region) k = region.firstStage
  const stage = sequence.stages[k]
  if (!stage) return null
  // a « Bilan » has the common card only: the cards left by « À la suite » on its junctions do not apply
  const own = bilan ? junctionCardOf({ junctionDefault: film.junctionDefault }, null) : junctionCardOf(film, k === 0 ? null : sequence.stages[k - 1].track.id)
  if (!own.enabled) return null
  const flightS = k === 0 ? starts[0] : (time.junctions?.[k - 1]?.endS ?? starts[k])
  // a region's card is cut short by the junction that leaves the region, not by those between its outings
  const lastStage = region ? region.firstStage + region.stageCount - 1 : k
  const durationS = Math.min(flightS + own.durationS, time.junctions?.[lastStage]?.startS ?? Infinity) - starts[k]
  if (!(durationS > 0) || time.timeS >= starts[k] + durationS) return null
  const { stats } = stage.track
  const card: StageCard = {
    name: stage.track.name,
    index: k,
    count: sequence.stages.length,
    distanceM: stage.endM - stage.startM,
    startS: starts[k],
    durationS,
    anchor: own.anchor,
    size: own.size,
    fields: own.fields ?? STAGE_CARD_FIELDS,
  }
  if (stats.startTime !== undefined) card.startTime = stats.startTime
  if (stats.maxEle !== undefined) card.ascentM = stats.ascentM
  if (stats.durationS !== undefined && stats.durationS > 0) card.outingS = stats.durationS
  if (region && bilan) {
    const title = t('overlay.draw.regionTitle', { n: region.index + 1, count: bilan.plan.regions.length })
    card.name = title
    card.index = region.index
    card.count = bilan.plan.regions.length
    card.distanceM = region.figures.distanceM
    card.ascentM = region.figures.ascentM
    delete card.outingS
    if (region.fromMs === undefined) delete card.startTime
    else card.startTime = region.fromMs
    // the card says the region in words: its own title and its figures, unless the film words it
    card.text = title
    card.subtitle = regionLine(region)
  }
  const weather = own.fields?.weather ? weatherOf(k) : undefined
  if (weather) card.weather = weather
  if (own.text !== undefined) card.text = own.text
  if (own.subtitle !== undefined) card.subtitle = own.subtitle
  if (own.color !== undefined) card.color = own.color
  if (own.font !== undefined) card.font = own.font
  return card
}

/** « 12 sorties · 240 km · D+ 5 200 m · mars – juin 2026 »: what a region of a « Bilan » comes to. */
function regionLine(region: BilanRegion): string {
  const { figures } = region
  const month = (ms: number) => formatDate(ms, { month: 'long', year: 'numeric' })
  const period = region.fromMs === undefined || region.toMs === undefined ? '' : month(region.fromMs) === month(region.toMs) ? month(region.fromMs) : `${month(region.fromMs)} – ${month(region.toMs)}`
  const ascent = figures.ascentM === undefined ? '' : t('overlay.draw.regionAscent', { ascent: formatNumber(figures.ascentM) })
  return [t('overlay.draw.regionOutings', { count: region.stageCount }), formatDistance(figures.distanceM), ascent, period].filter(Boolean).join(' · ')
}

/**
 * Card of the day starting at film time `time.timeS` in a multi-day track: the card of the day whose start
 * (`time.dayCardsS`) is the latest one passed, for the film's duration, never past the start of the next day; null
 * outside the window or when the days have no cards. `figures` are those of the days (`dayFigures`).
 */
export function dayCardAt(figures: readonly DayFigures[], time: OverlayTime, cards: Pick<FilmDayCards, 'enabled' | 'durationS' | 'anchor' | 'size' | 'fields' | 'title'> | undefined): DayCard | null {
  const starts = time.dayCardsS
  if (!cards?.enabled || !starts || starts.length === 0 || figures.length !== starts.length) return null
  let k = starts.length - 1
  while (k >= 0 && time.timeS < starts[k]) k--
  if (k < 0) return null
  const durationS = Math.min(cards.durationS, (starts[k + 1] ?? Infinity) - starts[k])
  if (!(durationS > 0) || time.timeS >= starts[k] + durationS) return null
  const card: DayCard = { figures: figures[k], startS: starts[k], durationS, anchor: cards.anchor, size: cards.size, fields: cards.fields }
  if (cards.title !== undefined && cards.title.trim() !== '') card.title = cards.title
  return card
}

export interface CreditSources {
  terrainSourceId: string
  imagerySourceId: string
  /** the weather of the outing is loaded (Open-Meteo) */
  weather: boolean
  /** OpenStreetMap data is shown (landmarks, water, forests, glaciers or region) */
  landmarks: boolean
  /** OpenStreetMap water (sea, lakes, rivers) is drawn: the credit then names it too */
  water?: boolean
  /** OpenStreetMap forests are drawn */
  forests?: boolean
  /** OpenStreetMap glaciers are drawn */
  glaciers?: boolean
}

/** One credit: its sentence and the page that states the attribution (for the description of a video). */
export interface CreditEntry {
  line: string
  url: string
}

/** Attribution page of each source of `terrain/sources.ts` (as recorded in `docs/sources.md`). */
const SOURCE_PAGES: Readonly<Record<string, string>> = {
  mapterhorn: 'https://mapterhorn.com/attribution',
  'aws-terrarium': 'https://registry.opendata.aws/terrain-tiles/',
  'ign-ortho': 'https://cartes.gouv.fr/cgu',
  'ign-plan': 'https://cartes.gouv.fr/cgu',
  swisstopo: 'https://www.geo.admin.ch/en/general-terms-of-use-fsdi',
  'swisstopo-carte': 'https://www.geo.admin.ch/en/general-terms-of-use-fsdi',
  'arcgis-world-imagery': 'https://developers.arcgis.com/documentation/mapping-apis-and-services/deployment/basemap-attribution/',
  'basemap-at': 'https://basemap.at/',
  'gsi-photo': 'https://maps.gsi.go.jp/development/ichiran.html',
  'usgs-imagery': 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  opentopomap: 'https://opentopomap.org/about',
}
const OSM_PAGE = 'https://www.openstreetmap.org/copyright'
const OPEN_METEO_PAGE = 'https://open-meteo.com/en/licence'

/** The OpenStreetMap credit, naming the layers drawn: « Repères, eau, forêts et glaciers : © contributeurs OpenStreetMap (ODbL) ». */
function osmCreditLine({ water, forests, glaciers }: CreditSources): string {
  const layers = [
    t('overlay.draw.credits.layer.landmarks'),
    ...(water ? [t('overlay.draw.credits.layer.water')] : []),
    ...(forests ? [t('overlay.draw.credits.layer.forests')] : []),
    ...(glaciers ? [t('overlay.draw.credits.layer.glaciers')] : []),
  ]
  return t('overlay.draw.credits.osm', { layers: formatList(layers), source: osmAttribution() })
}

/**
 * Credits of the sources in the film, the same strings as the status bar: relief and imagery always, Open-Meteo
 * and OpenStreetMap when their data is loaded; each with its attribution page.
 */
export function creditEntries(sources: CreditSources): CreditEntry[] {
  const terrain = getTerrainSource(sources.terrainSourceId)
  const imagery = getImagerySource(sources.imagerySourceId)
  return [
    { line: t('overlay.draw.credits.relief', { source: terrain.attribution }), url: SOURCE_PAGES[terrain.id] ?? '' },
    { line: t('overlay.draw.credits.imagery', { source: imagery.attribution }), url: SOURCE_PAGES[imagery.id] ?? '' },
    ...(sources.weather ? [{ line: openMeteoAttribution(), url: OPEN_METEO_PAGE }] : []),
    ...(sources.landmarks ? [{ line: osmCreditLine(sources), url: OSM_PAGE }] : []),
  ]
}

/** The full credits: one sentence per source. */
export const overlayCredits = (sources: CreditSources): string[] => creditEntries(sources).map((entry) => entry.line)

/** Short credit of Open-Meteo (CC BY 4.0: the name of the service; its link is in the description and the end credits). */
export const OPEN_METEO_SHORT = 'Open-Meteo.com'
const OSM_SHORT = '© OpenStreetMap'

/** Sources whose terms ask for their credit to stay visible with the map, whatever is chosen for the film (Esri). */
const PERMANENT_CREDIT: ReadonlySet<string> = new Set(['arcgis-world-imagery'])

/** Short form of the credit of each source whose full attribution is longer than what its terms ask for in the film. */
const SHORT_CREDITS: Readonly<Record<string, string>> = {
  mapterhorn: '© Mapterhorn',
  'aws-terrarium': 'Terrain Tiles (Mapzen / AWS)',
  'ign-ortho': '© IGN',
  'ign-plan': '© IGN',
  swisstopo: '© swisstopo',
  'swisstopo-carte': '© swisstopo',
  'gsi-photo': 'Source: GSI Japan',
  'usgs-imagery': 'USDA, USGS The National Map',
  // CC BY-SA: the licence stays named; the map data are OpenStreetMap's and SRTM
  opentopomap: `${OSM_SHORT}, SRTM · © OpenTopoMap (CC BY-SA)`,
}

/**
 * Short form of the credits, for the film: the names of the holders only, imagery first (« © IGN · © Mapterhorn ·
 * © OpenStreetMap · Open-Meteo.com »). A source whose terms ask for more keeps its attribution (Esri: « Powered by
 * Esri » and the data providers); the full sentences close the film (`overlayCredits`).
 */
export function overlayShortCredits(sources: CreditSources): string[] {
  const imagery = getImagerySource(sources.imagerySourceId)
  const terrain = getTerrainSource(sources.terrainSourceId)
  const items = [
    SHORT_CREDITS[imagery.id] ?? imagery.attribution,
    SHORT_CREDITS[terrain.id] ?? terrain.attribution,
    ...(sources.landmarks ? [OSM_SHORT] : []),
    ...(sources.weather ? [OPEN_METEO_SHORT] : []),
  ]
  // OpenTopoMap's credit already names OpenStreetMap
  const namesOsm = items.some((item) => item.startsWith(`${OSM_SHORT},`))
  return items.filter((item, i) => items.indexOf(item) === i && !(namesOsm && item === OSM_SHORT))
}

/** Short credits of the sources whose terms ask for a permanent credit on the map (`PERMANENT_CREDIT`): kept in the corner even with « À la fin seulement ». */
export function overlayPermanentCredits(sources: CreditSources): string[] {
  return [getImagerySource(sources.imagerySourceId), getTerrainSource(sources.terrainSourceId)]
    .filter((source, i, all) => PERMANENT_CREDIT.has(source.id) && all.indexOf(source) === i)
    .map((source) => SHORT_CREDITS[source.id] ?? source.attribution)
}

/**
 * The credits as text to paste in the description of a video: each sentence, then the page that states it
 * (OpenStreetMap and Mapterhorn ask for their page when the credit is in the end credits or the description).
 */
export function creditsDescription(sources: CreditSources): string {
  const lines = creditEntries(sources).flatMap((entry) => (entry.url ? [entry.line, entry.url, ''] : [entry.line, '']))
  return lines.join('\n').trimEnd()
}

/** One line of the ghost-race leaderboard. */
export interface LeaderboardRow {
  /** 1 for the first; racers at the same point with the same gap share a rank (1, 1, 3) */
  rank: number
  name: string
  color: string
  /** gap to the first: « +1 min 20 » (time) or « −350 m » (distance); « Tête », then « Arrivée », for the first */
  gap: string
}

/** Racers this close in fraction stand at the same point (as `rankRacers`). */
const SAME_FRACTION = 1e-9

/**
 * Leaderboard of the ghost race from the racers at one progress (`raceAt`): ranked by `rankRacers`, each with the
 * colour and name of its track and its gap to the first of the board. The gaps of `raceAt` are to the lead track
 * (the one the camera follows): the gap to the first is their difference, in time when the race has time gaps,
 * else in distance.
 */
export function leaderboardRows(racers: readonly Racer[], tracks: readonly Pick<Track, 'name' | 'color'>[]): LeaderboardRow[] {
  const ranked = rankRacers(racers)
  const first = ranked[0]
  if (!first) return []
  const timed = ranked.some((r) => r.gapMs !== undefined)
  const gapToFirst = (r: Racer) => (timed ? (r.gapMs ?? 0) - (first.gapMs ?? 0) : (r.gapM ?? 0) - (first.gapM ?? 0))
  let rank = 0
  return ranked.map((racer, i) => {
    const gap = gapToFirst(racer)
    const previous = ranked[i - 1]
    const tied = i > 0 && Math.abs(previous.fraction - racer.fraction) <= SAME_FRACTION && gapToFirst(previous) === gap
    if (!tied) rank = i + 1
    const { name, color } = tracks[racer.index]
    const gapText = timed ? formatTimeGap(gap) : formatDistanceGap(gap)
    return { rank, name, color, gap: rank === 1 ? (racer.finished ? t('overlay.draw.race.finished') : t('overlay.draw.race.lead')) : gapText }
  })
}
