// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Checkbox } from './Checkbox'
import { Chip } from './Chip'
import { Radio, RadioGroup } from './RadioGroup'
import { Switch } from './Switch'
import { ToggleButton, ToggleButtonGroup } from './ToggleButtonGroup'

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
const inputs = (selector = 'input') => [...host.querySelectorAll<HTMLInputElement>(selector)]
const press = (el: Element, key: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe('Switch, Checkbox and Chip', () => {
  it('a switch is named by its label and calls back with the new value, not an event', async () => {
    const onChange = vi.fn()
    await render(
      <Switch checked={false} onChange={onChange} aria-describedby="hint">
        Afficher l’habillage
      </Switch>,
    )
    const [input] = inputs()
    expect(input.getAttribute('role')).toBe('switch')
    expect(input.labels?.[0]?.textContent).toBe('Afficher l’habillage')
    expect(input.getAttribute('aria-describedby')).toBe('hint')
    await act(async () => input.click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('a checkbox is controlled by `checked`, and a disabled one does not call back', async () => {
    const onChange = vi.fn()
    await render(
      <>
        <Checkbox checked onChange={onChange} id="shadows">
          Ombres
        </Checkbox>
        <Checkbox checked={false} onChange={onChange} disabled>
          Météo
        </Checkbox>
      </>,
    )
    const [shadows, weather] = inputs()
    expect(shadows.checked).toBe(true)
    expect(shadows.id).toBe('shadows')
    expect(weather.disabled).toBe(true)
    await act(async () => weather.click())
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => shadows.click())
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('a title is a native tooltip over the whole control, without a box of its own', async () => {
    await render(
      <Chip checked={false} onChange={() => {}} disabled title="Absent de la trace">
        Vitesse
      </Chip>,
    )
    const box = host.querySelector<HTMLElement>('[title]')!
    expect(box.title).toBe('Absent de la trace')
    expect(box.style.display).toBe('contents')
    expect(box.querySelector('input')!.disabled).toBe(true)
    expect(box.textContent).toBe('Vitesse')
  })
})

describe('RadioGroup', () => {
  function Group({ onChange }: { onChange(v: string): void }) {
    const [value, setValue] = useState('a')
    return (
      <RadioGroup
        aria-label="Choix"
        value={value}
        onChange={(v) => {
          setValue(v)
          onChange(v)
        }}
      >
        <Radio value="a">Un</Radio>
        <Radio value="b" disabled>
          Deux
        </Radio>
        <Radio value="c">Trois</Radio>
      </RadioGroup>
    )
  }

  it('is a radio group named by its label, the options by theirs', async () => {
    await render(<Group onChange={() => {}} />)
    expect(host.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Choix')
    expect(inputs().map((i) => [i.labels?.[0]?.textContent, i.checked, i.disabled])).toEqual([
      ['Un', true, false],
      ['Deux', false, true],
      ['Trois', false, false],
    ])
  })

  it('the arrows move to the next option and choose it, skipping the disabled one', async () => {
    const onChange = vi.fn()
    await render(<Group onChange={onChange} />)
    const [first] = inputs()
    await act(async () => first.focus())
    await press(first, 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('c')
    expect(inputs()[2].checked).toBe(true)
    await press(inputs()[2], 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith('a')
  })

  it('numbers stay numbers', async () => {
    const onChange = vi.fn()
    await render(
      <RadioGroup aria-label="Images par seconde" value={30} onChange={onChange}>
        <Radio value={24}>24</Radio>
        <Radio value={30}>30</Radio>
      </RadioGroup>,
    )
    expect(inputs()[1].checked).toBe(true)
    await act(async () => inputs()[0].click())
    expect(onChange).toHaveBeenCalledWith(24)
  })

  it('pills of a single choice and a plain grid are radios too', async () => {
    await render(
      <>
        <RadioGroup look="chips" aria-label="Pointillé" value="x" onChange={() => {}}>
          <Radio value="x">Plein</Radio>
        </RadioGroup>
        <RadioGroup look="plain" aria-label="Position" value="top-left" onChange={() => {}}>
          <Radio value="top-left" aria-label="En haut à gauche" />
        </RadioGroup>
      </>,
    )
    const [pill, cell] = inputs()
    expect(pill.checked).toBe(true)
    expect(cell.getAttribute('aria-label')).toBe('En haut à gauche')
  })
})

describe('ToggleButtonGroup', () => {
  it('chooses one button at a time, the arrows move between them', async () => {
    const onChange = vi.fn()
    function Tabs() {
      const [tab, setTab] = useState('contenu')
      return (
        <ToggleButtonGroup
          aria-label="Réglages de l’élément"
          value={tab}
          onChange={(next) => {
            setTab(next)
            onChange(next)
          }}
        >
          <ToggleButton value="contenu">Contenu</ToggleButton>
          <ToggleButton value="style">Style</ToggleButton>
        </ToggleButtonGroup>
      )
    }
    await render(<Tabs />)
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')]
    expect(host.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Réglages de l’élément')
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['Contenu', 'true'],
      ['Style', 'false'],
    ])
    await act(async () => buttons[1].click())
    expect(onChange).toHaveBeenLastCalledWith('style')
    // the chosen one cannot be switched off by pressing it again
    await act(async () => buttons[1].click())
    expect(buttons[1].getAttribute('aria-checked')).toBe('true')
  })
})
