import { describe, expect, it } from 'vitest'
import type { FlightNight } from '../flyover/nights'
import { DEFAULT_RACE } from '../flyover/race'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildFilmClock } from './clock'
import type { ClockJunction, FilmClockInput } from './clock'
import {
  DEFAULT_JUNCTION,
  FIRST_STAGE_CARD_ID,
  applyToAllJunctions,
  fillTemplate,
  hasOwnTransition,
  hasStageItem,
  isJunctionItem,
  isStageCardItem,
  isStageItem,
  junctionCardOf,
  junctionDefaultOf,
  junctionDipAt,
  junctionId,
  junctionOf,
  junctionPlan,
  junctionsDipAt,
  resetJunction,
  stageCardAfterOf,
  stageCardId,
  stageCardWindow,
  stageFlightS,
  stageItemId,
  stageSpansOf,
  withDefaultCard,
  withDefaultJunction,
  withJunction,
  withJunctionCard,
  withStageDuration,
  withStageSettingsMigrated,
} from './junctions'
import { DEFAULT_FILM, JUNCTION_CARD_RANGE, JUNCTION_HOLD_RANGE, STAGE_DURATION_RANGE, isValidFilm } from './model'
import type { Film } from './model'
import { dragFilm, hasFilmItem, removeFilmItem } from './timeline'
import type { DragContext } from './timeline'

const film = DEFAULT_FILM

describe('junction defaults', () => {
  it('a film that never chose: a dip to black held for 1.5 s and a card for every stage', () => {
    expect(junctionDefaultOf(film)).toEqual({ kind: 'fondu-noir', holdS: 1.5, card: true })
    expect(junctionOf(film, 'a')).toEqual({ id: 'junction-a', afterTrackId: 'a', kind: 'fondu-noir', holdS: 1.5 })
    expect(junctionCardOf(film, 'a')).toEqual({ enabled: true, durationS: 5, anchor: 'center', size: 1 })
    expect(junctionCardOf(film, null)).toEqual(junctionCardOf(film, 'a'))
    expect(hasOwnTransition(film, 'a')).toBe(false)
    expect(isValidFilm(film)).toBe(true)
  })

  it('the film’s default junction, then the junction’s own fields', () => {
    const chosen: Film = { ...film, junctionDefault: { kind: 'fondu-blanc', holdS: 3, card: false } }
    expect(junctionOf(chosen, 'a')).toMatchObject({ kind: 'fondu-blanc', holdS: 3 })
    expect(junctionCardOf(chosen, 'a').enabled).toBe(false)
    const own: Film = { ...chosen, junctions: [{ id: 'junction-b', afterTrackId: 'b', kind: 'coupe', holdS: 0, card: { enabled: true, durationS: 8, anchor: 'top-left', size: 1.5, text: 'Jour {n}' } }] }
    expect(junctionOf(own, 'b')).toMatchObject({ kind: 'coupe', holdS: 0 })
    expect(junctionCardOf(own, 'b')).toMatchObject({ enabled: true, durationS: 8, text: 'Jour {n}' })
    expect(junctionOf(own, 'a').kind).toBe('fondu-blanc')
    // a cut holds nothing whatever the default says
    expect(junctionOf({ ...film, junctionDefault: { kind: 'coupe', holdS: 2, card: true } }, 'a').holdS).toBe(0)
    expect(isValidFilm(own)).toBe(true)
  })

  it('validity: kinds, hold and card in range, one junction per track', () => {
    const ok = { id: 'junction-a', afterTrackId: 'a', kind: 'nuit', holdS: 2 } as const
    expect(isValidFilm({ ...film, junctions: [ok] })).toBe(true)
    expect(isValidFilm({ ...film, junctions: [ok, { ...ok, id: 'junction-a2' }] })).toBe(false)
    expect(isValidFilm({ ...film, junctions: [{ ...ok, kind: 'survol' as never }] })).toBe(false)
    expect(isValidFilm({ ...film, junctions: [{ ...ok, holdS: JUNCTION_HOLD_RANGE.max + 1 }] })).toBe(false)
    expect(isValidFilm({ ...film, junctions: [{ ...ok, holdS: 0.1 }] })).toBe(false)
    expect(isValidFilm({ ...film, junctions: [{ id: 'junction-a', afterTrackId: 'a' }] })).toBe(true)
    const card = { enabled: true, durationS: 5, anchor: 'center', size: 1 } as const
    expect(isValidFilm({ ...film, firstCard: card })).toBe(true)
    expect(isValidFilm({ ...film, firstCard: { ...card, durationS: JUNCTION_CARD_RANGE.max + 1 } })).toBe(false)
    expect(isValidFilm({ ...film, junctionDefault: { kind: 'coupe', holdS: 0, card: true } })).toBe(true)
    expect(isValidFilm({ ...film, junctionDefault: { kind: 'x' as never, holdS: 0, card: true } })).toBe(false)
  })
})

