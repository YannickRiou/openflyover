// @vitest-environment jsdom
import { act, createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { ColorField } from './ColorField'

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

const PRESETS = [
  { color: '#ffffff', label: 'Blanc', aria: 'Couleur du point : Blanc' },
  { color: '#c23b22', label: 'Rouge', aria: 'Couleur du point : Rouge' },
]

const nextFrame = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const button = () => host.querySelector<HTMLButtonElement>('button[aria-label="Couleur du point"]')!
const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Couleur du point"]')
const hexInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Code couleur (hexadécimal)"]')!
const option = (label: string) => host.querySelector<HTMLElement>(`[role="option"][aria-label="${label}"]`)!

/** What a screen does: the colour is its state. */
function Harness({ initial = '#c23b22', onChange }: { initial?: string; onChange?(color: string): void }) {
  const [value, setValue] = useState(initial)
  return (
    <ColorField
      id="dot"
      label="Couleur du point"
      value={value}
      presets={PRESETS}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    >
      <Button onClick={() => setValue('#000000')}>Comme la trace</Button>
    </ColorField>
  )
}

describe('ColorField', () => {
  it('is a button named by its label, the presets (the one in use selected) and what the screen adds', async () => {
    await act(async () => root.render(<Harness />))
    expect(button().id).toBe('dot')
    expect(panel()).toBeNull()
    expect(host.querySelector('[role="listbox"]')!.getAttribute('aria-label')).toBe('Couleur du point')
    expect(option('Couleur du point : Rouge').getAttribute('aria-selected')).toBe('true')
    expect(option('Couleur du point : Blanc').getAttribute('aria-selected')).toBe('false')
    expect(option('Couleur du point : Blanc').querySelector('[title="Blanc"]')).not.toBeNull()
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Comme la trace')
  })

  it('picks a preset in one tap, as a lowercase #rrggbb', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<Harness onChange={onChange} />))
    await act(async () => option('Couleur du point : Blanc').click())
    expect(onChange).toHaveBeenCalledWith('#ffffff')
    expect(option('Couleur du point : Blanc').getAttribute('aria-selected')).toBe('true')
  })

  it('opens a panel with the hex field on the colour, and a typed colour is given back as #rrggbb', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(<Harness onChange={onChange} />))
    await act(async () => button().click())
    expect(panel()).not.toBeNull()
    expect(host.contains(panel())).toBe(false)
    expect(hexInput().value.toLowerCase()).toBe('#c23b22')
    const input = hexInput()
    input.focus()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#336699')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await key(input, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith('#336699')
    // the screen's own value reaches the panel as well (an undo): the hex field follows it
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Comme la trace')!.click())
    expect(hexInput().value.toLowerCase()).toBe('#000000')
  })

  it('closes its panel on Escape and gives the focus back to its button', async () => {
    await act(async () => root.render(<Harness />))
    button().focus()
    await act(async () => button().click())
    await key(hexInput(), 'Escape')
    expect(panel()).toBeNull()
    await nextFrame()
    expect(document.activeElement).toBe(button())
  })

  it('is the button alone as a dot, which a Tip can reach through its ref', async () => {
    const ref = createRef<HTMLButtonElement>()
    const onChange = vi.fn()
    await act(async () =>
      root.render(<ColorField dot className="track__swatch" ref={ref} label="Couleur du point" value="#ff5a36" onChange={onChange} />),
    )
    expect(host.querySelectorAll('button').length).toBe(1)
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(ref.current).toBe(button())
    expect(button().classList.contains('track__swatch')).toBe(true)
  })

  it('shows black for a value that is not a colour', async () => {
    await act(async () => root.render(<ColorField dot label="Couleur du point" value="" onChange={() => undefined} />))
    await act(async () => button().click())
    expect(hexInput().value.toLowerCase()).toBe('#000000')
  })
})
