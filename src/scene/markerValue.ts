/**
 * « Donnée au-dessus du marqueur »: one figure of the film's counters (altitude, slope, speed, heart rate…) shown on a
 * small panel above the lead marker, in the preview and in the export. The figure and its formatting are the counters'
 * (`counterText`), so the panel always reads like the overlay. The settings only (pure, and light: the store imports them);
 * the panel itself is `markerValuePanel.ts`.
 */
import { COUNTER_IDS } from '../overlay/settings'
import type { CounterId } from '../overlay/settings'

/** The figures of the panel: the counters but the number of outings (a « Bilan » figure). */
export const MARKER_VALUE_IDS = COUNTER_IDS.filter((id): id is Exclude<CounterId, 'outings'> => id !== 'outings')
/** 'aucune' = no panel. */
export type MarkerValue = 'aucune' | (typeof MARKER_VALUE_IDS)[number]

export const DEFAULT_MARKER_VALUE: MarkerValue = 'aucune'

export function isValidMarkerValue(value: MarkerValue): boolean {
  return value === 'aucune' || (MARKER_VALUE_IDS as readonly string[]).includes(value)
}
