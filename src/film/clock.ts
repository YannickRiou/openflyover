/**
 * Film clock: the one mapping between the film time (seconds at x1 from the very first frame) and what the film
 * shows, shared by the preview (`FlyoverRig`, `playback.timeS`) and the export (`ExportController`), so both give the
 * same frame for the same time.
 *
 *   [0, O)          opening: overview shot, progress 0
 *   [O, O + F)      flight: pacing slow-downs, speed portions and stops (`flightPacing`); 'stop' phase in a stop window
 *   [O + F, total]  closing: overview shot, progress 1
 *
 * The nights of a multi-day track are pauses of the flight too (`nights`, 'flight' phase), added to the film.
 *
 * A pure function of the film time: any frame can be computed alone.
 */
import { clamp } from '../core/math'
import type { Track } from '../core/types'
import { flightNights, nightPauseS } from '../flyover/nights'
import type { FlightNight } from '../flyover/nights'
import { flightPacing, pacingHighlights } from '../flyover/pacing'
import type { FlightStop, Pacing, PacingPosition, PacingSettings, SpeedCurve } from '../flyover/pacing'
import { trackPathOf } from '../flyover/path'
import type { Landmark } from '../osm/landmarks'
import { filmStops } from './assemble'
import { shotDurationS } from './model'
import type { Film, FilmCameraKey, FilmShot, FilmSpeed, FilmStop } from './model'
import { sortedParamKeys, valueAtKeys } from './paramKeys'
import type { FilmParamKey } from './paramKeys'
import type { FilmMarkerKey } from './markerKeys'

export type FilmPhase = 'opening' | 'flight' | 'stop' | 'closing'

/** A stop of the film placed on the clock (film times from the very start, opening included). */
export interface ClockStop extends FilmStop {
  progress: number
  /** start of the ease-in, hold, end of the ease-out */
  startS: number
  holdStartS: number
  holdEndS: number
  endS: number
  /** time added to the film (after the `keepDuration` cap of the pacing) */
  addedS: number
}

/** A night of the track placed on the clock: the pause of the flight during which the sun sets and rises again. */
export interface ClockNight extends FlightNight {
  progress: number
  /** start of the ease-in, hold, end of the ease-out (film times) */
  startS: number
  holdStartS: number
  holdEndS: number
  endS: number
}

/** A speed portion of the film placed on the clock: film times at which the marker enters and leaves it. */
export interface ClockSpeed extends FilmSpeed {
  startS: number
  endS: number
}

/** A camera key of the film placed on the clock: film time at which the marker passes it. */
export interface ClockCameraKey extends FilmCameraKey {
  timeS: number
}

/** A parameter key of the film placed on the clock: film time at which the marker passes it. */
export interface ClockParamKey extends FilmParamKey {
  timeS: number
}

/** A marker key of the film placed on the clock: film time at which the marker passes it. */
export interface ClockMarkerKey extends FilmMarkerKey {
  timeS: number
}

/** A cut between two stages « À la suite » (flyover/sequence.ts): film time at which the marker reaches it. */
export interface ClockCut {
  atM: number
  timeS: number
}

/** What the film shows at a film time. */
export interface FilmState {
  phase: FilmPhase
  /** film time, clamped to [0, total] */
  timeS: number
  progress: number
  /** time since the start of the flight, clamped to it: drives the time-based camera styles */
  flightTimeS: number
  /** the stop whose window contains the time ('stop' phase), else null */
  stop: ClockStop | null
  /** time since the start of the phase (the flight, a stop's window, a shot) and the length of that phase */
  localS: number
  lengthS: number
}

/**
 * Same contract as a `Pacing` over the whole film (the panels read `totalTime` and `highlights`, the export
 * `progressAtTime`), plus the phases.
 */
