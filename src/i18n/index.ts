/**
 * Internationalisation, in-house (no dependency). `t('domain.key', { name })` returns the message of the current
 * language; `{name}` placeholders are filled from the variables (never build a sentence by concatenation); a message
 * with `{ one, other }` forms is chosen by `vars.count` through `Intl.PluralRules`. The current language lives here
 * (set from the preferences, `ui/preferences.ts`), so non-React code (film overlay, export) calls `t` too; React
 * components call `useT()` to render again when the language changes.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { en } from './en'
import { fr } from './fr'
import { DEFAULT_LANGUAGE, localeOf } from './languages'
import type { LanguageCode } from './languages'
import type { MessageKey, Messages, Plural } from './messages'

export { LANGUAGES, detectLanguage } from './languages'
export type { LanguageCode } from './languages'
export type { MessageKey, Messages } from './messages'

const catalogs: Record<LanguageCode, Messages> = { fr, en }

export type Vars = Record<string, string | number>

let current: LanguageCode = DEFAULT_LANGUAGE
const listeners = new Set<() => void>()

export function getLanguage(): LanguageCode {
  return current
}

/** BCP 47 tag of the current language, for `Intl` and `localeCompare`. */
export function currentLocale(): string {
  return localeOf(current)
}

/** Switch the language now: every `useT()` component renders again. */
export function setLanguage(code: LanguageCode): void {
  if (code === current) return
  current = code
  for (const listener of listeners) listener()
}

/** Run `fn` with `code` as the current language, without telling the components (text that must not follow the interface). */
export function withLanguage<T>(code: LanguageCode, fn: () => T): T {
  const previous = current
  current = code
  try {
    return fn()
  } finally {
    current = previous
  }
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const pluralRules = new Map<LanguageCode, Intl.PluralRules>()

function pluralCategory(count: number): keyof Plural {
  let rules = pluralRules.get(current)
  if (!rules) {
    rules = new Intl.PluralRules(localeOf(current))
    pluralRules.set(current, rules)
  }
  return rules.select(count)
}

function lookup(language: LanguageCode, key: string): string | Plural | undefined {
  const dot = key.indexOf('.')
  const domain = (catalogs[language] as Record<string, Record<string, string | Plural> | undefined>)[key.slice(0, dot)]
  return domain?.[key.slice(dot + 1)]
}

/** The message of `key` in the current language (French, then the key itself when it is missing), placeholders not filled. */
export function template(key: MessageKey, vars?: Partial<Vars>): string {
  const entry = lookup(current, key) ?? lookup(DEFAULT_LANGUAGE, key)
  if (entry === undefined) return key
  if (typeof entry === 'string') return entry
  const count = vars?.count
  return (typeof count === 'number' ? entry[pluralCategory(count)] : undefined) ?? entry.other
}

/** The message of `key` in the current language, `{name}` placeholders filled from `vars`; `vars.count` picks a plural form. */
export function t(key: MessageKey, vars?: Vars): string {
  const text = template(key, vars)
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export type Translate = typeof t

/** The current language, as React state. */
export function useLanguage(): LanguageCode {
  return useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE)
}

/**
 * `t` for a component: it renders again when the language changes, and the function it gets is a new one then, so a
 * memo or an effect that lists `t` among its dependencies follows the language too.
 */
export function useT(): Translate {
  const language = useLanguage()
  return useMemo<Translate>(() => (key, vars) => withLanguage(language, () => t(key, vars)), [language])
}
