/**
 * Timeline of the film (`ui/Timeline.tsx`): time <-> pixel scale, ruler, snapping, the edits made by its gestures (drag
 * a block or an edge, nudge, add, remove, attach a text or a medium to a stop), as pure functions. The component only
 * turns pointer and keyboard events into these calls and commits the result as one undo step.
 *
 * Items are selected by id: 'opening', 'closing', or the id of a stop, speed portion, camera key, text, medium or music
 * clip (unique across the film), or of a junction, stage or stage card of « À la suite » (`film/junctions.ts`). Times are film times (seconds at x1 from the first frame, opening included).
 */
import { clamp } from '../core/math'
import { FLYOVER_DURATION_RANGE } from '../flyover/cameraSettings'
import type { CameraSettings } from '../flyover/cameraSettings'
import { distanceAtTime, nearestOnPath, recordedTimeAt } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import type { ClockStop, FilmClock } from './clock'
import { hasStageItem, isJunctionItem, isStageCardItem, isStageItem, junctionCardOf, junctionTrackOf, resetJunction, stageCardAfterOf, stageTrackOf, withJunction, withJunctionCard, withStageDuration } from './junctions'
import {
  AUDIO_DEFAULTS,
  AUDIO_DURATION_RANGE,
  AUTO_STOP_S,
  CAMERA_KEY_RANGES,
  DEFAULT_FILM,
  FADE_RANGE,
  ITEM_DURATION_RANGE,
  JUNCTION_CARD_RANGE,
  JUNCTION_HOLD_RANGE,
  DAY_CARD_DURATION_RANGE,
  DEFAULT_DAY_CARDS,
  MEDIA_DEFAULTS,
  MIN_SPEED_SPAN_M,
  SHOT_DURATION_RANGE,
  SITUATION_DURATION_S,
  SPEED_FACTOR_RANGE,
  STAGE_DURATION_RANGE,
  STOP_DURATION_RANGE,
  VIDEO_SOUND_DEFAULTS,
  clipTimeS,
  nextFilmId,
} from './model'
import { dayCardIndexOf, isDayCardItem } from './days'
import type { Film, FilmAudio, FilmCameraKey, FilmMedia, FilmShot, FilmSpeed, FilmStop, FilmText, MediaSync } from './model'
import { clampParamValue } from './paramKeys'
import type { FilmParam, FilmParamKey } from './paramKeys'
import type { FilmMarkerKey, MarkerKeyLook } from './markerKeys'
import { t } from '../i18n'
import { decimalSeparator, formatNumberIntl } from '../i18n/format'

export type TimelineItem = 'opening' | 'closing' | string
/** part of a block a gesture holds: its body (move) or one of its edges */
export type Grip = 'move' | 'start' | 'end'

/** times and durations kept at 1/100 s: clean values in the project file */
const roundS = (s: number) => Math.round(s * 100) / 100

// ---------------------------------------------------------------------------
// Scale, ruler, zoom
// ---------------------------------------------------------------------------

export const ZOOM_RANGE = { min: 1, max: 50 } as const
/** « Zoom sur la sélection »: the shortest stretch it fits to the view (seconds), and the share of it left blank at each side. */
export const ZOOM_SPAN_MIN_S = 2
export const ZOOM_SPAN_MARGIN = 0.15

/** Pixels per second at zoom 1: the whole film fits `widthPx`. */
export function fitPxPerS(widthPx: number, totalS: number): number {
  return widthPx > 0 && totalS > 0 ? widthPx / totalS : 1
}

/**
 * Zoom by `factor` keeping the time under `anchorPx` (pixels from the left of the visible area) in place:
 * the new zoom (clamped to `ZOOM_RANGE`) and horizontal scroll.
 */
export function zoomAt(zoom: number, factor: number, anchorPx: number, scrollLeft: number): { zoom: number; scrollLeft: number } {
  const next = clamp(zoom * factor, ZOOM_RANGE.min, ZOOM_RANGE.max)
  return { zoom: next, scrollLeft: Math.max(0, ((scrollLeft + anchorPx) * next) / zoom - anchorPx) }
}

/**
 * Centred timeline (phone): the lanes carry half the visible width of blank at both ends and the playhead stays in the
 * middle, so the scroll is the film time: `t` seconds at `pxPerS` sit in the middle at this scroll. A zoom keeps the
 * playhead in place by itself (same `t`, new scale).
 */
export const centredScrollLeft = (t: number, pxPerS: number) => Math.max(0, t * pxPerS)

/** Film time in the middle of the centred timeline scrolled by `scrollLeft`, within the film. */
export const centredTime = (scrollLeft: number, pxPerS: number, totalS: number) => (pxPerS > 0 ? clamp(scrollLeft / pxPerS, 0, totalS) : 0)

/**
 * Speed of the automatic scroll of the zoomed timeline while a block or the playhead is dragged near one of its
 * edges (pixels per second, negative to the left): zero farther than `edgePx` from both edges, growing linearly to
 * `maxPxPerS` at the edge and beyond it.
 */
export function edgeScrollSpeed(clientX: number, left: number, right: number, edgePx = 48, maxPxPerS = 900): number {
  if (edgePx <= 0 || right - left <= 0) return 0
  const toLeft = clientX - left
  const toRight = right - clientX
  if (toLeft < edgePx && toLeft <= toRight) return -maxPxPerS * Math.min(1, (edgePx - toLeft) / edgePx)
  if (toRight < edgePx) return maxPxPerS * Math.min(1, (edgePx - toRight) / edgePx)
  return 0
}

const TICK_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** Seconds between two labelled ticks: the first step at least `minPx` wide. */
export function rulerStep(pxPerS: number, minPx = 76): number {
  return TICK_STEPS_S.find((step) => step * pxPerS >= minPx) ?? TICK_STEPS_S[TICK_STEPS_S.length - 1]
}

/** Width of the scrolling lanes: `pad` before the start, the film, `pad` after its end, never less than the view `viewW`. The tiny excess of float rounding is dropped, so a film that fits never gets a scrollbar. */
export function timelineContentWidth(viewW: number, totalS: number, pxPerS: number, pad: number): number {
  return Math.max(viewW, Math.ceil(2 * pad + totalS * pxPerS - 1e-6))
}

/** Room taken by the label of a tick, its line and its gap (pixels, « 10:00 » at most); a flipped label and the previous one stay apart because ticks are at least `minPx` (76) apart. */
export const TICK_LABEL_PX = 36

/** A tick whose label would run past the end of the content (`contentW`) is drawn to the left of its line, so the ruler never outgrows the film. */
export const tickLabelFlips = (xPx: number, contentW: number): boolean => xPx >= TICK_LABEL_PX && xPx + TICK_LABEL_PX > contentW

/** Labelled ticks of the ruler, from 0 to `totalS`. */
export function rulerTicks(totalS: number, pxPerS: number, minPx?: number): number[] {
  const step = rulerStep(pxPerS, minPx)
  const ticks: number[] = []
  for (let t = 0; t <= totalS + 1e-9; t += step) ticks.push(t)
  return ticks
}

/** 75.4 -> "1:15", with tenths "1:15,4" (film times are short: minutes are not split into hours). */
export function formatFilmTime(seconds: number, tenths = false): string {
  const t = Math.max(0, seconds)
  const units = tenths ? Math.round(t * 10) : Math.floor(t + 1e-6) * 10
  const m = Math.floor(units / 600)
  const s = String(Math.floor((units % 600) / 10)).padStart(2, '0')
  return tenths ? `${m}:${s}${decimalSeparator()}${units % 10}` : `${m}:${s}`
}

