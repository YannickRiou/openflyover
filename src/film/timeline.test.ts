import { describe, expect, it } from 'vitest'
import { buildTrackPath } from '../flyover/path'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import { buildFilmClock } from './clock'
import type { FilmClockInput } from './clock'
import { AUDIO_DEFAULTS, AUTO_STOP_S, DEFAULT_FILM, MEDIA_DEFAULTS, MIN_SPEED_SPAN_M, SITUATION_DURATION_S, VIDEO_SOUND_DEFAULTS, clipTimeS, isValidFilm } from './model'
import type { Film, FilmAudio, FilmMedia, FilmSpeed, FilmStop, FilmText } from './model'
import {
  copyBlocks,
  dragBlocks,
  duplicateFilmItem,
  followScroll,
  formatFrameTimecode,
  pasteBlocks,
  rippleDrag,
  rippleRemove,
  snapGroupOf,
  snapTargetsOn,
  splitFilmItem,
  timedBlockIds,
  zoomToSpan,
  NEW_MEDIA_S,
  NEW_VIDEO_MAX_S,
  addCameraKey,
  addItemCamera,
  addMarkerKey,
  addParamKey,
  addMedia,
  addMusic,
  addSpeed,
  addStop,
  addText,
  adjacentKey,
  keyAt,
  keyState,
  attachToStop,
  centredScrollLeft,
  centredTime,
  clipRateAt,
  clipSyncOffsetS,
  dragFilm,
  dragKeys,
  edgeScrollSpeed,
  fitPxPerS,
  followStops,
  formatFilmTime,
  formatTimecode,
  formatSpeedFactor,
  hasFilmItem,
  photoFilmTime,
  pressedGrip,
  recordedAtFilmTime,
  removeFilmItem,
  rollClosing,
  rulerStep,
  rulerTicks,
  snapTargets,
  snapTime,
  snapValue,
  snapper,
  stopPositionAt,
  syncClip,
  syncClipPlacement,
  TICK_LABEL_PX,
  tickLabelFlips,
  timelineContentWidth,
  updateCameraKey,
  setFilmPlace,
  updateShot,
  updateSpeed,
  updateStop,
  updateMedia,
  updateMusic,
  updateText,
  zoomAt,
} from './timeline'
import type { DragContext, SnapTarget } from './timeline'

const L = 10_000
const D = 60
/** targets at these times */
const at = (...times: number[]): SnapTarget[] => times.map((timeS) => ({ timeS, label: `t${timeS}`, kind: 'edge' }))
const stop = (id: string, atM: number, durationS = 4): FilmStop => ({ id, atM, durationS, camera: 'orbite' })
const text = (id: string, startS: number, durationS = 4): FilmText => ({ id, startS, durationS, text: id, anchor: 'center', size: 1 })
const photo = (id: string, startS: number, durationS = 5): FilmMedia => ({ id, startS, durationS, kind: 'image', src: 'photo-1', ...MEDIA_DEFAULTS })
const film: Film = {
  ...DEFAULT_FILM,
  autoStops: false,
  stops: [stop('stop-1', 2000), stop('stop-2', 7000, 2)],
  texts: [text('text-1', 10), text('text-2', 30, 2)],
  media: [photo('media-1', 40)],
}

function contextOf(f: Film, patch: Partial<DragContext> = {}, pacing = { ...DEFAULT_PACING, keepDuration: false }): DragContext {
  const input: FilmClockInput = {
    opening: f.opening,
    closing: f.closing,
    stops: f.stops,
    cameraKeys: f.cameraKeys,
    lengthM: L,
    durationS: D,
    pacing,
  }
  const clockOf = (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops })
  return { clock: clockOf(f.stops), clockOf, lengthM: L, targets: [], targetsM: [], snapS: 0, ...patch }
}

describe('timeline scale', () => {
  it('fits the film, zooms around the pointer', () => {
    expect(fitPxPerS(900, 90)).toBe(10)
    expect(fitPxPerS(0, 90)).toBe(1)
    // time under the pointer (200 px from the left, scrolled by 100 px) stays under it
    const before = (100 + 200) / (10 * 2)
    const { zoom, scrollLeft } = zoomAt(2, 1.5, 200, 100)
    expect(zoom).toBe(3)
    expect((scrollLeft + 200) / (10 * zoom)).toBeCloseTo(before, 12)
    expect(zoomAt(1, 0.5, 200, 0)).toEqual({ zoom: 1, scrollLeft: 0 })
    expect(zoomAt(40, 10, 0, 0).zoom).toBe(50)
  })

  it('centred playhead: the scroll is the film time, a zoom keeps the playhead in the middle', () => {
    expect(centredScrollLeft(12, 20)).toBe(240)
    expect(centredTime(240, 20, 90)).toBe(12)
    expect(centredScrollLeft(-1, 20)).toBe(0)
    // overscroll and an empty scale stay within the film
    expect(centredTime(5000, 20, 90)).toBe(90)
    expect(centredTime(-30, 20, 90)).toBe(0)
    expect(centredTime(100, 0, 90)).toBe(0)
    // a pinch doubles the scale: same time, twice the scroll
    const pxPerS = fitPxPerS(370, 74) * 4
    const zoomed = fitPxPerS(370, 74) * zoomAt(4, 2, 0, 0).zoom
    expect(centredTime(centredScrollLeft(31.3, zoomed), zoomed, 74)).toBeCloseTo(31.3, 12)
    expect(centredScrollLeft(31.3, zoomed)).toBeCloseTo(2 * centredScrollLeft(31.3, pxPerS), 9)
  })

  it('scrolls by itself near an edge, faster closer to it', () => {
    // timeline from x = 100 to 1100, 48 px edges
    expect(edgeScrollSpeed(600, 100, 1100)).toBe(0)
    expect(edgeScrollSpeed(148, 100, 1100)).toBe(0)
    expect(edgeScrollSpeed(124, 100, 1100)).toBe(-450)
    expect(edgeScrollSpeed(100, 100, 1100)).toBe(-900)
    expect(edgeScrollSpeed(40, 100, 1100)).toBe(-900)
    expect(edgeScrollSpeed(1076, 100, 1100)).toBe(450)
    expect(edgeScrollSpeed(1300, 100, 1100)).toBe(900)
    expect(edgeScrollSpeed(1064, 100, 1100, 48, 300)).toBe(75)
    expect(edgeScrollSpeed(600, 600, 600)).toBe(0)
  })

  it('ruler: the first step wide enough for a label', () => {
    expect(rulerStep(10)).toBe(10)
    expect(rulerStep(100)).toBe(1)
    expect(rulerStep(1)).toBe(120)
    expect(rulerTicks(25, 10)).toEqual([0, 10, 20])
  })

  it('ends the content at the end of the film: a film that fits the view never scrolls', () => {
    for (const [viewW, totalS] of [[1000, 30], [973, 7], [1280, 600], [640, 31.3]]) {
      const pad = 10
      const fit = fitPxPerS(viewW - 2 * pad, totalS)
      expect(timelineContentWidth(viewW, totalS, fit, pad)).toBe(viewW)
    }
    // zoomed: the film and its two margins, rounded up; never narrower than the view
    expect(timelineContentWidth(1000, 30, 100, 10)).toBe(3020)
    expect(timelineContentWidth(1000, 30.004, 100, 10)).toBe(3021)
    expect(timelineContentWidth(1000, 5, 1, 10)).toBe(1000)
  })

  it('draws the label of a tick next to the end of the content on its left', () => {
    expect(tickLabelFlips(990, 1000)).toBe(true) // the 0:30 at the end of a 30 s film
    expect(tickLabelFlips(500, 1000)).toBe(false)
    expect(tickLabelFlips(10, 20)).toBe(false) // never off the left edge
  })

  it('keeps the flipped last label of a 10 min film clear of the previous one', () => {
    const pxPerS = fitPxPerS(1000 - 20, 600)
    const ticks = rulerTicks(600, pxPerS)
    const last = ticks[ticks.length - 1]
    const x = (t: number) => 10 + t * pxPerS
    expect(last).toBe(600)
    expect(tickLabelFlips(x(last), timelineContentWidth(1000, 600, pxPerS, 10))).toBe(true)
    // flipped label: [x - 36, x]; previous label: from its line + 3 px, 36 px wide
    expect(x(ticks[ticks.length - 2]) + 3 + TICK_LABEL_PX).toBeLessThanOrEqual(x(last) - TICK_LABEL_PX)
  })

  it('formats film times as m:ss, tenths on demand', () => {
    expect(formatFilmTime(0)).toBe('0:00')
    expect(formatFilmTime(75.9)).toBe('1:15')
    expect(formatFilmTime(75.44, true)).toBe('1:15,4')
    expect(formatFilmTime(59.96, true)).toBe('1:00,0')
    expect(formatFilmTime(-3)).toBe('0:00')
    expect(formatFilmTime(3600)).toBe('60:00')
  })

  it('formats the timecode of the bar on a fixed width', () => {
    expect(formatTimecode(75.44, true)).toBe('01:15,4')
    expect(formatTimecode(0)).toBe('00:00')
    expect(formatTimecode(605.2, true)).toBe('10:05,2')
  })
})

