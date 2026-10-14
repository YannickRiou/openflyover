// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Popover } from './Popover'

let host: HTMLElement
let root: Root

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const render = (ui: React.ReactElement) => act(async () => root.render(ui))
const trigger = () => host.querySelector<HTMLButtonElement>('button')!
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')
/** The focus goes back to the trigger a frame after the overlay is gone. */
const nextFrame = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

const withTrigger = (children: React.ComponentProps<typeof Popover>['children']) => (
  <Popover
    label="Options du film"
    placement="top end"
    width={260}
    trigger={
      <Button variant="icon" aria-label="Options du film">
        …
      </Button>
    }
  >
    {children}
  </Popover>
)

describe('Popover with a trigger', () => {
  it('opens on a click: a dialog named by its label with its content, out of the container of its trigger', async () => {
    await render(withTrigger(<p>Arrêts automatiques</p>))
    expect(panel()).toBeNull()
    await act(async () => trigger().click())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(panel()?.getAttribute('aria-label')).toBe('Options du film')
    expect(panel()?.textContent).toBe('Arrêts automatiques')
    expect(host.contains(panel())).toBe(false)
    expect(panel()?.closest<HTMLElement>('.popover-panel')?.style.width).toBe('260px')
    // `handlesOwnEscape` (App.tsx) looks for this attribute above the target of the key: the app's Escape comes after
    expect(panel()?.closest('[data-local-escape]')).not.toBeNull()
  })

  it('keeps its own controls: Tab reaches them, they can shut it with `close`', async () => {
    const onPick = vi.fn()
    await render(
      withTrigger((close) => (
        <Button
          onClick={() => {
            close()
            onPick()
          }}
        >
          Ajouter une musique…
        </Button>
      )),
    )
    await act(async () => trigger().click())
    const inner = panel()!.querySelector<HTMLButtonElement>('button')!
    await act(async () => inner.click())
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(panel()).toBeNull()
  })

  it('closes on Escape and gives the focus back to its trigger', async () => {
    await render(withTrigger(<input aria-label="Nom" />))
    trigger().focus()
    await act(async () => trigger().click())
    await key(panel()!.querySelector('input') ?? panel()!, 'Escape')
    expect(panel()).toBeNull()
    await nextFrame()
    expect(document.activeElement).toBe(trigger())
  })
})

describe('Popover at a point', () => {
  it('is open as long as it has a point, and tells when it closes', async () => {
    const onClose = vi.fn()
    await render(
      <Popover label="Point d'intérêt" point={{ x: 5, y: 6 }} onClose={onClose}>
        <input aria-label="Nom" autoFocus />
      </Popover>,
    )
    expect(panel()?.getAttribute('aria-label')).toBe("Point d'intérêt")
    expect(host.querySelector<HTMLElement>('.overlay-anchor')?.style.left).toBe('5px')
    expect(document.activeElement).toBe(panel()!.querySelector('input'))
    await key(document.activeElement!, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    await render(
      <Popover label="Point d'intérêt" point={null} onClose={onClose}>
        <input aria-label="Nom" />
      </Popover>,
    )
    expect(panel()).toBeNull()
  })
})
