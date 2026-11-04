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
const { useTour } = await import('./ui/tourSteps')

/** names of the mocked parts shown in tab `tab` */
const mocksIn = (tab: string) => [...document.querySelectorAll(`[data-testid="tab-panel-${tab}"] [data-mock]`)].map((el) => el.getAttribute('data-mock'))

/** the tab panel shown, by tab */
const shownTab = () => document.querySelector('[data-testid^="tab-panel-"]:not([data-inert="true"])')?.getAttribute('data-testid')?.replace('tab-panel-', '')
const railTab = (group: string) => document.querySelector<HTMLElement>(`[role="tab"][data-testid="tab-${group}"]`)!
/** opens the group (a click on the open one folds the panel: left alone) */
const openGroup = (group: string) => act(async () => (railTab(group).getAttribute('aria-selected') === 'true' ? undefined : railTab(group).click()))
const groupSwitch = () => [...document.querySelectorAll<HTMLElement>('[data-testid="tab-group-switch"] button')]
/** every tab the rail leads to: each group, and the buttons of its switch */
async function reachableTabs() {
  const tabs: (string | undefined)[] = []
  for (const group of [...document.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-testid')!.replace('tab-', ''))) {
    await openGroup(group)
    const buttons = groupSwitch().length
    if (buttons === 0) tabs.push(shownTab())
    for (let i = 0; i < buttons; i++) {
      await act(async () => groupSwitch()[i].click())
      tabs.push(shownTab())
    }
  }
  return tabs
}

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

    // a group of the rail, then the button of its switch (the last tab of the group that is shown)
    for (const [group, button, tab] of [['decor', 0, 'carte'], ['camera', 0, 'survol'], ['projet', 0, 'projet'], ['projet', 1, 'reglages']] as const) {
      await openGroup(group)
      if (groupSwitch().length > 0) await act(async () => groupSwitch()[button].click())
      // the shown panel is the only tab panel; the other eight stay mounted, inert
      expect([...document.querySelectorAll('[role="tabpanel"]')].map((el) => el.getAttribute('data-testid'))).toEqual([`tab-panel-${tab}`])
      expect(document.querySelectorAll('[data-testid^="tab-panel-"][data-inert="true"]')).toHaveLength(8)
      expect(railTab(group).getAttribute('aria-selected')).toBe('true')
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
    const selected = () => document.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('data-testid')
    // Expert is the app as it was: every tab
    expect(await reachableTabs()).toEqual(['trace', 'carte', 'meteo', 'lumiere', 'survol', 'objectif', 'habillage', 'projet', 'reglages'])

    await act(async () => setPreferences({ uiMode: 'confirme' }))
    expect(await reachableTabs()).toEqual(['trace', 'carte', 'meteo', 'lumiere', 'survol', 'habillage', 'projet', 'reglages'])
    await act(async () => setPreferences({ uiMode: 'debutant' }))
    expect(await reachableTabs()).toEqual(['trace', 'carte', 'survol', 'habillage', 'projet', 'reglages'])
    // the group of Carte, Météo and Lumière keeps its place in the rail, with Carte only: no switch
    await openGroup('decor')
    expect(groupSwitch()).toHaveLength(0)
    // the tab that was open is gone: the first one takes its place
    await act(async () => setPreferences({ uiMode: 'expert' }))
    await openGroup('decor')
    await act(async () => groupSwitch()[2].click())
    await act(async () => setPreferences({ uiMode: 'debutant' }))
    expect(selected()).toBe('tab-trace')

    // a modified setting of a hidden tab brings it back, and only while it is modified
    const { settings, setSetting } = useAppStore.getState()
    await act(async () => setSetting('lens', { ...settings.lens, flare: 0.5 }))
    expect(await reachableTabs()).toContain('objectif')
    await act(async () => setSetting('lens', settings.lens))
    expect(await reachableTabs()).not.toContain('objectif')
    await act(async () => setSetting('sunFromTrack', false))
    expect(await reachableTabs()).toContain('lumiere')
    await act(async () => setSetting('sunFromTrack', settings.sunFromTrack))
    expect(await reachableTabs()).not.toContain('lumiere')
    await act(async () => setPreferences({ uiMode: 'expert' }))
    act(() => root.unmount())
    document.body.innerHTML = ''
  })
})

