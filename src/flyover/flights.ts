/**
 * Flights: the stretches of a track recorded clearly above the ground (paragliding, a cable car), drawn at their
 * recorded height instead of on the ground. Found once at import against the terrain source at a fixed zoom
 * (`terrain/elevation.ts`), saved with the track: the answer does not change while the 3D terrain loads.
 *
 * Same walk as the climbs (`climbs.ts`): clearance = recorded − ground, resampled every FLIGHT_STEP_M, smoothed, then
 * runs above FLIGHT_EXIT_M that reach FLIGHT_ENTER_M (hysteresis) and are long enough. The clearance is measured from
 * the device's own offset (median on the ground parts): a device reading 50 m too high does not fly.
 *
 * Pure functions (no DOM, React or Three).
 */
import { clamp } from '../core/math'
import type { Flight } from '../core/types'
import type { HeightSampler } from '../scene/trackLineSet'
import { movingAverage, resampleElevation } from './climbs'
import type { TrackPath } from './path'

/** Spacing of the distance grid the clearance is analysed on (metres). */
export const FLIGHT_STEP_M = 20
/** Width of the centred moving average of the clearance (metres). */
export const FLIGHT_SMOOTHING_M = 100
/** A flight climbs at least this high above the ground (metres): well above the error of a GPS height… */
export const FLIGHT_ENTER_M = 50
/** …and lasts while it stays above this (metres). */
export const FLIGHT_EXIT_M = 15
/** Shorter stretches are not flights (a glitch of the recording): metres along the track. */
export const FLIGHT_MIN_LENGTH_M = 300
/** Largest constant error of a device's elevation believed (metres). */
export const MAX_DEVICE_OFFSET_M = 50

/** Median of `values` where `skip` is false, clamped to ±MAX_DEVICE_OFFSET_M; 0 when none. */
function deviceOffset(values: Float64Array, skip: (i: number) => boolean): number {
  const kept: number[] = []
  for (let i = 0; i < values.length; i++) if (!skip(i) && Number.isFinite(values[i])) kept.push(values[i])
  if (kept.length === 0) return 0
  kept.sort((a, b) => a - b)
  const mid = kept.length >> 1
  const median = kept.length % 2 ? kept[mid] : (kept[mid - 1] + kept[mid]) / 2
  return clamp(median, -MAX_DEVICE_OFFSET_M, MAX_DEVICE_OFFSET_M)
}

/** [first, last] grid indices of the runs of `clearance − offset` above FLIGHT_EXIT_M that reach FLIGHT_ENTER_M and are long enough. */
function flightRuns(clearance: Float64Array, offset: number): [number, number][] {
  const runs: [number, number][] = []
  for (let i = 0; i < clearance.length; i++) {
    if (clearance[i] - offset < FLIGHT_EXIT_M) continue
    const first = i
    let peak = -Infinity
    for (; i < clearance.length && clearance[i] - offset >= FLIGHT_EXIT_M; i++) peak = Math.max(peak, clearance[i] - offset)
    const last = i - 1
    if (peak >= FLIGHT_ENTER_M && (last - first) * FLIGHT_STEP_M >= FLIGHT_MIN_LENGTH_M) runs.push([first, last])
  }
  return runs
}

/**
 * Flights of a path, `ground[i]` the terrain under point i (NaN when unknown). Two passes: the device offset is first
 * the median of the whole track, then the median outside the flights found (a paraglider is in the air most of the time).
 */
export function detectFlights(path: TrackPath, ground: ArrayLike<number>): Flight[] {
  const clearance = resampleElevation({ ...path, ele: path.ele.map((e, i) => e - ground[i]) }, FLIGHT_STEP_M)
  if (!clearance) return []
  const smooth = movingAverage(clearance, Math.round(FLIGHT_SMOOTHING_M / FLIGHT_STEP_M / 2))
  const first = flightRuns(smooth, deviceOffset(clearance, () => false))
  const offsetM = deviceOffset(clearance, (i) => first.some(([a, b]) => i >= a && i <= b))
  return flightRuns(smooth, offsetM).map(([a, b]) => {
    // the highest point above the ground: the ground is only known here (the tiles of the moment are not kept), so it is kept with the flight
    let top = a
    for (let i = a; i <= b; i++) if (smooth[i] > smooth[top]) top = i
    return {
      startM: Math.round(Math.min(path.lengthM, a * FLIGHT_STEP_M)),
      endM: Math.round(Math.min(path.lengthM, b * FLIGHT_STEP_M)),
      offsetM: Math.round(offsetM * 10) / 10,
      maxHeightM: Math.round(smooth[top] - offsetM),
      maxHeightAtM: Math.round(Math.min(path.lengthM, top * FLIGHT_STEP_M)),
    }
  })
}

/** Device offset of the flight at `distanceM` along the track, NaN on the ground. */
export function flightOffsetAt(flights: readonly Flight[] | undefined, distanceM: number): number {
  for (const f of flights ?? []) if (distanceM >= f.startM && distanceM <= f.endM) return f.offsetM
  return Number.NaN
}

/** Distance over which the look of the line eases in and out at each end of a flight (metres): no step where a flight starts. */
export const FLIGHT_EASE_M = 100

/** 0 on the ground, 1 from FLIGHT_EASE_M inside a flight (smooth step between): how much of the flight look applies at `distanceM`. */
export function flightEase(flights: readonly Flight[] | undefined, distanceM: number): number {
  for (const f of flights ?? []) {
    if (distanceM < f.startM || distanceM > f.endM) continue
    const x = clamp(Math.min(distanceM - f.startM, f.endM - distanceM) / FLIGHT_EASE_M, 0, 1)
    return x * x * (3 - 2 * x)
  }
  return 0
}

/**
 * Height of a point of a track (metres, true scale: × exaggeration like the terrain), the one rule of the line, the
 * marker, the camera and the racers. On the ground: the terrain, else the recorded elevation, else 0. In a flight
 * (`flightOffset` not NaN): the recorded elevation less the device offset, never under the terrain.
 */
export function trackHeightM(terrain: number | undefined, ele: number | undefined, flightOffset: number): number {
  const ground = terrain === undefined || Number.isNaN(terrain) ? undefined : terrain
  const recorded = ele === undefined || Number.isNaN(ele) ? undefined : ele
  if (recorded !== undefined && !Number.isNaN(flightOffset)) return Math.max(ground ?? -Infinity, recorded - flightOffset)
  return ground ?? recorded ?? 0
}

/** `trackHeightM` of the point `at` of `path`, `distanceM` along it. */
export function pathHeightM(path: TrackPath, distanceM: number, at: { lon: number; lat: number; ele?: number }, sample: HeightSampler | null): number {
  return trackHeightM(sample?.(at.lon, at.lat), at.ele, flightOffsetAt(path.flights, distanceM))
}