/** Timecode of the timeline bar, minutes on two digits at least: 75.4 -> "01:15,4", so its width stays the same while it plays. */
/** `mm:ss:ff` at `fps` frames a second (`01:07:12` = 1 min 7 s and 12 frames), the frames counted from the second's start. */
export function formatFrameTimecode(seconds: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps))
  const frames = Math.round(Math.max(0, seconds) * rate)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(Math.floor(frames / (60 * rate)))}:${pad(Math.floor(frames / rate) % 60)}:${pad(frames % rate)}`
}

/** Zoom and scroll that show the stretch `startS`–`endS` filling the view with a margin, within the zoom range. */
export function zoomToSpan(
  startS: number,
  endS: number,
  viewW: number,
  totalS: number,
  pad: number = 10,
): { zoom: number; scrollLeft: number } {
  const fit = fitPxPerS(Math.max(0, viewW - 2 * pad), totalS)
  const spanS = Math.max(endS - startS, ZOOM_SPAN_MIN_S)
  const pxPerS = viewW / (spanS * (1 + 2 * ZOOM_SPAN_MARGIN))
  const zoom = clamp(pxPerS / fit, ZOOM_RANGE.min, ZOOM_RANGE.max)
  const centre = (startS + endS) / 2
  return { zoom, scrollLeft: Math.max(0, pad + centre * fit * zoom - viewW / 2) }
}

export function formatTimecode(seconds: number, tenths = false): string {
  const text = formatFilmTime(seconds, tenths)
  return text.indexOf(':') < 2 ? `0${text}` : text
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** The nearest target within `thresholdS` of `t`, else `t` (positions along the track as well as times). */
export function snapValue(t: number, targets: readonly number[], thresholdS: number): number {
  let best = t
  let bestD = thresholdS
  for (const target of targets) {
    const d = Math.abs(target - t)
    if (d <= bestD) {
      best = target
      bestD = d
    }
  }
  return best
}

/** A time a dragged edge or block catches, and what it is (named on the alignment guide). */
export interface SnapTarget {
  timeS: number
  label: string
  kind: 'edge' | 'centre' | 'playhead' | 'junction' | 'ruler' | 'highlight' | 'end'
}

/** The families of snap targets the user can turn off one by one (`SnapTarget.kind`): the playhead, the blocks and keys, the ruler's marks, the junctions and highlights. */
export const SNAP_GROUPS = ['playhead', 'blocks', 'ruler', 'marks'] as const
export type SnapGroup = (typeof SNAP_GROUPS)[number]

export function snapGroupOf(kind: SnapTarget['kind']): SnapGroup {
  if (kind === 'playhead') return 'playhead'
  if (kind === 'ruler') return 'ruler'
  if (kind === 'junction' || kind === 'highlight') return 'marks'
  return 'blocks'
}

/** `targets` without the families switched off in `on`. */
export function snapTargetsOn(targets: readonly SnapTarget[], on: Readonly<Record<SnapGroup, boolean>>): SnapTarget[] {
  return targets.filter((target) => on[snapGroupOf(target.kind)])
}

/** What a gesture remembers between two pointer moves: the targets caught by the previous one, those caught by this one. */
export interface SnapState {
  held: readonly SnapTarget[]
  hits: SnapTarget[]
}

/** Targets at the same time (within a millisecond) are caught together. */
const SAME_TIME_S = 1e-3

/**
 * `t` caught by the nearest target within `pullS` (none when `pullS` is 0), else `t`; `hits` are all the targets at the
 * time it lands on. A target in `held` (caught a moment ago) is let go only when `t` is `releaseS` away, so that the
 * magnet does not flicker at its edge.
 */
export function snapTime(
  t: number,
  targets: readonly SnapTarget[],
  pullS: number,
  held: readonly SnapTarget[] = [],
  releaseS = pullS,
): { timeS: number; hits: SnapTarget[] } {
  if (!(pullS > 0)) return { timeS: t, hits: [] }
  let best: SnapTarget | undefined
  let bestD = releaseS
  for (const target of held) {
    const d = Math.abs(target.timeS - t)
    if (d <= bestD) {
      best = target
      bestD = d
    }
  }
  if (!best) {
    bestD = pullS
    for (const target of targets) {
      const d = Math.abs(target.timeS - t)
      if (d <= bestD) {
        best = target
        bestD = d
      }
    }
  }
  if (!best) return { timeS: t, hits: [] }
  const at = best.timeS
  return { timeS: at, hits: targets.filter((x) => Math.abs(x.timeS - at) <= SAME_TIME_S) }
}

/** A block of the timeline, for the targets that only the component knows (cards, junctions). */
export interface SnapBlock {
  id: string
  startS: number
  endS: number
  label: string
}

/**
 * Times a dragged edge or block snaps to, named: start and end of the film, edges of the shots, edges and centres of the
 * stops, speed portions, texts, media and music clips and of the `blocks` (cards, junctions) but those of `except` (one
 * item, or the several that move together),
 * the camera, parameter and marker keys, the junctions between the stages of « À la suite », highlights (progress
 * values), the ruler's `ticks` and the playhead.
 */
export function snapTargets(
  clock: FilmClock,
  film: Film,
  highlights: readonly number[],
  playheadS: number,
  except?: TimelineItem | readonly TimelineItem[],
  extra: { ticks?: readonly number[]; blocks?: readonly SnapBlock[] } = {},
): SnapTarget[] {
  const total = clock.totalTime()
  const skipped = (id: string) => (typeof except === 'string' ? id === except : (except?.includes(id) ?? false))
  const out: SnapTarget[] = [
    { timeS: 0, label: t('film.snap.filmStart'), kind: 'end' },
    { timeS: total, label: t('film.snap.filmEnd'), kind: 'end' },
    { timeS: clock.openingS, label: t('film.snap.flyoverStart'), kind: 'edge' },
    { timeS: total - clock.closingS, label: t('film.snap.flyoverEnd'), kind: 'edge' },
    { timeS: playheadS, label: t('film.snap.playhead'), kind: 'playhead' },
  ]
  /** both edges and the middle of a block */
  const block = (name: string, startS: number, endS: number) => {
    out.push({ timeS: startS, label: t('film.snap.start', { name }), kind: 'edge' }, { timeS: endS, label: t('film.snap.end', { name }), kind: 'edge' })
    if (endS > startS) out.push({ timeS: (startS + endS) / 2, label: t('film.snap.middle', { name }), kind: 'centre' })
  }
  clock.junctions.forEach((j, k) => {
    if (skipped(j.id)) return
    const name = t('film.snap.junctionLower', { n: k + 1 })
    if (j.endS > j.startS) block(name, j.startS, j.endS)
    out.push({ timeS: j.holdStartS, label: t('film.snap.junction', { n: k + 1 }), kind: 'junction' })
  })
  // a cut of a clock built without junctions
  if (clock.junctions.length === 0) clock.cuts.forEach((c, k) => out.push({ timeS: c.timeS, label: t('film.snap.junction', { n: k + 1 }), kind: 'junction' }))
  for (const s of clock.stops) if (!skipped(s.id)) block(s.label || t('film.snap.hold'), s.startS, s.endS)
  for (const s of clock.speeds) if (!skipped(s.id)) block(t('film.snap.speedSection', { factor: formatSpeedFactor(s.factor) }), s.startS, s.endS)
  for (const text of film.texts) if (!skipped(text.id)) block(text.text.trim().slice(0, 24) || t('film.snap.text'), text.startS, text.startS + text.durationS)
  for (const m of film.media) if (!skipped(m.id)) block(m.kind === 'video' ? t('film.snap.video') : t('film.snap.photo'), m.startS, m.startS + m.durationS)
  for (const a of film.audio) if (!skipped(a.id)) block(t('film.snap.music'), a.startS, a.startS + a.durationS)
  for (const b of extra.blocks ?? []) if (!skipped(b.id)) block(b.label, b.startS, b.endS)
  for (const [keys, name] of [
    [clock.cameraKeys, t('film.snap.keyframe')],
    [clock.paramKeys, t('film.snap.setting')],
    [clock.markerKeys, t('film.snap.marker')],
  ] as const) {
    for (const k of keys) if (!skipped(k.id)) out.push({ timeS: k.timeS, label: name, kind: 'edge' })
  }
  for (const h of highlights) out.push({ timeS: clock.timeAtProgress(h), label: t('film.snap.highlight'), kind: 'highlight' })
  for (const tick of extra.ticks ?? []) out.push({ timeS: tick, label: formatFilmTime(tick), kind: 'ruler' })
  return out
}

/**
 * `snap` of a gesture: the time caught by `ctx.targets` within `ctx.snapS` (kept until `ctx.releaseS`), the targets
 * caught recorded in `ctx.snapState` for the alignment guides.
 */
export function snapper(ctx: Pick<DragContext, 'targets' | 'snapS' | 'releaseS' | 'snapState'>): (t: number) => number {
  return (t) => {
    const { timeS, hits } = snapTime(t, ctx.targets, ctx.snapS, ctx.snapState?.held, ctx.releaseS ?? ctx.snapS)
    if (hits.length > 0) ctx.snapState?.hits.push(...hits)
    return timeS
  }
}

// ---------------------------------------------------------------------------
// Placing a stop in time
// ---------------------------------------------------------------------------

/** Clock of the film with other stops (same shots, track and pacing). */
export type ClockOfStops = (stops: readonly FilmStop[]) => FilmClock

const BISECTION_STEPS = 32

/**
 * Position in [lo, hi] at which `timeOf` (non-decreasing) reaches `targetS`, by bisection; the nearest end when the
 * target is out of reach.
 */
export function positionAtTime(timeOf: (m: number) => number, targetS: number, lo: number, hi: number): number {
  if (!(hi > lo) || targetS <= timeOf(lo)) return lo
  if (targetS >= timeOf(hi)) return hi
  for (let k = 0; k < BISECTION_STEPS; k++) {
    const mid = (lo + hi) / 2
    if (timeOf(mid) < targetS) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Position (metres along the track, in [0, `lengthM`]) at which stop `id` starts its hold at film time `holdStartS`:
 * the inverse of the clock for that stop, by bisection (its window moves later as it moves along the track; times
 * inside another stop's window are not reachable and give the nearest position next to it).
 */
export function stopPositionAt(clockOf: ClockOfStops, stops: readonly FilmStop[], id: string, holdStartS: number, lengthM: number): number {
  const holdAt = (atM: number) => {
    const clock = clockOf(stops.map((s) => (s.id === id ? { ...s, atM } : s)))
    return clock.stops.find((s) => s.id === id)?.holdStartS ?? 0
  }
  return positionAtTime(holdAt, holdStartS, 0, lengthM)
}

/** Clock of the film with other speed portions (same shots, track, pacing and stops). */
export type ClockOfSpeeds = (speeds: readonly FilmSpeed[]) => FilmClock

/** Free stretch of the track around portion `id`: from the end of the portion before it to the start of the next. */
function speedRoom(speeds: readonly FilmSpeed[], own: Pick<FilmSpeed, 'id' | 'fromM' | 'toM'>, lengthM: number): { lo: number; hi: number } {
  let lo = 0
  let hi = lengthM
  for (const s of speeds) {
    if (s.id === own.id) continue
    if (s.toM <= own.fromM) lo = Math.max(lo, s.toM)
    else if (s.fromM >= own.toM) hi = Math.min(hi, s.fromM)
  }
  return { lo, hi }
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

/**
 * What a press on edge grip `grip`, `offsetPx` into a block `widthPx` wide with `grips`, drags: on a movable block,
 * an edge only from the outer third of its side, else the block (on a narrow block the touch grips, or the
 * browser's touch adjustment, reach past it).
 */
export function pressedGrip(grip: Grip, offsetPx: number, widthPx: number, grips: readonly Grip[]): Grip {
  if (!grips.includes('move')) return grip
  if (offsetPx <= widthPx / 3 && grips.includes('start')) return 'start'
  if (offsetPx >= (2 * widthPx) / 3 && grips.includes('end')) return 'end'
  return 'move'
}

export interface DragContext {
  /** clock of the film at the start of the gesture */
  clock: FilmClock
  clockOf: ClockOfStops
  /** length of the first track (metres) */
  lengthM: number
  /** times an edge snaps to (`snapTargets`) */
  targets: readonly SnapTarget[]
  /** positions a moved stop snaps to (metres along the track: the highlights) */
  targetsM: readonly number[]
  /** snapping distance (seconds; 0 = no snapping) */
  snapS: number
  /** distance at which a caught target is let go (seconds; default `snapS`) */
  releaseS?: number
  /** what the gesture remembers of its snaps (alignment guides, hysteresis) */
  snapState?: SnapState
  /** clock of a film retouched (a junction's hold moves what comes after it) */
  clockOfFilm?: (film: Film) => FilmClock
  /** clock with other speed portions (speed portions are left as they are without it) */
  clockOfSpeeds?: ClockOfSpeeds
  /** length of a sound file of the media table (a music clip never plays past the end of its file) */
  audioFileS?: (src: string) => number | undefined
}

const shotDuration = (d: number) => roundS(clamp(d, SHOT_DURATION_RANGE.min, SHOT_DURATION_RANGE.max))
const stopDuration = (d: number) => roundS(clamp(d, STOP_DURATION_RANGE.min, STOP_DURATION_RANGE.max))
const itemDuration = (d: number) => roundS(clamp(d, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max))
/** longest a music clip may play from `inS` in a file of `fileS` seconds */
const musicMaxS = (inS: number, fileS = Infinity) => Math.max(AUDIO_DURATION_RANGE.min, Math.min(AUDIO_DURATION_RANGE.max, fileS - inS))

/**
 * Music clip `own` after dragging `grip` by `deltaS`: moved (start snapped, else end), or stretched by its end (never
 * past the end of the file), or by its start, which moves its start in the file along (never before the file's).
 */
function dragMusic(own: FilmAudio, grip: Grip, deltaS: number, fileS: number | undefined, snap: (t: number) => number): FilmAudio {
  const start = own.startS
  const end = own.startS + own.durationS
  if (grip === 'move') {
    const snappedStart = snap(start + deltaS)
    const shift = snappedStart !== start + deltaS ? snappedStart - start : snap(end + deltaS) - end
    return { ...own, startS: roundS(Math.max(0, start + shift)) }
  }
  if (grip === 'start') {
    const min = Math.max(0, start - own.inS, end - musicMaxS(0, fileS))
    const s = clamp(snap(start + deltaS), min, end - AUDIO_DURATION_RANGE.min)
    return { ...own, startS: roundS(s), durationS: roundS(end - s), inS: roundS(Math.max(0, own.inS + s - start)) }
  }
  const durationS = clamp(snap(end + deltaS) - start, AUDIO_DURATION_RANGE.min, musicMaxS(own.inS, fileS))
  return { ...own, durationS: roundS(durationS) }
}

function withShot(film: Film, key: 'opening' | 'closing', durationS: number): Film {
  const shot: FilmShot = film[key]
  return shot.style === 'aucune' ? film : { ...film, [key]: { ...shot, durationS: shotDuration(durationS) } }
}

/**
 * Dragging the start of the closing is a roll edit between the flight and the closing: the end of the film stays
 * where it is, the closing starts where the pointer is and the flight takes (or gives back) the difference.
 * `dragged` is `dragFilm` of `start` for that grip; returns it with the closing the flight could absorb and the new
 * flight duration (FLYOVER_DURATION_RANGE).
 */
export function rollClosing(start: Film, dragged: Film, flightS: number): { film: Film; flightS: number } {
  const deltaS = start.closing.durationS - dragged.closing.durationS
  const flight = clamp(flightS + deltaS, FLYOVER_DURATION_RANGE.min, FLYOVER_DURATION_RANGE.max)
  if (flight - flightS === deltaS) return { film: dragged, flightS: flight }
  return { film: withShot(start, 'closing', start.closing.durationS - (flight - flightS)), flightS: flight }
}

/** Move the stop so that its hold starts `deltaS` later; snaps to a highlight (by position). */
function moveStop(film: Film, stop: ClockStop, deltaS: number, ctx: DragContext): number {
  const { clock, lengthM } = ctx
  const atM = stopPositionAt(ctx.clockOf, film.stops, stop.id, stop.holdStartS + deltaS, lengthM)
  // snapping distance in metres at the mean speed of the flight
  const snapM = clock.flightS > 0 ? (ctx.snapS * lengthM) / clock.flightS : 0
  const snapped = snapValue(atM, ctx.targetsM, snapM)
  return snapped === atM ? Math.round(atM) : snapped
}

/**
 * Portion `own` after dragging `grip` by `deltaS`: the edge held (both for a move) follows the pointer in film time,
 * found in metres on the clock with the portion changed (`ctx.clockOfSpeeds`); never over its neighbours, nor
 * shorter than `MIN_SPEED_SPAN_M`; rounded to the metre.
 */
function dragSpeed(film: Film, own: FilmSpeed, grip: Grip, deltaS: number, ctx: DragContext, snap: (t: number) => number): FilmSpeed {
  const placed = ctx.clock.speeds.find((s) => s.id === own.id)
  const clockOf = ctx.clockOfSpeeds
  if (!placed || !clockOf) return own
  const { lo, hi } = speedRoom(film.speeds, own, ctx.lengthM)
  const timesOf = (fromM: number, toM: number) => {
    const s = clockOf(film.speeds.map((p) => (p.id === own.id ? { ...p, fromM, toM } : p))).speeds.find((p) => p.id === own.id)
    return s ?? placed
  }
  const span = own.toM - own.fromM
  if (grip === 'move') {
    const start = placed.startS + deltaS
    const end = placed.endS + deltaS
    const snappedStart = snap(start)
    let fromM: number
    if (snappedStart === start && snap(end) !== end) {
      fromM = positionAtTime((m) => timesOf(m - span, m).endS, snap(end), lo + span, hi) - span
    } else {
      fromM = positionAtTime((m) => timesOf(m, m + span).startS, snappedStart, lo, hi - span)
    }
    const from = Math.round(clamp(fromM, lo, hi - span))
    return { ...own, fromM: from, toM: from + span }
  }
  if (grip === 'start') {
    const fromM = positionAtTime((m) => timesOf(m, own.toM).startS, snap(placed.startS + deltaS), lo, own.toM - MIN_SPEED_SPAN_M)
    return { ...own, fromM: Math.round(clamp(fromM, lo, own.toM - MIN_SPEED_SPAN_M)) }
  }
  const toM = positionAtTime((m) => timesOf(own.fromM, m).endS, snap(placed.endS + deltaS), own.fromM + MIN_SPEED_SPAN_M, hi)
  return { ...own, toM: Math.round(clamp(toM, own.fromM + MIN_SPEED_SPAN_M, hi)) }
}

/**
 * The film after dragging `grip` of `item` by `deltaS` seconds from the gesture start (`film` is the film at the
 * start, stops written out for a stop): opening end, closing start, stop moved along the track (hold start
 * follows the pointer) or stretched (end edge), speed portion moved or stretched by either edge (in metres along
 * the track), camera key moved along the track, text or medium moved or stretched by either edge. Edges snap to `ctx.targets`; values are clamped
 * to the model ranges. Unknown items and grips leave the film as is.
 */
export function dragFilm(film: Film, item: TimelineItem, grip: Grip, deltaS: number, ctx: DragContext): Film {
  const snap = snapper(ctx)
  const { clock } = ctx
  if (item === 'opening') return withShot(film, 'opening', snap(clock.openingS + deltaS))
  if (item === 'closing') {
    const end = clock.totalTime()
    return withShot(film, 'closing', end - snap(end - clock.closingS + deltaS))
  }

  if (isJunctionItem(item)) return dragJunction(film, junctionTrackOf(item), grip, deltaS, ctx, snap)
  if (isStageCardItem(item)) return dragStageCard(film, stageCardAfterOf(item), grip, deltaS, ctx, snap)
  if (isDayCardItem(item)) return dragDayCard(film, dayCardIndexOf(item), grip, deltaS, ctx, snap)
  if (isStageItem(item)) return dragStage(film, stageTrackOf(item), grip, deltaS, ctx, snap)

  const stop = clock.stops.find((s) => s.id === item)
  if (stop && film.stops.some((s) => s.id === item)) {
    const own = film.stops.find((s) => s.id === item)!
    if (grip === 'move') {
      const atM = moveStop(film, stop, deltaS, ctx)
      return { ...film, stops: film.stops.map((s) => (s.id === item ? { ...s, atM } : s)) }
    }
    if (grip !== 'end') return film
    // the clock may shorten the stops (`keepDuration` cap): stretch in that proportion
    const share = own.durationS > 0 && stop.addedS > 0 ? stop.addedS / own.durationS : 1
    const added = snap(stop.endS + deltaS) - stop.endS
    const durationS = stopDuration(own.durationS + added / share)
    return { ...film, stops: film.stops.map((s) => (s.id === item ? { ...s, durationS } : s)) }
  }

  const key = clock.cameraKeys.find((k) => k.id === item)
  if (key && grip === 'move') {
    // the key follows the pointer in film time: its place is where the marker is then
    const atM = Math.round(clamp(clock.progressAtTime(snap(key.timeS + deltaS)), 0, 1) * ctx.lengthM)
    return { ...film, cameraKeys: film.cameraKeys.map((k) => (k.id === item ? { ...k, atM } : k)) }
  }

  const paramKey = clock.paramKeys.find((k) => k.id === item)
  if (paramKey && grip === 'move') {
    const atM = Math.round(clamp(clock.progressAtTime(snap(paramKey.timeS + deltaS)), 0, 1) * ctx.lengthM)
    return { ...film, paramKeys: film.paramKeys.map((k) => (k.id === item ? { ...k, atM } : k)) }
  }

  const markerKey = clock.markerKeys.find((k) => k.id === item)
  if (markerKey && grip === 'move') {
    const atM = Math.round(clamp(clock.progressAtTime(snap(markerKey.timeS + deltaS)), 0, 1) * ctx.lengthM)
    return { ...film, markerKeys: film.markerKeys.map((k) => (k.id === item ? { ...k, atM } : k)) }
  }

  const speed = film.speeds.find((s) => s.id === item)
  if (speed) {
    const next = dragSpeed(film, speed, grip, deltaS, ctx, snap)
    return next.fromM === speed.fromM && next.toM === speed.toM ? film : { ...film, speeds: film.speeds.map((s) => (s.id === item ? next : s)) }
  }

  const music = film.audio.find((a) => a.id === item)
  if (music) {
    const next = dragMusic(music, grip, deltaS, ctx.audioFileS?.(music.src), snap)
    return { ...film, audio: film.audio.map((a) => (a.id === item ? next : a)) }
  }

  const lane = film.texts.some((t) => t.id === item) ? 'texts' : 'media'
  const timed: FilmText | FilmMedia | undefined = film[lane].find((t) => t.id === item)
  if (!timed) return film
  const start = timed.startS
  const end = timed.startS + timed.durationS
  let next: Timed
  if (grip === 'move') {
    const snappedStart = snap(start + deltaS)
    const shift = snappedStart !== start + deltaS ? snappedStart - start : snap(end + deltaS) - end
    next = { startS: roundS(Math.max(0, start + shift)), durationS: timed.durationS }
  } else if (grip === 'start') {
    // a video keeps its frames in place: its start in the file follows the edge (not before the start of the file)
    const inS = 'kind' in timed && timed.kind === 'video' ? (timed.inS ?? 0) : undefined
    const min = Math.max(0, end - ITEM_DURATION_RANGE.max, inS === undefined ? 0 : start - inS)
    const s = clamp(snap(start + deltaS), min, end - ITEM_DURATION_RANGE.min)
    next = { startS: roundS(s), durationS: itemDuration(end - s) }
    if (inS !== undefined) next.inS = roundS(Math.max(0, inS + s - start))
  } else {
    next = { startS: start, durationS: itemDuration(snap(end + deltaS) - start) }
  }
  return lane === 'texts'
    ? { ...film, texts: film.texts.map((t) => (t.id === item ? { ...t, ...next } : t)) }
    : { ...film, media: film.media.map((m) => (m.id === item ? { ...m, ...next } : m)) }
}

/**
 * Several camera, parameter and marker keys (`ids`) dragged together by `deltaS`, `lead` being the one under the pointer:
 * its time is snapped like a key dragged alone, the others keep their gaps in film time. The group stays on the flight
 * (the shift is bounded by its first and last key); each key lands at the metre of the marker at its new time.
 */
export function dragKeys(film: Film, ids: readonly string[], lead: string, deltaS: number, ctx: DragContext): Film {
  const { clock } = ctx
  const keys = [...clock.cameraKeys, ...clock.paramKeys, ...clock.markerKeys].filter((k) => ids.includes(k.id))
  const under = keys.find((k) => k.id === lead)
  if (!under) return film
  const first = Math.min(...keys.map((k) => k.timeS))
  const last = Math.max(...keys.map((k) => k.timeS))
  const shiftS = clamp(snapper(ctx)(under.timeS + deltaS) - under.timeS, clock.timeAtProgress(0) - first, clock.timeAtProgress(1) - last)
  const atM = (timeS: number) => Math.round(clamp(clock.progressAtTime(timeS + shiftS), 0, 1) * ctx.lengthM)
  let moved = film
  for (const k of clock.cameraKeys) if (ids.includes(k.id)) moved = updateCameraKey(moved, k.id, { atM: atM(k.timeS) })
  for (const k of clock.paramKeys) if (ids.includes(k.id)) moved = updateParamKey(moved, k.id, { atM: atM(k.timeS) })
  for (const k of clock.markerKeys) if (ids.includes(k.id)) moved = updateMarkerKey(moved, k.id, { atM: atM(k.timeS) })
  return moved
}

/** What a gesture changes on a text or a medium (and the start in the file of a video). */
type Timed = Pick<FilmMedia, 'startS' | 'durationS' | 'inS'>

/**
 * The film after dragging the right edge of the junction after `afterTrackId` by `deltaS`: its hold follows the
 * pointer (the end of its pause, found on the clock of the film with the hold changed: `ctx.clockOfFilm`), within
 * `JUNCTION_HOLD_RANGE`. A cut and a night (its length is the night's) do not stretch.
 */
function dragJunction(film: Film, afterTrackId: string, grip: Grip, deltaS: number, ctx: DragContext, snap: (t: number) => number): Film {
  const placed = ctx.clock.junctions.find((j) => j.afterTrackId === afterTrackId)
  const clockOfFilm = ctx.clockOfFilm
  if (grip !== 'end' || !placed || !clockOfFilm || placed.kind === 'coupe' || placed.kind === 'nuit') return film
  const endAt = (holdS: number) => clockOfFilm(withJunction(film, afterTrackId, { holdS })).junctions.find((j) => j.afterTrackId === afterTrackId)?.endS ?? placed.endS
  const holdS = positionAtTime(endAt, snap(placed.endS + deltaS), JUNCTION_HOLD_RANGE.min, JUNCTION_HOLD_RANGE.max)
  return withJunction(film, afterTrackId, { holdS })
}

/**
 * The film after dragging the right edge of the stage of track `trackId` by `deltaS`: its flight time follows the pointer
 * (the end of the stage, found on the clock of the film with the duration changed: `ctx.clockOfFilm`, so what comes after
 * ripples), within `STAGE_DURATION_RANGE`. The stage is the one before the junction after that track, the last one without.
 */
function dragStage(film: Film, trackId: string, grip: Grip, deltaS: number, ctx: DragContext, snap: (t: number) => number): Film {
  const clockOfFilm = ctx.clockOfFilm
  if (grip !== 'end' || !clockOfFilm) return film
  const endOf = (clock: FilmClock) => clock.junctions.find((j) => j.afterTrackId === trackId)?.startS ?? clock.openingS + clock.flightS
  const durationS = positionAtTime((d) => endOf(clockOfFilm(withStageDuration(film, trackId, d))), snap(endOf(ctx.clock) + deltaS), STAGE_DURATION_RANGE.min, STAGE_DURATION_RANGE.max)
  return withStageDuration(film, trackId, durationS)
}

/** The cards of the days with the end edge of day `k`'s dragged by `deltaS`: the duration they all share. */
function dragDayCard(film: Film, k: number, grip: Grip, deltaS: number, ctx: DragContext, snap: (t: number) => number): Film {
  const day = ctx.clock.days[k]
  const cards = film.dayCards ?? DEFAULT_DAY_CARDS
  if (grip !== 'end' || !day) return film
  const durationS = clamp(snap(day.cardS + cards.durationS + deltaS) - day.cardS, DAY_CARD_DURATION_RANGE.min, DAY_CARD_DURATION_RANGE.max)
  return { ...film, dayCards: { ...cards, durationS } }
}

/**
 * The card after junction `afterTrackId` (null: the first stage) with its end edge dragged by `deltaS`: its duration,
 * counted from the start of the stage's flight (`stageCardWindow`).
 */
function dragStageCard(film: Film, afterTrackId: string | null, grip: Grip, deltaS: number, ctx: DragContext, snap: (t: number) => number): Film {
  const flightS = afterTrackId === null ? ctx.clock.openingS : ctx.clock.junctions.find((j) => j.afterTrackId === afterTrackId)?.endS
  if (grip !== 'end' || flightS === undefined) return film
  const own = junctionCardOf(film, afterTrackId)
  const durationS = clamp(snap(flightS + own.durationS + deltaS) - flightS, JUNCTION_CARD_RANGE.min, JUNCTION_CARD_RANGE.max)
  return withJunctionCard(film, afterTrackId, { durationS })
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** A stop added at `atM` (manual unless a source is given), orbiting, `AUTO_STOP_S`; with its new id. */
export function addStop(film: Film, atM: number, patch: Partial<Omit<FilmStop, 'id' | 'atM'>> = {}): { film: Film; id: string } {
  const id = nextFilmId(film, 'stop')
  const label = patch.label ?? t('film.defaultHold', { n: id.slice('stop-'.length) })
  const stop: FilmStop = { durationS: AUTO_STOP_S, camera: 'orbite', source: { kind: 'manual' }, ...patch, id, atM: Math.max(0, atM), label }
  return { film: { ...film, stops: [...film.stops, stop] }, id }
}

/** Length of a speed portion added on the timeline (metres) and its factor. */
export const NEW_SPEED_M = 1000
export const NEW_SPEED_FACTOR = 2

/**
 * A portion `NEW_SPEED_FACTOR` times faster added from `atM` metres (`NEW_SPEED_M` long, shorter or earlier to stay on
 * the track and off the other portions); with its new id. Null when `atM` is inside a portion or the free room is
 * shorter than `MIN_SPEED_SPAN_M`.
 */
export function addSpeed(film: Film, atM: number, lengthM: number): { film: Film; id: string } | null {
  const at = clamp(atM, 0, lengthM)
  if (film.speeds.some((s) => at >= s.fromM && at < s.toM)) return null
  const { lo, hi } = speedRoom(film.speeds, { id: '', fromM: at, toM: at }, lengthM)
  const toM = Math.min(hi, at + NEW_SPEED_M)
  const fromM = Math.max(lo, Math.min(at, toM - NEW_SPEED_M))
  const from = Math.ceil(fromM)
  const to = Math.floor(toM)
  if (to - from < MIN_SPEED_SPAN_M) return null
  const id = nextFilmId(film, 'speed')
  return { film: { ...film, speeds: [...film.speeds, { id, fromM: from, toM: to, factor: NEW_SPEED_FACTOR }] }, id }
}

/** Pose of a keyframe added or taken over: its aim shift stays as it was when not given. */
type KeyPose = Pick<FilmCameraKey, 'distance' | 'pitchDeg' | 'headingOffsetDeg' | 'aimRightM' | 'aimAheadM'>

/**
 * A keyframe (« Image clé ») added at `atM` with pose `framing`; with its id. A key already at that metre takes the
 * pose and the place instead (one key per place).
 */
export function addCameraKey(film: Film, atM: number, framing: KeyPose): { film: Film; id: string } {
  const at = Math.max(0, atM)
  const there = film.cameraKeys.find((k) => Math.round(k.atM) === Math.round(at))
  if (there) return { film: updateCameraKey(film, there.id, { ...framing, atM: at }), id: there.id }
  const id = nextFilmId(film, 'camera')
  return { film: updateCameraKey({ ...film, cameraKeys: [...film.cameraKeys, { ...framing, id, atM: at }] }, id, {}), id }
}

/**
 * A parameter key (« Réglage ») for `param` at `atM`, with its id. A key of that parameter already at that metre takes
 * the value instead (one key per parameter and place).
 */
export function addParamKey(film: Film, atM: number, param: FilmParam, value: number): { film: Film; id: string } {
  const at = Math.max(0, atM)
  const there = film.paramKeys.find((k) => k.param === param && Math.round(k.atM) === Math.round(at))
  if (there) return { film: updateParamKey(film, there.id, { value }), id: there.id }
  const id = nextFilmId(film, 'param')
  return { film: updateParamKey({ ...film, paramKeys: [...film.paramKeys, { id, atM: at, param, value }] }, id, {}), id }
}

/** Parameter key `id` with `patch`: the value is kept in the range of its parameter, the place on the track. */
export function updateParamKey(film: Film, id: string, patch: Partial<Omit<FilmParamKey, 'id'>>): Film {
  return {
    ...film,
    paramKeys: film.paramKeys.map((k) => {
      if (k.id !== id) return k
      const next = { ...k, ...patch }
      return { ...next, atM: Math.max(0, next.atM), value: clampParamValue(next.param, next.value) }
    }),
  }
}

/**
 * A marker key at `atM` with the look `look`, and its id. A key already at that metre takes the look instead (one key
 * per place).
 */
export function addMarkerKey(film: Film, atM: number, look: MarkerKeyLook): { film: Film; id: string } {
  const at = Math.max(0, Math.round(atM))
  const there = film.markerKeys.find((k) => Math.round(k.atM) === at)
  if (there) return { film: updateMarkerKey(film, there.id, look), id: there.id }
  const id = nextFilmId(film, 'marker')
  return { film: { ...film, markerKeys: [...film.markerKeys, { id, atM: at, ...look }] }, id }
}

/** Marker keys at each of `placesM` that has none, with the look `look` (the junctions of a chained or sequenced track). */
export function addMarkerKeysAt(film: Film, placesM: readonly number[], look: MarkerKeyLook): Film {
  return placesM.reduce((f, atM) => (f.markerKeys.some((k) => Math.round(k.atM) === Math.round(atM)) ? f : addMarkerKey(f, atM, look).film), film)
}

/** Marker key `id` with `patch` (the place stays on the track; no picture of its own: `imageId: undefined`). */
export function updateMarkerKey(film: Film, id: string, patch: Partial<Omit<FilmMarkerKey, 'id'>>): Film {
  return {
    ...film,
    markerKeys: film.markerKeys.map((k) => (k.id === id ? { ...k, ...patch, atM: Math.max(0, patch.atM ?? k.atM) } : k)),
  }
}

const KEY_EPSILON_S = 1e-3

/** The keyframe at film time `timeS` (the playhead is on it), null when there is none. */
export function keyAt<T extends { timeS: number }>(keys: readonly T[], timeS: number): T | null {
  return keys.find((k) => Math.abs(k.timeS - timeS) <= KEY_EPSILON_S) ?? null
}

/**
 * The keyframe just before (`direction` -1) or after (1) film time `timeS` (« Image clé précédente / suivante »), null
 * when there is none; one at `timeS` is skipped.
 */
export function adjacentKey<T extends { timeS: number }>(keys: readonly T[], timeS: number, direction: -1 | 1): T | null {
  let best: T | null = null
  for (const k of keys) {
    const ahead = direction > 0 ? k.timeS > timeS + KEY_EPSILON_S : k.timeS < timeS - KEY_EPSILON_S
    if (ahead && (best === null || (k.timeS - best.timeS) * direction < 0)) best = k
  }
  return best
}

/** What the key buttons need to know at film time `timeS`: a key before, a key after, the playhead on a key. */
export function keyState<T extends { timeS: number }>(keys: readonly T[], timeS: number): { prev: boolean; next: boolean; on: boolean } {
  return { prev: adjacentKey(keys, timeS, -1) !== null, next: adjacentKey(keys, timeS, 1) !== null, on: keyAt(keys, timeS) !== null }
}

/**
 * A camera of its own for a text or a photo shown from film time `startS` to `endS`: a camera key where the marker is at
 * its start (the framing there, to adjust: it is the key returned) and, when the marker moves meanwhile, one at its end
 * keeping the framing that was there, so that the rest of the film is unchanged. `framingAt` gives the framing the
 * film has at a position (camera keys included), `atTime` the position at a film time.
 */
export function addItemCamera(
  film: Film,
  startS: number,
  endS: number,
  atTime: (timeS: number) => number,
  framingAt: (atM: number) => Pick<CameraSettings, 'distance' | 'pitchDeg' | 'headingOffsetDeg'>,
): { film: Film; id: string } {
  const fromM = Math.round(atTime(startS))
  const toM = Math.round(atTime(endS))
  const after = toM > fromM ? addCameraKey(film, toM, framingAt(toM)).film : film
  return addCameraKey(after, fromM, framingAt(fromM))
}

/** Length of a text added on the timeline (seconds). */
export const NEW_TEXT_S = 4

/** A text added at film time `startS`, centred low, normal size, or attached to `stop` (`attachToStop`); with its new id. */
export function addText(film: Film, startS: number, stop: ClockStop | null = null): { film: Film; id: string } {
  const id = nextFilmId(film, 'text')
  const text: FilmText = { id, startS: roundS(Math.max(0, startS)), durationS: NEW_TEXT_S, text: t('film.defaultText'), anchor: 'bottom-center', size: 1 }
  const next = { ...film, texts: [...film.texts, text] }
  return { film: stop ? attachToStop(next, id, stop) : next, id }
}

// ---------------------------------------------------------------------------
// Blocks by film time as a group: move, copy, paste, ripple
// ---------------------------------------------------------------------------

/** The ids of the items that sit on the timeline by film time and can be picked together, copied and pasted: texts, media and music. */
export const timedBlockIds = (film: Film): string[] => [...film.texts, ...film.media, ...film.audio].map((item) => item.id)

/** An item of the time-keyed lanes by id, with the lane it is in. */
function timedItem(film: Film, id: string): { lane: 'texts' | 'media' | 'audio'; item: FilmText | FilmMedia | FilmAudio } | null {
  const text = film.texts.find((i) => i.id === id)
  if (text) return { lane: 'texts', item: text }
  const medium = film.media.find((i) => i.id === id)
  if (medium) return { lane: 'media', item: medium }
  const music = film.audio.find((i) => i.id === id)
  return music ? { lane: 'audio', item: music } : null
}

/** The film with `shift` added to the start of every item of `lane` that `pick` takes (never before the film's start). */
function shiftLane(film: Film, lane: 'texts' | 'media' | 'audio', shift: number, pick: (item: FilmText | FilmMedia | FilmAudio) => boolean): Film {
  const move = <T extends { startS: number }>(items: T[]) => items.map((i) => (pick(i as never) ? { ...i, startS: roundS(Math.max(0, i.startS + shift)) } : i))
  return lane === 'texts' ? { ...film, texts: move(film.texts) } : lane === 'media' ? { ...film, media: move(film.media) } : { ...film, audio: move(film.audio) }
}

/**
 * The blocks `ids` (texts, media, music) moved together by the shift `lead` would get from `dragFilm` (its start or end
 * caught by the magnet): the same number of seconds for each, none before the start of the film. The film itself when
 * nothing moves.
 */
export function dragBlocks(film: Film, ids: readonly string[], lead: string, deltaS: number, ctx: DragContext): Film {
  const leadAt = (f: Film) => timedItem(f, lead)?.item.startS
  const before = leadAt(film)
  const after = leadAt(dragFilm(film, lead, 'move', deltaS, ctx))
  if (before === undefined || after === undefined) return film
  const earliest = Math.min(...ids.flatMap((id) => timedItem(film, id)?.item.startS ?? []))
  const shift = Math.max(after - before, -earliest)
  if (!Number.isFinite(shift) || shift === 0) return film
  const group = new Set(ids)
  let next = film
  for (const lane of ['texts', 'media', 'audio'] as const) next = shiftLane(next, lane, shift, (item) => group.has(item.id))
  return next
}

/**
 * The film with the blocks `ids` removed and the gap each leaves closed: in its lane, what starts after it moves earlier
 * by its length (what is attached to a stop follows the stop, not this). Removing several in one lane closes each gap.
 */
export function rippleRemove(film: Film, ids: readonly string[]): Film {
  const gone = ids.flatMap((id) => timedItem(film, id) ?? []).sort((a, b) => b.item.startS - a.item.startS)
  let next = film
  for (const { lane, item } of gone) {
    const end = item.startS + item.durationS
    next = shiftLane(removeFilmItem(next, item.id), lane, -item.durationS, (other) => other.startS >= end - 1e-6 && !('stopId' in other && other.stopId))
  }
  return next
}

/**
 * `dragged`, the film after an edge of block `id` was dragged from `start`, with the blocks that came after it in its lane
 * moved by as much as its end moved (Shift: « décalage en chaîne »); `dragged` itself when its end did not move or `id` is
 * not a text, a medium or a music clip.
 */
export function rippleDrag(start: Film, dragged: Film, id: string): Film {
  const was = timedItem(start, id)
  const now = timedItem(dragged, id)
  if (!was || !now) return dragged
  const shift = now.item.startS + now.item.durationS - (was.item.startS + was.item.durationS)
  if (!shift) return dragged
  const end = was.item.startS + was.item.durationS
  const after = new Set(
    [...start.texts, ...start.media, ...start.audio].filter((i) => i.id !== id && i.startS >= end - 1e-6 && !('stopId' in i && i.stopId)).map((i) => i.id),
  )
  return shiftLane(dragged, was.lane, shift, (item) => after.has(item.id))
}

/** Blocks copied, to be pasted elsewhere. */
export interface BlockClip {
  texts: FilmText[]
  media: FilmMedia[]
  audio: FilmAudio[]
}

/** A copy of the blocks `ids` (texts, media, music), null when none of them is one. */
export function copyBlocks(film: Film, ids: readonly string[]): BlockClip | null {
  const group = new Set(ids)
  const clip: BlockClip = {
    texts: film.texts.filter((i) => group.has(i.id)).map((i) => ({ ...i })),
    media: film.media.filter((i) => group.has(i.id)).map((i) => ({ ...i })),
    audio: film.audio.filter((i) => group.has(i.id)).map((i) => ({ ...i })),
  }
  return clip.texts.length + clip.media.length + clip.audio.length > 0 ? clip : null
}

/**
 * The blocks of `clip` added to the film, the earliest one at film time `atS` and the others keeping their gaps, each with
 * its own id and attached to no stop. A medium whose file is no longer in the project (`hasMedia`) and a clip synced with the
 * track are left out. The film and the new ids, null when nothing could be pasted.
 */
export function pasteBlocks(film: Film, clip: BlockClip, atS: number, hasMedia: (src: string) => boolean = () => true): { film: Film; ids: string[] } | null {
  const texts = clip.texts
  const media = clip.media.filter((m) => hasMedia(m.src) && !m.sync)
  const audio = clip.audio.filter((a) => hasMedia(a.src))
  const all = [...texts, ...media, ...audio]
  if (all.length === 0) return null
  const origin = Math.min(...all.map((i) => i.startS))
  const at = (i: { startS: number }) => roundS(Math.max(0, atS) + i.startS - origin)
  let next = film
  const ids: string[] = []
  for (const text of texts) {
    const copy: FilmText = { ...text, id: nextFilmId(next, 'text'), startS: at(text) }
    delete copy.stopId
    next = { ...next, texts: [...next.texts, copy] }
    ids.push(copy.id)
  }
  for (const medium of media) {
    const copy: FilmMedia = { ...medium, id: nextFilmId(next, 'media'), startS: at(medium) }
    delete copy.stopId
    next = { ...next, media: [...next.media, copy] }
    ids.push(copy.id)
  }
  for (const music of audio) {
    const copy: FilmAudio = { ...music, id: nextFilmId(next, 'music'), startS: at(music) }
    next = { ...next, audio: [...next.audio, copy] }
    ids.push(copy.id)
  }
  return { film: next, ids }
}

/** The playhead stays at least this share of the view away from its edges while the film plays on a zoomed timeline. */
export const FOLLOW_MARGIN = 0.1
/** When it gets there, the timeline pages: the playhead goes back to this share of the view from its left edge. */
export const FOLLOW_PAGE_AT = 0.25

/**
 * Scroll position (pixels) that keeps the playhead, `x` pixels into the content, in view of a scroller `viewW` wide
 * and scrolled to `scrollLeft`: unchanged while it is inside the view without FOLLOW_MARGIN at each edge, else the page
 * that puts it FOLLOW_PAGE_AT of the way in (never past the content `contentW` wide, nor before its start).
 */
export function followScroll(x: number, scrollLeft: number, viewW: number, contentW: number): number {
  if (!(viewW > 0) || contentW <= viewW) return scrollLeft
  const margin = viewW * FOLLOW_MARGIN
  if (x >= scrollLeft + margin && x <= scrollLeft + viewW - margin) return scrollLeft
  return clamp(x - viewW * FOLLOW_PAGE_AT, 0, contentW - viewW)
}

/** The shortest piece `splitFilmItem` leaves on each side of the cut (seconds). */
export const SPLIT_MIN_S = 0.5

/**
 * A copy of text or medium `id` placed just after it (same length), with its own id and attached to no stop, and its id;
 * null for anything else, and for a clip synced with the track (`sync`: its place follows the recording).
 */
export function duplicateFilmItem(film: Film, id: string): { film: Film; id: string } | null {
  const text = film.texts.find((item) => item.id === id)
  if (text) {
    const copy: FilmText = { ...text, id: nextFilmId(film, 'text'), startS: roundS(text.startS + text.durationS) }
    delete copy.stopId
    return { film: { ...film, texts: [...film.texts, copy] }, id: copy.id }
  }
  const medium = film.media.find((item) => item.id === id)
  if (!medium || medium.sync) return null
  const copy: FilmMedia = { ...medium, id: nextFilmId(film, 'media'), startS: roundS(medium.startS + medium.durationS) }
  delete copy.stopId
  return { film: { ...film, media: [...film.media, copy] }, id: copy.id }
}

/**
 * Text or photo `id` cut in two at film time `atS`: the first piece ends there, the second (with a new id, its id
 * returned) starts there and ends where the item did. Null when `atS` is not inside it with SPLIT_MIN_S on each side,
 * and for a video or a music clip (their position in the file would need to follow).
 */
export function splitFilmItem(film: Film, id: string, atS: number): { film: Film; id: string } | null {
  const text = film.texts.find((item) => item.id === id)
  const medium = film.media.find((item) => item.id === id)
  const item = text ?? (medium?.kind === 'image' && !medium.sync ? medium : undefined)
  if (!item || !(atS - item.startS >= SPLIT_MIN_S) || !(item.startS + item.durationS - atS >= SPLIT_MIN_S)) return null
  const cut = roundS(atS)
  const firstS = roundS(cut - item.startS)
  const secondS = roundS(item.startS + item.durationS - cut)
  if (text) {
    const second: FilmText = { ...text, id: nextFilmId(film, 'text'), startS: cut, durationS: secondS }
    delete second.stopId
    return { film: { ...film, texts: [...film.texts.map((t) => (t.id === id ? { ...t, durationS: firstS } : t)), second] }, id: second.id }
  }
  const second: FilmMedia = { ...(medium as FilmMedia), id: nextFilmId(film, 'media'), startS: cut, durationS: secondS }
  delete second.stopId
  return { film: { ...film, media: [...film.media.map((m) => (m.id === id ? { ...m, durationS: firstS } : m)), second] }, id: second.id }
}

/** Length of a photo added on the timeline (seconds). */
export const NEW_MEDIA_S = 5
/** Longest a video is when added (seconds; its natural length below that, stretched or trimmed afterwards). */
export const NEW_VIDEO_MAX_S = 30

/**
 * Media added one after the other from film time `startS`, one per entry of the media table (`src`): a photo
 * `NEW_MEDIA_S` long, a video (`videoS`: its length in the file) its natural length up to `NEW_VIDEO_MAX_S`, without
 * Ken Burns, with its sound (`VIDEO_SOUND_DEFAULTS`); `MEDIA_DEFAULTS` placement otherwise. With their new ids.
 */
export function addMedia(film: Film, startS: number, sources: readonly { src: string; videoS?: number }[]): { film: Film; ids: string[] } {
  let next = film
  const ids: string[] = []
  let at = Math.max(0, startS)
  for (const { src, videoS } of sources) {
    const id = nextFilmId(next, 'media')
    const video = videoS !== undefined
    const durationS = video ? itemDuration(Math.min(videoS, NEW_VIDEO_MAX_S)) : NEW_MEDIA_S
    const media: FilmMedia = { id, startS: roundS(at), durationS, kind: video ? 'video' : 'image', src, ...MEDIA_DEFAULTS }
    if (video) Object.assign(media, { kenBurns: false, ...VIDEO_SOUND_DEFAULTS })
    next = { ...next, media: [...next.media, media] }
    ids.push(id)
    at += durationS
  }
  return { film: next, ids }
}

/**
 * Music clips added one after the other, the first at the end of the music already there (the start of the film
 * without any), one per sound file of the media table (`src`, `fileS`: its length): the whole file,
 * `AUDIO_DEFAULTS` volume and fades. With their new ids.
 */
export function addMusic(film: Film, sources: readonly { src: string; fileS: number }[]): { film: Film; ids: string[] } {
  let next = film
  const ids: string[] = []
  let at = film.audio.reduce((end, a) => Math.max(end, a.startS + a.durationS), 0)
  for (const { src, fileS } of sources) {
    const id = nextFilmId(next, 'music')
    const durationS = roundS(clamp(fileS, AUDIO_DURATION_RANGE.min, AUDIO_DURATION_RANGE.max))
    next = { ...next, audio: [...next.audio, { id, src, startS: roundS(at), durationS, inS: 0, ...AUDIO_DEFAULTS }] }
    ids.push(id)
    at += durationS
  }
  return { film: next, ids }
}

/** Farthest a geotagged photo may be from the track to be placed on it (metres). */
export const PHOTO_MAX_OFF_M = 2000
/** Capture instants this long before the start or after the end of the recording place a photo at that end. */
export const PHOTO_TIME_TOLERANCE_MS = 15 * 60_000

/**
 * Film time at which the marker reaches the point of the track where a photo was taken (`place`: EXIF position
 * and / or capture instant): the nearest point of the track, within `PHOTO_MAX_OFF_M` (on an out-and-back, the
 * pass recorded closest to the instant), else the point recorded at that instant (timed track). Undefined when
 * neither matches.
 */
export function photoFilmTime(path: TrackPath, clock: FilmClock, place: { lon?: number; lat?: number; timeMs?: number }): number | undefined {
  if (path.lengthM <= 0) return undefined
  let atM: number | undefined
  if (place.lon !== undefined && place.lat !== undefined) {
    const nearest = nearestOnPath(path, { lon: place.lon, lat: place.lat }, place.timeMs)
    if (nearest && nearest.offM <= PHOTO_MAX_OFF_M) atM = nearest.distanceM
  }
  if (atM === undefined && place.timeMs !== undefined) atM = distanceAtTime(path, place.timeMs, PHOTO_TIME_TOLERANCE_MS)
  return atM === undefined ? undefined : roundS(clock.timeAtProgress(atM / path.lengthM))
}

/** Recorded instants of the first and last timed points of the track (ms), undefined without time. */
function recordedRange(path: TrackPath): { from: number; to: number } | undefined {
  let from = Number.NaN
  let to = Number.NaN
  for (let i = 0; i < path.count; i++) {
    const t = path.time[i]
    if (Number.isNaN(t)) continue
    if (Number.isNaN(from)) from = t
    to = t
  }
  return Number.isNaN(from) ? undefined : { from, to }
}

/** Recorded instant under the marker at film time `timeS` (ms since epoch), undefined for an untimed track. */
export function recordedAtFilmTime(path: TrackPath, clock: Pick<FilmClock, 'progressAtTime'>, timeS: number): number | undefined {
  if (path.count === 0) return undefined
  return recordedTimeAt(path, Math.min(1, Math.max(0, clock.progressAtTime(timeS))) * path.lengthM)
}

/** Most hours tried when a clip does not fall within the outing (camera clock set to local time, written as UTC). */
export const SYNC_MAX_HOURS = 14

/**
 * Clock correction (seconds) under which a clip recorded from `startMs`, `fileS` long, overlaps the recorded outing:
 * 0 when it does as it is, else the whole number of hours nearest to 0 that makes it overlap (a camera set to local
 * time writes it as if it were UTC), undefined when none does or the track has no time.
 */
export function clipSyncOffsetS(path: TrackPath, startMs: number, fileS: number): number | undefined {
  const range = recordedRange(path)
  if (!range) return undefined
  const overlaps = (offsetS: number) => startMs + offsetS * 1000 < range.to && startMs + (offsetS + fileS) * 1000 > range.from
  for (let h = 0; h <= SYNC_MAX_HOURS; h++) {
    for (const offsetS of h === 0 ? [0] : [-h * 3600, h * 3600]) if (overlaps(offsetS)) return offsetS
  }
  return undefined
}

/**
 * Place on the timeline of a synced clip (`media.sync`, `fileS`: its length): it starts when the marker passes the
 * point recorded at its start (at the start of the flight for a clip started before the outing, `inS` skipping the
 * part filmed before); following the flight, it lasts until the marker passes the point recorded at its end (or the
 * end of the outing), else its length in the file from there, at most its current duration. Undefined when the
 * clip does not overlap the outing or the track has no time.
 */
export function syncClipPlacement(
  media: FilmMedia,
  path: TrackPath,
  clock: Pick<FilmClock, 'timeAtProgress'>,
  fileS: number,
): Pick<FilmMedia, 'startS' | 'durationS' | 'inS'> | undefined {
  const range = recordedRange(path)
  if (!media.sync || !range || path.lengthM <= 0) return undefined
  const startMs = media.sync.startMs + media.sync.offsetS * 1000
  const endMs = startMs + fileS * 1000
  if (startMs >= range.to || endMs <= range.from) return undefined
  const filmTimeAt = (ms: number) => clock.timeAtProgress((distanceAtTime(path, ms) ?? 0) / path.lengthM)
  const inS = Math.max(0, (range.from - startMs) / 1000)
  const startS = filmTimeAt(Math.max(startMs, range.from))
  const durationS = media.sync.follow ? filmTimeAt(Math.min(endMs, range.to)) - startS : Math.min(media.durationS, fileS - inS)
  return { startS: roundS(startS), durationS: itemDuration(durationS), inS: roundS(inS) }
}

/**
 * `film` with clip `id` synced (`sync`) and placed by `syncClipPlacement`; undefined when it does not overlap the
 * outing (or is not in the film).
 */
export function syncClip(film: Film, id: string, sync: MediaSync, path: TrackPath, clock: Pick<FilmClock, 'timeAtProgress'>, fileS: number): Film | undefined {
  const media = film.media.find((m) => m.id === id)
  const place = media && syncClipPlacement({ ...media, sync }, path, clock, fileS)
  return place && updateMedia(film, id, { sync, ...place })
}

/** Film time over which the preview measures how fast a clip following the flight plays (seconds). */
export const FOLLOW_RATE_STEP_S = 0.25

/**
 * Seconds of the file played per second of film at film time `timeS`: 1 for a clip that does not follow the flight;
 * following it, how fast the recorded time passes under the marker (0 during a stop: the frame holds).
 */
export function clipRateAt(media: FilmMedia, path: TrackPath, clock: Pick<FilmClock, 'progressAtTime'>, timeS: number): number {
  if (!media.sync?.follow) return 1
  const a = recordedAtFilmTime(path, clock, timeS)
  const b = recordedAtFilmTime(path, clock, timeS + FOLLOW_RATE_STEP_S)
  if (a === undefined || b === undefined) return 1
  return Math.max(0, (clipTimeS(media, timeS + FOLLOW_RATE_STEP_S, b) - clipTimeS(media, timeS, a)) / FOLLOW_RATE_STEP_S)
}

/** `film` without the stop, speed portion, camera, parameter or marker key, text, medium or music clip `id`; a shot cannot be removed: it goes to style 'aucune'. */
export function removeFilmItem(film: Film, id: TimelineItem): Film {
  if (id === 'opening' || id === 'closing') return updateShot(film, id, { style: 'aucune' })
  // a junction goes back to the default one, a stage card is switched off (its settings are kept)
  if (isJunctionItem(id)) return resetJunction(film, junctionTrackOf(id))
  if (isStageCardItem(id)) return withJunctionCard(film, stageCardAfterOf(id), { enabled: false })
  // the cards of the days go together: deleting one block switches them off (their settings are kept)
  if (isDayCardItem(id)) return { ...film, dayCards: { ...(film.dayCards ?? DEFAULT_DAY_CARDS), enabled: false } }
  // a stage goes back to its share of the flyover duration
  if (isStageItem(id)) return withStageDuration(film, stageTrackOf(id), null)
  return {
    ...film,
    stops: film.stops.filter((s) => s.id !== id),
    speeds: film.speeds.filter((s) => s.id !== id),
    cameraKeys: film.cameraKeys.filter((k) => k.id !== id),
    paramKeys: film.paramKeys.filter((k) => k.id !== id),
    markerKeys: film.markerKeys.filter((k) => k.id !== id),
    texts: film.texts.filter((t) => t.id !== id),
    media: film.media.filter((m) => m.id !== id),
    audio: film.audio.filter((a) => a.id !== id),
  }
}

/**
 * `item` is in the film: a shot (always there), one of the clock's `stops` (generated ones included), a speed portion,
 * a camera, parameter or marker key, a text, a medium or a music clip.
 */
export function hasFilmItem(film: Film, stops: readonly { id: string }[], item: TimelineItem, stageIds: readonly string[] = []): boolean {
  if (item === 'opening' || item === 'closing') return true
  if (hasStageItem(item, stageIds)) return true
  if (isDayCardItem(item)) return film.dayCards?.enabled === true
  return [stops, film.speeds, film.cameraKeys, film.paramKeys, film.markerKeys, film.texts, film.media, film.audio].some((lane) => lane.some((s) => s.id === item))
}

/** Stop `id` with `patch`, duration clamped to its range. */
export function updateStop(film: Film, id: string, patch: Partial<Omit<FilmStop, 'id'>>): Film {
  return {
    ...film,
    stops: film.stops.map((s) => {
      if (s.id !== id) return s
      const next = { ...s, ...patch }
      return { ...next, durationS: stopDuration(next.durationS), atM: Math.max(0, next.atM) }
    }),
  }
}

/** Speed factor clamped to its range, kept at 1/100. */
export const speedFactor = (f: number) => Math.round(clamp(f, SPEED_FACTOR_RANGE.min, SPEED_FACTOR_RANGE.max) * 100) / 100

/** 2 -> "×2", 0.25 -> "×0,25". */
export const formatSpeedFactor = (f: number) => `×${formatNumberIntl(Math.round(f * 100) / 100, 2, 0)}`

/**
 * Speed portion `id` with `patch`: factor clamped to its range, edges rounded to the metre and kept on the track,
 * off the neighbouring portions and at least `MIN_SPEED_SPAN_M` apart (the edge not in `patch` gives way first).
 */
export function updateSpeed(film: Film, id: string, patch: Partial<Omit<FilmSpeed, 'id'>>, lengthM: number): Film {
  const own = film.speeds.find((s) => s.id === id)
  if (!own) return film
  const { lo, hi } = speedRoom(film.speeds, own, lengthM)
  const minSpan = Math.min(MIN_SPEED_SPAN_M, hi - lo)
  let fromM = Math.round(clamp(patch.fromM ?? own.fromM, lo, hi - minSpan))
  let toM = Math.round(clamp(patch.toM ?? own.toM, lo + minSpan, hi))
  if (toM - fromM < minSpan) {
    if (patch.toM === undefined) toM = Math.min(hi, fromM + minSpan)
    else fromM = Math.max(lo, toM - minSpan)
  }
  const next = { ...own, ...patch, fromM, toM, factor: speedFactor(patch.factor ?? own.factor) }
  return { ...film, speeds: film.speeds.map((s) => (s.id === id ? next : s)) }
}

/**
 * Keyframe `id` with `patch`: distance and pitch clamped to the keyframe ranges, heading brought into -180°..180°. Not
 * rounded: the key keeps the exact view it was taken from.
 */
export function updateCameraKey(film: Film, id: string, patch: Partial<Omit<FilmCameraKey, 'id'>>): Film {
  const { distance, pitchDeg } = CAMERA_KEY_RANGES
  const heading = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180
  return {
    ...film,
    cameraKeys: film.cameraKeys.map((k) => {
      if (k.id !== id) return k
      const next = { ...k, ...patch }
      return {
        ...next,
        atM: Math.max(0, next.atM),
        distance: clamp(next.distance, distance.min, distance.max),
        pitchDeg: clamp(next.pitchDeg, pitchDeg.min, pitchDeg.max),
        headingOffsetDeg: heading(next.headingOffsetDeg),
      }
    }),
  }
}

/** Text `id` with `patch`, start and duration clamped to their ranges. */
export function updateText(film: Film, id: string, patch: Partial<Omit<FilmText, 'id'>>): Film {
  return {
    ...film,
    texts: film.texts.map((t) => {
      if (t.id !== id) return t
      const next = { ...t, ...patch }
      return { ...next, startS: roundS(Math.max(0, next.startS)), durationS: itemDuration(next.durationS) }
    }),
  }
}

/** Medium `id` with `patch`, start, duration and start in the file (video) clamped to their ranges. */
export function updateMedia(film: Film, id: string, patch: Partial<Omit<FilmMedia, 'id'>>): Film {
  return {
    ...film,
    media: film.media.map((m) => {
      if (m.id !== id) return m
      const next = { ...m, ...patch }
      const inS = next.inS === undefined ? {} : { inS: roundS(Math.max(0, next.inS)) }
      return { ...next, startS: roundS(Math.max(0, next.startS)), durationS: itemDuration(next.durationS), ...inS }
    }),
  }
}

/**
 * Music clip `id` with `patch`: start in the file within it (`fileS`: its length, when known), duration never past
 * its end, volume 0–1 at 1/100, fades within their range.
 */
export function updateMusic(film: Film, id: string, patch: Partial<Omit<FilmAudio, 'id'>>, fileS?: number): Film {
  return {
    ...film,
    audio: film.audio.map((a) => {
      if (a.id !== id) return a
      const next = { ...a, ...patch }
      const inS = roundS(clamp(next.inS, 0, fileS === undefined ? Infinity : Math.max(0, fileS - AUDIO_DURATION_RANGE.min)))
      return {
        ...next,
        startS: roundS(Math.max(0, next.startS)),
        inS,
        durationS: roundS(clamp(next.durationS, AUDIO_DURATION_RANGE.min, musicMaxS(inS, fileS))),
        volume: Math.round(clamp(next.volume, 0, 1) * 100) / 100,
        fadeInS: roundS(clamp(next.fadeInS, FADE_RANGE.min, FADE_RANGE.max)),
        fadeOutS: roundS(clamp(next.fadeOutS, FADE_RANGE.min, FADE_RANGE.max)),
      }
    }),
  }
}

/**
 * Shot `key` with `patch`, duration clamped to its range; a field patched to undefined is removed (back to its
 * default). Switched to 'situation' with its default duration still, the shot gets `SITUATION_DURATION_S`: the dive
 * from the region is long.
 */
export function updateShot(film: Film, key: 'opening' | 'closing', patch: Partial<FilmShot>): Film {
  const before = film[key]
  const longer =
    patch.style === 'situation' && before.style !== 'situation' && patch.durationS === undefined && before.durationS === DEFAULT_FILM[key].durationS
  const shot: Record<string, unknown> = { ...before, ...patch, ...(longer && { durationS: SITUATION_DURATION_S }) }
  for (const field of Object.keys(shot)) if (shot[field] === undefined) delete shot[field]
  const merged = shot as unknown as FilmShot
  return { ...film, [key]: { ...merged, durationS: shotDuration(merged.durationS) } }
}

/** The place highlighted by the 'situation' shots (« Lieu »; null: automatic), the same for the opening and the closing. */
export function setFilmPlace(film: Film, regionId: string | null): Film {
  const patch = { regionId: regionId ?? undefined }
  return updateShot(updateShot(film, 'opening', patch), 'closing', patch)
}

// ---------------------------------------------------------------------------
// Texts and media attached to a stop
// ---------------------------------------------------------------------------

type Attachable = FilmText | FilmMedia

function detach<T extends Attachable>(item: T): T {
  const { stopId: _, ...free } = item
  return free as T
}

/**
 * Text or medium `id` attached to `stop` (a stop of the clock of `film`, its own stops written out), or free again
 * (null). Attached, a text or a video moves to the start of the hold of the stop and a photo is fitted to the hold
 * (shown while the marker holds); freed, it stays where it is.
 */
export function attachToStop(film: Film, id: string, stop: ClockStop | null): Film {
  const attach = <T extends Attachable>(item: T, fit: boolean): T => {
    if (item.id !== id) return item
    if (!stop) return detach(item)
    const startS = roundS(stop.holdStartS)
    return { ...item, stopId: stop.id, startS, durationS: fit ? itemDuration(stop.holdEndS - stop.holdStartS) : item.durationS }
  }
  return { ...film, texts: film.texts.map((t) => attach(t, false)), media: film.media.map((m) => attach(m, m.kind === 'image')) }
}

/** Two film times equal at the rounding of the stored values. */
const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.015

/** The keys on the speed of a film (the other parameter keys do not move the film in time). */
const speedKeysOf = (film: Pick<Film, 'paramKeys'>) => film.paramKeys.filter((k) => k.param === 'speed')
const sameKeys = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((k, i) => k === b[i])

/**
 * Film time, in the film of clock `to`, of what appeared at `t` in the film of clock `from`, keeping its place on the
 * route: in the opening it keeps its time from the start of the film, in the closing its time from the end of the
 * flight; in a stop or a junction hold (the same one, found by its id) its offset to the start of the hold; elsewhere
 * it is where the marker reaches the position it had.
 */
function routeTime(t: number, from: FilmClock, to: FilmClock): number {
  const flightEnd = from.openingS + from.flightS
  if (t < from.openingS) return t
  if (t >= flightEnd) return to.openingS + to.flightS + (t - flightEnd)
  const hold = [...from.stops, ...from.junctions].find((p) => t >= p.holdStartS && t < p.holdEndS)
  const same = hold && [...to.stops, ...to.junctions].find((p) => p.id === hold.id)
  if (hold && same) return same.holdStartS + (t - hold.holdStartS)
  return to.timeAtProgress(from.progressAtTime(t))
}

/**
 * `after` (an edit of `before`) with its attached texts and media following their stop: an item the edit did not
 * move or stretch itself keeps its offset to the start of the stop's hold (an item fitted to the hold stays fitted,
 * stretched with it); an item whose stop is not among the film's own stops any more (removed, automatic stops back)
 * becomes free where it is. A free text or medium the edit did not touch keeps its place on the route (`routeTime`):
 * slowing down or speeding up a portion, adding a stop, lengthening a shot or changing the duration moves it with the
 * place it illustrated, its own duration unchanged; the music is not tied to a place and keeps its film seconds, and
 * so do all of them when the order of the stages changes. `clockOf` gives the clock of a film (same track and
 * pacing); `clockBefore` the clock of `before` when the change also moves what the clock is made from (flyover
 * duration, pacing). `after` itself when nothing changes.
 */
export function followStops(
  before: Film,
  after: Film,
  clockOf: (film: Film) => FilmClock,
  clockBefore: (film: Film) => FilmClock = clockOf,
): Film {
  if (after.texts.length === 0 && after.media.length === 0) return after
  const own = new Set(after.autoStops ? [] : after.stops.map((s) => s.id))
  // only the stops, the speed portions, the shots and the clock (duration, pacing) move a stop in film time
  const moves =
    clockBefore !== clockOf ||
    before.stops !== after.stops ||
    before.speeds !== after.speeds ||
    before.opening !== after.opening ||
    before.closing !== after.closing ||
    before.autoStops !== after.autoStops ||
    before.junctions !== after.junctions ||
    before.junctionDefault !== after.junctionDefault ||
    before.stageDurations !== after.stageDurations ||
    !sameKeys(speedKeysOf(before), speedKeysOf(after))
  let clocks: { from: FilmClock; to: FilmClock } | undefined
  let changed = false
  const follow = <T extends Attachable>(item: T, previous: readonly T[]): T => {
    const { stopId } = item
    if (stopId !== undefined && !own.has(stopId)) {
      changed = true
      return detach(item)
    }
    const old = previous.find((p) => p.id === item.id)
    if (!moves || !old || old.startS !== item.startS || old.durationS !== item.durationS) return item
    clocks ??= { from: clockBefore(before), to: clockOf(after) }
    if (stopId === undefined) {
      // free: it keeps its place on the route, unless the stages were put in another order (then its film seconds)
      const { from: was, to: now } = clocks
      if (was.cuts.length !== now.cuts.length || was.cuts.some((c, k) => c.atM !== now.cuts[k].atM)) return item
      const startS = roundS(Math.max(0, routeTime(item.startS, was, now)))
      if (startS === item.startS) return item
      changed = true
      return { ...item, startS }
    }
    const from = clocks.from.stops.find((s) => s.id === stopId)
    const to = clocks.to.stops.find((s) => s.id === item.stopId)
    if (!from || !to) return item
    const fitted = sameTime(item.startS, from.holdStartS) && sameTime(item.startS + item.durationS, from.holdEndS)
    const startS = roundS(Math.max(0, fitted ? to.holdStartS : item.startS + to.holdStartS - from.holdStartS))
    const durationS = fitted ? itemDuration(to.holdEndS - to.holdStartS) : item.durationS
    if (startS === item.startS && durationS === item.durationS) return item
    changed = true
    return { ...item, startS, durationS }
  }
  const texts = after.texts.map((t) => follow(t, before.texts))
  const media = after.media.map((m) => follow(m, before.media))
  return changed ? { ...after, texts, media } : after
}
