// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_MARKER } from '../scene/markerSettings'
import type { MarkerSettings } from '../scene/markerSettings'
import { resetAppStore, useAppStore } from '../state/store'
import { t } from '../i18n'
import { usePreferences } from './preferences'
import { buildTrack } from '../import/stats'
import { MarkerSection, TrackStyleSection } from './TrackMarkerSection'

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
  return { host, text: () => host.textContent ?? '', stop: () => act(() => root.unmount()) }
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

  it('draws a picture on each tile of the shape and style rails of the marker, which stay named by their word', async () => {
    const view = await show({ ...DEFAULT_MARKER })
    for (const [label, words] of [
      [t('marker.section.shape' as never), ['marker.kind.boule', 'marker.kind.figurine', 'marker.kind.image']],
      [t('marker.section.style' as never), ['marker.ball.plat', 'marker.ball.halo', 'marker.ball.pulsation']],
    ] as const) {
      const group = [...view.host.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === label)
      const chips = [...(group?.querySelectorAll('.segmented__option') ?? [])]
      expect(chips.map((chip) => chip.textContent)).toEqual(words.map((word) => t(word as never)))
      for (const chip of chips) expect(chip.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      // the picture changes nothing to the choice: one radio, the current one, is checked
      expect(group?.querySelectorAll('input[type="radio"]:checked')).toHaveLength(1)
    }
    await view.stop()
  })
})

describe('TrackStyleSection', () => {
  afterEach(() => {
    resetAppStore()
    document.body.innerHTML = ''
  })

  async function showTrack(withHeartRate: boolean) {
    usePreferences.setState({ uiMode: 'expert' })
    // without elevation nor time, a track has no measure at all (slope and altitude need the elevation)
    const points = [6.8, 6.81, 6.82].map((lon, i) => (withHeartRate ? { lon, lat: 45.9, ele: 1000 + i * 10, hr: 120 + i } : { lon, lat: 45.9 }))
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TrackStyleSection hidden={false} />))
    return { host, text: () => host.textContent ?? '', stop: () => act(() => root.unmount()) }
  }

  it('says the line is grey when no track has the measure chosen, and the ribbon has nothing to show without a measure', async () => {
    const view = await showTrack(false)
    expect(view.text()).toContain(t('marker.track.ribbonNone'))
    await act(async () => useAppStore.getState().setSetting('trackColorBy', 'heartRate'))
    expect(view.text()).toContain(t('marker.track.colorByMissing'))
    expect(view.text()).not.toContain(t('marker.track.colorByHint'))
    await view.stop()
  })

  it('a track with the measure: no warning', async () => {
    const view = await showTrack(true)
    await act(async () => useAppStore.getState().setSetting('trackColorBy', 'heartRate'))
    expect(view.text()).not.toContain(t('marker.track.colorByMissing'))
    expect(view.text()).not.toContain(t('marker.track.ribbonNone'))
    await view.stop()
  })

  it('says a glow no wider than the line does not show', async () => {
    const view = await showTrack(false)
    const style = useAppStore.getState().settings.trackStyle
    await act(async () => useAppStore.getState().setSetting('trackStyle', { ...style, glow: true, width: 6, glowWidth: 6 }))
    expect(view.text()).toContain(t('marker.track.glowTooNarrow', { width: '6 px' }))
    await act(async () => useAppStore.getState().setSetting('trackStyle', { ...style, glow: true, width: 4, glowWidth: 10 }))
    expect(view.text()).not.toContain(t('marker.track.glowTooNarrow', { width: '4 px' }))
    await view.stop()
  })
})
