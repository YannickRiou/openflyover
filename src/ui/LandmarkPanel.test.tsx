// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILM } from '../film/model'
import type { Film } from '../film/model'
import { buildTrack } from '../import/stats'
import { splitHidden, withRank } from '../osm/landmarks'
import type { Landmark, LandmarkSettings } from '../osm/landmarks'
import { useLandmarkStore } from '../osm/store'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { LandmarkPanel } from './LandmarkPanel'

/** the landmarks "found" for the track, filtered by distance and split by hidden id like the store does */
const found = vi.hoisted(() => ({ list: [] as Landmark[], refreshed: 0 }))
vi.mock('../osm/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../osm/store')>()
  return {
    ...actual,
    syncLandmarks: (tracks: readonly { id: string }[], settings: LandmarkSettings, options?: { refresh?: boolean }) => {
      if (options?.refresh) found.refreshed++
      const near = found.list.filter((l) => l.distanceM <= settings.maxDistanceM && !settings.dismissedIds.includes(l.id))
      const { shown, hidden } = splitHidden(withRank(near, settings.rank), settings.hiddenIds)
      const id = tracks[0].id
      actual.useLandmarkStore.setState({ status: 'ready', landmarks: { [id]: shown }, hidden: { [id]: hidden } })
    },
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = () => {}
  // no canvas in jsdom: the map draws nothing, its markers are what is tested
  HTMLCanvasElement.prototype.getContext = () => null
})

const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
const points = Array.from({ length: 51 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000 + i * 10 }))
const track = buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] })
const landmark = (id: string, kind: Landmark['kind'], name: string, alongM: number, distanceM: number): Landmark => ({
  id,
  kind,
  name,
  lon: 6.8,
  lat: 45.8 + alongM / M_PER_DEG_LAT,
  distanceM,
  alongM,
  priority: 10,
  text: name,
})
const PASS = landmark('node/1', 'pass', 'Col de Voza', 1500, 50)
const LAKE = landmark('way/2', 'lake', 'Lac Vert', 3000, 400)
const POI = { id: 'poi-1', lon: 6.8, lat: 45.8 + 4000 / M_PER_DEG_LAT, name: 'Pique-nique' }

async function mount(film: Film) {
  found.list = [PASS, LAKE]
  found.refreshed = 0
  useAppStore.setState({ tracks: [track], settings: { ...DEFAULT_SETTINGS, film } })
  getSettingsHistory().clear()
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<LandmarkPanel />))
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
  // the window of the map is a portal: searched in the whole page
  const page = document.body
  const openMap = () => act(async () => button('Choisir sur la carte et le profil').click())
  const profileMarker = (name: string) => page.querySelector<HTMLButtonElement>(`[data-testid="profile-marker"][aria-label^="${name} :"]`)!
  const mapMarker = (name: string) => page.querySelector<HTMLButtonElement>(`[data-testid="map-marker"][aria-label^="${name} :"]`)!
  const select = (name: string) => act(async () => profileMarker(name).click())
  /** a button of the card of the selected landmark, by its accessible name */
  const card = (label: string) => page.querySelector<HTMLButtonElement>(`[data-testid="selected-landmark"] button[aria-label^="${label}"]`)!
  const mode = (name: string) => card(`« ${name} » :`)
  const stopBox = (name: string) => page.querySelector<HTMLInputElement>(`input[aria-label="Arrêt dans le film à « ${name} »"]`)!
  return { host, root, button, openMap, profileMarker, mapMarker, select, card, mode, stopBox }
}

