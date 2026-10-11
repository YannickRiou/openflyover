// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { showDiagnostic, useDiagnosticStore } from '../export/diagnostic'
import { DiagnosticDialog } from './DiagnosticDialog'

const REPORT = 'Rapport de diagnostic OpenFlyover\n\n[Appareil]\nVersion : 0.1.0, site web'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // not in jsdom
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<DiagnosticDialog />))
  await act(async () => showDiagnostic(REPORT))
  const dialog = host.querySelector('dialog')!
  const copy = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Copier le rapport')!
  return { host, root, dialog, copy }
}

describe('DiagnosticDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
    useDiagnosticStore.setState({ text: null })
    document.body.innerHTML = ''
  })

  it('opens on the report, copies it, says « Copié » for 2 s and closes', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const { root, dialog, copy, host } = await mount()
    expect(dialog.open).toBe(true)
    expect(host.querySelector('pre')!.textContent).toBe(REPORT)
    vi.useFakeTimers()
    await act(async () => copy.click())
    expect(writeText).toHaveBeenCalledWith(REPORT)
    expect(copy.textContent).toBe('Copié')
    await act(async () => vi.advanceTimersByTime(2000))
    expect(copy.textContent).toBe('Copier le rapport')
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click())
    expect(useDiagnosticStore.getState().text).toBeNull()
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('selects the text when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) } })
    const { root, copy, host } = await mount()
    await act(async () => copy.click())
    expect(copy.textContent).toBe('Copier le rapport')
    expect(getSelection()!.toString()).toBe(REPORT)
    expect(host.querySelector('[role="status"]')!.textContent).toMatch(/texte est sélectionné/)
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })
})
