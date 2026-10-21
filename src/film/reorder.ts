/**
 * Reordering the stages « À la suite » (`race.order`): everything the film anchors in metres along the sequence follows
 * its stage to the new place of the stage, and the junctions follow their pair of stages. Pure module (no DOM, no React,
 * no store); the store action (`reorderTracks`, scene/usePacing.ts) builds the two lists of stage spans, calls this and
 * writes the order and the film as one undo step. See ARCHITECTURE.md "Several tracks".
 *
 * Texts, media and music keep their film seconds; those attached to a stop follow it through `followStops`, which the
 * caller runs with the clocks of the two orders.
 */
import type { Track } from '../core/types'
import { junctionId } from './junctions'
import { MIN_SPEED_SPAN_M } from './model'
import type { Film, FilmJunction, FilmSpeed, StoredStageCard } from './model'

/** A stage's place along the sequence (`Stage` of flyover/sequence.ts: metres from the start of the film track). */
export interface StageSpan {
  trackId: string
  startM: number
  endM: number
}

/** `ids` with `id` moved to place `toIndex` (clamped); the same array when it does not move or is unknown. */
export function movedIds(ids: readonly string[], id: string, toIndex: number): readonly string[] {
  const from = ids.indexOf(id)
  const to = Math.min(ids.length - 1, Math.max(0, toIndex))
  if (from < 0 || from === to) return ids
  const out = [...ids]
  out.splice(to, 0, ...out.splice(from, 1))
  return out
}

/**
 * Place a dragged stage takes among the others when released at `pos`: how many of the others (`centres`: the middle of
 * each, along the axis of the list, the dragged one left out) the pointer has passed.
 */
export const dropIndexAt = (centres: readonly number[], pos: number): number => centres.filter((c) => c < pos).length

/** The ids of `tracks` by departure, the tracks without a time last, a tie keeping the list order. */
export function idsByDate(tracks: readonly Track[]): string[] {
  const time = (t: Track) => t.stats.startTime ?? Number.POSITIVE_INFINITY
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (time(a.t) === time(b.t) ? a.i - b.i : time(a.t) < time(b.t) ? -1 : 1))
    .map(({ t }) => t.id)
}

/**
 * The film of the stages `before` with every metre-anchored item moved with its stage to where the stage stands in
 * `after` (the same stages, in another order): stops, camera / parameter / marker keys and speed portions (a portion
 * across a boundary is split in two, the same factor on each stage, the pieces under `MIN_SPEED_SPAN_M` dropped). An item
 * exactly on a boundary belongs to the stage that starts there (as `stageAt`), the end of the last stage to the last.
 *
 * A junction keeps its transition only between the two stages it was between; elsewhere it is the default one. The card
 * of a stage stays with the stage (the first card too). `film` itself when the stages do not change order or are not
 * the same set.
 */
export function reorderStages(film: Film, before: readonly StageSpan[], after: readonly StageSpan[]): Film {
  const newStart = new Map(after.map((s) => [s.trackId, s.startM]))
  if (
    before.length === 0 ||
    before.length !== after.length ||
    before.some((s) => !newStart.has(s.trackId)) ||
    before.every((s, k) => s.trackId === after[k].trackId)
  ) {
    return film
  }
  const last = before.length - 1
  const stageOf = (atM: number) => {
    const k = before.findIndex((s) => atM >= s.startM && atM < s.endM)
    return k >= 0 ? k : atM >= before[last].endM ? last : 0
  }
  /** metres to add to what is in stage `k` */
  const shiftOf = (k: number) => newStart.get(before[k].trackId)! - before[k].startM
  const moved = <T extends { atM: number }>(items: T[]): T[] =>
    items.map((item) => {
      const atM = item.atM + shiftOf(stageOf(item.atM))
      return atM === item.atM ? item : { ...item, atM }
    })

  let speedNumber = film.speeds.reduce((max, s) => Math.max(max, Number(/^speed-(\d+)$/.exec(s.id)?.[1] ?? 0)), 0)
  const speeds = film.speeds.flatMap((speed): FilmSpeed[] => {
    const pieces = before.flatMap((s, k) => {
      const fromM = Math.max(speed.fromM, s.startM)
      const toM = Math.min(speed.toM, s.endM)
      return toM > fromM ? [{ fromM: fromM + shiftOf(k), toM: toM + shiftOf(k), lengthM: toM - fromM }] : []
    })
    if (pieces.length === 0) return [speed]
    const kept = pieces.length === 1 ? pieces : pieces.filter((p) => p.lengthM >= MIN_SPEED_SPAN_M)
    return kept.map((p, i) => ({ ...speed, id: i === 0 ? speed.id : `speed-${++speedNumber}`, fromM: p.fromM, toM: p.toM }))
  })

  const next: Film = {
    ...film,
    stops: moved(film.stops),
    speeds,
    cameraKeys: moved(film.cameraKeys),
    paramKeys: moved(film.paramKeys),
    markerKeys: moved(film.markerKeys),
  }
  if (film.junctions || film.firstCard) {
    const { junctions, firstCard } = reorderedJunctions(
      film,
      before.map((s) => s.trackId),
      after.map((s) => s.trackId),
    )
    // the optional fields stay absent rather than undefined
    if (junctions) next.junctions = junctions
    else delete next.junctions
    if (firstCard) next.firstCard = firstCard
    else delete next.firstCard
  }
  return next
}

/** `junctions` and `firstCard` of `film` for the stages `beforeIds` flown in the order `afterIds`. */
function reorderedJunctions(film: Film, beforeIds: readonly string[], afterIds: readonly string[]): Pick<Film, 'junctions' | 'firstCard'> {
  const stored = (afterTrackId: string) => film.junctions?.find((j) => j.afterTrackId === afterTrackId)
  /** the card of the stage `id` as the film stores it */
  const cardOf = (id: string): StoredStageCard | undefined => {
    const k = beforeIds.indexOf(id)
    return k === 0 ? film.firstCard : stored(beforeIds[k - 1])?.card
  }
  const junctions = afterIds.slice(0, -1).flatMap((id, k): FilmJunction[] => {
    const next = afterIds[k + 1]
    // the transition holds only between the stages it was between, in the same order
    const kept = beforeIds.indexOf(next) === beforeIds.indexOf(id) + 1 ? stored(id) : undefined
    const card = cardOf(next)
    const { card: _card, ...transition } = kept ?? { id: junctionId(id), afterTrackId: id }
    return kept?.kind !== undefined || kept?.holdS !== undefined || card ? [{ ...transition, ...(card ? { card } : {}) }] : []
  })
  return { junctions: film.junctions ? junctions : undefined, firstCard: cardOf(afterIds[0]) }
}
