// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { showDiagnostic, useDiagnosticStore } from '../export/diagnostic'
import { DiagnosticDialog } from './DiagnosticDialog'

const REPORT = 'Rapport de diagnostic OpenFlyover\n\n[Appareil]\nVersion : 0.1.0, site web'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<DiagnosticDialog />))
  await act(async () => showDiagnostic(REPORT))
  // the modal puts the focus in itself a frame after it is open
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
  // portalled out of the host, with the rest of the modal
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const copy = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Copier le rapport')!
  return { root, dialog, copy }
}

describe('DiagnosticDialog', () => {
  afterEach(async () => {
    vi.useRealTimers()
    useDiagnosticStore.setState({ text: null })
    // the modal restores the focus a frame after it is gone
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
    document.body.innerHTML = ''
  })

  it('opens on the report, copies it, says « Copié » for 2 s and closes', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const { root, dialog, copy } = await mount()
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')!.id)
    expect(dialog.querySelector('h2')!.textContent).toBe('Rapport de diagnostic')
    expect(dialog.querySelector('pre')!.textContent).toBe(REPORT)
    vi.useFakeTimers()
    await act(async () => copy.click())
    expect(writeText).toHaveBeenCalledWith(REPORT)
    expect(copy.textContent).toBe('Copié')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(copy.textContent).toBe('Copier le rapport')
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click())
    expect(useDiagnosticStore.getState().text).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('selects the text when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } })
    const { root, dialog, copy } = await mount()
    await act(async () => copy.click())
    expect(copy.textContent).toBe('Copier le rapport')
    expect(getSelection()!.toString()).toBe(REPORT)
    expect(dialog.querySelector('[role="status"]')!.textContent).toMatch(/texte est sélectionné/)
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })
})