describe('junction edits', () => {
  it('withJunction stores the junction, keeps the hold in range, 0 for a cut, a fade over a cut starts from the default hold', () => {
    const a = withJunction(film, 'a', { holdS: 4.456 })
    expect(a.junctions).toEqual([{ id: 'junction-a', afterTrackId: 'a', kind: 'fondu-noir', holdS: 4.46 }])
    expect(hasOwnTransition(a, 'a')).toBe(true)
    expect(junctionOf(withJunction(a, 'a', { holdS: 99 }), 'a').holdS).toBe(JUNCTION_HOLD_RANGE.max)
    expect(junctionOf(withJunction(a, 'a', { holdS: 0.01 }), 'a').holdS).toBe(JUNCTION_HOLD_RANGE.min)
    const cut = withJunction(a, 'a', { kind: 'coupe' })
    expect(junctionOf(cut, 'a')).toMatchObject({ kind: 'coupe', holdS: 0 })
    expect(junctionOf(withJunction(cut, 'a', { kind: 'fondu-blanc' }), 'a')).toMatchObject({ kind: 'fondu-blanc', holdS: 1.5 })
    // an edit leaves the other junctions and the card of its own alone
    const both = withJunctionCard(withJunction(film, 'b', { kind: 'nuit' }), 'a', { durationS: 7 })
    expect(withJunction(both, 'a', { holdS: 2 }).junctions!.map((j) => j.afterTrackId)).toEqual(['b', 'a'])
    expect(junctionCardOf(withJunction(both, 'a', { holdS: 2 }), 'a').durationS).toBe(7)
    expect(isValidFilm(both)).toBe(true)
  })

  it('withJunctionCard: the card of a stage, stored with its junction (the first one in the film); the junction keeps leaving its transition to the default', () => {
    const edited = withJunctionCard(film, 'a', { text: '{name}', durationS: 99, color: '#aa0000' })
    expect(junctionCardOf(edited, 'a')).toEqual({ enabled: true, durationS: JUNCTION_CARD_RANGE.max, anchor: 'center', size: 1, text: '{name}', color: '#aa0000' })
    expect(hasOwnTransition(edited, 'a')).toBe(false)
    expect(junctionOf(edited, 'a')).toMatchObject({ kind: 'fondu-noir', holdS: 1.5 })
    // text back to automatic: the field goes away
    expect(junctionCardOf(withJunctionCard(edited, 'a', { text: undefined, color: undefined }), 'a')).not.toHaveProperty('text')
    const first = withJunctionCard(film, null, { enabled: false })
    expect(first.firstCard).toEqual({ enabled: false, durationS: 5, anchor: 'center', size: 1 })
    expect(junctionCardOf(first, null).enabled).toBe(false)
    expect(junctionCardOf(first, 'a').enabled).toBe(true)
    expect(isValidFilm(edited) && isValidFilm(first)).toBe(true)
  })

  it('applyToAllJunctions: the default and every junction after the given tracks, their cards kept', () => {
    const base = withJunctionCard(withJunction(film, 'a', { kind: 'coupe' }), 'a', { durationS: 9 })
    const all = applyToAllJunctions(base, ['a', 'b'], { kind: 'fondu-blanc', holdS: 2.5 })
    expect(junctionDefaultOf(all)).toEqual({ kind: 'fondu-blanc', holdS: 2.5, card: true })
    for (const id of ['a', 'b']) expect(junctionOf(all, id)).toMatchObject({ kind: 'fondu-blanc', holdS: 2.5 })
    expect(junctionCardOf(all, 'a').durationS).toBe(9)
    // a future junction passes the same way
    expect(junctionOf(all, 'c')).toMatchObject({ kind: 'fondu-blanc', holdS: 2.5 })
    expect(junctionDefaultOf(applyToAllJunctions(film, [], { kind: 'coupe', holdS: 3 }))).toMatchObject({ kind: 'coupe', holdS: 0 })
  })

  it('the default junction and its card, and back to the default junction', () => {
    const chosen = withDefaultCard(withDefaultJunction(film, { kind: 'coupe' }), false)
    expect(junctionDefaultOf(chosen)).toEqual({ kind: 'coupe', holdS: 0, card: false })
    expect(junctionDefaultOf(withDefaultJunction(chosen, { kind: 'fondu-noir' }))).toMatchObject({ kind: 'fondu-noir', holdS: 1.5 })
    const own = withJunctionCard(withJunction(film, 'a', { kind: 'nuit', holdS: 2 }), 'a', { durationS: 6 })
    const reset = resetJunction(own, 'a')
    expect(hasOwnTransition(reset, 'a')).toBe(false)
    // its card stays; with none, the junction is dropped
    expect(junctionCardOf(reset, 'a').durationS).toBe(6)
    expect(resetJunction(withJunction(film, 'a', { kind: 'nuit' }), 'a').junctions).toEqual([])
    expect(resetJunction(film, 'a')).toBe(film)
  })
})

