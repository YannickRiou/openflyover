/**
 * The guided tour of the first launch (`Tour.tsx`): the steps, where the bubble goes, and the memory of a tour already
 * seen or stopped (the platform storage). Pure apart from the store, so the tests need no screen.
 */
import { create } from 'zustand'
import type { MessageKey } from '../i18n'
import { getPlatform } from '../platform'

/** Storage key: set once the tour has ended or been stopped, so that it does not start again by itself. */
export const TOUR_KEY = 'openflyover.tour.v1'

export interface TourStep {
  id: string
  /** The element the bubble points at (CSS selector); a step whose element is not on the screen is skipped, none centres the bubble. */
  selector?: string
  title: MessageKey
  body: MessageKey
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'shell.tour.welcome.title', body: 'shell.tour.welcome.body' },
  { id: 'import', selector: '.home-actions', title: 'shell.tour.import.title', body: 'shell.tour.import.body' },
  { id: 'tabs', selector: '[data-testid="tab-trace"]', title: 'shell.tour.tabs.title', body: 'shell.tour.tabs.body' },
  { id: 'panel', selector: '#side-panel:not([hidden])', title: 'shell.tour.panel.title', body: 'shell.tour.panel.body' },
  { id: 'timeline', selector: '[data-testid="timeline"]', title: 'shell.tour.timeline.title', body: 'shell.tour.timeline.body' },
  { id: 'export', selector: '[data-testid="topbar-export"]', title: 'shell.tour.export.title', body: 'shell.tour.export.body' },
]

interface TourState {
  open: boolean
  step: number
  /** the steps of the tour running, fixed when it starts: the screen may change while it runs */
  steps: readonly TourStep[]
}

export const useTour = create<TourState>()(() => ({ open: false, step: 0, steps: [] }))

/** The steps that can be shown now: those without an element to point at, and those whose element is on the screen. */
export function availableSteps(): TourStep[] {
  return TOUR_STEPS.filter((step) => !step.selector || document.querySelector(step.selector) !== null)
}

/** Whether the tour was seen or stopped before. */
export function tourSeen(): boolean {
  return getPlatform().storage.get(TOUR_KEY) !== null
}

/** Starts the tour at its first step (from the first launch or from the help). */
export function startTour(): void {
  useTour.setState({ open: true, step: 0, steps: availableSteps() })
}

/** Ends the tour, at its last step or stopped on the way: either way it no longer starts by itself. */
export function stopTour(): void {
  getPlatform().storage.set(TOUR_KEY, 'seen')
  useTour.setState({ open: false, step: 0, steps: [] })
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Space kept between the bubble and the edge of the window, and between the bubble and what it points at (px). */
const EDGE = 12
const GAP = 14

/**
 * Where the bubble (`size`) goes for a `target` in a window of `view`: under it if it fits, else over it, else to its right or
 * left, always inside the window. Without target the bubble is centred.
 */
export function placeBubble(target: Box | null, size: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, max - EDGE))
  if (!target) return { left: (view.width - size.width) / 2, top: Math.max(EDGE, (view.height - size.height) / 2) }
  const centred = clamp(target.left + target.width / 2 - size.width / 2, view.width - size.width + EDGE)
  const middle = clamp(target.top + target.height / 2 - size.height / 2, view.height - size.height + EDGE)
  if (target.top + target.height + GAP + size.height <= view.height - EDGE) return { left: centred, top: target.top + target.height + GAP }
  if (target.top - GAP - size.height >= EDGE) return { left: centred, top: target.top - GAP - size.height }
  if (target.left + target.width + GAP + size.width <= view.width - EDGE) return { left: target.left + target.width + GAP, top: middle }
  if (target.left - GAP - size.width >= EDGE) return { left: target.left - GAP - size.width, top: middle }
  // a target as large as the window: the bubble sits over its lower middle
  return { left: centred, top: clamp(view.height - size.height - EDGE * 2, view.height - size.height + EDGE) }
}
