// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FLYOVER_DURATION_RANGE } from '../flyover/cameraSettings'
import { buildTrack } from '../import/stats'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { CameraPanel } from './CameraPanel'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
/** 4 h of outing over 5 km */
const timed = buildTrack({
  name: 'Sortie',
  source: 'gpx',
  segments: [{ points: Array.from({ length: 51 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000, time: i * 288_000 })) }],
})
const untimed = buildTrack({
  name: 'Sortie',
  source: 'gpx',
  segments: [{ points: Array.from({ length: 51 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000 })) }],
})

/** What the browser does when the user edits a field: set the text, fire `input`. */
const typeIn = (input: HTMLInputElement, text: string) =>
  act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

/** « Régler par » › « Vitesse du marqueur » */
const chooseSpeed = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Vitesse du marqueur')!.click()

async function mount(track: typeof timed, durationS: number) {
  useAppStore.setState({ tracks: [track], settings: { ...DEFAULT_SETTINGS, flyoverDurationS: durationS } })
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<CameraPanel />))
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  return { host, root, button }
}

describe('CameraPanel: duration of the flyover', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('« + » and « − » move the duration by one notch of the slider, kept inside its range', async () => {
    const { root, button } = await mount(timed, 60)
    await act(async () => button('Allonger la durée du survol').click())
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(60 + FLYOVER_DURATION_RANGE.step)
    await act(async () => button('Réduire la durée du survol').click())
    await act(async () => button('Réduire la durée du survol').click())
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(60 - FLYOVER_DURATION_RANGE.step)
    act(() => root.unmount())
  })

  it('disables the button at each end of the range', async () => {
    const low = await mount(timed, FLYOVER_DURATION_RANGE.min)
    expect(low.button('Réduire la durée du survol').disabled).toBe(true)
    expect(low.button('Allonger la durée du survol').disabled).toBe(false)
    act(() => low.root.unmount())
    document.body.innerHTML = ''
    const high = await mount(timed, FLYOVER_DURATION_RANGE.max)
    expect(high.button('Allonger la durée du survol').disabled).toBe(true)
    act(() => high.root.unmount())
  })

  it('writes the other face beneath: × the recorded time and km/h, or km/h alone for an untimed track', async () => {
    const withTimes = await mount(timed, 60)
    // 4 h recorded over 60 s of film, 5 km in 60 s
    expect(withTimes.host.textContent).toContain('soit × 240 (sortie de 4 h 00) · 300 km/h')
    act(() => withTimes.root.unmount())
    document.body.innerHTML = ''
    const without = await mount(untimed, 60)
    expect(without.host.textContent).toContain('soit 300 km/h')
    expect(without.host.textContent).not.toContain('sortie de')
    act(() => without.root.unmount())
  })

  it('a typed duration, in seconds, is set when settled', async () => {
    const { host, root } = await mount(timed, 60)
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Durée du survol, en secondes"]')!
    await typeIn(box, '47')
    await act(async () => box.blur())
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(47)
    act(() => root.unmount())
  })

  it('« Vitesse du marqueur »: typed in × the recorded time, then in km/h for a track without times', async () => {
    const withTimes = await mount(timed, 60)
    await act(async () => chooseSpeed(withTimes.host))
    const up = withTimes.host.querySelector<HTMLInputElement>('input[aria-label="Vitesse du marqueur, en fois le temps réel"]')!
    expect(up.value).toBe('240')
    await typeIn(up, '120')
    await act(async () => up.blur())
    // 4 h = 14400 s over 120
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(120)
    expect(withTimes.host.textContent).toContain('soit 2 min')
    act(() => withTimes.root.unmount())
    document.body.innerHTML = ''
    const without = await mount(untimed, 60)
    await act(async () => chooseSpeed(without.host))
    expect(without.host.querySelector('input[aria-label="Vitesse du marqueur, en fois le temps réel"]')).toBeNull()
    const kmh = without.host.querySelector<HTMLInputElement>('input[aria-label="Vitesse du marqueur, en kilomètres par heure"]')!
    expect(kmh.value).toBe('300')
    await typeIn(kmh, '150')
    await act(async () => kmh.blur())
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(120)
    act(() => without.root.unmount())
  })
})

