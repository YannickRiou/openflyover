/**
 * Modes of the interface (« Débutant », « Confirmé », « Expert », `Preferences.uiMode`): which panels, rows, tabs, tracks and
 * options show. A mode only hides; the film is the same in the three, and what is hidden keeps its value. A setting that is
 * not at its default value shows in every mode (the « modifié » marker, `modifiedPaths`). Ctrl+K finds hidden sections.
 */
import { useMemo } from 'react'
import { modifiedPaths } from '../project/apply'
import type { SettingPath } from '../project/apply'
import { useAppStore } from '../state/store'
import { usePreferences } from './preferences'
import { UI_MODES } from './shell'
import type { ShellTab, UiMode } from './shell'

/** `mode` shows what `min` is the lowest mode of. */
export const modeAtLeast = (mode: UiMode, min: UiMode): boolean => UI_MODES.indexOf(mode) >= UI_MODES.indexOf(min)

/**
 * What `min` (none: every mode) shows now: the mode reaches it, or one of its `paths` is not at its default value.
 * A selector of booleans: a change of the settings renders again only when the answer changes.
 */
export function useModeShows(min: UiMode | undefined, paths: readonly SettingPath[] = []): boolean {
  const reached = usePreferences((s) => min === undefined || modeAtLeast(s.uiMode, min))
  const modified = useAppStore((s) => !reached && modifiedPaths(s.settings, paths).length > 0)
  return reached || modified
}

/** The tabs that a lower mode leaves out, and the settings that bring them back when they are modified. */
const HIDDEN_TABS: Partial<Record<ShellTab, { min: UiMode; paths: readonly SettingPath[] }>> = {
  meteo: { min: 'confirme', paths: ['weather', 'clouds', 'weatherScene', 'snow'] },
  lumiere: { min: 'confirme', paths: ['atmosphere', 'shadows', 'cloudShadows', 'nightLightEv', 'sunFromTrack', 'sunHour', 'sunDate', 'exposureEv', 'grading', 'film.nights', 'film.dayCards'] },
  objectif: { min: 'expert', paths: ['lens'] },
}

/** `tabs` without the ones the mode hides, unless one of their settings is modified. */
export function useModeTabs(tabs: readonly ShellTab[]): readonly ShellTab[] {
  const mode = usePreferences((s) => s.uiMode)
  const shown = useAppStore((s) =>
    tabs
      .filter((tab) => {
        const rule = HIDDEN_TABS[tab]
        return !rule || modeAtLeast(mode, rule.min) || modifiedPaths(s.settings, rule.paths).length > 0
      })
      .join(),
  )
  return useMemo(() => (shown ? (shown.split(',') as ShellTab[]) : []), [shown])
}

/** The paths of the fields of the object setting `key` (`defaults`: its default value) but `except`: what a mode hides beside them. */
export function pathsBut(key: string, defaults: object, ...except: string[]): SettingPath[] {
  return Object.keys(defaults)
    .filter((field) => !except.includes(field))
    .map((field) => `${key}.${field}`) as SettingPath[]
}
