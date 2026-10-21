// @vitest-environment jsdom
import { Profiler, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useExportStore } from '../export/store'
import { buildTrack } from '../import/stats'
import { END_CARD_ID, TITLE_CARD_ID } from '../film/cards'
import { filmClockFor } from '../film/clock'
import { DEFAULT_DAY_CARDS, DEFAULT_FILM } from '../film/model'
import { addCameraKey, addMarkerKey, addParamKey, removeFilmItem, updateMarkerKey } from '../film/timeline'
import { filmSequenceOf } from '../flyover/sequence'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import { addMarkerKeyHere, addParamKeyHere, getFilmSource } from '../scene/usePacing'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { FilmInspector } from './FilmInspector'
import { OverlayPanel } from './OverlayPanel'
import { setPreferences } from './preferences'
import { Timeline } from './Timeline'

describe('Timeline', () => {
  it('does not render again when the export moves the playhead, and follows it again afterwards', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    let commits = 0
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <Profiler id="timeline" onRender={() => commits++}>
          <Timeline />
        </Profiler>,
      ),
    )
    const time = () => host.querySelector('[data-testid="timeline-time"]')?.textContent
    const start = time()
    expect(start).toMatch(/^\d\d:\d\d,\d$/)

    await act(async () => useExportStore.setState({ phase: 'rendering' }))
    const before = commits
    for (const p of [0.2, 0.4, 0.6]) await act(async () => useAppStore.getState().setProgress(p))
    expect(commits).toBe(before)
    expect(time()).toBe(start)

    await act(async () => useExportStore.setState({ phase: 'done' }))
    expect(time()).not.toBe(start)
    act(() => root.unmount())
  })

  it('has a lane only for what has a key: none for the settings by default, one per keyed parameter, « Marqueur » with marker keys', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    useExportStore.setState({ phase: 'idle' })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<Timeline />))
    const lanes = () => Array.from(host.querySelectorAll('[data-testid="timeline-lane"]')).map((l) => l.getAttribute('aria-label'))
    const groups = () => Array.from(host.querySelectorAll('[data-testid="timeline-heads"] [role="group"]')).map((g) => g.getAttribute('aria-label'))
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    // the camera and speed keys have their ◀ ◇ ▶ in their lane header, with the names they had in the bar
    expect(groups()).toEqual(['Images clés', 'Clés : Vitesse'])
    const names = (label: string) => Array.from(host.querySelectorAll(`[role="group"][aria-label="${label}"] button`)).map((b) => b.getAttribute('aria-label'))
    expect(names('Images clés')).toEqual(['Image clé précédente', 'Ajouter une image clé', 'Image clé suivante'])
    expect(host.querySelector('[data-testid="timeline-bar"] [aria-label="Ajouter un réglage"]')).toBeNull()
    expect(host.querySelector('[data-testid="timeline-bar"] [aria-label="Ajouter un changement de marqueur"]')).toBeNull()

    // a speed key stays on the « Vitesse » lane
    const add = host.querySelector<HTMLButtonElement>('[aria-label="Vitesse : ajouter une clé"]')
    await act(async () => add?.click())
    expect(useAppStore.getState().settings.film.paramKeys).toMatchObject([{ param: 'speed', value: 1 }])
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    expect(host.querySelectorAll('[role="group"][aria-label="Vitesse"]  [data-testid="timeline-key"]')).toHaveLength(1)

    // a keyed parameter gets a lane of its own, which goes with its last key
    await act(async () => addParamKeyHere('exposure'))
    await act(async () => addParamKeyHere('warmth'))
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Exposition', 'Température', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    expect(host.querySelectorAll('[role="group"][aria-label="Exposition"]  [data-testid="timeline-key"]')).toHaveLength(1)
    const exposure = useAppStore.getState().settings.film.paramKeys.find((k) => k.param === 'exposure')!
    await act(async () => useAppStore.getState().setSetting('film', removeFilmItem(useAppStore.getState().settings.film, exposure.id)))
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Température', 'Arrêts', 'Textes', 'Médias', 'Musique'])

    await act(async () => addMarkerKeyHere())
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Température', 'Marqueur', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    expect(host.querySelectorAll('[role="group"][aria-label="Marqueur"] [data-testid="timeline-key"]')).toHaveLength(1)
    expect(lanes()).not.toContain('Réglages')

    // the dot shows the colour of the marker from that key on, and its title lists the look
    const dot = () => host.querySelector<HTMLElement>('[role="group"][aria-label="Marqueur"] [data-testid="timeline-key"]')!
    expect(dot().style.getPropertyValue('--key-color')).toBe('#FFFFFF')
    expect(dot().title).toContain('couleur #FFFFFF, taille ×1')
    const marker = useAppStore.getState().settings.film.markerKeys[0]
    await act(async () =>
      useAppStore.getState().setSetting('film', updateMarkerKey(useAppStore.getState().settings.film, marker.id, { color: '#FF0000', size: 1.5 })),
    )
    expect(dot().style.getPropertyValue('--key-color')).toBe('#FF0000')
    expect(dot().getAttribute('aria-label')).toContain('couleur #FF0000, taille ×1,5')
    act(() => root.unmount())
  })

  it('shows the colours and size of a selected marker key in the inspector, with what stays the panel\'s', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <>
          <Timeline />
          <FilmInspector />
        </>,
      ),
    )
    await act(async () => useAppStore.getState().setSetting('film', DEFAULT_FILM))
    await act(async () => addMarkerKeyHere())
    const keys = () => useAppStore.getState().settings.film.markerKeys
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)!
    // the colour is read in the panel its button opens
    const colour = async () => {
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Couleur"]')!.click())
      const value = document.querySelector<HTMLInputElement>('input[aria-label="Code couleur (hexadécimal)"]')!.value
      await act(async () => void document.querySelector('[role="dialog"][aria-label="Couleur"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      return value.toLowerCase()
    }
    // a new key follows the panel's colours and size until it is given its own
    expect(keys()[0].color).toBeUndefined()
    expect(keys()[0].size).toBeUndefined()
    expect(await colour()).toBe('#ffffff')
    expect(host.textContent).toContain('Restent ceux du panneau : étiquette (aucune), tige (non)')
    expect(button('Reprendre l’aspect du panneau Trace').disabled).toBe(true)

    // « Celle de la trace » stores '' (the track's colour), the reset goes back to the panel's values
    await act(async () => button('Celle de la trace').click())
    expect(keys()[0].color).toBe('')
    expect(button('Celle de la trace').disabled).toBe(true)
    await act(async () => button('Reprendre l’aspect du panneau Trace').click())
    expect(keys()[0].color).toBeUndefined()
    expect(keys()[0].size).toBeUndefined()
    expect(button('Reprendre l’aspect du panneau Trace').disabled).toBe(true)
    act(() => root.unmount())
  })

  describe('opening title and closing card', () => {
    const setup = async () => {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      globalThis.ResizeObserver ??= class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver
      const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
      useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })], filmSelection: null })
      useExportStore.setState({ phase: 'idle' })
      const setOverlay = (patch: Partial<typeof DEFAULT_OVERLAY>) =>
        useAppStore.getState().setSetting('overlay', { ...useAppStore.getState().settings.overlay, ...patch })
      await act(async () => useAppStore.getState().setSetting('overlay', DEFAULT_OVERLAY))
      const host = document.body.appendChild(document.createElement('div'))
      const root = createRoot(host)
      await act(async () =>
        root.render(
          <>
            <Timeline />
            <FilmInspector />
          </>,
        ),
      )
      const cards = () =>
        Array.from(host.querySelectorAll<HTMLElement>('[role="group"][aria-label="Textes"] [data-item^="card-"]')).map((b) => b.getAttribute('aria-label')?.split(',')[0])
      const card = (label: string) => host.querySelector<HTMLElement>(`[role="group"][aria-label="Textes"] [aria-label^="${label}"]`)!
      const press = (el: HTMLElement, key: string) =>
        act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
      return { host, root, setOverlay, cards, card, press }
    }

    it('a multi-day track with « Cartes de jour » shows a block per day in « Textes », opening the shared day card panel', async () => {
      const { host, root } = await setup()
      const ride = (fromH: number, toH: number, lon0: number) =>
        Array.from({ length: (toH - fromH) * 2 + 1 }, (_, k) => ({ lon: lon0 + k / 77.35, lat: 45.92, time: Date.UTC(2026, 5, 1) + (fromH + k / 2) * 3_600_000 }))
      const day1 = ride(8, 18, 6.8)
      const days = { ...buildTrack({ name: 'Deux jours', source: 'gpx', segments: [{ points: day1 }, { points: ride(30, 34, day1[day1.length - 1].lon) }] }), utcOffsetMin: 120 }
      await act(async () => useAppStore.setState({ tracks: [days] }))
      await act(async () => useAppStore.getState().setSetting('film', { ...DEFAULT_FILM, autoStops: false, dayCards: { ...DEFAULT_DAY_CARDS, enabled: true } }))
      const blocks = () => [...host.querySelectorAll<HTMLElement>('[role="group"][aria-label="Textes"] [data-item^="card-day-"]')]
      expect(blocks().map((b) => b.getAttribute('aria-label')?.split(',')[0])).toEqual(['Carte : Jour 1', 'Carte : Jour 2'])
      await act(async () => useAppStore.getState().setFilmSelection(blocks()[1].getAttribute('data-item')!))
      const inspector = host.querySelector('[data-testid="film-inspector"]')!
      expect(inspector.querySelector('h2')?.textContent).toBe('Carte du jour 2')
      expect(inspector.textContent).toContain('Vue haute pendant la nuit')
      act(() => root.unmount())
    })

    it('the « Vitesse » lane shows the automatic slow-downs of « Ralentir aux temps forts », not as blocks to edit', async () => {
      const { host, root } = await setup()
      // a 6 km climb of 600 m then the same back down: one climb top
      const points = Array.from({ length: 121 }, (_, i) => ({ lon: 6.8 + i * 0.001, lat: 45.9, ele: 1000 + 600 * (1 - Math.abs(i - 60) / 60) }))
      await act(async () => useAppStore.setState({ tracks: [buildTrack({ name: 'Col', source: 'gpx', segments: [{ points }] })] }))
      const bands = () => host.querySelectorAll('[data-lane="param:speed"] [data-testid="timeline-auto-slow"]')
      expect(bands()).toHaveLength(0)
      await act(async () => useAppStore.getState().setSetting('pacing', { ...useAppStore.getState().settings.pacing, enabled: true, landmarks: false }))
      expect(bands().length).toBeGreaterThan(0)
      expect(bands()[0].getAttribute('aria-label')).toContain('Ralentissement automatique ×0,35')
      act(() => root.unmount())
    })

    it('are blocks of the « Textes » lane only while the overlay and the card are on, and keep the « Plans » shots', async () => {
      const { host, root, setOverlay, cards } = await setup()
      expect(cards()).toEqual([])
      await act(async () => setOverlay({ enabled: true }))
      expect(cards()).toEqual(["Titre d'ouverture", 'Carte de clôture'])
      // the shots of the « Plans » lane are untouched
      expect(host.querySelector('[role="group"][aria-label="Plans"] [aria-label^="Ouverture"]')).not.toBeNull()
      await act(async () => setOverlay({ end: { ...DEFAULT_OVERLAY.end, enabled: false } }))
      expect(cards()).toEqual(["Titre d'ouverture"])
      await act(async () => setOverlay({ enabled: false }))
      expect(cards()).toEqual([])
      act(() => root.unmount())
    })

    it('select with the focus, move whole with the arrows and are deleted by switching the card off', async () => {
      const { root, setOverlay, cards, card, press } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      const title = card("Titre d'ouverture")
      await act(async () => title.focus())
      expect(useAppStore.getState().filmSelection).toBe(TITLE_CARD_ID)
      // the arrows place the card: from a window of the first frame to the end of the card
      const before = useAppStore.getState().settings.overlay.title.window
      expect(before).toBeUndefined()
      await press(title, 'ArrowRight')
      const moved = useAppStore.getState().settings.overlay.title.window
      expect(moved?.startS).toBeGreaterThan(0)
      await press(card("Titre d'ouverture"), 'ArrowLeft')
      expect(useAppStore.getState().settings.overlay.title.window?.startS ?? 0).toBeCloseTo(0, 2)

      const closing = card('Carte de clôture')
      await act(async () => closing.focus())
      expect(useAppStore.getState().filmSelection).toBe(END_CARD_ID)
      await press(closing, 'ArrowLeft')
      const closingWindow = useAppStore.getState().settings.overlay.end.window
      expect(closingWindow).toBeDefined()

      await press(card('Carte de clôture'), 'Delete')
      expect(useAppStore.getState().settings.overlay.end).toMatchObject({ enabled: false, start: expect.any(Number) })
      expect(useAppStore.getState().filmSelection).toBeNull()
      expect(cards()).toEqual(["Titre d'ouverture"])
      // the block goes with the card, not with its settings: switched back on, it comes back where it was
      await act(async () => setOverlay({ end: { ...useAppStore.getState().settings.overlay.end, enabled: true } }))
      expect(cards()).toEqual(["Titre d'ouverture", 'Carte de clôture'])
      expect(useAppStore.getState().settings.overlay.end.window).toEqual(closingWindow)
      act(() => root.unmount())
    })

    it('drag from their body: the card is placed, the shots and the other settings stay', async () => {
      HTMLElement.prototype.setPointerCapture ??= () => {}
      const { root, setOverlay, card } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      const pointer = (type: string, clientX: number) =>
        Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }), { pointerId: 1, isPrimary: true, pointerType: 'mouse' })
      const opening = useAppStore.getState().settings.film.opening.durationS
      const titleEnd = useAppStore.getState().settings.overlay.title.end
      const title = card("Titre d'ouverture")
      await act(async () => void title.dispatchEvent(pointer('pointerdown', 10)))
      await act(async () => void title.dispatchEvent(pointer('pointermove', 200)))
      await act(async () => void title.dispatchEvent(pointer('pointerup', 200)))
      const { title: placed } = useAppStore.getState().settings.overlay
      expect(placed.window?.startS).toBeGreaterThan(0)
      // the shot, the old fraction and the selection are not touched by the drag
      expect(useAppStore.getState().settings.film.opening.durationS).toBe(opening)
      expect(placed.end).toBe(titleEnd)
      expect(useAppStore.getState().filmSelection).toBe(TITLE_CARD_ID)
      act(() => root.unmount())
    })

    it('the work area shows as a band with its two ends on the ruler, and a button clears it', async () => {
      const { host, root } = await setup()
      expect(host.querySelector('[data-testid="work-area-in"]')).toBeNull()
      await act(async () => useAppStore.getState().setWorkArea({ inS: 0.5, outS: 1.5 }))
      expect(host.querySelector('[data-testid="work-area-in"]')).not.toBeNull()
      expect(host.querySelector('[data-testid="work-area-out"]')).not.toBeNull()
      const clear = host.querySelector<HTMLElement>('[aria-label="Retirer la zone de lecture"]')
      expect(clear).not.toBeNull()
      await act(async () => clear!.click())
      expect(useAppStore.getState().workArea).toBeNull()
      expect(host.querySelector('[data-testid="work-area-in"]')).toBeNull()
      act(() => root.unmount())
    })

    it('a lane folds to a strip and locks against edits, each from the buttons of its head, and the choice is kept for the device', async () => {
      localStorage.removeItem('openflyover.lanes.v1')
      const { host, root } = await setup()
      const lane = () => host.querySelector<HTMLElement>('[role="group"][aria-label="Textes"]')!
      const tool = (label: string) => host.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
      expect(lane().hasAttribute('inert')).toBe(false)
      await act(async () => tool('Verrouiller la piste « Textes » (ses blocs ne bougent plus)')!.click())
      expect(lane().hasAttribute('inert')).toBe(true)
      expect(lane().className).toContain('h-7')
      expect(tool('Déverrouiller la piste « Textes »')!.getAttribute('aria-pressed')).toBe('true')
      await act(async () => tool('Replier la piste « Textes »')!.click())
      expect(lane().className).toContain('h-4')
      expect(lane().className).not.toContain('h-7')
      // folded, the lock button is gone and the unfold button says so
      expect(tool('Déverrouiller la piste « Textes »')).toBeNull()
      expect(JSON.parse(localStorage.getItem('openflyover.lanes.v1')!)).toEqual({ folded: ['texts'], locked: ['texts'] })
      await act(async () => tool('Déplier la piste « Textes »')!.click())
      await act(async () => tool('Déverrouiller la piste « Textes »')!.click())
      expect(lane().hasAttribute('inert')).toBe(false)
      expect(JSON.parse(localStorage.getItem('openflyover.lanes.v1')!)).toEqual({ folded: [], locked: [] })
      // the other lanes are not touched, the blocks stay in the page when a lane is folded
      expect(host.querySelectorAll('[data-testid="timeline-lane"]').length).toBeGreaterThan(5)
      act(() => root.unmount())
    })

    it('the timecode of the bar counts frames when asked, and the button to zoom to the selection is there and harmless', async () => {
      const { host, root } = await setup()
      const time = () => host.querySelector('[data-testid="timeline-time"]')!.textContent
      expect(time()).toMatch(/^\d\d:\d\d\.\d$|^\d\d:\d\d,\d$|^\d+:\d\d[.,]\d$/)
      await act(async () => setPreferences({ timelineFrames: true }))
      expect(time()).toMatch(/^\d\d:\d\d:\d\d$/)
      await act(async () => setPreferences({ timelineFrames: false }))
      const zoom = host.querySelector<HTMLElement>('button[aria-label="Zoomer sur la sélection"]')
      expect(zoom).not.toBeNull()
      // nothing selected, no work area: the whole film in the view, as « Ajuster »
      await act(async () => zoom!.click())
      expect(host.querySelector('[data-testid="timeline-time"]')).not.toBeNull()
      act(() => root.unmount())
    })

    it('Ctrl + click picks texts together, one drag moves them all, Shift + Delete removes them and closes the gaps', async () => {
      HTMLElement.prototype.setPointerCapture ??= () => {}
      const { host, root } = await setup()
      const texts = [
        { id: 'text-1', startS: 1, durationS: 1, text: 'Un', anchor: 'bottom-center' as const, size: 1 },
        { id: 'text-2', startS: 3, durationS: 1, text: 'Deux', anchor: 'bottom-center' as const, size: 1 },
        { id: 'text-3', startS: 6, durationS: 1, text: 'Trois', anchor: 'bottom-center' as const, size: 1 },
      ]
      await act(async () => useAppStore.getState().setSetting('film', { ...useAppStore.getState().settings.film, texts }))
      const block = (id: string) => host.querySelector<HTMLElement>(`[data-item="${id}"]`)!
      const pointer = (type: string, init: Record<string, unknown> = {}) =>
        Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }), { pointerId: 1, isPrimary: true, pointerType: 'mouse' })
      // Ctrl + click: the first alone is selected, the second joins it
      await act(async () => void block('text-1').dispatchEvent(pointer('pointerdown', { ctrlKey: true })))
      await act(async () => void block('text-1').dispatchEvent(pointer('pointerup', { ctrlKey: true })))
      expect(useAppStore.getState().filmSelection).toBe('text-1')
      await act(async () => void block('text-2').dispatchEvent(pointer('pointerdown', { ctrlKey: true })))
      await act(async () => void block('text-2').dispatchEvent(pointer('pointerup', { ctrlKey: true })))
      expect(useAppStore.getState().filmKeys).toEqual(['text-1', 'text-2'])
      expect(block('text-1').getAttribute('aria-pressed')).toBe('true')
      expect(block('text-2').getAttribute('aria-pressed')).toBe('true')
      expect(block('text-3').getAttribute('aria-pressed')).toBe('false')
      // Ctrl + click on a picked one takes it out
      await act(async () => void block('text-2').dispatchEvent(pointer('pointerdown', { ctrlKey: true })))
      await act(async () => void block('text-2').dispatchEvent(pointer('pointerup', { ctrlKey: true })))
      expect(useAppStore.getState().filmKeys).toEqual([])
      expect(useAppStore.getState().filmSelection).toBe('text-1')
      // two picked again, then Shift + Delete on one: both go and the third comes back by their lengths
      await act(async () => useAppStore.getState().setFilmKeys(['text-1', 'text-2']))
      await act(async () => void block('text-1').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', shiftKey: true, bubbles: true, cancelable: true })))
      const left = useAppStore.getState().settings.film.texts
      expect(left.map((t) => [t.id, t.startS])).toEqual([['text-3', 4]])
      expect(useAppStore.getState().filmKeys).toEqual([])
      act(() => root.unmount())
    })

    it('have a right-click menu of their own: « Supprimer » on a block, « Ajouter une image clé ici » on a lane, never the browser menu', async () => {
      HTMLElement.prototype.setPointerCapture ??= () => {}
      const { host, root, setOverlay, card } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      const rightClick = async (el: Element) => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 10 })
        await act(async () => void el.dispatchEvent(event))
        return event
      }
      const menuItems = () => Array.from(document.querySelectorAll('[role="menuitem"]'))

      // on a block: the browser menu is replaced by the deletion of the block (here the card, switched off)
      const blocked = await rightClick(card("Titre d'ouverture"))
      expect(blocked.defaultPrevented).toBe(true)
      expect(menuItems().map((i) => i.textContent)).toEqual(['Supprimer'])
      await act(async () => (menuItems()[0] as HTMLElement).click())
      expect(useAppStore.getState().settings.overlay.title.enabled).toBe(false)

      // on the empty part of a lane that holds keys: a key added there
      const speedLane = host.querySelector('[data-lane="param:speed"]')!
      expect(useAppStore.getState().settings.film.paramKeys.filter((k) => k.param === 'speed')).toHaveLength(0)
      const lane = await rightClick(speedLane)
      expect(lane.defaultPrevented).toBe(true)
      expect(menuItems().map((i) => i.textContent)).toEqual(['Ajouter une image clé ici'])
      await act(async () => (menuItems()[0] as HTMLElement).click())
      expect(useAppStore.getState().settings.film.paramKeys.filter((k) => k.param === 'speed')).toHaveLength(1)

      // a lane without keys (the texts): nothing to offer, and still not the browser menu
      const none = await rightClick(host.querySelector('[role="group"][aria-label="Textes"]')!)
      expect(none.defaultPrevented).toBe(true)
      expect(menuItems()).toHaveLength(0)
      act(() => root.unmount())
    })

    it('open the inspector of the start or end of the film, which edits the overlay settings and deletes by switching the card off', async () => {
      const { host, root, setOverlay } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      await act(async () => useAppStore.getState().setFilmSelection(TITLE_CARD_ID))
      const inspector = host.querySelector('[data-testid="film-inspector"]')!
      expect(inspector.querySelector('h2')?.textContent).toBe('Ouverture')
      const field = Array.from(inspector.querySelectorAll<HTMLInputElement>('input[type="text"]')).find((i) => i.labels?.[0]?.textContent === 'Titre')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Col du Galibier')
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(useAppStore.getState().settings.overlay.title.title).toBe('Col du Galibier')
      // the opening card has no figures until one is ticked
      const figure = (label: string) =>
        Array.from(inspector.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((i) => i.closest('label')?.textContent === label)!
      await act(async () => figure('Distance').click())
      expect(useAppStore.getState().settings.overlay.title.figures).toEqual(['distance'])
      // the position, the size and the colours of the card are in the inspector too
      expect(inspector.textContent).toContain('Position')
      expect(inspector.textContent).toContain('Taille')
      expect(inspector.textContent).toContain('Couleurs et polices')

      // the camera shot of the opening is in the same inspector, and its block opens the same one
      expect(inspector.textContent).toContain('Plan de caméra')
      await act(async () => useAppStore.getState().setFilmSelection('opening'))
      expect(Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="film-inspector"] input[type="text"]')).some((i) => i.value === 'Col du Galibier')).toBe(true)

      await act(async () => useAppStore.getState().setFilmSelection(END_CARD_ID))
      expect(host.querySelector('[data-testid="film-inspector"] h2')?.textContent).toBe('Clôture')
      expect(host.querySelector('[data-testid="film-inspector"]')?.textContent).toContain('Générique')
      // what the closing card shows: a figure chip and the profile
      const box = (label: string) =>
        Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="film-inspector"] input[type="checkbox"]')).find((i) => i.closest('label')?.textContent === label)!
      await act(async () => box('Dénivelé −').click())
      expect(useAppStore.getState().settings.overlay.end.figures).toEqual(['distance', 'ascent', 'descent', 'maxAltitude', 'time', 'maxSpeed'])
      await act(async () => box('Profil d’altitude').click())
      expect(useAppStore.getState().settings.overlay.end.showProfile).toBe(true)

      const remove = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="film-inspector"] button')).find((b) => b.textContent === 'Retirer : Carte de clôture')!
      await act(async () => remove.click())
      expect(useAppStore.getState().settings.overlay.end.enabled).toBe(false)
      expect(useAppStore.getState().filmSelection).toBeNull()
      expect(host.querySelector('[data-testid="film-inspector"]')).toBeNull()
      act(() => root.unmount())
    })

    it('keep only their switch, a hint and « Modifier » in the Habillage panel', async () => {
      const { host, root, setOverlay } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      const panel = document.body.appendChild(document.createElement('div'))
      const panelRoot = createRoot(panel)
      await act(async () => panelRoot.render(<OverlayPanel />))
      const groups = Array.from(panel.querySelectorAll<HTMLElement>('[role="group"]')).filter((g) => /Titre d'ouverture|Carte de clôture/.test(g.textContent ?? ''))
      expect(groups).toHaveLength(2)
      for (const g of groups) {
        expect(g.textContent).toContain('Texte, durée et style : bouton « Modifier », ou le bloc dans la timeline.')
        // no field left: the switch and the button
        expect(g.querySelectorAll('input, textarea, select, button')).toHaveLength(2)
      }
      const edit = panel.querySelector<HTMLButtonElement>('button[aria-label="Modifier : Carte de clôture"]')!
      await act(async () => edit.click())
      expect(useAppStore.getState().filmSelection).toBe(END_CARD_ID)
      expect(host.querySelector('[data-testid="film-inspector"] h2')?.textContent).toBe('Clôture')
      // switched off: no « Modifier »
      await act(async () => setOverlay({ end: { ...useAppStore.getState().settings.overlay.end, enabled: false } }))
      expect(panel.querySelector('button[aria-label="Modifier : Carte de clôture"]')).toBeNull()
      act(() => panelRoot.unmount())
      act(() => root.unmount())
    })
  })
})

