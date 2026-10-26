// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLanguage, setLanguage } from '../i18n'
import { getPlatform } from '../platform'
import { DEFAULT_PREFERENCES } from './shell'
import { PREFERENCES_KEY, installLanguage, setPreferences, usePreferences } from './preferences'

let stop: (() => void) | undefined

const browserLanguages = (languages: string[]) => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)

beforeEach(() => {
  getPlatform().storage.remove(PREFERENCES_KEY)
  usePreferences.setState(DEFAULT_PREFERENCES)
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.restoreAllMocks()
  getPlatform().storage.remove(PREFERENCES_KEY)
  setLanguage('fr')
  document.documentElement.removeAttribute('lang')
})

describe('installLanguage', () => {
  it('starts in French when the browser speaks something else, and says so on the page', () => {
    browserLanguages(['ja-JP'])
    stop = installLanguage()
    expect(getLanguage()).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('starts in English on the first run when the browser is English, without remembering it', () => {
    browserLanguages(['en-US', 'fr'])
    stop = installLanguage()
    expect(getLanguage()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(getPlatform().storage.get(PREFERENCES_KEY)).toBeNull()
  })

  it('follows what is chosen afterwards, and keeps it', () => {
    browserLanguages(['en-US'])
    stop = installLanguage()
    setPreferences({ language: 'fr' })
    expect(getLanguage()).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
    expect(JSON.parse(getPlatform().storage.get(PREFERENCES_KEY) ?? 'null')).toMatchObject({ language: 'fr' })
  })

  it('prefers the stored choice to the language of the browser', () => {
    getPlatform().storage.set(PREFERENCES_KEY, JSON.stringify({ language: 'fr' }))
    usePreferences.setState({ language: 'fr' })
    browserLanguages(['en-GB'])
    stop = installLanguage()
    expect(getLanguage()).toBe('fr')
  })

  it('puts the preference back to the language shown, with a message, when the catalog cannot be fetched', async () => {
    // fresh modules, German failing to load: only French is in memory, as at start-up
    vi.resetModules()
    vi.doMock('../i18n/de', () => {
      throw new Error('chunk not found')
    })
    const i18n = await import('../i18n')
    const preferences = await import('./preferences')
    const { useToastStore } = await import('./toast')
    getPlatform().storage.set(PREFERENCES_KEY, JSON.stringify({ language: 'fr' }))
    preferences.usePreferences.setState({ language: 'fr' })
    stop = preferences.installLanguage()
    preferences.setPreferences({ language: 'de' })
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    expect(preferences.usePreferences.getState().language).toBe('fr')
    expect(i18n.getLanguage()).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
    expect(useToastStore.getState().toasts[0].text).toBe("Impossible de charger cette langue pour l'instant.")
    expect(JSON.parse(getPlatform().storage.get(PREFERENCES_KEY) ?? 'null')).toMatchObject({ language: 'fr' })
    vi.doUnmock('../i18n/de')
  })

  it('uses the page it is given, and stops following once stopped', () => {
    browserLanguages(['ja'])
    const page = document.createElement('div')
    const off = installLanguage(page)
    setPreferences({ language: 'en' })
    expect(page.lang).toBe('en')
    expect(getLanguage()).toBe('en')
    off()
    setPreferences({ language: 'fr' })
    expect(page.lang).toBe('en')
    expect(getLanguage()).toBe('en')
  })
})
