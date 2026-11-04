// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_MARKER } from '../scene/markerSettings'
import type { MarkerSettings } from '../scene/markerSettings'
import { resetAppStore, useAppStore } from '../state/store'
import { t } from '../i18n'
import { usePreferences } from './preferences'
import { MarkerSection } from './TrackMarkerSection'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  HTMLCanvasElement.prototype.getContext = () => null
})

const FIGURINE: MarkerSettings = { ...DEFAULT_MARKER, kind: 'figurine', model3d: true }

async function show(marker: MarkerSettings, markerKeys: { kind: MarkerSettings['kind'] }[] = []) {
  usePreferences.setState({ uiMode: 'expert' })
  useAppStore.setState((s) => ({ settings: { ...s.settings, marker, film: { ...s.settings.film, markerKeys: markerKeys.map((key, i) => ({ id: `k${i}`, atM: i * 100, figure: 'auto', ...key })) as never } } }))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<MarkerSection hidden={false} />))
  // the « Plus d'options » block is a closed <details>: its content is in the page all the same
  return { text: () => host.textContent ?? '', stop: () => act(() => root.unmount()) }
}

describe('MarkerSection', () => {
  afterEach(() => {
    resetAppStore()
    document.body.innerHTML = ''
  })

  it('does not offer the stick, the badge, the label and the ring with a 3D model, which ignores them', async () => {
    const view = await show(FIGURINE)
    for (const key of ['marker.section.stick', 'marker.section.badge', 'marker.section.label', 'marker.section.edgeColor']) expect(view.text()).not.toContain(t(key as never))
    await view.stop()
  })

  it('offers them again with the flat figurine, and with a ball', async () => {
    for (const marker of [{ ...FIGURINE, model3d: false }, { ...DEFAULT_MARKER }]) {
      const view = await show(marker)
      expect(view.text()).toContain(t('marker.section.stick' as never))
      expect(view.text()).toContain(t('marker.section.label' as never))
      await view.stop()
      resetAppStore()
      document.body.innerHTML = ''
    }
  })

  it('offers them when a marker key turns the model into a ball somewhere in the film', async () => {
    const view = await show(FIGURINE, [{ kind: 'boule' }])
    expect(view.text()).toContain(t('marker.section.stick' as never))
    await view.stop()
  })

  it('shows the colour of the model only when it takes the colour of the track', async () => {
    const natural = await show({ ...FIGURINE, modelColors: 'natural' })
    expect(natural.text()).not.toContain(t('marker.section.modelColor' as never))
    await natural.stop()
    resetAppStore()
    document.body.innerHTML = ''
    const track = await show({ ...FIGURINE, modelColors: 'track' })
    expect(track.text()).toContain(t('marker.section.modelColor' as never))
    await track.stop()
  })
})
