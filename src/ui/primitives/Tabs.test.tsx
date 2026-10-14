// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tab, TabList, TabPanel, Tabs } from './Tabs'

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
const tabs = () => [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
const selected = () => tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.dataset.testid)
const key = (el: Element, name: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })))
/** A mouse press and release on `el`, as the browser sends them. */
const click = (el: Element) =>
  act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail: 1 })
      Object.defineProperty(event, 'pointerType', { value: 'mouse' })
      el.dispatchEvent(event)
    }
  })

function Demo({ orientation, disabled, onReselect }: { orientation?: 'horizontal' | 'vertical'; disabled?: boolean; onReselect?(value: string): void }) {
  const [value, setValue] = useState('a')
  return (
    <Tabs value={value} onChange={setValue} onReselect={onReselect} orientation={orientation}>
      <TabList label="Panneaux">
        <Tab id="a" data-testid="tab-a" tip="Alpha">
          A
        </Tab>
        <Tab id="b" data-testid="tab-b" disabled={disabled} tip="Bravo">
          B
        </Tab>
        <Tab id="c" data-testid="tab-c" tipDisabled>
          C
        </Tab>
      </TabList>
      {['a', 'b', 'c'].map((id) => (
        <TabPanel key={id} id={id} data-testid={`panel-${id}`}>
          <input data-testid={`field-${id}`} />
        </TabPanel>
      ))}
    </Tabs>
  )
}

describe('Tabs', () => {
  it('is a named tab list of tabs, one selected, one shown panel and the others kept mounted and inert', async () => {
    await render(<Demo orientation="vertical" />)
    const list = host.querySelector('[role="tablist"]')!
    expect(list.getAttribute('aria-label')).toBe('Panneaux')
    expect(list.getAttribute('aria-orientation')).toBe('vertical')
    expect(tabs().map((tab) => tab.dataset.testid)).toEqual(['tab-a', 'tab-b', 'tab-c'])
    expect(selected()).toEqual(['tab-a'])
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    // every panel (and what it holds) stays in the page; only the shown one is a tab panel
    expect(host.querySelectorAll('[data-testid^="field-"]')).toHaveLength(3)
    const shown = host.querySelectorAll('[role="tabpanel"]')
    expect([...shown].map((panel) => (panel as HTMLElement).dataset.testid)).toEqual(['panel-a'])
    expect(host.querySelector<HTMLElement>('[data-testid="panel-b"]')!.dataset.inert).toBe('true')
    expect(tabs()[0].getAttribute('aria-controls')).toBe(shown[0].id)
    expect(shown[0].getAttribute('aria-labelledby')).toBe(tabs()[0].id)
  })

  it('moves with the arrows of its axis (wrapping), Home and End, and the selection follows the focus', async () => {
    await render(<Demo orientation="vertical" />)
    tabs()[0].focus()
    await key(tabs()[0], 'ArrowDown')
    expect(selected()).toEqual(['tab-b'])
    expect(document.activeElement).toBe(tabs()[1])
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1])
    await key(tabs()[1], 'End')
    expect(selected()).toEqual(['tab-c'])
    await key(tabs()[2], 'ArrowDown')
    expect(selected()).toEqual(['tab-a'])
    await key(tabs()[0], 'ArrowUp')
    expect(selected()).toEqual(['tab-c'])
    await key(tabs()[2], 'Home')
    expect(selected()).toEqual(['tab-a'])
    expect(host.querySelector('[role="tabpanel"]')!.getAttribute('data-testid')).toBe('panel-a')
  })

  it('moves with left and right when horizontal', async () => {
    await render(<Demo orientation="horizontal" />)
    expect(host.querySelector('[role="tablist"]')!.getAttribute('aria-orientation')).toBe('horizontal')
    tabs()[0].focus()
    await key(tabs()[0], 'ArrowRight')
    expect(selected()).toEqual(['tab-b'])
    await key(tabs()[1], 'ArrowLeft')
    expect(selected()).toEqual(['tab-a'])
  })

  it('selects a pressed tab, and tells when the shown tab is pressed again (mouse, Enter, Space), not when it is only focused', async () => {
    const onReselect = vi.fn()
    await render(<Demo onReselect={onReselect} />)
    await click(tabs()[1])
    expect(selected()).toEqual(['tab-b'])
    expect(onReselect).not.toHaveBeenCalled()
    await act(async () => tabs()[1].blur())
    await act(async () => tabs()[1].focus())
    expect(onReselect).not.toHaveBeenCalled()
    await click(tabs()[1])
    expect(onReselect).toHaveBeenCalledTimes(1)
    expect(onReselect).toHaveBeenLastCalledWith('b')
    await key(tabs()[1], 'Enter')
    await act(async () => void tabs()[1].dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })))
    expect(onReselect).toHaveBeenCalledTimes(2)
    expect(selected()).toEqual(['tab-b'])
  })

  it('skips a disabled tab', async () => {
    const onReselect = vi.fn()
    await render(<Demo disabled onReselect={onReselect} />)
    expect(tabs()[1].getAttribute('aria-disabled')).toBe('true')
    await click(tabs()[1])
    expect(selected()).toEqual(['tab-a'])
    tabs()[0].focus()
    await key(tabs()[0], 'ArrowRight')
    expect(selected()).toEqual(['tab-c'])
    expect(onReselect).not.toHaveBeenCalled()
  })

  it('opens its tooltip on the tab itself after the pause, and not when the tooltip is disabled', async () => {
    await render(<Demo />)
    const hover = (el: Element) =>
      act(async () => {
        const event = new Event('pointerenter')
        Object.defineProperty(event, 'pointerType', { value: 'mouse' })
        el.dispatchEvent(event)
        vi.advanceTimersByTime(500)
      })
    await hover(tabs()[0])
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Alpha')
    await act(async () => void tabs()[0].dispatchEvent(new Event('pointerleave')))
    await hover(tabs()[2])
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})
