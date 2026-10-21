// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { filmSequenceOf } from '../flyover/sequence'
import { buildTrack } from '../import/stats'
import { getSettingsHistory } from '../project/history'
import { resetAppStore, useAppStore } from '../state/store'
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
    expect(host.querySelector('[data-testid="track-badge"]')).toBeNull()
    await act(async () => button('Calculer l’altitude')!.click())
    expect(vi.mocked(computeTrackElevation).mock.calls[0][1].id).toBe(useAppStore.getState().settings.terrainSourceId)
    expect(useAppStore.getState().tracks[0]).toBe(computed)
    expect(host.querySelector('[data-testid="track-badge"]')!.textContent).toBe('altitude calculée')
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

describe('TrackList, « Corriger les chiffres »', () => {
  afterEach(() => {
    useAppStore.getState().replaceTracks([])
    document.body.innerHTML = ''
  })

  /** types `text` in the field labelled `label`, as a keystroke would */
  function type(host: HTMLElement, label: string, text: string) {
    const field = [...host.querySelectorAll('label')].find((l) => l.textContent === label)!
    const input = host.querySelector<HTMLInputElement>(`#${CSS.escape(field.htmlFor)}`)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('writes the figures typed, keeps the others empty, shows the chip and goes back to the GPX', async () => {
    const recorded = { ...buildTrack({ name: 'Sommet', source: 'gpx', segments: [{ points: drawnTrack().segments[0].points.map((p) => ({ ...p, ele: 1992 })) }] }), color: '#ff5a36' }
    const { host, root, button } = await mount(recorded)
    const maxEle = [...host.querySelectorAll('label')].find((l) => l.textContent === 'Altitude max (m)')!
    expect(host.querySelector<HTMLInputElement>(`#${CSS.escape(maxEle.htmlFor)}`)!.placeholder).toBe('1992')
    await act(async () => type(host, 'Altitude max (m)', 'abc'))
    expect(button('Appliquer')!.disabled).toBe(true)
    await act(async () => type(host, 'Altitude max (m)', '2001'))
    await act(async () => type(host, 'Durée (h:mm)', '5:30'))
    await act(async () => button('Appliquer')!.click())
    expect(useAppStore.getState().tracks[0].statsOverride).toEqual({ maxEle: 2001, durationS: 19_800 })
    expect(host.querySelector('[data-testid="track-badge"]')!.textContent).toBe('chiffres corrigés')
    await act(async () => button('Revenir aux chiffres du GPX')!.click())
    expect(useAppStore.getState().tracks[0]).not.toHaveProperty('statsOverride')
    expect(host.querySelector('[data-testid="track-badge"]')).toBeNull()
    act(() => root.unmount())
  })
})

describe('TrackList, ordering the stages « À la suite »', () => {
  /** a short northward track recorded on `day` of July 2026 */
  const day = (name: string, n: number, d: number): Track => ({
    ...buildTrack({
      name,
      source: 'gpx',
      segments: [{ points: Array.from({ length: n }, (_, i) => ({ lon: 6.86, lat: 45.9 + i * 0.001, ele: 1000, time: Date.UTC(2026, 6, d, 8) + i * 60_000 })) }],
    }),
    color: '#ff5a36',
  })
  const tracks = [day('Jour 2', 5, 2), day('Jour 3', 6, 3), day('Jour 1', 7, 1)]
  const stageNames = () => {
    const { tracks: list, settings } = useAppStore.getState()
    return filmSequenceOf(list, settings.race)!.stages.map((s) => s.track.name)
  }
  const shownNames = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="track-name"]')].map((n) => n.textContent)
  const handle = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Déplacer la trace ${name}"]`)!
  const pointer = (type: string, init: { clientY?: number; pointerType?: string }) =>
    Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: init.clientY ?? 0 }), {
      pointerId: 1,
      isPrimary: true,
      pointerType: init.pointerType ?? 'mouse',
    })

  async function mountSequence() {
    resetAppStore()
    useAppStore.getState().replaceTracks(tracks)
    useAppStore.getState().setSetting('race', { ...useAppStore.getState().settings.race, sequence: true })
    getSettingsHistory().clear()
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TrackList />))
    // one card is 100 px high, the first at the top of the page
    host.querySelectorAll<HTMLElement>('[data-testid="track-card"]').forEach((li, i) => {
      li.getBoundingClientRect = () => ({ top: i * 100, height: 100, bottom: i * 100 + 100, left: 0, right: 300, width: 300, x: 0, y: i * 100, toJSON: () => ({}) })
    })
    return { host, root }
  }

  afterEach(() => {
    vi.useRealTimers()
    resetAppStore()
    document.body.innerHTML = ''
  })

  it('shows the cards in the order of the stages, with a handle each, only « À la suite »', async () => {
    const { host, root } = await mountSequence()
    expect(host.querySelectorAll('button[aria-label^="Déplacer la trace"]')).toHaveLength(3)
    await act(async () => useAppStore.getState().setSetting('race', { ...useAppStore.getState().settings.race, order: [tracks[2].id, tracks[0].id, tracks[1].id] }))
    expect(shownNames(host)).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
    await act(async () => useAppStore.getState().setSetting('race', { ...useAppStore.getState().settings.race, sequence: false }))
    expect(shownNames(host)).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
    expect(host.querySelector('button[aria-label^="Déplacer la trace"]')).toBeNull()
    act(() => root.unmount())
  })

  it('Alt + ↓ / ↑ moves a stage one place, says so, and keeps the focus on its handle', async () => {
    const { host, root } = await mountSequence()
    const first = handle(host, 'Jour 2')
    first.focus()
    await act(async () => void first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })))
    expect(stageNames()).toEqual(['Jour 3', 'Jour 2', 'Jour 1'])
    expect(shownNames(host)).toEqual(['Jour 3', 'Jour 2', 'Jour 1'])
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Trace « Jour 2 » déplacée en position 2 sur 3')
    expect(document.activeElement).toBe(handle(host, 'Jour 2'))
    await act(async () => void handle(host, 'Jour 2').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true })))
    expect(stageNames()).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
    // a plain arrow does nothing, and the first stage cannot go up
    await act(async () => void handle(host, 'Jour 2').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true })))
    await act(async () => void handle(host, 'Jour 2').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
    expect(stageNames()).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
    act(() => root.unmount())
  })

  it('« Ordonner par date » sorts the stages by departure, once (then it is disabled), in one undo step', async () => {
    const { host, root } = await mountSequence()
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Ordonner par date')!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(shownNames(host)).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
    expect(stageNames()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
    expect(button.disabled).toBe(true)
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Étapes ordonnées par date de départ')
    await act(async () => getSettingsHistory().undo())
    expect(shownNames(host)).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
    expect(getSettingsHistory().getState().canUndo).toBe(false)
    act(() => root.unmount())
  })

  it('the ▲ button still moves a stage up', async () => {
    const { host, root } = await mountSequence()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Monter la trace Jour 1 d’une étape"]')!.click())
    expect(stageNames()).toEqual(['Jour 2', 'Jour 1', 'Jour 3'])
    act(() => root.unmount())
  })

  it('a mouse drag by the handle shows where the card lands and drops it there', async () => {
    const { host, root } = await mountSequence()
    const grip = handle(host, 'Jour 2')
    await act(async () => void grip.dispatchEvent(pointer('pointerdown', { clientY: 50 })))
    // under the slop: nothing lifted yet
    await act(async () => void grip.dispatchEvent(pointer('pointermove', { clientY: 52 })))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).toBeNull()
    // past the centre of the 2nd card (150) and the 3rd (250): last place
    await act(async () => void grip.dispatchEvent(pointer('pointermove', { clientY: 260 })))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')!.textContent).toContain('Jour 2')
    expect(host.querySelector('[data-testid="track-card"][data-drop="after"]')!.textContent).toContain('Jour 1')
    await act(async () => void grip.dispatchEvent(pointer('pointerup', { clientY: 260 })))
    expect(stageNames()).toEqual(['Jour 3', 'Jour 1', 'Jour 2'])
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).toBeNull()
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Trace « Jour 2 » déplacée en position 3 sur 3')
    act(() => root.unmount())
  })

  it('Escape drops a lifted card where it was', async () => {
    const { host, root } = await mountSequence()
    const grip = handle(host, 'Jour 2')
    await act(async () => void grip.dispatchEvent(pointer('pointerdown', { clientY: 50 })))
    await act(async () => void grip.dispatchEvent(pointer('pointermove', { clientY: 260 })))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).not.toBeNull()
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).toBeNull()
    await act(async () => void grip.dispatchEvent(pointer('pointerup', { clientY: 260 })))
    expect(stageNames()).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
    act(() => root.unmount())
  })

  it('touch: the card lifts after a 350 ms press, a slide before that does not lift it', async () => {
    vi.useFakeTimers()
    const { host, root } = await mountSequence()
    const grip = handle(host, 'Jour 2')
    // a slide: the panel scrolls, nothing is lifted
    await act(async () => void grip.dispatchEvent(pointer('pointerdown', { clientY: 50, pointerType: 'touch' })))
    await act(async () => void grip.dispatchEvent(pointer('pointermove', { clientY: 80, pointerType: 'touch' })))
    await act(async () => void vi.advanceTimersByTime(400))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).toBeNull()
    await act(async () => void grip.dispatchEvent(pointer('pointerup', { clientY: 80, pointerType: 'touch' })))
    expect(stageNames()).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
    // a press held: lifted, then moved
    await act(async () => void grip.dispatchEvent(pointer('pointerdown', { clientY: 50, pointerType: 'touch' })))
    await act(async () => void vi.advanceTimersByTime(349))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).toBeNull()
    await act(async () => void vi.advanceTimersByTime(2))
    expect(host.querySelector('[data-testid="track-card"][data-lifted]')).not.toBeNull()
    await act(async () => void grip.dispatchEvent(pointer('pointermove', { clientY: 160, pointerType: 'touch' })))
    await act(async () => void grip.dispatchEvent(pointer('pointerup', { clientY: 160, pointerType: 'touch' })))
    expect(stageNames()).toEqual(['Jour 3', 'Jour 2', 'Jour 1'])
    act(() => root.unmount())
  })
})