describe('selection ids', () => {
  it('junction, stage and card ids carry the track, and exist for the stages of the sequence only', () => {
    expect(junctionId('t1')).toBe('junction-t1')
    expect(stageItemId('t1')).toBe('stage-t1')
    expect(stageCardId('t1')).toBe('card-stage-t1')
    expect(stageCardId(null)).toBe(FIRST_STAGE_CARD_ID)
    expect(stageCardAfterOf('card-stage-t1')).toBe('t1')
    expect(stageCardAfterOf(FIRST_STAGE_CARD_ID)).toBeNull()
    expect([isJunctionItem('junction-t1'), isStageItem('stage-t1'), isStageCardItem('card-stage-t1'), isJunctionItem('stop-1')]).toEqual([true, true, true, false])
    const ids = ['a', 'b', 'c']
    expect(hasStageItem('junction-a', ids) && hasStageItem('junction-b', ids)).toBe(true)
    // the last stage has no junction after it, nor a card after it
    expect(hasStageItem('junction-c', ids)).toBe(false)
    expect(hasStageItem('card-stage-c', ids)).toBe(false)
    expect(hasStageItem('card-stage-b', ids) && hasStageItem(FIRST_STAGE_CARD_ID, ids) && hasStageItem('stage-c', ids)).toBe(true)
    expect(hasStageItem('stage-z', ids) || hasStageItem(FIRST_STAGE_CARD_ID, ['a']) || hasStageItem('junction-a', [])).toBe(false)
    expect(hasFilmItem(film, [], 'junction-a', ids)).toBe(true)
    expect(hasFilmItem(film, [], 'junction-a')).toBe(false)
  })

  it('deleting a junction resets it, deleting a stage card switches it off', () => {
    const own = withJunction(film, 'a', { kind: 'coupe' })
    expect(hasOwnTransition(removeFilmItem(own, 'junction-a'), 'a')).toBe(false)
    expect(junctionCardOf(removeFilmItem(film, 'card-stage-a'), 'a').enabled).toBe(false)
    expect(junctionCardOf(removeFilmItem(film, FIRST_STAGE_CARD_ID), null).enabled).toBe(false)
  })
})

