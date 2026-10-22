import { describe, expect, it } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { detectRecords, recordText, recordsOf } from './records'
import type { RecordKind, TrackRecord } from './records'
import { buildTrack } from './stats'

const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

interface Shape {
  lengthM: number
  /** elevation at a distance; undefined = none recorded */
  ele?: (d: number) => number
  /** speed (m/s) at a distance; undefined = no time recorded */
  speed?: (d: number) => number
  hr?: (i: number) => number | undefined
  power?: (i: number) => number | undefined
  /** pauses: [distance, seconds] */
  pauses?: [number, number][]
}

/** A track going north every 10 m with the elevation and speed of `shape`. */
function make(shape: Shape): Track {
  const points: TrackPoint[] = []
  let t = Date.UTC(2026, 5, 1, 8)
  let n = 0
  const pauses = [...(shape.pauses ?? [])]
  for (let d = 0; d <= shape.lengthM; d += 10) {
    if (shape.speed && n > 0) t += (10 / shape.speed(d)) * 1000
    const pause = pauses.findIndex(([at]) => at <= d)
    if (pause >= 0) t += pauses.splice(pause, 1)[0][1] * 1000
    const p: TrackPoint = { lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT }
    if (shape.ele) p.ele = shape.ele(d)
    if (shape.speed) p.time = t
    const hr = shape.hr?.(n)
    if (hr !== undefined) p.hr = hr
    const power = shape.power?.(n)
    if (power !== undefined) p.power = power
    points.push(p)
    n++
  }
  return buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
}

const kinds = (track: Track): RecordKind[] => detectRecords(track).map((r) => r.kind).sort()
const get = (track: Track, kind: RecordKind): TrackRecord | undefined => detectRecords(track).find((r) => r.kind === kind)

/** Flat to 1 km, 500 m at 18 %, flat. */
const ramp = (d: number) => 1000 + Math.min(500, Math.max(0, d - 1000)) * 0.18

