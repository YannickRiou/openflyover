/**
 * Height of the film timeline on this device (the handle between the 3D view and the timeline, `TimelineResizer`).
 * Pure: parsing, limits and keyboard steps. Not part of the project; `null` is the default layout (the timeline takes
 * the height of its content).
 */

/** Storage key (`getPlatform().storage`). */
export const TIMELINE_HEIGHT_KEY = 'openflyover.layout.v1'

/** The transport row on one line, and the ruler with the « Plans » lane (borders included). */
const BAR_MIN_PX = 40
const LANES_MIN_PX = 52
/** The 3D view keeps at least this share of the height they share. */
export const STAGE_MIN_RATIO = 0.35
/** Keyboard steps (arrows, with Shift). */
export const TIMELINE_STEP_PX = 16
export const TIMELINE_STEP_LARGE_PX = 64

/** The remembered height in px, null (default) when nothing usable is stored. */
export function parseTimelineHeight(raw: string | null): number | null {
  if (!raw) return null
  try {
    const h: unknown = (JSON.parse(raw) as { timelineH?: unknown } | null)?.timelineH
    return typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.round(h) : null
  } catch {
    return null
  }
}

/** Smallest and largest timeline height for `availablePx` shared with the view; `barPx` is the transport row's height when it wraps. */
export function timelineHeightRange(availablePx: number, barPx = BAR_MIN_PX): { min: number; max: number } {
  const min = Math.max(barPx, BAR_MIN_PX) + LANES_MIN_PX
  return { min, max: Math.max(min, Math.floor(availablePx * (1 - STAGE_MIN_RATIO))) }
}

export function clampTimelineHeight(px: number, availablePx: number, barPx?: number): number {
  const { min, max } = timelineHeightRange(availablePx, barPx)
  return Math.round(Math.min(max, Math.max(min, px)))
}
