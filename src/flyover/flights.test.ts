import { describe, expect, it } from 'vitest'
import { buildTrack } from '../import/stats'
import { detectFlights, flightEase, FLIGHT_EASE_M, flightOffsetAt, MAX_DEVICE_OFFSET_M, pathHeightM, trackHeightM } from './flights'
import { buildTrackPath, type TrackPath } from './path'

/** Metres per degree of latitude on the haversine sphere (R = 6371008.8 m). */
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

/** Rolling ground: 1000 m ± 200 m every ~9 km. */
const hills = (d: number) => 1000 + 200 * Math.sin(d / 1500)

/** Deterministic pseudo-random jitter in [-amplitude, amplitude] (GPS noise). */
const jitter = (amplitude: number) => (d: number) => amplitude * Math.sin(d * 12.9898 + 78.233) * Math.cos(d * 0.37)

/**
 * Track heading north, one point every 10 m, with the ground under each point: recorded = ground + `above(d)`.
 * `ground` NaN = unknown there.
 */
function bench(lengthM: number, ground: (d: number) => number, above: (d: number) => number): { path: TrackPath; ground: number[] } {
  const points = []
  const under = []
  for (let d = 0; d <= lengthM; d += 10) {
    points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele: ground(d) + above(d) })
    under.push(ground(d))
  }
  return { path: buildTrackPath(buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })), ground: under }
}

describe('detectFlights', () => {
  it('leaves a hike on the ground, GPS noise included', () => {
    const { path, ground } = bench(15_000, hills, jitter(20))
    expect(detectFlights(path, ground)).toEqual([])
  })

  it('leaves a hike on the ground when the device reads every height 50 m too high', () => {
    const shifted = jitter(15)
    const { path, ground } = bench(15_000, hills, (d) => 50 + shifted(d))
    expect(detectFlights(path, ground)).toEqual([])
  })

  it('finds a paragliding flight in the air most of the track, from take-off to landing, and the device offset', () => {
    // walk to take-off (300 m), climb to 600 m above the ground, glide down, land at 9.5 km, walk 500 m; device 20 m high
    const clearance = (d: number) => (d < 300 || d > 9_500 ? 0 : Math.min(600, d - 300, 9_500 - d))
    const noise = jitter(10)
    const { path, ground } = bench(10_000, hills, (d) => 20 + clearance(d) + noise(d))
    const [flight, ...rest] = detectFlights(path, ground)
    expect(rest).toEqual([])
    expect(flight.startM).toBeGreaterThan(250)
    expect(flight.startM).toBeLessThan(400)
    expect(flight.endM).toBeGreaterThan(9_400)
    expect(flight.endM).toBeLessThan(9_550)
    expect(flight.offsetM).toBeGreaterThan(10)
    expect(flight.offsetM).toBeLessThan(30)
    // the greatest height above the ground (600 m here, the offset removed), kept with the flight
    expect(flight.maxHeightM).toBeGreaterThan(570)
    expect(flight.maxHeightM).toBeLessThan(630)
    expect(flight.maxHeightAtM).toBeGreaterThan(800)
    expect(flight.maxHeightAtM).toBeLessThan(9_000)
  })

  it('caps the offset of a track recorded in the air from start to end', () => {
    const { path, ground } = bench(5_000, hills, () => 400)
    const [flight] = detectFlights(path, ground)
    expect(flight).toMatchObject({ startM: 0, endM: 5_000 })
    expect(flight.offsetM).toBeLessThanOrEqual(MAX_DEVICE_OFFSET_M)
  })

  it('leaves the jumps of a kite session on the water (smaller than the error of a recorded height)', () => {
    // 8 m jumps 50 m long every 400 m, over the sea
    const { path, ground } = bench(8_000, () => 0, (d) => 2 + (d % 400 < 50 ? 8 : 0) + jitter(3)(d))
    expect(detectFlights(path, ground)).toEqual([])
  })

  it('ignores a short spike and needs the ground', () => {
    const spike = bench(3_000, hills, (d) => (d >= 1_000 && d <= 1_100 ? 300 : 0))
    expect(detectFlights(spike.path, spike.ground)).toEqual([])
    const unknown = bench(3_000, () => Number.NaN, () => 500)
    expect(detectFlights(unknown.path, unknown.ground)).toEqual([])
  })
})

describe('height of a point of the track', () => {
  it('takes the terrain on the ground, the recorded height less the offset in a flight, never under the terrain', () => {
    expect(trackHeightM(1000, 1500, Number.NaN)).toBe(1000)
    expect(trackHeightM(undefined, 1500, Number.NaN)).toBe(1500)
    expect(trackHeightM(Number.NaN, undefined, Number.NaN)).toBe(0)
    expect(trackHeightM(1000, 1500, 20)).toBe(1480)
    expect(trackHeightM(undefined, 1500, 20)).toBe(1480)
    expect(trackHeightM(1000, 1010, 20)).toBe(1000)
    expect(trackHeightM(1000, undefined, 20)).toBe(1000)
  })

  it('reads the flight at a distance along the path', () => {
    const flights = [{ startM: 100, endM: 200, offsetM: 5 }]
    expect(flightOffsetAt(flights, 150)).toBe(5)
    expect(flightOffsetAt(flights, 250)).toBeNaN()
    expect(flightOffsetAt(undefined, 150)).toBeNaN()
    const { path } = bench(300, () => 0, () => 500)
    const flying = { ...path, flights }
    expect(pathHeightM(flying, 150, { lon: 6.8, lat: 45.8, ele: 500 }, () => 0)).toBe(495)
    expect(pathHeightM(flying, 50, { lon: 6.8, lat: 45.8, ele: 500 }, () => 0)).toBe(0)
  })
})

describe('flightEase', () => {
  const flights = [{ startM: 1000, endM: 3000, offsetM: 0 }]

  it('is 0 on the ground and 1 inside a flight, easing over the first and last FLIGHT_EASE_M', () => {
    expect(flightEase(flights, 500)).toBe(0)
    expect(flightEase(flights, 3500)).toBe(0)
    expect(flightEase(undefined, 1500)).toBe(0)
    expect(flightEase(flights, 1000)).toBe(0)
    expect(flightEase(flights, 3000)).toBe(0)
    expect(flightEase(flights, 1000 + FLIGHT_EASE_M)).toBe(1)
    expect(flightEase(flights, 2000)).toBe(1)
    expect(flightEase(flights, 3000 - FLIGHT_EASE_M)).toBe(1)
    // half way: the middle of a smooth step, the same at both ends
    expect(flightEase(flights, 1000 + FLIGHT_EASE_M / 2)).toBeCloseTo(0.5, 6)
    expect(flightEase(flights, 3000 - FLIGHT_EASE_M / 2)).toBeCloseTo(0.5, 6)
  })

  it('never steps: it rises monotonically and by small amounts along the first FLIGHT_EASE_M', () => {
    let previous = 0
    for (let d = 1000; d <= 1000 + FLIGHT_EASE_M; d += 5) {
      const e = flightEase(flights, d)
      expect(e).toBeGreaterThanOrEqual(previous)
      expect(e - previous).toBeLessThan(0.2)
      previous = e
    }
  })

  it('a flight shorter than twice the ease never reaches 1', () => {
    expect(flightEase([{ startM: 0, endM: 100, offsetM: 0 }], 50)).toBeLessThan(1)
  })
})
