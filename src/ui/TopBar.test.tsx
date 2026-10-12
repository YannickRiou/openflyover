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
    const save = () => host.querySelector<HTMLButtonElement>('.topbar__save')!

    // open and save are icons with their name as label, and no « Enregistré » text
    expect(host.querySelector('button[aria-label="Ouvrir"]')?.textContent).toBe('')
    expect(save().getAttribute('aria-label')).toBe('Enregistrer')
    expect(save().className).not.toMatch(/--unsaved|--saved/)

    await act(async () => useAppStore.getState().setProjectName('Autre nom'))
    expect(save().className).toContain('topbar__save--unsaved')
    expect(save().getAttribute('aria-label')).toMatch(/non enregistrées/)

    await act(async () => useAppStore.getState().markProjectSaved())
    expect(save().className).toContain('topbar__save--saved')
    expect(save().className).not.toContain('--unsaved')
    await act(async () => void vi.advanceTimersByTime(3100))
    expect(save().className).not.toMatch(/--unsaved|--saved/)
    act(() => root.unmount())
  })
})
