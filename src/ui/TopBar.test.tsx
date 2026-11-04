// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { useAppStore } from '../state/store'
import { guideUrl } from './AppMenu'
import { setPreferences } from './preferences'
import { TopBar } from './TopBar'
import { LATEST_NEWS } from './whatsNew'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('TopBar: the save icon', () => {
  it('shows a dot while changes are unsaved, then the accent colour for a few seconds once saved', async () => {
    vi.useFakeTimers()
    const track = buildTrack({ name: 'Sortie', source: 'gpx', segments: [{ points: [6.8, 6.81].map((lon) => ({ lon, lat: 45.9, ele: 1000 })) }] })
    useAppStore.setState({ tracks: [track] })
    useAppStore.getState().markProjectSaved()
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    const save = () => host.querySelector<HTMLButtonElement>('[data-testid="topbar-save"]')!

    // open and save are icons with their name as label, and no « Enregistré » text
    expect(host.querySelector('button[aria-label="Ouvrir"]')?.textContent).toBe('')
    expect(save().getAttribute('aria-label')).toBe('Enregistrer')
    expect(save().dataset.saveState).toBeUndefined()

    await act(async () => useAppStore.getState().setProjectName('Autre nom'))
    expect(save().dataset.saveState).toBe('unsaved')
    expect(save().getAttribute('aria-label')).toMatch(/non enregistrées/)

    await act(async () => useAppStore.getState().markProjectSaved())
    expect(save().dataset.saveState).toBe('saved')
    await act(async () => void vi.advanceTimersByTime(3100))
    expect(save().dataset.saveState).toBeUndefined()
    act(() => root.unmount())
  })
})

describe('TopBar: the output format', () => {
  it('is a radio group named « Format de sortie »: an aspect sets the video, « Libre » frees the framing', async () => {
    useAppStore.getState().setFreeFraming(false)
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    const group = host.querySelector('[role="radiogroup"][aria-label="Format de sortie"]')!
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios[0].labels?.[0]?.textContent).toBe('Libre')
    expect(radios.filter((r) => r.checked)).toHaveLength(1)
    await act(async () => radios[2].click())
    expect(useAppStore.getState().settings.video.aspect).toBe('9:16')
    expect(radios[2].checked).toBe(true)
    await act(async () => radios[0].click())
    expect(useAppStore.getState().freeFraming).toBe(true)
    expect(useAppStore.getState().settings.video.aspect).toBe('9:16')
    expect(radios[0].checked).toBe(true)
    act(() => root.unmount())
  })
})

describe('TopBar: the output format on a phone', () => {
  it('is a button with the chosen format that opens the list: the checked row is the format, a pick sets it', async () => {
    useAppStore.getState().setFreeFraming(false)
    useAppStore.getState().setSetting('video', { ...useAppStore.getState().settings.video, aspect: '16:9' })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    // (the media queries do not apply here: the row and the button are both in the page, the stylesheet shows one)
    const button = host.querySelector<HTMLButtonElement>('button[aria-label^="Format de sortie ("]')!
    expect(button.getAttribute('aria-label')).toBe('Format de sortie (Paysage 16:9)')
    await act(async () => button.click())
    const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(rows[0].textContent).toBe('Libre')
    expect(rows.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent)).toEqual(['Paysage 16:9'])
    await act(async () => rows[2].click())
    expect(useAppStore.getState().settings.video.aspect).toBe('9:16')
    expect(button.getAttribute('aria-label')).toMatch(/\(.*9:16\)/)
    await act(async () => button.click())
    await act(async () => document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[0].click())
    expect(useAppStore.getState().freeFraming).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Format de sortie (Libre)')
    act(() => root.unmount())
  })
})

describe('TopBar: the mode of the interface', () => {
  it('is not on the bar: it changes seldom, and « Réglages » has it', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={() => {}} />))
    expect(host.querySelector('[role="radiogroup"][aria-label="Mode de l’interface"]')).toBeNull()
    act(() => root.unmount())
  })
})

