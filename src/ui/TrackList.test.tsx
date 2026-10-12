// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'
import { computeTrackElevation } from '../terrain/elevation'
import { TrackList } from './TrackList'

vi.mock('../terrain/elevation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terrain/elevation')>()),
  computeTrackElevation: vi.fn(),
}))
vi.mock('./projectActions', () => ({ chainLoadedTracks: vi.fn(), chooseTracksToImport: vi.fn() }))
vi.mock('./StravaImport', () => ({ StravaDialog: () => null }))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function drawnTrack(): Track {
  const points = [
    { lon: 6.86, lat: 45.92 },
    { lon: 6.87, lat: 45.93 },
  ]
  return { ...buildTrack({ name: 'Tracé', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }
}

async function mount(track: Track) {
  useAppStore.getState().replaceTracks([track])
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<TrackList />))
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
  return { host, root, button }
}

describe('TrackList, elevation computed from the terrain', () => {
  afterEach(() => {
    useAppStore.getState().replaceTracks([])
    document.body.innerHTML = ''
  })

  it('computes the elevation of a track without one, shows the chip and clears it', async () => {
    const track = drawnTrack()
    const computed: Track = {
      ...track,
      segments: [{ points: track.segments[0].points.map((p) => ({ ...p, ele: 1200 })) }],
      stats: { ...track.stats, minEle: 1200, maxEle: 1200 },
      elevationEstimated: 'all',
    }
    vi.mocked(computeTrackElevation).mockResolvedValueOnce(computed)
    const { host, root, button } = await mount(track)
    expect(host.querySelector('.track__badge')).toBeNull()
    await act(async () => button('Calculer l’altitude')!.click())
    expect(vi.mocked(computeTrackElevation).mock.calls[0][1].id).toBe(useAppStore.getState().settings.terrainSourceId)
    expect(useAppStore.getState().tracks[0]).toBe(computed)
    expect(host.querySelector('.track__badge')!.textContent).toBe('altitude calculée')
    expect(button('Calculer l’altitude')).toBeUndefined()

    await act(async () => button('Effacer l’altitude')!.click())
    const cleared = useAppStore.getState().tracks[0]
    expect(cleared.stats.maxEle).toBeUndefined()
    expect(cleared).not.toHaveProperty('elevationEstimated')
    expect(button('Calculer l’altitude')).toBeDefined()
    act(() => root.unmount())
  })

  it('says why when the terrain cannot be reached, and keeps the track', async () => {
    const track = drawnTrack()
    vi.mocked(computeTrackElevation).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { host, root, button } = await mount(track)
    await act(async () => button('Calculer l’altitude')!.click())
    expect(useAppStore.getState().tracks[0]).toBe(track)
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Relief injoignable')
    act(() => root.unmount())
  })

  it('offers nothing on a recorded track', async () => {
    const track = drawnTrack()
    const recorded = { ...track, segments: [{ points: track.segments[0].points.map((p) => ({ ...p, ele: 900 })) }] }
    const { button, root } = await mount(recorded)
    expect(button('Calculer l’altitude')).toBeUndefined()
    act(() => root.unmount())
  })
})
