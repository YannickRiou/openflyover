/**
 * The opening title and the closing card (`overlay.title`, `overlay.end`) as blocks of the timeline's « Textes » lane.
 * They have no data of their own: the settings of the overlay stay the source of truth and the overlay draws them as it
 * always did; the timeline shows their window and the user places it freely: a drag of an edge or of the whole block
 * sets `title.window` / `end.window` (film seconds). Until a card is placed, its window is the one of earlier versions,
 * from the first frame to a fraction of the flight (`title.end`), or from a fraction of it to the last frame
 * (`end.start`). Pure module (no DOM, no React).
 *
 * Selected by fixed ids, like any block of the film (`filmSelection`).
 */
import { clamp } from '../core/math'
import { CARD_WINDOW_MAX_S, fitWindow } from '../overlay/settings'
import type { CardWindow, OverlaySettings } from '../overlay/settings'
import type { FilmClock } from './clock'
import type { Grip } from './timeline'
import { t } from '../i18n'

export const TITLE_CARD_ID = 'card-title'
export const END_CARD_ID = 'card-end'
export type CardId = typeof TITLE_CARD_ID | typeof END_CARD_ID

/** Name of each card on its block, in the inspector and in the panel. */
export const CARD_LABELS: Record<CardId, string> = {
  get [TITLE_CARD_ID]() { return t('film.card.opening') },
  get [END_CARD_ID]() { return t('film.card.closing') },
}

/** The part of the film clock the cards are placed on. */
export type CardClock = Pick<FilmClock, 'openingS' | 'flightS' | 'totalTime'>

export const isCardItem = (item: string | null | undefined): item is CardId => item === TITLE_CARD_ID || item === END_CARD_ID

/** The card is drawn: the whole overlay and the card are switched on. */
export function cardShown(overlay: OverlaySettings, card: CardId): boolean {
  return overlay.enabled && (card === TITLE_CARD_ID ? overlay.title.enabled : overlay.end.enabled)
}

/** The cards that have a block on the timeline, in the order of the film. */
export function shownCards(overlay: OverlaySettings): CardId[] {
  const cards: readonly CardId[] = [TITLE_CARD_ID, END_CARD_ID]
  return cards.filter((card) => cardShown(overlay, card))
}

/** The shortest a card can be placed for (seconds). */
export const CARD_MIN_S = 0.5

/**
 * Film times between which the card is on: where it was placed (`window`), else the opening title from the first frame
 * to `title.end` of the flight and the closing card from `end.start` of the flight to the last frame (the shots
 * included, as `titleCardSpan` and `endCardSpan` do).
 */
export function cardWindow(overlay: OverlaySettings, card: CardId, clock: CardClock): CardWindow {
  const placed = card === TITLE_CARD_ID ? overlay.title.window : overlay.end.window
  if (placed) return fitWindow(placed, clock.totalTime())
  if (card === TITLE_CARD_ID) return { startS: 0, endS: clock.openingS + overlay.title.end * clock.flightS }
  return { startS: clock.openingS + overlay.end.start * clock.flightS, endS: clock.totalTime() }
}

/**
 * The overlay after dragging `grip` of `card` by `deltaS` seconds from the window it had: the start, the end or (`move`)
 * both together, `snap` applied to the edge that moves (to the start for the whole block); the window stays within the
 * film and at least CARD_MIN_S long. The overlay itself when nothing changes.
 */
export function dragCard(
  overlay: OverlaySettings,
  card: CardId,
  grip: Grip,
  deltaS: number,
  clock: CardClock,
  snap: (timeS: number) => number = (t) => t,
): OverlaySettings {
  const window = cardWindow(overlay, card, clock)
  const total = Math.min(clock.totalTime(), CARD_WINDOW_MAX_S)
  const length = window.endS - window.startS
  let next: CardWindow
  if (grip === 'start') {
    const startS = clamp(snap(window.startS + deltaS), 0, window.endS - CARD_MIN_S)
    next = { startS, endS: window.endS }
  } else if (grip === 'end') {
    const endS = clamp(snap(window.endS + deltaS), window.startS + CARD_MIN_S, total)
    next = { startS: window.startS, endS }
  } else {
    const startS = clamp(snap(window.startS + deltaS), 0, Math.max(0, total - length))
    next = { startS, endS: startS + length }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000
  // an end reached stays reached: the card follows the end of the film if its length changes later
  const toEnd = next.endS >= clock.totalTime() - 1e-6
  next = { startS: round(next.startS), endS: round(next.endS), ...(toEnd && { toEnd }) }
  const had = card === TITLE_CARD_ID ? overlay.title.window : overlay.end.window
  if (next.startS === round(window.startS) && next.endS === round(window.endS) && (!had || toEnd === !!had.toEnd)) return overlay
  return card === TITLE_CARD_ID ? { ...overlay, title: { ...overlay.title, window: next } } : { ...overlay, end: { ...overlay.end, window: next } }
}

/** The overlay with `card` switched off (its settings are kept: switching it on again brings the block back as it was). */
/**
 * The card shown from `startS` for `durationS` seconds, typed in its panel like the start and length of a text: the
 * same rules as dragging its block (kept in the film, at least CARD_MIN_S long, an end reached stays at the end).
 */
export function withCardTimes(overlay: OverlaySettings, card: CardId, clock: CardClock, patch: { startS?: number; durationS?: number }): OverlaySettings {
  const window = cardWindow(overlay, card, clock)
  const moved = patch.startS === undefined ? overlay : dragCard(overlay, card, 'move', patch.startS - window.startS, clock)
  if (patch.durationS === undefined) return moved
  const now = cardWindow(moved, card, clock)
  return dragCard(moved, card, 'end', now.startS + patch.durationS - now.endS, clock)
}

export function withoutCard(overlay: OverlaySettings, card: CardId): OverlaySettings {
  return card === TITLE_CARD_ID ? { ...overlay, title: { ...overlay.title, enabled: false } } : { ...overlay, end: { ...overlay.end, enabled: false } }
}
