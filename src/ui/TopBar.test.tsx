// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import type { WindowControls } from '../platform'
import { useAppStore } from '../state/store'
import { TopBar } from './TopBar'

// the desktop app, when a test sets `controls` or `isDesktop`: the website otherwise
const desktop = vi.hoisted(() => ({ controls: null as WindowControls | null, isDesktop: false }))
vi.mock('../platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('../platform')>()
  return {
    ...original,
    getPlatform: () => {
      const web = original.getPlatform()
      return desktop.controls || desktop.isDesktop
        ? { ...web, capabilities: { ...web.capabilities, isDesktop: true }, windowControls: desktop.controls ?? undefined }
        : web
    },
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  desktop.controls = null
  desktop.isDesktop = false
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

describe('TopBar: the output format on a phone', () => {
  it('is a button with the chosen format that opens the list: the checked row is the format, a pick sets it', async () => {
    useAppStore.getState().setFreeFraming(false)
    useAppStore.getState().setSetting('video', { ...useAppStore.getState().settings.video, aspect: '16:9' })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    // (the media queries do not apply here: the row and the button are both in the page, the stylesheet shows one)
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Format de sortie ("]')!
    expect(button.getAttribute('aria-label')).toBe('Format de sortie (Paysage 16:9)')
    await act(async () => button.click())
    const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(rows[0].textContent).toBe('Libre')
    expect(rows.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent)).toEqual(['Paysage 16:9'])
    await act(async () => rows[2].click())
    expect(useAppStore.getState().settings.video.aspect).toBe('9:16')
    expect(button.getAttribute('aria-label')).toMatch(/\(.*9:16\)/)
    await act(async () => button.click())
    await act(async () => document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[0].click())
    expect(useAppStore.getState().freeFraming).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Format de sortie (Libre)')
    act(() => root.unmount())
  })
})

describe('TopBar: the mode of the interface', () => {
  it('is not on the bar: it changes seldom, and « Réglages » has it', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    expect(host.querySelector('[role="radiogroup"][aria-label="Mode de l’interface"]')).toBeNull()
    act(() => root.unmount())
  })
})

describe('TopBar: the window buttons of the desktop app', () => {
  const mount = async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    return { host, root }
  }
  const button = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)

  it('are not on the website', async () => {
    const { host, root } = await mount()
    for (const name of ['Réduire', 'Agrandir', 'Restaurer', 'Fermer']) expect(button(host, name)).toBeNull()
    act(() => root.unmount())
  })

  it('are on the desktop after « Exporter »: the icon follows the state, close asks the window to close', async () => {
    let tell: (maximized: boolean) => void = () => {}
    const stop = vi.fn()
    const controls = {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(),
      watchMaximized: vi.fn((listener: (maximized: boolean) => void) => {
        tell = listener
        listener(false)
        return stop
      }),
    }
    desktop.controls = controls
    const { host, root } = await mount()
    await act(async () => button(host, 'Réduire')!.click())
    await act(async () => button(host, 'Agrandir')!.click())
    await act(async () => button(host, 'Fermer')!.click())
    expect(controls.minimize).toHaveBeenCalledTimes(1)
    expect(controls.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(controls.close).toHaveBeenCalledTimes(1)
    expect(button(host, 'Restaurer')).toBeNull()

    await act(async () => tell(true))
    expect(button(host, 'Agrandir')).toBeNull()
    expect(button(host, 'Restaurer')).not.toBeNull()
    // the bar moves the window by its empty areas
    expect(host.querySelector('header')?.hasAttribute('data-tauri-drag-region')).toBe(true)
    act(() => root.unmount())
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('are left to the system on macOS, whose traffic lights get room on the left of the bar', async () => {
    desktop.isDesktop = true
    const { host, root } = await mount()
    expect(button(host, 'Fermer')).toBeNull()
    expect(host.querySelector('header')?.className).toContain('pl-20')
    act(() => root.unmount())
  })
})