describe('CameraPanel: « À la suite » on two days', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /** 1 h of outing over 5 km, starting `dayOffset` days after the first */
  const stage = (dayOffset: number) =>
    buildTrack({
      name: 'Étape',
      source: 'gpx',
      segments: [
        { points: Array.from({ length: 51 }, (_, i) => ({ lon: 6.8, lat: 45.8 + (i * 100) / M_PER_DEG_LAT, ele: 1000, time: dayOffset * 86_400_000 + i * 72_000 })) },
      ],
    })

  it('counts the time recorded in each stage, not the night between them', async () => {
    const { host, root } = await mount(timed, 60)
    useAppStore.setState({
      tracks: [stage(0), stage(1)],
      settings: { ...DEFAULT_SETTINGS, flyoverDurationS: 60, race: { ...DEFAULT_SETTINGS.race, sequence: true } },
    })
    await act(async () => undefined)
    // 2 h recorded (not 25 h) over 60 s: × 120
    expect(host.textContent).toContain('soit × 120 (sortie de 2 h 00)')
    act(() => root.unmount())
  })
})

describe('CameraPanel: the presets', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('are a radio group of tiles: the current one is checked, choosing another sets the camera', async () => {
    const { host, root } = await mount(timed, 60)
    const group = host.querySelector('[role="radiogroup"][aria-labelledby]')!
    const tile = (name: string) => [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.labels?.[0]?.textContent?.startsWith(name))!
    expect(tile('Poursuite').checked).toBe(true)
    expect(tile('Oiseau').checked).toBe(false)
    await act(async () => tile('Oiseau').click())
    expect(useAppStore.getState().settings.camera.style).toBe('sway')
    expect(tile('Oiseau').checked).toBe(true)
    // settings that match no preset show a tile of their own, which is already chosen
    await act(async () => useAppStore.getState().setSetting('camera', { ...useAppStore.getState().settings.camera, distance: 1.11 }))
    expect(tile('Personnalisé').checked).toBe(true)
    act(() => root.unmount())
  })
})

describe('CameraPanel: « Depuis la région » at the opening and the closing', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('says the style of each shot, set in its panel, and « Régler » opens that panel', async () => {
    const { host, root } = await mount(timed, 60)
    const { film } = useAppStore.getState().settings
    await act(async () => useAppStore.getState().setSetting('film', { ...film, opening: { ...film.opening, style: 'situation' } }))
    expect(host.textContent).toContain('Ouverture : Depuis la région')
    expect(host.querySelector('input[role="switch"][aria-label*="région"]')).toBeNull()
    const edit = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Régler')!
    await act(async () => edit.click())
    expect(useAppStore.getState().filmSelection).toBe('opening')
    act(() => root.unmount())
  })
})

describe('CameraPanel: « Pause aux temps forts »', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('only for a film saved before the timeline, whose automatic stops it makes', async () => {
    const pacing = { ...DEFAULT_SETTINGS.pacing, enabled: true }
    const mountWith = async (autoMode: 'temps-forts' | 'rythme') => {
      useAppStore.setState({ tracks: [timed], settings: { ...DEFAULT_SETTINGS, pacing, film: { ...DEFAULT_SETTINGS.film, autoMode } } })
      const host = document.body.appendChild(document.createElement('div'))
      const root = createRoot(host)
      await act(async () => root.render(<CameraPanel />))
      return { host, root }
    }
    const current = await mountWith('temps-forts')
    expect(current.host.textContent).not.toContain('Pause aux temps forts')
    act(() => current.root.unmount())
    const older = await mountWith('rythme')
    expect(older.host.textContent).toContain('Pause aux temps forts')
    act(() => older.root.unmount())
  })
})

describe('CameraPanel: « Film automatique »', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens the three gabarits and applies the one chosen', async () => {
    const { root } = await mount(timed, 60)
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Choisir un gabarit'))!
    await act(async () => open.click())
    const list = document.querySelector('[data-testid="auto-film-templates"]')!
    expect([...list.querySelectorAll('li p.font-semibold')].map((p) => p.textContent)).toEqual(['Reel 30 s', 'Résumé 1 min', 'Souvenir 3 min'])
    await act(async () => list.querySelector<HTMLButtonElement>('button[aria-label="Appliquer le gabarit « Résumé 1 min »"]')!.click())
    const { settings } = useAppStore.getState()
    expect(settings.flyoverDurationS + settings.film.opening.durationS + settings.film.closing.durationS).toBe(60)
    expect(document.querySelector('[data-testid="auto-film-templates"]')).toBeNull()
    act(() => root.unmount())
  })

  it('is off without a track', async () => {
    useAppStore.setState({ tracks: [], settings: DEFAULT_SETTINGS })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<CameraPanel />))
    const open = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Choisir un gabarit'))!
    expect(open.disabled).toBe(true)
    act(() => root.unmount())
  })
})
