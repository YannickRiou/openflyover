import { t } from '../i18n'
import type { MessageKey } from '../i18n'

/** Short sentences, in the language of the interface, for the browser errors (DOMException names, WebCodecs) that reach the user. */
const BY_NAME: Record<string, MessageKey> = {
  QuotaExceededError: 'errors.name.quota',
  NotAllowedError: 'errors.name.notAllowed',
  SecurityError: 'errors.name.security',
  NotFoundError: 'errors.name.notFound',
  NotReadableError: 'errors.name.notReadable',
  AbortError: 'errors.name.abort',
  EncodingError: 'errors.name.encoding',
  NotSupportedError: 'errors.name.notSupported',
  OperationError: 'errors.name.operation',
  InvalidStateError: 'errors.name.invalidState',
}

/** Tauri / OS messages (English strings, not Errors), checked in order. */
const BY_TEXT: [RegExp, MessageKey][] = [
  [/no such file|not found|os error (2|3)\b|cannot find/i, 'errors.name.notFound'],
  [/permission denied|access is denied|forbidden path|not allowed|os error (5|13)\b/i, 'errors.text.denied'],
  [/no space left|disk full|not enough space|os error (28|112)\b/i, 'errors.text.noSpace'],
  [/being used by another process|os error 32\b/i, 'errors.text.inUse'],
]

const technical = (text: string): string => t('errors.unexpected', { text })

/**
 * Message for anything thrown or rejected, shown to the user. Messages written by the app (already in the language of the interface) are kept as
 * they are; known browser / system errors become a short sentence; the rest is « Erreur inattendue (…) ».
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const mapped = BY_NAME[error.name]
    if (mapped) return t(mapped)
    if (!error.message) return t('errors.unknown')
    // only plain app errors carry a message of ours; other classes come from the platform
    if (error.name === 'Error' || error.name === 'RangeError') return error.message
    if (error.name === 'TypeError' && /fetch|network|load failed/i.test(error.message)) return t('errors.network')
    return technical(error.message)
  }
  if (typeof error === 'string' && error) {
    const mapped = BY_TEXT.find(([pattern]) => pattern.test(error))
    return mapped ? t(mapped[1]) : error
  }
  return t('errors.unknown')
}
