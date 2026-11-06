// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { t } from '../i18n'
import { JunctionTransitionFields } from './JunctionFields'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function mount(props: { night: boolean; hasNight?: boolean }) {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<JunctionTransitionFields kind="fondu-noir" holdS={2} recap={false} onChange={() => {}} {...props} />))
  const passage = host.querySelector<HTMLElement>('[aria-describedby]')!
  const disabled = (el: Element) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('data-disabled') === 'true'
  const duration = host.querySelector<HTMLInputElement>('input[type="range"]')
  return { host, root, passage, disabled, duration }
}

describe('JunctionTransitionFields', () => {
  it('a night passed between these two stages: the passage and its duration are disabled, and the reason is written', async () => {
    const { host, root, passage, disabled, duration } = await mount({ night: true, hasNight: true })
    expect(disabled(passage) || passage.closest('[data-disabled="true"]') !== null).toBe(true)
    expect(duration?.disabled).toBe(true)
    expect(host.textContent).toContain(t('inspector.junction.passedByNight'))
    act(() => root.unmount())
  })

  it('no night between them, or « Passer la nuit » off, or the settings (night unknown): the passage stays', async () => {
    for (const props of [{ night: true, hasNight: false }, { night: false, hasNight: true }, { night: true }]) {
      const { host, root, passage, disabled, duration } = await mount(props)
      expect(disabled(passage)).toBe(false)
      expect(duration?.disabled).toBe(false)
      expect(host.textContent).not.toContain(t('inspector.junction.passedByNight'))
      act(() => root.unmount())
    }
  })
})