describe('LandmarkPanel: the points of interest, and the landmarks in the window of the map', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    useLandmarkStore.setState({ status: 'idle', landmarks: {}, hidden: {}, features: {} })
  })

  it('lists the points of interest; the landmarks are chosen in the window, where « Arrêt » makes and removes a stop', async () => {
    const { host, root, openMap, select, stopBox, profileMarker } = await mount({ ...DEFAULT_FILM, pois: [POI] })
    // the panel lists the points of interest only
    const names = [...host.querySelectorAll('[data-testid="place"]')].map((li) => li.querySelector('input')?.value)
    expect(names).toEqual(['Pique-nique'])
    expect(host.querySelector('[data-testid="landmark-name"]')).toBeNull()

    await openMap()
    expect(document.body.querySelectorAll('[data-testid="profile-marker"]')).toHaveLength(2)
    expect(document.body.querySelectorAll('[data-testid="map-marker"]')).toHaveLength(2)
    expect(document.body.querySelector('[data-testid="selected-landmark"]')).toBeNull()

    // the pass has its automatic stop
    await select('Col de Voza')
    expect(document.body.querySelector('[data-testid="selected-landmark"] [data-testid="landmark-name"]')?.textContent).toBe('Col de Voza')
    expect(stopBox('Col de Voza').checked).toBe(true)
    await select('Col de Voza')
    expect(document.body.querySelector('[data-testid="selected-landmark"]')).toBeNull()

    await select('Lac Vert')
    await act(async () => stopBox('Lac Vert').click())
    let film = useAppStore.getState().settings.film
    expect(film.autoStops).toBe(false)
    expect(film.stops.find((s) => s.label === 'Lac Vert')).toMatchObject({ atM: 3000, source: { kind: 'landmark', ref: 'way/2' } })
    await select('Col de Voza')
    await act(async () => stopBox('Col de Voza').click())
    film = useAppStore.getState().settings.film
    expect(film.stops.map((s) => s.label)).toEqual(['Lac Vert'])
    expect(profileMarker('Lac Vert')).not.toBeNull()
    act(() => root.unmount())
  })

  it('selecting on the map or on the profile is the same selection; the arrows go to the previous and the next landmark', async () => {
    const { root, openMap, mapMarker, profileMarker, card } = await mount({ ...DEFAULT_FILM })
    await openMap()
    const selectedName = () => document.body.querySelector('[data-testid="selected-landmark"] [data-testid="landmark-name"]')?.textContent
    await act(async () => mapMarker('Lac Vert').click())
    expect(selectedName()).toBe('Lac Vert')
    expect(profileMarker('Lac Vert').getAttribute('aria-pressed')).toBe('true')
    expect(mapMarker('Lac Vert').getAttribute('aria-pressed')).toBe('true')
    expect(profileMarker('Col de Voza').getAttribute('aria-pressed')).toBe('false')
    // along the track: the pass, then the lake
    expect(card('Repère suivant').disabled).toBe(true)
    await act(async () => card('Repère précédent').click())
    expect(selectedName()).toBe('Col de Voza')
    expect(card('Repère précédent').disabled).toBe(true)
    await act(async () => card('Repère suivant').click())
    expect(selectedName()).toBe('Lac Vert')
    act(() => root.unmount())
  })

  it('a click on the profile takes the flyover to that point; « Aller à ce repère » to the landmark', async () => {
    const { root, openMap, select, card } = await mount({ ...DEFAULT_FILM })
    await openMap()
    const profile = document.body.querySelector<HTMLElement>('[data-testid="landmark-profile"]')!
    profile.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 100, right: 500, bottom: 100, x: 100, y: 0, toJSON: () => ({}) })
    await act(async () => {
      profile.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300 }))
    })
    expect(useAppStore.getState().playback.progress).toBeCloseTo(0.5, 6)

    await select('Lac Vert')
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="selected-landmark"] button')].find((b) => b.textContent === 'Aller à ce repère')!.click())
    expect(useAppStore.getState().playback.progress).toBeCloseTo(3000 / track.stats.distanceM, 6)
    // a marker is not a click on the profile
    expect(card('Repère précédent')).not.toBeNull()
    act(() => root.unmount())
  })

  it('the arrows rank the landmarks', async () => {
    const { root, openMap, select, card, profileMarker } = await mount({ ...DEFAULT_FILM })
    await openMap()
    await select('Col de Voza')
    expect(card('Monter « Col de Voza » dans le classement').disabled).toBe(true)
    await act(async () => card('Descendre « Col de Voza » dans le classement').click())
    expect(useAppStore.getState().settings.landmarks.rank).toEqual(['way/2', 'node/1'])
    // the selection stays on the landmark that moved
    expect(profileMarker('Col de Voza').getAttribute('aria-pressed')).toBe('true')
    expect(card('Descendre « Col de Voza » dans le classement').disabled).toBe(true)
    expect(card('Monter « Col de Voza » dans le classement').disabled).toBe(false)
    act(() => root.unmount())
  })

  it('one button per landmark cycles Auto, Toujours, Jamais; the markers and the summary follow, Jamais removes the stop', async () => {
    const lakeStop = { id: 'stop-1', atM: 3000, durationS: 4, camera: 'orbite' as const, source: { kind: 'landmark' as const, ref: 'way/2' } }
    const { host, root, button, openMap, select, mode, profileMarker, mapMarker } = await mount({ ...DEFAULT_FILM, autoStops: false, stops: [lakeStop] })
    const status = () => host.querySelector('p[role="status"]')!.textContent
    expect(status()).toBe('2 affichés.')
    expect(button('Tout remettre en auto').disabled).toBe(true)

    await openMap()
    await select('Lac Vert')
    expect(mode('Lac Vert').getAttribute('aria-label')).toBe('« Lac Vert » : Auto. Changer')
    expect(profileMarker('Lac Vert').dataset.mode).toBe('auto')

    await act(async () => mode('Lac Vert').click())
    expect(mode('Lac Vert').textContent).toBe('Toujours')
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: ['way/2'], hiddenIds: [] })
    expect(profileMarker('Lac Vert').dataset.mode).toBe('always')
    expect(mapMarker('Lac Vert').dataset.mode).toBe('always')
    expect(status()).toBe('2 affichés · 1 toujours.')

    await act(async () => mode('Lac Vert').click())
    expect(mode('Lac Vert').textContent).toBe('Jamais')
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: [], hiddenIds: ['way/2'] })
    // the stop of the landmark goes with its label, in the same undo step; it is still listed, selected
    expect(useAppStore.getState().settings.film.stops).toEqual([])
    expect(profileMarker('Lac Vert').dataset.mode).toBe('never')
    expect(document.body.querySelector('[data-testid="selected-landmark"][data-hidden]')).not.toBeNull()
    expect(status()).toBe('1 affiché · 1 jamais.')

    await act(async () => mode('Lac Vert').click())
    expect(mode('Lac Vert').textContent).toBe('Auto')
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: [], hiddenIds: [] })
    act(() => getSettingsHistory().undo())
    expect(mode('Lac Vert').textContent).toBe('Jamais')
    act(() => root.unmount())
  })

  it('the eye of the selected landmark hides it (Jamais) and shows it again (Auto)', async () => {
    const { root, openMap, select, card, profileMarker } = await mount({ ...DEFAULT_FILM })
    await openMap()
    await select('Col de Voza')
    await act(async () => card('Masquer « Col de Voza »').click())
    expect(useAppStore.getState().settings.landmarks.hiddenIds).toEqual(['node/1'])
    expect(profileMarker('Col de Voza').dataset.mode).toBe('never')
    await act(async () => card('Afficher « Col de Voza »').click())
    expect(useAppStore.getState().settings.landmarks.hiddenIds).toEqual([])
    act(() => root.unmount())
  })

  it('« Tout remettre en auto » clears every Toujours and Jamais in one step', async () => {
    const { host, root, button, openMap, select, mode } = await mount({ ...DEFAULT_FILM, pois: [POI] })
    await openMap()
    await select('Col de Voza')
    await act(async () => mode('Col de Voza').click())
    await select('Lac Vert')
    await act(async () => mode('Lac Vert').click())
    await act(async () => mode('Lac Vert').click())
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="Masquer"]')!.click())
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: ['node/1'], hiddenIds: ['way/2', 'poi-1'] })
    await act(async () => button('Tout remettre en auto').click())
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: [], hiddenIds: [] })
    expect(host.querySelectorAll('[data-testid="place"][data-hidden]')).toHaveLength(0)
    act(() => getSettingsHistory().undo())
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: ['node/1'], hiddenIds: ['way/2', 'poi-1'] })
    act(() => root.unmount())
  })

  it('« Garder les « Toujours » » dismisses the others and their stops in one step, until « Relancer la recherche »', async () => {
    const lakeStop = { id: 'stop-1', atM: 3000, durationS: 4, camera: 'orbite' as const, source: { kind: 'landmark' as const, ref: 'way/2' } }
    const { host, root, button, openMap, select, mode, profileMarker } = await mount({ ...DEFAULT_FILM, autoStops: false, stops: [lakeStop], pois: [POI] })
    expect(button('Garder les « Toujours »').disabled).toBe(true)

    await openMap()
    await select('Col de Voza')
    await act(async () => mode('Col de Voza').click())
    expect(button('Garder les « Toujours »').disabled).toBe(false)
    await act(async () => button('Garder les « Toujours »').click())
    const { landmarks, film } = useAppStore.getState().settings
    expect(landmarks).toMatchObject({ pinnedIds: ['node/1'], dismissedIds: ['way/2'] })
    expect(film.stops).toEqual([])
    expect(document.body.querySelectorAll('[data-testid="profile-marker"]')).toHaveLength(1)
    // the point of interest is not a landmark: left alone
    expect(film.pois).toEqual([POI])
    expect(host.querySelectorAll('[data-testid="place"]')).toHaveLength(1)

    act(() => getSettingsHistory().undo())
    expect(useAppStore.getState().settings.landmarks.dismissedIds).toEqual([])
    expect(useAppStore.getState().settings.film.stops).toEqual([lakeStop])
    expect(useAppStore.getState().settings.landmarks.pinnedIds).toEqual(['node/1'])

    await act(async () => button('Garder les « Toujours »').click())
    await act(async () => button('Relancer la recherche').click())
    expect(found.refreshed).toBe(1)
    expect(useAppStore.getState().settings.landmarks.dismissedIds).toEqual([])
    expect(profileMarker('Lac Vert')).not.toBeNull()
    act(() => root.unmount())
  })

  it('« Densité » sets how many landmarks are kept: Peu, Normal, Beaucoup', async () => {
    const { host, root } = await mount({ ...DEFAULT_FILM })
    const radios = () => [...host.querySelectorAll<HTMLInputElement>('[role="radiogroup"][aria-labelledby$="-density"] input[type="radio"]')]
    expect(host.textContent).toContain('Densité')
    expect(radios().map((r) => [r.value, r.checked])).toEqual([['few', false], ['normal', true], ['many', false]])
    await act(async () => radios()[0].click())
    expect(useAppStore.getState().settings.landmarks.density).toBe('few')
    expect(radios().map((r) => r.checked)).toEqual([true, false, false])
    expect(host.textContent).not.toContain('Nombre maximal')
    act(() => root.unmount())
  })

  it('« Tout masquer » hides every label with its stop in one step; landmarks found later are shown as new', async () => {
    const lakeStop = { id: 'stop-1', atM: 3000, durationS: 4, camera: 'orbite' as const, source: { kind: 'landmark' as const, ref: 'way/2' } }
    const before: Film = { ...DEFAULT_FILM, autoStops: false, stops: [lakeStop], pois: [POI] }
    const { host, root, button, openMap } = await mount(before)
    await act(async () => button('Tout masquer').click())
    const { landmarks, film } = useAppStore.getState().settings
    expect(new Set(landmarks.hiddenIds)).toEqual(new Set(['node/1', 'way/2', 'poi-1']))
    expect(film.stops).toEqual([])
    expect(host.querySelectorAll('[data-testid="place"][data-hidden]')).toHaveLength(1)
    expect(button('Tout masquer').disabled).toBe(true)

    // a wider corridor finds one more: shown, marked new
    found.list = [PASS, LAKE, landmark('node/3', 'peak', 'Mont Lachat', 4500, 1200)]
    await act(async () => useAppStore.getState().setSetting('landmarks', { ...useAppStore.getState().settings.landmarks, maxDistanceM: 2000 }))
    expect(host.querySelector('p[role="status"]')!.textContent).toBe('1 affiché · 2 jamais.')
    await openMap()
    expect(document.body.querySelector<HTMLElement>('[data-testid="profile-marker"][aria-label^="Mont Lachat :"]')?.dataset.mode).toBe('auto')
    await act(async () => document.body.querySelector<HTMLElement>('[data-testid="profile-marker"][aria-label^="Mont Lachat :"]')!.click())
    expect(document.body.querySelector('[data-testid="place-new"]')).not.toBeNull()
    await act(async () => button('1 nouveau').click())
    expect(document.body.querySelector('[data-testid="place-new"]')).toBeNull()

    // undone step by step: the corridor, then everything hidden with the stop
    act(() => getSettingsHistory().undo())
    act(() => getSettingsHistory().undo())
    act(() => getSettingsHistory().undo())
    expect(useAppStore.getState().settings.landmarks.hiddenIds).toEqual([])
    expect(useAppStore.getState().settings.film.stops).toEqual([lakeStop])
    act(() => root.unmount())
  })
})
