// @vitest-environment jsdom
import { Profiler, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useExportStore } from '../export/store'
import { buildTrack } from '../import/stats'
import { END_CARD_ID, TITLE_CARD_ID } from '../film/cards'
import { DEFAULT_FILM } from '../film/model'
import { removeFilmItem, updateMarkerKey } from '../film/timeline'
import { filmSequenceOf } from '../flyover/sequence'
import { getSettingsHistory } from '../project/history'
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
    expect(Array.from(host.querySelectorAll('.film-tl__lane')).map((l) => l.getAttribute('aria-label'))[0]).toBe('Étapes')
    expect(Array.from(host.querySelectorAll('.film-tl__head')).map((h) => h.textContent)[1]).toBe('Étapes')
    expect(blocks('Étapes', '.film-tl__block--stage').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual(['Étape 1 : Jour 1', 'Étape 2 : Jour 2', 'Étape 3 : Jour 3'])
    expect(blocks('Étapes', '.film-tl__block--junction').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual([
      'Jonction 1 : Fondu au noir · 1,5 s (par défaut)',
      'Jonction 2 : Fondu au noir · 1,5 s (par défaut)',
    ])
    // the card of each stage is a block of « Textes »: the first with the flight, the others inside their junction
    expect(blocks('Textes', '.film-tl__block--card').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual([
      'Carton : Étape 1 · Jour 1',
      'Carton : Étape 2 · Jour 2',
      'Carton : Étape 3 · Jour 3',
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
    expect(alone.blocks('Textes', '.film-tl__block--card')).toEqual([])
    act(() => alone.root.unmount())
  })

  it('selecting a junction opens its inspector; its hold is stretched from the keyboard and the film gets longer by as much', async () => {
    const { host, root, blocks, press, tracks } = await setup(2)
    const total = () => Number(host.querySelector('.film-tl__ruler')?.getAttribute('aria-valuemax'))
    const before = total()
    const junction = () => blocks('Étapes', '.film-tl__block--junction')[0]
    await act(async () => junction().focus())
    expect(useAppStore.getState().filmSelection).toBe(`junction-${tracks[0].id}`)
    expect(host.querySelector('.film-inspector h2')?.textContent).toBe('Jonction 1')
    expect(host.querySelector('.film-inspector')?.textContent).toContain('Entre « Jour 1 » et « Jour 2 »')
    // a nudge by one second: the junction is now the film's own, held 1 s longer
    await press(junction(), 'ArrowRight')
    expect(useAppStore.getState().settings.film.junctions).toEqual([{ id: `junction-${tracks[0].id}`, afterTrackId: tracks[0].id, kind: 'fondu-noir', holdS: expect.closeTo(2.5, 1) }])
    expect(total()).toBeGreaterThanOrEqual(before + 1)
    expect(junction().getAttribute('aria-label')).toContain('Fondu au noir · 2,5 s')
    expect(junction().getAttribute('aria-label')).not.toContain('par défaut')
    // back to the default transition from the inspector (the selection stays)
    const reset = Array.from(host.querySelectorAll<HTMLButtonElement>('.film-inspector__remove')).find((b) => b.textContent === 'Transition par défaut')!
    await act(async () => reset.click())
    expect(useAppStore.getState().settings.film.junctions).toEqual([])
    expect(useAppStore.getState().filmSelection).toBe(`junction-${tracks[0].id}`)
    act(() => root.unmount())
  })

  it('a cut is a thin block that holds nothing; the transition is changed from the inspector, « Appliquer à toutes » reaches every junction', async () => {
    const { host, root, blocks, tracks } = await setup(3)
    await act(async () => useAppStore.getState().setFilmSelection(`junction-${tracks[0].id}`))
    const kind = host.querySelector<HTMLSelectElement>('.film-inspector select')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(kind, 'coupe')
      kind.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(blocks('Étapes', '.film-tl__block--junction-coupe')).toHaveLength(1)
    expect(host.querySelector('.film-inspector input[type="range"]')).toBeNull()
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>('.film-inspector__remove')).find((b) => b.textContent === 'Appliquer à toutes les jonctions')!
    await act(async () => all.click())
    expect(blocks('Étapes', '.film-tl__block--junction-coupe')).toHaveLength(2)
    expect(useAppStore.getState().settings.film.junctionDefault).toMatchObject({ kind: 'coupe', holdS: 0 })
    act(() => root.unmount())
  })

  it('a stage card is deleted by switching it off, and comes back from the junction’s inspector', async () => {
    const { host, root, blocks, press, tracks } = await setup(2)
    const second = () => blocks('Textes', '.film-tl__block--card')[1]
    await act(async () => second().focus())
    expect(useAppStore.getState().filmSelection).toBe(`card-stage-${tracks[0].id}`)
    expect(host.querySelector('.film-inspector h2')?.textContent).toBe('Carton de l’étape 2')
    await press(second(), 'Delete')
    expect(blocks('Textes', '.film-tl__block--card')).toHaveLength(1)
    expect(useAppStore.getState().settings.film.junctions).toMatchObject([{ afterTrackId: tracks[0].id, card: { enabled: false } }])
    await act(async () => useAppStore.getState().setFilmSelection(`junction-${tracks[0].id}`))
    const switchOn = Array.from(host.querySelectorAll<HTMLInputElement>('.film-inspector input[type="checkbox"]')).find((i) => i.labels?.[0]?.textContent === 'Carton de l’étape 2')!
    await act(async () => switchOn.click())
    expect(blocks('Textes', '.film-tl__block--card')).toHaveLength(2)
    act(() => root.unmount())
  })

  it('the first stage card gives way to the opening title when it is on', async () => {
    const { root, blocks } = await setup(2)
    await act(async () => useAppStore.getState().setSetting('overlay', { ...DEFAULT_OVERLAY, enabled: true }))
    expect(blocks('Textes', '.film-tl__block--card').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])).toEqual([
      "Titre d'ouverture",
      'Carte de clôture',
      'Carton : Étape 2 · Jour 2',
    ])
    act(() => root.unmount())
  })

  describe('reordering the stages', () => {
    const labels = (blocks: (name: string, selector: string) => HTMLElement[]) =>
      blocks('Étapes', '.film-tl__block--stage').map((b) => b.getAttribute('aria-label')?.split(', de ')[0])
    const order = () => {
      const { tracks, settings } = useAppStore.getState()
      return filmSequenceOf(tracks, settings.race)!.stages.map((s) => s.track.name)
    }
    const pointer = (type: string, clientX: number) =>
      Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }), { pointerId: 1, isPrimary: true, pointerType: 'mouse' })

    it('Alt + → moves a stage one place later, says so, and the lane, the cards and the order follow', async () => {
      const { host, root, blocks, press } = await setup(3)
      const first = () => blocks('Étapes', '.film-tl__block--stage')[0]
      await act(async () => first().focus())
      await act(async () => void first().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true })))
      expect(order()).toEqual(['Jour 2', 'Jour 1', 'Jour 3'])
      expect(labels(blocks)).toEqual(['Étape 1 : Jour 2', 'Étape 2 : Jour 1', 'Étape 3 : Jour 3'])
      expect(host.querySelector('.film-tl [role="status"]')!.textContent).toBe('Étape « Jour 1 » déplacée en position 2 sur 3')
      // the block that moved keeps the focus, and Alt + ← brings it back
      expect(document.activeElement).toBe(blocks('Étapes', '.film-tl__block--stage')[1])
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
      const first = () => blocks('Étapes', '.film-tl__block--stage')[0]
      await act(async () => void first().dispatchEvent(pointer('pointerdown', 0)))
      await act(async () => void first().dispatchEvent(pointer('pointermove', 1e6)))
      expect(first().classList.contains('film-tl__block--lifted')).toBe(true)
      expect(host.querySelector('.film-tl__guide-tag')!.textContent).toBe('Étape 3')
      // Escape: nothing moves
      await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      expect(host.querySelector('.film-tl__block--lifted')).toBeNull()
      await act(async () => void first().dispatchEvent(pointer('pointerup', 1e6)))
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      // again, released: Jour 1 last
      await act(async () => void first().dispatchEvent(pointer('pointerdown', 0)))
      await act(async () => void first().dispatchEvent(pointer('pointermove', 1e6)))
      await act(async () => void first().dispatchEvent(pointer('pointerup', 1e6)))
      expect(order()).toEqual(['Jour 2', 'Jour 3', 'Jour 1'])
      expect(host.querySelector('.film-tl__block--lifted')).toBeNull()
      await act(async () => getSettingsHistory().undo())
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      expect(getSettingsHistory().getState().canUndo).toBe(false)
      act(() => root.unmount())
    })

    it('a press on a stage without a drag only selects it', async () => {
      const { root, blocks, tracks } = await setup(3)
      const block = () => blocks('Étapes', '.film-tl__block--stage')[1]
      await act(async () => void block().dispatchEvent(pointer('pointerdown', 10)))
      await act(async () => void block().dispatchEvent(pointer('pointerup', 10)))
      expect(useAppStore.getState().filmSelection).toBe(`stage-${tracks[1].id}`)
      expect(order()).toEqual(['Jour 1', 'Jour 2', 'Jour 3'])
      act(() => root.unmount())
    })
  })
})
