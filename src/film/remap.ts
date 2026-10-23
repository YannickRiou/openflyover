/**
 * The film after a track tool changed the points of a track (« Outils de la trace »: trim, cut, reverse, pauses…):
 * everything the film anchors in metres along the film track (stops, camera / parameter / marker keys, speed portions)
 * follows the places it was set on. Pure module (no DOM, no React, no store); `applyTrackTool` (ui/applyTrackTool.ts) runs it
 * in the same step as the replacement of the track. See ARCHITECTURE.md "Track tools".
 *
 * The film track is the first track, or the sequence of the stages « À la suite » (`StageSpan`: metres along the whole
 * sequence). The edited track is one stage; the items of the stages after it move with the change of their stage's start,
 * those on the edited stage with the map of its places, and an item on a stretch the tool removed is dropped.
 */
import type { DistanceMap } from '../import/tools/distanceMap'
import { MIN_SPEED_SPAN_M } from './model'
import type { Film, FilmSpeed } from './model'
import type { StageSpan } from './reorder'

export interface RemapResult {
  film: Film
  /** items (stops, keys, speed portions) that stood on a removed stretch and are gone */
  dropped: number
}

/**
 * `film` for the stages `before` now standing as `after` (the same stages), the track `editedId` having changed by
 * `distances` (distances local to that track). `film` itself when nothing moves.
 */
export function remapFilm(film: Film, before: readonly StageSpan[], after: readonly StageSpan[], editedId: string, distances: DistanceMap): RemapResult {
  const newSpan = new Map(after.map((s) => [s.trackId, s]))
  const edited = before.findIndex((s) => s.trackId === editedId)
  if (edited < 0 || before.some((s) => !newSpan.has(s.trackId))) return { film, dropped: 0 }
  const last = before.length - 1
  const stageOf = (atM: number) => {
    const k = before.findIndex((s) => atM >= s.startM && atM < s.endM)
    return k >= 0 ? k : atM >= before[last].endM ? last : 0
  }
  /** `atM` of stage `k` on the new scale (a removed stretch: the nearest places that survive) */
  const mapped = (atM: number, k: number): number => {
    const old = before[k]
    const now = newSpan.get(old.trackId)!
    if (k !== edited) return atM + (now.startM - old.startM)
    const local = Math.min(Math.max(atM - old.startM, 0), old.endM - old.startM)
    return now.startM + Math.min(distances.map(local), now.endM - now.startM)
  }
  /** `atM` of stage `k` stood on a removed stretch */
  const gone = (atM: number, k: number): boolean => k === edited && distances.removed(Math.min(Math.max(atM - before[k].startM, 0), before[k].endM - before[k].startM))

  let dropped = 0
  let changed = false
  const moved = <T extends { atM: number }>(items: T[]): T[] => {
    const out: T[] = []
    let same = true
    for (const item of items) {
      const k = stageOf(item.atM)
      const atM = mapped(item.atM, k)
      if (gone(item.atM, k)) {
        dropped++
        same = false
      } else if (atM === item.atM) out.push(item)
      else {
        out.push({ ...item, atM })
        same = false
      }
    }
    if (!same) changed = true
    return same ? items : out
  }

  let speedNumber = film.speeds.reduce((max, s) => Math.max(max, Number(/^speed-(\d+)$/.exec(s.id)?.[1] ?? 0)), 0)
  const speeds = film.speeds.flatMap((speed): FilmSpeed[] => {
    const pieces = before.flatMap((stage, k) => {
      const fromM = Math.max(speed.fromM, stage.startM)
      const toM = Math.min(speed.toM, stage.endM)
      if (toM <= fromM || (gone(fromM, k) && gone(toM, k))) return []
      const [a, b] = [mapped(fromM, k), mapped(toM, k)]
      return [{ fromM: Math.min(a, b), toM: Math.max(a, b) }]
    })
    const touched = before.some((stage) => Math.min(speed.toM, stage.endM) > Math.max(speed.fromM, stage.startM))
    if (!touched) return [speed]
    const kept = pieces.filter((p) => p.toM - p.fromM >= MIN_SPEED_SPAN_M)
    if (kept.length === 0) dropped++
    if (kept.length !== 1 || kept[0].fromM !== speed.fromM || kept[0].toM !== speed.toM) changed = true
    return kept.map((p, i) => ({ ...speed, id: i === 0 ? speed.id : `speed-${++speedNumber}`, fromM: p.fromM, toM: p.toM }))
  })

  const next: Film = { ...film, stops: moved(film.stops), speeds, cameraKeys: moved(film.cameraKeys), paramKeys: moved(film.paramKeys), markerKeys: moved(film.markerKeys) }
  return changed ? { film: next, dropped } : { film, dropped: 0 }
}
