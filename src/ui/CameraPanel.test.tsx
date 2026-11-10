// @vitest-environment jsdom
import { act } from 'react'
import { addStop } from '../film/timeline'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { maintainerOuting } from '../flyover/__fixtures__/maintainerOuting'
import { buildTrack } from '../import/stats'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { CameraPanel } from './CameraPanel'
import { setAutoFilmOpen } from './autoFilmOpen'
import { usePreferences } from './preferences'
import { runImport } from './projectActions'
import { useToastStore } from './toast'

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

  it('writes the other face beneath: × the pace really walked and km/h, or km/h alone for an untimed track', async () => {
    const withTimes = await mount(timed, 60)
    // 4 h moving over 60 s of film, 5 km in 60 s
    expect(withTimes.host.textContent).toContain('Vitesse du marqueur dans le film : 300 km/h, soit × 240 votre allure réelle (vous avanciez à 1,')
    expect(withTimes.host.textContent).toContain('4 h 00 en mouvement')
    act(() => withTimes.root.unmount())
    document.body.innerHTML = ''
    const without = await mount(untimed, 60)
    expect(without.host.textContent).toContain('Vitesse du marqueur dans le film : 300 km/h.')
    expect(without.host.textContent).not.toContain('en mouvement')
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

describe('CameraPanel: the maintainer\'s two reports of 4.2.0', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('« 25 s de survol » with a stop and slow-motion: the figures say what the flyover and the film are made of', async () => {
    const track = maintainerOuting()
    const pacing = { ...DEFAULT_SETTINGS.pacing, enabled: true, keepDuration: true }
    useAppStore.setState({ tracks: [track], settings: { ...DEFAULT_SETTINGS, flyoverDurationS: 25, pacing, film: { ...DEFAULT_SETTINGS.film, autoStops: false, stops: [{ id: 's', atM: 8000, durationS: 4.5, camera: 'fixe' }] } } })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<CameraPanel />))
    const { film } = useAppStore.getState().settings
    const total = film.opening.durationS + 33 + film.closing.durationS
    // 25 s set, the stop taken inside them; the night of the bivouac (8 s) is the only thing added, and the panel says so
    expect(host.textContent).toContain(`Film : ${total} s · 1 arrêt`)
    expect(host.textContent).toContain(`survol 33 s`)
    expect(host.textContent).toContain('Au-delà des 25 s réglées, le survol compte : 1 nuit (8 s).')
    expect(host.textContent).toContain('Les arrêts et les ralentis sont pris dans cette durée.')
    // unticked: the stop is added too, and the sentences follow
    await act(async () => useAppStore.getState().setSetting('pacing', { ...pacing, keepDuration: false }))
    expect(host.textContent).toContain('Les arrêts et les ralentis s’y ajoutent')
    expect(host.textContent).toContain('1 nuit (8 s) + arrêts (5 s)')
    act(() => root.unmount())
  })

  it('« 100 km/h » on a day walked at 2 km/h reads about × 50, not × 150', async () => {
    const track = maintainerOuting()
    useAppStore.setState({ tracks: [track], settings: { ...DEFAULT_SETTINGS, flyoverDurationS: 60 } })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<CameraPanel />))
    await act(async () => chooseSpeed(host))
    const up = host.querySelector<HTMLInputElement>('input[aria-label="Vitesse du marqueur, en fois le temps réel"]')!
    await typeIn(up, '50')
    await act(async () => up.blur())
    // 8 h 15 moving over × 50 = 594 s, i.e. the marker goes at 100 km/h over the 16.5 km
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(594)
    // the speed face shows the marker's speed already: only the pace walked is new
    expect(host.textContent).toContain('Vous avanciez à 2,0 km/h : 8 h 15 en mouvement, pauses et nuits retirées.')
    expect(host.textContent).not.toContain('Vitesse du marqueur dans le film')
    expect(host.textContent).not.toContain('24 h 33')
    act(() => root.unmount())
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
    expect(host.textContent).toContain('soit × 120 votre allure réelle')
    expect(host.textContent).toContain('2 h 00 en mouvement')
    act(() => root.unmount())
  })
})

