/**
 * The junctions between the stages « À la suite » (`film.junctions`, one per stage but the last): the transition
 * (a hard cut, a dip to black or white held on the film clock, a night) and the card of the stage that follows, as
 * the timeline's « Étapes » lane and « Textes » lane show and edit them. Pure module (no DOM, no React); the clock
 * places them (`clock.junctions`), the overlay draws the dip and the card from the clock.
 *
 * A junction is keyed by the track before it, so it survives a reorder; ids are derived (`junction-<trackId>`), there is
 * no counter to keep. Without a `FilmJunction` of its own a junction is the default one (`junctionDefaultOf`): the rest
 * of the code reads junctions only through `junctionOf` and `junctionCardOf`, never the optional fields.
 */
import { smootherstep } from '../core/math'
import { nightPauseS } from '../flyover/nights'
import type { FlightNight } from '../flyover/nights'
import type { FlightStage } from '../flyover/pacing'
import type { RaceSettings } from '../flyover/race'
import type { ClockJunction, FilmClock } from './clock'
import { JUNCTION_CARD_DEFAULT_S, JUNCTION_CARD_RANGE, JUNCTION_HOLD_RANGE, STAGE_DURATION_RANGE } from './model'
import type { Film, FilmJunction, JunctionCard, JunctionDefault, JunctionKind, TransitionDip } from './model'

/** Default junction of a film that never chose: a dip to black held for 1.5 s, a card for every stage. */
export const DEFAULT_JUNCTION: JunctionDefault = { kind: 'fondu-noir', holdS: 1.5, card: true }

/** Placement of a stage card that sets none: centred at the normal size, as the stage card always was. */
export const DEFAULT_STAGE_CARD: Omit<JunctionCard, 'enabled'> = { durationS: JUNCTION_CARD_DEFAULT_S, anchor: 'center', size: 1 }

// ---------------------------------------------------------------------------
// Ids (timeline selection)
// ---------------------------------------------------------------------------

const JUNCTION_PREFIX = 'junction-'
const STAGE_PREFIX = 'stage-'
const CARD_PREFIX = 'card-stage-'
/** Selection id of the card of the first stage (the others are `card-stage-<afterTrackId>`). */
export const FIRST_STAGE_CARD_ID = `${CARD_PREFIX}first`

export const junctionId = (afterTrackId: string) => `${JUNCTION_PREFIX}${afterTrackId}`
export const stageItemId = (trackId: string) => `${STAGE_PREFIX}${trackId}`
/** Selection id of the card of the stage that follows the junction after `afterTrackId` (null: the first stage). */
export const stageCardId = (afterTrackId: string | null) => (afterTrackId === null ? FIRST_STAGE_CARD_ID : `${CARD_PREFIX}${afterTrackId}`)

export const isJunctionItem = (item: string | null | undefined): item is string => typeof item === 'string' && item.startsWith(JUNCTION_PREFIX)
export const isStageItem = (item: string | null | undefined): item is string => typeof item === 'string' && item.startsWith(STAGE_PREFIX)
export const isStageCardItem = (item: string | null | undefined): item is string => typeof item === 'string' && item.startsWith(CARD_PREFIX)

/** Track id of a junction, stage or stage-card selection id. */
export const junctionTrackOf = (item: string) => item.slice(JUNCTION_PREFIX.length)
export const stageTrackOf = (item: string) => item.slice(STAGE_PREFIX.length)
/** Track before the junction a stage-card id belongs to, null for the first stage. */
export const stageCardAfterOf = (item: string): string | null => (item === FIRST_STAGE_CARD_ID ? null : item.slice(CARD_PREFIX.length))

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const junctionDefaultOf = (film: Pick<Film, 'junctionDefault'>): JunctionDefault => film.junctionDefault ?? DEFAULT_JUNCTION

/** A junction with every field set. */
export type ResolvedJunction = Required<Pick<FilmJunction, 'id' | 'afterTrackId' | 'kind' | 'holdS'>>