describe('snapping', () => {
  it('nearest target within the distance', () => {
    expect(snapTime(10.2, at(5, 10, 10.5), 0.4).timeS).toBe(10)
    expect(snapTime(10.2, at(5, 10.5), 0.4).timeS).toBe(10.5)
    expect(snapTime(10.2, at(5, 11), 0.4)).toEqual({ timeS: 10.2, hits: [] })
    expect(snapTime(10.2, at(10), 0).timeS).toBe(10.2)
    expect(snapValue(10.2, [5, 10, 10.5], 0.4)).toBe(10)
  })

  it('every target at the time it lands on is a hit', () => {
    const targets: SnapTarget[] = [
      { timeS: 10, label: 'Fin : A', kind: 'edge' },
      { timeS: 10.0004, label: 'Début : B', kind: 'edge' },
      { timeS: 10.5, label: 'Tête de lecture', kind: 'playhead' },
    ]
    const { timeS, hits } = snapTime(9.9, targets, 0.4)
    expect(timeS).toBe(10)
    expect(hits.map((h) => h.label)).toEqual(['Fin : A', 'Début : B'])
  })

  it('hysteresis: a caught target is held until the release distance, a new one needs the pull distance', () => {
    const targets = at(10, 20)
    const first = snapTime(10.2, targets, 0.3)
    // 0.5 away: beyond the pull, within the release
    expect(snapTime(10.5, targets, 0.3).timeS).toBe(10.5)
    expect(snapTime(10.5, targets, 0.3, first.hits, 0.6).timeS).toBe(10)
    expect(snapTime(10.7, targets, 0.3, first.hits, 0.6).timeS).toBe(10.7)
  })

  it('a gesture records what it caught (alignment guides) and remembers it', () => {
    const state = { held: [] as SnapTarget[], hits: [] as SnapTarget[] }
    const snap = snapper({ targets: at(10), snapS: 0.3, releaseS: 0.6, snapState: state })
    expect(snap(10.2)).toBe(10)
    expect(state.hits.map((h) => h.timeS)).toEqual([10])
    state.held = state.hits
    state.hits = []
    expect(snap(10.5)).toBe(10)
    state.held = []
    expect(snap(10.5)).toBe(10.5)
  })

  it('targets: film ends, shot edges, other blocks, highlights, playhead', () => {
    const { clock } = contextOf(film)
    const targets = snapTargets(clock, film, [0.5], 12.3, 'text-1')
    const total = clock.totalTime()
    const times = targets.map((t) => t.timeS)
    expect(times).toEqual(expect.arrayContaining([0, total, 6, total - 5, 12.3, 30, 32, clock.stops[0].startS, clock.timeAtProgress(0.5)]))
    expect(times).not.toContain(10)
    expect(snapTargets(clock, film, [], 0, 'stop-1').map((t) => t.timeS)).not.toContain(clock.stops[0].startS)
  })

  it('targets are named, centres and ruler ticks included', () => {
    const { clock } = contextOf(film)
    const targets = snapTargets(clock, film, [], 12.3, 'text-1', { ticks: [20], blocks: [{ id: 'card-title', startS: 0, endS: 8, label: 'Titre' }] })
    const stopA = clock.stops[0]
    expect(targets).toContainEqual({ timeS: stopA.startS, label: 'Début : Arrêt', kind: 'edge' })
    expect(targets).toContainEqual({ timeS: (stopA.startS + stopA.endS) / 2, label: 'Milieu : Arrêt', kind: 'centre' })
    expect(targets).toContainEqual({ timeS: 12.3, label: 'Tête de lecture', kind: 'playhead' })
    expect(targets).toContainEqual({ timeS: 20, label: '0:20', kind: 'ruler' })
    expect(targets).toContainEqual({ timeS: 4, label: 'Milieu : Titre', kind: 'centre' })
    // the dragged item is left out, centre included
    expect(targets.some((t) => t.label.endsWith('text-1'))).toBe(false)
    expect(targets.some((t) => t.timeS === 12)).toBe(false)
  })

  it('targets: the cuts between the stages of « À la suite »', () => {
    const { clock } = contextOf(film)
    const withCuts = buildFilmClock({
      opening: film.opening,
      closing: film.closing,
      stops: [],
      cameraKeys: [],
      lengthM: L,
      durationS: D,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
      cutsM: [4000],
    })
    expect(withCuts.cuts).toHaveLength(1)
    expect(snapTargets(withCuts, film, [], 0)).toContainEqual({ timeS: withCuts.cuts[0].timeS, label: 'Transition 1', kind: 'junction' })
    expect(clock.cuts).toEqual([])
  })
})

describe('placing a stop in time', () => {
  for (const keepDuration of [false, true]) {
    it(`the hold starts at the requested time (keepDuration ${keepDuration})`, () => {
      const ctx = contextOf(film, {}, { ...DEFAULT_PACING, keepDuration })
      for (const target of [9, 20, 40]) {
        const atM = stopPositionAt(ctx.clockOf, film.stops, 'stop-1', target, L)
        const moved = ctx.clockOf(film.stops.map((s) => (s.id === 'stop-1' ? { ...s, atM } : s)))
        expect(moved.stops.find((s) => s.id === 'stop-1')!.holdStartS).toBeCloseTo(target, 3)
      }
      expect(stopPositionAt(ctx.clockOf, film.stops, 'stop-1', -5, L)).toBe(0)
      expect(stopPositionAt(ctx.clockOf, film.stops, 'stop-1', 1e6, L)).toBe(L)
    })
  }
})

describe('dragFilm', () => {
  it('closing start: a roll edit, the end of the film stays and the flight takes the difference', () => {
    const ctx = contextOf(film)
    // the start of the closing dragged 2 s later: 2 s shorter closing, 2 s longer flight, same end
    const later = rollClosing(film, dragFilm(film, 'closing', 'start', 2, ctx), D)
    expect(later.film.closing.durationS).toBe(film.closing.durationS - 2)
    expect(later.flightS).toBe(D + 2)
    expect(later.flightS + later.film.closing.durationS).toBe(D + film.closing.durationS)
    // earlier: a longer closing, a shorter flight, down to the shortest flight
    expect(rollClosing(film, dragFilm(film, 'closing', 'start', -1.5, ctx), D)).toMatchObject({ flightS: D - 1.5 })
    const capped = rollClosing(film, dragFilm(film, 'closing', 'start', -20, ctx), 16)
    expect(capped).toMatchObject({ flightS: 15, film: { closing: { durationS: film.closing.durationS + 1 } } })
  })

  it('opening end and closing start, clamped, snapped; « aucune » stays', () => {
    const ctx = contextOf(film)
    expect(dragFilm(film, 'opening', 'end', 2, ctx).opening.durationS).toBe(8)
    expect(dragFilm(film, 'opening', 'end', 100, ctx).opening.durationS).toBe(30)
    expect(dragFilm(film, 'closing', 'start', -1.5, ctx).closing.durationS).toBe(6.5)
    expect(dragFilm(film, 'closing', 'start', 10, ctx).closing.durationS).toBe(0.5)
    expect(dragFilm(film, 'opening', 'end', 1.8, { ...ctx, targets: at(8), snapS: 0.5 }).opening.durationS).toBe(8)
    const none = { ...film, opening: { style: 'aucune' as const, durationS: 6 } }
    expect(dragFilm(none, 'opening', 'end', 2, contextOf(none))).toBe(none)
  })

  it('moves a stop along the track (its hold follows the pointer), snaps to a highlight', () => {
    const ctx = contextOf(film)
    const before = ctx.clock.stops.find((s) => s.id === 'stop-1')!
    const moved = dragFilm(film, 'stop-1', 'move', 5, ctx)
    const after = ctx.clockOf(moved.stops).stops.find((s) => s.id === 'stop-1')!
    expect(after.holdStartS).toBeCloseTo(before.holdStartS + 5, 1)
    expect(Number.isInteger(moved.stops[0].atM)).toBe(true)
    expect(moved.stops[1]).toBe(film.stops[1])
    // 5 s ≈ 830 m further (10 km in 60 s); snapping 0.5 s ≈ 76 m: a highlight 30 m away is taken, 400 m is not
    const near = moved.stops[0].atM + 30
    expect(dragFilm(film, 'stop-1', 'move', 5, { ...ctx, targetsM: [near], snapS: 0.5 }).stops[0].atM).toBe(near)
    expect(dragFilm(film, 'stop-1', 'move', 5, { ...ctx, targetsM: [near + 370], snapS: 0.5 }).stops[0].atM).toBe(moved.stops[0].atM)
  })

  it('a press past the outer third of a narrow block moves it, even on a grip (touch grips, touch adjustment)', () => {
    // a 4 s stop 24 px wide under a 16 px end grip: pressed in the middle or the left, it was stretched (and started
    // earlier, the flight being shortened) instead of moved
    const stopGrips = ['move', 'end'] as const
    expect(pressedGrip('end', 12, 24, stopGrips)).toBe('move')
    expect(pressedGrip('end', 6, 24, stopGrips)).toBe('move')
    expect(pressedGrip('end', 20, 24, stopGrips)).toBe('end')
    // a text: both edges, whichever grip the browser picked
    const textGrips = ['start', 'move', 'end'] as const
    expect(pressedGrip('end', 2, 17, textGrips)).toBe('start')
    expect(pressedGrip('start', 8, 17, textGrips)).toBe('move')
    expect(pressedGrip('end', 195, 200, textGrips)).toBe('end')
    // a shot only stretches
    expect(pressedGrip('end', 12, 24, ['end'])).toBe('end')
  })

  it('stretches a stop by its end edge, in proportion to the duration cap', () => {
    expect(dragFilm(film, 'stop-1', 'end', 2, contextOf(film)).stops[0].durationS).toBe(6)
    expect(dragFilm(film, 'stop-1', 'end', -10, contextOf(film)).stops[0].durationS).toBe(0.5)
    // keepDuration: the stops take at most half of the 60 s flight, here shortened by half: 1 s more is 2 s asked
    const big = { ...film, stops: [stop('stop-1', 2000, 40), stop('stop-2', 7000, 20)] }
    const ctx = contextOf(big, {}, { ...DEFAULT_PACING, keepDuration: true })
    const share = ctx.clock.stops[0].addedS / 40
    expect(share).toBeCloseTo(0.5, 9)
    expect(dragFilm(big, 'stop-1', 'end', 1, ctx).stops[0].durationS).toBe(42)
  })

  it('moves and stretches a text by its body and edges, snapping either edge', () => {
    const ctx = contextOf(film)
    expect(dragFilm(film, 'text-1', 'move', 2.5, ctx).texts[0]).toMatchObject({ startS: 12.5, durationS: 4 })
    expect(dragFilm(film, 'text-1', 'move', -20, ctx).texts[0].startS).toBe(0)
    // the end (14 + 1.9) snaps to 16
    expect(dragFilm(film, 'text-1', 'move', 1.9, { ...ctx, targets: at(16), snapS: 0.3 }).texts[0].startS).toBe(12)
    expect(dragFilm(film, 'text-1', 'start', -3, ctx).texts[0]).toMatchObject({ startS: 7, durationS: 7 })
    expect(dragFilm(film, 'text-1', 'start', 10, ctx).texts[0]).toMatchObject({ startS: 13.5, durationS: 0.5 })
    expect(dragFilm(film, 'text-1', 'end', 1.234, ctx).texts[0]).toMatchObject({ startS: 10, durationS: 5.23 })
    expect(dragFilm(film, 'text-1', 'end', -10, ctx).texts[0].durationS).toBe(0.5)
    expect(dragFilm(film, 'missing', 'move', 1, ctx)).toBe(film)
  })

  it('moves and stretches a photo like a text', () => {
    const ctx = contextOf(film)
    expect(dragFilm(film, 'media-1', 'move', 2.5, ctx).media[0]).toMatchObject({ startS: 42.5, durationS: 5 })
    expect(dragFilm(film, 'media-1', 'start', -3, ctx).media[0]).toMatchObject({ startS: 37, durationS: 8 })
    expect(dragFilm(film, 'media-1', 'end', 1, { ...ctx, targets: at(46.1), snapS: 0.3 }).media[0]).toMatchObject({ startS: 40, durationS: 6.1 })
    expect(dragFilm(film, 'media-1', 'move', 1, ctx).texts).toBe(film.texts)
  })

  it('trims a video by its start edge: its start in the file follows, not before the start of the file', () => {
    const clip: FilmMedia = { ...photo('media-1', 40, 10), kind: 'video', src: 'video-1', kenBurns: false, inS: 2 }
    const f = { ...film, media: [clip] }
    const ctx = contextOf(f)
    expect(dragFilm(f, 'media-1', 'start', 1.5, ctx).media[0]).toMatchObject({ startS: 41.5, durationS: 8.5, inS: 3.5 })
    expect(dragFilm(f, 'media-1', 'start', -5, ctx).media[0]).toMatchObject({ startS: 38, durationS: 12, inS: 0 })
    // moving or stretching the end keeps the start in the file
    expect(dragFilm(f, 'media-1', 'move', 3, ctx).media[0]).toMatchObject({ startS: 43, inS: 2 })
    expect(dragFilm(f, 'media-1', 'end', 3, ctx).media[0]).toMatchObject({ durationS: 13, inS: 2 })
  })
})

