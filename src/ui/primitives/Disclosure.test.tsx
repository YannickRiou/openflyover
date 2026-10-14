// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Disclosure } from './Disclosure'

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
const head = () => host.querySelector<HTMLButtonElement>('[data-testid="head"]')!
const body = () => host.querySelector<HTMLElement>('[data-testid="body"]')!

describe('Disclosure', () => {
  it('is a button that controls a body kept mounted and hidden while folded', async () => {
    const bodyRef = createRef<HTMLDivElement>()
    await render(
      <Disclosure head="Exposition" headTestId="head" bodyTestId="body" bodyRef={bodyRef} className="setting-row" headClassName="setting-row__head" bodyClassName="setting-row__body">
        <input data-testid="field" />
      </Disclosure>,
    )
    expect(head().tagName).toBe('BUTTON')
    expect(head().type).toBe('button')
    expect(head().textContent).toBe('Exposition')
    expect(head().className).toContain('setting-row__head')
    expect(body().className).toContain('setting-row__body')
    expect(host.firstElementChild!.className).toContain('setting-row')
    expect(bodyRef.current).toBe(body())
    expect(head().getAttribute('aria-expanded')).toBe('false')
    expect(head().getAttribute('aria-controls')).toBe(body().id)
    expect(body().hasAttribute('hidden')).toBe(true)
    // folded: the control is still in the page, it keeps its state
    expect(host.querySelector('[data-testid="field"]')).not.toBeNull()
  })

  it('unfolds and folds with a press, a key and tells which', async () => {
    const onOpenChange = vi.fn()
    await render(
      <Disclosure head="Exposition" headTestId="head" bodyTestId="body" onOpenChange={onOpenChange}>
        <input />
      </Disclosure>,
    )
    await act(async () => head().click())
    expect(head().getAttribute('aria-expanded')).toBe('true')
    expect(body().hasAttribute('hidden')).toBe(false)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    await act(async () => head().click())
    expect(head().getAttribute('aria-expanded')).toBe('false')
    expect(body().hasAttribute('hidden')).toBe(true)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})
