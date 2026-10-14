import { describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAY, END_START_MAX, END_START_MIN, TITLE_END_MAX, TITLE_END_MIN } from '../overlay/settings'
import type { OverlaySettings } from '../overlay/settings'
import { END_CARD_ID, TITLE_CARD_ID, cardFraction, cardShown, cardWindow, dragCard, isCardItem, shownCards, withoutCard } from './cards'

/** 6 s opening, 60 s flight, 5 s closing */
const clock = { openingS: 6, flightS: 60, totalTime: () => 71 }
const on: OverlaySettings = { ...DEFAULT_OVERLAY, enabled: true }

describe('cards on the timeline', () => {
  it('shows a card only while the overlay and the card are on', () => {
    expect(shownCards(DEFAULT_OVERLAY)).toEqual([])
    expect(shownCards(on)).toEqual([TITLE_CARD_ID, END_CARD_ID])
    expect(shownCards({ ...on, end: { ...on.end, enabled: false } })).toEqual([TITLE_CARD_ID])
    expect(shownCards({ ...on, title: { ...on.title, enabled: false } })).toEqual([END_CARD_ID])
    // the whole overlay off hides both, whatever the cards say
    expect(cardShown({ ...on, enabled: false }, TITLE_CARD_ID)).toBe(false)
    expect(cardShown({ ...on, enabled: false }, END_CARD_ID)).toBe(false)
    expect(isCardItem(TITLE_CARD_ID) && isCardItem(END_CARD_ID)).toBe(true)
    expect(isCardItem('text-1') || isCardItem(null) || isCardItem('opening')).toBe(false)
  })

  it('places the title from the first frame to a fraction of the flight, the closing card from a fraction to the last frame', () => {
    expect(cardWindow(on, TITLE_CARD_ID, clock)).toEqual({ startS: 0, endS: 6 + 0.1 * 60 })
    expect(cardWindow(on, END_CARD_ID, clock)).toEqual({ startS: 6 + 0.9 * 60, endS: 71 })
  })

  it('turns a time back into the fraction of the flight, within the range of the setting', () => {
    expect(cardFraction(TITLE_CARD_ID, 6 + 0.2 * 60, clock)).toBe(0.2)
    expect(cardFraction(TITLE_CARD_ID, 0, clock)).toBe(TITLE_END_MIN)
    expect(cardFraction(TITLE_CARD_ID, 71, clock)).toBe(TITLE_END_MAX)
    expect(cardFraction(END_CARD_ID, 6 + 0.75 * 60, clock)).toBe(0.75)
    expect(cardFraction(END_CARD_ID, 10, clock)).toBe(END_START_MIN)
    expect(cardFraction(END_CARD_ID, 71, clock)).toBe(END_START_MAX)
    expect(TITLE_END_MIN).toBe(0.01)
    expect(END_START_MAX).toBe(0.99)
    // no flight: the lower bound, never NaN
    expect(cardFraction(TITLE_CARD_ID, 3, { openingS: 3, flightS: 0 })).toBe(TITLE_END_MIN)
  })

  it('drags the right edge of the title and the left edge of the closing card, and nothing else', () => {
    // 6 s later = a tenth of the flight
    const longer = dragCard(on, TITLE_CARD_ID, 'end', 6, clock)
    expect(longer.title.end).toBeCloseTo(0.2, 3)
    expect(longer.end).toBe(on.end)
    expect(dragCard(on, TITLE_CARD_ID, 'end', -100, clock).title.end).toBe(TITLE_END_MIN)
    expect(dragCard(on, TITLE_CARD_ID, 'end', 100, clock).title.end).toBe(TITLE_END_MAX)
    const earlier = dragCard(on, END_CARD_ID, 'start', -6, clock)
    expect(earlier.end.start).toBeCloseTo(0.8, 3)
    expect(earlier.title).toBe(on.title)
    expect(dragCard(on, END_CARD_ID, 'start', -100, clock).end.start).toBe(END_START_MIN)
    expect(dragCard(on, END_CARD_ID, 'start', 100, clock).end.start).toBe(END_START_MAX)
    // the other edge and the body do not move
    expect(dragCard(on, TITLE_CARD_ID, 'start', 5, clock)).toBe(on)
    expect(dragCard(on, TITLE_CARD_ID, 'move', 5, clock)).toBe(on)
    expect(dragCard(on, END_CARD_ID, 'end', 5, clock)).toBe(on)
    expect(dragCard(on, END_CARD_ID, 'move', 5, clock)).toBe(on)
    // no change, no new overlay
    expect(dragCard(on, TITLE_CARD_ID, 'end', 0, clock)).toBe(on)
  })

  it('snaps the edge like the other blocks', () => {
    const snapped = dragCard(on, TITLE_CARD_ID, 'end', 3.2, clock, () => 6 + 0.25 * 60)
    expect(snapped.title.end).toBe(0.25)
  })

  it('switches a card off keeping its settings', () => {
    const edited: OverlaySettings = { ...on, title: { ...on.title, title: 'Col du Galibier', end: 0.2 } }
    const off = withoutCard(edited, TITLE_CARD_ID)
    expect(off.title).toEqual({ ...edited.title, enabled: false })
    expect(off.end).toBe(edited.end)
    expect(shownCards(off)).toEqual([END_CARD_ID])
    expect(withoutCard(edited, END_CARD_ID).end.enabled).toBe(false)
  })
})
