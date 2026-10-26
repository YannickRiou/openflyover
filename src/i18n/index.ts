/**
 * Internationalisation, in-house (no dependency). `t('domain.key', { name })` returns the message of the current
 * language; `{name}` placeholders are filled from the variables (never build a sentence by concatenation); a message
 * with `{ one, other }` forms is chosen by `vars.count` through `Intl.PluralRules`. The current language lives here
 * (set from the preferences, `ui/preferences.ts`), so non-React code (film overlay, export) calls `t` too; React
 * components call `useT()` to render again when the language changes.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { fr } from './fr'
import { DEFAULT_LANGUAGE, localeOf } from './languages'
import type { LanguageCode } from './languages'
import type { MessageKey, Messages, Plural } from './messages'

export { LANGUAGES, detectLanguage } from './languages'
export type { LanguageCode } from './languages'
export type { MessageKey, Messages } from './messages'

/** The catalogs in memory: French (the reference, in the first screen) and the others once `loadLanguage` has fetched them. */
const catalogs: Partial<Record<LanguageCode, Messages>> = { fr }

/** One chunk per language, fetched by `import()` when first needed. */
const loaders: Record<LanguageCode, () => Promise<Messages>> = {
  fr: async () => fr,
  en: () => import('./en').then((m) => m.en),
  es: () => import('./es').then((m) => m.es),
  it: () => import('./it').then((m) => m.it),
  de: () => import('./de').then((m) => m.de),
}
const loading = new Map<LanguageCode, Promise<void>>()

/** Fetch the catalog of `code` (once); resolves when `setLanguage(code)` and `withLanguage(code, …)` can use it. A failure is not remembered, so a later call tries again. */
export function loadLanguage(code: LanguageCode): Promise<void> {
  let promise = loading.get(code)
  if (!promise) {
    promise = loaders[code]().then(
      (messages) => void (catalogs[code] = messages),
      (error: unknown) => {
        loading.delete(code)
        throw error
      },
    )
    loading.set(code, promise)
  }
  return promise
}

export type Vars = Record<string, string | number>

let current: LanguageCode = DEFAULT_LANGUAGE
/** The language last asked for: a catalog that arrives late applies only if nothing was asked since. */
let wanted: LanguageCode = DEFAULT_LANGUAGE
const listeners = new Set<() => void>()

export function getLanguage(): LanguageCode {
  return current
}

/** BCP 47 tag of the current language, for `Intl` and `localeCompare`. */
export function currentLocale(): string {
  return localeOf(current)
}

/**
 * Switch the language: every `useT()` component renders again. At once when the catalog is in memory, otherwise as soon
 * as it is fetched (the interface keeps its language meanwhile, and when the fetch fails).
 */
export function setLanguage(code: LanguageCode): void {
  wanted = code
  if (code === current) return
  if (catalogs[code]) {
    current = code
    for (const listener of listeners) listener()
  } else {
    loadLanguage(code).then(
      () => wanted === code && setLanguage(code),
      () => undefined,
    )
  }
}

/**
 * Run `fn` with `code` as the current language, without telling the components (text that must not follow the interface).
 * `code` must be French (always there), the current language or one that `loadLanguage` has fetched: a catalog not in
 * memory answers in French.
 */
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
  const domain = (catalogs[language] as Record<string, Record<string, string | Plural> | undefined> | undefined)?.[key.slice(0, dot)]
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