describe('card text', () => {
  it('fills in the variables, leaves the other braces as typed', () => {
    const vars = { name: 'Col', n: '2', count: '3', date: '2 juillet', distance: '18,4 km', ascent: '' }
    expect(fillTemplate('{name} — jour {n}/{count} · {date}', vars)).toBe('Col — jour 2/3 · 2 juillet')
    expect(fillTemplate('{ascent}|{unknown}|{{name}}|toString', vars)).toBe('|{unknown}|{Col}|toString')
    expect(fillTemplate('{__proto__} {constructor}', vars)).toBe('{__proto__} {constructor}')
  })
})

describe('junctions on the clock', () => {
  const night = (atM: number): FlightNight => ({ atM, fromMs: 0, toMs: 1, sunsetMs: 0, sunriseMs: 1, nightM: 0, duskS: 3, nightS: 2, dawnS: 3 })
  const ids = ['a', 'b', 'c']
  const cuts = [3000, 6000]

  it('without a film choice: the default at every cut, in the order of the stages', () => {
    const plan = junctionPlan(film, ids, cuts, [])
    expect(plan.junctions).toEqual([
      { id: 'junction-a', afterTrackId: 'a', atM: 3000, kind: 'fondu-noir', holdS: 1.5 },
      { id: 'junction-b', afterTrackId: 'b', atM: 6000, kind: 'fondu-noir', holdS: 1.5 },
    ])
    expect(plan.nights).toEqual([])
    // no stage ids (a clock without sequence): nothing
    expect(junctionPlan(film, [], cuts, []).junctions).toEqual([])
  })

  it('a night at a cut: kept as before with « Jours et nuits » on and the junction left to the default (a night, no fade)', () => {
    const nights = { ...film.nights, enabled: true }
    const atCut = night(3000)
    const inStage = night(1000)
    const plan = junctionPlan({ ...film, nights }, ids, cuts, [atCut, inStage])
    expect(plan.junctions[0]).toMatchObject({ kind: 'nuit', holdS: 8, night: atCut })
    expect(plan.junctions[1]).toMatchObject({ kind: 'fondu-noir', holdS: 1.5 })
    // the night inside a stage stays a night of the flight
    expect(plan.nights).toEqual([inStage])
  })

  it('a junction that chose a transition decides: another kind replaces the night, « Nuit » keeps it even with the nights off', () => {
    const atCut = night(3000)
    const replaced = junctionPlan({ ...withJunction(film, 'a', { kind: 'fondu-blanc', holdS: 2 }), nights: { ...film.nights, enabled: true } }, ids, cuts, [atCut])
    expect(replaced.junctions[0]).toMatchObject({ kind: 'fondu-blanc', holdS: 2 })
    expect(replaced.nights).toEqual([])
    const chosen = junctionPlan({ ...withJunction(film, 'a', { kind: 'nuit' }), nights: { ...film.nights, enabled: false } }, ids, cuts, [atCut])
    expect(chosen.junctions[0]).toMatchObject({ kind: 'nuit', night: atCut })
    // the nights off and the default junction: a fade, no night
    expect(junctionPlan({ ...film, nights: { ...film.nights, enabled: false } }, ids, cuts, [atCut]).junctions[0].kind).toBe('fondu-noir')
    // « Nuit » without a night to pass: a fade to black as long as the junction holds
    expect(junctionPlan(withJunction(film, 'a', { kind: 'nuit', holdS: 2 }), ids, cuts, []).junctions[0]).toMatchObject({ kind: 'fondu-noir', holdS: 2 })
  })

  it('a night is passed by one junction only (two zero-length stages share a cut)', () => {
    const plan = junctionPlan({ ...film, nights: { ...film.nights, enabled: true } }, ids, [3000, 3000], [night(3000)])
    expect(plan.junctions.map((j) => j.kind)).toEqual(['nuit', 'fondu-noir'])
  })

  it('a cut stays a cut', () => {
    const plan = junctionPlan(withDefaultJunction(film, { kind: 'coupe' }), ids, cuts, [])
    expect(plan.junctions.map((j) => [j.kind, j.holdS])).toEqual([['coupe', 0], ['coupe', 0]])
  })
})

