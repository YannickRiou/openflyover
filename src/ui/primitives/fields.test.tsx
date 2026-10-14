// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from './NumberField'
import { Slider } from './Slider'
import { TextField } from './TextField'

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
const press = (el: Element, key: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
/** What the browser does when the user edits a field: set the text, fire `input`. */
const type = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('Slider', () => {
  const range = () => host.querySelector<HTMLInputElement>('input[type="range"]')!

  it('is a range input named by `aria-label`, with the written value in an output and the spoken one as value text', async () => {
    await render(
      <Slider aria-label="Exposition" min={-2} max={2} step={0.5} value={0.5} onChange={() => undefined} format={(v) => `${v} IL`} spoken={(v) => `plus ${v}`} />,
    )
    const input = range()
    expect([input.min, input.max, input.step, input.value]).toEqual(['-2', '2', '0.5', '0.5'])
    // the thumb is named through the group, which carries the name
    const group = host.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('Exposition')
    expect(input.getAttribute('aria-labelledby')).toBe(group.id)
    expect(host.querySelector('output')?.textContent).toBe('0.5 IL')
    expect(input.getAttribute('aria-valuetext')).toBe('plus 0.5')
  })

  it('calls back with the number on a change and on Home / End / Page Up, and never twice with the same value', async () => {
    const onChange = vi.fn()
    function Harness() {
      const [value, setValue] = useState(10)
      return (
        <Slider
          aria-label="Durée"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(v) => {
            onChange(v)
            setValue(v)
          }}
        />
      )
    }
    await render(<Harness />)
    await type(range(), '25')
    expect(onChange).toHaveBeenLastCalledWith(25)
    await type(range(), '25')
    expect(onChange).toHaveBeenCalledTimes(1)
    await press(range(), 'Home')
    expect(onChange).toHaveBeenLastCalledWith(0)
    await press(range(), 'End')
    expect(onChange).toHaveBeenLastCalledWith(100)
    await press(range(), 'PageDown')
    expect(onChange.mock.calls.at(-1)![0]).toBeLessThan(100)
    expect(range().value).toBe(String(onChange.mock.calls.at(-1)![0]))
  })

  it('has no output without `format`, takes the `below` slot, and a disabled one does not move', async () => {
    const onChange = vi.fn()
    await render(
      <Slider aria-label="Zoom" min={0} max={10} step={1} value={3} onChange={onChange} disabled below={<i data-testid="bar" />} />,
    )
    expect(host.querySelector('output')).toBeNull()
    expect(host.querySelector('[data-testid="bar"]')).not.toBeNull()
    expect(range().disabled).toBe(true)
    await press(range(), 'End')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('NumberField', () => {
  const field = () => host.querySelector<HTMLInputElement>('input[aria-roledescription="Number field"]')!
  const focus = () => act(async () => field().focus())
  const blur = () => act(async () => field().blur())

  function Harness({ live = false, onChange }: { live?: boolean; onChange(value: number): void }) {
    const [value, setValue] = useState(10)
    return (
      <NumberField
        label="Durée"
        min={0}
        max={60}
        step={1}
        live={live}
        value={value}
        onChange={(v) => {
          onChange(v)
          setValue(v)
        }}
      />
    )
  }

  it('is named by its label and shows the value without a thousands separator', async () => {
    await render(<NumberField label="Départ" min={0} max={5000} step={1} value={1500} onChange={() => undefined} />)
    expect(field().labels?.[0]?.textContent).toBe('Départ')
    expect(field().value).toBe('1500')
  })

  it('settles the entry on Enter or on leaving the field: within the range, on the notches of the step', async () => {
    const onChange = vi.fn()
    await render(<Harness onChange={onChange} />)
    await focus()
    await type(field(), '3.6')
    expect(onChange).not.toHaveBeenCalled()
    await blur()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(4)
    expect(field().value).toBe('4')
    await focus()
    await type(field(), '999')
    await blur()
    expect(onChange).toHaveBeenLastCalledWith(60)
  })

  it('puts the stored value back when the entry is empty', async () => {
    const onChange = vi.fn()
    await render(<Harness onChange={onChange} />)
    await focus()
    await type(field(), '')
    await blur()
    expect(onChange).not.toHaveBeenCalled()
    expect(field().value).toBe('10')
  })

  it('`live` applies each number typed within the range at once, and Escape puts the stored value back in the text', async () => {
    const onChange = vi.fn()
    await render(<Harness live onChange={onChange} />)
    await focus()
    await type(field(), '2')
    expect(onChange).toHaveBeenLastCalledWith(2)
    await type(field(), '25')
    expect(onChange).toHaveBeenLastCalledWith(25)
    await type(field(), '250')
    expect(onChange).toHaveBeenCalledTimes(2)
    await press(field(), 'Escape')
    expect(field().value).toBe('25')
  })
})

describe('TextField', () => {
  it('is named by its label, calls back with the text (not the event) and keeps the project look', async () => {
    const onChange = vi.fn()
    await render(<TextField label="Titre" placeholder="Sans titre" maxLength={5} value="Col" onChange={onChange} />)
    const input = host.querySelector<HTMLInputElement>('input')!
    expect(input.labels?.[0]?.textContent).toBe('Titre')
    expect(input.placeholder).toBe('Sans titre')
    expect(input.maxLength).toBe(5)
    expect(input.classList.contains('input')).toBe(true)
    await type(input, 'Col de')
    expect(onChange).toHaveBeenCalledWith('Col de')
  })

  it('is named by `aria-label` without a label, and a disabled one is disabled', async () => {
    await render(<TextField aria-label="Nom du projet" value="" onChange={() => undefined} disabled title="Renommer" />)
    const input = host.querySelector<HTMLInputElement>('input')!
    expect(input.getAttribute('aria-label')).toBe('Nom du projet')
    expect(input.disabled).toBe(true)
    expect(host.querySelector('[title="Renommer"]')).not.toBeNull()
  })
})
