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
