// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { OFFSET_MAX_PX, withWidgetOffset } from '../overlay/settings'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { WidgetPosition } from './OverlayPanel'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null

/** « Position libre » of the logo at (10, 20); the first number field is x. */
async function mount() {
  const overlay = withWidgetOffset(DEFAULT_SETTINGS.overlay, 'logo', { x: 10, y: 20 })
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, overlay } })
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<WidgetPosition widget="logo" />))
  const x = host.querySelector<HTMLInputElement>('input[aria-roledescription="Number field"]')!
  const offsetX = () => useAppStore.getState().settings.overlay.logo.offset?.x
  return { x, offsetX }
}

/** What the browser does when the user edits a number field: set the text, fire `input`. */
async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const focus = (input: HTMLInputElement) => act(async () => input.focus())
const blur = (input: HTMLInputElement) => act(async () => input.blur())
const key = (input: HTMLInputElement, k: string) =>
  act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

describe('WidgetPosition: free position typed in pixels', () => {
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('shows the stored offsets', async () => {
    const { x } = await mount()
    expect(x.value).toBe('10')
  })

  it('lets the field be cleared, then a negative number be typed digit by digit', async () => {
    const { x, offsetX } = await mount()
    await focus(x)
    await type(x, '')
    expect(x.value).toBe('')
    expect(offsetX()).toBe(10)
    await type(x, '-') // a lone « - » is kept in the text, not applied
    expect(x.value).toBe('-')
    expect(offsetX()).toBe(10)
    await type(x, '-5')
    expect(x.value).toBe('-5')
    expect(offsetX()).toBe(-5)
  })

  it('clears the field then types 12', async () => {
    const { x, offsetX } = await mount()
    await focus(x)
    await type(x, '')
    await type(x, '1')
    expect(offsetX()).toBe(1)
    await type(x, '12')
    expect(x.value).toBe('12')
    expect(offsetX()).toBe(12)
  })

  it('clamps an out-of-range entry when leaving the field', async () => {
    const { x, offsetX } = await mount()
    await focus(x)
    await type(x, '99999')
    expect(offsetX()).toBe(10) // not applied while typing
    await blur(x)
    expect(offsetX()).toBe(OFFSET_MAX_PX)
    expect(x.value).toBe(String(OFFSET_MAX_PX))
  })

  it('puts the stored value back when the field is left empty', async () => {
    const { x, offsetX } = await mount()
    await focus(x)
    await type(x, '')
    await blur(x)
    expect(offsetX()).toBe(10)
    expect(x.value).toBe('10')
  })

  it('rounds on Enter and keeps the result in the field', async () => {
    const { x, offsetX } = await mount()
    await focus(x)
    await type(x, '3.6')
    await key(x, 'Enter')
    expect(offsetX()).toBe(4)
    expect(x.value).toBe('4')
  })

  it('puts the stored value back on Escape', async () => {
    const { x, offsetX } = await mount()
    await focus(x)
    await type(x, '99999')
    await key(x, 'Escape')
    expect(x.value).toBe('10')
    await blur(x)
    expect(offsetX()).toBe(10)
  })

  it('follows a change made elsewhere while the field is not focused', async () => {
    const { x } = await mount()
    await act(async () =>
      useAppStore.setState((s) => ({ settings: { ...s.settings, overlay: withWidgetOffset(s.settings.overlay, 'logo', { x: 77, y: 20 }) } })),
    )
    expect(x.value).toBe('77')
  })

  it('makes one undo step of a whole edit', async () => {
    const { x, offsetX } = await mount()
    const history = getSettingsHistory()
    history.clear()
    await focus(x)
    await type(x, '')
    await type(x, '1')
    await type(x, '12')
    await type(x, '123')
    await blur(x)
    expect(offsetX()).toBe(123)
    history.undo()
    expect(offsetX()).toBe(10)
    expect(history.getState().canUndo).toBe(false)
  })
})