describe('App shell: the tabs in five groups', () => {
  it('groups the tabs in five on a computer; a group opens the tab of it last shown, the panel switches between its tabs', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    const rail = () => [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent)
    const switches = () => groupSwitch().map((b) => b.textContent)
    expect(rail()).toEqual(['Trace', 'Scène', 'Caméra', 'Habillage', 'Projet'])

    await openGroup('decor')
    expect(shownTab()).toBe('carte')
    expect(switches()).toEqual(['Carte', 'Météo', 'Lumière'])
    await act(async () => groupSwitch()[1].click())
    expect(shownTab()).toBe('meteo')
    // another group, then back: Météo again
    await openGroup('camera')
    expect(shownTab()).toBe('survol')
    expect(switches()).toEqual(['Survol', 'Objectif'])
    await openGroup('decor')
    expect(shownTab()).toBe('meteo')
    // a group of one tab has no switch
    await openGroup('habillage')
    expect(switches()).toEqual([])
    act(() => root.unmount())
    document.body.innerHTML = ''
  })

  it('opens the group and the tab of a section found with Ctrl+K', async () => {
    getPlatform().storage.set(PREFERENCES_KEY, JSON.stringify({ language: 'fr' }))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    expect(shownTab()).toBe('trace')
    // no question about the number of settings in front of the search
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })))
    const results = () => [...document.querySelectorAll<HTMLElement>('[data-testid="settings-search-results"] button')]
    await act(async () => results().find((b) => b.textContent?.startsWith('Soleil'))!.click())
    expect(shownTab()).toBe('lumiere')
    expect(railTab('decor').getAttribute('aria-selected')).toBe('true')
    act(() => root.unmount())
    document.body.innerHTML = ''
    getPlatform().storage.remove(PREFERENCES_KEY)
  })

  it('shows « Projet » alone on the home screen, without a switch', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    useAppStore.setState({ tracks: [] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    expect([...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual(['Projet'])
    expect(groupSwitch()).toHaveLength(0)
    act(() => root.unmount())
    document.body.innerHTML = ''
  })
})

describe('App shell: the bar of a selected block on a phone', () => {
  it('offers « Couper » and « Dupliquer » for a text, not for a stop', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    const matchMedia = window.matchMedia
    // a phone upright: the bottom sheets and the block bar
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 699px'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const { addStop, addText } = await import('./film/timeline')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    const bar = () => [...document.querySelectorAll('[role="toolbar"][aria-label="Élément sélectionné"] button')].map((b) => b.textContent)
    const { settings, setSetting, setFilmSelection } = useAppStore.getState()
    const text = addText(settings.film, 0)
    await act(async () => {
      setSetting('film', text.film)
      setFilmSelection(text.id)
    })
    expect(bar()).toEqual(['Terminé', 'Modifier', 'Couper', 'Dupliquer', 'Supprimer'])
    const stop = addStop(useAppStore.getState().settings.film, 100)
    await act(async () => {
      setSetting('film', stop.film)
      setFilmSelection(stop.id)
    })
    expect(bar()).toEqual(['Terminé', 'Modifier', 'Supprimer'])
    await act(async () => {
      setFilmSelection(null)
      setSetting('film', settings.film)
    })
    window.matchMedia = matchMedia
    act(() => root.unmount())
    document.body.innerHTML = ''
  })
})

describe('Tabs and the « Ambiance » chips', () => {
  it('« Grand beau » in Débutant keeps Météo and Lumière hidden; values that match no chip bring the tabs back', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    await act(async () => setPreferences({ uiMode: 'debutant' }))
    const { settings, setSetting } = useAppStore.getState()
    // what the chip sets (no place yet: the plain day, noon at 12 h)
    await act(async () => {
      setSetting('clouds', { ...settings.clouds, mode: 'aucun' })
      setSetting('sunFromTrack', false)
      setSetting('sunHour', 12)
      // « Grand beau » also leaves the weather of the day out of the scene
      setSetting('weatherScene', { ...settings.weatherScene, enabled: false })
    })
    expect(await reachableTabs()).not.toContain('meteo')
    expect(await reachableTabs()).not.toContain('lumiere')
    // the weather acting on the scene again is no chip's « Grand beau »: the tab shows it
    await act(async () => setSetting('weatherScene', { ...settings.weatherScene, enabled: true }))
    expect(await reachableTabs()).toContain('meteo')
    await act(async () => setSetting('weatherScene', { ...settings.weatherScene, enabled: false }))
    expect(await reachableTabs()).not.toContain('meteo')
    // the sun at an hour no chip sets: the values are no chip's any more, both tabs show them
    await act(async () => setSetting('sunHour', 11))
    expect(await reachableTabs()).toContain('lumiere')
    expect(await reachableTabs()).toContain('meteo')
    await act(async () => setSetting('sunHour', 12))
    // clouds set by hand to something no chip sets
    await act(async () => setSetting('clouds', { ...settings.clouds, mode: 'manuel' }))
    expect(await reachableTabs()).toContain('meteo')
    await act(async () => setSetting('clouds', { ...settings.clouds, mode: 'aucun' }))
    expect(await reachableTabs()).not.toContain('meteo')
    // any other setting of the tab brings it back, a chip or not
    await act(async () => setSetting('snow', { ...settings.snow, mode: 'aucune' }))
    expect(await reachableTabs()).toContain('meteo')
    await act(async () => {
      setSetting('snow', settings.snow)
      setSetting('clouds', settings.clouds)
      setSetting('sunFromTrack', settings.sunFromTrack)
      setSetting('sunHour', settings.sunHour)
      setPreferences({ uiMode: 'expert' })
    })
    act(() => root.unmount())
    document.body.innerHTML = ''
  })
})

describe('First launch: « Combien de réglages voulez-vous voir ? »', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
  const launch = async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {}
    // a tour started by a slower test before (its 1.5 s delay) stays open in its store: the question must be judged alone
    useTour.setState({ open: false, step: 0, steps: [] })
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
