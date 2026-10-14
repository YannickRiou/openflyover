// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'
import type { SelectProps } from './Select'

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
  vi.unstubAllGlobals()
})

/** jsdom has no `matchMedia`: without it the list renderer is used, as on a desktop. */
const coarsePointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)', addEventListener: () => undefined, removeEventListener: () => undefined }))

const render = (ui: React.ReactElement) => act(async () => root.render(ui))
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
const native = () => host.querySelector<HTMLSelectElement>(':scope > select, :scope > div > select')!
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const keyUp = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true })))
const nextFrame = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))

const SPEEDS = [
  { value: 1, label: '×1' },
  { value: 2, label: '×2' },
  { value: 4, label: '×4', disabled: true },
]
const GROUPED: SelectProps<string>['options'] = [
  { value: '', label: 'Auto' },
  { label: 'Villes', options: [{ value: 'a', label: 'Annecy' }, { value: 'b', label: 'Bonneville' }] },
  { label: 'Cols', options: [{ value: 'c', label: 'Col des Aravis' }] },
]

function Demo({ onChange }: { onChange?: (value: number) => void }) {
  const [speed, setSpeed] = useState(1)
  return (
    <>
      <label htmlFor="speed">Vitesse</label>
      <Select
        id="speed"
        value={speed}
        options={SPEEDS}
        data-testid="speed"
        onChange={(next) => {
          setSpeed(next)
          onChange?.(next)
        }}
      />
    </>
  )
}