describe('CameraPanel: « Mouvement » and « Hauteur »', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const camera = () => useAppStore.getState().settings.camera
  const motion = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Mouvement"] button')].find((b) => b.textContent === name)!
  const heightThumb = (host: HTMLElement) => host.querySelector('[data-testid="camera-height-name"]')!.closest('.field')!.querySelector<HTMLInputElement>('input')!

  it('each movement sets the style and nothing else', async () => {
    const { host, root } = await mount(timed, 60)
    const before = camera()
    for (const [name, style] of [['Balancer', 'sway'], ['Tourner autour', 'orbit'], ['Cinéma', 'cinematic'], ['Du dessus', 'top'], ['Libre', 'free'], ['Suivre', 'chase']] as const) {
      await act(async () => motion(host, name).click())
      expect(camera(), name).toEqual({ ...before, style })
    }
    // the sentence under it describes the one chosen
    expect(host.textContent).toContain('Derrière le marqueur, dans la direction du trajet.')
    act(() => root.unmount())
  })

  it('« Hauteur » names the stop, the default one first; a stop sets the distance and the tilt, nothing else', async () => {
    const { host, root } = await mount(timed, 60)
    expect(host.querySelector('[data-testid="camera-height-name"]')!.textContent).toBe('Proche')
    const before = camera()
    const thumb = heightThumb(host)
    // Home, then each arrow: the six stops from « Au ras » to « Satellite »
    const stops = [['Au ras', 0.5, 20], ['Proche', 1, 30], ['Hélicoptère', 1.3, 25], ['Drone haut', 1.8, 55], ['Avion', 3, 35], ['Satellite', 4, 85]] as const
    for (const [i, [name, distance, pitchDeg]] of stops.entries()) {
      await act(async () => {
        thumb.focus()
        thumb.dispatchEvent(new KeyboardEvent('keydown', { key: i === 0 ? 'Home' : 'ArrowRight', bubbles: true }))
      })
      expect(host.querySelector('[data-testid="camera-height-name"]')!.textContent, name).toBe(name)
      expect(camera(), name).toEqual({ ...before, distance, pitchDeg })
    }
    act(() => root.unmount())
  })

  it('a distance or tilt of its own reads « Personnalisé » and the slider changes nothing until moved', async () => {
    const { host, root } = await mount(timed, 60)
    await act(async () => useAppStore.getState().setSetting('camera', { ...camera(), distance: 1.11 }))
    expect(host.querySelector('[data-testid="camera-height-name"]')!.textContent).toBe('Personnalisé')
    expect(heightThumb(host).value).toBe('1')
    expect(camera().distance).toBe(1.11)
    act(() => root.unmount())
  })

  it('« Libre » has no height to choose (the keyframes decide)', async () => {
    const { host, root } = await mount(timed, 60)
    await act(async () => useAppStore.getState().setSetting('camera', { ...camera(), style: 'free' }))
    expect(host.querySelector('[data-testid="camera-height-name"]')).toBeNull()
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

describe('CameraPanel: « Durée et rythme »', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('no « Ralentir aux temps forts » (the stops and speeds of the timeline do that); « Garder la durée du survol » once there is a stop to squeeze', async () => {
    const { host, root } = await mount(timed, 60)
    expect(host.textContent).not.toContain('Ralentir aux temps forts')
    // no stop, no speed portion: the film lasts its duration either way
    await act(async () => useAppStore.getState().setSetting('film', { ...useAppStore.getState().settings.film, autoStops: false }))
    expect(host.textContent).not.toContain('Garder la durée du survol')
    await act(async () => useAppStore.getState().setSetting('film', addStop(useAppStore.getState().settings.film, 200).film))
    expect(host.textContent).toContain('Garder la durée du survol')
    act(() => root.unmount())
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
    expect([...list.querySelectorAll('p.font-semibold')].map((p) => p.textContent)).toEqual(['Reel 30 s', 'Résumé 1 min', 'Souvenir 3 min'])
    await act(async () => list.querySelector<HTMLButtonElement>('button[aria-label="Appliquer le gabarit « Résumé 1 min »"]')!.click())
    const { settings } = useAppStore.getState()
    expect(settings.flyoverDurationS + settings.film.opening.durationS + settings.film.closing.durationS).toBe(60)
    expect(document.querySelector('[data-testid="auto-film-templates"]')).toBeNull()
    act(() => root.unmount())
  })

  it('applies the card chosen after another one, not the one chosen at first', async () => {
    const { root } = await mount(timed, 60)
    const open = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Choisir un gabarit'))!
    await act(async () => open.click())
    const list = document.querySelector('[data-testid="auto-film-templates"]')!
    // only the card chosen carries « Appliquer »: the summary at first
    expect(list.querySelectorAll('button')).toHaveLength(1)
    await act(async () => list.querySelector<HTMLInputElement>('input[aria-label="Souvenir 3 min"]')!.click())
    expect(list.querySelector('button[aria-label="Appliquer le gabarit « Résumé 1 min »"]')).toBeNull()
    await act(async () => list.querySelector<HTMLButtonElement>('button[aria-label="Appliquer le gabarit « Souvenir 3 min »"]')!.click())
    const { settings } = useAppStore.getState()
    expect(settings.flyoverDurationS + settings.film.opening.durationS + settings.film.closing.durationS).toBe(180)
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

describe('« Film automatique » after an import', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    setAutoFilmOpen(false)
    useToastStore.setState({ toasts: [] })
  })
  const importSortie = () => runImport([{ label: 'sortie.gpx', run: async () => [timed] }])
  const success = () => useToastStore.getState().toasts.find((t) => t.text.includes('Sortie'))

  it('offers it in the message of the first import, and its action opens the dialog of the « Survol » tab', async () => {
    useAppStore.setState({ tracks: [], settings: DEFAULT_SETTINGS })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<CameraPanel />))
    await act(async () => importSortie())
    expect(success()?.action?.label).toBe('Film automatique…')
    expect(document.querySelector('[data-testid="auto-film-templates"]')).toBeNull()
    await act(async () => success()!.action!.run())
    expect(document.querySelector('[data-testid="auto-film-templates"]')).not.toBeNull()
    act(() => root.unmount())
  })

  it('opens nothing once the track is gone', async () => {
    useAppStore.setState({ tracks: [], settings: DEFAULT_SETTINGS })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<CameraPanel />))
    await act(async () => importSortie())
    const { action } = success()!
    await act(async () => useAppStore.setState({ tracks: [] }))
    await act(async () => action!.run())
    expect(document.querySelector('[data-testid="auto-film-templates"]')).toBeNull()
    act(() => root.unmount())
  })

  it('does not offer it when a track is added to a film', async () => {
    useAppStore.setState({ tracks: [untimed], settings: DEFAULT_SETTINGS })
    await act(async () => importSortie())
    expect(success()).toBeDefined()
    expect(success()?.action).toBeUndefined()
  })
})

