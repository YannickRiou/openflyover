// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Menu } from './Menu'
import type { MenuItem } from './Menu'

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
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
/** The focus goes back to the trigger a frame after the overlay is gone. */
const nextFrame = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const keyUp = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true })))

function items(onSelect: () => void = () => undefined): MenuItem[] {
  return [
    { id: 'undo', label: 'Annuler', icon: <svg data-testid="icon" />, onSelect },
    { id: 'redo', label: 'Rétablir', disabled: true, onSelect },
    { id: 'open', label: 'Ouvrir…', onSelect },
  ]
}

const withTrigger = (list: MenuItem[]) => (
  <Menu
    label="Plus d'actions"
    items={list}
    trigger={
      <Button variant="icon" aria-label="Plus d'actions">
        …
      </Button>
    }
  />
)

describe('Menu with a trigger', () => {
  it('opens on a click: a menu named by its label, the rows with their icon and text, the trigger says so', async () => {
    await render(withTrigger(items()))
    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-haspopup')).toBe('true')
    await act(async () => trigger().click())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(menu()?.getAttribute('aria-label')).toBe("Plus d'actions")
    expect(rows().map((r) => r.textContent)).toEqual(['Annuler', 'Rétablir', 'Ouvrir…'])
    expect(rows()[0].querySelector('[data-testid="icon"]')).not.toBeNull()
    expect(rows()[1].getAttribute('aria-disabled')).toBe('true')
  })

  it('belongs to the app root, not to the container of its trigger, and keeps its own Escape', async () => {
    await render(withTrigger(items()))
    await act(async () => trigger().click())
    expect(host.contains(menu())).toBe(false)
    // `handlesOwnEscape` (App.tsx) looks for this attribute above the target of the key: the app's Escape comes after
    expect(menu()?.closest('[data-local-escape]')).not.toBeNull()
  })

  it('picks a row with a click: its action runs, the menu closes', async () => {
    const onSelect = vi.fn()
    await render(withTrigger(items(onSelect)))
    await act(async () => trigger().click())
    await act(async () => rows()[2].click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  it('does not pick a disabled row', async () => {
    const onSelect = vi.fn()
    await render(withTrigger(items(onSelect)))
    await act(async () => trigger().click())
    await act(async () => rows()[1].click())
    expect(onSelect).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
  })

  it('opens with the arrow keys, moves with them over the disabled row, picks with Enter', async () => {
    const onSelect = vi.fn()
    await render(withTrigger(items(onSelect)))
    trigger().focus()
    await key(trigger(), 'ArrowDown')
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(rows()[0])
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(rows()[2])
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(rows()[0])
    await key(document.activeElement!, 'ArrowUp')
    expect(document.activeElement).toBe(rows()[2])
    await key(document.activeElement!, 'Enter')
    await keyUp(document.activeElement ?? document.body, 'Enter')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(menu()).toBeNull()
  })

  it('closes on Escape and gives the focus back to its trigger', async () => {
    await render(withTrigger(items()))
    trigger().focus()
    await key(trigger(), 'ArrowDown')
    await key(document.activeElement!, 'Escape')
    expect(menu()).toBeNull()
    await nextFrame()
    expect(document.activeElement).toBe(trigger())
  })
})

describe('Menu at a point', () => {
  it('is open, its first row focused, as long as it has a point; it takes none of the page', async () => {
    const onClose = vi.fn()
    await render(<Menu label="Ajouter ici" items={items()} point={{ x: 12, y: 34 }} onClose={onClose} />)
    expect(menu()?.getAttribute('aria-label')).toBe('Ajouter ici')
    expect(document.activeElement).toBe(rows()[0])
    const anchor = host.querySelector<HTMLElement>('.overlay-anchor')
    expect(anchor?.style.left).toBe('12px')
    expect(anchor?.style.top).toBe('34px')
    await render(<Menu label="Ajouter ici" items={items()} point={null} onClose={onClose} />)
    expect(menu()).toBeNull()
  })

  it('tells when it closes: on a pick (after the action) and on Escape', async () => {
    const calls: string[] = []
    const list = items(() => calls.push('select'))
    await render(<Menu label="Ajouter ici" items={list} point={{ x: 0, y: 0 }} onClose={() => calls.push('close')} />)
    await act(async () => rows()[0].click())
    expect(calls).toEqual(['select', 'close'])
    await key(document.activeElement ?? document.body, 'Escape')
    expect(calls).toEqual(['select', 'close', 'close'])
  })

  it('keeps the browser menu away while open', async () => {
    await render(<Menu label="Ajouter ici" items={items()} point={{ x: 0, y: 0 }} onClose={() => undefined} />)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await render(<Menu label="Ajouter ici" items={items()} point={null} onClose={() => undefined} />)
    const after = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
