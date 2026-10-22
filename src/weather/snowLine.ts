/**
 * Snow line of the day (« Neige » › « Selon la météo du jour »): the altitude above which the ground is white, from
 * the hourly weather of the stations along the track (`WeatherSeries`, Open-Meteo).
 *
 * The rule, in one paragraph. Over the UTC day of the instant, at each station: the mean air temperature `T` (already
 * downscaled to the station's elevation `E`), the deepest snow on the ground `D` and the snowfall total `F`. No snow on
 * the ground and none falling: no snow (nothing says there is any, whatever the cold). Otherwise the snow line is where
 * the mean air temperature reaches 0 °C, `E + T / 6.5 °C per 1000 m`; when the ground at the station holds at least
 * `SETTLED_SNOW_M` (2 cm) of snow, it cannot be above the station: the line is the lower of the two. A settled cover (20 cm
 * and more) has a sharper limit (150 m transition) than patches or a fresh fall (300 m). A station without elevation, with
 * fewer than 12 hours of temperature or without snow depth data is unknown (and counts for nothing).
 *
 * The line varies smoothly: the stations are weighted by inverse squared distance (as `weatherAt`), and a day gives way to
 * the next over the hour before and after midnight UTC (the local day is not used: the response's UTC offset is not kept).
 *
 * Limits: the snow depth is the model's (a ~9 km cell chosen near the station's elevation), the mean temperature of
 * the day hides the night frost and the afternoon thaw, one line serves the whole view (no sun/shade or wind drift),
 * and permanent snow above a line the weather does not reach (glaciers in summer) is not drawn.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import { clamp } from '../core/math'
import { haversineM } from '../geo/lonLat'
import { recordedTimeAt, samplePath, type TrackPath } from '../flyover/path'
import { MIN_STATION_DISTANCE_M, type WeatherSeries, type WeatherStation } from './series'

/** Air cooling with altitude (°C per metre): the standard atmosphere, 6.5 °C per 1000 m. */
export const LAPSE_RATE_C_PER_M = 0.0065
/** Snow on the ground (metres) from which it is taken to lie at the station itself. */
export const SETTLED_SNOW_M = 0.02
/** Snow depth (metres) of a settled cover, whose limit is sharper. */
export const DEEP_SNOW_M = 0.2
/** Snowfall (cm over the day) that counts as snow in the air. */
export const SNOWFALL_MIN_CM = 0.1
/** Width of the transition from bare ground to snow (metres, centred on the line). */
export const BAND_SETTLED_M = 150
export const BAND_PATCHY_M = 300
/** Hours of valid temperature a day needs for its mean to count. */
const MIN_TEMPERATURE_HOURS = 12
const HOURS_PER_DAY = 24
const MAX_LINE_M = 6000

export interface SnowLine {
  /** altitude above sea level (metres) above which there is snow, not exaggerated */
  snowLineM: number
  /** width of the transition (metres, centred on `snowLineM`) */
  bandM: number
}

/** Why the weather cannot tell: the station has no elevation, or the day lacks temperature or snow data. */
export type SnowUnknown = 'altitude' | 'data'

/** What the weather says of the snow: a line, none (`line` and `unknown` null), or unknown. */
export interface SnowReading {
  line: SnowLine | null
  unknown: SnowUnknown | null
}

const NO_SNOW: SnowReading = { line: null, unknown: null }

/** Daily figures of one station (NaN or missing hours skipped). */
export interface SnowDayInput {
  /** elevation of the station (metres), undefined = unknown */
  eleM: number | undefined
  /** hourly air temperature, snow depth (m) and snowfall (cm) of the day */
  temperatureC: readonly number[]
  snowDepthM: readonly number[]
  snowfallCm: readonly number[]
}

/**
 * The snow of one day at one station. Unknown without elevation, with fewer than 12 hours of temperature or without
 * any snow depth (a weather loaded before the snow depth was kept, or a response without it).
 */
export function snowOfDay({ eleM, temperatureC, snowDepthM, snowfallCm }: SnowDayInput): SnowReading {
  if (eleM === undefined || !Number.isFinite(eleM)) return { line: null, unknown: 'altitude' }
  const temperatures = temperatureC.filter(Number.isFinite)
  const depths = snowDepthM.filter(Number.isFinite)
  if (temperatures.length < MIN_TEMPERATURE_HOURS || depths.length === 0) return { line: null, unknown: 'data' }
  const fall = snowfallCm.filter(Number.isFinite).reduce((sum, x) => sum + x, 0)
  const depthM = Math.max(...depths)
  // no snow on the ground or in the air: no snow, however cold
  if (depthM <= 0 && fall < SNOWFALL_MIN_CM) return NO_SNOW
  const meanC = temperatures.reduce((sum, x) => sum + x, 0) / temperatures.length
  const freezingM = eleM + meanC / LAPSE_RATE_C_PER_M
  const lineM = depthM >= SETTLED_SNOW_M ? Math.min(eleM, freezingM) : freezingM
  return { line: { snowLineM: clamp(lineM, 0, MAX_LINE_M), bandM: depthM >= DEEP_SNOW_M ? BAND_SETTLED_M : BAND_PATCHY_M }, unknown: null }
}

const HOUR_MS = 3_600_000
const DAY_MS = HOURS_PER_DAY * HOUR_MS
/** The snow of a day gives way to the next one over this long on each side of midnight UTC (hours). */
const MIDNIGHT_RAMP_H = 1

