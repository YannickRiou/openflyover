// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { setLanguage } from '../i18n'
import { DOWNLOAD_URL, EmptyState, guideUrl } from './EmptyState'
import { usePreferences } from './preferences'
import { LATEST_NEWS, WHATS_NEW } from './whatsNew'

describe('guideUrl', () => {
  it('English at user-guide.html, every other language at user-guide.<code>.html', () => {
    expect(guideUrl('en')).toBe('https://yannickriou.github.io/openflyover/docs/user-guide.html')
    expect(guideUrl('de')).toBe('https://yannickriou.github.io/openflyover/docs/user-guide.de.html')
  })
})

describe('home screen', () => {
  it('says what the app does, names what is new and links to the guide and the desktop app', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    setLanguage('fr')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<EmptyState />))
    const text = host.textContent ?? ''
    expect(text).toContain('film de survol en 3D')
    expect(text).toContain('Sans compte')
    expect(text).toContain(`Nouveau en ${WHATS_NEW[0].version}`)
    expect(text).toContain(WHATS_NEW[0].items[0].title)
    // the guide in the language of the interface
    expect(host.querySelector('[data-testid="home-guide"]')?.getAttribute('href')).toBe('https://yannickriou.github.io/openflyover/docs/user-guide.fr.html')
    // the website offers the desktop app
    expect(host.querySelector('[data-testid="home-download"]')?.getAttribute('href')).toBe(DOWNLOAD_URL)
    // the card opens « Nouveautés » and marks them seen
    await act(async () => (host.querySelector('[data-testid="home-news"]') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain(`Version ${LATEST_NEWS}`)
    expect(usePreferences.getState().whatsNewSeen).toBe(LATEST_NEWS)
    act(() => root.unmount())
    host.remove()
  })
})
