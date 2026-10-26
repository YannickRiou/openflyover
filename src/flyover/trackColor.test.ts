import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrack, densify } from '../import/stats'
import {
  MAGMA,
  MISSING_COLOR,
  TRACK_METRICS,
  VIRIDIS,
  colorizeValues,
  hasMetric,
  metricRange,
  metricValues,
  resampleValues,
  robustRange,
  trackMetricValues,
} from './trackColor'

/** metres per degree of latitude on the haversine sphere */
const M_PER_DEG = (6371008.8 * Math.PI) / 180
const T0 = Date.UTC(2025, 6, 12, 7)

/** Points due north every `stepM` metres, one per second, with optional per-point extras. */
function line(count: number, stepM: number, extra: (i: number) => Partial<TrackPoint> = () => ({})): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lon: 6.8,
    lat: 45.9 + (i * stepM) / M_PER_DEG,
    time: T0 + i * 1000,
    ...extra(i),
  }))
}

describe('metricValues', () => {
  it('speed: distance over time in km/h, unknown without time', () => {
    const speed = metricValues(line(60, 2), 'speed')
    for (const v of speed) expect(v).toBeCloseTo(7.2, 6)
    const noTime = metricValues(
      line(3, 2).map(({ time: _time, ...p }) => p),
      'speed',
    )
    expect(Array.from(noTime).every(Number.isNaN)).toBe(true)
  })

  it('speed: a single GPS spike is averaged over the window instead of showing a jump', () => {
    const points = line(60, 2)
    points[30] = { ...points[30], lat: points[30].lat + 20 / M_PER_DEG } // 20 m off the line and back
    const speed = metricValues(points, 'speed')
    // the raw speed at the spike would be (20 + 2) m/s = 79 km/h
    expect(Math.max(...speed)).toBeLessThan(7.2 * 3)
  })

  it('slope: elevation change over the distance window in percent', () => {
    const slope = metricValues(line(50, 5, (i) => ({ ele: 1000 + i * 0.5 })), 'slope')
    for (const v of slope) expect(v).toBeCloseTo(10, 6)
    // too short a run (< 20 m) is unknown
    const short = metricValues(line(2, 5, (i) => ({ ele: 1000 + i })), 'slope')
    expect(Array.from(short).every(Number.isNaN)).toBe(true)
  })

  it('vertical speed: m/s from the elevation over time, positive climbing, negative sinking', () => {
    // 40 s climbing at 2 m/s, then 40 s sinking at 1.5 m/s
    const ele = (i: number) => (i < 40 ? 1000 + 2 * i : 1080 - 1.5 * (i - 40))
    const vspeed = metricValues(line(80, 5, (i) => ({ ele: ele(i) })), 'verticalSpeed')
    expect(vspeed[20]).toBeCloseTo(2, 6)
    expect(vspeed[60]).toBeCloseTo(-1.5, 6)
    // at the top the window straddles the turn: between the two, no jump
    expect(vspeed[40]).toBeGreaterThan(-1.5)
    expect(vspeed[40]).toBeLessThan(2)
  })

  it('vertical speed: smoothed over about 16 s, so a noisy GPS height does not speckle the colours', () => {
    // a steady 1 m/s climb with ±3 m of alternating noise: the raw difference of two samples is 7 m/s
    const noisy = metricValues(line(120, 5, (i) => ({ ele: 1000 + i + (i % 2 === 0 ? 3 : -3) })), 'verticalSpeed')
    for (const v of noisy.slice(20, 100)) expect(Math.abs(v - 1)).toBeLessThan(0.5)
  })

  it('vertical speed: unknown without time or elevation, and a pause is not bridged', () => {
    const noTime = metricValues(line(20, 5, (i) => ({ ele: 1000 + i })).map(({ time: _time, ...p }) => p), 'verticalSpeed')
    expect(Array.from(noTime).every(Number.isNaN)).toBe(true)
    const noEle = metricValues(line(20, 5), 'verticalSpeed')
    expect(Array.from(noEle).every(Number.isNaN)).toBe(true)
    // 10 minutes without a point in the middle of a 1 m/s climb: each side is computed from its own points
    const gap = line(40, 5, (i) => ({ ele: 1000 + i })).map((p, i) => (i < 20 ? p : { ...p, time: p.time! + 600_000 }))
    const v = metricValues(gap, 'verticalSpeed')
    expect(v[10]).toBeCloseTo(1, 6)
    expect(v[30]).toBeCloseTo(1, 6)
  })

  it('elevation is the recorded one, sensor channels are averaged over a few seconds', () => {
    const points = line(20, 2, (i) => ({ ele: 1000 + i, hr: i % 2 === 0 ? 100 : 120 }))
    points[10] = { ...points[10], hr: undefined, ele: undefined }
    const ele = metricValues(points, 'elevation')
    expect(ele[3]).toBe(1003)
    expect(Number.isNaN(ele[10])).toBe(true)
    const hr = metricValues(points, 'heartRate')
    expect(hr[4]).toBeCloseTo(110, 0)
    // a missing sample stays missing (shown as a gap, not invented)
    expect(Number.isNaN(hr[10])).toBe(true)
  })
})

