/**
 * Hourly weather of an outing: the data model shared by the panel, the film overlay and the scene,
 * interpolation at any instant and place, WMO weather codes in French, and the outing summary.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import type { LonLat } from '../core/types'
import { recordedTimeAt, samplePath, type TrackPath } from '../flyover/path'
import { haversineM } from '../geo/lonLat'
import { t } from '../i18n'

export const WEATHER_VARIABLES = [
  'temperature',
  'apparentTemperature',
  'precipitation',
  'rain',
  'snowfall',
  'cloudCover',
  'cloudCoverLow',
  'cloudCoverMid',
  'cloudCoverHigh',
  'windSpeed',
  'windDirection',
  'windGusts',
  'weatherCode',
] as const
export type WeatherVariable = (typeof WEATHER_VARIABLES)[number]

/** One sampled place along the track. */
export interface WeatherStation extends LonLat {
  /** elevation the values were downscaled to (metres); undefined = the provider's own terrain model */
  ele?: number
  /**
   * one value per hour of `WeatherSeries.time`, NaN where missing (°C, mm, cm of snow, %, km/h, degrees the wind
   * blows from, WMO code); precipitation, snowfall and gusts are totals / maxima over the preceding hour
   */
  values: Record<WeatherVariable, number[]>
}

export interface WeatherSeries {
  /** start of each hour (ms since epoch, UTC), ascending, consecutive hours */
  time: number[]
  stations: WeatherStation[]
  /** true when the values are a forecast (outing still to come), not the archive */
  forecast?: boolean
}

/** Every variable at one instant and place (NaN where unknown). */
export type WeatherSample = Record<WeatherVariable, number>

const HOUR_MS = 3_600_000
/** Stations closer than this count as "at" the point (avoids an infinite inverse-distance weight). */
const MIN_STATION_DISTANCE_M = 100

/** Values summed or maxed over the preceding hour: taken from the hour that ends at or after the instant. */
const PERIOD_VARIABLES: ReadonlySet<WeatherVariable> = new Set(['precipitation', 'rain', 'snowfall', 'windGusts', 'weatherCode'])

/** Linear interpolation that falls back on the known end when the other one is NaN. */
export function lerpNaNSafe(a: number, b: number, t: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return a + (b - a) * t
}

