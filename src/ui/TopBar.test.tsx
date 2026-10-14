// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'
import { TopBar } from './TopBar'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('TopBar: the save icon', () => {
  it('shows a dot while changes are unsaved, then the accent colour for a few seconds once saved', async () => {
    vi.useFakeTimers()
    const track = buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points: [6.8, 6.81].map((lon) => ({ lon, lat: 45.9, ele: 1000 })) }] })
    useAppStore.setState({ tracks: [track] })
    useAppStore.getState().markProjectSaved()
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    const save = () => host.querySelector<HTMLButtonElement>('[data-testid="topbar-save"]')!

    // open and save are icons with their name as label, and no « Enregistré » text
    expect(host.querySelector('button[aria-label="Ouvrir"]')?.textContent).toBe('')
    expect(save().getAttribute('aria-label')).toBe('Enregistrer')
    expect(save().dataset.saveState).toBeUndefined()

    await act(async () => useAppStore.getState().setProjectName('Autre nom'))
    expect(save().dataset.saveState).toBe('unsaved')
    expect(save().getAttribute('aria-label')).toMatch(/non enregistrées/)

    await act(async () => useAppStore.getState().markProjectSaved())
    expect(save().dataset.saveState).toBe('saved')
    await act(async () => void vi.advanceTimersByTime(3100))
    expect(save().dataset.saveState).toBeUndefined()
    act(() => root.unmount())
  })
})

describe('TopBar: the output format', () => {
  it('is a radio group named « Format de sortie »: an aspect sets the video, « Libre » frees the framing', async () => {
    useAppStore.getState().setFreeFraming(false)
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    const group = host.querySelector('[role="radiogroup"][aria-label="Format de sortie"]')!
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios[0].labels?.[0]?.textContent).toBe('Libre')
    expect(radios.filter((r) => r.checked)).toHaveLength(1)
    await act(async () => radios[2].click())
    expect(useAppStore.getState().settings.video.aspect).toBe('9:16')
    expect(radios[2].checked).toBe(true)
    await act(async () => radios[0].click())
    expect(useAppStore.getState().freeFraming).toBe(true)
    expect(useAppStore.getState().settings.video.aspect).toBe('9:16')
    expect(radios[0].checked).toBe(true)
    act(() => root.unmount())
  })
})
