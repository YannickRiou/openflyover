// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { buildTrack } from './import/stats'

/** renders of the mocked heavy parts, by name; each leaves a mark to find which tab holds it */
const renders = vi.hoisted(() => new Map<string, number>())
const counted = (name: string) => () => {
  renders.set(name, (renders.get(name) ?? 0) + 1)
  return <i data-mock={name} />
}
vi.mock('./ui/Stage', () => ({ Stage: counted('Stage') }))
vi.mock('./ui/Timeline', () => ({ Timeline: counted('Timeline') }))
vi.mock('./ui/TrackList', () => ({ TrackList: counted('TrackList') }))
vi.mock('./ui/SettingsPanel', () => ({ MapSettings: counted('MapSettings'), WeatherSettings: counted('WeatherSettings'), LightSettings: counted('LightSettings') }))
vi.mock('./ui/TrackMarkerSection', () => ({ TrackStyleSection: counted('TrackStyleSection'), MarkerSection: counted('MarkerSection') }))
vi.mock('./ui/LabelSettings', () => ({ LabelSettings: counted('LabelSettings') }))
vi.mock('./ui/LandmarkPanel', () => ({ LandmarkPanel: counted('LandmarkPanel') }))
vi.mock('./ui/WeatherPanel', () => ({ WeatherPanel: counted('WeatherPanel') }))
vi.mock('./ui/GradingPanel', () => ({ GradingPanel: counted('GradingPanel') }))
vi.mock('./ui/CameraPanel', () => ({ CameraPanel: counted('CameraPanel') }))
vi.mock('./ui/LensPanel', () => ({ LensPanel: counted('LensPanel') }))
vi.mock('./ui/OverlayPanel', () => ({ OverlayPanel: counted('OverlayPanel') }))
vi.mock('./ui/ProjectPanel', () => ({ ProjectPanel: counted('ProjectPanel') }))
vi.mock('./ui/OfflinePanel', () => ({ OfflinePanel: counted('OfflinePanel') }))
vi.mock('./ui/PreferencesPanel', () => ({ PreferencesPanel: counted('PreferencesPanel') }))

const { default: App } = await import('./App')
const { useAppStore } = await import('./state/store')

/** names of the mocked parts shown in tab `tab` */
const mocksIn = (tab: string) => [...document.querySelectorAll(`#tab-panel-${tab} [data-mock]`)].map((el) => el.getAttribute('data-mock'))

describe('App shell', () => {
  it('switches tabs without rendering the panels, the stage or the timeline again', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {} // not in jsdom
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    const before = new Map(renders)
    expect(before.get('CameraPanel')).toBeGreaterThan(0)

    for (const tab of ['carte', 'survol', 'projet', 'reglages']) {
      await act(async () => document.getElementById(`tab-${tab}`)!.click())
      expect(document.getElementById(`tab-panel-${tab}`)!.hidden).toBe(false)
    }
    expect(renders).toEqual(before)

    // the track, its line and its marker settings, and the climbs in « Trace »; the map in « Carte »
    expect(mocksIn('trace')).toEqual(['TrackList', 'TrackStyleSection', 'MarkerSection', 'LabelSettings'])
    expect(mocksIn('carte')).toEqual(['MapSettings', 'LandmarkPanel'])
    expect(mocksIn('reglages')).toEqual(['PreferencesPanel'])
    act(() => root.unmount())
  })
})
