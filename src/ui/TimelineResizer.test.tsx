// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPlatform } from '../platform'
import { TIMELINE_HEIGHT_KEY, TIMELINE_STEP_LARGE_PX, TIMELINE_STEP_PX, timelineHeightRange } from './layoutSize'
import { TimelineResizer } from './TimelineResizer'

const VIEW_H = 800
const NATURAL_H = 200
const { min, max } = timelineHeightRange(VIEW_H)

let host: HTMLElement
let root: Root

const setViewHeight = (px: number) => Object.defineProperty(host, 'clientHeight', { value: px, configurable: true })

/** the shell's `.view`: jsdom has no layout, so its height and the timeline's natural one are set by hand */
async function mount(disabled = false) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.body.appendChild(document.createElement('main'))
  host.className = 'view'
  setViewHeight(VIEW_H)
  root = createRoot(host)
  await act(async () => root.render(<TimelineResizer disabled={disabled} />))
  const timeline = host.appendChild(document.createElement('div'))
  timeline.className = 'film-tl'
  Object.defineProperty(timeline, 'offsetHeight', { value: NATURAL_H })
  await act(async () => window.dispatchEvent(new Event('resize')))
  return host.querySelector<HTMLElement>('[role="separator"]')!
}

const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const pointer = (el: HTMLElement, type: string, clientY: number) =>
  act(async () => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY })))
const now = (el: HTMLElement) => Number(el.getAttribute('aria-valuenow'))
const stored = () => getPlatform().storage.get(TIMELINE_HEIGHT_KEY)

describe('TimelineResizer', () => {
  beforeEach(() => getPlatform().storage.remove(TIMELINE_HEIGHT_KEY))
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('is a focusable horizontal separator that shows the timeline height and leaves the layout alone until it is moved', async () => {
    const handle = await mount()
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
    expect(handle.getAttribute('aria-label')).toBe('Taille de la timeline')
    expect(handle.tabIndex).toBe(0)
    expect(now(handle)).toBe(NATURAL_H)
    expect(Number(handle.getAttribute('aria-valuemin'))).toBe(min)
    expect(Number(handle.getAttribute('aria-valuemax'))).toBe(max)
    expect(host.hasAttribute('data-timeline-sized')).toBe(false)
    expect(host.style.getPropertyValue('--timeline-h')).toBe('')
  })

  it('moves by a step with Up / Down, a larger one with Shift, and remembers it', async () => {
    const handle = await mount()
    await key(handle, 'ArrowUp')
    expect(now(handle)).toBe(NATURAL_H + TIMELINE_STEP_PX)
    expect(host.style.getPropertyValue('--timeline-h')).toBe(`${NATURAL_H + TIMELINE_STEP_PX}px`)
    expect(host.hasAttribute('data-timeline-sized')).toBe(true)
    await key(handle, 'ArrowDown', { shiftKey: true })
    expect(now(handle)).toBe(NATURAL_H + TIMELINE_STEP_PX - TIMELINE_STEP_LARGE_PX)
    expect(stored()).toBe(`{"timelineH":${now(handle)}}`)
  })

  it('goes to the smallest and the largest height with Home / End, and stays within them', async () => {
    const handle = await mount()
    await key(handle, 'End')
    expect(now(handle)).toBe(max)
    await key(handle, 'ArrowUp', { shiftKey: true })
    expect(now(handle)).toBe(max)
    await key(handle, 'Home')
    expect(now(handle)).toBe(min)
    await key(handle, 'ArrowDown')
    expect(now(handle)).toBe(min)
  })

  it('leaves a key it does not use to the shortcuts, and takes the ones it uses away from them', async () => {
    const handle = await mount()
    const other = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    const used = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    await act(async () => void handle.dispatchEvent(other))
    await act(async () => void handle.dispatchEvent(used))
    expect(other.defaultPrevented).toBe(false)
    expect(used.defaultPrevented).toBe(true)
  })

  it('follows a drag (up makes the timeline taller), within the limits, and remembers the end of it', async () => {
    const handle = await mount()
    await pointer(handle, 'pointerdown', 500)
    expect(handle.dataset.dragging).toBeDefined()
    await pointer(handle, 'pointermove', 450)
    expect(now(handle)).toBe(NATURAL_H + 50)
    expect(stored()).toBeNull() // only at the end
    await pointer(handle, 'pointermove', 5000)
    expect(now(handle)).toBe(min)
    await pointer(handle, 'pointermove', -5000)
    expect(now(handle)).toBe(max)
    await pointer(handle, 'pointerup', -5000)
    expect(handle.dataset.dragging).toBeUndefined()
    expect(stored()).toBe(`{"timelineH":${max}}`)
  })

  it('does not remember a press without a move', async () => {
    const handle = await mount()
    await pointer(handle, 'pointerdown', 500)
    await pointer(handle, 'pointerup', 500)
    expect(stored()).toBeNull()
    expect(host.hasAttribute('data-timeline-sized')).toBe(false)
  })

  it('goes back to the default layout with a double-click', async () => {
    const handle = await mount()
    await key(handle, 'ArrowUp')
    expect(stored()).not.toBeNull()
    await act(async () => void handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(now(handle)).toBe(NATURAL_H)
    expect(host.hasAttribute('data-timeline-sized')).toBe(false)
    expect(host.style.getPropertyValue('--timeline-h')).toBe('')
    expect(stored()).toBeNull()
  })

  it('starts from the remembered height, kept within the window', async () => {
    getPlatform().storage.set(TIMELINE_HEIGHT_KEY, '{"timelineH":5000}')
    const handle = await mount()
    expect(now(handle)).toBe(max)
    expect(host.style.getPropertyValue('--timeline-h')).toBe(`${max}px`)
  })

  it('ignores a corrupt stored value', async () => {
    getPlatform().storage.set(TIMELINE_HEIGHT_KEY, 'not json')
    const handle = await mount()
    expect(now(handle)).toBe(NATURAL_H)
    expect(host.hasAttribute('data-timeline-sized')).toBe(false)
  })

  it('is inert during an export', async () => {
    const handle = await mount(true)
    expect(handle.getAttribute('aria-disabled')).toBe('true')
    expect(handle.tabIndex).toBe(-1)
    await key(handle, 'ArrowUp')
    await pointer(handle, 'pointerdown', 500)
    await pointer(handle, 'pointermove', 400)
    await act(async () => void handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(now(handle)).toBe(NATURAL_H)
    expect(stored()).toBeNull()
  })

  it('keeps the height within the space left when the window is resized', async () => {
    const handle = await mount()
    await key(handle, 'End')
    setViewHeight(400)
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(now(handle)).toBe(timelineHeightRange(400).max)
    // the remembered height is not lost: a taller window gives it back
    setViewHeight(VIEW_H)
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(now(handle)).toBe(max)
  })
})
