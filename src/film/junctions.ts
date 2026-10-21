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
import type { Film, FilmJunction, JunctionCard, JunctionDefault, JunctionKind, StoredStageCard, TransitionDip } from './model'

/**
 * Default junction of a film that never chose: a dip to black held for 1.5 s, the night passed when the stages are on
 * two days, no high view of the stage, a card for every stage.
 */
export const DEFAULT_JUNCTION: JunctionDefault = { kind: 'fondu-noir', holdS: 1.5, card: true, night: true, recap: false }

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

/** The default junction, every field set (`night` yes and `recap` no where it says nothing; a 'nuit' kind of before v6: a fade with the night). */
export function junctionDefaultOf(film: Pick<Film, 'junctionDefault'>): Required<Omit<JunctionDefault, 'cardSettings'>> & Pick<JunctionDefault, 'cardSettings'> {
  const d = film.junctionDefault ?? DEFAULT_JUNCTION
  const night = d.kind === 'nuit' ? true : (d.night ?? true)
  return { ...d, kind: d.kind === 'nuit' ? 'fondu-noir' : d.kind, night, recap: d.recap ?? false }
}

/** A junction with every field set: its passage (never 'nuit'), hold, night and high view of the stage. */
export type ResolvedJunction = Required<Pick<FilmJunction, 'id' | 'afterTrackId' | 'kind' | 'holdS' | 'night' | 'recap'>>

/** The junction after the stage of track `afterTrackId`: what the film stores of it, the default for the rest. */
export function junctionOf(film: Pick<Film, 'junctions' | 'junctionDefault'>, afterTrackId: string): ResolvedJunction {
  const stored = film.junctions?.find((j) => j.afterTrackId === afterTrackId)
  const fallback = junctionDefaultOf(film)
  // a junction stored 'nuit' (before v6) is a fade to black that passes the night
  const legacyNight = stored?.kind === 'nuit'
  const kind = legacyNight ? 'fondu-noir' : (stored?.kind ?? fallback.kind)
  return {
    id: junctionId(afterTrackId),
    afterTrackId,
    kind,
    holdS: kind === 'coupe' ? 0 : (stored?.holdS ?? fallback.holdS),
    night: legacyNight || (stored?.night ?? fallback.night),
    recap: stored?.recap ?? fallback.recap,
  }
}

/** The film chose how the junction after `afterTrackId` passes (its passage, night or high view is stored), rather than leaving it to the default. */
export const hasOwnTransition = (film: Pick<Film, 'junctions'>, afterTrackId: string) =>
  film.junctions?.some((j) => j.afterTrackId === afterTrackId && (j.kind !== undefined || j.night !== undefined || j.recap !== undefined)) === true

const hasStored = (film: Pick<Film, 'junctions'>, afterTrackId: string) => film.junctions?.some((j) => j.afterTrackId === afterTrackId) === true

/** What the film stores of the card of the stage after `afterTrackId` (null: the first stage). */
const storedCardOf = (film: Pick<Film, 'junctions' | 'firstCard'>, afterTrackId: string | null): StoredStageCard | undefined =>
  afterTrackId === null ? film.firstCard : film.junctions?.find((j) => j.afterTrackId === afterTrackId)?.card

/** The fields a card may set back to « none » over a common card that sets them (stored empty). */
const CLEARABLE_CARD_FIELDS = ['text', 'subtitle', 'color', 'font'] as const

/** `card` without its empty fields (`StoredStageCard`: back to the automatic card, the overlay's colour or font). */
function resolvedCard(card: JunctionCard): JunctionCard {
  const out = { ...card }
  for (const key of CLEARABLE_CARD_FIELDS) if (out[key] === '' || out[key] === undefined) delete out[key]
  return out
}

