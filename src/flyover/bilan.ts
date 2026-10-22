/**
 * « Bilan » (`settings.race.bilan`): a film of a whole season or year of outings. The tracks are drawn one after the other
 * in date order over a high fixed view of their region; tracks farther than `BILAN_REGION_KM` from each other form
 * separate regions, one chapter each. This module is the plan (which tracks, in which order, in which region) and the
 * figures that accumulate; `sequence.ts` makes the sequence from it, `follow.ts` the camera. See ARCHITECTURE.md
 * "Several tracks".
 *
 * Pure functions (no DOM, React, Three or store); the plan keeps its identity while the tracks do.
 */
import type { LonLatBounds, Track } from '../core/types'
import { trackPathOf } from './path'

/** Tracks whose boxes are farther apart than this (km) are in different regions. */
export const BILAN_REGION_KM = 50
/** Shortest time a track takes to draw itself (seconds): the film is longer than the flyover duration when there are many. */
export const BILAN_STAGE_MIN_S = 2
/** Pause of the fade to black between two regions (seconds). */
export const BILAN_REGION_HOLD_S = 1.5

const M_PER_DEG = (6371008.8 * Math.PI) / 180

/** Gap between two boxes (metres, 0 when they touch or overlap). */
export function boxGapM(a: LonLatBounds, b: LonLatBounds): number {
  const dLat = Math.max(0, a.south - b.north, b.south - a.north)
  const dLon = Math.max(0, a.west - b.east, b.west - a.east)
  const midLat = ((Math.max(a.south, b.south) + Math.min(a.north, b.north)) / 2) * (Math.PI / 180)
  return Math.hypot(dLon * Math.cos(midLat) * M_PER_DEG, dLat * M_PER_DEG)
}

/**
 * The boxes grouped into regions: two boxes closer than `km` are in the same one, and so are those linked through
 * others. Groups in order of their first box, each in the order of the input (indexes into `boxes`).
 */
export function clusterBoxes(boxes: readonly LonLatBounds[], km = BILAN_REGION_KM): number[][] {
  const parent = boxes.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (root(i) !== root(j) && boxGapM(boxes[i], boxes[j]) <= km * 1000) parent[root(j)] = root(i)
    }
  }
  const groups = new Map<number, number[]>()
  boxes.forEach((_, i) => {
    const r = root(i)
    groups.set(r, [...(groups.get(r) ?? []), i])
  })
  return [...groups.values()].sort((a, b) => a[0] - b[0])
}

/** The figures of one outing, as the cards and counters show them (corrected by hand where the track says so). */
export interface OutingFigures {
  distanceM: number
  ascentM?: number
  durationS?: number
  maxEleM?: number
}

export function outingFigures(track: Track): OutingFigures {
  const o = track.statsOverride ?? {}
  const hasEle = track.stats.maxEle !== undefined
  return {
    distanceM: o.distanceM ?? trackPathOf(track).lengthM,
    ascentM: o.ascentM ?? (hasEle ? track.stats.ascentM : undefined),
    durationS: o.durationS ?? track.stats.durationS,
    maxEleM: o.maxEle ?? track.stats.maxEle,
  }
}

/** The figures of several outings added up: a missing one counts for nothing, and is missing from the total only when it is from every outing. */
export function addFigures(list: readonly OutingFigures[]): OutingFigures {
  const sum = (of: (f: OutingFigures) => number | undefined) => {
    const known = list.flatMap((f) => (of(f) === undefined ? [] : [of(f) as number]))
    return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0)
  }
  const high = list.flatMap((f) => (f.maxEleM === undefined ? [] : [f.maxEleM]))
  return {
    distanceM: list.reduce((s, f) => s + f.distanceM, 0),
    ascentM: sum((f) => f.ascentM),
    durationS: sum((f) => f.durationS),
    maxEleM: high.length === 0 ? undefined : Math.max(...high),
  }
}

/** A region of the film: a chapter, its tracks in the order they are drawn. */
export interface BilanRegion {
  index: number
  /** the stages of its tracks in the sequence */
  firstStage: number
  stageCount: number
  /** the recorded start of its first and last outing (ms), when they have one */
  fromMs?: number
  toMs?: number
  figures: OutingFigures
}

export interface BilanPlan {
  /** every track, in the order of the stages: regions by their first date, each region's outings by date, those without a date last */
  tracks: readonly Track[]
  regions: readonly BilanRegion[]
  /** the region of each stage */
  regionOf: readonly number[]
}

const startOf = (track: Track) => track.stats.startTime

/** The plan for `tracks` (none: an empty plan). */
export function planBilan(tracks: readonly Track[]): BilanPlan {
  const groups = clusterBoxes(tracks.map((t) => t.bounds))
  // the outings of a region by date (a stable sort), those without a date after the others
  const dated = (list: number[]) => [...list].sort((a, b) => (startOf(tracks[a]) ?? Infinity) - (startOf(tracks[b]) ?? Infinity) || a - b)
  const sorted = groups.map(dated)
  const firstDate = (g: number[]) => startOf(tracks[g[0]]) ?? Infinity
  const regionsInOrder = sorted.map((g, i) => ({ g, i })).sort((a, b) => firstDate(a.g) - firstDate(b.g) || a.i - b.i)
  const ordered: Track[] = []
  const regionOf: number[] = []
  const regions = regionsInOrder.map(({ g }, index): BilanRegion => {
    const members = g.map((i) => tracks[i])
    const times = members.flatMap((t) => (startOf(t) === undefined ? [] : [startOf(t) as number]))
    const region: BilanRegion = { index, firstStage: ordered.length, stageCount: members.length, figures: addFigures(members.map(outingFigures)) }
    if (times.length > 0) {
      region.fromMs = times[0]
      region.toMs = times[times.length - 1]
    }
    ordered.push(...members)
    members.forEach(() => regionOf.push(index))
    return region
  })
  return { tracks: ordered, regions, regionOf }
}

let last: { tracks: readonly Track[]; plan: BilanPlan } | null = null

/** `planBilan`, kept while the tracks keep their ids, points, names and dates (a colour change does not make it again). */
export function bilanPlanOf(tracks: readonly Track[]): BilanPlan {
  const same =
    last !== null &&
    last.tracks.length === tracks.length &&
    last.tracks.every((t, i) => t.id === tracks[i].id && t.segments === tracks[i].segments && t.name === tracks[i].name && t.statsOverride === tracks[i].statsOverride)
  if (!same || !last) last = { tracks, plan: planBilan(tracks) }
  return last.plan
}

/**
 * The time each stage of a sequence flies for (seconds, equal for all): the flyover duration shared between the
 * stages, at least BILAN_STAGE_MIN_S each.
 */
export function bilanStageS(stageCount: number, flyoverDurationS: number): number {
  return Math.max(BILAN_STAGE_MIN_S, stageCount > 0 ? flyoverDurationS / stageCount : 0)
}

/** The figures of the stages before each stage (`before[k]` = those of the stages 0..k-1), for the counters that climb. */
export function figuresBefore(tracks: readonly Track[]): OutingFigures[] {
  const out: OutingFigures[] = []
  let sum: OutingFigures = { distanceM: 0 }
  for (const track of tracks) {
    out.push(sum)
    sum = addFigures([sum, outingFigures(track)])
  }
  return out
}
