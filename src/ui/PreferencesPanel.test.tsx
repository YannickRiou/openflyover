// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getPlatform } from '../platform'
import { DEFAULT_APPEARANCE } from './appearance'
import { PreferencesPanel } from './PreferencesPanel'
import { DEFAULT_PREFERENCES } from './shell'
import { PREFERENCES_KEY, installAppearance, usePreferences } from './preferences'

let host: HTMLElement
let root: Root
let stop: () => void

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(async () => {
  usePreferences.setState(DEFAULT_PREFERENCES)
  stop = installAppearance()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<PreferencesPanel />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  stop()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  document.documentElement.removeAttribute('style')
  getPlatform().storage.remove(PREFERENCES_KEY)
})

const radio = (label: string) => [...host.querySelectorAll<HTMLInputElement>('.segmented__option input')].find((i) => i.parentElement!.textContent === label)!
const swatch = (label: string) => host.querySelector<HTMLButtonElement>(`.color-row__swatch[aria-label="${label}"]`)!
const reset = () => [...host.querySelectorAll('button')].find((b) => b.textContent === "Rétablir l'apparence par défaut")!
const stored = () => JSON.parse(getPlatform().storage.get(PREFERENCES_KEY)!).appearance

describe('PreferencesPanel, « Apparence »', () => {
  it('shows the defaults and has nothing to reset', () => {
    expect(host.textContent).toContain('Apparence')
    expect(radio('Clair').checked).toBe(true)
    expect(radio('Confortable').checked).toBe(true)
    expect(swatch("Couleur d'accentuation : Rouge balisage").getAttribute('aria-pressed')).toBe('true')
    expect(swatch('Couleur de la barre et du rail : Encre').getAttribute('aria-pressed')).toBe('true')
    expect(reset().hasAttribute('disabled')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies the theme at once to the page and remembers it', async () => {
    await act(async () => radio('Sombre').click())
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(usePreferences.getState().appearance.theme).toBe('dark')
    expect(stored().theme).toBe('dark')
    await act(async () => radio('Clair').click())
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies the density, the accent and the bar colour', async () => {
    await act(async () => radio('Compact').click())
    expect(document.documentElement.dataset.density).toBe('compact')
    await act(async () => swatch("Couleur d'accentuation : Indigo").click())
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#4a55b8')
    await act(async () => swatch('Couleur de la barre et du rail : Bleu marine').click())
    expect(document.documentElement.style.getPropertyValue('--surface-chrome')).toBe('#113b54')
    expect(stored()).toMatchObject({ accent: '#4a55b8', chrome: '#113b54', density: 'compact' })
  })

  it('tells when a free colour is darkened to keep the text readable', async () => {
    expect(host.textContent).not.toContain('Couleur assombrie')
    await act(async () => usePreferences.setState({ appearance: { ...DEFAULT_APPEARANCE, accent: '#ffee00' } }))
    expect(host.textContent).toContain('Couleur assombrie pour que le texte blanc')
    await act(async () => usePreferences.setState({ appearance: { ...DEFAULT_APPEARANCE, chrome: '#ffffff' } }))
    expect(host.textContent).toContain('Couleur assombrie pour que le texte de la barre')
  })

  it('restores the default appearance', async () => {
    await act(async () => radio('Sombre').click())
    await act(async () => swatch("Couleur d'accentuation : Mousse").click())
    expect(reset().hasAttribute('disabled')).toBe(false)
    await act(async () => reset().click())
    expect(usePreferences.getState().appearance).toEqual(DEFAULT_APPEARANCE)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.getAttribute('style') ?? '').toBe('')
    expect(radio('Clair').checked).toBe(true)
    expect(reset().hasAttribute('disabled')).toBe(true)
  })
})
