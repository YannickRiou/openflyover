// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, useAppStore } from '../../state/store'
import { RangeField, SettingRow } from '../PanelSection'
import { Slider } from './Slider'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const track = (host: Element) => host.querySelector('.slider__track')!
const dblclick = (el: Element) => act(async () => void el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))

describe('Slider: a double click puts the default back', () => {
  it('gives `resetTo` (kept in the range), and does nothing without it', async () => {
    const seen: number[] = []
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<Slider aria-label="Taille" min={0} max={10} step={1} value={7} resetTo={3} onChange={(v) => seen.push(v)} />))
    await dblclick(track(host))
    expect(seen).toEqual([3])
    await act(async () => root.render(<Slider aria-label="Taille" min={0} max={10} step={1} value={7} onChange={(v) => seen.push(v)} />))
    await dblclick(track(host))
    expect(seen).toEqual([3])
    act(() => root.unmount())
  })

  it('in a row of one setting, a slider takes the default of that setting', async () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, exposureEv: 1.5 } })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const set = (v: number) => useAppStore.getState().setSetting('exposureEv', v)
    await act(async () =>
      root.render(
        <SettingRow label="Exposition" value="" paths={['exposureEv']}>
          <RangeField label="Exposition" min={-3} max={3} step={0.1} value={useAppStore.getState().settings.exposureEv} format={String} onChange={set} />
        </SettingRow>,
      ),
    )
    // the row is folded: its slider is in the page all the same
    await dblclick(track(host))
    expect(useAppStore.getState().settings.exposureEv).toBe(DEFAULT_SETTINGS.exposureEv)
    act(() => root.unmount())
  })
})
