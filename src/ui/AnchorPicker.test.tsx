// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CREDITS_POSITIONS } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { AnchorPicker } from './AnchorPicker'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = host = null
})

function mount(value: OverlayAnchor, allowed?: readonly OverlayAnchor[]) {
  const onChange = vi.fn()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root?.render(<AnchorPicker label="Position" value={value} allowed={allowed} onChange={onChange} />))
  const cells = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  const press = (cell: HTMLInputElement, key: string) => act(() => void cell.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  return { cells, onChange, press }
}

describe('AnchorPicker', () => {
  it('offers the nine anchors, the arrows choose the next one', () => {
    const { cells, onChange, press } = mount('top-left')
    expect(cells).toHaveLength(9)
    expect(cells.every((cell) => !cell.disabled)).toBe(true)
    expect(cells[0].checked).toBe(true)
    press(cells[0], 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('top-center')
    act(() => cells[8].click())
    expect(onChange).toHaveBeenLastCalledWith('bottom-right')
  })

  it('limited to the corners: the other cells are disabled and skipped by the arrows', () => {
    const { cells, onChange, press } = mount('bottom-right', CREDITS_POSITIONS)
    expect(cells.filter((cell) => !cell.disabled).map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'En haut à gauche',
      'En haut à droite',
      'En bas à gauche',
      'En bas à droite',
    ])
    press(cells[8], 'ArrowLeft')
    expect(onChange).toHaveBeenLastCalledWith('bottom-left')
    press(cells[8], 'ArrowUp')
    expect(onChange).toHaveBeenLastCalledWith('top-right')
    // at the edge: stays
    onChange.mockClear()
    press(cells[8], 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('bottom-right')
  })
})