describe('edits', () => {
  it('adds a manual stop and a text with fresh ids, valid', () => {
    const a = addStop(film, 4321.5)
    expect(a.id).toBe('stop-3')
    expect(a.film.stops.at(-1)).toEqual({
      id: 'stop-3',
      atM: 4321.5,
      durationS: AUTO_STOP_S,
      camera: 'orbite',
      label: 'Arrêt 3',
      source: { kind: 'manual' },
    })
    const b = addStop(a.film, 100, { label: 'Col', source: { kind: 'landmark', ref: 'node/1' } })
    expect(b.film.stops.at(-1)).toMatchObject({ id: 'stop-4', label: 'Col', source: { kind: 'landmark', ref: 'node/1' } })
    const t = addText(b.film, 12.346)
    expect(t.id).toBe('text-3')
    expect(t.film.texts.at(-1)).toMatchObject({ startS: 12.35, durationS: 4, anchor: 'bottom-center', size: 1 })
    expect(isValidFilm(t.film)).toBe(true)
  })

  it('adds photos one after the other from the playhead, valid', () => {
    const { film: next, ids } = addMedia(film, 12.346, [{ src: 'photo-4' }, { src: 'photo-5' }])
    expect(ids).toEqual(['media-2', 'media-3'])
    expect(next.media.slice(1)).toEqual([
      { id: 'media-2', startS: 12.35, durationS: NEW_MEDIA_S, kind: 'image', src: 'photo-4', ...MEDIA_DEFAULTS },
      { id: 'media-3', startS: 17.35, durationS: NEW_MEDIA_S, kind: 'image', src: 'photo-5', ...MEDIA_DEFAULTS },
    ])
    expect(isValidFilm(next)).toBe(true)
    expect(snapTargets(contextOf(next).clock, next, [], 0).map((t) => t.timeS)).toEqual(expect.arrayContaining([40, 45, 17.35]))
    expect(removeFilmItem(next, 'media-2').media.map((m) => m.id)).toEqual(['media-1', 'media-3'])
    expect(updateMedia(next, 'media-1', { startS: -1, durationS: 900, layout: 'carte', caption: 'Lac' }).media[0]).toMatchObject({
      startS: 0,
      durationS: 600,
      layout: 'carte',
      caption: 'Lac',
    })
  })

  it('adds videos at their natural length, capped, without Ken Burns, with their sound, after the photos', () => {
    const { film: next, ids } = addMedia(film, 10, [{ src: 'video-1', videoS: 12.345 }, { src: 'photo-2' }, { src: 'video-2', videoS: 95 }])
    expect(ids).toEqual(['media-2', 'media-3', 'media-4'])
    expect(next.media.slice(1)).toEqual([
      { id: 'media-2', startS: 10, durationS: 12.35, kind: 'video', src: 'video-1', ...MEDIA_DEFAULTS, kenBurns: false, ...VIDEO_SOUND_DEFAULTS },
      { id: 'media-3', startS: 22.35, durationS: NEW_MEDIA_S, kind: 'image', src: 'photo-2', ...MEDIA_DEFAULTS },
      { id: 'media-4', startS: 27.35, durationS: NEW_VIDEO_MAX_S, kind: 'video', src: 'video-2', ...MEDIA_DEFAULTS, kenBurns: false, ...VIDEO_SOUND_DEFAULTS },
    ])
    expect(isValidFilm(next)).toBe(true)
    expect(updateMedia(next, 'media-2', { inS: -3 }).media[1].inS).toBe(0)
    expect(updateMedia(next, 'media-2', { inS: 4.567 }).media[1].inS).toBe(4.57)
  })

  it('removes a stop or a text; updates clamp to the model ranges', () => {
    expect(removeFilmItem(film, 'stop-1').stops.map((s) => s.id)).toEqual(['stop-2'])
    expect(removeFilmItem(film, 'text-2').texts.map((t) => t.id)).toEqual(['text-1'])
    // a shot is not removed: it goes to « aucune »
    expect(removeFilmItem(film, 'opening').opening.style).toBe('aucune')
    expect(removeFilmItem(film, 'opening').stops).toEqual(film.stops)
    expect(updateStop(film, 'stop-1', { durationS: 99, camera: 'fixe', label: 'Sommet' }).stops[0]).toMatchObject({
      durationS: 60,
      camera: 'fixe',
      label: 'Sommet',
    })
    expect(updateText(film, 'text-1', { startS: -2, durationS: 0.1, text: 'Titre' }).texts[0]).toMatchObject({
      startS: 0,
      durationS: 0.5,
      text: 'Titre',
    })
    expect(updateShot(film, 'closing', { style: 'saut', durationS: 0 }).closing).toEqual({ style: 'saut', durationS: 0.5 })
    expect(updateShot(film, 'opening', { durationS: 0.5 }).opening.durationS).toBe(0.5)
    expect(updateShot(film, 'opening', { durationS: 0.7 }).opening.durationS).toBe(0.7)
  })

  it('lengthens a shot switched to « Depuis la région » only while it has its default duration', () => {
    expect(updateShot(DEFAULT_FILM, 'opening', { style: 'situation' }).opening).toEqual({ style: 'situation', durationS: SITUATION_DURATION_S })
    expect(updateShot(DEFAULT_FILM, 'closing', { style: 'situation' }).closing.durationS).toBe(SITUATION_DURATION_S)
    // a duration the user chose, or a style that is not 'situation', is kept
    const custom = updateShot(DEFAULT_FILM, 'opening', { durationS: 7 })
    expect(updateShot(custom, 'opening', { style: 'situation' }).opening.durationS).toBe(7)
    expect(updateShot(DEFAULT_FILM, 'opening', { style: 'saut' }).opening.durationS).toBe(DEFAULT_FILM.opening.durationS)
    // already 'situation': shortening it back to the default sticks
    const situation = updateShot(DEFAULT_FILM, 'opening', { style: 'situation' })
    const shortened = updateShot(situation, 'opening', { durationS: DEFAULT_FILM.opening.durationS })
    expect(updateShot(shortened, 'opening', { highlight: true }).opening.durationS).toBe(DEFAULT_FILM.opening.durationS)
  })

  it('sets the place of both shots, and removes it to go back to automatic', () => {
    const placed = setFilmPlace(DEFAULT_FILM, 'relation/3')
    expect([placed.opening.regionId, placed.closing.regionId]).toEqual(['relation/3', 'relation/3'])
    const auto = setFilmPlace(placed, null)
    expect(auto.opening).toEqual(DEFAULT_FILM.opening)
    expect('regionId' in auto.closing).toBe(false)
  })

  it('tells whether a selected item is still in the film', () => {
    const { stops } = contextOf(film).clock
    for (const id of ['opening', 'closing', 'stop-2', 'text-1', 'media-1']) expect(hasFilmItem(film, stops, id)).toBe(true)
    expect(hasFilmItem(film, stops, 'text-9')).toBe(false)
    expect(hasFilmItem(removeFilmItem(film, 'media-1'), stops, 'media-1')).toBe(false)
    // a generated stop is only in the clock
    expect(hasFilmItem(film, [{ id: 'auto-1500' }], 'auto-1500')).toBe(true)
  })
})

