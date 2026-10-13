// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getLanguage, setLanguage } from '../i18n'
import { getPlatform } from '../platform'
import { LanguageMenu } from './LanguageMenu'
import { PREFERENCES_KEY, installLanguage, usePreferences } from './preferences'
import { DEFAULT_PREFERENCES } from './shell'

let host: HTMLElement
let root: Root
let stop: () => void

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(async () => {
  usePreferences.setState(DEFAULT_PREFERENCES)
  // a stored choice: the language of the browser does not count
  getPlatform().storage.set(PREFERENCES_KEY, JSON.stringify({ language: 'fr' }))
  stop = installLanguage()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<LanguageMenu />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  stop()
  document.body.innerHTML = ''
  getPlatform().storage.remove(PREFERENCES_KEY)
  setLanguage('fr')
  document.documentElement.removeAttribute('lang')
})

const button = () => host.querySelector<HTMLButtonElement>('.lang-menu__button')!
const items = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
const key = (target: Element, name: string) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })))
const open = () => act(async () => button().click())

describe('LanguageMenu', () => {
  it('shows the flag and the code of the language, named for a screen reader', () => {
    expect(button().textContent).toContain('FR')
    expect(button().getAttribute('aria-label')).toBe('Langue : Français')
    expect(button().getAttribute('aria-haspopup')).toBe('menu')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(items()).toHaveLength(0)
  })

  it('lists the languages by their own names, the current one checked and focused', async () => {
    await open()
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(items().map((i) => i.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Français'), expect.stringContaining('English')]))
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(document.activeElement).toBe(items()[0])
  })

  it('moves with the arrows, wrapping around', async () => {
    await open()
    await key(items()[0], 'ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    await key(items()[1], 'ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    await key(items()[0], 'ArrowUp')
    expect(document.activeElement).toBe(items()[1])
  })

  it('closes on Escape and gives the focus back to the button', async () => {
    await open()
    await key(items()[0], 'Escape')
    expect(items()).toHaveLength(0)
    expect(document.activeElement).toBe(button())
  })

  it('switches the interface, the page language and the preference when a language is picked', async () => {
    await open()
    await act(async () => items()[1].click())
    expect(getLanguage()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(usePreferences.getState().language).toBe('en')
    expect(JSON.parse(getPlatform().storage.get(PREFERENCES_KEY) ?? 'null')).toMatchObject({ language: 'en' })
    // the button follows, and speaks English now
    expect(button().textContent).toContain('EN')
    expect(button().getAttribute('aria-label')).toBe('Language: English')
    expect(items()).toHaveLength(0)
    expect(document.activeElement).toBe(button())
  })
})
