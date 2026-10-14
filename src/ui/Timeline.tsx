/**
 * Film timeline under the 3D view, in film time (opening and closing included): bar, ruler, and the lanes « Plans »,
 * « Vitesse », a lane per keyed parameter, « Marqueur » (marker keys), « Arrêts », « Textes », « Médias », « Musique »
 * (ARCHITECTURE.md "Film and timeline"). The inspector of the selected block (`filmSelection` in the store) is in the
 * right dock (`FilmInspector`).
 *
 * « Textes » also carries the opening title and the closing card while they are on (`film/cards.ts`: blocks of the
 * overlay settings, whose inner edge sets `title.end` / `end.start`; their settings are in the inspector).
 *
 * A gesture is previewed on the timeline only and committed on release as one undo step. Edits are the pure
 * functions of `film/timeline.ts`; editing a stop writes the generated stops out first (`materializeStops`).
 */
import { errorMessage } from '../core/errors'
import { isExportBusy, useExportStore } from '../export/store'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, UIEvent } from 'react'
import { materializeStops, stopAt, stopCandidates } from '../film/assemble'
import { AUDIO_FILE_EXTENSIONS, fitFilmToMusic, isAudioFile, musicLengthS, readAudio, startMusicPreview, useMusicPreview, waveformPath } from '../film/audio'
import { beatTicksPath } from '../film/beats'
import { CARD_LABELS, END_CARD_ID, TITLE_CARD_ID, cardShown, cardWindow, dragCard, isCardItem, shownCards } from '../film/cards'
import type { CardId } from '../film/cards'
import { buildFilmClock, filmClockFor, filmClockInputFor, junctionInputsFor } from '../film/clock'
import type { FilmClock, FilmClockFor, FilmClockInput } from '../film/clock'
import { hasOwnTransition, isJunctionItem, isStageCardItem, isStageItem, junctionCardOf, stageCardAfterOf, stageCardId, stageCardWindow, stageItemId, stageTrackOf, junctionTrackOf } from '../film/junctions'
import { photoTimeMs } from '../film/exif'
import { withKey } from '../film/markerKeys'
import { dropIndexAt } from '../film/reorder'
import { useMediaStore } from '../film/media'
import { isMediaFile, readMedia } from '../film/video'
import { JUNCTION_KIND_LABELS, STOP_CAMERA_LABELS, clipHasSound } from '../film/model'
import { PARAM_LANE_LABELS, PARAM_SPECS, keysOfParam, paramLanes } from '../film/paramKeys'
import type { FilmParamKey } from '../film/paramKeys'
import { MARKER_FIGURE_LABELS, MARKER_KIND_LABELS } from '../scene/markerSettings'
import type { Film, FilmMedia, FilmSpeed, FilmStop } from '../film/model'
import {
  ZOOM_RANGE,
  addMedia,
  addMusic,
  addSpeed,
  addStop,
  addText,
  centredScrollLeft,
  centredTime,
  clipSyncOffsetS,
  dragFilm,
  rollClosing,
  edgeScrollSpeed,
  fitPxPerS,
  followStops,
  formatFilmTime,
  formatSpeedFactor,
  formatTimecode,
  hasFilmItem,
  photoFilmTime,
  pressedGrip,
  removeFilmItem,
  rulerTicks,
  snapTargets,
  snapper,
  syncClip,
  updateMedia,
  zoomAt,
} from '../film/timeline'
import type { DragContext, Grip, SnapBlock, SnapTarget, TimelineItem } from '../film/timeline'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath, type ElevationProfile } from '../flyover/path'
import { modifiedSettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import type { OverlaySettings } from '../overlay/settings'
import { disableCard, editFilm, getFilmSource, reorderTracks, setAutoStops, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { PLAYBACK_SPEEDS, useAppStore } from '../state/store'
import type { Playback } from '../state/store'
import { formatClock, formatDistance, formatNumber, formatShort } from './format'
import { formatList } from '../i18n/format'
import { t as translate, useT } from '../i18n'
import { Icon } from './icons'
import type { IconName } from './icons'
import { KeyGroup } from './KeyControls'
import type { KeyTarget } from './KeyControls'
import { ModifiedMarker } from './ModifiedMarker'
import { setPreferences, usePreferences } from './preferences'
import { pickFiles } from './projectActions'
import { COMPACT_QUERY, matchesQuery } from './shell'
import { spacePlays, withShortcut } from './shortcuts'
import { showToast } from './toast'
import './cardBlocks.css'
import './markerKeys.css'
import { Button, Checkbox, Popover, Select, Tip } from './primitives'

const SPEEDS = PLAYBACK_SPEEDS
/** « Média » picker: pictures and videos recognised on both targets (the desktop types a file by `mimeTypeOf`). */
const MEDIA_FILTERS = [
  {
    get name() {
      return translate('timeline.filter.media')
    },
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'mp4', 'm4v', 'mov', 'webm'],
  },
]
const MUSIC_FILTERS = [
  {
    get name() {
      return translate('timeline.filter.music')
    },
    extensions: AUDIO_FILE_EXTENSIONS,
  },
]
/** Profile resolution (samples over the track) and drawing height in viewBox units. */
const PROFILE_SAMPLES = 400
const PROFILE_HEIGHT = 100
/** Smallest elevation range drawn full height: a flat track stays flat instead of magnifying GPS noise. */
const PROFILE_MIN_SPAN_M = 100
/** Blank space at both ends of the lanes, so that the edges of the first and last blocks can be grabbed. */
const PAD_PX = 10
const SNAP_PX = 8
/** Distance at which a caught target is let go (hysteresis: it does not flicker at the edge of its pull). */
const RELEASE_PX = 14
/** Narrowest a junction block is drawn, so that a plain cut can still be grabbed. */
const JUNCTION_MIN_PX = 10
/** Pointer travel before a press on a block becomes a drag (a shorter one only selects). */
const DRAG_THRESHOLD_PX = 3
/** Centred timeline (phone): finger travel beyond which a press is a slide (the browser scrolls), not a tap. */
const TAP_SLOP_PX = 8
/** Centred timeline: starting zoom, so that a 4 s stop is wide enough to tap. */
const CENTRED_ZOOM = 4
const NUDGE_S = 1
const FINE_NUDGE_S = 0.1
const WHEEL_ZOOM = 1.2
const BUTTON_ZOOM = 1.5
/** Zoom slider: position 0..ZOOM_SLIDER_STEPS on a logarithmic scale of ZOOM_RANGE. */
const ZOOM_SLIDER_STEPS = 100
const zoomToSlider = (zoom: number) => Math.round((ZOOM_SLIDER_STEPS * Math.log(zoom / ZOOM_RANGE.min)) / Math.log(ZOOM_RANGE.max / ZOOM_RANGE.min))
const sliderToZoom = (v: number) => ZOOM_RANGE.min * (ZOOM_RANGE.max / ZOOM_RANGE.min) ** (v / ZOOM_SLIDER_STEPS)

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']


type Gesture =
  | { kind: 'scrub' }
  /** centred timeline: a press that selects `item` (or seeks, on nothing) if released without sliding */
  | { kind: 'tap'; item: TimelineItem | null; x0: number }
  /** `flightS`: the flight duration of a roll edit (start of the closing dragged) */
  | { kind: 'edit'; item: TimelineItem; grip: Grip; x0: number; scroll0: number; start: Film; ctx: DragContext; result: Film | null; flightS?: number }
  /** the edge of an opening title or closing card: it edits the overlay settings, not the film */
  | { kind: 'card'; item: CardId; grip: Grip; x0: number; scroll0: number; start: OverlaySettings; ctx: DragContext; result: OverlaySettings | null }
  /** a stage block of the « Étapes » lane: lifted and dropped between the others (`to`: its new place), the film is remapped on release */
  | { kind: 'reorder'; item: TimelineItem; x0: number; scroll0: number; to: number; moved: boolean }

/** Edge auto-scroll of a gesture: last pointer position, the handler that replays it, animation frame. */
interface EdgeScroll {
  clientX: number
  altKey: boolean
  apply(clientX: number, altKey: boolean): void
  frame: number
  /** time of the last frame (0 before the first) */
  timeMs: number
  /** fraction of a pixel not scrolled yet (the browser rounds `scrollLeft`) */
  carry: number
}

/** Clock of `film`, a retouch of the film of `source` whose clock input is `input` (same track, pacing and landmarks). */
const clockOfFilm = (source: FilmClockFor, input: FilmClockInput, film: Film) =>
  buildFilmClock({
    ...input,
    ...junctionInputsFor({ ...source, film }),
    opening: film.opening,
    closing: film.closing,
    stops: film.autoStops ? input.stops : film.stops,
    speeds: film.speeds,
    cameraKeys: film.cameraKeys,
    paramKeys: film.paramKeys,
    markerKeys: film.markerKeys,
  })

/** Closed SVG area under the profile at abscissas `xs`, one sub-path per run of known elevations. */
function profileAreaPath(profile: ElevationProfile, xs: readonly number[]): string {
  const { ele, minEle, maxEle } = profile
  const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
  let d = ''
  let runStart = -1
  for (let i = 0; i <= ele.length; i++) {
    const known = i < ele.length && !Number.isNaN(ele[i])
    if (known) {
      const x = xs[i].toFixed(2)
      const y = (PROFILE_HEIGHT * (1 - 0.9 * ((ele[i] - minEle) / span))).toFixed(1)
      d += runStart < 0 ? `M${x} ${PROFILE_HEIGHT}L${x} ${y}` : `L${x} ${y}`
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      d += `L${xs[i - 1].toFixed(2)} ${PROFILE_HEIGHT}Z`
      runStart = -1
    }
  }
  return d
}

interface BarButtonProps {
  icon: IconName
  /** accessible name, also the tooltip unless `tip` is given (with the shortcut) */
  name: string
  tip?: string
  onClick(): void
  disabled?: boolean
  /** the state the button acts on is on (the diamond is filled); the name already says what a click does */
  on?: boolean
}

/** Icon button of the bar: icon only, its name as tooltip and accessible name. */
function BarButton({ icon, name, tip = name, onClick, disabled, on }: BarButtonProps) {
  return (
    <Tip text={tip} side="top">
      <Button variant="icon" className={on ? 'icon-btn--on' : undefined} onClick={onClick} disabled={disabled} aria-label={name}>
        <Icon name={icon} size={18} />
      </Button>
    </Tip>
  )
}

/**
 * « Options » of the film, in a small panel over the bar: automatic stops, « modifié » marker of the film. `sheet`: a
 * bottom sheet (the centred timeline of a phone).
 */
function FilmOptions({
  autoStops,
  onAutoStops,
  onAddMusic,
  reading,
  sheet,
}: {
  autoStops: boolean
  onAutoStops(on: boolean): void
  onAddMusic(): void
  reading: boolean
  sheet: boolean
}) {
  const t = useT()
  const modified = useAppStore((s) => modifiedSettings(s.settings, ['film']).length > 0)
  return (
    <Popover
      label={t('timeline.options.title')}
      placement="top end"
      width={260}
      sheet={sheet}
      trigger={
        <Tip text={t('timeline.options.title')} side="top" align="end">
          <Button variant="icon" aria-label={t('timeline.options.title')}>
            <Icon name="ellipsis" size={18} />
            {modified && (
              <>
                <span className="film-tl__dot" />
                <span className="visually-hidden">{t('common.modified.srOnly')}</span>
              </>
            )}
          </Button>
        </Tip>
      }
    >
      {(close) => (
        <div className="film-tl__menu">
          <p className="film-tl__menu-title">{t('timeline.options.title')}</p>
          <Button
            size="sm"
            disabled={reading}
            onClick={() => {
              close()
              onAddMusic()
            }}
          >
            <Icon name="music" size={16} />
            {t('timeline.options.addMusic')}
          </Button>
          <p className="film-tl__menu-hint">{t('timeline.options.musicHint')}</p>
          <Checkbox checked={autoStops} onChange={onAutoStops}>
            {t('timeline.options.autoStops')}
          </Checkbox>
          <p className="film-tl__menu-hint">{t('timeline.options.autoStopsHint')}</p>
          <ModifiedMarker keys={['film']} label={t('timeline.film')} />
        </div>
      )}
    </Popover>
  )
}

/**
 * On a landscape phone (`COMPACT_QUERY`) the timeline starts folded into a strip and unfolds as a sheet: it folds when
 * a panel or the export drawer opens (`sheetOpen`), and `onUnfold` lets them make room. `centred` (portrait phone): the
 * playhead stays in the middle and the lanes scroll under it, the scroll is the film time; a tap selects a block, a
 * selected block drags as usual, two fingers zoom around the playhead.
 */
export function Timeline({ sheetOpen = false, centred = false, onUnfold }: { sheetOpen?: boolean; centred?: boolean; onUnfold?(): void }) {
  const t = useT()
  const { track, film, durationS, pacing, landmarks, cutsM, stageIds } = useFilmSource()
  const sequence = useFilmSequence()
  const tracks = useAppStore((s) => s.tracks)
  const settingsMarker = useAppStore((s) => s.settings.marker)
  const clock = useFilmClock()
  // the export moves the playhead at every frame: the timeline keeps the playback it had (it would render with each one)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const livePlayback = useAppStore((s) => (exporting ? null : s.playback))
  const [frozenPlayback, setFrozenPlayback] = useState<Playback | null>(null)
  if (livePlayback && frozenPlayback) setFrozenPlayback(null)
  else if (!livePlayback && !frozenPlayback) setFrozenPlayback(useAppStore.getState().playback)
  const { playing, progress, timeS: storedTimeS, speed } = livePlayback ?? frozenPlayback ?? useAppStore.getState().playback
  const timelineClock = usePreferences((s) => s.timelineClock)
  const magnet = usePreferences((s) => s.timelineMagnet)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const setProgress = useAppStore((s) => s.setProgress)
  const setSpeed = useAppStore((s) => s.setSpeed)
  const setSetting = useAppStore((s) => s.setSetting)
  const pictures = useMediaStore((s) => s.table)
  const muted = useMusicPreview((s) => s.muted)
  const id = useId()
  const clipId = `profile-played-${id.replace(/[^\w-]/g, '')}`

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const profile = useMemo(() => (path ? elevationProfile(path, PROFILE_SAMPLES) : undefined), [path])
  const clockSource = useMemo<FilmClockFor>(
    () => ({ track, film, durationS, pacing, landmarks, cutsM, stageIds }),
    [track, film, durationS, pacing, landmarks, cutsM, stageIds],
  )
  const input = useMemo(() => filmClockInputFor(clockSource), [clockSource])
  const candidates = useMemo(() => (track ? stopCandidates({ track, landmarks, pacing }) : []), [track, landmarks, pacing])

  const selected = useAppStore((s) => s.filmSelection)
  const setSelected = useAppStore((s) => s.setFilmSelection)
  /** film being dragged (shown on the timeline only), committed on release */
  const [draft, setDraft] = useState<Film | null>(null)
  /** flight duration while the start of the closing is dragged (a roll edit: the end of the film stays) */
  const [draftFlightS, setDraftFlightS] = useState<number | null>(null)
  const overlay = useAppStore((s) => s.settings.overlay)
  /** overlay being dragged (the edge of a card), shown on the timeline only */
  const [cardDraft, setCardDraft] = useState<OverlaySettings | null>(null)
  /** the targets the gesture in progress has caught, named on the alignment guide */
  const [guides, setGuides] = useState<readonly SnapTarget[]>([])
  /** the stage block being lifted on the « Étapes » lane, how far the pointer took it and the place it would take */
  const [stageDrag, setStageDrag] = useState<{ id: string; dx: number; to: number } | null>(null)
  /** what the screen reader hears when a stage is moved with the keyboard */
  const [announcement, setAnnouncement] = useState('')
  const [zoom, setZoom] = useState<number>(centred ? CENTRED_ZOOM : ZOOM_RANGE.min)
  const [collapsed, setCollapsed] = useState(() => matchesQuery(COMPACT_QUERY) && !centred)
  const [shownSheet, setShownSheet] = useState(sheetOpen)
  if (sheetOpen !== shownSheet) {
    setShownSheet(sheetOpen)
    if (sheetOpen && matchesQuery(COMPACT_QUERY) && !centred) setCollapsed(true)
  }
  const [width, setWidth] = useState(0)
  const [reading, setReading] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  /** the stage block to focus again once the lane is drawn in its new order (a moved node loses the focus) */
  const focusStageRef = useRef<string | null>(null)
  useEffect(() => {
    const item = focusStageRef.current
    focusStageRef.current = null
    if (item) [...(contentRef.current?.querySelectorAll<HTMLElement>('.film-tl__block--stage') ?? [])].find((b) => b.dataset.item === item)?.focus()
  })
  const edgeRef = useRef<EdgeScroll | null>(null)
  /** zoom for the wheel listener */
  const zoomRef = useRef(zoom)
  /** scroll to apply once the zoomed content is laid out */
  const pendingScrollRef = useRef<number | null>(null)
  /** centred timeline: the scroll last set to follow the playhead (its scroll event is not a seek) */
  const syncedScrollRef = useRef<number | null>(null)

  const shownFilm = draft ?? film
  const shownOverlay = cardDraft ?? overlay
  const shownClock = useMemo(() => {
    if (!draft) return clock
    if (draftFlightS === null) return clockOfFilm(clockSource, input, draft)
    const rolled = { ...clockSource, durationS: draftFlightS }
    return clockOfFilm(rolled, filmClockInputFor(rolled), draft)
  }, [draft, draftFlightS, clockSource, input, clock])
  const flightXs = useMemo(() => {
    const n = profile?.ele.length ?? 0
    return Array.from({ length: n }, (_, i) => shownClock.timeAtProgress(i / Math.max(1, n - 1)) - shownClock.openingS)
  }, [profile, shownClock])
  const area = useMemo(() => (profile ? profileAreaPath(profile, flightXs) : ''), [profile, flightXs])

  const hasTrack = track !== undefined
  // the selected block went away (undo, other track, generated stops moved): nothing selected
  const cardGone = isCardItem(selected) && !cardShown(overlay, selected)
  useEffect(() => {
    if (selected !== null && (!track || (isCardItem(selected) ? cardGone : !hasFilmItem(film, clock.stops, selected, stageIds)))) setSelected(null)
  }, [selected, track, film, clock, cardGone, stageIds, setSelected])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    // Ctrl+wheel zooms around the pointer (a passive React listener could not prevent the page zoom)
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      const next = zoomAt(zoomRef.current, e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, e.clientX - el.getBoundingClientRect().left, el.scrollLeft)
      pendingScrollRef.current = next.scrollLeft
      setZoom(next.zoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    // two fingers: pinching zooms around their middle, sliding them scrolls; the first finger's press is dropped
    let pinch: { span: number; mid: number } | null = null
    const measure = (t: TouchList) => ({ span: Math.max(10, Math.abs(t[0].clientX - t[1].clientX)), mid: (t[0].clientX + t[1].clientX) / 2 })
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      pinch = measure(e.touches)
      gestureRef.current = null
      cancelAnimationFrame(edgeRef.current?.frame ?? 0)
      edgeRef.current = null
      setDraft(null)
      setCardDraft(null)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const now = measure(e.touches)
      const scroll = (pendingScrollRef.current ?? el.scrollLeft) + pinch.mid - now.mid
      const next = zoomAt(zoomRef.current, now.span / pinch.span, now.mid - el.getBoundingClientRect().left, scroll)
      // centred: around the playhead, which the scroll follows
      if (!centred) pendingScrollRef.current = next.scrollLeft
      zoomRef.current = next.zoom
      setZoom(next.zoom)
      pinch = now
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [collapsed, hasTrack, centred])

  useLayoutEffect(() => {
    zoomRef.current = zoom
    if (pendingScrollRef.current !== null && scrollerRef.current) scrollerRef.current.scrollLeft = pendingScrollRef.current
    pendingScrollRef.current = null
  }, [zoom])

  // the scale follows the committed film: it does not change while an edge is dragged
  const pxPerS = fitPxPerS(Math.max(0, width - 2 * PAD_PX), clock.totalTime()) * zoom
  const playheadS = Math.min(storedTimeS ?? clock.timeAtProgress(progress), clock.totalTime())
  // centred: the lanes scroll so that the playhead time sits in the middle (after every render: time, zoom, width)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!centred || !el) return
    const target = centredScrollLeft(playheadS, pxPerS)
    if (Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target
    syncedScrollRef.current = el.scrollLeft
  })

  // the music plays along the preview
  useEffect(() => startMusicPreview(), [])

  // Escape drops a lifted stage block back where it was
  const stageLifted = stageDrag !== null
  useEffect(() => {
    if (!stageLifted) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      gestureRef.current = null
      setStageDrag(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stageLifted])

  // no edge auto-scroll left running once the timeline is gone
  useEffect(() => () => cancelAnimationFrame(edgeRef.current?.frame ?? 0), [])

  useEffect(() => {
    // Space plays / pauses, except in a control that uses it (`spacePlays`)
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || !spacePlays(e.target)) return
      const store = useAppStore.getState()
      if (store.tracks.length === 0) return
      e.preventDefault()
      // a button focused by a click would press itself on the key release
      if (e.target instanceof HTMLElement && e.target !== document.body) e.target.blur()
      store.setPlaying(!store.playback.playing)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!track || !path) return null

  const lengthM = track.stats.distanceM
  const total = shownClock.totalTime()
  // centred: half a width of blank at both ends, so that the start and the end reach the middle
  const pad = centred ? width / 2 : PAD_PX
  const xOf = (t: number) => pad + t * pxPerS
  const contentWidth = Math.max(width, Math.ceil(xOf(total) + pad))
  const ele = profile && path.count > 0 ? samplePath(path, progress * path.lengthM).ele : undefined
  // startTime is set as soon as one point has a time: skips the scan of an untimed track
  const time = timelineClock && track.stats.startTime !== undefined && path.count > 0 ? recordedTimeAt(path, progress * path.lengthM) : undefined
  const freeCandidates = candidates.filter((c) => !stopAt(shownClock.stops, c.atM))

  // --- edits -------------------------------------------------------------------------------------------------
  const isStop = (item: TimelineItem) => clock.stops.some((s) => s.id === item)
  /** the cards of the stages « À la suite » that are shown, with their window (the first one gives way to the opening title) */
  const stageCardsOf = (clk: FilmClock, f: Film, ov: OverlaySettings) =>
    !sequence
      ? []
      : [null, ...clk.junctions.map((j) => j.afterTrackId)].flatMap((after, k) => {
          const window = stageCardWindow(clk, f, after)
          if (!window || !junctionCardOf(f, after).enabled || (after === null && cardShown(ov, TITLE_CARD_ID))) return []
          return [{ id: stageCardId(after), ...window, label: t('timeline.stage.label', { n: k + 1, track: sequence.stages[k]?.track.name ?? '' }) }]
        })
  /** the cards and junctions as blocks, for the targets only the component knows */
  const snapBlocks: SnapBlock[] = [
    ...shownCards(overlay).map((card) => ({ id: card, ...cardWindow(overlay, card, clock), label: CARD_LABELS[card] })),
    ...stageCardsOf(clock, film, overlay),
  ]
  const withOwnStops = (f: Film) => materializeStops(f, { track, landmarks, pacing })
  const clockOf = (f: Film) => clockOfFilm(clockSource, input, f)
  /** one undo step; the texts and media attached to a stop follow it (as in `editFilm`) */
  const commit = (edited: Film) => {
    const next = followStops(film, edited, clockOf)
    if (next !== film) getSettingsHistory().transaction(() => setSetting('film', next))
  }
  /** nudges with the arrows (quick changes of the film are merged into one undo step) */
  const change = (fn: (f: Film) => Film, stops: boolean) => {
    const base = stops ? withOwnStops(film) : film
    const next = followStops(base, fn(base), clockOf)
    if (next !== film) setSetting('film', next)
  }
  const dragContext = (item: TimelineItem): DragContext => ({
    clock,
    clockOf: (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops }),
    clockOfSpeeds: (speeds: readonly FilmSpeed[]) => buildFilmClock({ ...input, speeds }),
    lengthM,
    targets: snapTargets(clock, film, candidates.map((c) => c.atM / lengthM), playheadS, item, { ticks: rulerTicks(total, pxPerS), blocks: snapBlocks }),
    targetsM: candidates.map((c) => c.atM),
    snapS: SNAP_PX / pxPerS,
    releaseS: RELEASE_PX / pxPerS,
    snapState: { held: [], hits: [] },
    clockOfFilm: clockOf,
    audioFileS: (src) => pictures[src]?.durationS,
  })
  const remove = (item: TimelineItem) => (isCardItem(item) ? disableCard(item) : editFilm((f) => ({ film: removeFilmItem(f, item), id: null }), { stops: isStop(item) }))
  const addStopAt = (atM: number, patch?: Parameters<typeof addStop>[2]) => editFilm((f) => addStop(f, atM, patch), { stops: true })
  /** a portion twice as fast from the marker (one undo step) */
  const addSpeedAt = (atM: number) => {
    const added = addSpeed(film, atM, lengthM)
    if (added) editFilm(() => added)
    else showToast({ kind: 'error', text: t('timeline.noRoom') })
  }
  /** photos and clips added at the playhead, one after the other (one undo step); offers to place photos on the track */
  const addMediaFiles = async (files: readonly File[]) => {
    const images = files.filter(isMediaFile)
    const others = files.length - images.length
    const unsupported = others > 0 ? ` ${t('timeline.unsupported', { count: others })}` : ''
    if (images.length === 0) {
      showToast({ kind: 'error', text: unsupported.trim() })
      return
    }
    const startS = playheadS
    setReading(true)
    const read: Awaited<ReturnType<typeof readMedia>>[] = []
    const failed: string[] = []
    for (const file of images) {
      try {
        read.push(await readMedia(file, file.name))
      } catch (err) {
        failed.push(t('timeline.fileFailed', { name: file.name, error: errorMessage(err) }))
      }
    }
    setReading(false)
    const errors = failed.length > 0 ? ` ${t('timeline.notAdded', { files: failed.join(' ; ') })}` : ''
    if (read.length === 0) {
      showToast({ kind: 'error', text: `${errors}${unsupported}`.trim() })
      return
    }
    const srcs = useMediaStore.getState().add(read.map((r) => r.asset))
    const added = addMedia(
      useAppStore.getState().settings.film,
      startS,
      srcs.map((src, k) => ({ src, videoS: read[k].asset.durationS })),
    )
    commit(added.film)
    setSelected(added.ids[0])
    const placements = added.ids.flatMap((photoId, k) => {
      const exif = read[k].exif
      const t = exif ? photoFilmTime(path, clock, { lon: exif.lon, lat: exif.lat, timeMs: photoTimeMs(exif) }) : undefined
      return t === undefined ? [] : [{ id: photoId, startS: t }]
    })
    // clips recorded during the outing (camera clock possibly set to local time: whole hours)
    const syncs = added.ids.flatMap((clipId, k) => {
      const { recordedMs, durationS } = read[k].asset
      const offsetS = recordedMs === undefined || durationS === undefined ? undefined : clipSyncOffsetS(path, recordedMs, durationS)
      return offsetS === undefined ? [] : [{ id: clipId, sync: { startMs: recordedMs!, offsetS, follow: false }, fileS: durationS! }]
    })
    const videos = read.filter((r) => r.asset.durationS !== undefined).length
    const photos = read.length - videos
    const n = placements.length
    const located =
      n === 0
        ? ''
        : n === 1
          ? ` ${t(photos === 1 ? 'timeline.located.single' : 'timeline.located.oneOf')}`
          : ` ${t('timeline.located.many', { count: n })}`
    const filmed =
      syncs.length === 0
        ? ''
        : syncs.length === 1
          ? ` ${t(videos === 1 ? 'timeline.filmed.single' : 'timeline.filmed.oneOf')}`
          : ` ${t('timeline.filmed.many', { count: syncs.length })}`
    /** photos placed, clips synced with the film clock of the moment (one undo step) */
    const place = () =>
      editFilm((f) => {
        const clockNow = filmClockFor(getFilmSource())
        const placed = placements.reduce((g, p) => updateMedia(g, p.id, { startS: p.startS }), f)
        return { film: syncs.reduce((g, c) => syncClip(g, c.id, c.sync, path, clockNow, c.fileS) ?? g, placed) }
      })
    const what = formatList([photos > 0 ? t('timeline.photoCount', { count: photos }) : '', videos > 0 ? t('timeline.videoCount', { count: videos }) : ''].filter(Boolean))
    showToast({
      kind: errors || unsupported ? 'info' : 'success',
      text: `${t('timeline.mediaAdded', { count: read.length, what })}${located}${filmed}${errors}${unsupported}`,
      action: n + syncs.length > 0 ? { label: n > 0 ? t('timeline.placeOnRoute') : t('timeline.syncWithRoute'), run: place } : undefined,
    })
  }
  /** sound files added after the music already there (one undo step); offers to fit the film to the music */
  const addMusicFiles = async (files: readonly File[]) => {
    setReading(true)
    const read: Awaited<ReturnType<typeof readAudio>>[] = []
    const failed: string[] = []
    for (const file of files) {
      try {
        read.push(await readAudio(file, file.name))
      } catch (err) {
        failed.push(t('timeline.fileFailed', { name: file.name, error: errorMessage(err) }))
      }
    }
    setReading(false)
    const errors = failed.length > 0 ? ` ${t('timeline.notAdded', { files: failed.join(' ; ') })}` : ''
    if (read.length === 0) {
      showToast({ kind: 'error', text: errors.trim() })
      return
    }
    const first = useAppStore.getState().settings.film.audio.length === 0
    const srcs = useMediaStore.getState().add(read.map((r) => r.asset))
    const added = addMusic(
      useAppStore.getState().settings.film,
      srcs.map((src, k) => ({ src, fileS: read[k].asset.durationS ?? 0 })),
    )
    commit(added.film)
    setSelected(added.ids[0])
    showToast({
      kind: errors ? 'info' : 'success',
      text: `${t(first ? 'timeline.musicAdded.first' : 'timeline.musicAdded.after', { count: read.length })}${errors}`,
      action: { label: t('timeline.fitFilm'), run: () => showToast(fitFilmToMusic()) },
    })
  }
  const pickMusic = () =>
    void pickFiles({ filters: MUSIC_FILTERS, multiple: true }).then((files) => (files.length > 0 ? addMusicFiles(files) : undefined))

  // --- pointer -----------------------------------------------------------------------------------------------
  const timeAt = (clientX: number) => (clientX - (contentRef.current?.getBoundingClientRect().left ?? 0) - pad) / pxPerS
  const seek = (t: number) => {
    const end = clock.totalTime()
    const c = Math.min(end, Math.max(0, t))
    setProgress(clock.progressAtTime(c), c < end ? c : null)
  }
  /** where each stage stands on the clock (from the end of the junction before it to the start of the one after it) */
  const stageSpans = (clk: FilmClock) =>
    (sequence?.stages ?? []).map((stage, k) => ({
      id: stage.track.id,
      startS: k === 0 ? clk.openingS : (clk.junctions[k - 1]?.endS ?? clk.openingS),
      endS: clk.junctions[k]?.startS ?? clk.openingS + clk.flightS,
    }))
  /** a keyframe pressed and released without dragging: the playhead jumps to it */
  const jumpToKey = (item: TimelineItem) => {
    const key = clock.cameraKeys.find((k) => k.id === item) ?? clock.paramKeys.find((k) => k.id === item) ?? clock.markerKeys.find((k) => k.id === item)
    if (key) return seek(key.timeS)
    // a stage, a junction or a stage card: its start (the cut for a junction)
    if (isStageItem(item)) {
      const k = sequence?.stages.findIndex((s) => s.track.id === stageTrackOf(item)) ?? -1
      if (k >= 0) seek(k === 0 ? clock.openingS : clock.junctions[k - 1].endS)
    } else if (isJunctionItem(item)) {
      const junction = clock.junctions.find((j) => j.afterTrackId === junctionTrackOf(item))
      if (junction) seek(junction.holdStartS)
    } else if (isStageCardItem(item)) {
      const window = stageCardWindow(clock, film, stageCardAfterOf(item))
      if (window) seek(window.startS)
    }
  }
  /** centred: a press that becomes a tap on release (no capture: a slide scrolls the lanes, the browser cancels it) */
  const startTap = (e: PointerEvent<HTMLElement>, item: TimelineItem | null) => {
    if (e.button !== 0 || !e.isPrimary) return
    e.stopPropagation()
    gestureRef.current = { kind: 'tap', item, x0: e.clientX }
  }
  const onContentPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (centred) return startTap(e, null)
    // a second finger is a pinch (touch listeners above)
    if (e.button !== 0 || !e.isPrimary) return
    e.currentTarget.setPointerCapture(e.pointerId)
    gestureRef.current = { kind: 'scrub' }
    seek(timeAt(e.clientX))
  }
  const startEdit = (e: PointerEvent<HTMLElement>, item: TimelineItem, grip: Grip) => {
    // centred: a block is selected by a tap first, a slide over it scrolls the lanes (a stage is never dragged there: the list reorders)
    if (centred && (selected !== item || isStageItem(item))) return startTap(e, item)
    if (e.button !== 0 || !e.isPrimary) return
    e.stopPropagation()
    setSelected(item)
    contentRef.current?.setPointerCapture(e.pointerId)
    const scroll0 = scrollerRef.current?.scrollLeft ?? 0
    if (isStageItem(item) && grip === 'move') {
      gestureRef.current = { kind: 'reorder', item, x0: e.clientX, scroll0, to: -1, moved: false }
      return
    }
    if (isCardItem(item)) {
      gestureRef.current = { kind: 'card', item, grip, x0: e.clientX, scroll0, start: overlay, ctx: dragContext(item), result: null }
      return
    }
    const start = isStop(item) ? withOwnStops(film) : film
    gestureRef.current = { kind: 'edit', item, grip, x0: e.clientX, scroll0, start, ctx: dragContext(item), result: null }
  }
  /** a press on an edge grip, or past it on a narrow block (`pressedGrip`) */
  const startGrip = (e: PointerEvent<HTMLElement>, item: TimelineItem, grip: Grip, grips: readonly Grip[]) => {
    const rect = e.currentTarget.parentElement?.getBoundingClientRect()
    startEdit(e, item, rect ? pressedGrip(grip, e.clientX - rect.left, rect.width, grips) : grip)
  }
  /** the gesture at pointer `clientX` (the content may have scrolled under the pointer since the press) */
  const applyPointer = (clientX: number, altKey: boolean) => {
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'scrub') return seek(timeAt(clientX))
    if (g.kind === 'tap') {
      if (Math.abs(clientX - g.x0) > TAP_SLOP_PX) gestureRef.current = null
      return
    }
    const dx = clientX - g.x0 + (scrollerRef.current?.scrollLeft ?? 0) - g.scroll0
    if (g.kind === 'reorder') {
      if (!g.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      g.moved = true
      // the place among the other stages: how many of them the pointer has passed
      const spans = stageSpans(clock).filter((span) => span.id !== stageTrackOf(g.item))
      g.to = dropIndexAt(
        spans.map((span) => (span.startS + span.endS) / 2),
        timeAt(clientX),
      )
      setStageDrag((was) => (was && was.dx === dx && was.to === g.to ? was : { id: stageTrackOf(g.item), dx, to: g.to }))
      return
    }
    if (!g.result && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    // the magnet, inverted while Alt is held; what the last move caught is held a little longer, this one's is shown
    const ctx = magnet !== altKey ? g.ctx : { ...g.ctx, snapS: 0 }
    const state = g.ctx.snapState
    if (state) {
      state.held = state.hits
      state.hits = []
    }
    if (g.kind === 'card') {
      g.result = dragCard(g.start, g.item, g.grip, dx / pxPerS, clock, snapper(ctx))
      setCardDraft(g.result)
    } else {
      let dragged = dragFilm(g.start, g.item, g.grip, dx / pxPerS, ctx)
      if (g.item === 'closing' && g.grip === 'start') {
        const rolled = rollClosing(g.start, dragged, durationS)
        dragged = rolled.film
        g.flightS = rolled.flightS
        setDraftFlightS(rolled.flightS)
      }
      g.result = followStops(g.start, dragged, clockOf)
      setDraft(g.result)
    }
    const hits = state?.hits ?? []
    setGuides((was) => (was.length === hits.length && was.every((t, i) => t === hits[i]) ? was : hits))
  }
  /**
   * Keeps the pointer of the gesture for the edge auto-scroll: near an edge of the zoomed timeline it scrolls (faster
   * closer to the edge, `edgeScrollSpeed`) and replays the gesture at the same pointer, until the release.
   */
  const followEdge = (clientX: number, altKey: boolean) => {
    const edge = edgeRef.current
    if (edge) {
      Object.assign(edge, { clientX, altKey, apply: applyPointer })
      return
    }
    const tick = (now: number) => {
      const current = edgeRef.current
      const el = scrollerRef.current
      if (!current || !el || !gestureRef.current) {
        edgeRef.current = null
        return
      }
      // first frame: no time elapsed yet
      const dt = current.timeMs > 0 ? Math.min(0.05, Math.max(0, now - current.timeMs) / 1000) : 0
      current.timeMs = now
      const rect = el.getBoundingClientRect()
      const speed = edgeScrollSpeed(current.clientX, rect.left, rect.right)
      if (speed !== 0 && el.scrollWidth > el.clientWidth) {
        const before = el.scrollLeft
        const target = before + speed * dt + current.carry
        el.scrollLeft = target
        current.carry = Math.max(-1, Math.min(1, target - el.scrollLeft))
        if (el.scrollLeft !== before) current.apply(current.clientX, current.altKey)
      } else {
        current.carry = 0
      }
      current.frame = requestAnimationFrame(tick)
    }
    edgeRef.current = { clientX, altKey, apply: applyPointer, timeMs: 0, carry: 0, frame: requestAnimationFrame(tick) }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    if (!g) return
    applyPointer(e.clientX, e.altKey)
    // a press that only selects a block (not dragged yet) does not scroll
    if (g.kind === 'scrub' || ((g.kind === 'edit' || g.kind === 'card') && g.result) || (g.kind === 'reorder' && g.moved)) followEdge(e.clientX, e.altKey)
  }
  const endGesture = (e: PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    gestureRef.current = null
    cancelAnimationFrame(edgeRef.current?.frame ?? 0)
    edgeRef.current = null
    if (g?.kind === 'edit' && e.type === 'pointerup') {
      const flightS = g.flightS
      if (g.result && flightS !== undefined && flightS !== durationS) {
        const result = g.result
        // one undo step for the flight and the film
        getSettingsHistory().transaction(() => {
          setSetting('flyoverDurationS', flightS)
          setSetting('film', followStops(film, result, clockOf))
        })
      } else if (g.result) commit(g.result)
      else jumpToKey(g.item)
    }
    if (g?.kind === 'reorder' && e.type === 'pointerup') {
      if (!g.moved) jumpToKey(g.item)
      else if (reorderTracks(stageTrackOf(g.item), g.to)) setSelected(g.item)
    }
    setDraftFlightS(null)
    if (g?.kind === 'card' && e.type === 'pointerup' && g.result && g.result !== g.start) {
      const result = g.result
      getSettingsHistory().transaction(() => setSetting('overlay', result))
    }
    if (g?.kind === 'tap' && e.type === 'pointerup') {
      if (g.item === null) seek(timeAt(e.clientX))
      else {
        setSelected(g.item)
        jumpToKey(g.item)
      }
    }
    setDraft(null)
    setCardDraft(null)
    setGuides([])
    setStageDrag(null)
  }
  /** centred: a scroll by the finger (or the wheel) moves the film time; the one that follows the playhead does not */
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const left = e.currentTarget.scrollLeft
    if (syncedScrollRef.current !== null && Math.abs(left - syncedScrollRef.current) < 1) return
    syncedScrollRef.current = left
    seek(centredTime(left, pxPerS, clock.totalTime()))
  }

  // --- keyboard ----------------------------------------------------------------------------------------------
  const onBlockKeyDown = (e: KeyboardEvent<HTMLElement>, item: TimelineItem) => {
    if (isStageItem(item) && e.altKey && !e.ctrlKey && !e.metaKey && ARROWS.includes(e.key)) {
      // Alt + arrows: the stage one place earlier or later
      const k = sequence?.stages.findIndex((stage) => stage.track.id === stageTrackOf(item)) ?? -1
      const to = k + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)
      if (k >= 0 && reorderTracks(stageTrackOf(item), to)) {
        setAnnouncement(t('timeline.announce.stageMoved', { name: sequence!.stages[k].track.name, position: to + 1, total: sequence!.stages.length }))
        focusStageRef.current = item
      }
      e.preventDefault()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      remove(item)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
      const step = (e.shiftKey ? FINE_NUDGE_S : NUDGE_S) * (e.key === 'ArrowLeft' ? -1 : 1)
      const grip: Grip =
        item === 'closing' || item === END_CARD_ID
          ? 'start'
          : item === 'opening' || item === TITLE_CARD_ID || isJunctionItem(item) || isStageCardItem(item) || isStageItem(item)
            ? 'end'
            : 'move'
      if (isCardItem(item)) {
        const next = dragCard(overlay, item, grip, step, clock)
        if (next !== overlay) setSetting('overlay', next)
      } else {
        change((f) => dragFilm(f, item, grip, step, { ...dragContext(item), snapS: 0 }), isStop(item))
      }
    } else {
      return
    }
    e.preventDefault()
  }
  const onRulerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }
    if (e.key === 'Home') seek(0)
    else if (e.key === 'End') seek(clock.totalTime())
    else if (e.key in steps) seek(playheadS + steps[e.key] * (e.shiftKey ? 5 : 1))
    else return
    e.preventDefault()
  }
  const zoomBy = (factor: number) => {
    const el = scrollerRef.current
    // keep the playhead in place
    const next = zoomAt(zoom, factor, el ? xOf(playheadS) - el.scrollLeft : 0, el?.scrollLeft ?? 0)
    pendingScrollRef.current = next.scrollLeft
    setZoom(next.zoom)
  }
  /** the whole film in the width of the timeline */
  const fitZoom = () => {
    pendingScrollRef.current = 0
    setZoom(ZOOM_RANGE.min)
  }

  // --- blocks ------------------------------------------------------------------------------------------------
  const liftedItem = stageDrag ? stageItemId(stageDrag.id) : null
  const block = (
    item: TimelineItem,
    startS: number,
    endS: number,
    label: string,
    description: string,
    className: string,
    grips: Grip[],
    thumb?: string,
    icon?: IconName,
    extra?: ReactNode,
    minPx = 0,
  ) => (
    <div
      key={item}
      role="button"
      tabIndex={0}
      aria-pressed={selected === item}
      aria-label={t('timeline.blockRange', { description, from: formatFilmTime(startS), to: formatFilmTime(endS) })}
      title={label}
      data-item={item}
      data-testid="timeline-block"
      data-lifted={item === liftedItem ? '' : undefined}
      className={`film-tl__block ${className}${selected === item ? ' film-tl__block--selected' : ''}${item === liftedItem ? ' film-tl__block--lifted' : ''}`}
      style={{
        left: xOf(startS) - Math.max(0, minPx - (endS - startS) * pxPerS) / 2,
        width: Math.max(minPx, (endS - startS) * pxPerS),
        ...(item === liftedItem && stageDrag ? { transform: `translateX(${stageDrag.dx}px)` } : {}),
      }}
      onPointerDown={(e) => {
        if (centred && selected !== item) return startTap(e, item)
        if (grips.includes('move')) return startEdit(e, item, 'move')
        // a shot: select it and scrub
        e.stopPropagation()
        setSelected(item)
        onContentPointerDown(e)
      }}
      onFocus={() => setSelected(item)}
      onKeyDown={(e) => onBlockKeyDown(e, item)}
    >
      {grips.includes('start') && <span className="film-tl__grip film-tl__grip--start" onPointerDown={(e) => startGrip(e, item, 'start', grips)} />}
      {extra}
      {thumb && <img className="film-tl__thumb" src={thumb} alt="" draggable={false} />}
      {icon && (
        <span className="film-tl__icon">
          <Icon name={icon} size={12} />
        </span>
      )}
      <span className="film-tl__label">{label}</span>
      {grips.includes('end') && <span className="film-tl__grip film-tl__grip--end" onPointerDown={(e) => startGrip(e, item, 'end', grips)} />}
    </div>
  )
  const opening = shownFilm.opening
  const closing = shownFilm.closing
  const flightStart = shownClock.openingS
  const flightEnd = flightStart + shownClock.flightS
  const ticks = rulerTicks(total, pxPerS)
  /** the lanes: always « Plans » and « Vitesse », a lane per keyed parameter, « Marqueur » with marker keys, the rest */
  const lanes: { name: string; keys?: KeyTarget }[] = [
    ...(sequence ? [{ name: t('timeline.lane.stages') }] : []),
    { name: t('timeline.lane.shots'), keys: { kind: 'camera' } },
    { name: PARAM_LANE_LABELS.speed, keys: { kind: 'param', param: 'speed' } },
    ...paramLanes(shownClock).map((param) => ({ name: PARAM_LANE_LABELS[param] })),
    ...(shownClock.markerKeys.length > 0 ? [{ name: t('timeline.lane.marker') }] : []),
    ...[t('timeline.lane.holds'), t('timeline.lane.texts'), t('timeline.lane.media'), t('timeline.lane.music')].map((name) => ({ name })),
  ]
  /** « Étapes »: a block per stage, between them the junction (a cut, a fade held for its hold, a night) */
  const stageBlocks = () =>
    (sequence?.stages ?? []).flatMap((stage, k) => {
      const before = shownClock.junctions[k - 1]
      const after = shownClock.junctions[k]
      const color = tracks.find((t) => t.id === stage.track.id)?.color ?? stage.track.color
      const name = t('timeline.stage.name', { n: k + 1, track: stage.track.name, distance: formatDistance(stage.endM - stage.startM) })
      const blocks = [
        block(
          stageItemId(stage.track.id),
          before ? before.endS : flightStart,
          after ? after.startS : flightEnd,
          name,
          t('timeline.stage.description', { n: k + 1, track: stage.track.name }),
          'film-tl__block--stage',
          ['move', 'end'],
          undefined,
          undefined,
          <span className="film-tl__stage-band" style={{ background: color }} />,
        ),
      ]
      if (after) {
        const fade = after.kind === 'fondu-noir' || after.kind === 'fondu-blanc'
        const label = fade ? `${JUNCTION_KIND_LABELS[after.kind]} · ${formatNumber(after.holdS, 1)} s` : JUNCTION_KIND_LABELS[after.kind]
        const own = hasOwnTransition(shownFilm, after.afterTrackId) ? '' : t('timeline.junction.byDefault')
        blocks.push(
          block(
            after.id,
            after.startS,
            after.endS,
            label,
            t('timeline.junction.description', { n: k + 1, label, own }),
            `film-tl__block--junction film-tl__block--junction-${after.kind}`,
            fade ? ['move', 'end'] : ['move'],
            undefined,
            undefined,
            undefined,
            JUNCTION_MIN_PX,
          ),
        )
      }
      return blocks
    })
  /** a parameter key ◆ on its lane: click goes to it, drag moves it, Delete removes it */
  const paramKeyDot = (k: FilmParamKey & { timeS: number }) => {
    const spec = PARAM_SPECS[k.param]
    const what = `${spec.label} ${spec.format(k.value)}`
    return (
      <div
        key={k.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected === k.id}
        aria-label={t('timeline.key.settingAria', { what, distance: formatDistance(k.atM), time: formatFilmTime(k.timeS) })}
        title={t('timeline.key.hint', { what })}
        data-testid="timeline-key"
        className={`film-tl__key${selected === k.id ? ' film-tl__key--selected' : ''}`}
        style={{ left: xOf(k.timeS) }}
        onPointerDown={(e) => startEdit(e, k.id, 'move')}
        onFocus={() => setSelected(k.id)}
        onKeyDown={(e) => onBlockKeyDown(e, k.id)}
      />
    )
  }
  const mediaLabel = (m: FilmMedia) => m.caption?.trim() || pictures[m.src]?.name || (m.kind === 'video' ? t('film.snap.video') : t('film.snap.photo'))

  return (
    <div
      data-testid="timeline"
      data-centred={centred || undefined}
      className={`film-tl${collapsed ? ' film-tl--folded' : ''}${centred ? ' film-tl--centred' : ''}`}
      role="group"
      aria-label={t('timeline.aria', { name: track.name })}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        const files = Array.from(e.dataTransfer.files)
        const sounds = files.filter(isAudioFile)
        const others = files.filter((f) => !isAudioFile(f))
        // one after the other: both read files and show a message
        void (async () => {
          if (sounds.length > 0) await addMusicFiles(sounds)
          if (others.length > 0) await addMediaFiles(others)
        })()
      }}
    >
      <div className="film-tl__bar" data-testid="timeline-bar">
        <Tip text={withShortcut(playing ? t('timeline.bar.pauseTip') : t('timeline.bar.playTip'), 'play')} side="top" align="start">
          <Button
            variant="icon"
            className="film-tl__play"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? t('timeline.bar.pause') : t('timeline.bar.play')}
          >
            <Icon name={playing ? 'pause' : 'play'} size={16} />
          </Button>
        </Tip>
        <BarButton
          icon="square"
          name={t('timeline.bar.stop')}
          onClick={() => {
            setPlaying(false)
            seek(0)
          }}
        />
        {/* fixed widths (tabular digits): a longer value never wraps the bar, so the view never resizes while it plays */}
        <span className="film-tl__time">
          <strong data-testid="timeline-time">{formatTimecode(playheadS, true)}</strong> / {formatTimecode(clock.totalTime())}
        </span>
        <span className="film-tl__readout">
          <span className="film-tl__value" style={{ minWidth: `${formatDistance(lengthM).length + 1}ch` }}>
            {formatDistance(progress * lengthM)}
          </span>{' '}
          / {formatDistance(lengthM)}
          {ele !== undefined && profile && (
            <>
              {' · '}
              <span className="visually-hidden">{t('timeline.bar.elevation')}</span>
              <span className="film-tl__value" style={{ minWidth: `${formatNumber(profile.maxEle).length + 1}ch` }}>
                {formatNumber(ele)}
              </span>{' '}
              m
            </>
          )}
        </span>
        {/* apart from the readout, which a narrow timeline hides: the clock was asked for in « Réglages » */}
        {time !== undefined && (
          <span className="film-tl__clockout">
            <span className="visually-hidden">{t('timeline.bar.recordedTime')}</span>
            <time className="film-tl__value film-tl__clock" data-testid="timeline-clock" dateTime={new Date(time).toISOString()}>
              {formatClock(time)}
            </time>
          </span>
        )}
        <span className="film-tl__spacer" />
        {/* a row of its own on a phone, which scrolls sideways */}
        <div className="film-tl__tools" data-testid="timeline-tools">
          {/* no lane headers on a centred timeline: the groups of the camera and speed keys lead the row */}
          {centred && (
            <>
              <span className="film-tl__keys-label">{t('timeline.lane.shots')}</span>
              <KeyGroup target={{ kind: 'camera' }} clock={clock} timeS={playheadS} disabled={!hasTrack} />
              <span className="film-tl__keys-label">{PARAM_LANE_LABELS.speed}</span>
              <KeyGroup target={{ kind: 'param', param: 'speed' }} clock={clock} timeS={playheadS} disabled={!hasTrack} />
            </>
          )}
          <BarButton
            icon="map-pin"
            name={t('timeline.bar.addHold')}
            tip={withShortcut(t('timeline.bar.addHold'), 'add-stop')}
            onClick={() => addStopAt(Math.round(progress * lengthM))}
          />
          {freeCandidates.length > 0 && (
            <Select
              look="bar"
              aria-label={t('timeline.bar.addHoldAtHighlight')}
              value=""
              options={[
                { value: '', label: t('timeline.bar.holdAtHighlight'), disabled: true },
                ...freeCandidates.map((c, i) => ({ value: String(i), label: `${c.label} · ${formatDistance(c.atM)}` })),
              ]}
              onChange={(index) => {
                const c = freeCandidates[Number(index)]
                if (c) addStopAt(c.atM, { label: c.label, source: c.source })
              }}
            />
          )}
          <BarButton
            icon="gauge"
            name={t('timeline.bar.addSpeed')}
            tip={t('timeline.bar.addSpeedTip')}
            onClick={() => addSpeedAt(Math.round(progress * lengthM))}
          />
          <BarButton
            icon="type"
            name={t('timeline.bar.addText')}
            tip={withShortcut(t('timeline.bar.addText'), 'add-text')}
            onClick={() => editFilm((f) => addText(f, playheadS))}
          />
          <BarButton
            icon="image"
            name={reading ? t('timeline.bar.readingFiles') : t('timeline.bar.addMedia')}
            tip={t('timeline.bar.addMediaTip')}
            onClick={() =>
              void pickFiles({ filters: MEDIA_FILTERS, multiple: true }).then((files) => (files.length > 0 ? addMediaFiles(files) : undefined))
            }
            disabled={reading}
          />
          <span className="film-tl__sep" aria-hidden="true" />
          {(film.audio.length > 0 || film.media.some(clipHasSound)) && (
            <BarButton
              icon={muted ? 'volume-x' : 'volume-2'}
              name={muted ? t('timeline.bar.unmute') : t('timeline.bar.mute')}
              tip={muted ? t('timeline.bar.unmuteTip') : t('timeline.bar.muteTip')}
              onClick={() => useMusicPreview.getState().setMuted(!muted)}
            />
          )}
          <Select
            look="bar"
            aria-label={t('timeline.bar.speed')}
            value={speed}
            options={SPEEDS.map((value) => ({ value, label: `×${formatNumber(value, value % 1 === 0 ? 0 : 1)}` }))}
            onChange={setSpeed}
          />
          <div className="film-tl__zoom" role="group" aria-label={t('timeline.zoom.group')}>
            <BarButton
              icon="zoom-out"
              name={t('timeline.zoom.out')}
              tip={withShortcut(t('timeline.zoom.out'), 'zoom')}
              onClick={() => zoomBy(1 / BUTTON_ZOOM)}
              disabled={zoom <= ZOOM_RANGE.min}
            />
            <input
              className="film-tl__zoom-range"
              type="range"
              min={0}
              max={ZOOM_SLIDER_STEPS}
              step={1}
              value={zoomToSlider(zoom)}
              aria-label={t('timeline.zoom.slider')}
              aria-valuetext={`×${formatNumber(zoom, 1)}`}
              onChange={(e) => zoomBy(sliderToZoom(Number(e.currentTarget.value)) / zoom)}
            />
            <BarButton
              icon="zoom-in"
              name={t('timeline.zoom.in')}
              tip={withShortcut(t('timeline.zoom.in'), 'zoom')}
              onClick={() => zoomBy(BUTTON_ZOOM)}
              disabled={zoom >= ZOOM_RANGE.max}
            />
            <BarButton icon="move-horizontal" name={t('timeline.zoom.fit')} tip={t('timeline.zoom.fitTip')} onClick={fitZoom} disabled={zoom <= ZOOM_RANGE.min} />
          </div>
          <BarButton
            icon="magnet"
            name={magnet ? t('timeline.magnet.off') : t('timeline.magnet.on')}
            tip={magnet ? t('timeline.magnet.onTip') : t('timeline.magnet.offTip')}
            on={magnet}
            onClick={() => setPreferences({ timelineMagnet: !magnet })}
          />
          <FilmOptions autoStops={film.autoStops} onAutoStops={setAutoStops} onAddMusic={pickMusic} reading={reading} sheet={centred} />
        </div>
        <Tip text={collapsed ? t('timeline.fold.unfold') : t('timeline.fold.fold')} side="top" align="end">
          <Button
            variant="icon"
            className="film-tl__fold"
            onClick={() => {
              if (collapsed) onUnfold?.()
              setCollapsed(!collapsed)
            }}
            aria-expanded={!collapsed}
            aria-controls={`${id}-lanes`}
            aria-label={collapsed ? t('timeline.fold.unfold') : t('timeline.fold.fold')}
          >
            <Icon name={collapsed ? 'panel-bottom-open' : 'panel-bottom-close'} size={18} />
          </Button>
        </Tip>
      </div>

      {!collapsed && (
        <div className="film-tl__body" id={`${id}-lanes`}>
          <div className="film-tl__heads" data-testid="timeline-heads">
            <div className="film-tl__head film-tl__head--ruler" data-testid="timeline-head" />
            {/* the lanes carry the same names; the camera and speed keys have their ◀ ◇ ▶ under theirs */}
            {lanes.map((lane) =>
              lane.keys ? (
                <div key={lane.name} className="film-tl__head film-tl__head--keyed" data-testid="timeline-head">
                  <span>{lane.name}</span>
                  <KeyGroup target={lane.keys} clock={clock} timeS={playheadS} disabled={!hasTrack} />
                </div>
              ) : (
                <div key={lane.name} className="film-tl__head" data-testid="timeline-head" aria-hidden="true">
                  <span>{lane.name}</span>
                </div>
              ),
            )}
          </div>
          <div
            className="film-tl__scroller"
            data-testid="timeline-scroller"
            ref={scrollerRef}
            onScroll={centred ? onScroll : undefined}
            // centred: a touch stops the playback, else the lanes would follow the playhead under the finger
            onPointerDownCapture={centred && playing ? () => setPlaying(false) : undefined}
          >
            <div
              ref={contentRef}
              className="film-tl__content"
              style={{ width: contentWidth }}
              onPointerDown={onContentPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            >
              <div
                className="film-tl__ruler"
                role="slider"
                tabIndex={0}
                aria-label={t('timeline.ruler.label')}
                aria-valuemin={0}
                aria-valuemax={Math.round(clock.totalTime())}
                aria-valuenow={Math.round(playheadS)}
                aria-valuetext={t('timeline.ruler.valueText', { time: formatFilmTime(playheadS), total: formatFilmTime(clock.totalTime()) })}
                onKeyDown={onRulerKeyDown}
              >
                {ticks.map((t) => (
                  <span key={t} className="film-tl__tick" style={{ left: xOf(t) }}>
                    {formatFilmTime(t)}
                  </span>
                ))}
              </div>

              {sequence && (
                <div data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={t('timeline.lane.stages')}>
                  {stageBlocks()}
                </div>
              )}

              <div data-testid="timeline-lane" className="film-tl__lane film-tl__lane--keyed" role="group" aria-label={t('timeline.lane.shots')}>
                {block(
                  'opening',
                  0,
                  flightStart,
                  opening.style === 'aucune' ? '' : t('timeline.shot.opening'),
                  opening.style === 'aucune' ? t('timeline.shot.openingNone') : t('timeline.shot.opening'),
                  `film-tl__block--shot${opening.style === 'aucune' ? ' film-tl__block--none' : ''}`,
                  opening.style === 'aucune' ? [] : ['end'],
                )}
                <div className="film-tl__flight" style={{ left: xOf(flightStart), width: (flightEnd - flightStart) * pxPerS }} aria-hidden="true">
                  {profile && shownClock.flightS > 0 && (
                    <svg viewBox={`0 0 ${shownClock.flightS} ${PROFILE_HEIGHT}`} preserveAspectRatio="none">
                      <clipPath id={clipId}>
                        <rect width={Math.max(0, playheadS - flightStart)} height={PROFILE_HEIGHT} />
                      </clipPath>
                      <path className="film-tl__profile-area" d={area} />
                      <path className="film-tl__profile-played" d={area} clipPath={`url(#${clipId})`} />
                    </svg>
                  )}
                  {/* the stops inside the flight: where the flyover holds */}
                  {shownClock.stops.map((s) => (
                    <span
                      key={s.id}
                      className={`film-tl__flight-stop${s.id === selected ? ' film-tl__flight-stop--selected' : ''}`}
                      style={{ left: (s.startS - flightStart) * pxPerS, width: (s.endS - s.startS) * pxPerS }}
                    />
                  ))}
                  {sequence ? (
                    // « À la suite »: one segment per stage, from cut to cut
                    sequence.stages.map((stage, k) => {
                      const startS = k === 0 ? flightStart : (shownClock.cuts[k - 1]?.timeS ?? flightStart)
                      const endS = shownClock.cuts[k]?.timeS ?? flightEnd
                      const color = tracks.find((t) => t.id === stage.track.id)?.color ?? stage.track.color
                      return (
                        <span
                          key={stage.track.id}
                          className="film-tl__stage"
                          style={{ left: (startS - flightStart) * pxPerS, width: (endS - startS) * pxPerS, ['--stage-color' as string]: color }}
                        />
                      )
                    })
                  ) : (
                    <span className="film-tl__label">{t('timeline.flight.label', { distance: formatDistance(lengthM) })}</span>
                  )}
                </div>
                {shownClock.cameraKeys.map((k) => (
                  <div
                    key={k.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected === k.id}
                    aria-label={t('timeline.key.shotAria', { distance: formatDistance(k.atM), time: formatFilmTime(k.timeS) })}
                    title={t('timeline.key.shotHint')}
                    data-testid="timeline-key"
                    className={`film-tl__key${selected === k.id ? ' film-tl__key--selected' : ''}`}
                    style={{ left: xOf(k.timeS) }}
                    onPointerDown={(e) => startEdit(e, k.id, 'move')}
                    onFocus={() => setSelected(k.id)}
                    onKeyDown={(e) => onBlockKeyDown(e, k.id)}
                  />
                ))}
                {block(
                  'closing',
                  flightEnd,
                  total,
                  closing.style === 'aucune' ? '' : t('timeline.shot.closing'),
                  closing.style === 'aucune' ? t('timeline.shot.closingNone') : t('timeline.shot.closing'),
                  `film-tl__block--shot${closing.style === 'aucune' ? ' film-tl__block--none' : ''}`,
                  closing.style === 'aucune' ? [] : ['start'],
                )}
              </div>

              <div data-testid="timeline-lane" className="film-tl__lane film-tl__lane--keyed" role="group" aria-label={PARAM_LANE_LABELS.speed}>
                {shownClock.speeds.map((s) => {
                  const label = formatSpeedFactor(s.factor)
                  const speedKey = s.factor > 1 ? 'timeline.speed.fast' : s.factor < 1 ? 'timeline.speed.slow' : 'timeline.speed.normal'
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    t(speedKey, { label, from: formatDistance(s.fromM), to: formatDistance(s.toM) }),
                    `film-tl__block--speed${s.factor < 1 ? ' film-tl__block--slow' : ''}`,
                    ['start', 'move', 'end'],
                  )
                })}
                {keysOfParam(shownClock.paramKeys, 'speed').map(paramKeyDot)}
              </div>

              {paramLanes(shownClock).map((param) => (
                <div key={param} data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={PARAM_LANE_LABELS[param]}>
                  {keysOfParam(shownClock.paramKeys, param).map(paramKeyDot)}
                </div>
              ))}

              {shownClock.markerKeys.length > 0 && (
                <div data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={t('timeline.lane.marker')}>
                  {shownClock.markerKeys.map((k) => {
                    // what the marker looks like from this key on: its own colours and size, else those of the Trace panel
                    const look = withKey(settingsMarker, k, () => '')
                    const dot = (k.kind === 'figurine' ? look.figureColor : look.color) || track?.color
                    const kind = MARKER_KIND_LABELS[k.kind].toLowerCase()
                    const what = t('timeline.key.marker', {
                      kind: k.kind === 'figurine' ? t('timeline.key.markerFigure', { kind, figure: MARKER_FIGURE_LABELS[k.figure].toLowerCase() }) : kind,
                      color: dot ? t('timeline.key.markerColor', { color: dot }) : t('timeline.key.markerTrackColor'),
                      size: formatShort(look.size),
                    })
                    return (
                      <div
                        key={k.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected === k.id}
                        aria-label={t('timeline.key.markerAria', { what, distance: formatDistance(k.atM), time: formatFilmTime(k.timeS) })}
                        title={t('timeline.key.hint', { what })}
                        data-testid="timeline-key"
                        className={`film-tl__key film-tl__key--marker${selected === k.id ? ' film-tl__key--selected' : ''}`}
                        style={{ left: xOf(k.timeS), ...(dot ? { '--key-color': dot } : {}) } as CSSProperties}
                        onPointerDown={(e) => startEdit(e, k.id, 'move')}
                        onFocus={() => setSelected(k.id)}
                        onKeyDown={(e) => onBlockKeyDown(e, k.id)}
                      />
                    )
                  })}
                </div>
              )}

              <div data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={t('timeline.lane.holds')}>
                {shownClock.stops.map((s) => {
                  const label = s.label || t('film.snap.hold')
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    t('timeline.hold.description', { camera: STOP_CAMERA_LABELS[s.camera].toLowerCase(), label, auto: shownFilm.autoStops ? t('timeline.hold.auto') : '' }),
                    `film-tl__block--stop${shownFilm.autoStops ? ' film-tl__block--auto' : ''}`,
                    ['move', 'end'],
                  )
                })}
              </div>

              <div data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={t('timeline.lane.texts')}>
                {/* the opening title and the closing card (overlay settings): only their inner edge moves */}
                {shownCards(shownOverlay).map((card) => {
                  const { startS, endS } = cardWindow(shownOverlay, card, shownClock)
                  return block(
                    card,
                    startS,
                    endS,
                    CARD_LABELS[card],
                    CARD_LABELS[card],
                    'film-tl__block--card',
                    card === TITLE_CARD_ID ? ['end'] : ['start'],
                    undefined,
                    'type',
                  )
                })}
                {/* the card of each stage « À la suite »: only its end edge moves (its duration) */}
                {stageCardsOf(shownClock, shownFilm, shownOverlay).map((c) =>
                  block(c.id, c.startS, c.endS, c.label, t('timeline.card.description', { label: c.label }), 'film-tl__block--card', ['move', 'end'], undefined, 'type'),
                )}
                {shownFilm.texts.map((item) =>
                  block(item.id, item.startS, item.startS + item.durationS, item.text || t('film.snap.text'), t('timeline.text.description', { text: item.text }), 'film-tl__block--text', [
                    'start',
                    'move',
                    'end',
                  ]),
                )}
              </div>

              <div data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={t('timeline.lane.media')}>
                {shownFilm.media.map((m) =>
                  block(
                    m.id,
                    m.startS,
                    m.startS + m.durationS,
                    mediaLabel(m),
                    t(m.kind === 'video' ? (m.layout === 'carte' ? 'timeline.media.videoCard' : 'timeline.media.videoFull') : m.layout === 'carte' ? 'timeline.media.photoCard' : 'timeline.media.photoFull', {
                      label: mediaLabel(m),
                    }),
                    'film-tl__block--media',
                    ['start', 'move', 'end'],
                    pictures[m.src]?.thumb,
                    m.kind === 'video' ? 'video' : undefined,
                  ),
                )}
              </div>

              <div data-testid="timeline-lane" className="film-tl__lane" role="group" aria-label={t('timeline.lane.music')}>
                {shownFilm.audio.length === 0 && (
                  <span className="film-tl__empty" style={{ left: xOf(0) }}>
                    {t('timeline.music.empty')}
                  </span>
                )}
                {shownFilm.audio.map((a) => {
                  const sound = pictures[a.src]
                  const lengthS = musicLengthS(a, sound?.durationS)
                  const label = sound?.name ?? t('film.snap.music')
                  const wave = sound?.peaks && sound.durationS ? waveformPath(sound.peaks, sound.durationS, a.inS, lengthS) : ''
                  return block(
                    a.id,
                    a.startS,
                    a.startS + a.durationS,
                    label,
                    t('timeline.music.description', { label, volume: Math.round(a.volume * 100) }),
                    'film-tl__block--music',
                    ['start', 'move', 'end'],
                    undefined,
                    'music',
                    wave && (
                      <svg className="film-tl__wave" viewBox={`0 0 ${a.durationS} 1`} preserveAspectRatio="none" aria-hidden="true">
                        <path d={wave} />
                        {sound?.beats && <path className="film-tl__beats" d={beatTicksPath(sound.beats, a.inS, lengthS)} />}
                      </svg>
                    ),
                  )
                })}
              </div>

              {/* a lifted stage: a line across the lanes where it would land */}
              {stageDrag && sequence && (() => {
                const others = stageSpans(clock).filter((span) => span.id !== stageDrag.id)
                const atS = others[stageDrag.to]?.startS ?? others[others.length - 1]?.endS ?? 0
                return (
                  <div className="film-tl__guide" style={{ left: xOf(atS) }} aria-hidden="true">
                    <span className="film-tl__guide-tags">
                      <span className="film-tl__guide-tag" data-testid="timeline-guide-tag">{t('timeline.stage.short', { n: stageDrag.to + 1 })}</span>
                    </span>
                  </div>
                )
              })()}
              <span className="visually-hidden" role="status" aria-live="polite">
                {announcement}
              </span>
              {/* what the dragged block is aligned with: a line across the lanes and the names of the targets */}
              {guides.length > 0 && (
                <div className="film-tl__guide" style={{ left: xOf(guides[0].timeS) }} aria-hidden="true">
                  <span className="film-tl__guide-tags">
                    {guides.slice(0, 4).map((g, i) => (
                      <span key={`${g.label}-${i}`} className="film-tl__guide-tag" data-testid="timeline-guide-tag">
                        {g.label}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <div className="film-tl__playhead" style={{ left: xOf(playheadS) }} aria-hidden="true" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
