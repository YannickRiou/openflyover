// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { buildTrack } from '../import/stats'
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
    // the playhead is on the key: the middle button opens it instead of adding another
    expect(button('Exposition : sélectionner la clé')).not.toBeNull()

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
    act(() => root.unmount())
  })
})
