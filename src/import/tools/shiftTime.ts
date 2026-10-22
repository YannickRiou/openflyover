import type { TrackSegment } from '../../core/types'
import type { Segments } from './common'

/** Minutes the clock of a track is ahead of UTC: its own (`Track.utcOffsetMin`), else this device's at `ms`. */
export function clockOffsetMin(utcOffsetMin: number | undefined, ms: number): number {
  return utcOffsetMin ?? -new Date(ms).getTimezoneOffset()
}

/** « 2026-07-12 » and « 08:30 » on the clock of the track at the instant `ms`. */
export function clockOf(ms: number, offsetMin: number): { day: string; time: string } {
  const iso = new Date(ms + offsetMin * 60_000).toISOString()
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) }
}

/** The instant of `day` ('YYYY-MM-DD') and `time` ('HH:MM') on a clock `offsetMin` ahead of UTC; undefined when they do not read. */
export function instantOf(day: string, time: string, offsetMin: number): number | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return undefined
  const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])) - offsetMin * 60_000
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * « Décaler l'heure »: `offsetMs` (signed) added to every time. Unchanged for an offset of zero or a track without times.
 * The weather and the snow follow: they read the recorded time.
 */
export function shiftTime(segments: Segments, offsetMs: number): Segments {
  if (!Number.isFinite(offsetMs) || offsetMs === 0) return segments
  if (!segments.some((s) => s.points.some((p) => p.time !== undefined))) return segments
  return segments.map((segment): TrackSegment => ({ points: segment.points.map((p) => (p.time === undefined ? p : { ...p, time: p.time + offsetMs })) }))
}
