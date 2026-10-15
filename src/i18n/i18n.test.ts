import { afterEach, describe, expect, it, vi } from 'vitest'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { it as italian } from './it'
import { LANGUAGES, detectLanguage, getLanguage, setLanguage, subscribeLanguage, t, template, withLanguage } from './index'
import type { MessageKey } from './index'
import type { Plural } from './messages'
import { DEFAULT_LANGUAGE, isLanguageCode, localeOf } from './languages'

type Entry = string | Plural
type Catalog = Record<string, Record<string, Entry>>

const catalogs: Record<string, Catalog> = { fr, en, es, it: italian, de }

/** every `{name}` a message uses, over all its plural forms, sorted */
function placeholders(entry: Entry): string {
  const texts = typeof entry === 'string' ? [entry] : Object.values(entry).filter((form): form is string => form !== undefined)
  return [...new Set(texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',')
}

const entries = (catalog: Catalog) => Object.entries(catalog).flatMap(([domain, messages]) => Object.entries(messages).map(([key, entry]) => [`${domain}.${key}`, entry] as const))

afterEach(() => setLanguage(DEFAULT_LANGUAGE))

describe('language files', () => {
  it('registers every language of the list, French first', () => {
    expect(LANGUAGES[0].code).toBe(DEFAULT_LANGUAGE)
    for (const { code } of LANGUAGES) expect(catalogs[code], code).toBeDefined()
  })

  for (const { code } of LANGUAGES.filter((language) => language.code !== DEFAULT_LANGUAGE)) {
    describe(code, () => {
      it('has the same domains and keys as French, no more, no fewer', () => {
        const reference = entries(fr).map(([key]) => key)
        const own = entries(catalogs[code]).map(([key]) => key)
        expect(own.filter((key) => !reference.includes(key))).toEqual([])
        expect(reference.filter((key) => !own.includes(key))).toEqual([])
      })

      it('uses the same {placeholders} as French for every message', () => {
        const own = new Map(entries(catalogs[code]))
        const mismatches = entries(fr)
          .filter(([key, entry]) => placeholders(entry) !== placeholders(own.get(key) ?? ''))
          .map(([key]) => key)
        expect(mismatches).toEqual([])
      })
    })
  }

  it('writes no empty message, and every plural has its `other` form', () => {
    for (const [code, catalog] of Object.entries(catalogs)) {
      for (const [key, entry] of entries(catalog)) {
        if (typeof entry === 'string') expect(entry.length, `${code}:${key}`).toBeGreaterThan(0)
        else expect(entry.other, `${code}:${key}`).toBeTruthy()
      }
    }
  })
})

describe('t', () => {
  it('fills the {placeholders} and leaves an unknown one as it is', () => {
    expect(t('film.defaultHold', { n: 3 })).toBe('Arrêt 3')
    expect(template('film.defaultHold')).toBe('Arrêt {n}')
    expect(t('film.defaultHold', { other: 1 })).toBe('Arrêt {n}')
    expect(t('film.defaultHold', { n: 7 })).not.toContain('{')
  })

  it('answers the key itself for a message nobody wrote', () => {
    expect(t('nowhere.nothing' as MessageKey)).toBe('nowhere.nothing')
  })

  it('speaks French by default and English once asked', () => {
    expect(getLanguage()).toBe('fr')
    expect(t('film.defaultHold', { n: 1 })).toBe('Arrêt 1')
    setLanguage('en')
    expect(t('film.defaultHold', { n: 1 })).toBe('Hold 1')
  })

  it('picks the plural form of `count` in the current language', () => {
    expect(t('timeline.videoCount', { count: 0 })).toBe('0 vidéo')
    expect(t('timeline.videoCount', { count: 1 })).toBe('1 vidéo')
    expect(t('timeline.videoCount', { count: 2 })).toBe('2 vidéos')
    setLanguage('en')
    expect(t('timeline.videoCount', { count: 0 })).toBe('0 videos')
    expect(t('timeline.videoCount', { count: 1 })).toBe('1 video')
    expect(t('timeline.videoCount', { count: 5 })).toBe('5 videos')
  })

  it('takes the plural form from `count` only when it is a number', () => {
    expect(t('timeline.videoCount', { count: '2' })).toBe('2 vidéos')
  })
})

describe('current language', () => {
  it('tells the listeners, once per change', () => {
    const listener = vi.fn()
    const stop = subscribeLanguage(listener)
    setLanguage('en')
    setLanguage('en')
    setLanguage('fr')
    stop()
    setLanguage('en')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('lets a text be worded in another language without telling anyone', () => {
    const listener = vi.fn()
    const stop = subscribeLanguage(listener)
    setLanguage('en')
    listener.mockClear()
    expect(withLanguage('fr', () => t('film.defaultHold', { n: 2 }))).toBe('Arrêt 2')
    expect(getLanguage()).toBe('en')
    expect(listener).not.toHaveBeenCalled()
    expect(() =>
      withLanguage('fr', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(getLanguage()).toBe('en')
    stop()
  })

  it('knows the locale of each language', () => {
    expect(localeOf('fr')).toBe('fr-FR')
    expect(localeOf('en')).toBe('en-GB')
  })

  it('accepts the codes of the list only', () => {
    expect(isLanguageCode('fr')).toBe(true)
    expect(isLanguageCode('en')).toBe(true)
    expect(isLanguageCode('es')).toBe(true)
    expect(isLanguageCode('it')).toBe(true)
    expect(isLanguageCode('de')).toBe(true)
    expect(isLanguageCode('ja')).toBe(false)
    expect(isLanguageCode(undefined)).toBe(false)
  })
})

describe('detectLanguage', () => {
  it('takes the first browser language the app has', () => {
    expect(detectLanguage(['en-US', 'fr'])).toBe('en')
    expect(detectLanguage(['de-DE', 'en-GB'])).toBe('de')
    expect(detectLanguage(['es-MX', 'en'])).toBe('es')
    expect(detectLanguage(['it', 'fr'])).toBe('it')
    expect(detectLanguage(['ja', 'en-GB'])).toBe('en')
    expect(detectLanguage(['fr-CA', 'en'])).toBe('fr')
    expect(detectLanguage(['EN'])).toBe('en')
  })

  it('falls back to French', () => {
    expect(detectLanguage(['ja', 'zh'])).toBe('fr')
    expect(detectLanguage([])).toBe('fr')
    expect(detectLanguage(undefined)).toBe('fr')
  })
})
