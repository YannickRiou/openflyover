import { afterEach, describe, expect, it } from 'vitest'
import { decimalSeparator, formatDate, formatList, formatNumberIntl } from './format'
import { setLanguage } from './index'

afterEach(() => setLanguage('fr'))

describe('formatNumberIntl', () => {
  it('writes French numbers with a decimal comma and a narrow no-break space between thousands', () => {
    expect(formatNumberIntl(1234.5, 1)).toBe('1 234,5')
    expect(formatNumberIntl(1234567)).toBe('1 234 567')
    expect(formatNumberIntl(12.4, 1)).toBe('12,4')
  })

  it('writes English numbers with a decimal point and commas', () => {
    setLanguage('en')
    expect(formatNumberIntl(1234.5, 1)).toBe('1,234.5')
    expect(formatNumberIntl(1234567)).toBe('1,234,567')
  })

  it('rounds to the digits asked, and pads only up to the minimum', () => {
    expect(formatNumberIntl(2, 2, 0)).toBe('2')
    expect(formatNumberIntl(2.5, 2, 0)).toBe('2,5')
    expect(formatNumberIntl(2, 2)).toBe('2,00')
    expect(formatNumberIntl(0.456, 1)).toBe('0,5')
  })

  it('shows no sign on a zero, keeps the minus of a negative', () => {
    expect(formatNumberIntl(-0)).toBe('0')
    expect(formatNumberIntl(-0.001, 2)).toBe('0,00')
    expect(formatNumberIntl(-3.5, 1)).toBe('-3,5')
  })
})

describe('decimalSeparator', () => {
  it('follows the language', () => {
    expect(decimalSeparator()).toBe(',')
    setLanguage('en')
    expect(decimalSeparator()).toBe('.')
  })
})

describe('formatDate', () => {
  const day = Date.UTC(2025, 6, 12, 9)

  it('names the month in the language, in the zone asked', () => {
    const options = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } as const
    expect(formatDate(day, options)).toBe('12 juillet 2025')
    setLanguage('en')
    expect(formatDate(day, options)).toBe('12 July 2025')
  })

  it('writes a short numeric date day first in both languages', () => {
    const options = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' } as const
    expect(formatDate(day, options)).toBe('12/07/2025')
    setLanguage('en')
    expect(formatDate(day, options)).toBe('12/07/2025')
  })

  it('takes a Date as well as a time', () => {
    expect(formatDate(new Date(day), { month: 'long', timeZone: 'UTC' })).toBe('juillet')
  })
})

describe('formatList', () => {
  it('joins with the conjunction of the language', () => {
    expect(formatList(['a', 'b', 'c'])).toBe('a, b et c')
    expect(formatList(['a', 'b'])).toBe('a et b')
    expect(formatList(['a'])).toBe('a')
    expect(formatList([])).toBe('')
    setLanguage('en')
    expect(formatList(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('can say « or »', () => {
    expect(formatList(['a', 'b', 'c'], 'disjunction')).toBe('a, b ou c')
    setLanguage('en')
    expect(formatList(['a', 'b'], 'disjunction')).toBe('a or b')
  })
})
