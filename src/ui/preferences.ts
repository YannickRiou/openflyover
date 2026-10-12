/**
 * Preferences of the app on this device (« Réglages » tab): what the status bar shows, the clock time on the timeline.
 * Not part of the project: kept by the platform storage (browser storage on the web, the app's on the desktop), read
 * once at start-up. Parsing and defaults: `parsePreferences` in `shell.ts`.
 */
import { create } from 'zustand'
import { getPlatform } from '../platform'
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
