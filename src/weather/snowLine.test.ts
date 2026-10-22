import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import {
  BAND_PATCHY_M,
  BAND_SETTLED_M,
  DEFAULT_SNOW,
  MANUAL_BAND_M,
  isValidSnow,
  resolveSnow,
  snowLineAt,
  snowLineAtProgress,
  snowOfDay,
} from './snowLine'
import { WEATHER_VARIABLES, type WeatherSeries, type WeatherVariable } from './series'

const day = (value: number, hours = 24) => new Array<number>(hours).fill(value)

describe('snowOfDay', () => {
  it('lies at the freezing level of the mean temperature when snow falls', () => {
    // 2000 m, -3.25 °C: 0 °C is 500 m higher; nothing on the ground yet, so the line is the freezing level
    const { line } = snowOfDay({ eleM: 2000, temperatureC: day(-3.25), snowDepthM: day(0), snowfallCm: day(0.5) })
    expect(line?.snowLineM).toBeCloseTo(1500, 5)
    expect(line?.bandM).toBe(BAND_PATCHY_M)
  })

  it('never lies above the station when snow lies there', () => {
    // 1000 m, +5 °C would put the line at 1770 m, but 1.88 m of snow lies at the station
    const { line } = snowOfDay({ eleM: 1000, temperatureC: day(5), snowDepthM: day(1.88), snowfallCm: day(0) })
    expect(line?.snowLineM).toBe(1000)
    expect(line?.bandM).toBe(BAND_SETTLED_M)
  })

  it('takes the lower of the station and the freezing level when snow lies and it is cold', () => {
    expect(snowOfDay({ eleM: 2000, temperatureC: day(-6.5), snowDepthM: day(0.5), snowfallCm: day(0) }).line?.snowLineM).toBe(1000)
  })

  it('draws no snow, knowingly, without snow on the ground or in the air, however cold', () => {
    expect(snowOfDay({ eleM: 3000, temperatureC: day(-12), snowDepthM: day(0), snowfallCm: day(0) })).toEqual({ line: null, unknown: null })
  })

  it('says why it cannot tell: no elevation, or not enough data', () => {
    expect(snowOfDay({ eleM: undefined, temperatureC: day(0), snowDepthM: day(1), snowfallCm: day(1) })).toEqual({ line: null, unknown: 'altitude' })
    expect(snowOfDay({ eleM: 1500, temperatureC: day(Number.NaN), snowDepthM: day(1), snowfallCm: day(1) }).unknown).toBe('data')
    // fewer than 12 hours of temperature
    expect(snowOfDay({ eleM: 1500, temperatureC: day(0, 8), snowDepthM: day(1, 8), snowfallCm: day(0, 8) }).unknown).toBe('data')
    // no snow depth at all (a weather loaded before it was kept): unknown, even when it snows
    expect(snowOfDay({ eleM: 1500, temperatureC: day(-6.5), snowDepthM: day(Number.NaN), snowfallCm: day(2) })).toEqual({ line: null, unknown: 'data' })
  })

  it('stays between the sea and 6000 m', () => {
    expect(snowOfDay({ eleM: 100, temperatureC: day(-20), snowDepthM: day(0), snowfallCm: day(1) }).line?.snowLineM).toBe(0)
    expect(snowOfDay({ eleM: 3000, temperatureC: day(30), snowDepthM: day(0), snowfallCm: day(1) }).line?.snowLineM).toBe(6000)
  })
})

/** Two days of one station at 1500 m: a cold snowy day, then a warm bare one. */
function series(): WeatherSeries {
  const values = {} as Record<WeatherVariable, number[]>
  for (const v of WEATHER_VARIABLES) values[v] = day(0, 48)
  values.temperature = [...day(-6.5), ...day(10)]
  values.snowDepth = [...day(0.3), ...day(0)]
  return { time: Array.from({ length: 48 }, (_, h) => Date.UTC(2025, 0, 10) + h * 3_600_000), stations: [{ lon: 6.8, lat: 45.9, ele: 1500, values }] }
}

