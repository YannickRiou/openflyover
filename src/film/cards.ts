/**
 * The opening title and the closing card (`overlay.title`, `overlay.end`) as blocks of the timeline's « Textes » lane.
 * They have no data of their own: the settings of the overlay stay the source of truth and the overlay draws them as it
 * always did; the timeline only shows their real window and turns a drag of an edge into the fraction of the flight the
 * settings keep (`title.end`, `end.start`). Pure module (no DOM, no React).
 *
 * Selected by fixed ids, like any block of the film (`filmSelection`).
 */
import { clamp } from '../core/math'
import { END_START_MAX, END_START_MIN, TITLE_END_MAX, TITLE_END_MIN } from '../overlay/settings'
import type { OverlaySettings } from '../overlay/settings'
import type { FilmClock } from './clock'
import type { Grip } from './timeline'

export const TITLE_CARD_ID = 'card-title'
export const END_CARD_ID = 'card-end'
export type CardId = typeof TITLE_CARD_ID | typeof END_CARD_ID

/** Name of each card on its block, in the inspector and in the panel. */
export const CARD_LABELS: Record<CardId, string> = { [TITLE_CARD_ID]: "Titre d'ouverture", [END_CARD_ID]: 'Carte de clôture' }

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

/**
 * Film times between which the card is on: the opening title from the first frame to `title.end` of the flight, the
 * closing card from `end.start` of the flight to the last frame (the shots included, as `titleCardOpacity` and
 * `endCardOpacity` do).
 */
export function cardWindow(overlay: OverlaySettings, card: CardId, clock: CardClock): { startS: number; endS: number } {
  if (card === TITLE_CARD_ID) return { startS: 0, endS: clock.openingS + overlay.title.end * clock.flightS }
  return { startS: clock.openingS + overlay.end.start * clock.flightS, endS: clock.totalTime() }
}

/** Fraction of the flight at film time `timeS` (what the settings keep), within the range of the card, to a thousandth. */
export function cardFraction(card: CardId, timeS: number, clock: Pick<CardClock, 'openingS' | 'flightS'>): number {
  const [min, max] = card === TITLE_CARD_ID ? [TITLE_END_MIN, TITLE_END_MAX] : [END_START_MIN, END_START_MAX]
  const fraction = clock.flightS > 0 ? (timeS - clock.openingS) / clock.flightS : min
  return Math.round(clamp(fraction, min, max) * 1000) / 1000
}

/**
 * The overlay after dragging `grip` of `card` by `deltaS` seconds from the window it had: only the edge that moves
 * (the right one of the title, the left one of the closing card), `snap` applied to its time; the result stays in the
 * range of the setting. The overlay itself when nothing changes (other grip, no flight, same value).
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
  if (card === TITLE_CARD_ID) {
    if (grip !== 'end') return overlay
    const end = cardFraction(card, snap(window.endS + deltaS), clock)
    return end === overlay.title.end ? overlay : { ...overlay, title: { ...overlay.title, end } }
  }
  if (grip !== 'start') return overlay
  const start = cardFraction(card, snap(window.startS + deltaS), clock)
  return start === overlay.end.start ? overlay : { ...overlay, end: { ...overlay.end, start } }
}

/** The overlay with `card` switched off (its settings are kept: switching it on again brings the block back as it was). */
export function withoutCard(overlay: OverlaySettings, card: CardId): OverlaySettings {
  return card === TITLE_CARD_ID ? { ...overlay, title: { ...overlay.title, enabled: false } } : { ...overlay, end: { ...overlay.end, enabled: false } }
}
