// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { useExportStore } from '../export/store'
import { t } from '../i18n'
import { useHandViewStore } from '../scene/handView'
import { resetAppStore, useAppStore } from '../state/store'
import { buildTrack } from '../import/stats'
import { Stage } from './Stage'

const started = vi.hoisted(() => ({ calls: [] as boolean[] }))
// the 3D view and the overlay are their own chunks: not needed here
vi.mock('../scene/FlyoverCanvas', () => ({ FlyoverCanvas: () => null }))
vi.mock('../overlay/OverlayCanvas', () => ({ OverlayCanvas: () => null }))
vi.mock('../poster/export', () => ({ startStill: (camera?: boolean) => void started.calls.push(camera === true) }))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
})

function walk(): Track {
  const points: TrackPoint[] = Array.from({ length: 10 }, (_, i) => ({ lon: 6, lat: 45 + i * 0.0001, ele: 1000 + i }))
  return buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points }] })
}

let root: Root | null = null

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<Stage />))
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  return { button }
}

describe('Stage buttons', () => {
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    resetAppStore()
    useHandViewStore.setState({ away: false, returns: 0 })
    useExportStore.getState().reset()
    document.body.innerHTML = ''
    started.calls.length = 0
  })

  it('shows « Revenir à la vue du film » only when the view was moved away from the film’s, and asks the rig to place the camera again', async () => {
    useAppStore.getState().replaceTracks([walk()])
    const { button } = await mount()
    expect(button(t('stage.filmView'))).toBeNull()

    await act(async () => useHandViewStore.getState().setAway(true))
    const back = button(t('stage.filmView'))
    expect(back).not.toBeNull()
    await act(async () => back!.click())
    expect(useHandViewStore.getState().returns).toBe(1)

    await act(async () => useHandViewStore.getState().setAway(false))
    expect(button(t('stage.filmView'))).toBeNull()
  })

  it('« Capturer cette image » takes the film’s image, or the view as it is once moved by hand', async () => {
    useAppStore.getState().replaceTracks([walk()])
    const { button } = await mount()
    await act(async () => button(t('stage.capture'))!.click())
    await vi.waitFor(() => expect(started.calls).toEqual([false]))

    await act(async () => useHandViewStore.getState().setAway(true))
    await act(async () => button(t('stage.capture'))!.click())
    await vi.waitFor(() => expect(started.calls).toEqual([false, true]))
  })

  it('has no « Capturer cette image » in « Libre » (its view is not the film’s picture), and both buttons wait for the end of an export', async () => {
    useAppStore.getState().replaceTracks([walk()])
    useAppStore.getState().setFreeFraming(true)
    const { button } = await mount()
    expect(button(t('stage.capture'))).toBeNull()

    useAppStore.getState().setFreeFraming(false)
    useHandViewStore.setState({ away: true })
    await act(async () => useExportStore.setState({ phase: 'rendering' }))
    expect(button(t('stage.capture'))!.disabled).toBe(true)
    expect(button(t('stage.filmView'))!.disabled).toBe(true)
  })
})
