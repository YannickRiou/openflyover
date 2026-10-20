import { describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import type { OverlaySettings } from '../overlay/settings'
import { CARD_MIN_S, END_CARD_ID, TITLE_CARD_ID, cardShown, cardWindow, dragCard, isCardItem, shownCards, withoutCard } from './cards'

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

  it('places the title from the first frame to a fraction of the flight, the closing card from a fraction to the last frame, until the user places it', () => {
    expect(cardWindow(on, TITLE_CARD_ID, clock)).toEqual({ startS: 0, endS: 6 + 0.1 * 60 })
    expect(cardWindow(on, END_CARD_ID, clock)).toEqual({ startS: 6 + 0.9 * 60, endS: 71 })
    const placed = { ...on, title: { ...on.title, window: { startS: 2, endS: 5 } }, end: { ...on.end, window: { startS: 60, endS: 70 } } }
    expect(cardWindow(placed, TITLE_CARD_ID, clock)).toEqual({ startS: 2, endS: 5 })
    expect(cardWindow(placed, END_CARD_ID, clock)).toEqual({ startS: 60, endS: 70 })
  })

  it('drags the start, the end or the whole block, the card staying inside the film', () => {
    const grown = dragCard(on, TITLE_CARD_ID, 'end', 6, clock)
    expect(grown.title.window).toEqual({ startS: 0, endS: 18 })
    expect(grown.end).toBe(on.end)
    const later = dragCard(grown, TITLE_CARD_ID, 'start', 3, clock)
    expect(later.title.window).toEqual({ startS: 3, endS: 18 })
    // the whole block keeps its length
    const moved = dragCard(later, TITLE_CARD_ID, 'move', 10, clock)
    expect(moved.title.window).toEqual({ startS: 13, endS: 28 })
    // the closing card: freed from the end of the film
    const closing = dragCard(on, END_CARD_ID, 'end', -5, clock)
    expect(closing.end.window).toEqual({ startS: 60, endS: 66 })
    expect(dragCard(on, END_CARD_ID, 'start', -20, clock).end.window).toEqual({ startS: 60 - 20 + 0, endS: 71, toEnd: true })
    // the film's edges and a minimum length
    // already at the film's edge: nothing moves
    expect(dragCard(on, TITLE_CARD_ID, 'move', -100, clock)).toBe(on)
    expect(dragCard(on, END_CARD_ID, 'move', 100, clock)).toBe(on)
    expect(dragCard(dragCard(on, END_CARD_ID, 'end', -5, clock), END_CARD_ID, 'move', 100, clock).end.window).toEqual({ startS: 65, endS: 71, toEnd: true })
    expect(dragCard(on, TITLE_CARD_ID, 'end', -100, clock).title.window).toEqual({ startS: 0, endS: CARD_MIN_S })
    expect(dragCard(on, TITLE_CARD_ID, 'end', 1000, clock).title.window?.endS).toBe(71)
    expect(dragCard(on, END_CARD_ID, 'start', 1000, clock).end.window?.startS).toBe(71 - CARD_MIN_S)
    // no change, no new overlay
    expect(dragCard(on, TITLE_CARD_ID, 'end', 0, clock)).toBe(on)
    expect(dragCard(on, END_CARD_ID, 'move', 0, clock)).toBe(on)
  })

  it('a card that reached the end of the film follows it when the film gets shorter or longer', () => {
    // placed at the end of a 71 s film (as dragged)
    const placed = dragCard(on, END_CARD_ID, 'start', -5, clock)
    expect(placed.end.window).toMatchObject({ endS: 71, toEnd: true })
    const shorter = { ...clock, totalTime: () => 50 }
    const longer = { ...clock, totalTime: () => 90 }
    const length = placed.end.window!.endS - placed.end.window!.startS
    expect(cardWindow(placed, END_CARD_ID, shorter)).toEqual({ startS: 50 - length, endS: 50, toEnd: true })
    expect(cardWindow(placed, END_CARD_ID, longer)).toEqual({ startS: 90 - length, endS: 90, toEnd: true })
    // an edge dragged away from the end lets go of it
    const away = dragCard(placed, END_CARD_ID, 'end', -3, clock)
    expect(away.end.window?.toEnd).toBeUndefined()
    expect(cardWindow(away, END_CARD_ID, longer)).toEqual({ startS: 55, endS: 68 })
  })

  it('a card placed before the end slides back when the film becomes shorter than its window, never longer than the film', () => {
    const placed = { ...on, end: { ...on.end, window: { startS: 60, endS: 68 } } }
    expect(cardWindow(placed, END_CARD_ID, { ...clock, totalTime: () => 64 })).toEqual({ startS: 56, endS: 64 })
    expect(cardWindow(placed, END_CARD_ID, { ...clock, totalTime: () => 5 })).toEqual({ startS: 0, endS: 5 })
    // a longer film leaves it where it was
    expect(cardWindow(placed, END_CARD_ID, { ...clock, totalTime: () => 90 })).toEqual({ startS: 60, endS: 68 })
  })

  it('snaps the edge like the other blocks (the start of the block when it moves whole)', () => {
    const snapped = dragCard(on, TITLE_CARD_ID, 'end', 3.2, clock, () => 20)
    expect(snapped.title.window).toEqual({ startS: 0, endS: 20 })
    const moved = dragCard(on, TITLE_CARD_ID, 'move', 3.2, clock, () => 4)
    expect(moved.title.window).toEqual({ startS: 4, endS: 16 })
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
