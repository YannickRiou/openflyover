// @vitest-environment jsdom
import { Profiler, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useExportStore } from '../export/store'
import { buildTrack } from '../import/stats'
import { END_CARD_ID, TITLE_CARD_ID } from '../film/cards'
import { DEFAULT_FILM } from '../film/model'
import { removeFilmItem, updateMarkerKey } from '../film/timeline'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import { addMarkerKeyHere, addParamKeyHere } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { FilmInspector } from './FilmInspector'
import { OverlayPanel } from './OverlayPanel'
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
    const time = () => host.querySelector('.film-tl__time strong')?.textContent
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
    const lanes = () => Array.from(host.querySelectorAll('.film-tl__lane')).map((l) => l.getAttribute('aria-label'))
    const groups = () => Array.from(host.querySelectorAll('.film-tl__heads [role="group"]')).map((g) => g.getAttribute('aria-label'))
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    // the camera and speed keys have their ◀ ◇ ▶ in their lane header, with the names they had in the bar
    expect(groups()).toEqual(['Images clés', 'Clés : Vitesse'])
    const names = (label: string) => Array.from(host.querySelectorAll(`[role="group"][aria-label="${label}"] button`)).map((b) => b.getAttribute('aria-label'))
    expect(names('Images clés')).toEqual(['Image clé précédente', 'Ajouter une image clé', 'Image clé suivante'])
    expect(host.querySelector('.film-tl__bar [aria-label="Ajouter un réglage"]')).toBeNull()
    expect(host.querySelector('.film-tl__bar [aria-label="Ajouter un changement de marqueur"]')).toBeNull()

    // a speed key stays on the « Vitesse » lane
    const add = host.querySelector<HTMLButtonElement>('[aria-label="Vitesse : ajouter une clé"]')
    await act(async () => add?.click())
    expect(useAppStore.getState().settings.film.paramKeys).toMatchObject([{ param: 'speed', value: 1 }])
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    expect(host.querySelectorAll('[role="group"][aria-label="Vitesse"] .film-tl__key')).toHaveLength(1)

    // a keyed parameter gets a lane of its own, which goes with its last key
    await act(async () => addParamKeyHere('exposure'))
    await act(async () => addParamKeyHere('warmth'))
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Exposition', 'Température', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    expect(host.querySelectorAll('[role="group"][aria-label="Exposition"] .film-tl__key')).toHaveLength(1)
    const exposure = useAppStore.getState().settings.film.paramKeys.find((k) => k.param === 'exposure')!
    await act(async () => useAppStore.getState().setSetting('film', removeFilmItem(useAppStore.getState().settings.film, exposure.id)))
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Température', 'Arrêts', 'Textes', 'Médias', 'Musique'])

    await act(async () => addMarkerKeyHere())
    expect(lanes()).toEqual(['Plans', 'Vitesse', 'Température', 'Marqueur', 'Arrêts', 'Textes', 'Médias', 'Musique'])
    expect(host.querySelectorAll('[role="group"][aria-label="Marqueur"] .film-tl__key--marker')).toHaveLength(1)
    expect(lanes()).not.toContain('Réglages')

    // the dot shows the colour of the marker from that key on, and its title lists the look
    const dot = () => host.querySelector<HTMLElement>('.film-tl__key--marker')!
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
    const colour = () => host.querySelector<HTMLInputElement>('input[type="color"]')!
    // a new key follows the panel's colours and size until it is given its own
    expect(keys()[0].color).toBeUndefined()
    expect(keys()[0].size).toBeUndefined()
    expect(colour().value).toBe('#ffffff')
    expect(host.textContent).toContain('Restent ceux du panneau : étiquette (aucune), tige (non)')
    expect(button('Reprendre couleurs et taille du panneau').disabled).toBe(true)

    // « Celle de la trace » stores '' (the track's colour), the reset goes back to the panel's values
    await act(async () => button('Celle de la trace').click())
    expect(keys()[0].color).toBe('')
    expect(button('Celle de la trace').disabled).toBe(true)
    await act(async () => button('Reprendre couleurs et taille du panneau').click())
    expect(keys()[0].color).toBeUndefined()
    expect(keys()[0].size).toBeUndefined()
    expect(button('Reprendre couleurs et taille du panneau').disabled).toBe(true)
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
        Array.from(host.querySelectorAll<HTMLElement>('[role="group"][aria-label="Textes"] .film-tl__block--card')).map((b) => b.getAttribute('aria-label')?.split(',')[0])
      const card = (label: string) => host.querySelector<HTMLElement>(`[role="group"][aria-label="Textes"] [aria-label^="${label}"]`)!
      const press = (el: HTMLElement, key: string) =>
        act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
      return { host, root, setOverlay, cards, card, press }
    }

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

    it('select with the focus, nudge their inner edge with the arrows and are deleted by switching the card off', async () => {
      const { root, setOverlay, cards, card, press } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      const title = card("Titre d'ouverture")
      await act(async () => title.focus())
      expect(useAppStore.getState().filmSelection).toBe(TITLE_CARD_ID)
      const end = useAppStore.getState().settings.overlay.title.end
      await press(title, 'ArrowRight')
      expect(useAppStore.getState().settings.overlay.title.end).toBeGreaterThan(end)
      await press(card("Titre d'ouverture"), 'ArrowLeft')
      expect(useAppStore.getState().settings.overlay.title.end).toBeCloseTo(end, 2)

      const closing = card('Carte de clôture')
      await act(async () => closing.focus())
      expect(useAppStore.getState().filmSelection).toBe(END_CARD_ID)
      const start = useAppStore.getState().settings.overlay.end.start
      await press(closing, 'ArrowLeft')
      expect(useAppStore.getState().settings.overlay.end.start).toBeLessThan(start)

      await press(card('Carte de clôture'), 'Delete')
      expect(useAppStore.getState().settings.overlay.end).toMatchObject({ enabled: false, start: expect.any(Number) })
      expect(useAppStore.getState().filmSelection).toBeNull()
      expect(cards()).toEqual(["Titre d'ouverture"])
      // the block goes with the card, not with its settings: switched back on, it comes back
      await act(async () => setOverlay({ end: { ...useAppStore.getState().settings.overlay.end, enabled: true } }))
      expect(cards()).toEqual(["Titre d'ouverture", 'Carte de clôture'])
      act(() => root.unmount())
    })

    it('open the inspector, which edits the overlay settings and deletes by switching the card off', async () => {
      const { host, root, setOverlay } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      await act(async () => useAppStore.getState().setFilmSelection(TITLE_CARD_ID))
      const inspector = host.querySelector('.film-inspector')!
      expect(inspector.querySelector('h2')?.textContent).toBe("Titre d'ouverture")
      const field = Array.from(inspector.querySelectorAll<HTMLInputElement>('input[type="text"]')).find((i) => i.labels?.[0]?.textContent === 'Titre')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Col du Galibier')
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(useAppStore.getState().settings.overlay.title.title).toBe('Col du Galibier')
      // the position, the size and the colours of the card are in the inspector too
      expect(inspector.textContent).toContain('Position')
      expect(inspector.textContent).toContain('Taille')
      expect(inspector.textContent).toContain('Couleurs et polices')

      await act(async () => useAppStore.getState().setFilmSelection(END_CARD_ID))
      expect(host.querySelector('.film-inspector h2')?.textContent).toBe('Carte de clôture')
      expect(host.querySelector('.film-inspector')?.textContent).toContain('Générique')

      const remove = Array.from(host.querySelectorAll<HTMLButtonElement>('.film-inspector__remove')).find((b) => b.textContent === 'Supprimer')!
      await act(async () => remove.click())
      expect(useAppStore.getState().settings.overlay.end.enabled).toBe(false)
      expect(useAppStore.getState().filmSelection).toBeNull()
      expect(host.querySelector('.film-inspector')).toBeNull()
      act(() => root.unmount())
    })

    it('keep only their switch, a hint and « Modifier » in the Habillage panel', async () => {
      const { host, root, setOverlay } = await setup()
      await act(async () => setOverlay({ enabled: true }))
      const panel = document.body.appendChild(document.createElement('div'))
      const panelRoot = createRoot(panel)
      await act(async () => panelRoot.render(<OverlayPanel />))
      const groups = Array.from(panel.querySelectorAll<HTMLElement>('.overlay-widget')).filter((g) => /Titre d'ouverture|Carte de clôture/.test(g.textContent ?? ''))
      expect(groups).toHaveLength(2)
      for (const g of groups) {
        expect(g.textContent).toContain('Réglages : cliquez le bloc dans la timeline.')
        // no field left: the switch and the button
        expect(g.querySelectorAll('input, textarea, select, button')).toHaveLength(2)
      }
      const edit = panel.querySelector<HTMLButtonElement>('button[aria-label="Modifier : Carte de clôture"]')!
      await act(async () => edit.click())
      expect(useAppStore.getState().filmSelection).toBe(END_CARD_ID)
      expect(host.querySelector('.film-inspector h2')?.textContent).toBe('Carte de clôture')
      // switched off: no « Modifier »
      await act(async () => setOverlay({ end: { ...useAppStore.getState().settings.overlay.end, enabled: false } }))
      expect(panel.querySelector('button[aria-label="Modifier : Carte de clôture"]')).toBeNull()
      act(() => panelRoot.unmount())
      act(() => root.unmount())
    })
  })
})
