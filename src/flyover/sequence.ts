/**
 * « À la suite » (`settings.race.sequence`): the film flies the tracks one after the other, in list order (or `race.order`), without
 * merging them. The film runs along a sequence track (never stored), so the clock, the stops, the camera keys and the
 * landmarks work in metres along it; each track stays a stage with its own colour, name and figures, and the camera
 * flies each stage on its own path (`flyover/follow.ts`). See ARCHITECTURE.md "Several tracks".
 *
 * Pure functions (no DOM, React, Three or store); results cached on their inputs so they keep their identity from one
 * frame to the next.
 */
import type { Track } from '../core/types'
import { chainName } from '../import/chain'
import { computeBounds, computeStats } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import { bilanPlanOf, type BilanPlan } from './bilan'
import { trackPathOf } from './path'
import type { RaceSettings } from './race'

/** What decides how the tracks play together (`settings.race`). */
type SequenceRace = Pick<RaceSettings, 'enabled' | 'sequence' | 'order' | 'bilan'>

/** One track of the sequence: metres along the sequence and the matching fractions of the film progress. */
export interface Stage {
  track: Track
  /** 0 for the first */
  index: number
  startM: number
  endM: number
  from: number
  to: number
}

export interface Sequence {
  /** the tracks' segments one after the other (id `suite:<ids>`), what the film flies */
  track: Track
  stages: readonly Stage[]
  /** where a stage starts, every one but the first (metres along the sequence) */
  cutsM: readonly number[]
  /** the stages' track ids in order: the junction k (after the stage k, at `cutsM[k]`) is keyed by the id k */
  stageIds: readonly string[]
  /** « Bilan »: the regions of the stages and the track the camera frames for each (see `flyover/bilan.ts`) */
  bilan?: BilanSequence
}

/** What « Bilan » adds to a sequence: the plan and, per region, the tracks of its stages as one track (the camera's view of the region). */
export interface BilanSequence {
  plan: BilanPlan
  views: readonly Track[]
}

/** The tracks are flown one after the other: « À la suite » chosen (the ghost race wins when both are set), 2+ tracks. */
export function playsInSequence(race: Pick<RaceSettings, 'enabled' | 'sequence'>, trackCount: number): boolean {
  return race.sequence === true && !race.enabled && trackCount >= 2
}

/** « Bilan » is chosen (it plays in sequence). */
export function playsBilan(race: Pick<RaceSettings, 'enabled' | 'sequence' | 'bilan'>, trackCount: number): boolean {
  return race.bilan === true && playsInSequence(race, trackCount)
}

/**
 * The tracks in the order of the stages: « À la suite » `race.order` (ids that are no longer tracks are ignored, tracks
 * it lacks come last, in list order), else the list itself. Every reader of the order of the stages goes through here.
 */
export function orderedTracks(tracks: readonly Track[], race: SequenceRace): readonly Track[] {
  if (playsBilan(race, tracks.length)) {
    // the order of the dates, the tracks as the store holds them now (a colour change does not make the plan again)
    const byId = new Map(tracks.map((t) => [t.id, t]))
    return bilanPlanOf(tracks).tracks.map((t) => byId.get(t.id) ?? t)
  }
  if (!race.order || race.order.length === 0 || !playsInSequence(race, tracks.length)) return tracks
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const out: Track[] = []
  for (const id of race.order) {
    const track = byId.get(id)
    if (track) {
      out.push(track)
      byId.delete(id)
    }
  }
  for (const track of tracks) if (byId.has(track.id)) out.push(track)
  return out
}

/** Sequence of `tracks` in the order given (at least one track). */
export function buildSequence(tracks: readonly Track[]): Sequence {
  const segments = tracks.flatMap((t) => t.segments)
  const first = tracks[0]
  const track: Track = {
    id: `suite:${tracks.map((t) => t.id).join('+')}`,
    name: chainName(tracks.map((t) => t.name)),
    source: first.source,
    segments,
    stats: computeStats(segments),
    bounds: computeBounds(segments),
    color: first.color,
  }
  if (first.activityType) track.activityType = first.activityType
  if (first.utcOffsetMin !== undefined) track.utcOffsetMin = first.utcOffsetMin
  const waypoints = tracks.flatMap((t) => t.waypoints ?? [])
  if (waypoints.length > 0) track.waypoints = waypoints
  // same lengths as the paths the camera flies (the jumps between segments are not counted)
  const lengths = tracks.map((t) => trackPathOf(t).lengthM)
  const total = lengths.reduce((sum, l) => sum + l, 0)
  let startM = 0
  const stages = tracks.map((t, index) => {
    const endM = startM + lengths[index]
    const stage = { track: t, index, startM, endM, from: total > 0 ? startM / total : 0, to: total > 0 ? endM / total : 1 }
    startM = endM
    return stage
  })
  return { track, stages, cutsM: stages.slice(1).map((s) => s.startM), stageIds: tracks.map((t) => t.id) }
}

/** Last sequence built, with the tracks it was built from. */
let last: { tracks: readonly Track[]; sequence: Sequence } | null = null

/**
 * `buildSequence`, kept while the tracks keep their ids, points and names (a colour change does not rebuild it: the
 * stages read their colour from the store's tracks).
 */
