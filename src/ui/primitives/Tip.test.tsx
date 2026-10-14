// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Tip } from './Tip'

let host: HTMLElement
let root: Root

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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

const render = (ui: React.ReactElement) => act(async () => root.render(ui))
const trigger = () => host.querySelector<HTMLElement>('button, span')!
const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]')
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))
/** A pointer event of `pointerType` (jsdom has no PointerEvent with that property). */
const pointer = (el: Element, type: string, pointerType = 'mouse') =>
  act(async () => {
    const event = new Event(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave' })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    el.dispatchEvent(event)
  })

describe('Tip', () => {
  it('leaves the element as it is: no wrapper, no tooltip until it is asked for', async () => {
    await render(
      <Tip text="Annuler">
        <Button variant="icon" aria-label="Annuler">
          x
        </Button>
      </Tip>,
    )
    expect(host.children).toHaveLength(1)
    expect(host.firstElementChild?.tagName).toBe('BUTTON')
    expect(tooltip()).toBeNull()
  })

  it('opens under the mouse after a short pause, closes when it leaves', async () => {
    await render(
      <Tip text="Annuler (Ctrl+Z)">
        <button type="button">x</button>
      </Tip>,
    )
    await pointer(trigger(), 'pointerenter')
    await wait(400)
    expect(tooltip()).toBeNull()
    await wait(100)
    expect(tooltip()?.textContent).toBe('Annuler (Ctrl+Z)')
    await pointer(trigger(), 'pointerleave')
    await wait(500)
    expect(tooltip()).toBeNull()
  })

  it('closes on a press, and on any key, Escape included, without taking the key from the app', async () => {
    await render(
      <Tip text="Fermer">
        <button type="button">x</button>
      </Tip>,
    )
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    await pointer(trigger(), 'pointerenter')
    await wait(500)
    expect(tooltip()).not.toBeNull()
    await act(async () => void trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    await wait(500)
    expect(tooltip()).toBeNull()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0].defaultPrevented).toBe(false)

    await pointer(trigger(), 'pointerenter')
    await wait(500)
    await pointer(trigger(), 'pointerdown')
    await wait(500)
    expect(tooltip()).toBeNull()
    document.removeEventListener('keydown', seen)
  })

  it('does not open for a finger passing over; a long press shows it until the finger lifts', async () => {
    await render(
      <Tip text="Garder">
        <button type="button">x</button>
      </Tip>,
    )
    await pointer(trigger(), 'pointerenter', 'touch')
    await wait(1000)
    expect(tooltip()).toBeNull()

    await pointer(trigger(), 'pointerdown', 'touch')
    await wait(200)
    expect(tooltip()).toBeNull()
    await wait(300)
    expect(tooltip()?.textContent).toBe('Garder')
    await pointer(trigger(), 'pointerup', 'touch')
    await wait(500)
    expect(tooltip()).toBeNull()

    // a short tap shows nothing
    await pointer(trigger(), 'pointerdown', 'touch')
    await wait(100)
    await pointer(trigger(), 'pointerup', 'touch')
    await wait(1000)
    expect(tooltip()).toBeNull()
  })

  it('with `tap`, a tap shows it until the element loses the focus', async () => {
    await render(
      <Tip text="Explication" tap>
        <span tabIndex={0}>i</span>
      </Tip>,
    )
    await pointer(trigger(), 'pointerdown', 'touch')
    await pointer(trigger(), 'pointerup', 'touch')
    await wait(500)
    expect(tooltip()?.textContent).toBe('Explication')
    await act(async () => void trigger().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    await wait(500)
    expect(tooltip()).toBeNull()
  })

  it('shows nothing without a text or when disabled, and wraps a sentence in the width given', async () => {
    await render(
      <>
        <Tip text="">
          <button type="button">a</button>
        </Tip>
        <Tip text="Pas ici" disabled>
          <button type="button">b</button>
        </Tip>
      </>,
    )
    for (const el of host.querySelectorAll('button')) {
      await pointer(el, 'pointerenter')
      await wait(1000)
      expect(tooltip()).toBeNull()
    }

    await render(
      <Tip text="Une phrase assez longue pour passer à la ligne." wrap={200}>
        <span>i</span>
      </Tip>,
    )
    await pointer(trigger(), 'pointerenter')
    await wait(500)
    expect(tooltip()?.style.maxWidth).toBe('200px')
    expect(tooltip()?.classList.contains('tip--wrap')).toBe(true)
  })

  it('opens inside the modal dialog that holds the element (the page behind it is inert, it would be hidden otherwise)', async () => {
    await render(
      <div role="dialog" data-modal="">
        <Tip text="Fermer (Échap)" side="left">
          <button type="button">x</button>
        </Tip>
      </div>,
    )
    await pointer(trigger(), 'pointerenter')
    await wait(500)
    expect(host.querySelector('[data-modal] [role="tooltip"]')?.textContent).toBe('Fermer (Échap)')
  })
})
