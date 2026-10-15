// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { buildTrack } from '../import/stats'
import { useKeyedValue } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { PanelKeys } from './KeyControls'

describe('PanelKeys', () => {
  it('adds a key with the current value at the playhead, then goes from key to key', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
    const store = useAppStore.getState()
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    store.setSetting('exposureEv', 1.5)
    store.setProgress(0.25)
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () =>
      root.render(
        <>
          <PanelKeys target={{ kind: 'param', param: 'exposure' }} />
          <PanelKeys target={{ kind: 'marker' }} />
        </>,
      ),
    )
    const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
    const keys = () => useAppStore.getState().settings.film.paramKeys
    expect(button('Exposition : clé précédente').disabled).toBe(true)
    expect(button('Exposition : clé suivante').disabled).toBe(true)

    await act(async () => button('Exposition : ajouter une clé').click())
    expect(keys()).toMatchObject([{ param: 'exposure', value: 1.5 }])
    expect(useAppStore.getState().filmSelection).toBe(keys()[0].id)
    // the playhead is on the key: the middle button removes it instead of adding another, and adds it back from there
    expect(button('Exposition : supprimer la clé')).not.toBeNull()
    await act(async () => button('Exposition : supprimer la clé').click())
    expect(keys()).toHaveLength(0)
    await act(async () => button('Exposition : ajouter une clé').click())
    expect(keys()).toMatchObject([{ param: 'exposure', value: 1.5 }])

    await act(async () => useAppStore.getState().setProgress(0.75))
    await act(async () => button('Exposition : ajouter une clé').click())
    expect(keys()).toHaveLength(2)
    expect(button('Exposition : clé précédente').disabled).toBe(false)
    expect(button('Exposition : clé suivante').disabled).toBe(true)

    await act(async () => button('Exposition : clé précédente').click())
    expect(useAppStore.getState().playback.progress).toBeCloseTo(0.25, 2)
    // the inspector followed: it showed a key of that parameter
    const first = [...keys()].sort((a, b) => a.atM - b.atM)[0]
    expect(useAppStore.getState().filmSelection).toBe(first.id)

    // the marker keys have their own group
    expect(button('Marqueur : clé précédente').disabled).toBe(true)
    await act(async () => button('Marqueur : ajouter une clé').click())
    expect(useAppStore.getState().settings.film.markerKeys).toHaveLength(1)
    // on the marker key, the same button removes it
    await act(async () => button('Marqueur : supprimer la clé').click())
    expect(useAppStore.getState().settings.film.markerKeys).toHaveLength(0)
    act(() => root.unmount())
  })
})

describe('useKeyedValue', () => {
  it('moves the slider of a keyed parameter onto the key at the playhead, and makes one there on the first move', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon, i) => ({ lon, lat: 45.9, ele: 1000 + i * 10 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const store = useAppStore.getState()
    store.setSetting('film', { ...store.settings.film, paramKeys: [] })
    store.setSetting('sunHour', 10)
    store.setProgress(0.25)
    let slider: readonly [number, (value: number) => void] = [0, () => {}]
    function Probe() {
      const result = useKeyedValue('sunHour', useAppStore((s) => s.settings.sunHour), (hour) => useAppStore.getState().setSetting('sunHour', hour))
      useEffect(() => {
        slider = result
      })
      return null
    }
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<><Probe /><PanelKeys target={{ kind: 'param', param: 'sunHour' }} /></>))
    const keys = () => useAppStore.getState().settings.film.paramKeys

    // no key: the slider is the setting
    await act(async () => slider[1](14))
    expect(useAppStore.getState().settings.sunHour).toBe(14)
    expect(keys()).toHaveLength(0)

    // one key (at the hour shown), then another place and another hour: the film now has two hours, the setting is not touched
    await act(async () => void host.querySelector<HTMLButtonElement>('button[aria-label="Soleil : ajouter une clé"]')!.click())
    expect(keys()).toMatchObject([{ param: 'sunHour', value: 14 }])
    await act(async () => useAppStore.getState().setProgress(0.75))
    expect(slider[0]).toBe(14)
    await act(async () => slider[1](19))
    expect(keys()).toHaveLength(2)
    expect(slider[0]).toBe(19)
    expect(useAppStore.getState().settings.sunHour).toBe(14)
    await act(async () => useAppStore.getState().setProgress(0.25))
    expect(slider[0]).toBe(14)

    // on a key, a move changes that key instead of adding one
    await act(async () => slider[1](12))
    expect(keys()).toHaveLength(2)
    expect(slider[0]).toBe(12)
    act(() => root.unmount())
  })
})