/** One station at `timeMs`: instantaneous values interpolated between hours, period values not. */
function stationAt(series: WeatherSeries, station: WeatherStation, timeMs: number): WeatherSample {
  const n = series.time.length
  const f = Math.min(n - 1, Math.max(0, (timeMs - series.time[0]) / HOUR_MS))
  const i0 = Math.floor(f)
  const i1 = Math.min(n - 1, i0 + 1)
  const t = f - i0
  const iPeriod = Math.min(n - 1, Math.ceil(f))
  const out = {} as WeatherSample
  for (const key of WEATHER_VARIABLES) {
    const v = station.values[key]
    out[key] = PERIOD_VARIABLES.has(key) ? v[iPeriod] : lerpNaNSafe(v[i0], v[i1], t)
  }
  // wind direction through its vector, so 350° and 10° average to 0°, not 180°
  const toRad = Math.PI / 180
  const d0 = station.values.windDirection[i0] * toRad
  const d1 = station.values.windDirection[i1] * toRad
  const x = lerpNaNSafe(Math.sin(d0), Math.sin(d1), t)
  const y = lerpNaNSafe(Math.cos(d0), Math.cos(d1), t)
  out.windDirection = Number.isNaN(x) || Number.isNaN(y) ? Number.NaN : normalizeDeg(Math.atan2(x, y) / toRad)
  return out
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Weather at `timeMs` and (lon, lat): linear in time between hours (clamped to the series), inverse distance
 * weighting (power 2) between stations; the weather code comes from the nearest station. Undefined when the
 * series is empty.
 */
export function weatherAt(series: WeatherSeries, timeMs: number, lon: number, lat: number): WeatherSample | undefined {
  return weatherAtTimes(series, [timeMs], lon, lat)?.[0]
}

/** `weatherAt` for several instants at one place (the station weights are computed once). */
export function weatherAtTimes(
  series: WeatherSeries,
  timesMs: readonly number[],
  lon: number,
  lat: number,
): WeatherSample[] | undefined {
  const { stations } = series
  if (stations.length === 0 || series.time.length === 0) return undefined
  const weights = stations.map((s) => {
    const d = Math.max(MIN_STATION_DISTANCE_M, haversineM({ lon, lat }, s))
    return 1 / (d * d)
  })
  let nearest = 0
  for (let k = 1; k < weights.length; k++) if (weights[k] > weights[nearest]) nearest = k
  return timesMs.map((timeMs) => blendStations(series, timeMs, weights, nearest))
}

/** Stations at `timeMs` blended by `weights`, the weather code of the `nearest` one. */
function blendStations(series: WeatherSeries, timeMs: number, weights: readonly number[], nearest: number): WeatherSample {
  const samples = series.stations.map((s) => stationAt(series, s, timeMs))
  const out = {} as WeatherSample
  for (const key of WEATHER_VARIABLES) {
    let sum = 0
    let wSum = 0
    for (let k = 0; k < samples.length; k++) {
      const v = samples[k][key]
      if (Number.isNaN(v)) continue
      sum += v * weights[k]
      wSum += weights[k]
    }
    out[key] = wSum > 0 ? sum / wSum : Number.NaN
  }
  out.weatherCode = samples[nearest].weatherCode
  let x = 0
  let y = 0
  for (let k = 0; k < samples.length; k++) {
    const dir = samples[k].windDirection
    if (Number.isNaN(dir)) continue
    x += Math.sin((dir * Math.PI) / 180) * weights[k]
    y += Math.cos((dir * Math.PI) / 180) * weights[k]
  }
  out.windDirection = x === 0 && y === 0 ? Number.NaN : normalizeDeg((Math.atan2(x, y) * 180) / Math.PI)
  return out
}

// ---------------------------------------------------------------------------
// WMO weather codes
// ---------------------------------------------------------------------------

export type WeatherIcon =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'freezing-rain'
  | 'rain'
  | 'showers'
  | 'snow'
  | 'thunderstorm'
  | 'unknown'

export interface WeatherCondition {
  label: string
  icon: WeatherIcon
}

const WMO_CONDITIONS: Record<number, WeatherCondition> = {
  0: { get label() { return t('weather.wmo.0') }, icon: 'clear' },
  1: { get label() { return t('weather.wmo.1') }, icon: 'mostly-clear' },
  2: { get label() { return t('weather.wmo.2') }, icon: 'partly-cloudy' },
  3: { get label() { return t('weather.wmo.3') }, icon: 'overcast' },
  45: { get label() { return t('weather.wmo.45') }, icon: 'fog' },
  48: { get label() { return t('weather.wmo.48') }, icon: 'fog' },
  51: { get label() { return t('weather.wmo.51') }, icon: 'drizzle' },
  53: { get label() { return t('weather.wmo.53') }, icon: 'drizzle' },
  55: { get label() { return t('weather.wmo.55') }, icon: 'drizzle' },
  56: { get label() { return t('weather.wmo.56') }, icon: 'freezing-rain' },
  57: { get label() { return t('weather.wmo.57') }, icon: 'freezing-rain' },
  61: { get label() { return t('weather.wmo.61') }, icon: 'rain' },
  63: { get label() { return t('weather.wmo.63') }, icon: 'rain' },
  65: { get label() { return t('weather.wmo.65') }, icon: 'rain' },
  66: { get label() { return t('weather.wmo.66') }, icon: 'freezing-rain' },
  67: { get label() { return t('weather.wmo.67') }, icon: 'freezing-rain' },
  71: { get label() { return t('weather.wmo.71') }, icon: 'snow' },
  73: { get label() { return t('weather.wmo.73') }, icon: 'snow' },
  75: { get label() { return t('weather.wmo.75') }, icon: 'snow' },
  77: { get label() { return t('weather.wmo.77') }, icon: 'snow' },
  80: { get label() { return t('weather.wmo.80') }, icon: 'showers' },
  81: { get label() { return t('weather.wmo.81') }, icon: 'showers' },
  82: { get label() { return t('weather.wmo.82') }, icon: 'showers' },
  85: { get label() { return t('weather.wmo.85') }, icon: 'snow' },
  86: { get label() { return t('weather.wmo.86') }, icon: 'snow' },
  95: { get label() { return t('weather.wmo.95') }, icon: 'thunderstorm' },
  96: { get label() { return t('weather.wmo.96') }, icon: 'thunderstorm' },
  99: { get label() { return t('weather.wmo.99') }, icon: 'thunderstorm' },
}

const UNKNOWN_CONDITION: WeatherCondition = { get label() { return t('weather.wmo.unknown') }, icon: 'unknown' }

/** French label and icon id of a WMO weather code (Open-Meteo `weather_code`). */
export function describeWeatherCode(code: number): WeatherCondition {
  return WMO_CONDITIONS[code] ?? UNKNOWN_CONDITION
}

const WIND_SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

/** Direction the wind blows from (degrees) -> "NO" in French, "NW" in English; empty when unknown. */
export function windFromLabel(deg: number): string {
  if (!Number.isFinite(deg)) return ''
  return t(`weather.wind.${WIND_SECTORS[Math.round(normalizeDeg(deg) / 45) % 8]}`)
}

// ---------------------------------------------------------------------------
// Along the track
// ---------------------------------------------------------------------------

/** What a weather widget shows at one flyover progress. */
export interface WeatherWidgetData {
  /** recorded time under the marker (ms since epoch) */
  timeMs: number
  condition: WeatherCondition
  temperatureC: number
  apparentTemperatureC: number
  windSpeedKmh: number
  windGustsKmh: number
  /** where the wind blows from (degrees, 0 = north) and as "NO" */
  windDirectionDeg: number
  windFrom: string
  /** over the hour ending at or after `timeMs` */
  precipitationMm: number
  snowfallCm: number
  cloudCover: number
  sample: WeatherSample
}

/**
 * Weather under the flyover marker at `progress` (0..1) of `path`: the recorded time there (`recordedTimeAt`)
 * and the marker position. Undefined when the path has no time or the series is empty. Pure function of the
 * progress, for the film overlay as for the panel.
 */
export function weatherWidgetData(series: WeatherSeries, path: TrackPath, progress: number): WeatherWidgetData | undefined {
  if (path.count === 0) return undefined
  const d = Math.min(1, Math.max(0, progress)) * path.lengthM
  const timeMs = recordedTimeAt(path, d)
  if (timeMs === undefined) return undefined
  const { lon, lat } = samplePath(path, d)
  const sample = weatherAt(series, timeMs, lon, lat)
  if (!sample) return undefined
  return {
    timeMs,
    condition: describeWeatherCode(sample.weatherCode),
    temperatureC: sample.temperature,
    apparentTemperatureC: sample.apparentTemperature,
    windSpeedKmh: sample.windSpeed,
    windGustsKmh: sample.windGusts,
    windDirectionDeg: sample.windDirection,
    windFrom: windFromLabel(sample.windDirection),
    precipitationMm: sample.precipitation,
    snowfallCm: sample.snowfall,
    cloudCover: sample.cloudCover,
    sample,
  }
}

export interface WeatherSummary {
  minTemperatureC: number
  maxTemperatureC: number
  /** total over the outing (mm of water, cm of snow) */
  precipitationMm: number
  snowfallCm: number
  maxWindKmh: number
  maxGustsKmh: number
  /** condition that lasted longest */
  dominant: WeatherCondition
}

/**
 * Outing summary: the weather is sampled where the track was at each moment (`samples` + 1 evenly spaced
 * distances); totals and the dominant condition are weighted by the recorded time between samples, so a long
 * pause counts for its duration. Undefined when the path has no time or the series is empty.
 */
export function summarizeOuting(series: WeatherSeries, path: TrackPath, samples = 200): WeatherSummary | undefined {
  if (path.count === 0) return undefined
  let minT = Infinity
  let maxT = -Infinity
  let precipitationMm = 0
  let snowfallCm = 0
  let maxWindKmh = 0
  let maxGustsKmh = 0
  const durationByLabel = new Map<string, { condition: WeatherCondition; ms: number }>()
  let first: WeatherCondition | undefined
  let prevTime: number | undefined
  for (let i = 0; i <= samples; i++) {
    const d = (i / samples) * path.lengthM
    const timeMs = recordedTimeAt(path, d)
    if (timeMs === undefined) return undefined
    const { lon, lat } = samplePath(path, d)
    const w = weatherAt(series, timeMs, lon, lat)
    if (!w) return undefined
    if (w.temperature < minT) minT = w.temperature
    if (w.temperature > maxT) maxT = w.temperature
    if (w.windSpeed > maxWindKmh) maxWindKmh = w.windSpeed
    if (w.windGusts > maxGustsKmh) maxGustsKmh = w.windGusts
    const condition = describeWeatherCode(w.weatherCode)
    first ??= condition
    const dt = prevTime === undefined ? 0 : Math.max(0, timeMs - prevTime)
    prevTime = timeMs
    if (dt === 0) continue
    // hourly totals are rates in mm/h (cm/h): integrate over the time spent
    if (!Number.isNaN(w.precipitation)) precipitationMm += (w.precipitation * dt) / HOUR_MS
    if (!Number.isNaN(w.snowfall)) snowfallCm += (w.snowfall * dt) / HOUR_MS
    const entry = durationByLabel.get(condition.label)
    if (entry) entry.ms += dt
    else durationByLabel.set(condition.label, { condition, ms: dt })
  }
  let dominant = first ?? UNKNOWN_CONDITION
  let best = 0
  for (const { condition, ms } of durationByLabel.values()) {
    if (ms > best) {
      best = ms
      dominant = condition
    }
  }
  return {
    minTemperatureC: Number.isFinite(minT) ? minT : Number.NaN,
    maxTemperatureC: Number.isFinite(maxT) ? maxT : Number.NaN,
    precipitationMm,
    snowfallCm,
    maxWindKmh,
    maxGustsKmh,
    dominant,
  }
}
