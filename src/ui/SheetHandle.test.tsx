// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { t } from '../i18n'
import { SheetHandle } from './SheetHandle'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function show(onClose = () => undefined) {
  const sheet = document.body.appendChild(document.createElement('aside'))
  const root = createRoot(sheet)
  await act(async () => root.render(<SheetHandle title="Titre" onClose={onClose} />))
  const button = (label: string) => sheet.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  return { sheet, button, stop: () => act(() => root.unmount()) }
}

describe('SheetHandle', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('« Agrandir » marks the sheet expanded and « Réduire » takes it back', async () => {
    const view = await show()
    expect(view.sheet.hasAttribute('data-expanded')).toBe(false)
    await act(async () => view.button(t('common.sheetExpand')).click())
    expect(view.sheet.hasAttribute('data-expanded')).toBe(true)
    await act(async () => view.button(t('common.sheetCollapse')).click())
    expect(view.sheet.hasAttribute('data-expanded')).toBe(false)
    await view.stop()
  })

  it('« Terminé » closes the sheet and leaves it at its usual height for the next time', async () => {
    const onClose = vi.fn()
    const view = await show(onClose)
    await act(async () => view.button(t('common.sheetExpand')).click())
    await act(async () => view.button(t('common.done')).click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(view.sheet.hasAttribute('data-expanded')).toBe(false)
    await view.stop()
  })
})
