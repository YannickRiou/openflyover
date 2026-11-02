// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { buildTrack } from './import/stats'
import { getPlatform } from './platform'

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
const { PREFERENCES_KEY, setPreferences, usePreferences } = await import('./ui/preferences')

/** names of the mocked parts shown in tab `tab` */
const mocksIn = (tab: string) => [...document.querySelectorAll(`[data-testid="tab-panel-${tab}"] [data-mock]`)].map((el) => el.getAttribute('data-mock'))

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
      await act(async () => document.querySelector<HTMLElement>(`[role="tab"][data-testid="tab-${tab}"]`)!.click())
      // the shown panel is the only tab panel; the other eight stay mounted, inert
      expect([...document.querySelectorAll('[role="tabpanel"]')].map((el) => el.getAttribute('data-testid'))).toEqual([`tab-panel-${tab}`])
      expect(document.querySelectorAll('[data-testid^="tab-panel-"][data-inert="true"]')).toHaveLength(8)
      expect(document.querySelector(`[data-testid="tab-${tab}"]`)!.getAttribute('aria-selected')).toBe('true')
    }
    expect(renders).toEqual(before)

    // the track, its line and its marker settings in « Trace » (the 3D labels are in « Habillage »); the map in « Carte »
    expect(mocksIn('trace')).toEqual(['TrackList', 'TrackStyleSection', 'MarkerSection'])
    expect(mocksIn('carte')).toEqual(['MapSettings', 'LandmarkPanel'])
    expect(mocksIn('reglages')).toEqual(['PreferencesPanel'])
    act(() => root.unmount())
  })

  it('leaves out the tabs a mode hides, unless one of their settings is modified, and moves off a tab that goes', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    const rail = () => [...document.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-testid')!.replace('tab-', ''))
    const selected = () => document.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('data-testid')
    // Expert is the app as it was: every tab
    expect(rail()).toEqual(['trace', 'carte', 'meteo', 'lumiere', 'survol', 'objectif', 'habillage', 'projet', 'reglages'])

    await act(async () => document.querySelector<HTMLElement>('[role="tab"][data-testid="tab-lumiere"]')!.click())
    await act(async () => setPreferences({ uiMode: 'confirme' }))
    expect(rail()).toEqual(['trace', 'carte', 'meteo', 'lumiere', 'survol', 'habillage', 'projet', 'reglages'])
    await act(async () => setPreferences({ uiMode: 'debutant' }))
    expect(rail()).toEqual(['trace', 'carte', 'survol', 'habillage', 'projet', 'reglages'])
    // the tab that was open is gone: the first one takes its place
    expect(selected()).toBe('tab-trace')

    // a modified setting of a hidden tab brings it back, and only while it is modified
    const { settings, setSetting } = useAppStore.getState()
    await act(async () => setSetting('lens', { ...settings.lens, flare: 0.5 }))
    expect(rail()).toContain('objectif')
    await act(async () => setSetting('lens', settings.lens))
    expect(rail()).not.toContain('objectif')
    await act(async () => setSetting('sunFromTrack', false))
    expect(rail()).toContain('lumiere')
    await act(async () => setSetting('sunFromTrack', settings.sunFromTrack))
    expect(rail()).not.toContain('lumiere')
    await act(async () => setPreferences({ uiMode: 'expert' }))
    act(() => root.unmount())
    document.body.innerHTML = ''
  })
})

describe('First launch: « Combien de réglages voulez-vous voir ? »', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const launch = async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    return root
  }
  const clean = async (root: ReturnType<typeof createRoot>) => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    getPlatform().storage.remove(PREFERENCES_KEY)
    usePreferences.setState({ uiMode: 'expert' })
  }

  it('is asked on a device that stored nothing; Débutant is preselected and Continuer keeps the choice', async () => {
    getPlatform().storage.remove(PREFERENCES_KEY)
    const root = await launch()
    expect(dialog()!.textContent).toContain('Combien de réglages voulez-vous voir\u00a0?')
    const radios = [...dialog()!.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual([
      'DébutantUne trace, un film automatique, un bouton pour exporter.',
      'ConfirméMétéo, lumière, caméra, habillage complet et timeline avec plans.',
      'ExpertTous les réglages, images clés et encodage.',
    ])
    expect(radios.map((r) => r.checked)).toEqual([true, false, false])
    await act(async () => radios[1].click())
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Continuer')!.click())
    expect(usePreferences.getState().uiMode).toBe('confirme')
    expect(JSON.parse(getPlatform().storage.get(PREFERENCES_KEY)!).uiMode).toBe('confirme')
    await clean(root)
  })

  it('is not asked on a device that stored preferences before the modes: it stays in Expert', async () => {
    getPlatform().storage.set(PREFERENCES_KEY, JSON.stringify({ language: 'fr', timelineClock: true }))
    usePreferences.setState({ uiMode: 'expert' })
    const root = await launch()
    expect(dialog()).toBeNull()
    expect(usePreferences.getState().uiMode).toBe('expert')
    await clean(root)
  })
})