describe('TopBar: the OpenFlyover menu', () => {
  const ENTRIES = ['Mes projets', 'Nouveautés', "Guide d'utilisation", 'Raccourcis clavier', 'À propos et mises à jour']
  const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  const mount = async (onHelp = () => {}) => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<TopBar onOpen={() => {}} exportOpen={false} onToggleExport={() => {}} onHelp={onHelp} />))
    return { host, root, logo: host.querySelector<HTMLButtonElement>('[data-testid="logo-menu"]')! }
  }

  it('opens under the logo with the five entries, and « ? » is no longer on the bar', async () => {
    setPreferences({ whatsNewSeen: LATEST_NEWS })
    const { host, root, logo } = await mount()
    expect(logo.getAttribute('aria-label')).toBe('Menu OpenFlyover')
    expect(logo.getAttribute('aria-haspopup')).toBe('true')
    expect(logo.querySelector('img')).not.toBeNull()
    expect(host.querySelector('[data-testid="news-dot"]')).toBeNull()
    expect(host.querySelector('button[aria-label="Raccourcis clavier"]')).toBeNull()
    await act(async () => logo.click())
    expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Menu OpenFlyover')
    expect(rows().map((r) => r.textContent)).toEqual(ENTRIES)
    act(() => root.unmount())
  })

  it('shows a dot on the logo until « Nouveautés » is opened', async () => {
    setPreferences({ whatsNewSeen: '' })
    const { host, root, logo } = await mount()
    expect(logo.querySelector('[data-testid="news-dot"]')).not.toBeNull()
    expect(logo.getAttribute('aria-label')).toBe('Menu OpenFlyover · Nouveautés')
    await act(async () => logo.click())
    await act(async () => rows()[1].click())
    expect(document.body.textContent).toContain(`Version ${LATEST_NEWS}`)
    expect(host.querySelector('[data-testid="news-dot"]')).toBeNull()
    act(() => root.unmount())
  })

  it('« Raccourcis clavier » asks for the shortcuts, « À propos » opens the version and the sources', async () => {
    const onHelp = vi.fn()
    const { root, logo } = await mount(onHelp)
    await act(async () => logo.click())
    await act(async () => rows()[3].click())
    expect(onHelp).toHaveBeenCalledOnce()
    await act(async () => logo.click())
    await act(async () => rows()[4].click())
    expect(document.body.textContent).toMatch(/Version\s*: \S+/)
    expect(document.body.textContent).toContain('Sources et licences')
    act(() => root.unmount())
  })

  it('« Guide d’utilisation » opens the guide of the language in a new tab', async () => {
    const opened: string[] = []
    const onClick = (e: Event) => {
      const link = (e.target as Element).closest('a')
      if (link) opened.push(`${link.target} ${link.href}`)
      e.preventDefault()
    }
    document.addEventListener('click', onClick)
    const { root, logo } = await mount()
    await act(async () => logo.click())
    await act(async () => rows()[2].click())
    document.removeEventListener('click', onClick)
    expect(opened).toEqual(['_blank https://yannickriou.github.io/openflyover/docs/user-guide.fr.html'])
    act(() => root.unmount())
  })

  it('« Mes projets » has nothing to leave on the home screen', async () => {
    useAppStore.setState({ tracks: [] })
    const { root, logo } = await mount()
    await act(async () => logo.click())
    expect(rows()[0].getAttribute('aria-disabled')).toBe('true')
    act(() => root.unmount())
  })

  it('on a portrait phone the same entries head « Plus d’actions », then a line and the actions of the bar', async () => {
    const query = { matches: true, addEventListener: () => {}, removeEventListener: () => {} }
    vi.stubGlobal('matchMedia', () => query)
    setPreferences({ whatsNewSeen: '' })
    const { host, root } = await mount()
    // the logo is not there: the dot of the news is on the button of the menu that holds the entries
    const more = host.querySelector<HTMLButtonElement>('button[aria-label^="Plus d\'actions"]')!
    expect(more.querySelector('[data-testid="news-dot"]')).not.toBeNull()
    await act(async () => more.click())
    expect(rows().map((r) => r.textContent)).toEqual([...ENTRIES, 'Ouvrir…', 'Enregistrer'])
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1)
    expect(rows()[4].nextElementSibling?.getAttribute('role')).toBe('separator')
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })

  it('off a phone « Plus d’actions » keeps only the actions of the bar', async () => {
    const { host, root } = await mount()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Plus d\'actions"]')!.click())
    expect(rows().map((r) => r.textContent)).toEqual(['Ouvrir…', 'Enregistrer'])
    act(() => root.unmount())
  })
})

describe('guideUrl', () => {
  it('English at user-guide.html, every other language at user-guide.<code>.html', () => {
    expect(guideUrl('en')).toBe('https://yannickriou.github.io/openflyover/docs/user-guide.html')
    expect(guideUrl('de')).toBe('https://yannickriou.github.io/openflyover/docs/user-guide.de.html')
  })
})
