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
})

const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
const points = Array.from({ length: 51 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000 }))
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
  const stopBox = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="Arrêt dans le film à « ${name} »"]`)!
  return { host, root, button, stopBox }
}

describe('LandmarkPanel: one list of landmarks and points of interest', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    useLandmarkStore.setState({ status: 'idle', landmarks: {}, hidden: {}, features: {} })
  })

  it('lists both, points of interest first; « Arrêt » makes and removes a stop there', async () => {
    const { host, root, stopBox } = await mount({ ...DEFAULT_FILM, pois: [POI] })
    const names = [...host.querySelectorAll('[data-testid="place"]')].map((li) => li.querySelector('[data-testid="landmark-name"]')?.textContent ?? li.querySelector('input')?.value)
    // the points of interest first, then the landmarks by importance (equal here: along the track)
    expect(names).toEqual(['Pique-nique', 'Col de Voza', 'Lac Vert'])
    // the pass has its automatic stop
    expect(stopBox('Col de Voza').checked).toBe(true)
    await act(async () => stopBox('Lac Vert').click())
    let film = useAppStore.getState().settings.film
    expect(film.autoStops).toBe(false)
    expect(film.stops.find((s) => s.label === 'Lac Vert')).toMatchObject({ atM: 3000, source: { kind: 'landmark', ref: 'way/2' } })
    await act(async () => stopBox('Pique-nique').click())
    await act(async () => stopBox('Col de Voza').click())
    film = useAppStore.getState().settings.film
    expect(film.stops.map((s) => s.label)).toEqual(['Lac Vert', 'Pique-nique'])
    act(() => root.unmount())
  })

  it('the arrows rank the landmarks', async () => {
    const { host, root } = await mount({ ...DEFAULT_FILM })
    const names = () => [...host.querySelectorAll('[data-testid="place"] [data-testid="landmark-name"]')].map((n) => n.textContent)
    const click = (label: string) => act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())
    expect(names()).toEqual(['Col de Voza', 'Lac Vert'])
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Monter « Col de Voza » dans le classement"]')!.disabled).toBe(true)
    await click('Descendre « Col de Voza » dans le classement')
    expect(useAppStore.getState().settings.landmarks.rank).toEqual(['way/2', 'node/1'])
    expect(names()).toEqual(['Lac Vert', 'Col de Voza'])
    act(() => root.unmount())
  })

  it('one button per landmark cycles Auto, Toujours, Jamais; the summary counts them and Jamais removes the stop', async () => {
    const lakeStop = { id: 'stop-1', atM: 3000, durationS: 4, camera: 'orbite' as const, source: { kind: 'landmark' as const, ref: 'way/2' } }
    const { host, root, button } = await mount({ ...DEFAULT_FILM, autoStops: false, stops: [lakeStop] })
    const mode = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="« ${name} » :"]`)!
    const status = () => host.querySelector('[role="status"]')!.textContent
    // one button per row, no eye, pin or cross
    expect(host.querySelectorAll('button[data-mode]')).toHaveLength(2)
    expect(host.querySelector('button[aria-label^="Masquer"], button[aria-label^="Épingler"], button[aria-label^="Écarter"]')).toBeNull()
    expect(mode('Lac Vert').getAttribute('aria-label')).toBe('« Lac Vert » : Auto. Changer')
    expect(status()).toBe('2 affichés.')
    expect(button('Tout remettre en auto').disabled).toBe(true)

    await act(async () => mode('Lac Vert').click())
    expect(mode('Lac Vert').textContent).toBe('Toujours')
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: ['way/2'], hiddenIds: [] })
    expect(status()).toBe('2 affichés · 1 toujours.')

    await act(async () => mode('Lac Vert').click())
    expect(mode('Lac Vert').textContent).toBe('Jamais')
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: [], hiddenIds: ['way/2'] })
    // the stop of the landmark goes with its label, in the same undo step
    expect(useAppStore.getState().settings.film.stops).toEqual([])
    expect(host.querySelectorAll('[data-testid="place"][data-hidden]')).toHaveLength(1)
    expect(status()).toBe('1 affiché · 1 jamais.')

    await act(async () => mode('Lac Vert').click())
    expect(mode('Lac Vert').textContent).toBe('Auto')
    expect(useAppStore.getState().settings.landmarks).toMatchObject({ pinnedIds: [], hiddenIds: [] })
    act(() => getSettingsHistory().undo())
    expect(mode('Lac Vert').textContent).toBe('Jamais')
    act(() => root.unmount())
  })

  it('« Tout remettre en auto » clears every Toujours and Jamais in one step', async () => {
    const { host, root, button } = await mount({ ...DEFAULT_FILM, pois: [POI] })
    const mode = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="« ${name} » :"]`)!
    await act(async () => mode('Col de Voza').click())
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
    const { host, root, button } = await mount({ ...DEFAULT_FILM, autoStops: false, stops: [lakeStop], pois: [POI] })
    const mode = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="« ${name} » :"]`)!
    const names = () => [...host.querySelectorAll('[data-testid="place"] [data-testid="landmark-name"]')].map((n) => n.textContent)
    expect(button('Garder les « Toujours »').disabled).toBe(true)

    await act(async () => mode('Col de Voza').click())
    expect(button('Garder les « Toujours »').disabled).toBe(false)
    await act(async () => button('Garder les « Toujours »').click())
    const { landmarks, film } = useAppStore.getState().settings
    expect(landmarks).toMatchObject({ pinnedIds: ['node/1'], dismissedIds: ['way/2'] })
    expect(film.stops).toEqual([])
    expect(names()).toEqual(['Col de Voza'])
    // the point of interest is not a landmark: left alone
    expect(film.pois).toEqual([POI])

    act(() => getSettingsHistory().undo())
    expect(useAppStore.getState().settings.landmarks.dismissedIds).toEqual([])
    expect(useAppStore.getState().settings.film.stops).toEqual([lakeStop])
    expect(useAppStore.getState().settings.landmarks.pinnedIds).toEqual(['node/1'])

    await act(async () => button('Garder les « Toujours »').click())
    await act(async () => button('Relancer la recherche').click())
    expect(found.refreshed).toBe(1)
    expect(useAppStore.getState().settings.landmarks.dismissedIds).toEqual([])
    expect(names()).toEqual(['Col de Voza', 'Lac Vert'])
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
    const { host, root, button } = await mount(before)
    await act(async () => button('Tout masquer').click())
    const { landmarks, film } = useAppStore.getState().settings
    expect(new Set(landmarks.hiddenIds)).toEqual(new Set(['node/1', 'way/2', 'poi-1']))
    expect(film.stops).toEqual([])
    expect(host.querySelectorAll('[data-testid="place"][data-hidden]')).toHaveLength(3)
    expect(button('Tout masquer').disabled).toBe(true)

    // a wider corridor finds one more: shown, marked new
    found.list = [PASS, LAKE, landmark('node/3', 'peak', 'Mont Lachat', 4500, 1200)]
    await act(async () => useAppStore.getState().setSetting('landmarks', { ...useAppStore.getState().settings.landmarks, maxDistanceM: 2000 }))
    expect(host.querySelector('[data-testid="place"]:not([data-hidden]) [data-testid="landmark-name"]')?.textContent).toBe('Mont Lachat')
    expect(host.querySelector('[data-testid="place-new"]')).not.toBeNull()
    await act(async () => button('1 nouveau').click())
    expect(host.querySelector('[data-testid="place-new"]')).toBeNull()

    // undone step by step: the corridor, then everything hidden with the stop
    act(() => getSettingsHistory().undo())
    act(() => getSettingsHistory().undo())
    act(() => getSettingsHistory().undo())
    expect(useAppStore.getState().settings.landmarks.hiddenIds).toEqual([])
    expect(useAppStore.getState().settings.film.stops).toEqual([lakeStop])
    act(() => root.unmount())
  })
})