/** The junction after the stage of track `afterTrackId`: what the film stores of it, the default for the rest. */
export function junctionOf(film: Pick<Film, 'junctions' | 'junctionDefault'>, afterTrackId: string): ResolvedJunction {
  const stored = film.junctions?.find((j) => j.afterTrackId === afterTrackId)
  const fallback = junctionDefaultOf(film)
  const kind = stored?.kind ?? fallback.kind
  return { id: junctionId(afterTrackId), afterTrackId, kind, holdS: kind === 'coupe' ? 0 : (stored?.holdS ?? fallback.holdS) }
}

/** The film chose how the junction after `afterTrackId` passes (`kind` is stored), rather than leaving it to the default. */
export const hasOwnTransition = (film: Pick<Film, 'junctions'>, afterTrackId: string) =>
  film.junctions?.some((j) => j.afterTrackId === afterTrackId && j.kind !== undefined) === true

const hasStored = (film: Pick<Film, 'junctions'>, afterTrackId: string) => film.junctions?.some((j) => j.afterTrackId === afterTrackId) === true

/** Card of the stage that follows the junction after `afterTrackId` (null: the first stage), the default one without its own. */
export function junctionCardOf(film: Pick<Film, 'junctions' | 'junctionDefault' | 'firstCard'>, afterTrackId: string | null): JunctionCard {
  const own = afterTrackId === null ? film.firstCard : film.junctions?.find((j) => j.afterTrackId === afterTrackId)?.card
  return own ?? { enabled: junctionDefaultOf(film).card, ...DEFAULT_STAGE_CARD }
}

/**
 * Settings of a project saved before the junctions: the transition and the cards « À la suite » it kept in `race`
 * (`stageTransition`, `stageCards`, global) become the film's default junction, and `race` stops carrying them. A
 * transition other than a cut holds `DEFAULT_JUNCTION.holdS` seconds, which the dip it replaces did not: the film grows
 * by the holds only. Settings without them are returned as they are.
 */
export function withStageSettingsMigrated<S extends { race: RaceSettings; film: Film }>(settings: S): S {
  const { stageTransition, stageCards, ...race } = settings.race
  if (stageTransition === undefined && stageCards === undefined) return settings
  const kind = stageTransition ?? DEFAULT_JUNCTION.kind
  const junctionDefault = settings.film.junctionDefault ?? { kind, holdS: kind === 'coupe' ? 0 : DEFAULT_JUNCTION.holdS, card: stageCards !== false }
  return { ...settings, race, film: { ...settings.film, junctionDefault } }
}

/**
 * `item` is the junction, the stage or the card of a stage of the sequence of `stageIds` (the stages' track ids, in
 * order): a junction and the card after it need a stage after them, the first card and a stage any stage.
 */
export function hasStageItem(item: string, stageIds: readonly string[]): boolean {
  if (isJunctionItem(item)) return stageIds.slice(0, -1).includes(junctionTrackOf(item))
  if (isStageItem(item)) return stageIds.includes(stageTrackOf(item))
  if (isStageCardItem(item)) {
    const after = stageCardAfterOf(item)
    return stageIds.length > 1 && (after === null || stageIds.slice(0, -1).includes(after))
  }
  return false
}

/**
 * Film times between which the card of a stage is shown: from the middle of the junction before it (the start of the
 * flight for the first stage) for its duration, but not past the start of the next junction. Null without a sequence
 * or when the junction is not on the clock. `afterTrackId` null: the first stage.
 */
