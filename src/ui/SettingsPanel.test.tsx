// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { findImageryDates } from '../terrain/imageryDates'
import { GradingPanel } from './GradingPanel'
import { usePreferences } from './preferences'
import { LightSettings, MapSettings, WeatherSettings } from './SettingsPanel'

vi.mock('../terrain/imageryDates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terrain/imageryDates')>()),
  findImageryDates: vi.fn(),
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('« Date des photos »', () => {
  afterEach(() => {
    useAppStore.getState().replaceTracks([])
    document.body.innerHTML = ''
  })

  it('an Esri date chosen before its list was found shows its day once found again, never the number of its release', async () => {
    const points = [
      { lon: 6.86, lat: 45.92 },
      { lon: 6.87, lat: 45.93 },
    ]
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    const { settings, setSetting } = useAppStore.getState()
    setSetting('imagerySourceId', 'arcgis-world-imagery')
    setSetting('imageryDate', 'esri:13968')
    let resolve: (dates: Awaited<ReturnType<typeof findImageryDates>>) => void = () => {}
    vi.mocked(findImageryDates).mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<MapSettings />))
    expect(host.textContent).not.toContain('13968')
    expect(host.textContent).toContain('Photos plus anciennes')
    expect(findImageryDates).toHaveBeenCalledTimes(1)
    const date = { value: 'esri:13968', timeMs: Date.UTC(2021, 0, 12), taken: true, kind: 'esri' as const }
    await act(async () => resolve({ latest: { ...date, value: '' }, dates: [date] }))
    expect(host.textContent).toContain('12 janvier 2021')
    act(() => root.unmount())
    setSetting('imagerySourceId', settings.imagerySourceId)
    setSetting('imageryDate', '')
  })
})

describe('« Ombres des nuages »', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('greyed out, with the reason, when there are no clouds in volume', async () => {
    const { settings, setSetting } = useAppStore.getState()
    setSetting('atmosphere', true)
    setSetting('clouds', { ...settings.clouds, mode: 'aucun' })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<LightSettings />))
    const box = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.closest('label')?.textContent?.includes('Ombres des nuages'))!
    expect(box.disabled).toBe(true)
    expect(host.textContent).toContain('pas de nuages en volume')
    await act(async () => setSetting('clouds', { ...settings.clouds, mode: 'manuel' }))
    expect(box.disabled).toBe(false)
    act(() => root.unmount())
    setSetting('clouds', settings.clouds)
    setSetting('atmosphere', settings.atmosphere)
  })
})

describe('« Couleurs »: a grading preset with keys', () => {
  afterEach(() => {
    useAppStore.getState().replaceTracks([])
    document.body.innerHTML = ''
  })

  it('a value driven by keys gets the preset’s on its key at the marker, the others the setting', async () => {
    const points = [
      { lon: 6.86, lat: 45.92 },
      { lon: 6.87, lat: 45.93 },
    ]
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    const { settings, setSetting } = useAppStore.getState()
    setSetting('film', { ...settings.film, paramKeys: [{ id: 'param-1', param: 'contrast', atM: 0, value: -0.5 }] })
    useAppStore.getState().setProgress(0, null)
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<GradingPanel />))
    const chip = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.closest('label')?.textContent === 'Contrasté')!
    await act(async () => chip.click())
    const after = useAppStore.getState().settings
    expect(after.film.paramKeys.find((k) => k.param === 'contrast')?.value).toBe(0.4)
    expect(after.grading).toMatchObject({ preset: 'contraste', saturation: 0.1, vignette: 0.25 })
    act(() => root.unmount())
    setSetting('film', settings.film)
    setSetting('grading', settings.grading)
  })
})