export function sequenceOf(tracks: readonly Track[]): Sequence {
  const same =
    last !== null &&
    last.tracks.length === tracks.length &&
    last.tracks.every((t, i) => t.id === tracks[i].id && t.segments === tracks[i].segments && t.name === tracks[i].name)
  if (!same || !last) last = { tracks, sequence: buildSequence(tracks) }
  return last.sequence
}

/** Last « Bilan » sequence, with the plan it was built from (the plan keeps its identity while the tracks do). */
let lastBilan: { plan: BilanPlan; sequence: Sequence } | null = null

/** The sequence of a « Bilan »: the stages in date order, with the regions and what the camera frames of each. */
function bilanSequenceOf(tracks: readonly Track[]): Sequence {
  const plan = bilanPlanOf(tracks)
  if (lastBilan?.plan !== plan) {
    const views = plan.regions.map((r) => buildSequence(plan.tracks.slice(r.firstStage, r.firstStage + r.stageCount)).track)
    lastBilan = { plan, sequence: { ...buildSequence(plan.tracks), bilan: { plan, views } } }
  }
  return lastBilan.sequence
}

/** The sequence the film flies, null unless the tracks play « À la suite » (or « Bilan »). */
export function filmSequenceOf(tracks: readonly Track[], race: SequenceRace): Sequence | null {
  if (!playsInSequence(race, tracks.length)) return null
  return playsBilan(race, tracks.length) ? bilanSequenceOf(tracks) : sequenceOf(orderedTracks(tracks, race))
}

/** The track the film flies: the sequence « À la suite », else the first track (undefined without tracks). */
export function filmTrackOf(tracks: readonly Track[], race: SequenceRace): Track | undefined {
  return filmSequenceOf(tracks, race)?.track ?? tracks[0]
}

/** Last `filmTracksOf`, so the array keeps its identity while the ids and the points stay the same. */
let lastFilmTracks: readonly Track[] = []

/**
 * The tracks the film shows over the terrain, for the map layers fetched per track (water, forests): the stages
 * « À la suite » in their order, every racer of the ghost race, none in a « Bilan », else the first track alone. The array keeps its identity
 * while the ids and the points do (a colour change does not make the layers start again).
 */
export function filmTracksOf(tracks: readonly Track[], race: SequenceRace): readonly Track[] {
  // « Bilan »: none, a request per outing would be too many (the water and the forests of a high view are not worth them)
  const next = playsBilan(race, tracks.length) ? [] : race.enabled || playsInSequence(race, tracks.length) ? orderedTracks(tracks, race) : tracks.slice(0, 1)
  const same = next.length === lastFilmTracks.length && next.every((t, i) => t.id === lastFilmTracks[i].id && t.segments === lastFilmTracks[i].segments)
  if (!same) lastFilmTracks = next
  return lastFilmTracks
}

/**
 * Stage under the marker at film `progress` and the progress along it (0..1). A cut belongs to the stage it starts
 * (the end of the film to the last one).
 */
export function stageAt(sequence: Sequence, progress: number): { stage: Stage; progress: number } {
  const { stages } = sequence
  let k = 0
  while (k + 1 < stages.length && progress >= stages[k + 1].from) k++
  const stage = stages[k]
  const span = stage.to - stage.from
  return { stage, progress: span > 0 ? Math.min(1, Math.max(0, (progress - stage.from) / span)) : 0 }
}

/**
 * Track under the marker at film `progress` and the progress along it: « À la suite » the stage there (as the store
 * holds it), else the first track at `progress`. What the sun, the clouds and the weather follow.
 */
export function trackUnderMarker(
  tracks: readonly Track[],
  race: SequenceRace,
  progress: number,
): { track: Track; progress: number } | undefined {
  const sequence = filmSequenceOf(tracks, race)
  if (!sequence) return tracks[0] && { track: tracks[0], progress }
  const at = stageAt(sequence, progress)
  return { track: orderedTracks(tracks, race)[at.stage.index], progress: at.progress }
}

type LandmarkEntry ={ inputs: (readonly Landmark[] | undefined)[]; out: Landmark[] | undefined }
/** last results per sequence: the shown and the hidden landmarks each keep theirs */
const landmarkCache = new WeakMap<Sequence, LandmarkEntry[]>()
const LANDMARK_CACHE_SIZE = 2

/**
 * Landmarks of the sequence from the landmarks of each stage (`byTrack`, by track id), along the sequence; a landmark
 * near two stages (the hut between two days) once, on the first; undefined while none is loaded. Same array as long
 * as the stages' own arrays are the same.
 */
export function sequenceLandmarks(sequence: Sequence, byTrack: Readonly<Record<string, readonly Landmark[]>>): Landmark[] | undefined {
  const inputs = sequence.stages.map((s) => byTrack[s.track.id])
  const entries = landmarkCache.get(sequence) ?? []
  const cached = entries.find((e) => e.inputs.every((list, i) => list === inputs[i]))
  if (cached) return cached.out
  const seen = new Set<string>()
  const out = inputs.every((list) => list === undefined)
    ? undefined
    : sequence.stages.flatMap((s, i) =>
        (inputs[i] ?? []).flatMap((l) => {
          if (seen.has(l.id)) return []
          seen.add(l.id)
          return [{ ...l, alongM: l.alongM + s.startM }]
        }),
      )
  landmarkCache.set(sequence, [{ inputs, out }, ...entries].slice(0, LANDMARK_CACHE_SIZE))
  return out
}