describe('hasMetric', () => {
  it('reports which quantities the track records', () => {
    const points = line(5, 2, (i) => ({ ele: 1000 + i }))
    const track = buildTrack({ name: 't', source: 'gpx', segments: [{ points }] })
    expect(hasMetric(track, 'speed')).toBe(true)
    expect(hasMetric(track, 'slope')).toBe(true)
    expect(hasMetric(track, 'elevation')).toBe(true)
    expect(hasMetric(track, 'heartRate')).toBe(false)
    expect(hasMetric(track, 'power')).toBe(false)
    expect(hasMetric(track, 'verticalSpeed')).toBe(true)
    // untimed: a climb rate is not offered
    const untimed = buildTrack({ name: 'u', source: 'gpx', segments: [{ points: points.map(({ time: _time, ...p }) => p) }] })
    expect(hasMetric(untimed, 'verticalSpeed')).toBe(false)
    const noEle = buildTrack({ name: 'n', source: 'gpx', segments: [{ points: line(5, 2) }] })
    expect(hasMetric(noEle, 'verticalSpeed')).toBe(false)
    const bare = buildTrack({ name: 'b', source: 'gpx', segments: [{ points: [{ lon: 6, lat: 45, time: T0 }] }] })
    expect(hasMetric(bare, 'speed')).toBe(false)
  })
})

describe('robustRange', () => {
  it('uses percentiles so that outliers do not stretch the scale, and ignores unknown values', () => {
    const values = Array.from({ length: 101 }, (_, i) => i)
    values[100] = 10_000
    expect(robustRange([values, [Number.NaN]])).toEqual({ min: 2, max: 98 })
    expect(robustRange([[Number.NaN]])).toBeNull()
    expect(robustRange([[5]])).toEqual({ min: 5, max: 5 })
  })

  it('spans the values of every track (one shared colour range)', () => {
    const a = buildTrack({ name: 'a', source: 'gpx', segments: [{ points: line(3, 2, () => ({ ele: 1000 })) }] })
    const b = buildTrack({ name: 'b', source: 'gpx', segments: [{ points: line(3, 2, () => ({ ele: 2000 })) }] })
    const series = (metric: 'elevation' | 'heartRate') => [a, b].flatMap((t) => trackMetricValues(t, metric))
    expect(robustRange(series('elevation'))).toEqual({ min: 1000, max: 2000 })
    expect(robustRange(series('heartRate'))).toBeNull()
  })
})

describe('metricRange', () => {
  it('is the robust range, except the vertical speed whose range is centred on 0 (the middle of the scale)', () => {
    const series = [[-1, 0, 1, 4]]
    expect(metricRange(series, 'speed')).toEqual(robustRange(series))
    expect(metricRange(series, 'verticalSpeed')).toEqual({ min: -4, max: 4 })
    expect(metricRange([[-5, -2]], 'verticalSpeed')).toEqual({ min: -5, max: 5 })
    expect(metricRange([[Number.NaN]], 'verticalSpeed')).toBeNull()
  })
})

describe('resampleValues', () => {
  it('interpolates the values of the points inserted by densify, keeping gaps unknown', () => {
    const points = line(3, 30)
    const densified = densify(points, 10)
    expect(densified).toHaveLength(7)
    const out = resampleValues(points, [0, 30, Number.NaN], densified)
    expect(Array.from(out.slice(0, 4))).toEqual([0, 10, 20, 30])
    expect(Array.from(out.slice(4)).every(Number.isNaN)).toBe(true)
  })
})

describe('colorizeValues', () => {
  const rgb = (hex: string) => [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16) / 255)

  it('maps the range ends to the colormap ends, clamps beyond, and greys out unknown values', () => {
    const out = colorizeValues([0, 100, -50, 500, Number.NaN, 50], { min: 0, max: 100 }, VIRIDIS)
    const at = (i: number) => Array.from(out.slice(i * 3, i * 3 + 3))
    const close = (actual: number[], expected: number[]) =>
      actual.forEach((v, c) => expect(v).toBeCloseTo(expected[c], 5))
    close(at(0), rgb(VIRIDIS[0]))
    close(at(1), rgb(VIRIDIS[VIRIDIS.length - 1]))
    close(at(2), rgb(VIRIDIS[0]))
    close(at(3), rgb(VIRIDIS[VIRIDIS.length - 1]))
    close(at(4), rgb(MISSING_COLOR))
    close(at(5), rgb(VIRIDIS[5]))
  })

  it('uses the middle of the colormap for an empty range', () => {
    const out = colorizeValues([7], { min: 7, max: 7 }, VIRIDIS)
    Array.from(out).forEach((v, c) => expect(v).toBeCloseTo(rgb(VIRIDIS[5])[c], 5))
  })

  it('uses sequential colormaps whose lightness increases monotonically', () => {
    // relative luminance as a proxy of perceived lightness: no rainbow-like dips
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const info of Object.values(TRACK_METRICS)) expect([VIRIDIS, MAGMA]).toContain(info.colormap)
    for (const map of [VIRIDIS, MAGMA]) {
      for (let i = 1; i < map.length; i++) expect(luminance(map[i])).toBeGreaterThan(luminance(map[i - 1]))
    }
  })
})
