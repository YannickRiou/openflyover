// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { PosterPanel } from './PosterPanel'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PosterPanel', () => {
  it('hides the « Vue 3D » options with « Carte à plat », which ignores them', async () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, poster: { ...DEFAULT_SETTINGS.poster, flat: false } } })
    const host = document.body.appendChild(document.createElement('div'))
    await act(async () => createRoot(host).render(<PosterPanel modes={null} hidden={false} />))
    const view3d = () => host.querySelector('[role="radiogroup"][aria-label="Vue 3D"]')
    expect(view3d()).not.toBeNull()
    await act(async () => useAppStore.getState().setSetting('poster', { ...DEFAULT_SETTINGS.poster, flat: true }))
    expect(view3d()).toBeNull()
  })
})