describe('snowLineAt', () => {
  it('follows the UTC day of the instant', () => {
    const s = series()
    expect(snowLineAt(s, Date.UTC(2025, 0, 10, 12), 6.8, 45.9).line?.snowLineM).toBe(500)
    expect(snowLineAt(s, Date.UTC(2025, 0, 11, 12), 6.8, 45.9)).toEqual({ line: null, unknown: null })
    // outside the series: the first and the last day
    expect(snowLineAt(s, Date.UTC(2025, 0, 1), 6.8, 45.9).line?.snowLineM).toBe(500)
    expect(snowLineAt(s, Date.UTC(2025, 5, 1), 6.8, 45.9).line).toBeNull()
  })

  it('moves smoothly across midnight, from the line of a day to the next', () => {
    const s = series()
    const at = (h: number, m: number) => snowLineAt(s, Date.UTC(2025, 0, 10, h, m), 6.8, 45.9).line?.snowLineM
    expect(at(22, 59)).toBe(500)
    // the bare day counts as a line above every summit (6000 m): 500 m, 3250 m at midnight, then none
    expect(at(23, 30)).toBeCloseTo(1875, 5)
    expect(at(24, 0)).toBeCloseTo(3250, 5)
    expect(at(24, 30)).toBeCloseTo(4625, 5)
    expect(at(25, 1)).toBeUndefined()
  })

  it('moves smoothly where the nearest station changes', () => {
    const s = series()
    // the second station, 54 km east, has its freezing level higher
    s.stations.push({ ...s.stations[0], lon: 7.5, ele: 2500 })
    const lines: number[] = []
    for (let lon = 6.8; lon <= 7.5001; lon += 0.01) lines.push(snowLineAt(s, Date.UTC(2025, 0, 10, 12), lon, 45.9).line!.snowLineM)
    expect(lines[0]).toBeCloseTo(500, 0)
    expect(Math.abs(lines.at(-1)! - 1500)).toBeLessThan(1)
    const steps = lines.slice(1).map((l, i) => l - lines[i])
    // one jump from a station to the other would be 1000 m
    expect(Math.max(...steps)).toBeLessThan(100)
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0)
  })

  it('leaves out a station whose snow is unknown, and says why when none is known', () => {
    const s = series()
    s.stations.push({ ...s.stations[0], lon: 6.81, ele: undefined })
    expect(snowLineAt(s, Date.UTC(2025, 0, 10, 12), 6.81, 45.9).line?.snowLineM).toBe(500)
    s.stations.shift()
    expect(snowLineAt(s, Date.UTC(2025, 0, 10, 12), 6.81, 45.9)).toEqual({ line: null, unknown: 'altitude' })
  })

  it('has nothing for a series without station', () => {
    expect(snowLineAt({ time: [], stations: [] }, 0, 6.8, 45.9)).toEqual({ line: null, unknown: null })
  })
})

describe('snowLineAtProgress', () => {
  const point = (lon: number, time: number): TrackPoint => ({ lon, lat: 45.9, ele: 1500, time })
  const timed = buildTrackPath(
    buildTrack({ name: 't', source: 'gpx', segments: [{ points: [point(6.8, Date.UTC(2025, 0, 10, 9)), point(6.9, Date.UTC(2025, 0, 11, 9))] }] }),
  )

  it('reads the day of the recorded time under the marker', () => {
    expect(snowLineAtProgress(series(), timed, 0).line?.snowLineM).toBe(500)
    expect(snowLineAtProgress(series(), timed, 1).line).toBeNull()
  })

  it('has nothing for an untimed track', () => {
    const untimed = buildTrackPath(buildTrack({ name: 't', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.9, lat: 45.9 }] }] }))
    expect(snowLineAtProgress(series(), untimed, 0.5).line).toBeNull()
  })
})

describe('the setting', () => {
  it('follows the weather by default and picks the line of the chosen mode', () => {
    const weather = { snowLineM: 1850, bandM: 150 }
    expect(DEFAULT_SNOW.mode).toBe('meteo')
    expect(resolveSnow(DEFAULT_SNOW, () => weather)).toBe(weather)
    expect(resolveSnow(DEFAULT_SNOW, () => null)).toBeNull()
    expect(resolveSnow({ mode: 'manuelle', lineM: 2400 }, () => weather)).toEqual({ snowLineM: 2400, bandM: MANUAL_BAND_M })
    expect(resolveSnow({ mode: 'aucune', lineM: 2400 }, () => weather)).toBeNull()
  })

  it('rejects an unknown mode and a line out of range', () => {
    expect(isValidSnow(DEFAULT_SNOW)).toBe(true)
    expect(isValidSnow({ mode: 'neige' as never, lineM: 2000 })).toBe(false)
    expect(isValidSnow({ mode: 'manuelle', lineM: 5000 })).toBe(false)
    expect(isValidSnow({ mode: 'manuelle', lineM: -1 })).toBe(false)
  })
})