describe('dip of a junction', () => {
  const input: FilmClockInput = {
    opening: { style: 'aucune', durationS: 5 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: 10_000,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
    cutsM: [5000],
  }
  const clockWith = (kind: ClockJunction['kind'], holdS: number) =>
    buildFilmClock({ ...input, junctions: [{ id: 'junction-a', afterTrackId: 'a', atM: 5000, kind, holdS }] }).junctions[0]

  it('clear before the fade, covered from the cut to the end of the hold, clear after, monotone in between', () => {
    const j = clockWith('fondu-noir', 4)
    expect(junctionDipAt(j, j.holdStartS - 1)).toBeNull()
    expect(junctionDipAt(j, j.holdStartS)).toEqual({ color: 'black', alpha: 1 })
    expect(junctionDipAt(j, (j.holdStartS + j.holdEndS) / 2)).toEqual({ color: 'black', alpha: 1 })
    expect(junctionDipAt(j, j.holdEndS)).toEqual({ color: 'black', alpha: 1 })
    expect(junctionDipAt(j, j.holdEndS + 1)).toBeNull()
    let previous = 0
    for (let t = j.holdStartS - 0.8; t <= j.holdStartS; t += 0.05) {
      const alpha = junctionDipAt(j, t)?.alpha ?? 0
      expect(alpha).toBeGreaterThanOrEqual(previous)
      previous = alpha
    }
    previous = 1
    for (let t = j.holdEndS; t <= j.holdEndS + 0.8; t += 0.05) {
      const alpha = junctionDipAt(j, t)?.alpha ?? 0
      expect(alpha).toBeLessThanOrEqual(previous)
      previous = alpha
    }
  })

  it('white for a white fade, none for a cut, only around the cut for a night', () => {
    expect(junctionDipAt(clockWith('fondu-blanc', 2), clockWith('fondu-blanc', 2).holdStartS)?.color).toBe('white')
    const cut = clockWith('coupe', 0)
    expect(junctionDipAt(cut, cut.holdStartS)).toBeNull()
    const night = clockWith('nuit', 8)
    expect(junctionDipAt(night, night.holdStartS)?.alpha).toBe(1)
    expect(junctionDipAt(night, night.holdStartS + 4)).toBeNull()
    expect(junctionsDipAt([night, cut], night.holdStartS - 0.4)?.alpha).toBeGreaterThan(0)
  })

  it('a pure function of the film time: the same time, the same dip', () => {
    const j = clockWith('fondu-noir', 2)
    for (const t of [j.holdStartS - 0.3, j.holdEndS + 0.3]) expect(junctionDipAt(j, t)).toEqual(junctionDipAt({ ...j }, t))
  })
})

describe('window of a stage card', () => {
  const j = (afterTrackId: string, startS: number, holdStartS: number): Pick<ClockJunction, 'afterTrackId' | 'startS' | 'holdStartS'> => ({ afterTrackId, startS, holdStartS })
  const clock = { openingS: 6, junctions: [j('a', 28, 30), j('b', 33, 35)] as ClockJunction[] }

  it('from the flight start for the first stage, from the cut for the others, for the card’s duration', () => {
    expect(stageCardWindow(clock, film, null)).toEqual({ startS: 6, endS: 11 })
    expect(stageCardWindow(clock, film, 'a')).toEqual({ startS: 30, endS: 33 })
    expect(stageCardWindow(clock, withJunctionCard(film, 'b', { durationS: 3 }), 'b')).toEqual({ startS: 35, endS: 38 })
  })

  it('not past the next junction; none without a sequence or for an unknown junction', () => {
    expect(stageCardWindow({ openingS: 6, junctions: [j('a', 14, 16)] as ClockJunction[] }, withJunctionCard(film, null, { durationS: 15 }), null)).toEqual({ startS: 6, endS: 14 })
    expect(stageCardWindow({ openingS: 6, junctions: [] }, film, null)).toBeNull()
    expect(stageCardWindow(clock, film, 'zz')).toBeNull()
  })
})

describe('dragging a junction or a card', () => {
  const input: FilmClockInput = {
    opening: { style: 'aucune', durationS: 5 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: 10_000,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
    cutsM: [5000],
  }
  const clockOfFilm = (f: Film) => buildFilmClock({ ...input, junctions: [{ ...junctionOf(f, 'a'), atM: 5000 }] })
  const ctx = (f: Film, patch: Partial<DragContext> = {}): DragContext => ({
    clock: clockOfFilm(f),
    clockOf: () => clockOfFilm(f),
    clockOfFilm,
    lengthM: 10_000,
    targets: [],
    targetsM: [],
    snapS: 0,
    ...patch,
  })

  it('the right edge of a fade follows the pointer: the hold grows by what the edge moved, within its range', () => {
    const held = withJunction(film, 'a', { holdS: 3 })
    const before = clockOfFilm(held).junctions[0]
    const longer = dragFilm(held, 'junction-a', 'end', 2, ctx(held))
    expect(junctionOf(longer, 'a').holdS).toBeCloseTo(5, 1)
    expect(clockOfFilm(longer).junctions[0].endS).toBeCloseTo(before.endS + 2, 1)
    expect(junctionOf(dragFilm(held, 'junction-a', 'end', -1, ctx(held)), 'a').holdS).toBeCloseTo(2, 1)
    expect(junctionOf(dragFilm(held, 'junction-a', 'end', 100, ctx(held)), 'a').holdS).toBe(JUNCTION_HOLD_RANGE.max)
    expect(junctionOf(dragFilm(held, 'junction-a', 'end', -100, ctx(held)), 'a').holdS).toBe(JUNCTION_HOLD_RANGE.min)
  })

  it('snaps its edge to a target (the magnet), only the right edge of a fade moves', () => {
    const held = withJunction(film, 'a', { holdS: 3 })
    const end = clockOfFilm(held).junctions[0].endS
    const snapped = dragFilm(held, 'junction-a', 'end', 1.9, ctx(held, { targets: [{ timeS: end + 2, label: 'x', kind: 'edge' }], snapS: 0.3 }))
    expect(clockOfFilm(snapped).junctions[0].endS).toBeCloseTo(end + 2, 1)
    expect(dragFilm(held, 'junction-a', 'start', 2, ctx(held))).toBe(held)
    expect(dragFilm(held, 'junction-a', 'move', 2, ctx(held))).toBe(held)
    const cut = withJunction(film, 'a', { kind: 'coupe' })
    expect(dragFilm(cut, 'junction-a', 'end', 2, ctx(cut))).toBe(cut)
    expect(dragFilm(held, 'junction-a', 'end', 2, { ...ctx(held), clockOfFilm: undefined })).toBe(held)
  })

  it('the end of a card changes its duration only, in its range', () => {
    const first = clockOfFilm(film)
    expect(junctionCardOf(dragFilm(film, 'card-stage-a', 'end', 2, ctx(film)), 'a').durationS).toBe(7)
    expect(junctionCardOf(dragFilm(film, 'card-stage-a', 'end', -20, ctx(film)), 'a').durationS).toBe(JUNCTION_CARD_RANGE.min)
    expect(junctionCardOf(dragFilm(film, FIRST_STAGE_CARD_ID, 'end', 3, ctx(film)), null).durationS).toBe(8)
    expect(dragFilm(film, 'card-stage-a', 'start', 2, ctx(film))).toBe(film)
    expect(first.junctions).toHaveLength(1)
  })
})

describe('the duration of a stage', () => {
  const input: FilmClockInput = {
    opening: { style: 'aucune', durationS: 5 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: 10_000,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
    cutsM: [5000],
  }
  const clockOfFilm = (f: Film) =>
    buildFilmClock({ ...input, junctions: [{ ...junctionOf(f, 'a'), atM: 5000 }], stages: stageSpansOf(f, ['a', 'b'], [5000], 10_000) })
  const ctx = (f: Film, patch: Partial<DragContext> = {}): DragContext => ({
    clock: clockOfFilm(f),
    clockOf: () => clockOfFilm(f),
    clockOfFilm,
    lengthM: 10_000,
    targets: [],
    targetsM: [],
    snapS: 0,
    ...patch,
  })

  it('stageSpansOf: the stages with their durations, none when no stage sets one or without a sequence', () => {
    const set = withStageDuration(film, 'b', 20)
    expect(stageSpansOf(set, ['a', 'b'], [5000], 10_000)).toEqual([
      { fromM: 0, toM: 5000 },
      { fromM: 5000, toM: 10_000, durationS: 20 },
    ])
    expect(stageSpansOf(film, ['a', 'b'], [5000], 10_000)).toEqual([])
    expect(stageSpansOf(set, ['a', 'b'], undefined, 10_000)).toEqual([])
    // a duration kept for a track that is not a stage any more
    expect(stageSpansOf(withStageDuration(film, 'gone', 20), ['a', 'b'], [5000], 10_000)).toEqual([])
    // the film's durations are valid in their range only
    expect(isValidFilm(set)).toBe(true)
    expect(isValidFilm({ ...film, stageDurations: { b: STAGE_DURATION_RANGE.min - 1 } })).toBe(false)
    expect(isValidFilm({ ...film, stageDurations: { b: STAGE_DURATION_RANGE.max + 1 } })).toBe(false)
    expect(isValidFilm({ ...film, stageDurations: { b: 'long' as never } })).toBe(false)
  })

  it('the right edge of a stage sets its flight time: the pointer moves it and what follows ripples', () => {
    const before = clockOfFilm(film)
    const edge = before.junctions[0].startS
    const longer = dragFilm(film, 'stage-a', 'end', 4, ctx(film))
    expect(longer.stageDurations?.a).toBeCloseTo(34, 1)
    expect(clockOfFilm(longer).junctions[0].startS).toBeCloseTo(edge + 4, 1)
    expect(clockOfFilm(longer).totalTime()).toBeCloseTo(before.totalTime() + 4, 1)
    // the last stage ends with the flight
    const last = dragFilm(film, 'stage-b', 'end', -10, ctx(film))
    expect(stageFlightS(clockOfFilm(last), 1)).toBeCloseTo(20, 1)
    // kept in its range
    expect(dragFilm(film, 'stage-a', 'end', 1000, ctx(film)).stageDurations?.a).toBe(STAGE_DURATION_RANGE.max)
    expect(dragFilm(film, 'stage-a', 'end', -1000, ctx(film)).stageDurations?.a).toBe(STAGE_DURATION_RANGE.min)
  })

  it('only the right edge sets the duration (the body reorders), and not without the film’s clock', () => {
    expect(dragFilm(film, 'stage-a', 'move', 4, ctx(film))).toBe(film)
    expect(dragFilm(film, 'stage-a', 'start', 4, ctx(film))).toBe(film)
    expect(dragFilm(film, 'stage-a', 'end', 4, { ...ctx(film), clockOfFilm: undefined })).toBe(film)
  })

  it('Delete on a stage goes back to its share of the duration', () => {
    const set = withStageDuration(film, 'a', 20)
    expect(removeFilmItem(set, 'stage-a')).toEqual(film)
    expect(removeFilmItem(film, 'stage-a')).toEqual(film)
  })
})

describe('project migration', () => {
  const settings = (race: object) => ({ race: { ...DEFAULT_RACE, ...race }, film: DEFAULT_FILM })

  it('the transition and the cards of « À la suite » of an old project become the film’s default junction', () => {
    const moved = withStageSettingsMigrated(settings({ sequence: true, stageTransition: 'fondu-blanc', stageCards: false }))
    expect(moved.film.junctionDefault).toEqual({ kind: 'fondu-blanc', holdS: DEFAULT_JUNCTION.holdS, card: false })
    expect(moved.race).toEqual({ ...DEFAULT_RACE, sequence: true })
    expect(withStageSettingsMigrated(settings({ stageTransition: 'coupe' })).film.junctionDefault).toEqual({ kind: 'coupe', holdS: 0, card: true })
    const plain = settings({ sequence: true })
    expect(withStageSettingsMigrated(plain)).toBe(plain)
  })
})
