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
  snowLineOfDay,
} from './snowLine'
import { WEATHER_VARIABLES, type WeatherSeries, type WeatherVariable } from './series'

const day = (value: number, hours = 24) => new Array<number>(hours).fill(value)

describe('snowLineOfDay', () => {
  it('lies at the freezing level of the mean temperature when snow falls', () => {
    // 2000 m, -3.25 °C: 0 °C is 500 m higher; nothing on the ground yet, so the line is the freezing level
    const line = snowLineOfDay({ eleM: 2000, temperatureC: day(-3.25), snowDepthM: day(0), snowfallCm: day(0.5) })
    expect(line?.snowLineM).toBeCloseTo(1500, 5)
    expect(line?.bandM).toBe(BAND_PATCHY_M)
  })

  it('never lies above the station when snow lies there', () => {
    // 1000 m, +5 °C would put the line at 1770 m, but 1.88 m of snow lies at the station
    const line = snowLineOfDay({ eleM: 1000, temperatureC: day(5), snowDepthM: day(1.88), snowfallCm: day(0) })
    expect(line?.snowLineM).toBe(1000)
    expect(line?.bandM).toBe(BAND_SETTLED_M)
  })

  it('takes the lower of the station and the freezing level when snow lies and it is cold', () => {
    const line = snowLineOfDay({ eleM: 2000, temperatureC: day(-6.5), snowDepthM: day(0.5), snowfallCm: day(0) })
    expect(line?.snowLineM).toBe(1000)
  })

  it('draws no snow without snow on the ground or in the air, however cold', () => {
    expect(snowLineOfDay({ eleM: 3000, temperatureC: day(-12), snowDepthM: day(0), snowfallCm: day(0) })).toBeNull()
  })

  it('draws no snow when the data is missing', () => {
    expect(snowLineOfDay({ eleM: undefined, temperatureC: day(0), snowDepthM: day(1), snowfallCm: day(1) })).toBeNull()
    expect(snowLineOfDay({ eleM: 1500, temperatureC: day(Number.NaN), snowDepthM: day(1), snowfallCm: day(1) })).toBeNull()
    // fewer than 12 hours of temperature
    expect(snowLineOfDay({ eleM: 1500, temperatureC: day(0, 8), snowDepthM: day(1, 8), snowfallCm: day(0, 8) })).toBeNull()
    // the snow depth is missing and nothing falls: nothing says there is snow
    expect(snowLineOfDay({ eleM: 1500, temperatureC: day(-2), snowDepthM: day(Number.NaN), snowfallCm: day(0) })).toBeNull()
    // the snow depth is missing but it snows
    expect(snowLineOfDay({ eleM: 1500, temperatureC: day(-6.5), snowDepthM: day(Number.NaN), snowfallCm: day(2) })?.snowLineM).toBe(500)
  })

  it('stays between the sea and 6000 m', () => {
    expect(snowLineOfDay({ eleM: 100, temperatureC: day(-20), snowDepthM: day(0), snowfallCm: day(1) })?.snowLineM).toBe(0)
    expect(snowLineOfDay({ eleM: 3000, temperatureC: day(30), snowDepthM: day(0), snowfallCm: day(1) })?.snowLineM).toBe(6000)
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
    expect(snowLineAt(s, Date.UTC(2025, 0, 10, 12), 6.8, 45.9)?.snowLineM).toBe(500)
    expect(snowLineAt(s, Date.UTC(2025, 0, 11, 12), 6.8, 45.9)).toBeNull()
    // outside the series: the first and the last day
    expect(snowLineAt(s, Date.UTC(2025, 0, 1), 6.8, 45.9)?.snowLineM).toBe(500)
    expect(snowLineAt(s, Date.UTC(2025, 5, 1), 6.8, 45.9)).toBeNull()
  })

  it('takes the station nearest the place', () => {
    const s = series()
    s.stations.push({ ...s.stations[0], lon: 7.5, ele: 2500 })
    expect(snowLineAt(s, Date.UTC(2025, 0, 10, 12), 7.49, 45.9)?.snowLineM).toBe(1500)
  })

  it('is null for a series without station', () => {
    expect(snowLineAt({ time: [], stations: [] }, 0, 6.8, 45.9)).toBeNull()
  })
})

describe('snowLineAtProgress', () => {
  const point = (lon: number, time: number): TrackPoint => ({ lon, lat: 45.9, ele: 1500, time })
  const timed = buildTrackPath(
    buildTrack({ name: 't', source: 'gpx', segments: [{ points: [point(6.8, Date.UTC(2025, 0, 10, 9)), point(6.9, Date.UTC(2025, 0, 11, 9))] }] }),
  )

  it('reads the day of the recorded time under the marker', () => {
    expect(snowLineAtProgress(series(), timed, 0)?.snowLineM).toBe(500)
    expect(snowLineAtProgress(series(), timed, 1)).toBeNull()
  })

  it('is null for an untimed track', () => {
    const untimed = buildTrackPath(buildTrack({ name: 't', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.9, lat: 45.9 }] }] }))
    expect(snowLineAtProgress(series(), untimed, 0.5)).toBeNull()
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
