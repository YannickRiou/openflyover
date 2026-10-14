/**
 * Preferences of the app on this device (« Réglages » tab): what the status bar shows, the clock time on the timeline,
 * the look of the interface.
 * Not part of the project: kept by the platform storage (browser storage on the web, the app's on the desktop), read
 * once at start-up. Parsing and defaults: `parsePreferences` in `shell.ts`.
 */
import { create } from 'zustand'
import { detectLanguage, setLanguage } from '../i18n'
import { getPlatform } from '../platform'
import { applyAppearance } from './appearance'
import { DEFAULT_PREFERENCES, parsePreferences } from './shell'
import type { Preferences } from './shell'

export const PREFERENCES_KEY = 'openflyover.preferences.v1'

function load(): Preferences {
  try {
    return parsePreferences(getPlatform().storage.get(PREFERENCES_KEY))
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export const usePreferences = create<Preferences>()(load)

/** Change some preferences and remember them (for this session only when the storage is unavailable). */
export function setPreferences(patch: Partial<Preferences>): void {
  usePreferences.setState(patch)
  try {
    getPlatform().storage.set(PREFERENCES_KEY, JSON.stringify(usePreferences.getState()))
  } catch {
    // storage unavailable: the choice lasts for the session
  }
}

/** Whether a language was ever chosen on this device (the stored preferences carry one). */
function hasStoredLanguage(): boolean {
  try {
    const stored: unknown = JSON.parse(getPlatform().storage.get(PREFERENCES_KEY) ?? 'null')
    return typeof stored === 'object' && stored !== null && 'language' in stored
  } catch {
    return false
  }
}

/**
 * Put the language of the preferences on the interface now and whenever it changes (`<html lang>` too). First run, with
 * no choice stored: the browser's language when the app has it (English), French otherwise; it is only remembered once
 * the person picks one. Returns the function that stops it.
 */
export function installLanguage(root: HTMLElement = document.documentElement): () => void {
  if (!hasStoredLanguage()) usePreferences.setState({ language: detectLanguage(navigator.languages ?? [navigator.language]) })
  const apply = () => {
    const { language } = usePreferences.getState()
    setLanguage(language)
    root.lang = language
  }
  apply()
  return usePreferences.subscribe((state, previous) => {
    if (state.language !== previous.language) apply()
  })
}

const DARK_SCHEME = '(prefers-color-scheme: dark)'

/**
 * Put the appearance on the page now (the stored one, before the first paint) and again whenever it changes or the
 * system's colour scheme does. Returns the function that stops it.
 */
export function installAppearance(root: HTMLElement = document.documentElement): () => void {
  const scheme = window.matchMedia?.(DARK_SCHEME)
  const apply = () => applyAppearance(root, usePreferences.getState().appearance, scheme?.matches ?? false)
  apply()
  const unsubscribe = usePreferences.subscribe((state, previous) => {
    if (state.appearance !== previous.appearance) apply()
  })
  scheme?.addEventListener('change', apply)
  return () => {
    unsubscribe()
    scheme?.removeEventListener('change', apply)
  }
}
