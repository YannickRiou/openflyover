/**
 * The work area of the timeline (« Zone de lecture »): an in point and an out point, set with I and O or by dragging the
 * ends of the band on the ruler, between which the preview loops. Not part of the film (it is not saved, not an undo
 * step): a way of watching one stretch again and again while editing it. Pure module (no DOM, no React).
 */
import { clamp } from '../core/math'

export interface WorkArea {
  /** film time of the in point and of the out point (seconds at ×1) */
  inS: number
  outS: number
}

/** The shortest work area (seconds). */
export const WORK_AREA_MIN_S = 0.5

const round = (s: number) => Math.round(s * 10) / 10

/** `area` within a film of `totalS` seconds, to a tenth; null when it is not a stretch of at least WORK_AREA_MIN_S. */
export function clampWorkArea(area: WorkArea | null, totalS: number): WorkArea | null {
  if (!area) return null
  const inS = round(clamp(area.inS, 0, Math.max(0, totalS)))
  const outS = round(clamp(area.outS, 0, Math.max(0, totalS)))
  return outS - inS >= WORK_AREA_MIN_S ? { inS, outS } : null
}

/** The area with its in point at `timeS`; its out point stays, or goes to the end of the film when `timeS` passes it. */
export function markIn(area: WorkArea | null, timeS: number, totalS: number): WorkArea | null {
  const outS = area && area.outS - timeS >= WORK_AREA_MIN_S ? area.outS : totalS
  return clampWorkArea({ inS: timeS, outS }, totalS)
}

/** The area with its out point at `timeS`; its in point stays, or goes to the start of the film when `timeS` precedes it. */
export function markOut(area: WorkArea | null, timeS: number, totalS: number): WorkArea | null {
  const inS = area && timeS - area.inS >= WORK_AREA_MIN_S ? area.inS : 0
  return clampWorkArea({ inS, outS: timeS }, totalS)
}

/** The area with one end dragged to `timeS`, never closer than WORK_AREA_MIN_S to the other one. */
export function dragWorkArea(area: WorkArea, end: 'in' | 'out', timeS: number, totalS: number): WorkArea {
  if (end === 'in') return { inS: round(clamp(timeS, 0, Math.min(area.outS - WORK_AREA_MIN_S, totalS))), outS: area.outS }
  return { inS: area.inS, outS: round(clamp(timeS, Math.max(area.inS + WORK_AREA_MIN_S, 0), totalS)) }
}

/**
 * Film time the playback goes on from after a step: when it crossed the out point (from before it to at or after it) it
 * comes back to the in point by as much as it went past, else null (nothing to change). A step longer than the area
 * wraps as often as it needs.
 */
export function loopTime(fromS: number, toS: number, area: WorkArea): number | null {
  if (!(fromS < area.outS) || !(toS >= area.outS)) return null
  const length = area.outS - area.inS
  return area.inS + ((toS - area.outS) % length)
}