export function stageCardWindow(
  clock: Pick<FilmClock, 'openingS' | 'junctions'>,
  film: Pick<Film, 'junctions' | 'junctionDefault' | 'firstCard'>,
  afterTrackId: string | null,
): { startS: number; endS: number } | null {
  const k = afterTrackId === null ? -1 : clock.junctions.findIndex((j) => j.afterTrackId === afterTrackId)
  if (clock.junctions.length === 0 || (afterTrackId !== null && k < 0)) return null
  const startS = k < 0 ? clock.openingS : clock.junctions[k].holdStartS
  const endS = Math.min(startS + junctionCardOf(film, afterTrackId).durationS, clock.junctions[k + 1]?.startS ?? Infinity)
  return { startS, endS: Math.max(startS, endS) }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const roundS = (s: number) => Math.round(s * 100) / 100
const clampHold = (s: number) => roundS(Math.min(JUNCTION_HOLD_RANGE.max, Math.max(JUNCTION_HOLD_RANGE.min, s)))
/** Hold stored with `kind`: none for a cut; a fade without a hold (just chosen over a cut) starts from the default one. */
const holdFor = (film: Film, kind: JunctionKind, holdS: number) =>
  kind === 'coupe' ? 0 : clampHold(holdS > 0 ? holdS : junctionDefaultOf(film).holdS || DEFAULT_JUNCTION.holdS)

/**
 * Junction `afterTrackId` with a new transition and / or hold (kept in `JUNCTION_HOLD_RANGE`; 0 for 'coupe'). The film
 * stores the junction from then on.
 */
export function withJunction(film: Film, afterTrackId: string, patch: Partial<Pick<FilmJunction, 'kind' | 'holdS'>>): Film {
  const current = junctionOf(film, afterTrackId)
  const kind = patch.kind ?? current.kind
  return storing(film, afterTrackId, { kind, holdS: holdFor(film, kind, patch.holdS ?? current.holdS) })
}

/** The film with `patch` merged into the junction it stores after `afterTrackId` (stored now if it was not), in place. */
function storing(film: Film, afterTrackId: string, patch: Partial<FilmJunction>): Film {
  if (!hasStored(film, afterTrackId)) return { ...film, junctions: [...(film.junctions ?? []), { id: junctionId(afterTrackId), afterTrackId, ...patch }] }
  return { ...film, junctions: film.junctions!.map((j) => (j.afterTrackId === afterTrackId ? { ...j, ...patch } : j)) }
}

/** Card after junction `afterTrackId` (null: first stage) with `patch` (durations kept in range); the film stores it from then on. */
export function withJunctionCard(film: Film, afterTrackId: string | null, patch: Partial<JunctionCard>): Film {
  const merged = { ...junctionCardOf(film, afterTrackId), ...patch }
  const card: JunctionCard = { ...merged, durationS: roundS(Math.min(JUNCTION_CARD_RANGE.max, Math.max(JUNCTION_CARD_RANGE.min, merged.durationS))) }
  for (const key of ['text', 'subtitle', 'color', 'font'] as const) if (card[key] === undefined) delete card[key]
  return afterTrackId === null ? { ...film, firstCard: card } : storing(film, afterTrackId, { card })
}

/**
 * « Appliquer à toutes les jonctions »: `kind` and `holdS` become the default and are given to every junction after
 * `afterTrackIds` (their cards stay), so every junction, present or future, passes the same way.
 */
export function applyToAllJunctions(film: Film, afterTrackIds: readonly string[], patch: { kind: JunctionKind; holdS: number }): Film {
  const next = afterTrackIds.reduce((f, id) => withJunction(f, id, patch), film)
  return { ...next, junctionDefault: { ...junctionDefaultOf(film), kind: patch.kind, holdS: holdFor(film, patch.kind, patch.holdS) } }
}

/** The default junction with a new transition and / or hold (the junctions that choose their own keep theirs). */
export function withDefaultJunction(film: Film, patch: Partial<Pick<JunctionDefault, 'kind' | 'holdS'>>): Film {
  const current = junctionDefaultOf(film)
  const kind = patch.kind ?? current.kind
  return { ...film, junctionDefault: { ...current, kind, holdS: holdFor(film, kind, patch.holdS ?? current.holdS) } }
}

/** The film with the default junction's card shown or hidden for the stages whose card the film does not store. */
export function withDefaultCard(film: Film, card: boolean): Film {
  return { ...film, junctionDefault: { ...junctionDefaultOf(film), card } }
}

/** Junction `afterTrackId` back to the default transition (its card stays as it is). */
export function resetJunction(film: Film, afterTrackId: string): Film {
  if (!hasOwnTransition(film, afterTrackId)) return film
  const junctions = film.junctions!.flatMap((j) => {
    if (j.afterTrackId !== afterTrackId) return [j]
    const { kind: _kind, holdS: _holdS, ...rest } = j
    return rest.card ? [rest] : []
  })
  return { ...film, junctions }
}

// ---------------------------------------------------------------------------
// Duration of a stage
// ---------------------------------------------------------------------------

/**
 * The stages of a sequence (track ids `stageIds`, starting at the cuts `cutsM`, `lengthM` long in all) for the clock:
 * each with the flight time the film sets for it. None when no stage sets one, or without a sequence: the film then
 * flies as it always did, the stages sharing the flyover duration in proportion to their distance.
 */
export function stageSpansOf(film: Pick<Film, 'stageDurations'>, stageIds: readonly string[], cutsM: readonly number[] | undefined, lengthM: number): FlightStage[] {
  const set = film.stageDurations
  if (!set || !cutsM || cutsM.length !== stageIds.length - 1 || !stageIds.some((id) => set[id] !== undefined)) return []
  return stageIds.map((id, k) => {
    const span = { fromM: k === 0 ? 0 : cutsM[k - 1], toM: k < cutsM.length ? cutsM[k] : lengthM }
    return set[id] === undefined ? span : { ...span, durationS: set[id] }
  })
}

/** The film with the flight time of the stage of track `trackId` set (kept in `STAGE_DURATION_RANGE`), or back to its share of the duration (`null`). */
export function withStageDuration(film: Film, trackId: string, durationS: number | null): Film {
  const { [trackId]: _was, ...rest } = film.stageDurations ?? {}
  const stageDurations = durationS === null ? rest : { ...rest, [trackId]: roundS(Math.min(STAGE_DURATION_RANGE.max, Math.max(STAGE_DURATION_RANGE.min, durationS))) }
  const { stageDurations: _old, ...others } = film
  return Object.keys(stageDurations).length === 0 ? others : { ...others, stageDurations }
}

/**
 * Seconds the marker takes over stage `k` on the clock: from the end of the junction before it (the start of the flight)
 * to the start of the one after it (the end of the flight), without the time the junctions and the nights inside hold the
 * film, as a duration set for the stage is meant. A junction is a pause centred on its cut, so its hold is taken off each side.
 */
export function stageFlightS(clock: Pick<FilmClock, 'openingS' | 'flightS' | 'junctions' | 'nights'>, k: number): number {
  const before = clock.junctions[k - 1]
  const after = clock.junctions[k]
  const startS = before ? (before.startS + before.endS + before.holdS) / 2 : clock.openingS
  const endS = after ? (after.startS + after.endS - after.holdS) / 2 : clock.openingS + clock.flightS
  const atCut = new Set(clock.junctions.map((j) => j.holdStartS))
  const nightsS = clock.nights.reduce((sum, n) => (n.holdStartS > startS && n.holdStartS < endS && !atCut.has(n.holdStartS) ? sum + nightPauseS(n) : sum), 0)
  return endS - startS - nightsS
}

// ---------------------------------------------------------------------------
// Card text
// ---------------------------------------------------------------------------

/** `{name} {n} {count} {date} {distance} {ascent}` filled in; other braces are left as typed. */
export function fillTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(vars, key) ? vars[key] : whole))
}

