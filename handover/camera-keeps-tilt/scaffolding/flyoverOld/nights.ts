/**
 * Nights of a multi-day track. The sun date follows the recorded time over distance (`sunDateAt`), so a night spent
 * resting (a recording gap, a jump between chained days, a few metres of GPS jitter) passes in a frame or two. The
 * film pauses there instead (`FilmNights`, flyover/sun.ts `nightSunDate`): see ARCHITECTURE.md "Atmosphere".
 *
 * Pure functions (no DOM, no React, no Three).
 */
import type { FilmNights } from '../film/model'
import { distanceAtTime, samplePath, type TrackPath } from './path'
import { sunTimes } from './sun'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** A night between sunset and sunrise, both recorded on the track. */
export interface TrackNight {
  /** where the film pauses for it (metres along the path): in the longest stretch of the night between two timed points */
  atM: number
  /** recorded times of those two points: the last before the pause, the first after it (ms since epoch) */
  fromMs: number
  toMs: number
  sunsetMs: number
  sunriseMs: number
  /** distance recorded between sunset and sunrise (metres) */
  nightM: number
}

/** A night shown as a pause of the flight, with the film seconds of its three parts. */
export type FlightNight = TrackNight & Pick<FilmNights, 'duskS' | 'nightS' | 'dawnS'>

/** Timed points of the path (indices), in path order. */
function timedIndices(path: TrackPath): number[] {
  const out: number[] = []
  for (let i = 0; i < path.count; i++) if (!Number.isNaN(path.time[i])) out.push(i)
  return out
}

const nightsByPath = new WeakMap<TrackPath, TrackNight[]>()

/**
 * Nights whose sunset and sunrise both fall within the recording (sun times where the track is at noon of that day;
 * none in a polar day or night), cached per path. Each is placed between the two timed points that share most of it.
 */
export function trackNights(path: TrackPath): TrackNight[] {
  const cached = nightsByPath.get(path)
  if (cached) return cached
  const nights: TrackNight[] = []
  const timed = timedIndices(path)
  if (timed.length >= 2) {
    const { time, dist } = path
    const t0 = time[timed[0]]
    const t1 = time[timed[timed.length - 1]]
    for (let day = Math.floor(t0 / DAY_MS) - 1; day <= Math.floor(t1 / DAY_MS); day++) {
      const noon = Math.min(t1, Math.max(t0, day * DAY_MS + 12 * HOUR_MS))
      const at = samplePath(path, distanceAtTime(path, noon, Infinity) ?? 0)
      const sunset = sunTimes(at.lat, at.lon, new Date(day * DAY_MS)).sunset?.getTime()
      const sunrise = sunTimes(at.lat, at.lon, new Date((day + 1) * DAY_MS)).sunrise?.getTime()
      if (sunset === undefined || sunrise === undefined || sunset < t0 || sunrise > t1 || !(sunrise > sunset)) continue
      let best = -1
      let bestOverlap = 0
      for (let k = 1; k < timed.length; k++) {
        const overlap = Math.min(time[timed[k]], sunrise) - Math.max(time[timed[k - 1]], sunset)
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          best = k
        }
      }
      if (best < 0) continue
      const a = timed[best - 1]
      const b = timed[best]
      const middle = (Math.max(time[a], sunset) + Math.min(time[b], sunrise)) / 2
      const atM = dist[a] + ((dist[b] - dist[a]) * (middle - time[a])) / (time[b] - time[a])
      const nightM = (distanceAtTime(path, sunrise) ?? 0) - (distanceAtTime(path, sunset) ?? 0)
      nights.push({ atM, fromMs: time[a], toMs: time[b], sunsetMs: sunset, sunriseMs: sunrise, nightM: Math.max(0, nightM) })
    }
  }
  nightsByPath.set(path, nights)
  return nights
}

/**
 * Stable key of a night (`film.nights.skipped`): the UTC date of its sunset, `2026-07-14`. It needs no clock of the
 * recording and does not change when the track is trimmed (a night's position along the path does).
 */
export const nightKey = (night: Pick<TrackNight, 'sunsetMs'>) => new Date(night.sunsetMs).toISOString().slice(0, 10)

/** Timeline id of a night: its block over the flight bar of « Plans » (see `dayCardId`). */
const NIGHT_PREFIX = 'night-'
export const nightItemId = (night: Pick<TrackNight, 'sunsetMs'>) => `${NIGHT_PREFIX}${nightKey(night)}`
export const isNightItem = (item: string | null | undefined): item is string => typeof item === 'string' && item.startsWith(NIGHT_PREFIX)
export const nightKeyOf = (item: string) => item.slice(NIGHT_PREFIX.length)

/** Film seconds a night pause lasts. */
export const nightPauseS = (nights: Pick<FilmNights, 'duskS' | 'nightS' | 'dawnS'>) => nights.duskS + nights.nightS + nights.dawnS

/**
 * The flight already shows night `n`: at its base speed over `durationS`, it crosses the distance ridden that night
 * in more time than a pause lasts (`pauseS`), the sun setting and rising on the move.
 */
export const riddenNight = (n: Pick<TrackNight, 'nightM'>, path: TrackPath, durationS: number, pauseS: number) =>
  !((n.nightM / path.lengthM) * durationS < pauseS)

/**
 * Nights of `path` the film pauses for (`settings.enabled`): by default those the flight does not already show
 * (`riddenNight`); by hand, a night taken out (`settings.skipped`) or a ridden one given a pause (`settings.added`).
 */
export function flightNights(path: TrackPath, settings: FilmNights, durationS: number): FlightNight[] {
  const pauseS = nightPauseS(settings)
  if (!settings.enabled || !(pauseS > 0) || !(path.lengthM > 0)) return []
  const { duskS, nightS, dawnS } = settings
  return trackNights(path)
    .filter((n) => nightPaused(n, path, settings, durationS))
    .map((n) => ({ ...n, duskS, nightS, dawnS }))
}

/** Night `n` has a pause: its choice by hand (`added`, `skipped`), else the automatic one. */
export function nightPaused(n: TrackNight, path: TrackPath, settings: FilmNights, durationS: number): boolean {
  const key = nightKey(n)
  if (settings.added?.includes(key)) return true
  if (settings.skipped?.includes(key)) return false
  return !riddenNight(n, path, durationS, nightPauseS(settings))
}

/**
 * `settings` with the night of `key` (`nightKey`) given a pause or not (`paused`); `automatic`: the pause it has by
 * default. A choice equal to the automatic one is not kept, so the night follows the track again.
 */
export function withNightPaused(settings: FilmNights, key: string, paused: boolean, automatic: boolean): FilmNights {
  const skipped = [...(settings.skipped ?? []).filter((k) => k !== key), ...(!paused && automatic ? [key] : [])]
  const added = [...(settings.added ?? []).filter((k) => k !== key), ...(paused && !automatic ? [key] : [])]
  return { ...settings, skipped: skipped.length > 0 ? skipped : undefined, added: added.length > 0 ? added : undefined }
}
