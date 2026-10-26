/**
 * Film clock: the one mapping between the film time (seconds at x1 from the very first frame) and what the film
 * shows, shared by the preview (`FlyoverRig`, `playback.timeS`) and the export (`ExportController`), so both give the
 * same frame for the same time.
 *
 *   [0, O)          opening: overview shot, progress 0
 *   [O, O + F)      flight: speed portions and stops (`flightPacing`); 'stop' phase in a stop window
 *   [O + F, total]  closing: overview shot, progress 1
 *
 * The nights of a multi-day track are pauses of the flight too (`nights`, 'flight' phase), added to the film.
 *
 * A pure function of the film time: any frame can be computed alone.
 */
import { clamp } from '../core/math'
import type { Track } from '../core/types'
import type { BilanPlan } from '../flyover/bilan'
import { flightNights, nightPauseS } from '../flyover/nights'
import { localDate, trackDays } from './days'
import type { FlightNight } from '../flyover/nights'
import { flightPacing } from '../flyover/pacing'
import type { FlightStage, FlightStop, Pacing, PacingPosition, PacingSettings, SpeedCurve } from '../flyover/pacing'
import { trackPathOf } from '../flyover/path'
import type { Landmark } from '../osm/landmarks'
import { filmStops } from './assemble'
import { bilanInputs, junctionPlan, stageSpansOf } from './junctions'
import type { JunctionInput } from './junctions'
import { RECAP_S, shotDurationS } from './model'
import type { Film, FilmCameraKey, FilmShot, FilmSpeed, FilmStop, JunctionKind } from './model'
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

/**
 * A junction between two stages « À la suite » placed on the clock: the pause the film holds at the cut. `startS` to
 * `holdStartS` is the ease in (the stage ends), `holdStartS` the film time the marker reaches the cut (the stage
 * changes), `holdEndS` to `endS` the ease out; all four are the film time of the cut for a plain cut ('coupe').
 */
export interface ClockJunction {
  id: string
  /** the junction follows the stage of this track */
  afterTrackId: string
  atM: number
  kind: JunctionKind
  /** time added to the film (seconds): 0 for a cut; for a night, its dusk, night and dawn */
  holdS: number
  progress: number
  startS: number
  holdStartS: number
  holdEndS: number
  endS: number
  /** a night whose camera rises to show the stage it ends (« Revoir l'étape finie » over a night, `dayViewAt`) */
  view?: boolean
  /**
   * « Revoir l'étape finie » without a night: the pause held just before the cut (`RECAP_LEAD_M`, still on the stage that
   * ends) while the camera shows that stage from above, `durationS` long (`recapViewAt`)
   */
  recap?: { startS: number; holdStartS: number; endS: number; durationS: number }
}

/** The pause of « Revoir l'étape finie » sits this far before the cut: the marker, the figures and the line stay on the stage that ends. */
export const RECAP_LEAD_M = 1

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
 * Same contract as a `Pacing` over the whole film (the panels read `totalTime`, the export
 * `progressAtTime`), plus the phases.
 */
export interface FilmClock {
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
  /** junctions between the stages « À la suite », one per cut and in its order (none otherwise); `cuts[k].timeS` is `junctions[k].holdStartS` */
  junctions: readonly ClockJunction[]
  /** nights shown as pauses, by position (none by default) */
  nights: readonly ClockNight[]
  /** the days of a multi-day track with cards (none by default), in order */
  days: readonly ClockDay[]
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
  /** the junctions at the cuts, in their order (`junctionPlan`; none by default: the cuts hold nothing) */
  junctions?: readonly JunctionInput[]
  /** nights shown as pauses (none by default) */
  nights?: readonly FlightNight[]
  /** the days of the track when its days have cards (`filmDays`; none by default) */
  days?: readonly DayInput[]
  /** clock of the recording, to date the sunrises of the nights (`TrackDay`); absent: this device's */
  utcOffsetMin?: number
  /** the night before each day shows a high view of it, and its card appears as the pause starts, not when it ends */
  dayView?: boolean
  /** the stages « À la suite » with a flight time of their own (`stageSpansOf`; none by default: the length shares the duration) */
  stages?: readonly FlightStage[]
  /** length of the first track (metres), 0 without track */
  lengthM: number
  /** `settings.flyoverDurationS` */
  durationS: number
  pacing: PacingSettings
}