export interface FilmClock {
  /** pacing highlights as progress values, sorted */
  highlights: readonly number[]
  opening: FilmShot
  closing: FilmShot
  openingS: number
  flightS: number
  closingS: number
  stops: readonly ClockStop[]
  /** speed portions, by position */
  speeds: readonly ClockSpeed[]
  /** camera keys, by position */
  cameraKeys: readonly ClockCameraKey[]
  /** parameter keys (speed, exposure, sun hour, grading), by position */
  paramKeys: readonly ClockParamKey[]
  /** marker keys (changes of the marker's look), by position */
  markerKeys: readonly ClockMarkerKey[]
  /** cuts between stages « À la suite », by position (none otherwise) */
  cuts: readonly ClockCut[]
  /** nights shown as pauses, by position (none by default) */
  nights: readonly ClockNight[]
  /** film length at ×1 (seconds) */
  totalTime(): number
  /** progress at film time `tS` (0 during the opening, 1 during the closing); continuous and non-decreasing */
  progressAtTime(tS: number): number
  /**
   * film time of a progress set from outside (scrub): the first time the flight reaches it (0 is the start of
   * the flight, after the opening; a stop's position the start of its hold); 1 is the end of the film
   */
  timeAtProgress(progress: number): number
  positionAt(progress: number): PacingPosition
  /** position after `dtS` seconds of playback at `speed` (film time clamped to [0, totalTime()]) */
  advance(from: PacingPosition, dtS: number, speed: number): PacingPosition
  stateAt(tS: number): FilmState
}

export interface FilmClockInput {
  opening: FilmShot
  closing: FilmShot
  stops: readonly FilmStop[]
  /** speed portions (none by default) */
  speeds?: readonly FilmSpeed[]
  /** camera keys (none by default) */
  cameraKeys?: readonly FilmCameraKey[]
  /** parameter keys (none by default): those of the speed set the flight's speed, the others are read by the scene */
  paramKeys?: readonly FilmParamKey[]
  /** marker keys (none by default) */
  markerKeys?: readonly FilmMarkerKey[]
  /** cuts between stages « À la suite » (metres, none by default) */
  cutsM?: readonly number[]
  /** nights shown as pauses (none by default) */
  nights?: readonly FlightNight[]
  /** length of the first track (metres), 0 without track */
  lengthM: number
  /** pacing highlights (metres along the track), slowed down when `pacing.enabled` */
  highlightsM: readonly number[]
  /** `settings.flyoverDurationS` */
  durationS: number
  pacing: PacingSettings
}