describe('Timeline — stages « À la suite »', () => {
  const setup = async (stages: number, sequence = true) => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    const tracks = Array.from({ length: stages }, (_, k) =>
      buildTrack({
        name: `Jour ${k + 1}`,
        source: 'gpx',
        segments: [{ points: [0, 1, 2, 3].map((i) => ({ lon: 6.8 + i * 0.01, lat: 45.9 + k * 0.1, ele: 1000 + i * 10 })) }],
      }),
    )
    useExportStore.setState({ phase: 'idle' })
    useAppStore.setState({ tracks, filmSelection: null })
    const { settings, setSetting } = useAppStore.getState()
    await act(async () => setSetting('film', DEFAULT_FILM))
    await act(async () => setSetting('race', { ...settings.race, enabled: false, sequence }))
    await act(async () => setSetting('overlay', { ...DEFAULT_OVERLAY, enabled: false }))
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <>
          <Timeline />
          <FilmInspector />
        </>,
      ),
    )
    const lane = (name: string) => host.querySelector(`[role="group"][aria-label="${name}"]`)
    const blocks = (name: string, selector: string) => Array.from(lane(name)?.querySelectorAll<HTMLElement>(selector) ?? [])
    const press = (el: HTMLElement, key: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
    return { host, root, tracks, lane, blocks, press }
  }

  it('an « Étapes » lane above « Plans »: a block per stage and a block per junction between them', async () => {
    const { host, root, lane, blocks } = await setup(3)
    expect(Array.from(host.querySelectorAll('[data-testid="timeline-lane"]')).map((l) => l.getAttribute('aria-label'))[0]).toBe('Étapes')
    expect(Array.from(host.querySelectorAll('[data-testid="timeline-head"]')).map((h) => h.textContent)[1]).toBe('Étapes')
    expect(blocks('Étapes', '[data-item^="stage-"]').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual(['Étape 1 : Jour 1', 'Étape 2 : Jour 2', 'Étape 3 : Jour 3'])
    expect(blocks('Étapes', '[data-item^="junction-"]').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual([
      'Jonction 1 : Fondu au noir · 1,5 s (par défaut)',
      'Jonction 2 : Fondu au noir · 1,5 s (par défaut)',
    ])
    // the card of each stage is a block of « Textes »: the first with the flight, the others inside their junction
    expect(blocks('Textes', '[data-item^="card-"]').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual([
      'Carte : Étape 1 · Jour 1',
      'Carte : Étape 2 · Jour 2',
      'Carte : Étape 3 · Jour 3',
    ])
    expect(lane('Plans')).not.toBeNull()
    act(() => root.unmount())
  })

  it('no lane for one track, nor for the first track alone', async () => {
    const one = await setup(1)
    expect(one.lane('Étapes')).toBeNull()
    act(() => one.root.unmount())
    const alone = await setup(3, false)
    expect(alone.lane('Étapes')).toBeNull()
    expect(alone.blocks('Textes', '[data-item^="card-"]')).toEqual([])
    act(() => alone.root.unmount())
  })

  it('selecting a junction opens its inspector; its hold is stretched from the keyboard and the film gets longer by as much', async () => {
    const { host, root, blocks, press, tracks } = await setup(2)
    const total = () => Number(host.querySelector('[role="slider"][aria-label="Position dans le film"]')?.getAttribute('aria-valuemax'))
    const before = total()
    const junction = () => blocks('Étapes', '[data-item^="junction-"]')[0]
    await act(async () => junction().focus())
    expect(useAppStore.getState().filmSelection).toBe(`junction-${tracks[0].id}`)
    expect(host.querySelector('[data-testid="film-inspector"] h2')?.textContent).toBe('Jonction 1')
    expect(host.querySelector('[data-testid="film-inspector"]')?.textContent).toContain('Entre « Jour 1 » et « Jour 2 »')
    // a nudge by one second: the junction is now the film's own, held 1 s longer
    await press(junction(), 'ArrowRight')
    expect(useAppStore.getState().settings.film.junctions).toEqual([{ id: `junction-${tracks[0].id}`, afterTrackId: tracks[0].id, kind: 'fondu-noir', holdS: expect.closeTo(2.5, 1) }])
    expect(total()).toBeGreaterThanOrEqual(before + 1)
    expect(junction().getAttribute('aria-label')).toContain('Fondu au noir · 2,5 s')
    expect(junction().getAttribute('aria-label')).not.toContain('par défaut')
    // back to the default transition from the inspector (the selection stays)
    const reset = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="film-inspector"] button')).find((b) => b.textContent === 'Transition par défaut')!
    await act(async () => reset.click())
    expect(useAppStore.getState().settings.film.junctions).toEqual([])
    expect(useAppStore.getState().filmSelection).toBe(`junction-${tracks[0].id}`)
    act(() => root.unmount())
  })

  it('a stage takes the duration set from the keyboard, the inspector shows it and « Durée automatique » takes it back; the film follows', async () => {
    const { host, root, blocks, press, tracks } = await setup(2)
    const total = () => filmClockFor(getFilmSource()).totalTime()
    const before = total()
    const stage = () => blocks('Étapes', '[data-item^="stage-"]')[0]
    await act(async () => stage().focus())
    expect(host.querySelector('[data-testid="film-inspector"] h2')?.textContent).toBe('Étape 1')
    expect(useAppStore.getState().settings.film.stageDurations).toBeUndefined()
    // one second more than its share: the stage is set, the film is longer by as much
    await press(stage(), 'ArrowRight')
    expect(useAppStore.getState().settings.film.stageDurations).toEqual({ [tracks[0].id]: expect.any(Number) })
    expect(total()).toBeGreaterThanOrEqual(before + 0.9)
    expect(host.querySelector('[data-testid="film-inspector"]')?.textContent).toContain('Durée fixée')
    const auto = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="film-inspector"] button')).find((b) => b.textContent === 'Durée automatique')!
    await act(async () => auto.click())
    expect(useAppStore.getState().settings.film.stageDurations).toBeUndefined()
    expect(total()).toBeCloseTo(before, 1)
    act(() => root.unmount())
  })

  it('a cut is a thin block that holds nothing; the transition is changed from the inspector, « Appliquer à toutes » reaches every junction', async () => {
    const { host, root, blocks, tracks } = await setup(3)
    await act(async () => useAppStore.getState().setFilmSelection(`junction-${tracks[0].id}`))
    const kind = host.querySelector<HTMLButtonElement>('[data-testid="film-inspector"] button[aria-haspopup="listbox"]')!
    await act(async () => kind.click())
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === 'Coupe')!.click())
    expect(blocks('Étapes', '[data-item^="junction-"][aria-label*=": Coupe"]')).toHaveLength(1)
    expect(host.querySelector('[data-testid="film-inspector"] input[type="range"]')).toBeNull()
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="film-inspector"] button')).find((b) => b.textContent === 'Appliquer à toutes les jonctions')!
    await act(async () => all.click())
    expect(blocks('Étapes', '[data-item^="junction-"][aria-label*=": Coupe"]')).toHaveLength(2)
    expect(useAppStore.getState().settings.film.junctionDefault).toMatchObject({ kind: 'coupe', holdS: 0 })
    act(() => root.unmount())
  })

  it('a stage card is deleted by switching it off, and comes back from the junction’s inspector', async () => {
    const { host, root, blocks, press, tracks } = await setup(2)
    const second = () => blocks('Textes', '[data-item^="card-"]')[1]
    await act(async () => second().focus())
    expect(useAppStore.getState().filmSelection).toBe(`card-stage-${tracks[0].id}`)
    expect(host.querySelector('[data-testid="film-inspector"] h2')?.textContent).toBe('Carte de l’étape 2')
    await press(second(), 'Delete')
    expect(blocks('Textes', '[data-item^="card-"]')).toHaveLength(1)
    expect(useAppStore.getState().settings.film.junctions).toMatchObject([{ afterTrackId: tracks[0].id, card: { enabled: false } }])
    await act(async () => useAppStore.getState().setFilmSelection(`junction-${tracks[0].id}`))
    const switchOn = Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="film-inspector"] input[type="checkbox"]')).find((i) => i.labels?.[0]?.textContent === 'Carte de l’étape 2')!
    await act(async () => switchOn.click())
    expect(blocks('Textes', '[data-item^="card-"]')).toHaveLength(2)
    act(() => root.unmount())
  })

  it('the first stage card gives way to the opening title when it is on', async () => {
    const { root, blocks } = await setup(2)
    await act(async () => useAppStore.getState().setSetting('overlay', { ...DEFAULT_OVERLAY, enabled: true }))
    expect(blocks('Textes', '[data-item^="card-"]').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual([
      "Titre d'ouverture",
      'Carte de clôture',
      'Carte : Étape 2 · Jour 2',
    ])
    act(() => root.unmount())
  })

  describe('reordering the stages', () => {
    const labels = (blocks: (name: string, selector: string) => HTMLElement[]) =>
      blocks('Étapes', '[data-item^="stage-"]').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])
    const order = () => {
      const { tracks, settings } = useAppStore.getState()
      return filmSequenceOf(tracks, settings.race)!.stages.map((s) => s.track.name)
    }
    const pointer = (type: string, clientX: number) =>
      Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }), { pointerId: 1, isPrimary: true, pointerType: 'mouse' })

    it('Alt + → moves a stage one place later, says so, and the lane, the cards and the order follow', async () => {
      const { host, root, blocks, press } = await setup(3)
      const first = () => blocks('Étapes', '[data-item^="stage-"]')[0]
      await act(async () => first().focus())
      await act(async () => void first().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true })))
      expect(order()).toEqual(['Jour 2', 'Jour 1', 'Jour 3'])
      expect(labels(blocks)).toEqual(['Étape 1 : Jour 2', 'Étape 2 : Jour 1', 'Étape 3 : Jour 3'])
      expect(host.querySelector('[data-testid="timeline"] [role="status"]')!.textContent).toBe('Étape « Jour 1 » déplacée en position 2 sur 3')
      // the block that moved keeps the focus, and Alt + ← brings it back
      expect(document.activeElement).toBe(blocks('Étapes', '[data-item^="stage-"]')[1])
      await press(document.activeElement as HTMLElement, 'ArrowLeft')
      expect(order()).toEqual(['Jour 2', 'Jour 1', 'Jour 3'])
      await act(async () => void (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })))
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      act(() => root.unmount())
    })

    it('a stage dragged past the others lands after them: one undo step, the insertion line shown meanwhile, Escape cancels', async () => {
      HTMLElement.prototype.setPointerCapture ??= () => {}
      getSettingsHistory().clear()
      const { host, root, blocks } = await setup(3)
      getSettingsHistory().clear()
      const first = () => blocks('Étapes', '[data-item^="stage-"]')[0]
      await act(async () => void first().dispatchEvent(pointer('pointerdown', 0)))
      await act(async () => void first().dispatchEvent(pointer('pointermove', 1e6)))
      expect(first().dataset.lifted).toBeDefined()
      expect(host.querySelector('[data-testid="timeline-guide-tag"]')!.textContent).toBe('Étape 3')
      // Escape: nothing moves
      await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      expect(host.querySelector('[data-testid="timeline-block"][data-lifted]')).toBeNull()
      await act(async () => void first().dispatchEvent(pointer('pointerup', 1e6)))
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      // again, released: Jour 1 last
      await act(async () => void first().dispatchEvent(pointer('pointerdown', 0)))
      await act(async () => void first().dispatchEvent(pointer('pointermove', 1e6)))
      await act(async () => void first().dispatchEvent(pointer('pointerup', 1e6)))
      expect(order()).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
      expect(host.querySelector('[data-testid="timeline-block"][data-lifted]')).toBeNull()
      await act(async () => getSettingsHistory().undo())
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      expect(getSettingsHistory().getState().canUndo).toBe(false)
      act(() => root.unmount())
    })

    it('a press on a stage without a drag only selects it', async () => {
      const { root, blocks, tracks } = await setup(3)
      const block = () => blocks('Étapes', '[data-item^="stage-"]')[1]
      await act(async () => void block().dispatchEvent(pointer('pointerdown', 10)))
      await act(async () => void block().dispatchEvent(pointer('pointerup', 10)))
      expect(useAppStore.getState().filmSelection).toBe(`stage-${tracks[1].id}`)
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      act(() => root.unmount())
    })
  })
})