/** A day of the input: its place on the track and its local date (`trackDays`). */
export interface DayInput {
  startM: number
  endM: number
  date: string
}

/** A day on the clock: its place on the track, the night pause that leads into it, the film time its card appears and whether the camera shows it from a high view during that night. */
export interface ClockDay extends DayInput {
  night: ClockNight | null
  cardS: number
  view: boolean
}

/** A junction of the input, to be placed on the clock. */
const clockJunction = (j: JunctionInput): ClockJunction => ({
  id: j.id,
  afterTrackId: j.afterTrackId,
  atM: j.atM,
  kind: j.kind,
  holdS: j.holdS,
  progress: 0,
  startS: 0,
  holdStartS: 0,
  holdEndS: 0,
  endS: 0,
})

/** Clock of a film whose stops are known. */
export function buildFilmClock(input: FilmClockInput): FilmClock {
  // the film's stops, the junctions held and the nights, one pause each, by position (a junction first at the same
  // place: the stage ends before a stop starts on the next one; then a stop, then a night)
  // « Revoir l'étape finie » without a night: a pause of its own just before the cut, added to the film like the junction
  const pauses: (FlightStop & { stop?: FilmStop; night?: FlightNight; junction?: JunctionInput; recapOf?: JunctionInput })[] = [
    ...input.stops.map((stop) => ({ atM: stop.atM, durationS: stop.durationS, stop })),
    ...(input.nights ?? []).map((night) => ({ atM: night.atM, durationS: nightPauseS(night), extra: true, night })),
    ...(input.junctions ?? []).filter((j) => j.holdS > 0).map((junction) => ({ atM: junction.atM, durationS: junction.holdS, extra: true, junction, night: junction.night })),
    ...(input.junctions ?? [])
      .filter((j) => j.recap && !j.night)
      .map((recapOf) => ({ atM: Math.max(0, recapOf.atM - RECAP_LEAD_M), durationS: RECAP_S, extra: true, recapOf })),
  ]
  const rank = (p: (typeof pauses)[number]) => (p.junction ? 0 : p.stop ? 1 : 2)
  pauses.sort((a, b) => a.atM - b.atM || rank(a) - rank(b))
  const speeds = [...(input.speeds ?? [])].sort((a, b) => a.fromM - b.fromM)
  const speedKeys = sortedParamKeys(input.paramKeys ?? [], 'speed')
  const curve: SpeedCurve | undefined =
    speedKeys.length > 0 ? { knotsM: speedKeys.map((k) => k.atM), at: (x) => valueAtKeys(speedKeys, 1, x, true) } : undefined
  const flight: Pacing = flightPacing(input.lengthM, input.durationS, input.pacing, pauses, speeds, curve, input.stages)
  const openingS = shotDurationS(input.opening)
  const closingS = shotDurationS(input.closing)
  const flightS = flight.totalTime()
  const total = openingS + flightS + closingS
  // the identity flight (no track) has no pause: no stop either
  const stops: ClockStop[] = []
  const nights: ClockNight[] = []
  const held = new Map<JunctionInput, ClockJunction>()
  const recaps = new Map<JunctionInput, NonNullable<ClockJunction['recap']>>()
  flight.pauses.forEach((pause, k) => {
    const times = {
      progress: pause.progress,
      startS: openingS + pause.startS,
      holdStartS: openingS + pause.holdStartS,
      holdEndS: openingS + pause.holdEndS,
      endS: openingS + pause.endS,
    }
    const { stop, night, junction, recapOf } = pauses[k]
    if (recapOf) {
      recaps.set(recapOf, { startS: times.startS, holdStartS: times.holdStartS, endS: times.endS, durationS: pause.durationS })
      return
    }
    if (stop) stops.push({ ...stop, ...times, addedS: pause.durationS })
    else if (night) nights.push({ ...night, ...times })
    if (junction) held.set(junction, { ...clockJunction(junction), ...times, ...(junction.night && junction.recap ? { view: true } : {}) })
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
  // a plain cut holds nothing: all its times are the film time of the cut
  const junctions: ClockJunction[] =
    input.lengthM > 0
      ? (input.junctions ?? []).map((j) => {
          const timeS = flightTimeOf(j.atM)
          const progress = Math.min(1, j.atM / input.lengthM)
          const placed = held.get(j) ?? { ...clockJunction(j), progress, startS: timeS, holdStartS: timeS, holdEndS: timeS, endS: timeS }
          const recap = recaps.get(j)
          return recap ? { ...placed, recap } : placed
        })
      : []

  const progressAtTime = (tS: number) => flight.progressAtTime(tS - openingS)
  const timeAtProgress = (progress: number) => (progress >= 1 ? total : openingS + flight.timeAtProgress(progress))

  // a day's card: with the flight for the first; for the others, once the night pause before it ends (or, over a high
  // view of the day, as it starts), else where the marker reaches the day's first point
  const days: ClockDay[] =
    input.lengthM > 0
      ? (input.days ?? []).map((day, k) => {
          const night = k === 0 ? null : nights.find((n) => localDate(n.sunriseMs, input.utcOffsetMin) === day.date) ?? null
          const reachedS = timeAtProgress(k === 0 ? 0 : day.startM / input.lengthM)
          const view = night !== null && input.dayView === true
          const cardS = night ? (view ? night.holdStartS : Math.max(reachedS, night.holdEndS)) : reachedS
          return { ...day, night, cardS, view }
        })
      : []

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
    junctions,
    nights,
    days,
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
  /** ids of the tracks of the stages when the track is a sequence, in order: the junction k follows the stage k */
  stageIds?: readonly string[]
  /** « Bilan »: the regions of the stages; its junctions and stage times are the chapters' (`bilanInputs`) */
  bilan?: BilanPlan
}

/**
 * The junctions at the cuts of `source` for its film and the nights left to the flight (`junctionPlan`), and the stages
 * with a flight time of their own: the part of the clock input that follows the film's stages and junctions, to place
 * those of a film being edited.
 */
export function junctionInputsFor({ track, film, durationS, cutsM, stageIds, bilan }: FilmClockFor): Pick<FilmClockInput, 'junctions' | 'nights' | 'stages'> {
  if (!track) return { junctions: [], nights: [], stages: [] }
  if (bilan && cutsM?.length) return bilanInputs(bilan, stageIds ?? [], cutsM, track.stats.distanceM, durationS)
  const path = trackPathOf(track)
  // not a sequence: the nights of the flight, as ever
  if (!cutsM?.length) return { junctions: [], nights: flightNights(path, film.nights, durationS), stages: [] }
  // with « Jours et nuits » off, the night a junction of kind 'nuit' passes is looked for as if it were on
  const plan = junctionPlan(film, stageIds ?? [], cutsM, flightNights(path, { ...film.nights, enabled: true }, durationS))
  return { ...plan, stages: stageSpansOf(film, stageIds ?? [], cutsM, track.stats.distanceM) }
}

/** The days of the track when their cards are on (« Cartes de jour »), a single track and several days: else none. */
export function dayInputsFor({ track, film, cutsM }: FilmClockFor): Pick<FilmClockInput, 'days' | 'utcOffsetMin' | 'dayView'> {
  if (!track || cutsM?.length || !film.dayCards?.enabled) return {}
  const days = trackDays(trackPathOf(track), track.utcOffsetMin)
  return days.length < 2 ? {} : { days, utcOffsetMin: track.utcOffsetMin, dayView: film.dayCards.view }
}

/** Input of the clock of the film of `track`: generated stops from the landmarks. */
export function filmClockInputFor(source: FilmClockFor): FilmClockInput {
  const { track, film, durationS, pacing, landmarks = [], cutsM } = source
  return {
    opening: film.opening,
    closing: film.closing,
    stops: track ? filmStops(film, { track, landmarks, durationS }) : [],
    speeds: track ? film.speeds : [],
    cameraKeys: track ? film.cameraKeys : [],
    paramKeys: track ? film.paramKeys : [],
    markerKeys: track ? film.markerKeys : [],
    cutsM: track ? cutsM : [],
    ...junctionInputsFor(source),
    ...dayInputsFor(source),
    lengthM: track?.stats.distanceM ?? 0,
    durationS,
    pacing,
  }
}

/** Clock of the film of `track` (`filmClockInputFor`). */
export function filmClockFor(input: FilmClockFor): FilmClock {
  return buildFilmClock(filmClockInputFor(input))
}
