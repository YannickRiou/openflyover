// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateField } from './DateField'
import { TimeField } from './TimeField'

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

/** jsdom has no `matchMedia`: without it the segments are used, as on a desktop. */
const coarsePointer = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', addEventListener: () => undefined, removeEventListener: () => undefined }))

const render = (ui: React.ReactElement) => act(async () => root.render(ui))
const segment = (type: string) => host.querySelector<HTMLElement>(`[data-type="${type}"]`)!
const press = (el: Element, key: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
const nextFrame = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
/** The segments are loaded on first use (`lazy`): the browser's own input stands in until then. */
const renderLoaded = async (ui: React.ReactElement) => {
  await render(ui)
  for (let i = 0; i < 100 && !host.querySelector('[data-slot="date-input-group"]'); i++) await nextFrame()
}
const typeInto = (input: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })

function DayHarness({ onChange, start = '2026-06-15' }: { onChange(value: string): void; start?: string }) {
  const [day, setDay] = useState(start)
  return (
    <>
      <span id="day-label">Jour</span>
      <DateField
        aria-labelledby="day-label"
        value={day}
        onChange={(next) => {
          onChange(next)
          setDay(next)
        }}
      />
    </>
  )
}

describe('DateField', () => {
  it('shows the day in its segments, named by the label it points to, in the language of the application', async () => {
    await renderLoaded(<DayHarness onChange={() => undefined} />)
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toContain('day-label')
    expect(['day', 'month', 'year'].map((type) => segment(type).textContent)).toEqual(['15', '06', '2026'])
    // French order: day, month, year
    expect([...host.querySelectorAll('[data-type]')].filter((el) => el.getAttribute('data-type') !== 'literal').map((el) => el.getAttribute('data-type'))).toEqual(['day', 'month', 'year'])
  })

  it('calls back with the day as YYYY-MM-DD when a segment changes (arrows); a day cleared in part waits, \'\' comes once every segment is cleared', async () => {
    const onChange = vi.fn()
    await renderLoaded(<DayHarness onChange={onChange} />)
    await act(async () => segment('day').focus())
    await press(segment('day'), 'ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith('2026-06-16')
    await press(segment('month'), 'ArrowDown')
    expect(onChange).toHaveBeenLastCalledWith('2026-05-16')
    // Backspace takes one character off a segment: a day left incomplete is not stored
    onChange.mockClear()
    for (const [type, count] of [['day', 2], ['month', 1], ['year', 4]] as const) for (let i = 0; i < count; i++) await press(segment(type), 'Backspace')
    expect(onChange.mock.calls.slice(0, -1).every(([value]) => value !== '')).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('opens a calendar over the page whose cell picks the day; the day stays the stored one until then', async () => {
    const onChange = vi.fn()
    await renderLoaded(<DayHarness onChange={onChange} />)
    const trigger = host.querySelector<HTMLButtonElement>('[data-slot="date-picker-trigger"]')!
    expect(trigger).not.toBeNull()
    await act(async () => trigger.click())
    await nextFrame()
    const grid = document.querySelector('[role="grid"]')
    expect(grid).not.toBeNull()
    const cell = [...document.querySelectorAll<HTMLElement>('[role="gridcell"] [role="button"]')].find((c) => c.textContent === '20')!
    await act(async () => cell.click())
    await nextFrame()
    expect(onChange).toHaveBeenLastCalledWith('2026-06-20')
    // the choice closes it
    expect(document.querySelector('[role="grid"]')).toBeNull()
  })

  it('takes an empty day, and a value that is no day is shown as empty', async () => {
    await renderLoaded(<DateField aria-label="Jour" value="" onChange={() => undefined} />)
    expect(segment('day').getAttribute('data-placeholder')).toBe('true')
    await renderLoaded(<DateField aria-label="Jour" value="demain" onChange={() => undefined} />)
    expect(segment('day').getAttribute('data-placeholder')).toBe('true')
  })

  it('is the browser\'s own date input on a touch screen: same value, same call, `id`, label and `required` kept', async () => {
    coarsePointer()
    const onChange = vi.fn()
    await render(
      <>
        <label htmlFor="sun-date">Jour</label>
        <DateField id="sun-date" className="flex-1" required data-testid="day" value="2026-06-15" onChange={onChange} />
      </>,
    )
    const input = host.querySelector<HTMLInputElement>('input[type="date"]')!
    expect(input.id).toBe('sun-date')
    expect(input.labels?.[0]?.textContent).toBe('Jour')
    expect(input.required).toBe(true)
    expect(input.value).toBe('2026-06-15')
    expect(input.classList.contains('input')).toBe(true)
    expect(input.classList.contains('flex-1')).toBe(true)
    expect(input.getAttribute('data-testid')).toBe('day')
    await typeInto(input, '2026-07-01')
    expect(onChange).toHaveBeenCalledWith('2026-07-01')
    expect(host.querySelector('[role="group"]')).toBeNull()
  })
})

describe('TimeField', () => {
  function TimeHarness({ onChange }: { onChange(value: string): void }) {
    const [time, setTime] = useState('08:00')
    return (
      <TimeField
        aria-label="Départ"
        value={time}
        onChange={(next) => {
          onChange(next)
          setTime(next)
        }}
      />
    )
  }

  it('shows the time in 24 hours in its segments, named by `aria-label`', async () => {
    await renderLoaded(<TimeHarness onChange={() => undefined} />)
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Départ')
    expect([segment('hour').textContent, segment('minute').textContent]).toEqual(['08', '00'])
    expect(host.querySelector('[data-type="dayPeriod"]')).toBeNull()
  })

  it('calls back with the time as HH:mm when a segment changes, and with \'\' once both are cleared', async () => {
    const onChange = vi.fn()
    await renderLoaded(<TimeHarness onChange={onChange} />)
    await act(async () => segment('hour').focus())
    await press(segment('hour'), 'ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith('09:00')
    await press(segment('minute'), 'ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith('09:01')
    // a time cleared in part is not stored
    onChange.mockClear()
    await press(segment('hour'), 'Backspace')
    await press(segment('hour'), 'Backspace')
    expect(onChange).not.toHaveBeenCalled()
    await press(segment('minute'), 'Backspace')
    await press(segment('minute'), 'Backspace')
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('is the browser\'s own time input on a touch screen', async () => {
    coarsePointer()
    const onChange = vi.fn()
    await render(<TimeField aria-label="Départ" required value="08:00" onChange={onChange} />)
    const input = host.querySelector<HTMLInputElement>('input[type="time"]')!
    expect(input.getAttribute('aria-label')).toBe('Départ')
    expect(input.required).toBe(true)
    expect(input.value).toBe('08:00')
    await typeInto(input, '09:30')
    expect(onChange).toHaveBeenCalledWith('09:30')
  })
})
