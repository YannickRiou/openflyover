// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { t } from '../i18n'
import { resetAppStore, useAppStore } from '../state/store'
import { LabelSettings } from './LabelSettings'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

async function show() {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<LabelSettings />))
  return { text: () => host.textContent ?? '', stop: () => act(() => root.unmount()) }
}

describe('LabelSettings', () => {
  afterEach(() => {
    resetAppStore()
    document.body.innerHTML = ''
  })

  it('does not offer the labels of photos nor of named points when there are none to label', async () => {
    const view = await show()
    expect(view.text()).not.toContain(t('track.labels.photos' as never))
    expect(view.text()).not.toContain(t('track.labels.photoPins' as never))
    expect(view.text()).not.toContain(t('track.labels.waypoints' as never))
    // the end points and the kilometres have something to label
    expect(view.text()).toContain(t('track.labels.endpoints' as never))
    await view.stop()
  })

  it('offers the labels of the photos once the timeline has one', async () => {
    useAppStore.setState((s) => ({ settings: { ...s.settings, film: { ...s.settings.film, media: [{ id: 'p1' } as never] } } }))
    const view = await show()
    expect(view.text()).toContain(t('track.labels.photos' as never))
    await view.stop()
  })
})