describe('Timeline — several keys at once', () => {
  const setup = async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    HTMLElement.prototype.setPointerCapture ??= () => {}
    useExportStore.setState({ phase: 'idle' })
    useAppStore.getState().setProgress(0)
    const segments = [{ points: [0, 1, 2, 3].map((i) => ({ lon: 6.8 + i * 0.01, lat: 45.9, ele: 1000 + i * 10 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })], filmSelection: null, filmKeys: [] })
    const camera = addCameraKey(DEFAULT_FILM, 200, { distance: 1, pitchDeg: 30, headingOffsetDeg: 0 })
    const param = addParamKey(camera.film, 600, 'exposure', 0.5)
    const marker = addMarkerKey(param.film, 1000, { kind: DEFAULT_SETTINGS.marker.kind, figure: DEFAULT_SETTINGS.marker.figure })
    await act(async () => useAppStore.getState().setSetting('film', marker.film))
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<Timeline />))
    const keys = () => Array.from(host.querySelectorAll<HTMLElement>('[data-testid="timeline-key"]'))
    const content = keys()[0].closest('[data-testid="timeline-lane"]')!.parentElement!
    // jsdom lays nothing out: the keys sit side by side, one lane under the other
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} }) as DOMRect
    content.getBoundingClientRect = () => rect(0, 0, 1000, 300)
    keys().forEach((k, i) => (k.getBoundingClientRect = () => rect(10 + i * 100, 20 + i * 30, 10, 10)))
    const pointer = (type: string, clientX: number, clientY = 0, init: MouseEventInit = {}) =>
      Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, ...init }), { pointerId: 1, isPrimary: true, pointerType: 'mouse' })
    const fire = (el: Element, event: Event) => act(async () => void el.dispatchEvent(event))
    const film = () => useAppStore.getState().settings.film
    return { host, root, keys, content, pointer, fire, film, ids: [camera.id, param.id, marker.id], original: marker.film }
  }

  it('a Ctrl + drag rectangle on the background selects the keys it touches, Delete removes them in one undo step', async () => {
    const { root, keys, content, pointer, fire, film, ids, original, host } = await setup()
    const ctrl = { ctrlKey: true }
    await fire(content, pointer('pointerdown', 0, 0, ctrl))
    // the playhead did not move: this press draws a rectangle
    expect(useAppStore.getState().playback.progress).toBe(0)
    await fire(content, pointer('pointermove', 150, 100, ctrl))
    expect(host.querySelector('[data-testid="timeline-marquee"]')).not.toBeNull()
    expect(keys().map((k) => k.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false'])
    await fire(content, pointer('pointerup', 150, 100, ctrl))
    expect(host.querySelector('[data-testid="timeline-marquee"]')).toBeNull()
    expect(useAppStore.getState().filmKeys).toEqual([ids[0], ids[1]])
    expect(useAppStore.getState().filmSelection).toBeNull()
    expect(keys().map((k) => k.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false'])
    expect(document.activeElement).toBe(keys()[0])

    await fire(keys()[0], new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
    expect([film().cameraKeys.length, film().paramKeys.length, film().markerKeys.length]).toEqual([0, 0, 1])
    expect(useAppStore.getState().filmKeys).toEqual([])
    await act(async () => getSettingsHistory().undo())
    expect(film().cameraKeys).toEqual(original.cameraKeys)
    expect(film().paramKeys).toEqual(original.paramKeys)
    act(() => root.unmount())
  })

  it('a plain press on the background still moves the playhead, a rectangle that touches nothing selects nothing', async () => {
    const { root, content, pointer, fire, ids } = await setup()
    await fire(content, pointer('pointerdown', 40, 5))
    expect(useAppStore.getState().playback.progress).toBeGreaterThan(0)
    await fire(content, pointer('pointerup', 40, 5))
    await act(async () => useAppStore.getState().setFilmKeys([ids[0], ids[1]]))
    await fire(content, pointer('pointerdown', 500, 200, { ctrlKey: true }))
    await fire(content, pointer('pointermove', 600, 250, { ctrlKey: true }))
    await fire(content, pointer('pointerup', 600, 250, { ctrlKey: true }))
    expect(useAppStore.getState().filmKeys).toEqual([])
    expect(useAppStore.getState().filmSelection).toBeNull()
    act(() => root.unmount())
  })

  it('dragging a key of the selection moves the whole selection in one undo step, a press without moving selects the key alone', async () => {
    const { root, keys, content, pointer, fire, film, ids, original } = await setup()
    await act(async () => useAppStore.getState().setFilmKeys([ids[0], ids[1]]))
    await fire(keys()[0], pointer('pointerdown', 0))
    // pressing a key of the group keeps the group
    expect(useAppStore.getState().filmKeys).toEqual([ids[0], ids[1]])
    await fire(keys()[0], pointer('pointermove', 20))
    await fire(keys()[0], pointer('pointerup', 20))
    expect(film().cameraKeys[0].atM).toBeGreaterThan(original.cameraKeys[0].atM)
    expect(film().paramKeys[0].atM).toBeGreaterThan(original.paramKeys[0].atM)
    expect(film().markerKeys).toEqual(original.markerKeys)
    expect(useAppStore.getState().filmKeys).toEqual([ids[0], ids[1]])
    await act(async () => getSettingsHistory().undo())
    expect(film().cameraKeys).toEqual(original.cameraKeys)
    expect(film().paramKeys).toEqual(original.paramKeys)

    await fire(keys()[1], pointer('pointerdown', 0))
    await fire(content, pointer('pointerup', 0))
    expect(useAppStore.getState().filmKeys).toEqual([])
    expect(useAppStore.getState().filmSelection).toBe(ids[1])
    act(() => root.unmount())
  })

  it('Ctrl + click adds a key to the selection or removes it; so do Ctrl + Enter and the arrows move the group from the keyboard', async () => {
    const { root, keys, content, pointer, fire, film, ids } = await setup()
    await act(async () => useAppStore.getState().setFilmSelection(ids[0]))
    await fire(keys()[2], pointer('pointerdown', 0, 0, { ctrlKey: true }))
    await fire(content, pointer('pointerup', 0, 0, { ctrlKey: true }))
    expect(useAppStore.getState().filmKeys).toEqual([ids[0], ids[2]])
    await fire(keys()[1], new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(useAppStore.getState().filmKeys).toEqual([ids[0], ids[2], ids[1]])
    await fire(keys()[1], new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    const before = [film().cameraKeys[0].atM, film().markerKeys[0].atM]
    await fire(keys()[0], new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    expect(film().cameraKeys[0].atM).toBeLessThan(before[0])
    expect(film().markerKeys[0].atM).toBeLessThan(before[1])
    // one key left in the selection: it is the block selected, the inspector's
    await fire(keys()[0], pointer('pointerdown', 0, 0, { ctrlKey: true }))
    await fire(content, pointer('pointerup', 0, 0, { ctrlKey: true }))
    expect(useAppStore.getState().filmKeys).toEqual([])
    expect(useAppStore.getState().filmSelection).toBe(ids[2])
    // a block selected on its own replaces a group
    await act(async () => useAppStore.getState().setFilmKeys([ids[0], ids[1]]))
    await act(async () => useAppStore.getState().setFilmSelection('opening'))
    expect(useAppStore.getState().filmKeys).toEqual([])
    act(() => root.unmount())
  })
})
