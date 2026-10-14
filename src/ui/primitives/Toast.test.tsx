// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'
import type { ToastMessage } from './Toast'

let host: HTMLElement
let root: Root

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no layout
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
})

beforeEach(() => {
  vi.useFakeTimers()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const msg = (id: number, over: Partial<ToastMessage> = {}): ToastMessage => ({ id, kind: 'success', text: `m${id}`, ...over })
const render = (toasts: ToastMessage[], onClose: (id: number) => void = () => {}) =>
  act(async () =>
    root.render(<Toast toasts={toasts} onClose={onClose} max={4} label="Messages" closeLabel="Fermer le message" closeTip="Fermer" />),
  )
const items = () => [...document.querySelectorAll<HTMLElement>('[data-testid="toast"]:not([data-exiting="true"])')]
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

describe('Toast', () => {
  it('keeps one live region and shows each message in it, an error as an alert', async () => {
    await render([msg(1), msg(2, { kind: 'error', text: 'boom' })])
    const region = host.querySelector('[aria-live="polite"]')!
    expect(region.querySelectorAll('[data-testid="toast"]').length).toBe(2)
    expect(region.querySelectorAll('[role="alert"]').length).toBe(1)
    expect(region.querySelector('[role="alert"]')!.textContent).toBe('boom')
    expect(region.querySelectorAll('[role="status"]').length).toBe(1)
  })

  it('closes a message by itself after its duration, never one without', async () => {
    const onClose = vi.fn()
    await render([msg(1, { duration: 5000 }), msg(2)], onClose)
    await wait(4900)
    expect(onClose).not.toHaveBeenCalled()
    await wait(200)
    expect(onClose).toHaveBeenCalledExactlyOnceWith(1)
    await wait(60_000)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    await render([msg(7)], onClose)
    await act(async () => host.ownerDocument.querySelector<HTMLElement>('button[aria-label="Fermer le message"]')!.click())
    expect(onClose).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('runs the action, then closes', async () => {
    const onClose = vi.fn()
    const run = vi.fn()
    await render([msg(3, { action: { label: 'Annuler', run } })], onClose)
    const action = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Annuler')!
    await act(async () => action.click())
    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('closes a message that leaves the list', async () => {
    await render([msg(1), msg(2)])
    expect(items().length).toBe(2)
    await render([msg(2)])
    await wait(400)
    expect(items().map((el) => el.textContent)).toEqual([expect.stringContaining('m2')])
  })
})