/** The common card: what every stage card shows unless it sets its own (`JunctionDefault.card` and `cardSettings`). */
export function commonCardOf(film: Pick<Film, 'junctionDefault'>): JunctionCard {
  const fallback = junctionDefaultOf(film)
  return resolvedCard({ enabled: fallback.card, ...DEFAULT_STAGE_CARD, ...fallback.cardSettings })
}

/** Card of the stage that follows the junction after `afterTrackId` (null: the first stage): the common card with what it changes. */
export function junctionCardOf(film: Pick<Film, 'junctions' | 'junctionDefault' | 'firstCard'>, afterTrackId: string | null): JunctionCard {
  const fallback = junctionDefaultOf(film)
  return resolvedCard({ enabled: fallback.card, ...DEFAULT_STAGE_CARD, ...fallback.cardSettings, ...storedCardOf(film, afterTrackId) })
}

/** The card of that stage sets something of its own besides being shown or hidden (« réglage propre »). */
export const hasOwnCard = (film: Pick<Film, 'junctions' | 'firstCard'>, afterTrackId: string | null) =>
  Object.keys(storedCardOf(film, afterTrackId) ?? {}).some((key) => key !== 'enabled')

/**
 * Settings of a project saved before the junctions: the transition and the cards « À la suite » it kept in `race`
 * (`stageTransition`, `stageCards`, global) become the film's default junction, and `race` stops carrying them. A
 * transition other than a cut holds `DEFAULT_JUNCTION.holdS` seconds, which the dip it replaces did not: the film grows
 * by the holds only. Settings without them are returned as they are.
 */
export function withStageSettingsMigrated<S extends { race: RaceSettings; film: Film }>(settings: S): S {
  const { stageTransition, stageCards, ...race } = settings.race
  if (stageTransition === undefined && stageCards === undefined) return settings
  // the default of those versions: a fade to black
  const kind = stageTransition ?? 'fondu-noir'
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
 * flight for the first stage) until its duration after the stage's flight starts (the end of that junction), so it
 * stays on the first seconds of the flight, but not past the start of the next junction. Null without a sequence or
 * when the junction is not on the clock. `afterTrackId` null: the first stage.
 */
