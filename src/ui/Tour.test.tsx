// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import { resetAppStore, useAppStore } from '../state/store'
import { Tour } from './Tour'
import { stopTour, useTour } from './tourSteps'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function walk(): Track {
  const points: TrackPoint[] = Array.from({ length: 10 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.0001, ele: 1000 + i }))
  return buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] })
}

describe('Tour: first launch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try {
      localStorage.clear()
    } catch {
      // no storage: the tour is never seen
    }
  })
  afterEach(() => {
    vi.useRealTimers()
    stopTour()
    resetAppStore()
    document.body.innerHTML = ''
  })

  it('does not start on the home screen, and starts once a track is open', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')))
    await act(async () => root.render(<Tour />))
    await act(async () => vi.advanceTimersByTime(5000))
    expect(useTour.getState().open).toBe(false)

    await act(async () => useAppStore.getState().replaceTracks([walk()]))
    await act(async () => vi.advanceTimersByTime(5000))
    expect(useTour.getState().open).toBe(true)
    await act(async () => root.unmount())
  })
})