/** Clock of a film whose stops are known. */
export function buildFilmClock(input: FilmClockInput): FilmClock {
  // the film's stops and the nights, one pause each, by position (a stop first at the same place)
  const pauses: (FlightStop & { stop?: FilmStop; night?: FlightNight })[] = [
    ...input.stops.map((stop) => ({ atM: stop.atM, durationS: stop.durationS, stop })),
    ...(input.nights ?? []).map((night) => ({ atM: night.atM, durationS: nightPauseS(night), extra: true, night })),
  ]
  pauses.sort((a, b) => a.atM - b.atM || (a.stop ? 0 : 1) - (b.stop ? 0 : 1))
  const speeds = [...(input.speeds ?? [])].sort((a, b) => a.fromM - b.fromM)
  const speedKeys = sortedParamKeys(input.paramKeys ?? [], 'speed')
  const curve: SpeedCurve | undefined =
    speedKeys.length > 0 ? { knotsM: speedKeys.map((k) => k.atM), at: (x) => valueAtKeys(speedKeys, 1, x, true) } : undefined
  const flight: Pacing = flightPacing(input.lengthM, input.highlightsM, input.durationS, input.pacing, pauses, speeds, curve)
  const openingS = shotDurationS(input.opening)
  const closingS = shotDurationS(input.closing)
  const flightS = flight.totalTime()
  const total = openingS + flightS + closingS
  // the identity flight (no track) has no pause: no stop either
  const stops: ClockStop[] = []
  const nights: ClockNight[] = []
  flight.pauses.forEach((pause, k) => {
    const times = {
      progress: pause.progress,
      startS: openingS + pause.startS,
      holdStartS: openingS + pause.holdStartS,
      holdEndS: openingS + pause.holdEndS,
      endS: openingS + pause.endS,
    }
    const { stop, night } = pauses[k]
    if (stop) stops.push({ ...stop, ...times, addedS: pause.durationS })
    else if (night) nights.push({ ...night, ...times })
  })

  // without track (no length) the portions have no place in the flight
  const flightTimeOf = (atM: number) => openingS + flight.timeAtProgress(Math.min(1, atM / input.lengthM))
  const clockSpeeds: ClockSpeed[] =
    input.lengthM > 0 ? speeds.map((s) => ({ ...s, startS: flightTimeOf(s.fromM), endS: flightTimeOf(s.toM) })) : []
  const cameraKeys: ClockCameraKey[] =
    input.lengthM > 0 ? [...(input.cameraKeys ?? [])].sort((a, b) => a.atM - b.atM).map((k) => ({ ...k, timeS: flightTimeOf(k.atM) })) : []
  const paramKeys: ClockParamKey[] =
    input.lengthM > 0 ? [...(input.paramKeys ?? [])].sort((a, b) => a.atM - b.atM).map((k) => ({ ...k, timeS: flightTimeOf(k.atM) })) : []
  const markerKeys: ClockMarkerKey[] =
    input.lengthM > 0 ? [...(input.markerKeys ?? [])].sort((a, b) => a.atM - b.atM).map((k) => ({ ...k, timeS: flightTimeOf(k.atM) })) : []
  const cuts: ClockCut[] = input.lengthM > 0 ? [...(input.cutsM ?? [])].sort((a, b) => a - b).map((atM) => ({ atM, timeS: flightTimeOf(atM) })) : []

  const progressAtTime = (tS: number) => flight.progressAtTime(tS - openingS)
  const timeAtProgress = (progress: number) => (progress >= 1 ? total : openingS + flight.timeAtProgress(progress))

  const stopAt = (t: number): ClockStop | null => {
    let lo = 0
    let hi = stops.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (stops[mid].startS <= t) lo = mid + 1
      else hi = mid
    }
    const stop = stops[lo - 1]
    return stop && t < stop.endS ? stop : null
  }

  const stateAt = (tS: number): FilmState => {
    const timeS = clamp(tS, 0, total)
    if (timeS < openingS) {
      return { phase: 'opening', timeS, progress: 0, flightTimeS: 0, stop: null, localS: timeS, lengthS: openingS }
    }
    const flightTimeS = timeS - openingS
    if (flightTimeS >= flightS && closingS > 0) {
      return { phase: 'closing', timeS, progress: 1, flightTimeS: flightS, stop: null, localS: flightTimeS - flightS, lengthS: closingS }
    }
    const progress = flight.progressAtTime(flightTimeS)
    const stop = stopAt(timeS)
    if (stop) return { phase: 'stop', timeS, progress, flightTimeS, stop, localS: timeS - stop.startS, lengthS: stop.endS - stop.startS }
    return { phase: 'flight', timeS, progress, flightTimeS, stop: null, localS: flightTimeS, lengthS: flightS }
  }

  return {
    highlights: flight.highlights,
    opening: input.opening,
    closing: input.closing,
    openingS,
    flightS,
    closingS,
    stops,
    speeds: clockSpeeds,
    cameraKeys,
    paramKeys,
    markerKeys,
    cuts,
    nights,
    totalTime: () => total,
    progressAtTime,
    timeAtProgress,
    positionAt: (progress) => ({ timeS: timeAtProgress(progress), progress }),
    advance: (from, dtS, speed) => {
      const timeS = clamp(from.timeS + dtS * speed, 0, total)
      return { timeS, progress: progressAtTime(timeS) }
    },
    stateAt,
  }
}

export interface FilmClockFor {
  /** first track (none: no stop, a flight of `durationS`) */
  track: Track | undefined
  film: Film
  durationS: number
  pacing: PacingSettings
  /** OpenStreetMap landmarks of the track (from the landmark store) */
  landmarks?: readonly Landmark[]
  /** cuts between stages when the track is a sequence « À la suite » (metres) */
  cutsM?: readonly number[]
}

/** Input of the clock of the film of `track`: highlights and generated stops from the pacing settings and the landmarks. */
export function filmClockInputFor({ track, film, durationS, pacing, landmarks = [], cutsM }: FilmClockFor): FilmClockInput {
  return {
    opening: film.opening,
    closing: film.closing,
    stops: track ? filmStops(film, { track, landmarks, pacing }) : [],
    speeds: track ? film.speeds : [],
    cameraKeys: track ? film.cameraKeys : [],
    paramKeys: track ? film.paramKeys : [],
    markerKeys: track ? film.markerKeys : [],
    cutsM: track ? cutsM : [],
    nights: track ? flightNights(trackPathOf(track), film.nights, durationS) : [],
    lengthM: track?.stats.distanceM ?? 0,
    highlightsM: track && pacing.enabled ? pacingHighlights(track, pacing, landmarks) : [],
    durationS,
    pacing,
  }
}

/** Clock of the film of `track` (`filmClockInputFor`). */
export function filmClockFor(input: FilmClockFor): FilmClock {
  return buildFilmClock(filmClockInputFor(input))
}