const cache = new WeakMap<WeatherStation, Map<number, SnowReading>>()

/** The snow at `station` over day number `day` of the series (UTC days from its first midnight), memoised. */
function stationDay(station: WeatherStation, day: number): SnowReading {
  let byDay = cache.get(station)
  if (!byDay) cache.set(station, (byDay = new Map()))
  let reading = byDay.get(day)
  if (!reading) {
    const hours = (values: readonly number[]) => values.slice(day * HOURS_PER_DAY, (day + 1) * HOURS_PER_DAY)
    reading = snowOfDay({
      eleM: station.ele,
      temperatureC: hours(station.values.temperature),
      snowDepthM: hours(station.values.snowDepth),
      snowfallCm: hours(station.values.snowfall),
    })
    byDay.set(day, reading)
  }
  return reading
}

/** Blend of readings (weights ≥ 0): no snow counts as a line above every summit; unknown ones are left out. */
function blend(parts: readonly { reading: SnowReading; weight: number }[]): SnowReading {
  let weight = 0
  let lineM = 0
  let bandM = 0
  let snowy = false
  for (const { reading, weight: w } of parts) {
    if (reading.unknown || w <= 0) continue
    weight += w
    lineM += w * (reading.line?.snowLineM ?? MAX_LINE_M)
    bandM += w * (reading.line?.bandM ?? BAND_PATCHY_M)
    snowy ||= reading.line !== null
  }
  if (weight === 0) return { line: null, unknown: parts.find((p) => p.reading.unknown)?.reading.unknown ?? null }
  return snowy ? { line: { snowLineM: lineM / weight, bandM: bandM / weight }, unknown: null } : NO_SNOW
}

/**
 * The snow at one station at `timeMs`: that of its UTC day, one day giving way to the next linearly over the hour
 * before and the hour after midnight (the line must not jump in one frame). Days outside the series are its first and last.
 */
function stationSnow(series: WeatherSeries, station: WeatherStation, timeMs: number): SnowReading {
  const days = Math.floor(series.time.length / HOURS_PER_DAY)
  if (days === 0) return NO_SNOW
  const f = (timeMs - series.time[0]) / DAY_MS
  const day = Math.floor(f)
  const x = (f - day) * HOURS_PER_DAY
  const at = (d: number) => stationDay(station, clamp(d, 0, days - 1))
  if (x < MIDNIGHT_RAMP_H) {
    const next = 0.5 + x / (2 * MIDNIGHT_RAMP_H)
    return blend([{ reading: at(day - 1), weight: 1 - next }, { reading: at(day), weight: next }])
  }
  if (x > HOURS_PER_DAY - MIDNIGHT_RAMP_H) {
    const next = (x - (HOURS_PER_DAY - MIDNIGHT_RAMP_H)) / (2 * MIDNIGHT_RAMP_H)
    return blend([{ reading: at(day), weight: 1 - next }, { reading: at(day + 1), weight: next }])
  }
  return at(day)
}

/**
 * The snow at `timeMs` and (lon, lat): the stations weighted by inverse squared distance like `weatherAt` (the line must not
 * jump where the nearest station changes), each at its day (`stationSnow`).
 */
export function snowLineAt(series: WeatherSeries, timeMs: number, lon: number, lat: number): SnowReading {
  const parts = series.stations.map((station) => {
    const d = Math.max(MIN_STATION_DISTANCE_M, haversineM({ lon, lat }, station))
    return { reading: stationSnow(series, station, timeMs), weight: 1 / (d * d) }
  })
  return parts.length > 0 ? blend(parts) : NO_SNOW
}

/** `snowLineAt` where the marker is at `progress` (0..1) of `path`; null when the path has no recorded time. */
export function snowLineAtProgress(series: WeatherSeries, path: TrackPath, progress: number): SnowReading {
  if (path.count === 0) return NO_SNOW
  const d = clamp(progress, 0, 1) * path.lengthM
  const timeMs = recordedTimeAt(path, d)
  if (timeMs === undefined) return NO_SNOW
  const { lon, lat } = samplePath(path, d)
  return snowLineAt(series, timeMs, lon, lat)
}

/** The user setting (`settings.snow`). */
export const SNOW_MODES = ['meteo', 'manuelle', 'aucune'] as const
export type SnowMode = (typeof SNOW_MODES)[number]

export interface SnowSettings {
  /** 'meteo': the snow line of the day's weather; 'manuelle': `lineM`; 'aucune': no snow */
  mode: SnowMode
  /** manual snow line (metres above sea level, before the exaggeration) */
  lineM: number
}

export const DEFAULT_SNOW: SnowSettings = { mode: 'meteo', lineM: 2000 }
/** Range of the manual snow line (metres). */
export const SNOW_LINE_RANGE = { min: 0, max: 4500, step: 50 } as const
/** Transition of the manual snow line (metres). */
export const MANUAL_BAND_M = 200

/** What the scene draws: the manual line, that of the weather (null: none) or nothing. */
export function resolveSnow(settings: SnowSettings, weather: () => SnowLine | null): SnowLine | null {
  if (settings.mode === 'aucune') return null
  if (settings.mode === 'manuelle') return { snowLineM: settings.lineM, bandM: MANUAL_BAND_M }
  return weather()
}

export function isValidSnow(v: SnowSettings): boolean {
  return (SNOW_MODES as readonly string[]).includes(v.mode) && v.lineM >= SNOW_LINE_RANGE.min && v.lineM <= SNOW_LINE_RANGE.max
}