describe('speed portions', () => {
  const speed = (id: string, fromM: number, toM: number, factor = 2): FilmSpeed => ({ id, fromM, toM, factor })
  const withSpeeds: Film = { ...film, speeds: [speed('speed-1', 3000, 4000), speed('speed-2', 5000, 6000, 0.5)] }
  /** drag context whose clock knows the speed portions (and the stops of `f`) */
  function speedContext(f: Film, patch: Partial<DragContext> = {}): DragContext {
    const input: FilmClockInput = {
      opening: f.opening,
      closing: f.closing,
      stops: f.stops,
      speeds: f.speeds,
      lengthM: L,
      durationS: D,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    }
    const clockOfSpeeds = (speeds: readonly FilmSpeed[]) => buildFilmClock({ ...input, speeds })
    return { ...contextOf(f), clock: clockOfSpeeds(f.speeds), clockOfSpeeds, ...patch }
  }
  const placed = (f: Film, id: string) => speedContext(f).clock.speeds.find((s) => s.id === id)!
  /** 1 m of track in film seconds at the base speed */
  const METRE_S = D / L

  it('adds a ×2 portion of 1 km from the marker, earlier or shorter to stay on the track and off the others', () => {
    const added = addSpeed(withSpeeds, 1000, L)!
    expect(added.id).toBe('speed-3')
    expect(added.film.speeds[2]).toEqual(speed('speed-3', 1000, 2000))
    expect(isValidFilm(added.film)).toBe(true)
    expect(addSpeed(withSpeeds, 2500, L)!.film.speeds[2]).toMatchObject({ fromM: 2000, toM: 3000 })
    expect(addSpeed(withSpeeds, 4200, L)!.film.speeds[2]).toMatchObject({ fromM: 4000, toM: 5000 })
    expect(addSpeed(withSpeeds, L, L)!.film.speeds[2]).toMatchObject({ fromM: 9000, toM: L })
    // inside a portion, or no room
    expect(addSpeed(withSpeeds, 3500, L)).toBeNull()
    expect(addSpeed({ ...film, speeds: [speed('a', 0, 2000), speed('b', 2000 + MIN_SPEED_SPAN_M - 1, 3000)] }, 2010, L)).toBeNull()
  })

  it('moves a portion: its start follows the pointer, its length in metres stays, never over a neighbour', () => {
    const before = placed(withSpeeds, 'speed-1')
    const moved = dragFilm(withSpeeds, 'speed-1', 'move', -6, speedContext(withSpeeds))
    const [p] = moved.speeds
    expect(p.toM - p.fromM).toBe(1000)
    expect(Number.isInteger(p.fromM)).toBe(true)
    expect(Math.abs(placed(moved, 'speed-1').startS - (before.startS - 6))).toBeLessThanOrEqual(METRE_S)
    expect(isValidFilm(moved)).toBe(true)
    // stopped by the next portion and by the start of the track
    expect(dragFilm(withSpeeds, 'speed-1', 'move', 100, speedContext(withSpeeds)).speeds[0]).toMatchObject({ fromM: 4000, toM: 5000 })
    expect(dragFilm(withSpeeds, 'speed-1', 'move', -100, speedContext(withSpeeds)).speeds[0]).toMatchObject({ fromM: 0, toM: 1000 })
  })

  it('stretches a portion by either edge, at least MIN_SPEED_SPAN_M long, the edge snapping', () => {
    const ctx = speedContext(withSpeeds)
    const before = placed(withSpeeds, 'speed-2')
    const longer = dragFilm(withSpeeds, 'speed-2', 'end', 3, ctx)
    expect(longer.speeds[1].fromM).toBe(5000)
    expect(Math.abs(placed(longer, 'speed-2').endS - (before.endS + 3))).toBeLessThanOrEqual(METRE_S / 0.5)
    const earlier = dragFilm(withSpeeds, 'speed-2', 'start', -2, ctx)
    expect(earlier.speeds[1].toM).toBe(6000)
    expect(Math.abs(placed(earlier, 'speed-2').startS - (before.startS - 2))).toBeLessThanOrEqual(METRE_S)
    expect(dragFilm(withSpeeds, 'speed-2', 'start', 100, ctx).speeds[1]).toMatchObject({ fromM: 6000 - MIN_SPEED_SPAN_M, toM: 6000 })
    expect(dragFilm(withSpeeds, 'speed-2', 'start', -100, ctx).speeds[1].fromM).toBe(4000)
    // the end edge snaps to a target time (the playhead)
    const snapped = dragFilm(withSpeeds, 'speed-2', 'end', 3.2, speedContext(withSpeeds, { targets: at(before.endS + 3), snapS: 0.5 }))
    expect(Math.abs(placed(snapped, 'speed-2').endS - (before.endS + 3))).toBeLessThanOrEqual(METRE_S / 0.5)
    // without the clock of the speeds, nothing moves
    expect(dragFilm(withSpeeds, 'speed-2', 'move', 3, contextOf(withSpeeds))).toBe(withSpeeds)
  })

  it('updates clamp the factor and the edges; removed like any block; edges are snap targets', () => {
    expect(updateSpeed(withSpeeds, 'speed-1', { factor: 9 }, L).speeds[0].factor).toBe(4)
    expect(updateSpeed(withSpeeds, 'speed-1', { factor: 1.414 }, L).speeds[0].factor).toBe(1.41)
    expect(updateSpeed(withSpeeds, 'speed-1', { toM: 5500.4 }, L).speeds[0]).toMatchObject({ fromM: 3000, toM: 5000 })
    expect(updateSpeed(withSpeeds, 'speed-1', { fromM: 3990 }, L).speeds[0]).toMatchObject({ fromM: 3990, toM: 4040 })
    expect(updateSpeed(withSpeeds, 'speed-2', { toM: 5010 }, L).speeds[1]).toMatchObject({ fromM: 4960, toM: 5010 })
    expect(updateSpeed(withSpeeds, 'speed-9', { factor: 3 }, L)).toBe(withSpeeds)
    expect(removeFilmItem(withSpeeds, 'speed-1').speeds.map((s) => s.id)).toEqual(['speed-2'])
    expect(hasFilmItem(withSpeeds, [], 'speed-2')).toBe(true)
    expect(hasFilmItem(removeFilmItem(withSpeeds, 'speed-2'), [], 'speed-2')).toBe(false)
    const { clock } = speedContext(withSpeeds)
    const targets = snapTargets(clock, withSpeeds, [], 0, 'speed-1').map((t) => t.timeS)
    expect(targets).toContain(clock.speeds[1].startS)
    expect(targets).not.toContain(clock.speeds[0].startS)
    expect([0.25, 2, 1.5].map(formatSpeedFactor)).toEqual(['×0,25', '×2', '×1,5'])
  })
})