describe('CameraPanel: the modes of the interface', () => {
  afterEach(() => {
    usePreferences.setState({ uiMode: 'expert' })
    useAppStore.setState({ tracks: [], settings: DEFAULT_SETTINGS })
    document.body.innerHTML = ''
  })

  it('shows « Mouvement », « Hauteur » and the duration in Débutant, the framing from Confirmé, the smoothings from Expert; a changed value stays', async () => {
    usePreferences.setState({ uiMode: 'debutant' })
    const { host, root } = await mount(timed, 60)
    const labels = () => [...host.querySelectorAll('[data-testid="setting-row-label"]')].map((el) => el.textContent)
    expect(labels()).toEqual([])
    expect(host.textContent).toContain('Cinéma')
    expect(host.querySelector('[data-testid="camera-height-name"]')).not.toBeNull()
    await act(async () => usePreferences.setState({ uiMode: 'confirme' }))
    expect(labels()).toEqual(expect.arrayContaining(['Distance', 'Inclinaison']))
    expect(labels()).not.toContain('Style')
    expect(labels()).not.toContain('Visée')
    await act(async () => usePreferences.setState({ uiMode: 'expert' }))
    expect(labels()).toContain('Visée')
    // back in Débutant: the distance changed by hand is still there, the others are not
    await act(async () => useAppStore.getState().setSetting('camera', { ...DEFAULT_SETTINGS.camera, distance: 2 }))
    await act(async () => usePreferences.setState({ uiMode: 'debutant' }))
    expect(labels()).toEqual(['Distance'])
    expect(useAppStore.getState().settings.camera.distance).toBe(2)
    act(() => root.unmount())
  })
})
