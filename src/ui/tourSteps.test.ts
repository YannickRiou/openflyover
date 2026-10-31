// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getPlatform } from '../platform'
import { TOUR_KEY, TOUR_STEPS, placeBubble, startTour, stopTour, tourSeen, useTour } from './tourSteps'

const view = { width: 1200, height: 800 }
const size = { width: 320, height: 160 }

afterEach(() => {
  getPlatform().storage.remove(TOUR_KEY)
  useTour.setState({ open: false, step: 0, steps: [] })
})

describe('placeBubble', () => {
  it('centres the bubble without a target', () => {
    expect(placeBubble(null, size, view)).toEqual({ left: 440, top: 320 })
  })
  it('puts the bubble under a target that leaves room', () => {
    const spot = placeBubble({ left: 100, top: 40, width: 200, height: 40 }, size, view)
    expect(spot.top).toBe(40 + 40 + 14)
    expect(spot.left).toBe(100 + 100 - 160)
  })
  it('puts the bubble over a target at the foot of the window', () => {
    const spot = placeBubble({ left: 500, top: 740, width: 100, height: 40 }, size, view)
    expect(spot.top).toBe(740 - 14 - 160)
  })
  it('keeps the bubble inside the window', () => {
    const spot = placeBubble({ left: 0, top: 10, width: 20, height: 20 }, size, view)
    expect(spot.left).toBeGreaterThanOrEqual(12)
    expect(spot.left + size.width).toBeLessThanOrEqual(view.width - 12)
  })
  it('goes to the side of a target as tall as the window', () => {
    const spot = placeBubble({ left: 0, top: 0, width: 60, height: 800 }, size, view)
    expect(spot.left).toBe(60 + 14)
  })
})

describe('the tour', () => {
  it('has a distinct id and a title and a body for each step', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length)
    expect(TOUR_STEPS[0].selector).toBeUndefined()
  })
  it('starts at the first step and is remembered once stopped', () => {
    expect(tourSeen()).toBe(false)
    startTour()
    expect(useTour.getState()).toMatchObject({ open: true, step: 0 })
    // no screen here: only the steps that point at nothing remain
    expect(useTour.getState().steps.map((s) => s.id)).toEqual(['welcome'])
    stopTour()
    expect(useTour.getState().open).toBe(false)
    expect(tourSeen()).toBe(true)
  })
})