describe('TrackList, « Plusieurs traces »', () => {
  afterEach(() => {
    resetAppStore()
    document.body.innerHTML = ''
  })

  it('is a radio group of three modes, and « À la suite » shows the stage card switch', async () => {
    resetAppStore()
    useAppStore.getState().replaceTracks([drawnTrack(), { ...drawnTrack(), id: 'other', name: 'Autre' }])
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TrackList />))
    const group = host.querySelector('[role="radiogroup"][aria-labelledby]')!
    expect(group.getAttribute('aria-describedby')).toBeTruthy()
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((r) => [r.labels?.[0]?.textContent, r.checked])).toEqual([
      ['La première', true],
      ['À la suite', false],
      ['En parallèle', false],
    ])
    expect(host.querySelector('input[role="switch"]')).toBeNull()
    await act(async () => radios[1].click())
    expect(useAppStore.getState().settings.race.sequence).toBe(true)
    const card = host.querySelector<HTMLInputElement>('input[role="switch"]')!
    expect(card.labels?.[0]?.textContent).toBe('Carton au début de chaque étape')
    const before = card.checked
    await act(async () => card.click())
    expect(host.querySelector<HTMLInputElement>('input[role="switch"]')!.checked).toBe(!before)
    act(() => root.unmount())
  })
})