export const STAGE_CARD_VARIABLES = ['name', 'n', 'count', 'date', 'distance', 'ascent'] as const

// ---------------------------------------------------------------------------
// On the clock
// ---------------------------------------------------------------------------

/** What the clock needs of a junction between two stages: where it is, how it passes and how long it holds. */
export interface JunctionInput {
  id: string
  afterTrackId: string
  /** the cut (metres along the sequence) */
  atM: number
  kind: JunctionKind
  /** seconds added to the film: 0 for a cut */
  holdS: number
  /** the night this junction passes through (kind 'nuit'): its pause is the night's, `holdS` its length */
  night?: FlightNight
}

/** A night closer than this to a cut is the one between the two stages (metres). */
const NIGHT_AT_CUT_M = 25

/**
 * The junctions of the clock and the nights left to the flight, from the film, the stages' track ids, their cuts
 * (metres) and the nights of the sequence's path (`candidates`: those the film would show with « Jours et nuits » on).
 *
 * A junction whose transition the film stores decides what happens at its cut: 'nuit' keeps the night there (a dip to black without
 * one), any other kind replaces it. A junction left to the default keeps the night as before when « Jours et nuits »
 * is on (kind 'nuit'), else passes as the default says. The nights not at a cut stay automatic (`nights`).
 */
