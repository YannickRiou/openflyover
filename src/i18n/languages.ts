/**
 * Languages of the interface. Adding one: copy `fr/` to a new folder, translate, add it to `loaders` in `index.ts`
 * and to this list (the compiler lists every key left to translate).
 */
export const LANGUAGES = [
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

/** The reference language: the default, and the fallback of a missing translation. */
export const DEFAULT_LANGUAGE: LanguageCode = 'fr'

export function isLanguageCode(value: unknown): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value)
}

/** The language to start in when none was ever chosen: the first of the browser's languages that is offered, else French. */
export function detectLanguage(preferred: readonly string[] | undefined): LanguageCode {
  for (const tag of preferred ?? []) {
    const code = tag.toLowerCase().split('-')[0]
    if (isLanguageCode(code)) return code
  }
  return DEFAULT_LANGUAGE
}

/** BCP 47 tag used by `Intl` for numbers and dates in this language. */
export function localeOf(code: LanguageCode): string {
  return LANGUAGES.find((language) => language.code === code)?.locale ?? 'fr-FR'
}
