/**
 * Automatic assembly of the film when a track is loaded: overview opening, flight with a stop at each highlight (one
 * per cluster, like the pauses it replaces), overview closing. The user retouches it on the timeline and in « Repères »
 * (Carte tab), where each landmark and point of interest has its « Arrêt ».
 *
 * A stop at every pass crossed, peak nearby and record of the outing, camera orbiting; with `Film.autoStopsPlaces`
 * also at the places the track goes through (villages, huts, lakes, waterfalls, viewpoints), a few at most. Pure module.
 */
import type { Track } from '../core/types'
import { DEFAULT_FLYOVER_DURATION_S } from '../flyover/cameraSettings'
import { isHighlightLandmark, pausePositions } from '../flyover/pacing'
import { AUTO_STOP_RECORDS } from '../import/records'
import type { Landmark } from '../osm/landmarks'
import { AUTO_STOP_S } from './model'
import type { Film, FilmStop } from './model'

export interface AssembleInput {
  /** first track */
  track: Track
  /** OpenStreetMap landmarks of the track (from the landmark store) */
  landmarks?: readonly Landmark[]
  /** flyover duration at ×1 (seconds): limits the stops of `autoStopsPlaces`; absent: the default duration */
  durationS?: number
}

/** Id of a generated stop: its rounded position, stable while the highlights do not move. */
export function autoStopId(atM: number): string {
  return `auto-${Math.round(atM)}`
}

/** A highlight a stop can be made for. */
export type StopCandidate = Required<Pick<FilmStop, 'atM' | 'label' | 'source'>>

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

/** Highlights closer than this make one automatic stop (metres; `Film.autoStopGroupM` changes it). */
export const AUTO_STOP_GROUP_M = 1000

/** A landmark of these kinds this close to the track is a notable place (metres): `autoStopsPlaces`. */
export const PLACE_STOP_MAX_M: Readonly<Partial<Record<Landmark['kind'], number>>> = { place: 150, hut: 300, lake: 300, waterfall: 300, viewpoint: 300 }
/** With `autoStopsPlaces`, the automatic stops are at least this far apart in film time at the base speed (seconds). */
export const PLACE_STOP_GAP_S = 12

/** The notable places `autoStopsPlaces` adds, among the landmarks shown: villages, huts, lakes, waterfalls and viewpoints close to the track. */
function placeCandidates({ track, landmarks = [] }: AssembleInput): StopCandidate[] {
  const L = track.stats.distanceM
  return landmarks
    .filter((l) => l.distanceM <= (PLACE_STOP_MAX_M[l.kind] ?? -1))
    .map((l): StopCandidate => ({ atM: Math.min(L, Math.max(0, l.alongM)), label: l.name, source: { kind: 'landmark', ref: l.id } }))
}

/**
 * Stops at the highlights, one per cluster: at the `stopCandidates`, grouped within `groupM` (`Film.autoStopGroupM`),
 * `AUTO_STOP_S` each, camera orbiting. With `places` (`Film.autoStopsPlaces`) the notable places come too, and the stops are
 * kept at least `PLACE_STOP_GAP_S` of film apart at the base speed (and `groupM` apart), the most notable first: passes,
 * peaks and records, then the others by the ranking of the landmarks (`Landmark.priority`).
 */
export function autoStops(input: AssembleInput, groupM = AUTO_STOP_GROUP_M, places = false): FilmStop[] {
  const { track } = input
  const L = track.stats.distanceM
  if (!(L > 0)) return []
  const stop = (atM: number, { label, source }: StopCandidate): FilmStop => ({ id: autoStopId(atM), atM, durationS: AUTO_STOP_S, camera: 'orbite', label, source })
  if (!places) {
    const candidates = stopCandidates(input)
    const positions = [...new Set(candidates.map((c) => c.atM))]
    return pausePositions(positions, groupM).map((atM) => stop(atM, candidates.find((c) => c.atM === atM)!))
  }
  const durationS = input.durationS ?? DEFAULT_FLYOVER_DURATION_S
  const gapM = Math.max(groupM, (PLACE_STOP_GAP_S * L) / durationS)
  const priority = new Map((input.landmarks ?? []).map((l) => [l.id, l.priority]))
  const ranked = [...stopCandidates(input).map((c) => ({ c, tier: 0 })), ...placeCandidates(input).map((c) => ({ c, tier: 1 }))].sort(
    (a, b) => a.tier - b.tier || (priority.get(b.c.source.ref!) ?? 0) - (priority.get(a.c.source.ref!) ?? 0) || a.c.atM - b.c.atM,
  )
  const max = Math.max(1, Math.floor(durationS / PLACE_STOP_GAP_S))
  const kept: StopCandidate[] = []
  for (const { c } of ranked) {
    if (kept.length >= max) break
    if (kept.every((k) => Math.abs(k.atM - c.atM) >= gapM)) kept.push(c)
  }
  return kept.sort((a, b) => a.atM - b.atM).map((c) => stop(c.atM, c))
}

/** `film` with its generated stops written out (`autoStops` cleared): the first edit of a stop on the timeline. */
export function materializeStops(film: Film, input: AssembleInput): Film {
  return film.autoStops ? { ...film, autoStops: false, stops: autoStops(input, film.autoStopGroupM, film.autoStopsPlaces) } : film
}

/** Stops of `film`: generated while `autoStops` is set, else its own. */
export function filmStops(film: Film, input: AssembleInput): FilmStop[] {
  return film.autoStops ? autoStops(input, film.autoStopGroupM, film.autoStopsPlaces) : film.stops
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
  const added = autoStops(input, film.autoStopGroupM).filter(
    (c) => c.source?.ref?.startsWith('record:') && !kept.some((s) => Math.abs(s.atM - c.atM) < groupM || s.id === c.id),
  )
  const removed = film.stops.filter(stale)
  if (removed.length === 0 && added.length === 0) return { film, removed, added }
  return { film: { ...film, stops: [...kept, ...added].sort((a, b) => a.atM - b.atM) }, removed, added }
}
