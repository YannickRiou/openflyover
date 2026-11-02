/**
 * Modes of the interface (« Débutant », « Confirmé », « Expert », `Preferences.uiMode`): which panels, rows, tabs, tracks and
 * options show. A mode only hides; the film is the same in the three, and what is hidden keeps its value. A setting that is
 * not at its default value shows in every mode (the « modifié » marker, `modifiedPaths`). Ctrl+K finds hidden sections.
 */
import { useMemo } from 'react'
import type { LonLat } from '../core/types'
import { filmTrackOf } from '../flyover/sequence'
import { PLAIN_DAY, solarDay, sunChipHour, sunDayMs } from '../flyover/sun'
import type { SolarDay } from '../flyover/sun'
import { modifiedPaths } from '../project/apply'
import type { SettingPath } from '../project/apply'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { DEFAULT_CLOUDS } from '../weather/sceneClouds'
import type { CloudMode } from '../weather/sceneClouds'
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

/** The chips of « Ambiance » (« Débutant », map tab): « Météo du jour », « Grand beau », « Coucher de soleil ». */
export const AMBIANCES = ['weather', 'sunny', 'sunset'] as const
export type Ambiance = (typeof AMBIANCES)[number]

/** The mode of the clouds each chip sets. */
export const AMBIANCE_CLOUDS: Record<Ambiance, CloudMode> = { weather: 'meteo', sunny: 'aucun', sunset: 'meteo' }
/** The sun each chip sets: the recorded time of the track (none), or the solar hour of one of the sun's chips. */
const AMBIANCE_SUN = { weather: null, sunny: 'midi', sunset: 'coucher' } as const

/** The solar day the chips work on: at the place and on the day of the film track (`PLAIN_DAY` before there is a place). */
export function ambianceDay(origin: LonLat | null, sunDate: string, startTime: number | undefined, today: number): SolarDay {
  return origin ? solarDay(origin.lat, origin.lon, sunDayMs(sunDate, startTime, today)) : PLAIN_DAY
}

/** The solar hour each chip sets on `day`: none (`undefined`) for the recorded time, `null` when the day has no such hour. */
export function ambianceHours(day: SolarDay): Record<Ambiance, number | null | undefined> {
  const hour = (a: Ambiance) => {
    const chip = AMBIANCE_SUN[a]
    return chip === null ? undefined : sunChipHour(chip, day)
  }
  return { weather: hour('weather'), sunny: hour('sunny'), sunset: hour('sunset') }
}

/** The chip whose values these settings are, if any: the one that shows lit, and whose choice the tabs need not show again. */
export function ambianceOf(settings: Pick<Settings, 'clouds' | 'sunFromTrack' | 'sunHour'>, day: SolarDay): Ambiance | undefined {
  const hours = ambianceHours(day)
  return AMBIANCES.find((a) => settings.clouds.mode === AMBIANCE_CLOUDS[a] && (hours[a] === undefined ? settings.sunFromTrack : !settings.sunFromTrack && settings.sunHour === hours[a]))
}

/**
 * The tabs that a lower mode leaves out, and the settings that bring them back when they are modified. `chips`: the ones
 * a chip of « Ambiance » sets, which do not bring the tab back while they are the values of one of the chips (the lit chip
 * shows the choice).
 */
const HIDDEN_TABS: Partial<Record<ShellTab, { min: UiMode; paths: readonly SettingPath[]; chips?: readonly SettingPath[] }>> = {
  meteo: { min: 'confirme', paths: ['weather', 'weatherScene', 'snow', ...pathsBut('clouds', DEFAULT_CLOUDS, 'mode')], chips: ['clouds.mode'] },
  lumiere: { min: 'confirme', paths: ['atmosphere', 'shadows', 'cloudShadows', 'nightLightEv', 'sunDate', 'exposureEv', 'grading', 'film.nights', 'film.dayCards'], chips: ['sunFromTrack', 'sunHour'] },
  objectif: { min: 'expert', paths: ['lens'] },
}

/** `tabs` without the ones the mode hides, unless one of their settings is modified. */
export function useModeTabs(tabs: readonly ShellTab[]): readonly ShellTab[] {
  const mode = usePreferences((s) => s.uiMode)
  const shown = useAppStore((s) => {
    // the solar day is worked out only when a setting of the chips is modified
    const chosen = () => ambianceOf(s.settings, ambianceDay(s.frameOrigin, s.settings.sunDate, filmTrackOf(s.tracks, s.settings.race)?.stats.startTime, Date.now())) !== undefined
    return tabs
      .filter((tab) => {
        const rule = HIDDEN_TABS[tab]
        if (!rule || modeAtLeast(mode, rule.min) || modifiedPaths(s.settings, rule.paths).length > 0) return true
        return modifiedPaths(s.settings, rule.chips ?? []).length > 0 && !chosen()
      })
      .join()
  })
  return useMemo(() => (shown ? (shown.split(',') as ShellTab[]) : []), [shown])
}

/** The paths of the fields of the object setting `key` (`defaults`: its default value) but `except`: what a mode hides beside them. */
export function pathsBut(key: string, defaults: object, ...except: string[]): SettingPath[] {
  return Object.keys(defaults)
    .filter((field) => !except.includes(field))
    .map((field) => `${key}.${field}`) as SettingPath[]
}