export function junctionPlan(
  film: Pick<Film, 'junctions' | 'junctionDefault' | 'nights'>,
  stageIds: readonly string[],
  cutsM: readonly number[],
  candidates: readonly FlightNight[],
): { junctions: JunctionInput[]; nights: FlightNight[] } {
  const automatic = film.nights.enabled ? candidates : []
  const handled = new Set<FlightNight>()
  const junctions: JunctionInput[] = []
  cutsM.forEach((atM, k) => {
    const afterTrackId = stageIds[k]
    if (afterTrackId === undefined) return
    const { id, kind: chosen, holdS } = junctionOf(film, afterTrackId)
    const night = candidates.find((n) => !handled.has(n) && Math.abs(n.atM - atM) <= NIGHT_AT_CUT_M)
    if (night) handled.add(night)
    const kind = !hasOwnTransition(film, afterTrackId) && night && film.nights.enabled ? 'nuit' : chosen
    if (kind === 'nuit' && night) junctions.push({ id, afterTrackId, atM, kind, holdS: nightPauseS(night), night })
    // a night without a night to pass: a dip to black as long as the junction holds
    else junctions.push({ id, afterTrackId, atM, kind: kind === 'nuit' ? 'fondu-noir' : kind, holdS: kind === 'coupe' ? 0 : holdS })
  })
  return { junctions, nights: automatic.filter((n) => !handled.has(n)) }
}

/** Length of the fade into and out of a dip (seconds), ending at the cut and starting at the end of the hold. */
export const JUNCTION_FADE_S = 0.8

/**
 * Dip of the picture at film time `timeS` for a junction placed on the clock, null when it has none ('coupe'). The
 * stage changes when the marker reaches the cut, at `holdStartS`: the screen is covered by then and stays so until
 * `holdEndS` (a night: only around `holdStartS`, the night sky is the show), then clears. A pure function of the film time.
 */
export function junctionDipAt(j: Pick<ClockJunction, 'kind' | 'holdStartS' | 'holdEndS'>, timeS: number): TransitionDip | null {
  if (j.kind === 'coupe') return null
  const holdEndS = j.kind === 'nuit' ? j.holdStartS : j.holdEndS
  let alpha = 1
  if (timeS < j.holdStartS) alpha = smootherstep(1 - (j.holdStartS - timeS) / JUNCTION_FADE_S)
  else if (timeS > holdEndS) alpha = smootherstep(1 - (timeS - holdEndS) / JUNCTION_FADE_S)
  return alpha > 0 ? { color: j.kind === 'fondu-blanc' ? 'white' : 'black', alpha } : null
}

/** The strongest dip of the junctions at `timeS` (they never overlap: one is enough in practice). */
export function junctionsDipAt(junctions: readonly Parameters<typeof junctionDipAt>[0][], timeS: number): TransitionDip | null {
  let dip: TransitionDip | null = null
  for (const j of junctions) {
    const d = junctionDipAt(j, timeS)
    if (d && d.alpha > (dip?.alpha ?? 0)) dip = d
  }
  return dip
}
