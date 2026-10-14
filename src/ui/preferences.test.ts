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
    browserLanguages(['de-DE'])
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

  it('uses the page it is given, and stops following once stopped', () => {
    browserLanguages(['de'])
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
