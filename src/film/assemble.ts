/**
 * Automatic assembly of the film when a track is loaded: overview opening, flight with a stop at each highlight (one
 * per cluster, like the pauses it replaces), overview closing. The user retouches it on the timeline and in « Repères »
 * (Carte tab), where each landmark and point of interest has its « Arrêt ».
 *
 * New films ('temps-forts') stop at every pass crossed and peak nearby, camera orbiting; films saved before the
 * timeline ('rythme') keep the pauses of the pacing, climb tops included. Pure module.
 */
import type { Track } from '../core/types'
import { climbsOf } from '../flyover/climbs'
import { DEFAULT_PACING, isHighlightLandmark, pausePositions } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { AUTO_STOP_RECORDS } from '../import/records'
import type { Landmark } from '../osm/landmarks'
import { climbLabelText } from '../scene/labelModel'
import { AUTO_STOP_S } from './model'
import type { AutoStopMode, Film, FilmStop } from './model'

export interface AssembleInput {
  /** first track */
  track: Track
  /** OpenStreetMap landmarks of the track (from the landmark store) */
  landmarks?: readonly Landmark[]
  pacing: PacingSettings
}

/** Id of a generated stop: its rounded position, stable while the highlights do not move. */
export function autoStopId(atM: number): string {
  return `auto-${Math.round(atM)}`
}

/** A highlight a stop can be made for. */
export type StopCandidate = Required<Pick<FilmStop, 'atM' | 'label' | 'source'>>

/** Climb tops of the track (`pacing.climbs`): only the pauses of the films saved before the timeline ('rythme') stop there. */
function climbCandidates({ track, pacing }: AssembleInput): StopCandidate[] {
  if (!pacing.climbs) return []
  const L = track.stats.distanceM
  return climbsOf(track).map((climb, i) => ({
    atM: Math.min(L, Math.max(0, climb.endDistM)),
    label: climbLabelText(climb, i),
    source: { kind: 'climb', ref: String(i) },
  }))
}

/**
 * Where the film offers a stop by itself, by position: the passes crossed, the peaks nearby and the records of the
 * outing that make stops (`withRecords`, `AUTO_STOP_RECORDS`: the other records stay labels) among the landmarks shown (Carte › Repères). Not the climb tops: stops come from the landmarks,
 * the points of interest and the timeline.
 */
export function stopCandidates({ track, landmarks = [] }: Pick<AssembleInput, 'track' | 'landmarks'>, withRecords = true): StopCandidate[] {
  const L = track.stats.distanceM
  return landmarks
    .filter((l) => isHighlightLandmark(l) || (withRecords && l.recordKind !== undefined && AUTO_STOP_RECORDS.includes(l.recordKind)))
    .map((l): StopCandidate => ({ atM: Math.min(L, Math.max(0, l.alongM)), label: l.name, source: { kind: 'landmark', ref: l.id } }))
    .sort((a, b) => a.atM - b.atM)
}

/** The stop of `stops` at `atM` (within a metre), the one a highlight there has. */
export function stopAt<S extends Pick<FilmStop, 'atM'>>(stops: readonly S[], atM: number): S | undefined {
  return stops.find((s) => Math.abs(s.atM - atM) < 1)
}

/** A row of « Repères » that can have a stop: an OSM landmark (id "node/123") or a point of interest ("poi-2"). */
export interface StopPlace {
  id: string
  /** where its stop goes along the first track (metres) */
  atM: number
}

/**
 * The stop of `stops` made for `place`: the one made for its landmark (`source.ref`), else one placed by hand within a
 * metre of it (`stopAt`; the stops of the points of interest carry their name only). A stop made for another landmark
 * or for a climb there is not its stop.
 */
export function placeStop<S extends Pick<FilmStop, 'atM' | 'source'>>(stops: readonly S[], place: StopPlace): S | undefined {
  const byHand = (s: S) => s.source === undefined || s.source.kind === 'manual'
  return stops.find((s) => s.source?.kind === 'landmark' && s.source.ref === place.id) ?? stopAt(stops.filter(byHand), place.atM)
}

/**
 * `film` without the stops of the `places` the user hides (the film's own; generated ones follow the landmarks shown by
 * themselves). The same film when nothing goes.
 */
export function withoutPlaceItems(film: Film, places: readonly StopPlace[]): Film {
  const stops = film.autoStops ? film.stops : film.stops.filter((s) => !places.some((p) => placeStop([s], p)))
  return stops.length === film.stops.length ? film : { ...film, stops }
}