describe('detectRecords', () => {
  it('finds the steepest climb: its gradient, its length, its middle', () => {
    const track = make({ lengthM: 3000, ele: ramp })
    const r = get(track, 'steepestClimb')!
    expect(r.value).toBeGreaterThan(16)
    expect(r.value).toBeLessThanOrEqual(18.5)
    expect(r.lengthM).toBeGreaterThanOrEqual(300)
    expect(r.lengthM).toBeLessThanOrEqual(500)
    expect(Math.abs(r.alongM - 1250)).toBeLessThanOrEqual(100)
    expect(r.lat).toBeCloseTo(45.8 + r.alongM / M_PER_DEG_LAT, 5)
    expect(recordText(r)).toMatch(/^Montée la plus raide · \d+ % sur [345]00 m$/)
  })

  it('finds the fastest descent: the kilometre going down at the highest mean speed', () => {
    // 3 km at 5 m/s, but the kilometre from 1 500 m to 2 500 m drops 100 m at 15 m/s (54 km/h)
    const track = make({
      lengthM: 4000,
      ele: (d) => 1200 - Math.min(1000, Math.max(0, d - 1500)) * 0.1,
      speed: (d) => (d > 1500 && d <= 2500 ? 15 : 5),
    })
    const r = get(track, 'fastestDescent')!
    expect(r.value).toBeGreaterThan(50)
    expect(r.value).toBeLessThanOrEqual(54.5)
    expect(r.alongM).toBeGreaterThan(1900)
    expect(r.alongM).toBeLessThan(2100)
    expect(recordText(r)).toMatch(/^Descente la plus rapide · \d+ km\/h sur 1 km$/)
    // walking pace down is not a record
    expect(get(make({ lengthM: 4000, ele: (d) => 1200 - d * 0.1, speed: () => 1.4 }), 'fastestDescent')).toBeUndefined()
    // the same stretch is the fastest kilometre too: one record
    expect(get(track, 'fastestKm')).toBeUndefined()
  })

  it('finds the highest and the lowest points, away from the ends', () => {
    const track = make({ lengthM: 4000, ele: (d) => 1500 + 300 * Math.sin((d / 4000) * 2 * Math.PI) })
    const high = get(track, 'highest')!
    const low = get(track, 'lowest')!
    expect(Math.abs(high.alongM - 1000)).toBeLessThanOrEqual(60)
    expect(high.value).toBeGreaterThan(1790)
    expect(Math.abs(low.alongM - 3000)).toBeLessThanOrEqual(60)
    expect(low.value).toBeLessThan(1210)
    // a gentle bump is neither: under 30 m for the highest, under 100 m for the lowest
    expect(kinds(make({ lengthM: 3000, ele: (d) => 1000 + 4 * (1 - Math.cos((d / 3000) * 2 * Math.PI)) }))).toEqual([])
    expect(get(make({ lengthM: 3000, ele: (d) => 1000 + 40 * Math.sin((d / 3000) * 2 * Math.PI) }), 'lowest')).toBeUndefined()
    // a descent ends at its lowest point: not a record
    expect(get(make({ lengthM: 3000, ele: (d) => 2000 - d / 10 }), 'lowest')).toBeUndefined()
  })

  it('finds the fastest and the slowest whole kilometre of a timed track, a pause not counting', () => {
    // km 0: 4 m/s, km 1: 6 m/s (fastest), km 2: 2 m/s (slowest), km 3: 4 m/s with a 10 minute stop
    const track = make({ lengthM: 4000, speed: (d) => (d <= 1000 ? 4 : d <= 2000 ? 6 : d <= 3000 ? 2 : 4), pauses: [[3500, 600]] })
    const fast = get(track, 'fastestKm')!
    const slow = get(track, 'slowestKm')!
    expect(fast.value).toBeCloseTo(1000 / 6, -1)
    expect(fast.alongM).toBe(1500)
    expect(slow.value).toBeCloseTo(500, -1)
    expect(slow.alongM).toBe(2500)
    expect(recordText(slow)).toBe('Kilomètre le plus lent · 8 min 20')
    // no elevation: no climb, descent or altitude
    expect(kinds(track)).toEqual(['fastestKm', 'slowestKm'])
  })

  it('gives the elevation records alone to a track without time, and none to a track of even pace', () => {
    expect(kinds(make({ lengthM: 3000, ele: ramp }))).toEqual(['highest', 'steepestClimb'])
    expect(kinds(make({ lengthM: 4000, speed: () => 4 }))).toEqual([])
  })

  it('gives nothing to a flat track, an untimed one without elevation, or one under a kilometre', () => {
    expect(detectRecords(make({ lengthM: 3000, ele: () => 500, speed: () => 3 }))).toEqual([])
    expect(detectRecords(make({ lengthM: 3000 }))).toEqual([])
    expect(detectRecords(make({ lengthM: 900, ele: ramp, speed: () => 3 }))).toEqual([])
  })

  it('is not fooled by GPS noise: an elevation spike, jitter', () => {
    const spike = make({ lengthM: 3000, ele: (d) => 1000 + (d === 1500 ? 300 : 0) })
    expect(detectRecords(spike)).toEqual([])
    const jitter = make({ lengthM: 3000, ele: (d) => 1000 + ((d / 10) % 2 === 0 ? 3 : -3) })
    expect(detectRecords(jitter)).toEqual([])
  })

  it('finds no slope in an elevation step between two segments (a gap, a chained track, a lift)', () => {
    const segment = (from: number, ele: number): TrackPoint[] =>
      Array.from({ length: 101 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (from + i * 10) / M_PER_DEG_LAT, ele }))
    const track = buildTrack({ name: 'seam', source: 'gpx', segments: [{ points: segment(0, 1000) }, { points: segment(1000, 1400) }] })
    expect(detectRecords(track).filter((r) => r.kind === 'steepestClimb' || r.kind === 'fastestDescent')).toEqual([])
  })

  it('ignores a stretch with a GPS jump (more than 150 km/h)', () => {
    // 4 km at 4 m/s, but 800 m are gained in one second at 2.5 km: no kilometre is fast because of it
    const points: TrackPoint[] = []
    let t = 0
    let d = 0
    for (let i = 0; i <= 400; i++) {
      if (i === 250) d += 800
      else d += 10
      t += i === 250 ? 1000 : 2500
      points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, time: Date.UTC(2026, 5, 1, 8) + t })
    }
    const track = buildTrack({ name: 'jump', source: 'gpx', segments: [{ points }] })
    for (const r of detectRecords(track)) expect(r.kind === 'fastestKm' && r.value < 100).toBe(false)
  })

  it('finds the longest climb when there are several, and the peak heart rate and power', () => {
    const track = make({
      lengthM: 8000,
      ele: (d) => 1000 + (d < 1000 ? 0 : d < 2000 ? (d - 1000) * 0.08 : d < 3000 ? 80 - (d - 2000) * 0.06 : d < 4000 ? 20 : d < 7000 ? 20 + (d - 4000) * 0.06 : 200),
      speed: () => 3,
      hr: (i) => (i === 400 ? 220 : 150),
      power: (i) => (i >= 200 && i < 260 ? 400 : 150),
    })
    const climb = get(track, 'longestClimb')!
    expect(climb.lengthM).toBeGreaterThan(2500)
    expect(climb.gradientPct).toBeGreaterThan(4.5)
    expect(recordText(climb)).toMatch(/^Plus longue montée · \d,\d km à \d,\d %$/)
    // one lone 220 bpm point does not make the peak: it is the best 30 s that counts
    const hr = get(track, 'maxHeartRate')!
    expect(hr.value).toBeLessThan(175)
    const power = get(track, 'maxPower')!
    expect(power.value).toBe(400)
    expect(power.alongM).toBeGreaterThan(2000)
    expect(power.alongM).toBeLessThan(2600)
    // a single climb is not "the longest"
    expect(get(make({ lengthM: 3000, ele: ramp }), 'longestClimb')).toBeUndefined()
  })

  it('keeps the same records for a track recoloured or renamed', () => {
    const track = make({ lengthM: 3000, ele: ramp })
    expect(recordsOf({ ...track, name: 'autre' })).toBe(recordsOf(track))
  })
})
