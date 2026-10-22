/**
 * Snow line of the day (« Neige » › « Selon la météo du jour »): the altitude above which the ground is white, from
 * the hourly weather of the station nearest the marker (`WeatherSeries`, Open-Meteo).
 *
 * The rule, in one paragraph. Over the UTC day of the instant: the mean air temperature `T` (already downscaled to the
 * station's elevation `E`), the deepest snow on the ground `D` and the snowfall total `F`. No snow depth and no
 * snowfall: no snow (nothing says there is any, whatever the cold). Otherwise the snow line is where the mean air
 * temperature reaches 0 °C, `E + T / 6.5 °C per 1000 m`; when the ground at the station holds at least `SETTLED_SNOW_M`
 * (2 cm) of snow, it cannot be above the station: the line is the lower of the two. A settled cover (20 cm and more)
 * has a sharper limit (150 m transition) than patches or a fresh fall (300 m). Missing data, or a station without
 * elevation, gives no snow line.
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
import type { WeatherSeries, WeatherStation } from './series'

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

/** Daily figures of one station (NaN or missing hours skipped). */
export interface SnowDayInput {
  /** elevation of the station (metres), undefined = unknown */
  eleM: number | undefined
  /** hourly air temperature, snow depth (m) and snowfall (cm) of the day */
  temperatureC: readonly number[]
  snowDepthM: readonly number[]
  snowfallCm: readonly number[]
}

/** The snow line of one day at one station, null when there is no snow or the data does not say. */
export function snowLineOfDay({ eleM, temperatureC, snowDepthM, snowfallCm }: SnowDayInput): SnowLine | null {
  if (eleM === undefined || !Number.isFinite(eleM)) return null
  const temperatures = temperatureC.filter(Number.isFinite)
  if (temperatures.length < MIN_TEMPERATURE_HOURS) return null
  const depths = snowDepthM.filter(Number.isFinite)
  const fall = snowfallCm.filter(Number.isFinite).reduce((sum, x) => sum + x, 0)
  const depthM = depths.length > 0 ? Math.max(...depths) : 0
  // nothing known about snow (depth missing, no snowfall), or none: no snow
  if (depthM <= 0 && fall < SNOWFALL_MIN_CM) return null
  const meanC = temperatures.reduce((sum, x) => sum + x, 0) / temperatures.length
  const freezingM = eleM + meanC / LAPSE_RATE_C_PER_M
  const lineM = depthM >= SETTLED_SNOW_M ? Math.min(eleM, freezingM) : freezingM
  return { snowLineM: clamp(lineM, 0, MAX_LINE_M), bandM: depthM >= DEEP_SNOW_M ? BAND_SETTLED_M : BAND_PATCHY_M }
}

const HOUR_MS = 3_600_000

const cache = new WeakMap<WeatherStation, Map<number, SnowLine | null>>()

/** The snow line at `station` over the UTC day of `timeMs` (the series starts at midnight UTC), memoised. */
function stationSnowLine(series: WeatherSeries, station: WeatherStation, timeMs: number): SnowLine | null {
  const days = Math.floor(series.time.length / HOURS_PER_DAY)
  if (days === 0) return null
  const day = clamp(Math.floor((timeMs - series.time[0]) / (HOURS_PER_DAY * HOUR_MS)), 0, days - 1)
  let byDay = cache.get(station)
  if (!byDay) cache.set(station, (byDay = new Map()))
  if (byDay.has(day)) return byDay.get(day) ?? null
  const hours = (values: readonly number[]) => values.slice(day * HOURS_PER_DAY, (day + 1) * HOURS_PER_DAY)
  const line = snowLineOfDay({
    eleM: station.ele,
    temperatureC: hours(station.values.temperature),
    snowDepthM: hours(station.values.snowDepth),
    snowfallCm: hours(station.values.snowfall),
  })
  byDay.set(day, line)
  return line
}

/** The snow line of the day of `timeMs` from the station of `series` nearest (lon, lat); null without snow or data. */
export function snowLineAt(series: WeatherSeries, timeMs: number, lon: number, lat: number): SnowLine | null {
  let nearest: WeatherStation | undefined
  let best = Infinity
  for (const station of series.stations) {
    const d = haversineM({ lon, lat }, station)
    if (d < best) {
      best = d
      nearest = station
    }
  }
  return nearest ? stationSnowLine(series, nearest, timeMs) : null
}

/** `snowLineAt` where the marker is at `progress` (0..1) of `path`; null when the path has no recorded time. */
export function snowLineAtProgress(series: WeatherSeries, path: TrackPath, progress: number): SnowLine | null {
  if (path.count === 0) return null
  const d = clamp(progress, 0, 1) * path.lengthM
  const timeMs = recordedTimeAt(path, d)
  if (timeMs === undefined) return null
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
