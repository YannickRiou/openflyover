// @vitest-environment jsdom
import { Profiler, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { useExportStore } from '../export/store'
import { buildTrack } from '../import/stats'
import { removeFilmItem } from '../film/timeline'
import { addMarkerKeyHere, addParamKeyHere } from '../scene/usePacing'
import { useAppStore } from '../state/store'
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
    act(() => root.unmount())
  })
})