describe('Select as a list (a pointer that is not coarse)', () => {
  it('shows the chosen option on a button named by its label, and opens a list of options on a click', async () => {
    await render(<Demo />)
    expect(host.querySelector('select[data-testid]')).toBeNull()
    expect(trigger().id).toBe('speed')
    expect(trigger().getAttribute('data-testid')).toBe('speed')
    expect(trigger().textContent).toBe('×1')
    // the value comes first, then the label of the field
    const names = trigger().getAttribute('aria-labelledby')!.split(' ')
    expect(names.map((id) => document.getElementById(id)?.textContent)).toEqual(['×1', 'Vitesse'])
    expect(listbox()).toBeNull()
    await act(async () => trigger().click())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(rows().map((r) => r.textContent)).toEqual(['×1', '×2', '×4'])
    expect(rows()[0].getAttribute('aria-selected')).toBe('true')
    expect(rows()[2].getAttribute('aria-disabled')).toBe('true')
  })

  it('calls back with the value (a number stays a number), changes nothing by itself, and closes', async () => {
    const onChange = vi.fn()
    await render(<Demo onChange={onChange} />)
    await act(async () => trigger().click())
    await act(async () => rows()[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2)
    expect(trigger().textContent).toBe('×2')
    await nextFrame()
    expect(listbox()).toBeNull()
  })

  it('does not call back for the chosen option again, nor for a disabled one', async () => {
    const onChange = vi.fn()
    await render(<Demo onChange={onChange} />)
    await act(async () => trigger().click())
    await act(async () => rows()[0].click())
    await act(async () => trigger().click())
    await act(async () => rows()[2].click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is controlled: the value shown is the prop, whatever is picked', async () => {
    const onChange = vi.fn()
    await render(<Select aria-label="Vitesse" value={1} options={SPEEDS} onChange={onChange} />)
    await act(async () => trigger().click())
    await act(async () => rows()[1].click())
    expect(onChange).toHaveBeenCalledWith(2)
    expect(trigger().textContent).toBe('×1')
  })

  it('opens with the arrows, moves with them, picks with Enter; Escape closes the list and keeps the focus on the button', async () => {
    const onChange = vi.fn()
    await render(<Select aria-label="Vitesse" value={1} options={SPEEDS} onChange={onChange} />)
    trigger().focus()
    await key(trigger(), 'ArrowDown')
    expect(listbox()).not.toBeNull()
    // `handlesOwnEscape` (App.tsx) looks for this attribute above the target of the key: the app's Escape comes after
    expect(listbox()!.closest('[data-local-escape]')).not.toBeNull()
    expect(host.contains(listbox())).toBe(false)
    await key(listbox()!, 'Escape')
    await nextFrame()
    expect(listbox()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(onChange).not.toHaveBeenCalled()
    await key(trigger(), 'ArrowDown')
    await key(document.activeElement!, 'ArrowDown')
    await key(document.activeElement!, 'Enter')
    await keyUp(document.activeElement!, 'Enter')
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('a typed letter jumps to the option that starts with it', async () => {
    const onChange = vi.fn()
    await render(<Select aria-label="Lieu" value="" options={GROUPED} onChange={onChange} />)
    await act(async () => trigger().click())
    await key(listbox()!, 'b')
    expect(document.activeElement?.textContent).toBe('Bonneville')
  })

  it('groups: a heading over its options, an empty value is an option like another', async () => {
    const onChange = vi.fn()
    await render(<Select aria-label="Lieu" value="" options={GROUPED} onChange={onChange} />)
    expect(trigger().textContent).toBe('Auto')
    await act(async () => trigger().click())
    expect([...document.querySelectorAll('[role="group"]')].map((g) => g.textContent)).toEqual(['VillesAnnecyBonneville', 'ColsCol des Aravis'])
    await act(async () => rows()[3].click())
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('a disabled one cannot be opened, and a value without option shows nothing', async () => {
    await render(
      <>
        <Select aria-label="A" value={1} options={SPEEDS} onChange={() => undefined} disabled />
        <Select aria-label="B" value={9} options={SPEEDS} onChange={() => undefined} />
      </>,
    )
    const [a, b] = [...host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')]
    expect(a.disabled).toBe(true)
    await act(async () => a.click())
    expect(listbox()).toBeNull()
    expect(b.textContent?.trim()).toBe('')
  })

  it('opens inside the open dialog, so that it is not hidden behind it', async () => {
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.setAttribute('open', '')
    dialog.setAttribute('data-modal', '')
    const inner = dialog.appendChild(document.createElement('div'))
    const dialogRoot = createRoot(inner)
    await act(async () => dialogRoot.render(<Select aria-label="Vitesse" value={1} options={SPEEDS} onChange={() => undefined} />))
    await act(async () => inner.querySelector<HTMLButtonElement>('button')!.click())
    expect(dialog.contains(listbox())).toBe(true)
    await act(async () => dialogRoot.unmount())
  })
})

describe('Select on a touch screen (a coarse pointer)', () => {
  beforeEach(() => coarsePointer(true))

  it('is the native select, with the same options, value, label and test id', async () => {
    await render(<Demo />)
    expect(trigger()).toBeNull()
    const select = native()
    expect(select.id).toBe('speed')
    expect(select.getAttribute('data-testid')).toBe('speed')
    expect(select.labels?.[0]?.textContent).toBe('Vitesse')
    expect(select.value).toBe('1')
    expect([...select.options].map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ['1', '×1', false],
      ['2', '×2', false],
      ['4', '×4', true],
    ])
  })

  it('calls back with the value of the option, not its text: a number stays a number', async () => {
    const onChange = vi.fn()
    await render(<Demo onChange={onChange} />)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(native(), '2')
      native().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2)
    expect(native().value).toBe('2')
  })

  it('groups are optgroups, and the look and the layout classes are the same as the list renderer’s', async () => {
    await render(<Select aria-label="Lieu" look="bar" className="place__icon" value="b" options={GROUPED} onChange={() => undefined} disabled />)
    const select = native()
    expect(select.getAttribute('aria-label')).toBe('Lieu')
    expect(select.disabled).toBe(true)
    expect(select.value).toBe('b')
    expect([...select.querySelectorAll('optgroup')].map((g) => [g.label, g.children.length])).toEqual([
      ['Villes', 2],
      ['Cols', 1],
    ])
    expect(select.className).toBe('select-bar place__icon')
    coarsePointer(false)
    await render(<Select aria-label="Lieu" look="bar" className="place__icon" value="b" options={GROUPED} onChange={() => undefined} />)
    expect(trigger().classList.contains('select-bar')).toBe(true)
    expect(trigger().closest('.place__icon')).not.toBeNull()
  })
})