describe('placing a photo on the track', () => {
  const T0 = Date.UTC(2025, 6, 12, 6)
  const MIN = 60_000
  // out and back along a parallel: 0.01° of longitude ≈ 775 m at 45.9°, 5 min per point
  const lons = [6.8, 6.81, 6.82, 6.81, 6.8]
  const track = buildTrack({
    name: 'aller-retour',
    source: 'gpx',
    segments: [{ points: lons.map((lon, i) => ({ lon, lat: 45.9, time: T0 + 5 * i * MIN })) }],
  })
  const path = buildTrackPath(track)
  const input: FilmClockInput = {
    opening: { style: 'descente', durationS: 6 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: path.lengthM,
    durationS: 40,
    pacing: DEFAULT_PACING,
  }
  const clock = buildFilmClock(input)
  const at = (distanceM: number) => Math.round(clock.timeAtProgress(distanceM / path.lengthM) * 100) / 100

  it('at the nearest point of the track, on the pass closest to the capture time', () => {
    expect(photoFilmTime(path, clock, { lon: 6.8201, lat: 45.9001 })).toBe(at(path.dist[2]))
    expect(photoFilmTime(path, clock, { lon: 6.81, lat: 45.9 })).toBe(at(path.dist[1]))
    expect(photoFilmTime(path, clock, { lon: 6.81, lat: 45.9, timeMs: T0 + 14 * MIN })).toBe(at(path.dist[3]))
  })

  it('else at the point recorded at the capture time; nothing far from the track or outside the outing', () => {
    expect(photoFilmTime(path, clock, { timeMs: T0 + 2.5 * MIN })).toBe(at(path.dist[1] / 2))
    expect(photoFilmTime(path, clock, { lon: 7.5, lat: 45.9 })).toBeUndefined()
    expect(photoFilmTime(path, clock, { lon: 7.5, lat: 45.9, timeMs: T0 + 5 * MIN })).toBe(at(path.dist[1]))
    expect(photoFilmTime(path, clock, { timeMs: T0 - 10 * MIN })).toBe(at(0))
    expect(photoFilmTime(path, clock, { timeMs: T0 + 3 * 3_600_000 })).toBeUndefined()
    expect(photoFilmTime(path, clock, {})).toBeUndefined()
  })
})

describe('syncing a video clip with the recorded track', () => {
  const T0 = Date.UTC(2025, 6, 12, 6)
  const MIN = 60_000
  const HOUR = 3_600_000
  // 4 equal legs of 5 min: the recorded time is linear in distance, 20 min over a 40 s flight (30 s per second)
  const lons = [6.8, 6.81, 6.82, 6.83, 6.84]
  const track = buildTrack({
    name: 'montée',
    source: 'gpx',
    segments: [{ points: lons.map((lon, i) => ({ lon, lat: 45.9, time: T0 + 5 * i * MIN })) }],
  })
  const path = buildTrackPath(track)
  const untimed = buildTrackPath(buildTrack({ name: 'sans heure', source: 'gpx', segments: [{ points: lons.map((lon) => ({ lon, lat: 45.9 })) }] }))
  const input: FilmClockInput = {
    opening: { style: 'descente', durationS: 6 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: path.lengthM,
    durationS: 40,
    pacing: DEFAULT_PACING,
  }
  const clock = buildFilmClock(input)
  const clip = (startMs: number, follow = false, patch: Partial<FilmMedia> = {}): FilmMedia => ({
    ...photo('media-1', 0, 30),
    kind: 'video',
    src: 'video-1',
    kenBurns: false,
    sync: { startMs, offsetS: 0, follow },
    ...patch,
  })

  it('finds the clock correction that puts the clip within the outing: none, else whole hours', () => {
    expect(clipSyncOffsetS(path, T0 + 2 * MIN, 60)).toBe(0)
    // started a little before the outing, still overlapping
    expect(clipSyncOffsetS(path, T0 - 30_000, 60)).toBe(0)
    // camera set to local time (UTC+2) written as UTC
    expect(clipSyncOffsetS(path, T0 + 2 * HOUR + 3 * MIN, 60)).toBe(-7200)
    expect(clipSyncOffsetS(path, T0 - 3 * HOUR, 60)).toBe(3 * 3600)
    expect(clipSyncOffsetS(path, T0 + 20 * HOUR, 60)).toBeUndefined()
    expect(clipSyncOffsetS(untimed, T0, 60)).toBeUndefined()
  })

  it('places the clip where the marker passes the point recorded at its start', () => {
    // recorded at the second point: 10 s into the 40 s flight, after the 6 s opening
    expect(syncClipPlacement(clip(T0 + 5 * MIN), path, clock, 120)).toEqual({ startS: 16, durationS: 30, inS: 0 })
    // a clip shorter than its block is cut to its length
    expect(syncClipPlacement(clip(T0 + 5 * MIN), path, clock, 12)?.durationS).toBe(12)
    // following the flight: until the marker passes the point recorded at its end (2 min = 4 s of film)
    expect(syncClipPlacement(clip(T0 + 5 * MIN, true), path, clock, 120)).toEqual({ startS: 16, durationS: 4, inS: 0 })
    // started 1 min before the outing: at the start of the flight, the first minute skipped
    expect(syncClipPlacement(clip(T0 - MIN, true), path, clock, 180)).toEqual({ startS: 6, durationS: 4, inS: 60 })
    // the clock correction moves it: 5 min later
    expect(syncClipPlacement(clip(T0, false, { sync: { startMs: T0, offsetS: 300, follow: false } }), path, clock, 120)?.startS).toBe(16)
    // outside the outing, without time, not synced
    expect(syncClipPlacement(clip(T0 + 2 * HOUR), path, clock, 120)).toBeUndefined()
    expect(syncClipPlacement(clip(T0 + 5 * MIN), untimed, clock, 120)).toBeUndefined()
    expect(syncClipPlacement({ ...clip(T0), sync: undefined }, path, clock, 120)).toBeUndefined()
  })

  it('syncs a clip of the film in one edit, nothing outside the outing', () => {
    const f: Film = { ...film, media: [{ ...clip(0), sync: undefined }] }
    const synced = syncClip(f, 'media-1', { startMs: T0 + 5 * MIN, offsetS: 0, follow: true }, path, clock, 120)!
    expect(synced.media[0]).toMatchObject({ startS: 16, durationS: 4, inS: 0, sync: { startMs: T0 + 5 * MIN, follow: true } })
    expect(isValidFilm(synced)).toBe(true)
    expect(syncClip(f, 'media-1', { startMs: T0 + 5 * HOUR, offsetS: 0, follow: true }, path, clock, 120)).toBeUndefined()
    expect(syncClip(f, 'media-9', { startMs: T0, offsetS: 0, follow: true }, path, clock, 120)).toBeUndefined()
  })

  it('following the flight, the clip time is the recorded time under the marker: faster when the flight is, held at a stop', () => {
    const following = clip(T0 + 5 * MIN, true, { startS: 16, durationS: 4 })
    const at = (t: number) => clipTimeS(following, t, recordedAtFilmTime(path, clock, t))
    expect(at(16)).toBeCloseTo(0, 6)
    expect(at(18)).toBeCloseTo(60, 6)
    expect(clipRateAt(following, path, clock, 17)).toBeCloseTo(30, 6)
    expect(clipRateAt({ ...following, sync: { ...following.sync!, follow: false } }, path, clock, 17)).toBe(1)
    expect(recordedAtFilmTime(untimed, clock, 17)).toBeUndefined()
    expect(clipRateAt(following, untimed, clock, 17)).toBe(1)
    // a stop at the third point: the frame holds during its hold
    const withStop = buildFilmClock({ ...input, stops: [{ id: 'stop-1', atM: path.dist[2], durationS: 8, camera: 'fixe' }] })
    const hold = withStop.stops[0]
    expect(hold.holdEndS - hold.holdStartS).toBeGreaterThan(1)
    const middle = (hold.holdStartS + hold.holdEndS) / 2 - 0.1
    expect(clipRateAt(following, path, withStop, middle)).toBe(0)
    expect(clipTimeS(following, middle, recordedAtFilmTime(path, withStop, middle))).toBeCloseTo(300, 6)
  })
})

describe('music', () => {
  const music = (id: string, startS: number, durationS: number, inS = 0): FilmAudio => ({ id, src: 'audio-1', startS, durationS, inS, ...AUDIO_DEFAULTS })
  const withMusic: Film = { ...film, audio: [music('music-1', 5, 20, 10)] }
  /** the file of audio-1 lasts 60 s */
  const ctx = (patch: Partial<DragContext> = {}) => contextOf(withMusic, { audioFileS: (src) => (src === 'audio-1' ? 60 : undefined), ...patch })

  it('adds whole files one after the other, after the music already there, valid', () => {
    const first = addMusic(film, [{ src: 'audio-1', fileS: 95.5 }, { src: 'audio-2', fileS: 30 }])
    expect(first.ids).toEqual(['music-1', 'music-2'])
    expect(first.film.audio).toEqual([
      { id: 'music-1', src: 'audio-1', startS: 0, durationS: 95.5, inS: 0, ...AUDIO_DEFAULTS },
      { id: 'music-2', src: 'audio-2', startS: 95.5, durationS: 30, inS: 0, ...AUDIO_DEFAULTS },
    ])
    expect(isValidFilm(first.film)).toBe(true)
    const next = addMusic(first.film, [{ src: 'audio-3', fileS: 10 }])
    expect(next.film.audio[2]).toMatchObject({ id: 'music-3', startS: 125.5 })
  })

  it('moves a clip; its end never goes past the end of the file; its start edge moves its start in the file', () => {
    expect(dragFilm(withMusic, 'music-1', 'move', 3, ctx()).audio[0]).toMatchObject({ startS: 8, durationS: 20, inS: 10 })
    expect(dragFilm(withMusic, 'music-1', 'move', -10, ctx()).audio[0].startS).toBe(0)
    // 10 s in the file + 20 s played: 30 s left at most
    expect(dragFilm(withMusic, 'music-1', 'end', 100, ctx()).audio[0].durationS).toBe(50)
    expect(dragFilm(withMusic, 'music-1', 'end', -100, ctx()).audio[0].durationS).toBe(0.5)
    expect(dragFilm(withMusic, 'music-1', 'start', 2, ctx()).audio[0]).toMatchObject({ startS: 7, durationS: 18, inS: 12 })
    // not before the start of the file (10 s earlier) nor of the film
    expect(dragFilm(withMusic, 'music-1', 'start', -20, ctx()).audio[0]).toMatchObject({ startS: 0, durationS: 25, inS: 5 })
    expect(dragFilm({ ...withMusic, audio: [music('music-1', 15, 20, 10)] }, 'music-1', 'start', -20, ctx()).audio[0]).toMatchObject({
      startS: 5,
      durationS: 30,
      inS: 0,
    })
    // snaps to the other blocks, which also snap to it
    expect(dragFilm(withMusic, 'music-1', 'move', 4.6, ctx({ targets: at(10), snapS: 0.5 })).audio[0].startS).toBe(10)
    expect(snapTargets(ctx().clock, withMusic, [], 0).map((t) => t.timeS)).toEqual(expect.arrayContaining([5, 25]))
  })

  it('updates clamp volume, fades, start in the file and duration; removed like any block', () => {
    const f = updateMusic(withMusic, 'music-1', { volume: 1.5, fadeInS: -2, fadeOutS: 40, inS: 70 }, 60)
    expect(f.audio[0]).toMatchObject({ volume: 1, fadeInS: 0, fadeOutS: 30, inS: 59.5, durationS: 0.5 })
    expect(updateMusic(withMusic, 'music-1', { durationS: 100 }, 60).audio[0].durationS).toBe(50)
    expect(updateMusic(withMusic, 'music-1', { durationS: 100 }).audio[0].durationS).toBe(100)
    expect(updateMusic(withMusic, 'music-1', { volume: 0.333 }, 60).audio[0].volume).toBe(0.33)
    expect(hasFilmItem(withMusic, [], 'music-1')).toBe(true)
    const removed = removeFilmItem(withMusic, 'music-1')
    expect(removed.audio).toEqual([])
    expect(hasFilmItem(removed, [], 'music-1')).toBe(false)
  })
})

describe('camera keys', () => {
  const framing = { distance: 2.345, pitchDeg: 61.27, headingOffsetDeg: 190 }

  it('frames a text or a photo: a key at its start to adjust, one at its end keeping the framing there', () => {
    const atTime = (t: number) => t * 100
    const framingAt = (atM: number) => (atM < 2000 ? framing : { distance: 1, pitchDeg: 30, headingOffsetDeg: 0 })
    const { film: framed, id } = addItemCamera(film, 12, 22, atTime, framingAt)
    expect(framed.cameraKeys.map((k) => [k.atM, k.distance])).toEqual([
      [2200, 1],
      [1200, 2.345],
    ])
    expect(framed.cameraKeys.find((k) => k.id === id)?.atM).toBe(1200)
    // the marker holds (a stop): one key only
    expect(addItemCamera(film, 12, 22, () => 1500, framingAt).film.cameraKeys).toHaveLength(1)
  })

  it('adds a key at the marker, not rounded (the exact view), valid; a second one at the same metre takes the pose', () => {
    const { film: one, id } = addCameraKey(film, 2500.4, { ...framing, aimRightM: 12.5 })
    expect(id).toBe('camera-1')
    expect(one.cameraKeys).toEqual([{ id, atM: 2500.4, distance: 2.345, pitchDeg: 61.27, headingOffsetDeg: -170, aimRightM: 12.5 }])
    expect(isValidFilm(one)).toBe(true)
    const again = addCameraKey(one, 2499.8, { distance: 1, pitchDeg: 30, headingOffsetDeg: 0, aimRightM: 0, aimAheadM: 0 })
    expect(again.id).toBe(id)
    expect(again.film.cameraKeys).toEqual([{ id, atM: 2499.8, distance: 1, pitchDeg: 30, headingOffsetDeg: 0, aimRightM: 0, aimAheadM: 0 }])
  })

  it('previous / next keyframe: the nearest one before or after the playhead, never the one under it', () => {
    const keys = [{ timeS: 40 }, { timeS: 10 }, { timeS: 25.5 }]
    const at = (timeS: number, direction: -1 | 1) => adjacentKey(keys, timeS, direction)?.timeS ?? null
    expect(at(20, 1)).toBe(25.5)
    expect(at(20, -1)).toBe(10)
    expect(at(25.5, 1)).toBe(40)
    expect(at(25.5, -1)).toBe(10)
    expect(at(40, 1)).toBeNull()
    expect(at(5, -1)).toBeNull()
    expect(adjacentKey([], 5, 1)).toBeNull()
  })

  it('the keyframe under the playhead: found within a millisecond, none elsewhere', () => {
    const keys = [{ timeS: 10 }, { timeS: 25.5 }]
    expect(keyAt(keys, 25.5004)).toBe(keys[1])
    expect(keyAt(keys, 25.6)).toBeNull()
    expect(keyAt([], 0)).toBeNull()
  })

  it('key buttons state: a key before, a key after, the playhead on a key (a lane or panel with no key: all off)', () => {
    const keys = [{ timeS: 10 }, { timeS: 25.5 }, { timeS: 40 }]
    expect(keyState(keys, 5)).toEqual({ prev: false, next: true, on: false })
    expect(keyState(keys, 25.5)).toEqual({ prev: true, next: true, on: true })
    expect(keyState(keys, 40)).toEqual({ prev: true, next: false, on: true })
    expect(keyState([], 3)).toEqual({ prev: false, next: false, on: false })
  })

  it('updates clamp to the keyframe ranges; moved along the track by the pointer; removed like any block', () => {
    const { film: keyed, id } = addCameraKey(film, 2500, framing)
    expect(updateCameraKey(keyed, id, { distance: 2000, pitchDeg: -3, atM: -4 }).cameraKeys[0]).toMatchObject({ distance: 1000, pitchDeg: 0, atM: 0 })
    expect(updateCameraKey(keyed, id, { pitchDeg: 87.25 }).cameraKeys[0]).toMatchObject({ distance: 2.345, pitchDeg: 87.25 })
    const ctx = contextOf(keyed)
    const key = ctx.clock.cameraKeys[0]
    const moved = dragFilm(keyed, id, 'move', 5, ctx)
    expect(moved.cameraKeys[0].atM).toBe(Math.round(ctx.clock.progressAtTime(key.timeS + 5) * L))
    expect(moved.stops).toBe(keyed.stops)
    expect(dragFilm(keyed, id, 'move', -1000, ctx).cameraKeys[0].atM).toBe(0)
    expect(hasFilmItem(keyed, [], id)).toBe(true)
    expect(removeFilmItem(keyed, id).cameraKeys).toEqual([])
  })

  it('several keys move together: the gaps in film time are kept, the group stays on the flight, the magnet snaps the one under the pointer', () => {
    const a = addCameraKey(film, 2000, framing)
    const b = addParamKey(a.film, 5000, 'exposure', 0.5)
    const c = addMarkerKey(b.film, 8000, { kind: 'figurine', figure: 'cycliste' })
    const keyed = c.film
    const ids = [a.id, b.id, c.id]
    const clockOf = (f: Film) =>
      buildFilmClock({ opening: f.opening, closing: f.closing, stops: f.stops, cameraKeys: f.cameraKeys, paramKeys: f.paramKeys, markerKeys: f.markerKeys, lengthM: L, durationS: D, pacing: { ...DEFAULT_PACING, keepDuration: false } })
    const timesOf = (f: Film) => {
      const clock = clockOf(f)
      return [...clock.cameraKeys, ...clock.paramKeys, ...clock.markerKeys].map((k) => k.timeS)
    }
    const ctx = { ...contextOf(keyed), clock: clockOf(keyed) }
    const times = timesOf(keyed)
    const moved = dragKeys(keyed, ids, a.id, 3, ctx)
    timesOf(moved).forEach((t, i) => expect(t - times[i]).toBeCloseTo(3, 1))
    expect(moved.stops).toBe(keyed.stops)
    // against an end of the flight the group stops as a whole: its last (first) key at the end (start), the others keep their gap
    const end = dragKeys(keyed, ids, a.id, 1000, ctx)
    expect(Math.max(end.cameraKeys[0].atM, end.paramKeys[0].atM, end.markerKeys[0].atM)).toBe(L)
    expect(end.cameraKeys[0].atM).toBeGreaterThan(2000)
    const start = dragKeys(keyed, ids, a.id, -1000, ctx)
    expect(Math.min(start.cameraKeys[0].atM, start.paramKeys[0].atM, start.markerKeys[0].atM)).toBe(0)
    // the magnet catches the key under the pointer, the others follow it
    const target = times[0] + 5
    const snapped = dragKeys(keyed, ids, a.id, 4.8, { ...ctx, targets: at(target), snapS: 0.5 })
    expect(snapped.cameraKeys[0].atM).toBe(Math.round(ctx.clock.progressAtTime(target) * L))
    // a key that is not in the group moves nothing; the keys that move are no targets
    expect(dragKeys(keyed, ids, 'nope', 3, ctx)).toBe(keyed)
    expect(snapTargets(ctx.clock, keyed, [], 0).length - snapTargets(ctx.clock, keyed, [], 0, ids).length).toBe(3)
  })
})

describe('texts and media attached to a stop', () => {
  /** clock of a film of the test track (its own stops, speed portions and shots) */
  const clockOfFilm = (f: Film) =>
    buildFilmClock({
      opening: f.opening,
      closing: f.closing,
      stops: f.stops,
      speeds: f.speeds,
      lengthM: L,
      durationS: D,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
  const holdOf = (f: Film, id: string) => clockOfFilm(f).stops.find((s) => s.id === id)!
  const round = (s: number) => Math.round(s * 100) / 100
  /** text-1 attached to stop-1 one second after its hold starts, media-1 fitted to its hold */
  const attached = (() => {
    const stop1 = holdOf(film, 'stop-1')
    const f = attachToStop(attachToStop(film, 'text-1', stop1), 'media-1', stop1)
    return updateText(f, 'text-1', { startS: f.texts[0].startS + 1 })
  })()

  it('attaching: a text moves to the start of the hold, a photo is fitted to the hold; detaching keeps the time', () => {
    const stop1 = holdOf(film, 'stop-1')
    const f = attachToStop(attachToStop(film, 'text-1', stop1), 'media-1', stop1)
    expect(f.texts[0]).toMatchObject({ stopId: 'stop-1', startS: round(stop1.holdStartS), durationS: 4 })
    expect(f.media[0]).toMatchObject({ stopId: 'stop-1', startS: round(stop1.holdStartS), durationS: round(stop1.holdEndS - stop1.holdStartS) })
    expect(f.texts[1]).toBe(film.texts[1])
    expect(isValidFilm(f)).toBe(true)
    const free = attachToStop(f, 'text-1', null)
    expect('stopId' in free.texts[0]).toBe(false)
    expect(free.texts[0].startS).toBe(f.texts[0].startS)
    // a text added (T) with a stop selected is attached to it
    const added = addText(film, 3, stop1)
    expect(added.film.texts.at(-1)).toMatchObject({ id: added.id, stopId: 'stop-1', startS: round(stop1.holdStartS), durationS: 4 })
    expect(isValidFilm(added.film)).toBe(true)
    // a video keeps its length
    const clip: Film = { ...film, media: [{ ...photo('media-1', 40, 12), kind: 'video' }] }
    expect(attachToStop(clip, 'media-1', stop1).media[0]).toMatchObject({ stopId: 'stop-1', startS: round(stop1.holdStartS), durationS: 12 })
  })

  it('follow their stop when it moves along the track, keeping their offset', () => {
    const before = holdOf(attached, 'stop-1')
    const dragged = dragFilm(attached, 'stop-1', 'move', 5, contextOf(attached))
    const next = followStops(attached, dragged, clockOfFilm)
    const after = holdOf(next, 'stop-1')
    const delta = after.holdStartS - before.holdStartS
    expect(delta).toBeGreaterThan(4)
    expect(next.texts[0].startS).toBeCloseTo(attached.texts[0].startS + delta, 1)
    expect(next.texts[0].startS - after.holdStartS).toBeCloseTo(1, 1)
    expect(next.media[0].startS).toBe(round(after.holdStartS))
    // a free text keeps its place on the route
    expect(clockOfFilm(next).progressAtTime(next.texts[1].startS)).toBeCloseTo(clockOfFilm(attached).progressAtTime(attached.texts[1].startS), 2)
  })

  it('an item fitted to the hold stays fitted when the stop is stretched; shots and speed portions move them too', () => {
    const stretched = followStops(attached, dragFilm(attached, 'stop-1', 'end', 2, contextOf(attached)), clockOfFilm)
    const hold = holdOf(stretched, 'stop-1')
    expect(stretched.media[0]).toMatchObject({ startS: round(hold.holdStartS), durationS: round(hold.holdEndS - hold.holdStartS) })
    expect(stretched.media[0].durationS).toBeCloseTo(attached.media[0].durationS + 2, 1)
    expect(stretched.texts[0].startS).toBe(attached.texts[0].startS)
    // a longer opening delays the stop and what is attached to it, and the free items placed on the route
    const later = followStops(attached, updateShot(attached, 'opening', { durationS: attached.opening.durationS + 2 }), clockOfFilm)
    expect(later.texts[0].startS).toBeCloseTo(attached.texts[0].startS + 2, 2)
    expect(later.media[0].startS).toBeCloseTo(attached.media[0].startS + 2, 2)
    expect(later.texts[1].startS).toBeCloseTo(attached.texts[1].startS + 2, 2)
    // a slower portion before the stop delays it as well
    const slowed = followStops(attached, { ...attached, speeds: [{ id: 'speed-1', fromM: 500, toM: 1500, factor: 0.5 }] }, clockOfFilm)
    const delay = holdOf(slowed, 'stop-1').holdStartS - holdOf(attached, 'stop-1').holdStartS
    expect(delay).toBeGreaterThan(1)
    expect(slowed.texts[0].startS).toBeCloseTo(attached.texts[0].startS + delay, 1)
  })

  it('follow their stop when the flyover duration or the pacing moves it (clock before the change)', () => {
    const longer = (f: Film) =>
      buildFilmClock({
        opening: f.opening,
        closing: f.closing,
        stops: f.stops,
        speeds: f.speeds,
        lengthM: L,
        durationS: 2 * D,
        pacing: { ...DEFAULT_PACING, keepDuration: false },
      })
    const next = followStops(attached, attached, longer, clockOfFilm)
    const before = holdOf(attached, 'stop-1')
    const after = longer(next).stops.find((s) => s.id === 'stop-1')!
    expect(after.holdStartS - before.holdStartS).toBeGreaterThan(1)
    expect(next.texts[0].startS - after.holdStartS).toBeCloseTo(1, 1)
    expect(next.media[0]).toMatchObject({ startS: round(after.holdStartS), durationS: round(after.holdEndS - after.holdStartS) })
    // a free text keeps its place on the route in the longer film
    expect(next.texts[1].startS).toBeGreaterThan(attached.texts[1].startS)
    expect(longer(next).progressAtTime(next.texts[1].startS)).toBeCloseTo(clockOfFilm(attached).progressAtTime(attached.texts[1].startS), 2)
    // same clock: nothing moves
    expect(followStops(attached, attached, clockOfFilm)).toBe(attached)
  })

  it('an attached item moved by the edit itself keeps its new place (new offset)', () => {
    const moved = dragFilm(attached, 'text-1', 'move', 3, contextOf(attached))
    expect(followStops(attached, moved, clockOfFilm)).toBe(moved)
  })

  it('become free where they are once their stop is gone', () => {
    const removed = followStops(attached, removeFilmItem(attached, 'stop-1'), clockOfFilm)
    expect(removed.texts[0].stopId).toBeUndefined()
    expect(removed.media[0].stopId).toBeUndefined()
    expect(removed.texts[0].startS).toBe(attached.texts[0].startS)
    const auto = followStops(attached, { ...attached, autoStops: true, stops: [] }, clockOfFilm)
    expect(auto.texts.every((t) => t.stopId === undefined) && auto.media.every((m) => m.stopId === undefined)).toBe(true)
  })

  it('leave the film as is when nothing moves in time, or nothing is placed on it', () => {
    const renamed = updateText(attached, 'text-2', { text: 'Titre' })
    expect(followStops(attached, renamed, clockOfFilm)).toBe(renamed)
    const bare: Film = { ...film, texts: [], media: [] }
    const edited = dragFilm(bare, 'stop-1', 'move', 5, contextOf(bare))
    expect(followStops(bare, edited, clockOfFilm)).toBe(edited)
  })
})

describe('free texts and media follow their place on the route', () => {
  const clockOfFilm = (f: Film) =>
    buildFilmClock({
      opening: f.opening,
      closing: f.closing,
      stops: f.stops,
      speeds: f.speeds,
      lengthM: L,
      durationS: D,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
  const progressOf = (f: Film, id: string) => clockOfFilm(f).progressAtTime((f.texts.find((t) => t.id === id) ?? f.media.find((m) => m.id === id)!).startS)
  const placed: Film = { ...film, texts: [text('in-opening', 2), text('on-route', 30, 2)], media: [photo('photo-on-route', 40)], audio: [{ id: 'audio-1', src: 'song-1', startS: 20, durationS: 10, inS: 0, volume: 1, fadeInS: 0.5, fadeOutS: 2 }] }

  it('a slowed portion before them delays them, their duration and the music unchanged', () => {
    const slowed = followStops(placed, { ...placed, speeds: [{ id: 'speed-1', fromM: 500, toM: 1500, factor: 0.5 }] }, clockOfFilm)
    expect(slowed.texts[1].startS).toBeGreaterThan(placed.texts[1].startS + 1)
    expect(progressOf(slowed, 'on-route')).toBeCloseTo(progressOf(placed, 'on-route'), 2)
    expect(progressOf(slowed, 'photo-on-route')).toBeCloseTo(progressOf(placed, 'photo-on-route'), 2)
    expect(slowed.texts[1].durationS).toBe(placed.texts[1].durationS)
    // placed in the opening, before the flight: its time from the start of the film
    expect(slowed.texts[0]).toBe(placed.texts[0])
    // the music keeps its film seconds
    expect(slowed.audio).toBe(placed.audio)
  })

  it('a faster portion before them brings them earlier, and a stop added before them delays them', () => {
    const faster = followStops(placed, { ...placed, speeds: [{ id: 'speed-1', fromM: 500, toM: 1500, factor: 2 }] }, clockOfFilm)
    expect(faster.texts[1].startS).toBeLessThan(placed.texts[1].startS)
    expect(progressOf(faster, 'on-route')).toBeCloseTo(progressOf(placed, 'on-route'), 2)
    const stopped = followStops(placed, { ...placed, stops: [...placed.stops, stop('stop-3', 1000, 5)] }, clockOfFilm)
    expect(stopped.texts[1].startS).toBeCloseTo(placed.texts[1].startS + 5, 1)
  })

  it('an item the edit moved itself, or edits that do not move the film in time, are left alone', () => {
    const moved = dragFilm(placed, 'on-route', 'move', 3, contextOf(placed))
    expect(followStops(placed, moved, clockOfFilm)).toBe(moved)
    const keyed = { ...placed, markerKeys: [] }
    expect(followStops(placed, keyed, clockOfFilm)).toBe(keyed)
  })
})

describe('followScroll', () => {
  it('keeps the scroll while the playhead is inside the view, away from its edges', () => {
    expect(followScroll(500, 400, 600, 3000)).toBe(400)
    expect(followScroll(400 + 60, 400, 600, 3000)).toBe(400)
    expect(followScroll(400 + 540, 400, 600, 3000)).toBe(400)
  })

  it('pages when it gets to an edge: the playhead goes to a quarter of the view', () => {
    expect(followScroll(400 + 541, 400, 600, 3000)).toBe(400 + 541 - 150)
    // behind the view (a seek back): paged back to it
    expect(followScroll(100, 400, 600, 3000)).toBe(0)
    expect(followScroll(1000, 400, 600, 3000)).toBe(850)
  })

  it('never scrolls past the content, nor when it fits the view', () => {
    expect(followScroll(2990, 2000, 600, 3000)).toBe(2400)
    expect(followScroll(500, 0, 600, 600)).toBe(0)
    expect(followScroll(900, 120, 600, 500)).toBe(120)
    expect(followScroll(900, 0, 0, 3000)).toBe(0)
  })
})

describe('duplicate and split', () => {
  const text = { id: 'text-1', startS: 2, durationS: 4, text: 'Col', anchor: 'bottom-center' as const, size: 1, stopId: 'stop-1' }
  const photo = { id: 'media-1', startS: 10, durationS: 5, kind: 'image' as const, src: 'a', ...MEDIA_DEFAULTS }
  const film: Film = { ...DEFAULT_FILM, texts: [text], media: [photo, { ...photo, id: 'media-2', kind: 'video', startS: 20 }, { ...photo, id: 'media-3', startS: 30, sync: { atMs: 0, offsetS: 0, follow: true } as never }] }

  it('duplicate a text or a medium just after it, with its own id and no stop', () => {
    const copy = duplicateFilmItem(film, 'text-1')
    expect(copy?.film.texts).toHaveLength(2)
    expect(copy?.film.texts[1]).toMatchObject({ startS: 6, durationS: 4, text: 'Col', id: copy?.id })
    expect(copy?.film.texts[1].stopId).toBeUndefined()
    expect(copy?.id).not.toBe('text-1')
    expect(duplicateFilmItem(film, 'media-1')?.film.media[3]).toMatchObject({ startS: 15, durationS: 5, kind: 'image' })
    // a clip synced with the track, an item that does not exist, a key: none
    expect(duplicateFilmItem(film, 'media-3')).toBeNull()
    expect(duplicateFilmItem(film, 'nope')).toBeNull()
  })

  it('split a text or a photo in two at the playhead, each piece at least 0.5 s', () => {
    const cut = splitFilmItem(film, 'text-1', 3.5)
    expect(cut?.film.texts.map((t) => [t.id, t.startS, t.durationS])).toEqual([['text-1', 2, 1.5], [cut?.id, 3.5, 2.5]])
    expect(cut?.film.texts[1].stopId).toBeUndefined()
    expect(cut?.film.texts[0].stopId).toBe('stop-1')
    expect(splitFilmItem(film, 'media-1', 12)?.film.media.slice(0, 1).concat(splitFilmItem(film, 'media-1', 12)?.film.media.slice(-1) ?? []).map((m) => [m.startS, m.durationS])).toEqual([[10, 2], [12, 3]])
    // outside, too near an edge, a video, a synced photo: none
    expect(splitFilmItem(film, 'text-1', 1)).toBeNull()
    expect(splitFilmItem(film, 'text-1', 2.3)).toBeNull()
    expect(splitFilmItem(film, 'text-1', 5.8)).toBeNull()
    expect(splitFilmItem(film, 'text-1', 9)).toBeNull()
    expect(splitFilmItem(film, 'media-2', 22)).toBeNull()
    expect(splitFilmItem(film, 'media-3', 32)).toBeNull()
  })
})

describe('timecode in frames', () => {
  it('minutes, seconds and the frame of the second, at the frame rate of the film', () => {
    expect(formatFrameTimecode(0, 30)).toBe('00:00:00')
    expect(formatFrameTimecode(67.4, 30)).toBe('01:07:12')
    expect(formatFrameTimecode(1.5, 24)).toBe('00:01:12')
    expect(formatFrameTimecode(59.99, 25)).toBe('01:00:00')
    expect(formatFrameTimecode(125, 60)).toBe('02:05:00')
    expect(formatFrameTimecode(-3, 30)).toBe('00:00:00')
    // a nonsense rate is taken as 1
    expect(formatFrameTimecode(3, 0)).toBe('00:03:00')
  })
})

describe('zoomToSpan', () => {
  // a 600 px view with 10 px of padding, a 100 s film: 5.8 px a second fitted
  const fit = 580 / 100

  it('a stretch fills the view with its margin, centred', () => {
    const { zoom, scrollLeft } = zoomToSpan(40, 50, 600, 100, 10)
    // 10 s plus 15 % at each side = 13 s over 600 px
    expect((fit * zoom) * 13).toBeCloseTo(600, 6)
    // the middle of the stretch (45 s) is the middle of the view
    expect(10 + 45 * fit * zoom - scrollLeft).toBeCloseTo(300, 6)
  })

  it('never zooms out past the whole film nor in past the maximum, and a point-like stretch is given a minimum', () => {
    expect(zoomToSpan(0, 100, 600, 100, 10).zoom).toBe(1)
    expect(zoomToSpan(10, 10.1, 600, 100, 10).zoom).toBeLessThanOrEqual(50)
    const point = zoomToSpan(30, 30, 600, 100, 10)
    expect(point.zoom).toBeCloseTo(600 / (2 * 1.3) / fit, 6)
    expect(zoomToSpan(0, 1, 600, 100, 10).scrollLeft).toBe(0)
  })
})

describe('snap groups', () => {
  const target = (kind: SnapTarget['kind']): SnapTarget => ({ timeS: 1, label: kind, kind })

  it('each kind of target belongs to one family', () => {
    expect(snapGroupOf('playhead')).toBe('playhead')
    expect(snapGroupOf('ruler')).toBe('ruler')
    expect(snapGroupOf('junction')).toBe('marks')
    expect(snapGroupOf('highlight')).toBe('marks')
    for (const kind of ['edge', 'centre', 'end'] as const) expect(snapGroupOf(kind)).toBe('blocks')
  })

  it('the families switched off leave their targets out, the others stay', () => {
    const all = (['edge', 'centre', 'end', 'playhead', 'junction', 'ruler', 'highlight'] as const).map(target)
    const on = { playhead: true, blocks: true, ruler: true, marks: true }
    expect(snapTargetsOn(all, on)).toHaveLength(7)
    expect(snapTargetsOn(all, { ...on, blocks: false }).map((t) => t.kind)).toEqual(['playhead', 'junction', 'ruler', 'highlight'])
    expect(snapTargetsOn(all, { playhead: false, blocks: false, ruler: false, marks: false })).toEqual([])
    expect(snapTargetsOn(all, { ...on, ruler: false, marks: false }).map((t) => t.kind)).toEqual(['edge', 'centre', 'end', 'playhead'])
  })
})

describe('blocks as a group', () => {
  const text = (id: string, startS: number, durationS: number, extra: Partial<FilmText> = {}): FilmText => ({ id, startS, durationS, text: id, anchor: 'bottom-center', size: 1, ...extra })
  const photo = (id: string, startS: number, durationS: number): FilmMedia => ({ id, startS, durationS, kind: 'image', src: `src-${id}`, ...MEDIA_DEFAULTS })
  const music = (id: string, startS: number, durationS: number): FilmAudio => ({ id, startS, durationS, src: `snd-${id}`, ...AUDIO_DEFAULTS, inS: 0 })
  const film: Film = {
    ...DEFAULT_FILM,
    autoStops: false,
    texts: [text('text-1', 2, 3), text('text-2', 8, 2), text('text-3', 12, 2, { stopId: 'stop-1' })],
    media: [photo('media-1', 5, 4)],
    audio: [music('music-1', 0, 30)],
  }
  const ctxOf = (snapS = 0): DragContext => contextOf({ ...DEFAULT_FILM, autoStops: false }, { snapS })
  const startsOf = (f: Film) => Object.fromEntries([...f.texts, ...f.media, ...f.audio].map((i) => [i.id, i.startS]))

  it('lists the ids of the texts, the media and the music', () => {
    expect(timedBlockIds(film)).toEqual(['text-1', 'text-2', 'text-3', 'media-1', 'music-1'])
  })

  it('moves the blocks of a group by the same seconds, whichever leads, none before the start', () => {
    const moved = dragBlocks(film, ['text-1', 'text-2', 'media-1'], 'text-2', 3, ctxOf())
    expect(startsOf(moved)).toMatchObject({ 'text-1': 5, 'text-2': 11, 'media-1': 8, 'text-3': 12, 'music-1': 0 })
    // the first of them stops at the start of the film and the others keep their gaps
    const back = dragBlocks(film, ['text-1', 'text-2', 'media-1'], 'media-1', -20, ctxOf())
    expect(startsOf(back)).toMatchObject({ 'text-1': 0, 'text-2': 6, 'media-1': 3 })
    expect(dragBlocks(film, ['text-1'], 'text-1', 0, ctxOf())).toBe(film)
    expect(dragBlocks(film, ['text-1'], 'nope', 3, ctxOf())).toBe(film)
  })

  it('a magnet that catches the lead moves the others by what it caught', () => {
    const moved = dragBlocks(film, ['text-1', 'media-1'], 'text-1', 2.9, ctxOf(1))
    // text-1 would start at 4.9: the magnet (no targets) leaves it, so everything moves by 2.9
    expect(startsOf(moved)).toMatchObject({ 'text-1': 4.9, 'media-1': 7.9 })
  })

  it('ripple delete: what follows in the same lane moves earlier by its length; other lanes and stop-attached items stay', () => {
    const next = rippleRemove(film, ['text-1'])
    expect(next.texts.map((t) => [t.id, t.startS])).toEqual([['text-2', 5], ['text-3', 12]])
    expect(startsOf(next)).toMatchObject({ 'media-1': 5, 'music-1': 0 })
    // two removed in a lane: each gap is closed
    const two = rippleRemove({ ...film, texts: [...film.texts, text('text-4', 20, 1)] }, ['text-1', 'text-2'])
    expect(two.texts.map((t) => [t.id, t.startS])).toEqual([['text-3', 12], ['text-4', 15]])
    expect(rippleRemove(film, ['nope'])).toBe(film)
    expect(rippleRemove(film, ['media-1']).media).toEqual([])
  })

  it('ripple drag of an end: the blocks after it follow the change of its end', () => {
    const dragged = { ...film, texts: film.texts.map((t) => (t.id === 'text-1' ? { ...t, durationS: 5 } : t)) }
    const next = rippleDrag(film, dragged, 'text-1')
    expect(startsOf(next)).toMatchObject({ 'text-1': 2, 'text-2': 10, 'text-3': 12 })
    // shorter: they come back
    const shorter = rippleDrag(film, { ...film, texts: film.texts.map((t) => (t.id === 'text-1' ? { ...t, durationS: 1 } : t)) }, 'text-1')
    expect(startsOf(shorter)).toMatchObject({ 'text-2': 6 })
    // its end did not move, or it is not a timed block: unchanged
    expect(rippleDrag(film, film, 'text-1')).toBe(film)
    expect(rippleDrag(film, dragged, 'nope')).toBe(dragged)
  })

  it('copies blocks and pastes them at the playhead, keeping their gaps, with new ids and no stop', () => {
    const clip = copyBlocks(film, ['text-2', 'media-1', 'text-3'])!
    expect(clip.texts.map((t) => t.id)).toEqual(['text-2', 'text-3'])
    expect(copyBlocks(film, ['stop-1', 'nope'])).toBeNull()
    const pasted = pasteBlocks(film, clip, 20)!
    expect(pasted.ids).toHaveLength(3)
    expect(new Set([...timedBlockIds(pasted.film)]).size).toBe(timedBlockIds(pasted.film).length)
    // earliest (media-1 at 5) goes to 20: text-2 (8) to 23, text-3 (12) to 27
    expect(pasted.ids.map((id) => pasted.film.texts.find((t) => t.id === id)?.startS ?? pasted.film.media.find((m) => m.id === id)?.startS)).toEqual([23, 27, 20])
    expect(pasted.film.texts.every((t) => t.id === 'text-3' || !t.stopId)).toBe(true)
    expect(pasted.film.texts.find((t) => t.id === pasted.ids[1])?.stopId).toBeUndefined()
    // pasting twice does not reuse an id
    const again = pasteBlocks(pasted.film, clip, 40)!
    expect(new Set(timedBlockIds(again.film)).size).toBe(timedBlockIds(again.film).length)
  })

  it('leaves out a medium whose file is gone and a clip synced with the track; nothing left, nothing pasted', () => {
    const clip = copyBlocks({ ...film, media: [photo('media-1', 5, 4), { ...photo('media-2', 6, 2), sync: { atMs: 0, offsetS: 0, follow: true } as never }] }, ['media-1', 'media-2', 'text-1'])!
    expect(pasteBlocks(film, clip, 0)!.ids).toHaveLength(2)
    expect(pasteBlocks(film, clip, 0, (src) => src !== 'src-media-1')!.ids).toHaveLength(1)
    expect(pasteBlocks(film, copyBlocks(film, ['media-1'])!, 0, () => false)).toBeNull()
  })
})
