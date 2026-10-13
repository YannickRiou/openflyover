/** Numbers and dates for the current language, through `Intl` (formats cached: building one is slow). */
import { getLanguage } from './index'
import { localeOf } from './languages'

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>()

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>(kind: string, options: object, make: (locale: string) => T): T {
  const locale = localeOf(getLanguage())
  const key = `${kind}|${locale}|${JSON.stringify(options)}`
  let format = cache.get(key)
  if (!format) {
    format = make(locale)
    cache.set(key, format)
  }
  return format as T
}

/** 1234.5 -> « 1 234,5 » (French) or « 1,234.5 » (English); `fractionDigits` decimals, no sign on a zero. */
export function formatNumberIntl(value: number, fractionDigits = 0, minFractionDigits = fractionDigits): string {
  const options = { minimumFractionDigits: minFractionDigits, maximumFractionDigits: fractionDigits, signDisplay: 'negative' as const }
  return cached('n', options, (locale) => new Intl.NumberFormat(locale, options)).format(value)
}

/** The decimal separator of the current language: « , » in French, « . » in English. */
export function decimalSeparator(): string {
  const options = {}
  const parts = cached('n', options, (locale) => new Intl.NumberFormat(locale, options)).formatToParts(1.1)
  return parts.find((part) => part.type === 'decimal')?.value ?? '.'
}

/** A date or a time in the current language (`Intl.DateTimeFormat` options); the time zone is the browser's unless given. */
export function formatDate(value: Date | number, options: Intl.DateTimeFormatOptions): string {
  return cached('d', options, (locale) => new Intl.DateTimeFormat(locale, options)).format(value)
}

/** « a, b et c » / « a, b and c » */
export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  const options = { style: 'long' as const, type }
  return cached('l', options, (locale) => new Intl.ListFormat(locale, options)).format(items)
}
