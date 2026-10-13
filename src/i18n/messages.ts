import type { fr } from './fr'

/** The forms of a message that depends on a count (`Intl.PluralRules` categories); `other` is always required. */
export interface Plural {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
}

/** A message is a string or `Plural` forms, whichever each language needs (English may pluralise what French writes as one string). */
type Widen<T> = T extends string | { other: string } ? string | Plural : { [K in keyof T]: Widen<T[K]> }

/**
 * Shape of a language: French (`fr/`) is the reference, so a missing or an extra key in another language is a compile
 * error. Domains (`topbar`, `timeline`...) hold flat objects whose values are strings or `Plural` forms.
 */
export type Messages = Widen<typeof fr>

/** `domain.key` of a message, checked by the compiler. */
export type MessageKey = { [D in keyof Messages & string]: `${D}.${keyof Messages[D] & string}` }[keyof Messages & string]