export function stageCardWindow(
  clock: Pick<FilmClock, 'openingS' | 'junctions'>,
  film: Pick<Film, 'junctions' | 'junctionDefault' | 'firstCard'>,
  afterTrackId: string | null,
): { startS: number; endS: number } | null {
  const k = afterTrackId === null ? -1 : clock.junctions.findIndex((j) => j.afterTrackId === afterTrackId)
  if (clock.junctions.length === 0 || (afterTrackId !== null && k < 0)) return null
  const startS = k < 0 ? clock.openingS : clock.junctions[k].holdStartS
  const flightS = k < 0 ? clock.openingS : clock.junctions[k].endS
  const endS = Math.min(flightS + junctionCardOf(film, afterTrackId).durationS, clock.junctions[k + 1]?.startS ?? Infinity)
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
 * Junction `afterTrackId` with a new passage, hold (kept in `JUNCTION_HOLD_RANGE`; 0 for 'coupe'), night and / or high
 * view: the film stores the whole transition from then on (« réglage propre »).
 */
export function withJunction(film: Film, afterTrackId: string, patch: Partial<Pick<FilmJunction, 'kind' | 'holdS' | 'night' | 'recap'>>): Film {
  const current = junctionOf(film, afterTrackId)
  const kind = patch.kind ?? current.kind
  return storing(film, afterTrackId, { kind, holdS: holdFor(film, kind, patch.holdS ?? current.holdS), night: patch.night ?? current.night, recap: patch.recap ?? current.recap })
}

/** The film with `patch` merged into the junction it stores after `afterTrackId` (stored now if it was not), in place. */
function storing(film: Film, afterTrackId: string, patch: Partial<FilmJunction>): Film {
  if (!hasStored(film, afterTrackId)) return { ...film, junctions: [...(film.junctions ?? []), { id: junctionId(afterTrackId), afterTrackId, ...patch }] }
  return { ...film, junctions: film.junctions!.map((j) => (j.afterTrackId === afterTrackId ? { ...j, ...patch } : j)) }
}

const clampCardS = (s: number) => roundS(Math.min(JUNCTION_CARD_RANGE.max, Math.max(JUNCTION_CARD_RANGE.min, s)))
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * `stored` with `patch` over the card `common` gives (durations kept in range): a field equal to the common card's is
 * not stored (the card keeps following it), a field set to undefined goes back to the common card (stored empty where
 * the common card sets one: back to « none »).
 */
function patchedCard<C extends Partial<JunctionCard>>(common: JunctionCard, stored: C, patch: Partial<JunctionCard>): C {
  const out: Record<string, unknown> = { ...stored }
  for (const [key, raw] of Object.entries(patch) as [keyof JunctionCard, unknown][]) {
    const value = key === 'durationS' && typeof raw === 'number' ? clampCardS(raw) : raw
    if (value === undefined) {
      if ((CLEARABLE_CARD_FIELDS as readonly string[]).includes(key) && common[key] !== undefined) out[key] = ''
      else delete out[key]
    } else if (sameValue(value, common[key])) delete out[key]
    else out[key] = value
  }
  return out as C
}

/** The film storing `card` for the stage after `afterTrackId` (null: the first stage); nothing stored when it is empty. */
function storingCard(film: Film, afterTrackId: string | null, card: StoredStageCard): Film {
  const empty = Object.keys(card).length === 0
  if (afterTrackId === null) {
    const { firstCard: _was, ...rest } = film
    return empty ? rest : { ...rest, firstCard: card }
  }
  if (!empty) return storing(film, afterTrackId, { card })
  if (!film.junctions) return film
  const junctions = film.junctions.flatMap((j) => {
    if (j.afterTrackId !== afterTrackId) return [j]
    const { card: _card, ...rest } = j
    return rest.kind !== undefined || rest.holdS !== undefined ? [rest] : []
  })
  return { ...film, junctions }
}

/**
 * Card after junction `afterTrackId` (null: first stage) with `patch`, stored as what it changes over the common card
 * (`patchedCard`): an edit in its panel makes it the card's own (« réglage propre »).
 */
export function withJunctionCard(film: Film, afterTrackId: string | null, patch: Partial<JunctionCard>): Film {
  return storingCard(film, afterTrackId, patchedCard(commonCardOf(film), storedCardOf(film, afterTrackId) ?? {}, patch))
}

/** Card after junction `afterTrackId` (null: first stage) back to the common card, shown or hidden as it was. */
export function withCommonCard(film: Film, afterTrackId: string | null): Film {
  const enabled = storedCardOf(film, afterTrackId)?.enabled
  return storingCard(film, afterTrackId, enabled === undefined ? {} : { enabled })
}

/** The common card with `patch` (« Trace › Plusieurs traces »): every card that does not set the same field follows it. */
export function withCardSettings(film: Film, patch: Partial<Omit<JunctionCard, 'enabled'>>): Film {
  const fallback = junctionDefaultOf(film)
  const base = resolvedCard({ enabled: fallback.card, ...DEFAULT_STAGE_CARD })
  const cardSettings: Partial<Omit<JunctionCard, 'enabled'>> = patchedCard(base, { ...fallback.cardSettings }, patch)
  const { cardSettings: _was, ...rest } = fallback
  return { ...film, junctionDefault: Object.keys(cardSettings).length > 0 ? { ...rest, cardSettings } : rest }
}

/** Every stage card back to the common card, each shown or hidden as it was. */
export function withAllCardsCommon(film: Film): Film {
  const afterIds = [null, ...(film.junctions ?? []).map((j) => j.afterTrackId)]
  return afterIds.reduce<Film>((f, id) => (hasOwnCard(f, id) ? withCommonCard(f, id) : f), film)
}

/**
 * « Utiliser pour toutes les transitions »: `kind` and `holdS` become the common transition and every junction goes
 * back to it (their cards stay), so every junction, present or future, passes the same way.
 */
export function applyToAllJunctions(film: Film, patch: { kind: JunctionKind; holdS: number; night: boolean; recap: boolean }): Film {
  return withAllJunctionsCommon({ ...film, junctionDefault: { ...junctionDefaultOf(film), ...patch, holdS: holdFor(film, patch.kind, patch.holdS) } })
}

/** Every junction back to the common transition (their cards stay). */
export function withAllJunctionsCommon(film: Film): Film {
  return (film.junctions ?? []).reduce((f, j) => resetJunction(f, j.afterTrackId), film)
}

/** The default junction with a new passage, hold, night and / or high view (the junctions that choose their own keep theirs). */
export function withDefaultJunction(film: Film, patch: Partial<Pick<JunctionDefault, 'kind' | 'holdS' | 'night' | 'recap'>>): Film {
  const current = junctionDefaultOf(film)
  const kind = patch.kind ?? current.kind
  return { ...film, junctionDefault: { ...current, ...patch, kind, holdS: holdFor(film, kind, patch.holdS ?? current.holdS) } }
}

/** « Une carte au début de chaque étape »: every stage card shown or hidden (a card hidden or shown on its own follows). */
export function withDefaultCard(film: Film, card: boolean): Film {
  const next: Film = { ...film, junctionDefault: { ...junctionDefaultOf(film), card } }
  const afterIds = [null, ...(film.junctions ?? []).map((j) => j.afterTrackId)]
  return afterIds.reduce<Film>((f, id) => {
    const stored = storedCardOf(f, id)
    if (stored?.enabled === undefined) return f
    const { enabled: _enabled, ...rest } = stored
    return storingCard(f, id, rest)
  }, next)
}

/** Junction `afterTrackId` back to the default transition (its card stays as it is). */
export function resetJunction(film: Film, afterTrackId: string): Film {
  if (!hasOwnTransition(film, afterTrackId)) return film
  const junctions = film.junctions!.flatMap((j) => {
    if (j.afterTrackId !== afterTrackId) return [j]
    const { kind: _kind, holdS: _holdS, night: _night, recap: _recap, ...rest } = j
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
  // « Revoir l'étape finie » holds the film just before the junction: not part of the flight either
  const endS = after ? (after.startS + after.endS - after.holdS) / 2 - (after.recap?.durationS ?? 0) : clock.openingS + clock.flightS
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
  /** « Revoir l'étape finie »: a high view of the stage before the passage (`RECAP_S`), or over the night it passes */
  recap?: boolean
}

/** A night closer than this to a cut is the one between the two stages (metres). */
const NIGHT_AT_CUT_M = 25

/**
 * The junctions of the clock and the nights left to the flight, from the film, the stages' track ids, their cuts
 * (metres) and the nights of the sequence's path (`candidates`: those the film would show with « Jours et nuits » on).
 *
 * Each junction passes as the film says (its own transition, else the default): with « Passer la nuit » it keeps the
 * night at its cut (kind 'nuit' on the clock), else, or without a night there (same day), its passage; whether
 * « Montrer les nuits » is on or not. The nights not at a cut stay automatic (`nights`).
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
    const { id, kind, holdS, night: passesNight, recap } = junctionOf(film, afterTrackId)
    const night = candidates.find((n) => !handled.has(n) && Math.abs(n.atM - atM) <= NIGHT_AT_CUT_M)
    if (night) handled.add(night)
    if (passesNight && night) junctions.push({ id, afterTrackId, atM, kind: 'nuit', holdS: nightPauseS(night), night, recap })
    // no night asked for, or none to pass (the same day): the passage, held as long as it says
    else junctions.push({ id, afterTrackId, atM, kind, holdS: kind === 'coupe' ? 0 : holdS, recap })
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