/** Highlights closer than this make one automatic stop (metres; the default « Longueur du ralenti », which no longer sets it). */
export const AUTO_STOP_GROUP_M = DEFAULT_PACING.windowM

/**
 * Stops at the highlights, one per cluster (like the pauses they replace): 'temps-forts' at the `stopCandidates`
 * (whatever the pacing), grouped within `groupM` (`Film.autoStopGroupM`), `AUTO_STOP_S` each, camera orbiting; 'rythme'
 * at the highlights of the pacing (climb tops included, landmarks with `pacing.landmarks`) only while it is on, grouped
 * within `pacing.windowM`, `pauseS` each, camera as in the film (as these pauses were; without the records, which did not exist).
 */
export function autoStops(input: AssembleInput, mode: AutoStopMode, groupM = AUTO_STOP_GROUP_M): FilmStop[] {
  const { track, pacing } = input
  const legacy = mode === 'rythme'
  if (!(track.stats.distanceM > 0) || (legacy && (!pacing.enabled || !(pacing.pauseS > 0)))) return []
  const candidates = legacy
    ? [...climbCandidates(input), ...(pacing.landmarks ? stopCandidates(input, false) : [])].sort((a, b) => a.atM - b.atM)
    : stopCandidates(input)
  const positions = [...new Set(candidates.map((c) => c.atM))]
  return pausePositions(positions, legacy ? pacing.windowM : groupM).map((atM) => {
    const { label, source } = candidates.find((c) => c.atM === atM)!
    const durationS = legacy ? pacing.pauseS : AUTO_STOP_S
    return { id: autoStopId(atM), atM, durationS, camera: legacy ? 'film' : 'orbite', label, source }
  })
}

/** `film` with its generated stops written out (`autoStops` cleared): the first edit of a stop on the timeline. */
export function materializeStops(film: Film, input: AssembleInput): Film {
  return film.autoStops ? { ...film, autoStops: false, stops: autoStops(input, film.autoMode, film.autoStopGroupM) } : film
}

/** Stops of `film`: generated while `autoStops` is set, else its own. */
export function filmStops(film: Film, input: AssembleInput): FilmStop[] {
  return film.autoStops ? autoStops(input, film.autoMode, film.autoStopGroupM) : film.stops
}

/** A stop `autoStops` wrote out for a record of the outing (`record:<track>:<kind>`), as opposed to one the user made. */
function isRecordStop(stop: FilmStop): boolean {
  return stop.id.startsWith('auto-') && stop.source?.kind === 'landmark' && stop.source.ref?.startsWith('record:') === true
}

/**
 * `film` with the stops written out for records brought in line with the records shown now (`input.landmarks`): those
 * whose record is gone, moved or no longer makes a stop are removed, the ones the rules give now (`autoStops`, records
 * only) are added unless a stop is already there (within `Film.autoStopGroupM`). The other stops (the user's, the
 * landmarks') are never touched, and a film that generates its stops follows the records by itself: it comes back as is.
 */
export function alignRecordStops(film: Film, input: AssembleInput): { film: Film; removed: FilmStop[]; added: FilmStop[] } {
  if (film.autoStops) return { film, removed: [], added: [] }
  const L = input.track.stats.distanceM
  const shown = new Map((input.landmarks ?? []).filter((l) => l.recordKind !== undefined).map((l) => [l.id, l]))
  const stale = (s: FilmStop) => {
    const l = isRecordStop(s) ? shown.get(s.source!.ref!) : undefined
    return isRecordStop(s) && !(l && AUTO_STOP_RECORDS.includes(l.recordKind!) && Math.abs(Math.min(L, Math.max(0, l.alongM)) - s.atM) < 1)
  }
  const kept = film.stops.filter((s) => !stale(s))
  const groupM = film.autoStopGroupM ?? AUTO_STOP_GROUP_M
  const added =
    film.autoMode === 'temps-forts'
      ? autoStops(input, film.autoMode, film.autoStopGroupM).filter(
          (c) => c.source?.ref?.startsWith('record:') && !kept.some((s) => Math.abs(s.atM - c.atM) < groupM || s.id === c.id),
        )
      : []
  const removed = film.stops.filter(stale)
  if (removed.length === 0 && added.length === 0) return { film, removed, added }
  return { film: { ...film, stops: [...kept, ...added].sort((a, b) => a.atM - b.atM) }, removed, added }
}