describe('Modes of the interface', () => {
  const sections = (host: HTMLElement) => [...host.querySelectorAll('details[data-panel-section]')].map((d) => d.getAttribute('data-panel-section'))
  const mount = async (panel: React.ReactElement) => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(panel))
    return { host, unmount: () => act(() => root.unmount()) }
  }
  const points = [
    { lon: 6.86, lat: 45.92 },
    { lon: 6.87, lat: 45.93 },
  ]
  const initial = useAppStore.getState().settings

  afterEach(() => {
    usePreferences.setState({ uiMode: 'expert' })
    useAppStore.getState().replaceTracks([])
    for (const key of Object.keys(initial) as (keyof typeof initial)[]) useAppStore.getState().setSetting(key, initial[key])
    document.body.innerHTML = ''
  })

  it('« Carte » shows the basemap, the relief and the ambiance in Débutant, then the choice of images, water, forest and contours in Confirmé, the rest in Expert', async () => {
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    usePreferences.setState({ uiMode: 'debutant' })
    const { host, unmount } = await mount(<MapSettings />)
    expect(sections(host)).toEqual(['Fond de carte', 'Relief', 'Ambiance'])
    expect(host.textContent).toContain('Satellite')
    expect(host.textContent).not.toContain('Imagerie')
    expect(host.textContent).not.toContain('Forêts')
    expect(host.textContent).not.toContain('Nettoyer le relief')

    await act(async () => usePreferences.setState({ uiMode: 'confirme' }))
    expect(sections(host)).toEqual(['Fond de carte', 'Relief', 'Courbes de niveau'])
    expect(host.textContent).toContain('Imagerie')
    expect(host.textContent).toContain('Forêts')
    expect(host.textContent).not.toContain('Satellite')
    expect(host.textContent).not.toContain('Date des photos')
    expect(host.textContent).not.toContain('Source du relief')
    expect(host.textContent).not.toContain('Nettoyer le relief')

    await act(async () => usePreferences.setState({ uiMode: 'expert' }))
    expect(host.textContent).toContain('Source du relief')
    expect(host.textContent).toContain('Détail de l’imagerie')
    expect(host.textContent).toContain('Nettoyer le relief')
    await unmount()
  })

  it('a setting that is not at its default value stays in sight in a mode that hides it, and goes back when reset', async () => {
    usePreferences.setState({ uiMode: 'debutant' })
    const { host, unmount } = await mount(<MapSettings />)
    expect(sections(host)).not.toContain('Courbes de niveau')
    await act(async () => useAppStore.getState().setSetting('contours', { ...initial.contours, enabled: true }))
    expect(sections(host)).toContain('Courbes de niveau')
    // the value stays: the film is the same whatever the mode
    expect(useAppStore.getState().settings.contours.enabled).toBe(true)
    await act(async () => useAppStore.getState().setSetting('contours', initial.contours))
    expect(sections(host)).not.toContain('Courbes de niveau')
    // a row: the quality of the elevation data shows once it is changed
    await act(async () => useAppStore.getState().setSetting('terrainSourceId', 'aws-terrarium'))
    expect(host.textContent).toContain('Source du relief')
    await unmount()
  })

  it('the basemap tiles pick the photos or the map that cover the track, and keep a source of the same kind', async () => {
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    useAppStore.getState().setSetting('imagerySourceId', 'arcgis-world-imagery')
    usePreferences.setState({ uiMode: 'debutant' })
    const { host, unmount } = await mount(<MapSettings />)
    const tile = (label: string) => [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.labels?.[0]?.textContent === label)!
    expect(tile('Satellite').checked).toBe(true)
    // the photos already chosen are not replaced by the regional ones
    await act(async () => tile('Satellite').click())
    expect(useAppStore.getState().settings.imagerySourceId).toBe('arcgis-world-imagery')
    await act(async () => tile('Carte').click())
    expect(useAppStore.getState().settings.imagerySourceId).toBe('ign-plan')
    expect(tile('Carte').checked).toBe(true)
    await act(async () => tile('Satellite').click())
    expect(useAppStore.getState().settings.imagerySourceId).toBe('ign-ortho')
    await unmount()
  })

  it('the ambiance sets the clouds and the sun in one undo step, and the chip is lit while the settings match', async () => {
    useAppStore.getState().replaceTracks([{ ...buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }), color: '#ff5a36' }])
    usePreferences.setState({ uiMode: 'debutant' })
    const { host, unmount } = await mount(<MapSettings />)
    const chip = (label: string) => [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.labels?.[0]?.textContent === label)!
    expect(chip('Météo du jour').checked).toBe(true)
    await act(async () => chip('Grand beau').click())
    let now = useAppStore.getState().settings
    expect(now.clouds.mode).toBe('aucun')
    expect(now.sunFromTrack).toBe(false)
    expect(chip('Grand beau').checked).toBe(true)
    await act(async () => chip('Coucher de soleil').click())
    now = useAppStore.getState().settings
    expect(now.clouds.mode).toBe('meteo')
    expect(now.sunFromTrack).toBe(false)
    expect(now.sunHour).toBeGreaterThan(15)
    await act(async () => chip('Météo du jour').click())
    expect(useAppStore.getState().settings.clouds).toEqual(initial.clouds)
    expect(useAppStore.getState().settings.sunFromTrack).toBe(true)
    // one step back from « Grand beau » is the sunset again, not half of a change
    await act(async () => chip('Grand beau').click())
    await act(async () => getSettingsHistory().undo())
    expect(useAppStore.getState().settings.clouds).toEqual(initial.clouds)
    expect(useAppStore.getState().settings.sunFromTrack).toBe(true)
    await unmount()
  })

  it('« Météo » and « Lumière » keep the sections of the mode and show the rest as the mode grows', async () => {
    usePreferences.setState({ uiMode: 'confirme' })
    const { host, unmount } = await mount(
      <>
        <WeatherSettings />
        <LightSettings />
      </>,
    )
    expect(sections(host)).toEqual(['Nuages', 'Neige', 'Soleil', 'Jours et nuits'])
    await act(async () => usePreferences.setState({ uiMode: 'expert' }))
    expect(sections(host)).toEqual(['Nuages', 'Pluie et brume', 'Neige', 'Atmosphère', 'Soleil', 'Jours et nuits'])
    await act(async () => usePreferences.setState({ uiMode: 'confirme' }))
    // the atmosphere switched off is a modified setting: its section stays
    await act(async () => useAppStore.getState().setSetting('atmosphere', false))
    expect(sections(host)).toContain('Atmosphère')
    await unmount()
  })
})
