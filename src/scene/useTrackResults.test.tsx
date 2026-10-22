// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { mergeByTrack } from '../osm/byTrack'
import { useTrackResults, type TrackResults } from './useTrackResults'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function track(name: string, lat: number): Track {
  const points = [0, 1, 2].map((i) => ({ lon: 6.8 + i * 0.01, lat, ele: 1000 }))
  return buildTrack({ name, source: 'gpx', segments: [{ points }] })
}

/** A request that waits for `settle` (the Overpass queue answers one at a time, whenever it answers). */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

function mount(initial: { enabled: boolean; tracks: readonly Track[] }, fetch: (t: Track) => Promise<{ id: string }[]>) {
  const seen: { current: TrackResults<{ id: string }[]> | null } = { current: null }
  function Probe({ enabled, tracks }: { enabled: boolean; tracks: readonly Track[] }) {
    seen.current = useTrackResults(enabled, tracks, fetch)
    return null
  }
  root = createRoot(document.createElement('div'))
  const render = (props: { enabled: boolean; tracks: readonly Track[] }) => act(() => root!.render(<Probe {...props} />))
  render(initial)
  return { seen, render }
}

describe('useTrackResults', () => {
  it('asks once per track, shows each answer as it comes and merges them by track', async () => {
    const [a, b] = [track('A', 45), track('B', 45.1)]
    const answers = new Map([[a.id, deferred<{ id: string }[]>()], [b.id, deferred<{ id: string }[]>()]])
    const fetch = vi.fn((t: Track) => answers.get(t.id)!.promise)
    const { seen, render } = mount({ enabled: true, tracks: [a, b] }, fetch)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(seen.current).toMatchObject({ results: {}, loading: true, failed: false })

    await act(async () => answers.get(b.id)!.resolve([{ id: 'w2' }]))
    expect(seen.current!.loading).toBe(true)
    await act(async () => answers.get(a.id)!.resolve([{ id: 'w1' }, { id: 'w2' }]))
    expect(seen.current!.loading).toBe(false)
    expect(mergeByTrack(seen.current!.results, [a.id, b.id]).map((s) => s.id)).toEqual(['w1', 'w2'])

    // the same tracks again: nothing is asked twice
    render({ enabled: true, tracks: [a, b] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('forgets a removed track, and ignores its answer when it comes late', async () => {
    const [a, b] = [track('A', 45), track('B', 45.1)]
    const answers = new Map([[a.id, deferred<{ id: string }[]>()], [b.id, deferred<{ id: string }[]>()]])
    const { seen, render } = mount({ enabled: true, tracks: [a, b] }, (t) => answers.get(t.id)!.promise)
    await act(async () => answers.get(a.id)!.resolve([{ id: 'w1' }]))

    render({ enabled: true, tracks: [b] })
    expect(Object.keys(seen.current!.results)).toEqual([])
    await act(async () => answers.get(b.id)!.resolve([{ id: 'w3' }]))
    expect(Object.keys(seen.current!.results)).toEqual([b.id])
    expect(seen.current!.loading).toBe(false)
  })

  it('shows nothing of a removed track whose answer arrives afterwards', async () => {
    const [a, b] = [track('A', 45), track('B', 45.1)]
    const late = deferred<{ id: string }[]>()
    const { seen, render } = mount({ enabled: true, tracks: [a] }, (t) => (t.id === a.id ? late.promise : Promise.resolve([{ id: 'w3' }])))
    render({ enabled: true, tracks: [b] })
    await act(async () => late.resolve([{ id: 'w9' }]))
    expect(Object.keys(seen.current!.results)).toEqual([b.id])
    expect(mergeByTrack(seen.current!.results, [b.id]).map((s) => s.id)).toEqual(['w3'])
  })

  it('reports a failure without hiding the other tracks, and asks nothing while disabled', async () => {
    const [a, b] = [track('A', 45), track('B', 45.1)]
    const fetch = vi.fn((t: Track) => (t.id === a.id ? Promise.reject(new Error('busy')) : Promise.resolve([{ id: 'w2' }])))
    const { seen, render } = mount({ enabled: true, tracks: [a, b] }, fetch)
    await act(async () => {})
    expect(seen.current).toMatchObject({ loading: false, failed: true })
    expect(Object.keys(seen.current!.results)).toEqual([b.id])

    // asked again when the tracks change: loading, not failed, until the answer
    const retry = deferred<{ id: string }[]>()
    fetch.mockImplementation((t: Track) => (t.id === a.id ? retry.promise : Promise.resolve([{ id: 'w2' }])))
    render({ enabled: true, tracks: [a, b, track('C', 45.2)] })
    expect(seen.current).toMatchObject({ loading: true, failed: false })
    await act(async () => retry.resolve([{ id: 'w1' }]))
    expect(seen.current).toMatchObject({ loading: false, failed: false })

    render({ enabled: false, tracks: [a, b] })
    expect(seen.current).toMatchObject({ results: {}, loading: false, failed: false })
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
