/**
 * Film timeline under the 3D view, in film time (opening and closing included): bar, ruler, and the lanes « Plans »,
 * « Vitesse », a lane per keyed parameter, « Marqueur » (marker keys), « Arrêts », « Textes », « Médias », « Musique »
 * (ARCHITECTURE.md "Film and timeline"). The inspector of the selected block (`filmSelection` in the store) is in the
 * right dock (`FilmInspector`).
 *
 * « Textes » also carries the opening title and the closing card while they are on (`film/cards.ts`: blocks of the
 * overlay settings, placed freely: their edges and body set `title.window` / `end.window`; their settings are in the
 * inspector).
 *
 * A gesture is previewed on the timeline only and committed on release as one undo step. Edits are the pure
 * functions of `film/timeline.ts`; editing a stop writes the generated stops out first (`materializeStops`).
 */
import { errorMessage } from '../core/errors'
import { isExportBusy, useExportStore } from '../export/store'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent, ReactNode, UIEvent } from 'react'
import { materializeStops, stopAt, stopCandidates } from '../film/assemble'
import { AUDIO_FILE_EXTENSIONS, fitFilmToMusic, isAudioFile, musicLengthS, readAudio, startMusicPreview, useMusicPreview, waveformPath } from '../film/audio'
import { beatTicksPath } from '../film/beats'
import { CARD_LABELS, TITLE_CARD_ID, cardShown, cardWindow, dragCard, isCardItem, shownCards } from '../film/cards'
import { dayCardId, dayCardIndexOf, dayCardWindow, isDayCardItem } from '../film/days'
import { isNightItem, nightItemId } from '../flyover/nights'
import type { CardId } from '../film/cards'
import { buildFilmClock, filmClockFor, filmClockInputFor, junctionInputsFor } from '../film/clock'
import type { FilmClock, FilmClockFor, FilmClockInput } from '../film/clock'
import { hasOwnTransition, isJunctionItem, junctionOf, isStageCardItem, isStageItem, junctionCardOf, stageCardAfterOf, stageCardId, stageCardWindow, stageItemId, stageTrackOf, junctionTrackOf } from '../film/junctions'
import { photoTimeMs } from '../film/exif'
import { withKey } from '../film/markerKeys'
import { dropIndexAt } from '../film/reorder'
import { useMediaStore } from '../film/media'
import { isMediaFile, readMedia } from '../film/video'
import { DEFAULT_DAY_CARDS, JUNCTION_KIND_LABELS, STOP_CAMERA_LABELS, clipHasSound } from '../film/model'
import { PARAM_LANE_LABELS, PARAM_SPECS, keysOfParam, paramLanes } from '../film/paramKeys'
import type { FilmParam, FilmParamKey } from '../film/paramKeys'
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
  dragKeys,
  rollClosing,
  edgeScrollSpeed,
  fitPxPerS,
  dragBlocks,
  followScroll,
  formatFrameTimecode,
  snapTargetsOn,
  timedBlockIds,
  zoomToSpan,
  followStops,
  formatFilmTime,
  formatSpeedFactor,
  formatTimecode,
  hasFilmItem,
  photoFilmTime,
  pressedGrip,
  removeFilmItem,
  rippleDrag,
  rippleRemove,
  rulerTicks,
  snapTargets,
  snapper,
  syncClip,
  tickLabelFlips,
  timelineContentWidth,
  updateMedia,
  zoomAt,
} from '../film/timeline'
import type { DragContext, Grip, SnapBlock, SnapTarget, TimelineItem } from '../film/timeline'
import { clampWorkArea, dragWorkArea } from '../film/workArea'
import { Filmstrip, filmstripCount } from './Filmstrip'
import { useLaneState } from './laneState'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath, type ElevationProfile } from '../flyover/path'
import { modifiedSettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import type { OverlaySettings } from '../overlay/settings'
import { addKeyframe, addMarkerKeyHere, addParamKeyHere, disableCard, editFilm, getFilmSource, reorderTracks, setAutoStops, setAutoStopsPlaces, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
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
import { keyFocus, spacePlays, withShortcut } from './shortcuts'
import { showToast } from './toast'
import { Button, Checkbox, Menu, Popover, Select, Slider, Tip } from './primitives'
import type { MenuItem } from './primitives'

/*
 * Looks of the strip. It is dark chrome in both themes: its root carries `chrome-focus` (the light-accent focus ring), the
 * hairlines are `white/10` and the hovers `white/10`. Sizes follow the 4 px scale, a touch screen
 * gets the 44 px targets through `touch:`; the state of a block or a key is its `aria-pressed` (selected) or `data-lifted`.
 */
const ROOT = 'chrome-focus @container/film-tl relative flex flex-col bg-chrome text-hint text-white'
/** Folded to a strip on a short or narrow screen, a sheet over the view when open (the centred timeline fills its row instead). */
const PHONE_SHEET =
  'phone-any:absolute phone-any:inset-x-0 phone-any:bottom-0 phone-any:z-7 phone-any:max-h-[85%] phone-any:overflow-y-auto phone-any:overscroll-contain phone-any:border-t phone-any:border-white/10 phone-any:shadow-pop'
/** Once the height was dragged (`data-timeline-sized` on the view, see TimelineResizer), the lanes scroll inside it. */
const SIZED_BODY = 'timeline-sized-body:min-h-0 timeline-sized-body:flex-auto timeline-sized-body:overflow-y-auto'
const TIME = 'min-w-[15ch] text-body tabular-nums whitespace-nowrap'
const READOUT = 'tabular-nums whitespace-nowrap text-glacier'
/** The play button: white on a veil of its own (the other buttons of the bar are `btn-chrome`, glacier). */
const BAR_PLAY = '[--button-bg-hover:rgb(255_255_255/0.22)] [--button-bg-pressed:rgb(255_255_255/0.3)] [--button-bg:rgb(255_255_255/0.12)] [--button-fg:var(--color-white)]'
/** The checkbox of the dark options panel: the roles it reads, turned to their on-chrome values. */
const CHECKBOX_ON_DARK =
  'whitespace-nowrap [--accent:var(--accent-on-dark)] [--focus-ring:var(--focus-ring-on-dark)] [--line-strong:var(--color-glacier)] [--surface-control:transparent] [--text-1:var(--color-white)]'

const HEAD = 'flex px-2 text-caption font-semibold text-glacier'
const LANE = 'relative border-b border-chrome bg-white/5'
/** The lane of the camera and the speed keys, taller by the group under its name in the header. */
const KEYED_HEIGHT = 'h-11.5 touch:h-13.5'
/** A folded lane: a thin strip, its name and the button that unfolds it. */
const FOLDED_HEIGHT = 'h-4'
/** The fold and lock buttons of a lane's head. */
const LANE_TOOL = 'inline-flex size-5 items-center justify-center rounded-sm text-glacier hover:bg-white/15 aria-pressed:bg-white/20 aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-white touch:size-8'
const TICK = 'pointer-events-none absolute top-0 h-full border-white/15 text-caption tabular-nums whitespace-nowrap text-glacier'

/** A block of a lane: the common part, then its kind (`BLOCK_KINDS`). */
const BLOCK = 'absolute inset-y-[3px] box-border flex min-w-1.5 items-center overflow-hidden rounded-sm px-1.5 text-caption font-semibold aria-pressed:z-1 aria-pressed:ring-2 aria-pressed:ring-white data-[lifted]:z-2 data-[lifted]:shadow-pop'
const BLOCK_KINDS = {
  /** shots: glacier; « aucune » is a stub that can still be selected */
  shot: 'cursor-pointer bg-glacier text-ink',
  shotNone: 'min-w-2.5! cursor-pointer border border-dashed border-glacier bg-transparent text-ink',
  stop: 'cursor-grab bg-accent-light text-ink',
  /** generated stops: dashed until they are edited */
  stopAuto: 'cursor-grab border border-dashed border-ink bg-accent-light text-ink',
  /** nights: the moss of a night junction; no grip (the track places them, « Jours et nuits » sets how long) */
  night: 'cursor-pointer gap-1 border border-glacier bg-moss/60 text-white',
  /** speed portions: glacier frame, full for a faster portion, dashed for a slower one */
  speed: 'cursor-grab justify-center border border-glacier bg-glacier/20 text-white',
  slow: 'cursor-grab justify-center border border-dashed border-glacier bg-glacier/20 text-white',
  text: 'cursor-grab bg-moss text-white',
  /** photos: paper block, thumbnail at its start */
  media: 'cursor-grab gap-1 bg-card pl-0.5 text-ink',
  /** music: moss block, the waveform in glacier behind the icon and the file name */
  music: 'cursor-grab gap-1 bg-moss/60 text-white',
  /** opening title and closing card: the moss of a text, framed (its inner edge stretches it, its body drags its shot's edge) */
  card: 'cursor-pointer gap-1 border border-glacier bg-moss/60 text-white',
  /** « Étapes »: a band per stage; one lifted to be reordered follows the pointer over the others */
  stage: 'cursor-grab bg-white/10 text-white data-[lifted]:cursor-grabbing data-[lifted]:bg-white/30',
}
/** The junction between two stages: a cut is a thin white mark, a fade the colour it fades to, a night the moss. */
const JUNCTION_KINDS_LOOK: Record<string, string> = {
  coupe: 'cursor-grab border border-white bg-white text-transparent',
  'fondu-noir': 'cursor-grab border border-glacier bg-chrome text-white',
  'fondu-blanc': 'cursor-grab border border-glacier bg-white text-ink',
  nuit: 'cursor-grab border border-glacier bg-moss/60 text-white',
}
const GRIP = 'absolute inset-y-0 z-1 w-2.5 cursor-ew-resize hover:bg-chrome/30 touch:w-4'
const BLOCK_LABEL = 'pointer-events-none relative min-w-0 truncate'
/** Keys: a diamond on its lane (a dot for the marker keys, in the colour of the marker from there on); a larger target on touch. */
const KEY =
  "absolute top-1/2 z-1 -mt-1.5 -ml-1.5 size-2.5 cursor-grab border before:absolute before:-inset-2 before:content-[''] touch:-mt-[9px] touch:-ml-[9px] touch:size-4"
const KEY_DIAMOND = `${KEY} rotate-45 border-chrome bg-glacier aria-pressed:bg-white`
const KEY_DOT = `${KEY} rounded-full border-white bg-[var(--key-color,var(--color-chartreuse))] aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-white`
/** The playhead: a line across the lanes, a small accent triangle (the `before:` borders) on its top edge. */
const PLAYHEAD =
  'pointer-events-none absolute inset-y-0 z-2 -ml-px w-0.5 bg-white before:absolute before:top-0 before:-left-1 before:border-[5px] before:border-transparent before:border-t-[6px] before:border-t-accent-light'
/** The centred timeline's playhead stays in the middle of the lanes, which scroll under it: the line and its triangle are drawn on the body. */
const CENTRE_PLAYHEAD =
  'after:pointer-events-none after:absolute after:inset-y-0 after:left-[calc(50%-1px)] after:z-3 after:w-0.5 after:bg-white before:pointer-events-none before:absolute before:top-0 before:left-[calc(50%-5px)] before:z-4 before:border-[5px] before:border-transparent before:border-t-[6px] before:border-t-accent-light'

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
  /** an end of the work area band on the ruler (`film/workArea.ts`) */
  | { kind: 'range'; end: 'in' | 'out' }
  /** centred timeline: a press that selects `item` (or seeks, on nothing) if released without sliding */
  | { kind: 'tap'; item: TimelineItem | null; x0: number }
  /** `flightS`: the flight duration of a roll edit (start of the closing dragged) */
  | { kind: 'edit'; item: TimelineItem; grip: Grip; x0: number; scroll0: number; start: Film; ctx: DragContext; result: Film | null; flightS?: number; group?: readonly string[] }
  /** a rectangle drawn with Ctrl from the background of the lanes (`x0`, `y0` where it started, `x`, `y` where the pointer is: in the content's coordinates), the keys it touches in `ids` */
  | { kind: 'marquee'; x0: number; y0: number; x: number; y: number; ids: readonly string[] }
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

/**
 * The parts of the timeline that follow the playhead select the playback themselves: the timeline does not render at
 * each frame of a film that plays, they do. `frozen`: the playback it keeps while the export moves the playhead.
 */
function useShownPlayback(frozen: Playback | null): Playback {
  return useAppStore((s) => frozen ?? s.playback)
}

/** The film time of the playhead. */
const playheadOf = (playback: Playback, clock: FilmClock) => Math.min(playback.timeS ?? clock.timeAtProgress(playback.progress), clock.totalTime())

/** The time, the distance with the elevation, and the recorded time of the bar. */
function PlayheadReadouts({
  frozen,
  clock,
  path,
  profile,
  lengthM,
  recorded,
  frameTimecode,
  fps,
  centred,
  collapsed,
}: {
  frozen: Playback | null
  clock: FilmClock
  path: ReturnType<typeof buildTrackPath>
  profile: ElevationProfile | undefined
  lengthM: number
  /** the recorded time of the track is asked for and known */
  recorded: boolean
  frameTimecode: boolean
  fps: number
  centred: boolean
  collapsed: boolean
}) {
  const t = useT()
  const playback = useShownPlayback(frozen)
  const playheadS = playheadOf(playback, clock)
  const ele = profile && path.count > 0 ? samplePath(path, playback.progress * path.lengthM).ele : undefined
  const time = recorded && path.count > 0 ? recordedTimeAt(path, playback.progress * path.lengthM) : undefined
  return (
    <>
      {/* fixed widths (tabular digits): a longer value never wraps the bar, so the view never resizes while it plays */}
      <span className={TIME}>
        <strong className="text-accent-light" data-testid="timeline-time">{frameTimecode ? formatFrameTimecode(playheadS, fps) : formatTimecode(playheadS, true)}</strong> / {frameTimecode ? formatFrameTimecode(clock.totalTime(), fps) : formatTimecode(clock.totalTime())}
      </span>
      <span className={`${READOUT} ${centred ? 'hidden' : collapsed ? '@max-[1200px]/film-tl:hidden phone-any:hidden' : '@max-[1200px]/film-tl:hidden'}`}>
        <span className="inline-block text-right" style={{ minWidth: `${formatDistance(lengthM).length + 1}ch` }}>
          {formatDistance(playback.progress * lengthM)}
        </span>{' '}
        / {formatDistance(lengthM)}
        {ele !== undefined && profile && (
          <>
            {' · '}
            <span className="sr-only">{t('timeline.bar.elevation')}</span>
            <span className="inline-block text-right" style={{ minWidth: `${formatNumber(profile.maxEle).length + 1}ch` }}>
              {formatNumber(ele)}
            </span>{' '}
            m
          </>
        )}
      </span>
      {/* apart from the readout, which a narrow timeline hides: the clock was asked for in « Réglages » */}
      {time !== undefined && (
        <span className={`${READOUT} ${centred ? 'hidden' : collapsed ? 'phone-any:hidden' : ''}`}>
          <span className="sr-only">{t('timeline.bar.recordedTime')}</span>
          <time className="inline-block min-w-[7ch] text-right" data-testid="timeline-clock" dateTime={new Date(time).toISOString()}>
            {formatClock(time)}
          </time>
        </span>
      )}
    </>
  )
}

/** The playhead: a line across the lanes. */
function Playhead({ frozen, clock, pad, pxPerS, centred }: { frozen: Playback | null; clock: FilmClock; pad: number; pxPerS: number; centred: boolean }) {
  const playheadS = playheadOf(useShownPlayback(frozen), clock)
  return <div className={centred ? 'hidden' : PLAYHEAD} data-testid="timeline-playhead" style={{ left: pad + playheadS * pxPerS }} aria-hidden="true" />
}

/** The part of the profile the playhead has flown, as a clip. */
function FlownClip({ frozen, clock, id, flightStart }: { frozen: Playback | null; clock: FilmClock; id: string; flightStart: number }) {
  const playheadS = playheadOf(useShownPlayback(frozen), clock)
  return (
    <clipPath id={id}>
      <rect width={Math.max(0, playheadS - flightStart)} height={PROFILE_HEIGHT} />
    </clipPath>
  )
}

/** The ruler as a slider on the film time. Its `children` are the timeline's: they do not render with the playhead. */
function RulerSlider({
  frozen,
  clock,
  className,
  onKeyDown,
  children,
}: {
  frozen: Playback | null
  clock: FilmClock
  className: string
  onKeyDown(e: KeyboardEvent<HTMLDivElement>): void
  children: ReactNode
}) {
  const t = useT()
  const playheadS = playheadOf(useShownPlayback(frozen), clock)
  return (
    <div
      className={className}
      role="slider"
      tabIndex={0}
      aria-label={t('timeline.ruler.label')}
      aria-valuemin={0}
      aria-valuemax={Math.round(clock.totalTime())}
      aria-valuenow={Math.round(playheadS)}
      aria-valuetext={t('timeline.ruler.valueText', { time: formatFilmTime(playheadS), total: formatFilmTime(clock.totalTime()) })}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

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
  /** layout only (hidden on the centred timeline...) */
  className?: string
  /** accessible name, also the tooltip unless `tip` is given (with the shortcut) */
  name: string
  tip?: string
  onClick(): void
  disabled?: boolean
  /** the state the button acts on is on (the diamond is filled); the name already says what a click does */
  on?: boolean
}

/** Icon button of the bar: icon only, its name as tooltip and accessible name. */
function BarButton({ icon, name, tip = name, onClick, disabled, on, className }: BarButtonProps) {
  return (
    <Tip text={tip} side="top">
      <Button variant="icon" className={['btn-chrome', on && 'text-accent-light [&_svg]:fill-current', className].filter(Boolean).join(' ')} onClick={onClick} disabled={disabled} aria-label={name}>
        <Icon name={icon} size={18} />
      </Button>
    </Tip>
  )
}

/**
 * « Options » of the film, in a small panel over the bar: music, the music lowered under the videos (the whole film),
 * automatic stops, « modifié » marker of the film. `sheet`: a bottom sheet (the centred timeline of a phone).
 */
function FilmOptions({
  autoStops,
  autoStopsPlaces,
  onAutoStops,
  onAddMusic,
  reading,
  sheet,
}: {
  autoStops: boolean
  autoStopsPlaces: boolean
  onAutoStops(on: boolean): void
  onAddMusic(): void
  reading: boolean
  sheet: boolean
}) {
  const t = useT()
  const modified = useAppStore((s) => modifiedSettings(s.settings, ['film']).length > 0)
  const duckMusic = useAppStore((s) => s.settings.film.duckMusic)
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
                <span className="absolute top-[3px] right-0.5 size-[7px] rounded-full bg-amber-light" />
                <span className="sr-only">{t('common.modified.srOnly')}</span>
              </>
            )}
          </Button>
        </Tip>
      }
    >
      {(close) => (
        <div className="flex flex-col items-start gap-2 p-3 text-body">
          <p className="font-heading text-body font-semibold">{t('timeline.options.title')}</p>
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
          <p className="text-hint text-glacier">{t('timeline.options.musicHint')}</p>
          <Checkbox className={CHECKBOX_ON_DARK} checked={duckMusic} onChange={(on) => editFilm((f) => ({ film: { ...f, duckMusic: on } }))}>
            {t('inspector.music.duck')}
          </Checkbox>
          <Checkbox className={CHECKBOX_ON_DARK} checked={autoStops} onChange={onAutoStops}>
            {t('timeline.options.autoStops')}
          </Checkbox>
          <Checkbox className={`${CHECKBOX_ON_DARK} ml-6`} checked={autoStopsPlaces} disabled={!autoStops} onChange={setAutoStopsPlaces}>
            {t('timeline.options.autoStopsPlaces')}
          </Checkbox>
          <p className="text-hint text-glacier">{t('timeline.options.autoStopsHint')}</p>
          <ModifiedMarker onDark keys={['film']} label={t('timeline.film')} />
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
/** « Arrêts automatiques »: switched on, the stops made by hand go (one undo step), and the message says so. */
function switchAutoStops(on: boolean): void {
  const own = on ? useAppStore.getState().settings.film.stops.length : 0
  setAutoStops(on)
  if (own > 0) showToast({ kind: 'info', text: translate('timeline.options.autoStopsReplaced', { count: own }) })
}

export function Timeline({ sheetOpen = false, centred = false, onUnfold }: { sheetOpen?: boolean; centred?: boolean; onUnfold?(): void }) {
  const t = useT()
  const { track, film, durationS, pacing, landmarks, cutsM, stageIds, bilan } = useFilmSource()
  const sequence = useFilmSequence()
  const tracks = useAppStore((s) => s.tracks)
  const settingsMarker = useAppStore((s) => s.settings.marker)
  const clock = useFilmClock()
  const workArea = useAppStore((s) => s.workArea)
  const [laneState, toggleLaneState] = useLaneState()
  const setWorkArea = useAppStore((s) => s.setWorkArea)
  // the export moves the playhead at every frame: the timeline keeps the playback it had (it would render with each one)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const [frozenPlayback, setFrozenPlayback] = useState<Playback | null>(null)
  if (!exporting && frozenPlayback) setFrozenPlayback(null)
  else if (exporting && !frozenPlayback) setFrozenPlayback(useAppStore.getState().playback)
  // not the playhead: it moves at every frame, and only what shows it follows (`useShownPlayback`)
  const playing = useAppStore((s) => (exporting && frozenPlayback ? frozenPlayback.playing : s.playback.playing))
  const speed = useAppStore((s) => (exporting && frozenPlayback ? frozenPlayback.speed : s.playback.speed))
  /** the film time the keys are given while the export moves the playhead (they follow it themselves otherwise) */
  const frozenS = frozenPlayback ? playheadOf(frozenPlayback, clock) : undefined
  /** where the playhead is now, for what acts on it (the keys, the drops, the zoom) */
  const shownPlayback = () => frozenPlayback ?? useAppStore.getState().playback
  const timelineClock = usePreferences((s) => s.timelineClock)
  const magnet = usePreferences((s) => s.timelineMagnet)
  const snapOn = usePreferences((s) => s.timelineSnap)
  const frameTimecode = usePreferences((s) => s.timelineFrames)
  const fps = useAppStore((s) => s.settings.video.fps)
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
    () => ({ track, film, durationS, pacing, landmarks, cutsM, stageIds, bilan }),
    [track, film, durationS, pacing, landmarks, cutsM, stageIds, bilan],
  )
  const input = useMemo(() => filmClockInputFor(clockSource), [clockSource])
  const candidates = useMemo(() => (track ? stopCandidates({ track, landmarks }) : []), [track, landmarks])

  const selected = useAppStore((s) => s.filmSelection)
  const setSelected = useAppStore((s) => s.setFilmSelection)
  const group = useAppStore((s) => s.filmKeys)
  const setKeys = useAppStore((s) => s.setFilmKeys)
  /** the rectangle being drawn and the keys it touches, shown on the timeline only */
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number; ids: readonly string[] } | null>(null)
  /** a key just added to or removed from the selection with Ctrl: the focus that follows its press does not select it alone */
  const keepGroupRef = useRef(false)
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
  /** the right-click menu: where it opens (in the pixels of the lanes) and what it offers */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
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
    if (item) [...(contentRef.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])].find((b) => b.dataset.item === item)?.focus()
  })
  const edgeRef = useRef<EdgeScroll | null>(null)
  /** zoom for the wheel listener */
  const zoomRef = useRef(zoom)
  /** Shift held while an edge is dragged: the blocks after it follow (« décalage en chaîne ») */
  const rippleRef = useRef(false)
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
    if (selected !== null && (!track || (isCardItem(selected) ? cardGone : !hasFilmItem(film, clock.stops, selected, stageIds, clock.nights)))) setSelected(null)
  }, [selected, track, film, clock, cardGone, stageIds, setSelected])
  // a key of the group went away (undo, deleted elsewhere): the others stay selected
  useEffect(() => {
    if (group.length > 0 && (!track || group.some((id) => !hasFilmItem(film, clock.stops, id)))) setKeys(track ? group.filter((id) => hasFilmItem(film, clock.stops, id)) : [])
  }, [group, track, film, clock, setKeys])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    // Ctrl+wheel zooms around the pointer (a passive React listener could not prevent the page zoom)
    const onWheel = (e: WheelEvent) => {
      // a plain mouse wheel scrolls a zoomed timeline sideways (the lanes do not scroll up and down); a trackpad's own sideways swipe is left alone
      if (!e.ctrlKey) {
        if (centred || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return
        e.preventDefault()
        el.scrollLeft += e.deltaY
        return
      }
      if (e.deltaY === 0) return
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
  const playheadNow = () => playheadOf(shownPlayback(), clock)
  const workSpan = clampWorkArea(workArea, clock.totalTime())
  // centred: the lanes scroll so that the playhead time sits in the middle; zoomed in, they follow the playhead while the
  // film plays (it never leaves the view). After every render (zoom, width) and at every frame, with no render of the timeline
  const followRef = useRef(() => {})
  useLayoutEffect(() => {
    followRef.current = () => {
      const el = scrollerRef.current
      if (!el) return
      const playheadS = playheadNow()
      if (centred) {
        const target = centredScrollLeft(playheadS, pxPerS)
        if (Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target
        syncedScrollRef.current = el.scrollLeft
      } else if (playing && !gestureRef.current) {
        const next = followScroll(PAD_PX + playheadS * pxPerS, el.scrollLeft, el.clientWidth, el.scrollWidth)
        if (next !== el.scrollLeft) el.scrollLeft = next
      }
    }
    followRef.current()
  })
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.playback.progress !== prev.playback.progress || state.playback.timeS !== prev.playback.timeS) followRef.current()
      }),
    [],
  )

  // Z zooms the timeline to the selected block (or the work area, or the whole film)
  const zoomSelectionRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return
      if (keyFocus(e.target) === 'text') return
      e.preventDefault()
      zoomSelectionRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
  const contentWidth = timelineContentWidth(width, total, pxPerS, pad)
  const freeCandidates = candidates.filter((c) => !stopAt(shownClock.stops, c.atM))

  // --- edits -------------------------------------------------------------------------------------------------
  const isStop = (item: TimelineItem) => clock.stops.some((s) => s.id === item)
  /** the cards of the stages « À la suite » that are shown, with their window (the first one gives way to the opening title) */
  const stageCardsOf = (clk: FilmClock, f: Film, ov: OverlaySettings) =>
    // a « Bilan »: the cards are the regions', set in Trace › Plusieurs traces, not blocks
    !sequence || sequence.bilan
      ? []
      : [null, ...clk.junctions.map((j) => j.afterTrackId)].flatMap((after, k) => {
          const window = stageCardWindow(clk, f, after)
          if (!window || !junctionCardOf(f, after).enabled || (after === null && cardShown(ov, TITLE_CARD_ID))) return []
          return [{ id: stageCardId(after), ...window, label: t('timeline.stage.label', { n: k + 1, track: sequence.stages[k]?.track.name ?? '' }) }]
        })
  /** the cards of the days of a multi-day track (`film.dayCards`), with their window; one duration for all */
  const dayCardsOf = (clk: FilmClock, f: Film) =>
    clk.days.flatMap((_, k) => {
      const window = dayCardWindow(clk.days, k, (f.dayCards ?? DEFAULT_DAY_CARDS).durationS)
      return window ? [{ id: dayCardId(k), ...window, label: t('timeline.dayCard.label', { n: k + 1 }) }] : []
    })
  /** the cards and junctions as blocks, for the targets only the component knows */
  const snapBlocks: SnapBlock[] = [
    ...shownCards(overlay).map((card) => ({ id: card, ...cardWindow(overlay, card, clock), label: CARD_LABELS[card] })),
    ...stageCardsOf(clock, film, overlay),
    ...dayCardsOf(clock, film),
    ...clock.nights.map((n, k) => ({ id: nightItemId(n), startS: n.startS, endS: n.endS, label: t('timeline.night.label', { n: k + 1 }) })),
  ]
  const withOwnStops = (f: Film) => materializeStops(f, { track, landmarks, durationS })
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
  const dragContext = (item: TimelineItem | readonly TimelineItem[]): DragContext => ({
    clock,
    clockOf: (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops }),
    clockOfSpeeds: (speeds: readonly FilmSpeed[]) => buildFilmClock({ ...input, speeds }),
    lengthM,
    targets: snapTargetsOn(snapTargets(clock, film, candidates.map((c) => c.atM / lengthM), playheadNow(), item, { ticks: rulerTicks(total, pxPerS), blocks: snapBlocks }), snapOn),
    targetsM: candidates.map((c) => c.atM),
    snapS: SNAP_PX / pxPerS,
    releaseS: RELEASE_PX / pxPerS,
    snapState: { held: [], hits: [] },
    clockOfFilm: clockOf,
    audioFileS: (src) => pictures[src]?.durationS,
  })
  const keyIds = [...clock.cameraKeys, ...clock.paramKeys, ...clock.markerKeys].map((k) => k.id)
  /** the texts, media and music: blocks by film time that can be picked together (Ctrl + click), moved, copied and removed as a group */
  const blockIds = timedBlockIds(film)
  /** the keys selected together, or the key selected on its own */
  const pickedKeys = group.length > 0 ? group : selected !== null && keyIds.includes(selected) ? [selected] : []
  /** a key added to the selection, or left out of it (Ctrl) */
  const toggleKey = (id: string) => setKeys(pickedKeys.includes(id) ? pickedKeys.filter((k) => k !== id) : [...pickedKeys, id])
  /** a block added to the blocks picked together, or left out of them (Ctrl + click); a group is only of blocks, or only of keys */
  const toggleBlock = (id: string) => {
    const picked = group.length > 0 && group.every((g) => blockIds.includes(g)) ? group : selected !== null && blockIds.includes(selected) ? [selected] : []
    setKeys(picked.includes(id) ? picked.filter((k) => k !== id) : [...picked, id])
  }
  /** the keys of the group deleted in one undo step */
  const removeKeys = (ids: readonly string[]) => editFilm((f) => ({ film: ids.reduce(removeFilmItem, f), id: null }))
  const isPicked = (id: string) => selected === id || group.includes(id) || (marquee?.ids.includes(id) ?? false)
  /** a key focused (the keyboard, a press) is selected alone, unless it is in the group or was just added to it */
  const focusKey = (id: string) => {
    if (!keepGroupRef.current && !useAppStore.getState().filmKeys.includes(id)) setSelected(id)
  }
  const remove = (item: TimelineItem) => (isCardItem(item) ? disableCard(item) : editFilm((f) => ({ film: removeFilmItem(f, item), id: null }), { stops: isStop(item) }))
  /** a key on the lane `lane` (`data-lane`) at film time `timeS`: the playhead goes there first, the key takes what the film shows there */
  const addKeyAt = (lane: string, timeS: number) => {
    seek(timeS)
    if (lane === 'camera') {
      // the 3D view takes the new place on its next frames, the key reads its pose
      requestAnimationFrame(() => requestAnimationFrame(() => void addKeyframe()))
    } else if (lane === 'marker') addMarkerKeyHere()
    else addParamKeyHere(lane.slice('param:'.length) as FilmParam)
  }
  /**
   * Right click on the lanes, instead of the browser's menu: on a block, to delete it (a key of the selected group:
   * the whole group, like Delete); on the empty part of a lane that holds keys, to add a key there.
   */
  const onContentContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const target = e.target instanceof Element ? e.target : null
    const item = target?.closest<HTMLElement>('[data-item]')?.dataset.item
    const lane = target?.closest<HTMLElement>('[data-lane]')?.dataset.lane
    const items: MenuItem[] = []
    if (item && !isStageItem(item) && !isJunctionItem(item) && !isStageCardItem(item)) {
      const together = group.length > 1 && group.includes(item) ? group : null
      if (!together) setSelected(item)
      items.push({
        id: 'remove',
        label: together ? t('timeline.menu.removeKeys', { count: together.length }) : t(keyIds.includes(item) ? 'timeline.menu.removeKey' : 'timeline.menu.remove'),
        onSelect: () => (together ? removeKeys(together) : remove(item)),
      })
      const picked = together ?? [item]
      if (picked.every((id) => blockIds.includes(id))) {
        items.push({
          id: 'remove-close',
          label: t('timeline.menu.removeClose', { count: picked.length }),
          onSelect: () => editFilm((f) => ({ film: rippleRemove(f, picked), id: null })),
        })
      }
    } else if (!item && lane) {
      const timeS = Math.max(0, timeAt(e.clientX))
      items.push({ id: 'add-key', label: t('timeline.menu.addKey'), onSelect: () => addKeyAt(lane, timeS) })
    }
    const box = contentRef.current?.getBoundingClientRect()
    setContextMenu(items.length > 0 && box ? { x: e.clientX - box.left, y: e.clientY - box.top, items } : null)
  }
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
    const startS = playheadNow()
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
    } else if (isDayCardItem(item)) {
      const day = clock.days[dayCardIndexOf(item)]
      if (day) seek(day.cardS)
    } else if (isNightItem(item)) {
      const night = clock.nights.find((n) => nightItemId(n) === item)
      if (night) seek(night.startS)
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
    if (e.ctrlKey || e.metaKey) {
      // Ctrl: a rectangle that selects the keys it touches, instead of moving the playhead
      const box = e.currentTarget.getBoundingClientRect()
      const [x, y] = [e.clientX - box.left, e.clientY - box.top]
      gestureRef.current = { kind: 'marquee', x0: x, y0: y, x, y, ids: [] }
      return
    }
    gestureRef.current = { kind: 'scrub' }
    seek(timeAt(e.clientX))
  }
  const startEdit = (e: PointerEvent<HTMLElement>, item: TimelineItem, grip: Grip) => {
    // centred: a block is selected by a tap first, a slide over it scrolls the lanes (a stage is never dragged there: the list reorders)
    if (centred && (selected !== item || isStageItem(item))) return startTap(e, item)
    if (e.button !== 0 || !e.isPrimary) return
    e.stopPropagation()
    if ((e.ctrlKey || e.metaKey) && keyIds.includes(item)) {
      keepGroupRef.current = true
      return toggleKey(item)
    }
    if ((e.ctrlKey || e.metaKey) && blockIds.includes(item)) {
      keepGroupRef.current = true
      return toggleBlock(item)
    }
    // pressed in the group, a key drags it whole; released without moving, it is selected alone
    const together = group.includes(item) ? group : undefined
    if (!together) setSelected(item)
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
    gestureRef.current = { kind: 'edit', item, grip, x0: e.clientX, scroll0, start, ctx: dragContext(together ?? item), result: null, group: together }
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
    if (g.kind === 'range') {
      const current = clampWorkArea(useAppStore.getState().workArea, clock.totalTime())
      if (current) setWorkArea(dragWorkArea(current, g.end, timeAt(clientX), clock.totalTime()))
      return
    }
    if (g.kind === 'tap') {
      if (Math.abs(clientX - g.x0) > TAP_SLOP_PX) gestureRef.current = null
      return
    }
    if (g.kind === 'marquee') {
      const box = contentRef.current?.getBoundingClientRect()
      if (!box) return
      g.x = clientX - box.left
      const [left, top, width, height] = [Math.min(g.x0, g.x), Math.min(g.y0, g.y), Math.abs(g.x - g.x0), Math.abs(g.y - g.y0)]
      if (g.ids.length === 0 && width < DRAG_THRESHOLD_PX && height < DRAG_THRESHOLD_PX) return
      // the keys it touches, in the coordinates of the content (it scrolls under the pointer)
      g.ids = [...(contentRef.current?.querySelectorAll<HTMLElement>('[data-testid="timeline-key"]') ?? [])].flatMap((el) => {
        const r = el.getBoundingClientRect()
        const inside = r.left - box.left < left + width && r.right - box.left > left && r.top - box.top < top + height && r.bottom - box.top > top
        return inside && el.dataset.item ? [el.dataset.item] : []
      })
      setMarquee({ left, top, width, height, ids: g.ids })
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
      let dragged = g.group
        ? g.group.every((id) => blockIds.includes(id))
          ? dragBlocks(g.start, g.group, g.item, dx / pxPerS, ctx)
          : dragKeys(g.start, g.group, g.item, dx / pxPerS, ctx)
        : dragFilm(g.start, g.item, g.grip, dx / pxPerS, ctx)
      // Shift on the end of a text, a photo or a clip: what comes after it follows
      if (!g.group && g.grip === 'end' && rippleRef.current) dragged = rippleDrag(g.start, dragged, g.item)
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
    if (g.kind === 'marquee') g.y = e.clientY - (contentRef.current?.getBoundingClientRect().top ?? 0)
    rippleRef.current = e.shiftKey
    applyPointer(e.clientX, e.altKey)
    // a press that only selects a block (not dragged yet) does not scroll
    if (g.kind === 'scrub' || g.kind === 'marquee' || ((g.kind === 'edit' || g.kind === 'card') && g.result) || (g.kind === 'reorder' && g.moved)) followEdge(e.clientX, e.altKey)
  }
  const endGesture = (e: PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    gestureRef.current = null
    keepGroupRef.current = false
    cancelAnimationFrame(edgeRef.current?.frame ?? 0)
    edgeRef.current = null
    if (g?.kind === 'marquee' && e.type === 'pointerup') {
      // the keys it touched are selected, the first one takes the focus (Delete, the arrows and Ctrl+Enter work from there)
      setKeys(g.ids)
      if (g.ids.length > 0) [...(contentRef.current?.querySelectorAll<HTMLElement>('[data-item]') ?? [])].find((b) => b.dataset.item === g.ids[0])?.focus({ preventScroll: true })
    }
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
      else {
        if (g.group) setSelected(g.item)
        jumpToKey(g.item)
      }
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
    setMarquee(null)
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
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === ' ') && keyIds.includes(item)) {
      toggleKey(item)
      e.preventDefault()
      return
    }
    // a key of the group: Delete and the arrows are for the whole group
    const together = group.includes(item) ? group : undefined
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const picked = together ?? [item]
      // Shift: the gap closes (« décalage en chaîne »)
      if (e.shiftKey && picked.every((id) => blockIds.includes(id))) editFilm((f) => ({ film: rippleRemove(f, picked), id: null }))
      else if (together) removeKeys(together)
      else remove(item)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey) {
      const step = (e.shiftKey ? FINE_NUDGE_S : NUDGE_S) * (e.key === 'ArrowLeft' ? -1 : 1)
      const grip: Grip =
        item === 'closing'
          ? 'start'
          : item === 'opening' || isJunctionItem(item) || isStageCardItem(item) || isDayCardItem(item) || isStageItem(item)
            ? 'end'
            : 'move'
      if (isCardItem(item)) {
        const next = dragCard(overlay, item, grip, step, clock)
        if (next !== overlay) setSetting('overlay', next)
      } else if (together) {
        change((f) => dragKeys(f, together, item, step, { ...dragContext(together), snapS: 0 }), false)
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
    else if (e.key in steps) seek(playheadNow() + steps[e.key] * (e.shiftKey ? 5 : 1))
    else return
    e.preventDefault()
  }
  const zoomBy = (factor: number) => {
    const el = scrollerRef.current
    // keep the playhead in place
    const next = zoomAt(zoom, factor, el ? xOf(playheadNow()) - el.scrollLeft : 0, el?.scrollLeft ?? 0)
    pendingScrollRef.current = next.scrollLeft
    setZoom(next.zoom)
  }
  /** the whole film in the width of the timeline */
  const fitZoom = () => {
    pendingScrollRef.current = 0
    setZoom(ZOOM_RANGE.min)
  }
  /** The stretch of the block or key `id` on the timeline, in film time (read from where it is drawn). */
  const spanOfItem = (id: string): { startS: number; endS: number } | null => {
    const el = contentRef.current ? [...contentRef.current.querySelectorAll<HTMLElement>('[data-item]')].find((b) => b.dataset.item === id) : undefined
    const left = parseFloat(el?.style.left ?? '')
    if (!el || !Number.isFinite(left)) return null
    const width = parseFloat(el.style.width) || 0
    return { startS: (left - pad) / pxPerS, endS: (left + width - pad) / pxPerS }
  }
  /** « Zoom sur la sélection »: the selected block (or the work area, else the whole film) fills the view. */
  const zoomToSelection = () => {
    const el = scrollerRef.current
    if (!el || centred) return
    const span = (selected !== null ? spanOfItem(selected) : null) ?? (workSpan ? { startS: workSpan.inS, endS: workSpan.outS } : null)
    if (!span) return fitZoom()
    const next = zoomToSpan(span.startS, span.endS, el.clientWidth, total, PAD_PX)
    pendingScrollRef.current = next.scrollLeft
    zoomRef.current = next.zoom
    // the scroll is applied once the zoom has changed; with the same zoom it is applied now
    if (Math.abs(next.zoom - zoom) < 1e-9) el.scrollLeft = next.scrollLeft
    setZoom(next.zoom)
  }
  zoomSelectionRef.current = zoomToSelection

  // --- blocks ------------------------------------------------------------------------------------------------
  const liftedItem = stageDrag ? stageItemId(stageDrag.id) : null
  /** a lane: its height is the row of the heads (the camera and speed lanes, with keys, are taller), 36 px on the centred timeline */
  // a lane folded to a strip or locked (per device, `laneState.ts`): its blocks are hidden or untouchable (`inert`: no focus, no pointer, so a press falls through to the scrub); not on the phone's centred timeline
  const isFolded = (id: string) => !centred && laneState.folded.includes(id)
  const isLocked = (id: string) => !centred && laneState.locked.includes(id)
  const laneProps = (id: string, keyed = false) => ({
    className: `${LANE} ${centred ? 'h-9' : isFolded(id) ? FOLDED_HEIGHT : keyed ? KEYED_HEIGHT : 'h-7 touch:h-10'}${isFolded(id) ? ' [&>*]:invisible' : ''}${isLocked(id) ? ' opacity-60' : ''}`,
    inert: isFolded(id) || isLocked(id),
    'data-lane-id': id,
  })
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
      aria-pressed={selected === item || group.includes(item)}
      aria-label={t('timeline.blockRange', { description, from: formatFilmTime(startS), to: formatFilmTime(endS) })}
      title={label}
      data-item={item}
      data-testid="timeline-block"
      data-lifted={item === liftedItem ? '' : undefined}
      className={`${BLOCK} ${className}${centred ? ' aria-pressed:touch-none' : ''}`}
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
      onFocus={() => (blockIds.includes(item) ? focusKey(item) : setSelected(item))}
      onKeyDown={(e) => onBlockKeyDown(e, item)}
    >
      {grips.includes('start') && <span className={`${GRIP} left-0`} onPointerDown={(e) => startGrip(e, item, 'start', grips)} />}
      {extra}
      {thumb && <img className="pointer-events-none h-[18px] max-w-8 flex-none rounded-[2px] object-cover" src={thumb} alt="" draggable={false} />}
      {icon && (
        <span className="pointer-events-none relative inline-flex flex-none">
          <Icon name={icon} size={12} />
        </span>
      )}
      <span className={BLOCK_LABEL}>{label}</span>
      {grips.includes('end') && <span className={`${GRIP} right-0`} onPointerDown={(e) => startGrip(e, item, 'end', grips)} />}
    </div>
  )
  const opening = shownFilm.opening
  const closing = shownFilm.closing
  const flightStart = shownClock.openingS
  const flightEnd = flightStart + shownClock.flightS
  const ticks = rulerTicks(total, pxPerS)
  /** the lanes: always « Plans » and « Vitesse », a lane per keyed parameter, « Marqueur » with marker keys, the rest */
  const lanes: { id: string; name: string; keys?: KeyTarget }[] = [
    ...(sequence ? [{ id: 'stages', name: t('timeline.lane.stages') }] : []),
    { id: 'shots', name: t('timeline.lane.shots'), keys: { kind: 'camera' } },
    { id: 'param:speed', name: PARAM_LANE_LABELS.speed, keys: { kind: 'param', param: 'speed' } },
    ...paramLanes(shownClock).map((param) => ({ id: `param:${param}`, name: PARAM_LANE_LABELS[param] })),
    ...(shownClock.markerKeys.length > 0 ? [{ id: 'marker', name: t('timeline.lane.marker') }] : []),
    { id: 'holds', name: t('timeline.lane.holds') },
    { id: 'texts', name: t('timeline.lane.texts') },
    { id: 'media', name: t('timeline.lane.media') },
    { id: 'music', name: t('timeline.lane.music') },
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
          // « Revoir l'étape finie » belongs to the transition's block, which starts with it
          after ? (after.recap?.startS ?? after.startS) : flightEnd,
          name,
          t('timeline.stage.description', { n: k + 1, track: stage.track.name }),
          BLOCK_KINDS.stage,
          // a « Bilan »: the stages are the outings in date order, with the same time each: nothing to move or stretch
          sequence?.bilan ? [] : ['move', 'end'],
          undefined,
          undefined,
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px]" style={{ background: color }} />,
        ),
      ]
      if (after) {
        const fade = after.kind === 'fondu-noir' || after.kind === 'fondu-blanc'
        const passage = fade ? `${JUNCTION_KIND_LABELS[after.kind]} · ${formatNumber(after.holdS, 1)} s` : JUNCTION_KIND_LABELS[after.kind]
        // what the clock plays here: the passage (or the night), with the high view of the stage before it
        const label = !sequence?.bilan && junctionOf(shownFilm, after.afterTrackId).recap ? t('timeline.junction.withRecap', { label: passage }) : passage
        const own = sequence?.bilan || hasOwnTransition(shownFilm, after.afterTrackId) ? '' : t('timeline.junction.byDefault')
        blocks.push(
          block(
            after.id,
            after.recap?.startS ?? after.startS,
            after.endS,
            label,
            t('timeline.junction.description', { n: k + 1, label, own }),
            JUNCTION_KINDS_LOOK[after.kind] ?? JUNCTION_KINDS_LOOK['fondu-noir'],
            sequence?.bilan ? [] : fade ? ['move', 'end'] : ['move'],
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
        aria-pressed={isPicked(k.id)}
        data-item={k.id}
        aria-label={t('timeline.key.settingAria', { what, distance: formatDistance(k.atM), time: formatFilmTime(k.timeS) })}
        title={t('timeline.key.hint', { what })}
        data-testid="timeline-key"
        className={`${KEY_DIAMOND}${centred ? ' aria-pressed:touch-none' : ''}`}
        style={{ left: xOf(k.timeS) }}
        onPointerDown={(e) => startEdit(e, k.id, 'move')}
        onFocus={() => focusKey(k.id)}
        onKeyDown={(e) => onBlockKeyDown(e, k.id)}
      />
    )
  }
  const mediaLabel = (m: FilmMedia) => m.caption?.trim() || pictures[m.src]?.name || (m.kind === 'video' ? t('film.snap.video') : t('film.snap.photo'))

  return (
    <div
      data-testid="timeline"
      data-centred={centred || undefined}
      data-timeline=""
      data-folded={collapsed || undefined}
      className={`${ROOT} ${centred ? 'min-h-0 flex-auto' : 'flex-none'}${!collapsed && !centred ? ` ${PHONE_SHEET} timeline-sized:h-(--timeline-h)` : ''}`}
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
      <div
        className={`flex items-center gap-x-2 gap-y-1 px-2 ${centred ? 'h-[var(--phone-transport-h,52px)] flex-nowrap' : 'flex-wrap py-1'}`}
        data-testid="timeline-bar"
        data-timeline-bar=""
      >
        <Tip text={withShortcut(playing ? t('timeline.bar.pauseTip') : t('timeline.bar.playTip'), 'play')} side="top" align="start">
          <Button
            variant="icon"
            className={BAR_PLAY}
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? t('timeline.bar.pause') : t('timeline.bar.play')}
          >
            <Icon name={playing ? 'pause' : 'play'} size={16} />
          </Button>
        </Tip>
        <BarButton
          icon="square"
          className={centred ? 'hidden' : collapsed ? 'phone-any:hidden' : undefined}
          name={t('timeline.bar.stop')}
          onClick={() => {
            setPlaying(false)
            seek(0)
          }}
        />
        <PlayheadReadouts
          frozen={frozenPlayback}
          clock={clock}
          path={path}
          profile={profile}
          lengthM={lengthM}
          recorded={timelineClock && track.stats.startTime !== undefined}
          frameTimecode={frameTimecode}
          fps={fps}
          centred={centred}
          collapsed={collapsed}
        />
        <span className={centred ? 'hidden' : 'flex-1 basis-0'} />
        {/* a row of its own on a phone, which scrolls sideways */}
        <div
          className={
            centred
              ? 'flex min-w-0 flex-auto items-center justify-start gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none]'
              : `contents${collapsed ? ' phone-any:hidden' : ''}`
          }
          data-testid="timeline-tools"
        >
          {/* no lane headers on a centred timeline: the groups of the camera and speed keys lead the row */}
          {centred && (
            <>
              <span className="flex-none text-caption font-semibold text-glacier">{t('timeline.lane.shots')}</span>
              <KeyGroup target={{ kind: 'camera' }} clock={clock} timeS={frozenS} disabled={!hasTrack} look="bar" />
              <span className="flex-none text-caption font-semibold text-glacier">{PARAM_LANE_LABELS.speed}</span>
              <KeyGroup target={{ kind: 'param', param: 'speed' }} clock={clock} timeS={frozenS} disabled={!hasTrack} look="bar" />
            </>
          )}
          <BarButton
            icon="map-pin"
            name={t('timeline.bar.addHold')}
            tip={withShortcut(t('timeline.bar.addHold'), 'add-stop')}
            onClick={() => addStopAt(Math.round(shownPlayback().progress * lengthM))}
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
            onClick={() => addSpeedAt(Math.round(shownPlayback().progress * lengthM))}
          />
          <BarButton
            icon="type"
            name={t('timeline.bar.addText')}
            tip={withShortcut(t('timeline.bar.addText'), 'add-text')}
            onClick={() => editFilm((f) => addText(f, playheadNow()))}
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
          <span className={centred ? 'hidden' : 'h-5 w-px flex-none bg-white/15'} aria-hidden="true" />
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
          <div className={centred ? 'hidden' : 'flex items-center gap-0.5'} role="group" aria-label={t('timeline.zoom.group')}>
            <BarButton
              icon="zoom-out"
              name={t('timeline.zoom.out')}
              tip={withShortcut(t('timeline.zoom.out'), 'zoom')}
              onClick={() => zoomBy(1 / BUTTON_ZOOM)}
              disabled={zoom <= ZOOM_RANGE.min}
            />
            <Slider
              className="mx-0.5 w-22 [--slider-accent:var(--color-accent-light)] @max-[1200px]/film-tl:w-16"
              min={0}
              max={ZOOM_SLIDER_STEPS}
              step={1}
              value={zoomToSlider(zoom)}
              aria-label={t('timeline.zoom.slider')}
              spoken={() => `×${formatNumber(zoom, 1)}`}
              onChange={(v) => zoomBy(sliderToZoom(v) / zoom)}
            />
            <BarButton
              icon="zoom-in"
              name={t('timeline.zoom.in')}
              tip={withShortcut(t('timeline.zoom.in'), 'zoom')}
              onClick={() => zoomBy(BUTTON_ZOOM)}
              disabled={zoom >= ZOOM_RANGE.max}
            />
            <BarButton icon="maximize" name={t('timeline.zoom.selection')} tip={withShortcut(t('timeline.zoom.selectionTip'), 'zoom-selection')} onClick={zoomToSelection} disabled={!hasTrack} />
            <BarButton icon="move-horizontal" name={t('timeline.zoom.fit')} tip={t('timeline.zoom.fitTip')} onClick={fitZoom} disabled={zoom <= ZOOM_RANGE.min} />
          </div>
          {workSpan && <BarButton icon="rotate-cw" name={t('timeline.workArea.clear')} tip={t('timeline.workArea.clearTip', { from: formatFilmTime(workSpan.inS), to: formatFilmTime(workSpan.outS) })} on onClick={() => setWorkArea(null)} />}
          <BarButton
            icon="magnet"
            name={magnet ? t('timeline.magnet.off') : t('timeline.magnet.on')}
            tip={magnet ? t('timeline.magnet.onTip') : t('timeline.magnet.offTip')}
            on={magnet}
            onClick={() => setPreferences({ timelineMagnet: !magnet })}
          />
          <FilmOptions autoStops={film.autoStops} autoStopsPlaces={film.autoStopsPlaces === true} onAutoStops={switchAutoStops} onAddMusic={pickMusic} reading={reading} sheet={centred} />
        </div>
        <Tip text={collapsed ? t('timeline.fold.unfold') : t('timeline.fold.fold')} side="top" align="end">
          <Button
            variant="icon"
            className={centred ? 'btn-chrome hidden' : 'btn-chrome'}
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
        <div
          className={`flex border-t border-white/10 ${SIZED_BODY}${centred ? ` relative min-h-0 flex-auto ${CENTRE_PLAYHEAD}` : ''}`}
          id={`${id}-lanes`}
        >
          <div className={`w-28 flex-none border-r border-white/10 touch:w-32 ${centred ? 'hidden' : ''}`} data-testid="timeline-heads">
            <div className={`${HEAD} h-5 items-center touch:h-7`} data-testid="timeline-head" />
            {/* the lanes carry the same names; the camera and speed keys have their ◀ ◇ ▶ under theirs */}
            {lanes.map((lane) => {
              const folded = isFolded(lane.id)
              const locked = isLocked(lane.id)
              return (
                <div
                  key={lane.id}
                  className={`${HEAD} group relative ${folded ? `${FOLDED_HEIGHT} items-center` : lane.keys ? `${KEYED_HEIGHT} flex-col items-start justify-center gap-px` : 'h-7 items-center touch:h-10'}`}
                  data-testid="timeline-head"
                >
                  <span className={`max-w-full truncate pr-11 ${folded ? 'text-[10px] leading-none' : ''}`} title={lane.name}>
                    {lane.name}
                  </span>
                  {lane.keys && !folded && <KeyGroup target={lane.keys} clock={clock} timeS={frozenS} disabled={!hasTrack} />}
                  <span
                    className={`absolute right-1 ${lane.keys && !folded ? 'top-1' : 'top-1/2 -translate-y-1/2'} flex gap-0.5 ${folded || locked ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100'}`}
                  >
                    <button type="button" className={LANE_TOOL} aria-pressed={folded} aria-label={t(folded ? 'timeline.lane.unfold' : 'timeline.lane.fold', { name: lane.name })} title={t(folded ? 'timeline.lane.unfold' : 'timeline.lane.fold', { name: lane.name })} onClick={() => toggleLaneState('folded', lane.id)}>
                      <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={14} />
                    </button>
                    {!folded && (
                      <button type="button" className={LANE_TOOL} aria-pressed={locked} aria-label={t(locked ? 'timeline.lane.unlock' : 'timeline.lane.lock', { name: lane.name })} title={t(locked ? 'timeline.lane.unlock' : 'timeline.lane.lock', { name: lane.name })} onClick={() => toggleLaneState('locked', lane.id)}>
                        <Icon name={locked ? 'lock' : 'lock-open'} size={14} />
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <div
            className={`min-w-0 flex-auto ${centred ? 'overflow-auto overscroll-contain' : 'overflow-x-auto overflow-y-hidden'}`}
            data-testid="timeline-scroller"
            ref={scrollerRef}
            onScroll={centred ? onScroll : undefined}
            // centred: a touch stops the playback, else the lanes would follow the playhead under the finger
            onPointerDownCapture={centred && playing ? () => setPlaying(false) : undefined}
          >
            <div
              ref={contentRef}
              className={`relative select-none ${centred ? 'touch-pan-x touch-pan-y' : 'touch-none'}`}
              style={{ width: contentWidth }}
              onPointerDown={onContentPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onContextMenu={onContentContextMenu}
            >
              <RulerSlider
                frozen={frozenPlayback}
                clock={clock}
                className={`relative cursor-pointer border-b border-white/10 focus-visible:-outline-offset-2! ${centred ? 'h-6' : 'h-5 touch:h-7'}`}
                onKeyDown={onRulerKeyDown}
              >
                {workSpan && (
                  <>
                    {/* the work area: a band over the ruler, an end of it dragged to move that point */}
                    <span className="pointer-events-none absolute inset-y-0 bg-brand/25" style={{ left: xOf(workSpan.inS), width: (workSpan.outS - workSpan.inS) * pxPerS }} />
                    {(['in', 'out'] as const).map((end) => (
                      <span
                        key={end}
                        data-testid={`work-area-${end}`}
                        title={end === 'in' ? t('timeline.workArea.in') : t('timeline.workArea.out')}
                        className="absolute inset-y-0 z-1 w-1.5 cursor-ew-resize touch-none bg-brand before:absolute before:-inset-x-2 before:inset-y-0 before:content-['']"
                        style={{ left: xOf(end === 'in' ? workSpan.inS : workSpan.outS) - (end === 'in' ? 0 : 6) }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          contentRef.current?.setPointerCapture(e.pointerId)
                          gestureRef.current = { kind: 'range', end }
                        }}
                      />
                    ))}
                  </>
                )}
                {ticks.map((t) => (
                  <span
                    key={t}
                    className={`${TICK} ${tickLabelFlips(xOf(t), contentWidth) ? '-translate-x-full border-r pr-[3px]' : 'border-l pl-[3px]'} ${centred ? 'leading-6' : 'leading-5 touch:leading-7'}`}
                    style={{ left: xOf(t) }}
                  >
                    {formatFilmTime(t)}
                  </span>
                ))}
              </RulerSlider>

              {sequence && (
                <div data-testid="timeline-lane" {...laneProps('stages')} role="group" aria-label={t('timeline.lane.stages')}>
                  {stageBlocks()}
                </div>
              )}

              <div data-testid="timeline-lane" data-lane="camera" {...laneProps('shots', true)} role="group" aria-label={t('timeline.lane.shots')}>
                {block(
                  'opening',
                  0,
                  flightStart,
                  opening.style === 'aucune' ? '' : t('timeline.shot.opening'),
                  opening.style === 'aucune' ? t('timeline.shot.openingNone') : t('timeline.shot.opening'),
                  opening.style === 'aucune' ? BLOCK_KINDS.shotNone : BLOCK_KINDS.shot,
                  opening.style === 'aucune' ? [] : ['end'],
                )}
                <div
                  className="absolute inset-y-[3px] box-border flex cursor-pointer items-center overflow-hidden rounded-sm bg-white/10 px-1.5 text-caption font-semibold"
                  style={{ left: xOf(flightStart), width: (flightEnd - flightStart) * pxPerS }}
                  aria-hidden="true"
                >
                  {profile && shownClock.flightS > 0 && (
                    <svg className="absolute inset-0 size-full" viewBox={`0 0 ${shownClock.flightS} ${PROFILE_HEIGHT}`} preserveAspectRatio="none">
                      <FlownClip frozen={frozenPlayback} clock={clock} id={clipId} flightStart={flightStart} />
                      <path className="fill-glacier opacity-35" d={area} />
                      <path className="fill-accent-light opacity-80" d={area} clipPath={`url(#${clipId})`} />
                    </svg>
                  )}
                  {/* the stops inside the flight: where the flyover holds */}
                  {shownClock.stops.map((s) => (
                    <span
                      key={s.id}
                      data-selected={s.id === selected || undefined}
                      className="pointer-events-none absolute inset-y-0 box-border min-w-[3px] border-t-[3px] border-accent-light before:absolute before:inset-0 before:bg-accent-light before:opacity-20 data-[selected]:border-t-white"
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
                          className="pointer-events-none absolute inset-y-0 box-border flex items-center overflow-hidden border-b-[3px] border-b-(color:--stage-color) px-1.5 whitespace-nowrap [&+&]:border-l-2 [&+&]:border-l-white"
                          style={{ left: (startS - flightStart) * pxPerS, width: (endS - startS) * pxPerS, ['--stage-color' as string]: color }}
                        />
                      )
                    })
                  ) : (
                    <span className={BLOCK_LABEL}>{t('timeline.flight.label', { distance: formatDistance(lengthM) })}</span>
                  )}
                </div>
                {shownClock.cameraKeys.map((k) => (
                  <div
                    key={k.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isPicked(k.id)}
                    data-item={k.id}
                    aria-label={t('timeline.key.shotAria', { distance: formatDistance(k.atM), time: formatFilmTime(k.timeS) })}
                    title={t('timeline.key.shotHint')}
                    data-testid="timeline-key"
                    className={`${KEY_DIAMOND}${centred ? ' aria-pressed:touch-none' : ''}`}
                    style={{ left: xOf(k.timeS) }}
                    onPointerDown={(e) => startEdit(e, k.id, 'move')}
                    onFocus={() => focusKey(k.id)}
                    onKeyDown={(e) => onBlockKeyDown(e, k.id)}
                  />
                ))}
                {block(
                  'closing',
                  flightEnd,
                  total,
                  closing.style === 'aucune' ? '' : t('timeline.shot.closing'),
                  closing.style === 'aucune' ? t('timeline.shot.closingNone') : t('timeline.shot.closing'),
                  closing.style === 'aucune' ? BLOCK_KINDS.shotNone : BLOCK_KINDS.shot,
                  closing.style === 'aucune' ? [] : ['start'],
                )}
              </div>

              <div data-testid="timeline-lane" data-lane="param:speed" {...laneProps('param:speed', true)} role="group" aria-label={PARAM_LANE_LABELS.speed}>
                {shownClock.speeds.map((s) => {
                  const label = formatSpeedFactor(s.factor)
                  const speedKey = s.factor > 1 ? 'timeline.speed.fast' : s.factor < 1 ? 'timeline.speed.slow' : 'timeline.speed.normal'
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    t(speedKey, { label, from: formatDistance(s.fromM), to: formatDistance(s.toM) }),
                    s.factor < 1 ? BLOCK_KINDS.slow : BLOCK_KINDS.speed,
                    ['start', 'move', 'end'],
                  )
                })}
                {keysOfParam(shownClock.paramKeys, 'speed').map(paramKeyDot)}
              </div>

              {paramLanes(shownClock).map((param) => (
                <div key={param} data-testid="timeline-lane" data-lane={`param:${param}`} {...laneProps(`param:${param}`)} role="group" aria-label={PARAM_LANE_LABELS[param]}>
                  {keysOfParam(shownClock.paramKeys, param).map(paramKeyDot)}
                </div>
              ))}

              {shownClock.markerKeys.length > 0 && (
                <div data-testid="timeline-lane" data-lane="marker" {...laneProps('marker')} role="group" aria-label={t('timeline.lane.marker')}>
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
                        aria-pressed={isPicked(k.id)}
                        data-item={k.id}
                        aria-label={t('timeline.key.markerAria', { what, distance: formatDistance(k.atM), time: formatFilmTime(k.timeS) })}
                        title={t('timeline.key.hint', { what })}
                        data-testid="timeline-key"
                        className={`${KEY_DOT}${centred ? ' aria-pressed:touch-none' : ''}`}
                        style={{ left: xOf(k.timeS), ...(dot ? { '--key-color': dot } : {}) } as CSSProperties}
                        onPointerDown={(e) => startEdit(e, k.id, 'move')}
                        onFocus={() => focusKey(k.id)}
                        onKeyDown={(e) => onBlockKeyDown(e, k.id)}
                      />
                    )
                  })}
                </div>
              )}

              <div data-testid="timeline-lane" {...laneProps('holds')} role="group" aria-label={t('timeline.lane.holds')}>
                {/* the nights of a multi-day track: no grip, the track places them and « Jours et nuits » sets how long */}
                {shownClock.nights.map((n, k) => {
                  const label = t('timeline.night.label', { n: k + 1 })
                  return block(nightItemId(n), n.startS, n.endS, label, t('timeline.night.description', { label }), BLOCK_KINDS.night, [], undefined, 'moon')
                })}
                {shownClock.stops.map((s) => {
                  const label = s.label || t('film.snap.hold')
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    t('timeline.hold.description', { camera: STOP_CAMERA_LABELS[s.camera].toLowerCase(), label, auto: shownFilm.autoStops ? t('timeline.hold.auto') : '' }),
                    shownFilm.autoStops ? BLOCK_KINDS.stopAuto : BLOCK_KINDS.stop,
                    ['move', 'end'],
                  )
                })}
              </div>

              <div data-testid="timeline-lane" {...laneProps('texts')} role="group" aria-label={t('timeline.lane.texts')}>
                {/* the opening title and the closing card (overlay settings): placed freely, edges and body */}
                {shownCards(shownOverlay).map((card) => {
                  const { startS, endS } = cardWindow(shownOverlay, card, shownClock)
                  return block(
                    card,
                    startS,
                    endS,
                    CARD_LABELS[card],
                    CARD_LABELS[card],
                    BLOCK_KINDS.card,
                    ['start', 'move', 'end'],
                    undefined,
                    'type',
                  )
                })}
                {/* the card of each stage « À la suite »: only its end edge moves (its duration) */}
                {stageCardsOf(shownClock, shownFilm, shownOverlay).map((c) =>
                  block(c.id, c.startS, c.endS, c.label, t('timeline.card.description', { label: c.label }), BLOCK_KINDS.card, ['move', 'end'], undefined, 'type'),
                )}
                {/* the card of each day of a multi-day track: only its end edge moves (the duration all of them share) */}
                {dayCardsOf(shownClock, shownFilm).map((c) =>
                  block(c.id, c.startS, c.endS, c.label, t('timeline.card.description', { label: c.label }), BLOCK_KINDS.card, ['end'], undefined, 'type'),
                )}
                {shownFilm.texts.map((item) =>
                  block(item.id, item.startS, item.startS + item.durationS, item.text || t('film.snap.text'), t('timeline.text.description', { text: item.text }), BLOCK_KINDS.text, [
                    'start',
                    'move',
                    'end',
                  ]),
                )}
              </div>

              <div data-testid="timeline-lane" {...laneProps('media')} role="group" aria-label={t('timeline.lane.media')}>
                {shownFilm.media.map((m) =>
                  block(
                    m.id,
                    m.startS,
                    m.startS + m.durationS,
                    mediaLabel(m),
                    t(m.kind === 'video' ? (m.layout === 'carte' ? 'timeline.media.videoCard' : 'timeline.media.videoFull') : m.layout === 'carte' ? 'timeline.media.photoCard' : 'timeline.media.photoFull', {
                      label: mediaLabel(m),
                    }),
                    BLOCK_KINDS.media,
                    ['start', 'move', 'end'],
                    pictures[m.src]?.thumb,
                    m.kind === 'video' ? 'video' : undefined,
                    m.kind === 'video' && !exporting ? (
                      <Filmstrip
                        key="filmstrip"
                        asset={pictures[m.src]}
                        inS={m.inS ?? 0}
                        outS={m.outS ?? pictures[m.src]?.durationS ?? 0}
                        count={filmstripCount(m.durationS * pxPerS)}
                      />
                    ) : undefined,
                  ),
                )}
              </div>

              <div data-testid="timeline-lane" {...laneProps('music')} role="group" aria-label={t('timeline.lane.music')}>
                {shownFilm.audio.length === 0 && (
                  <span className="pointer-events-none absolute inset-y-0 flex items-center pl-1.5 text-caption whitespace-nowrap text-glacier" style={{ left: xOf(0) }}>
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
                    BLOCK_KINDS.music,
                    ['start', 'move', 'end'],
                    undefined,
                    'music',
                    wave && (
                      <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${a.durationS} 1`} preserveAspectRatio="none" aria-hidden="true">
                        <path className="fill-glacier opacity-55" d={wave} />
                        {sound?.beats && <path className="fill-none stroke-glacier stroke-1 opacity-55 [vector-effect:non-scaling-stroke]" d={beatTicksPath(sound.beats, a.inS, lengthS)} />}
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
                  <div className="pointer-events-none absolute inset-y-0 z-3 w-px bg-accent-light" style={{ left: xOf(atS) }} aria-hidden="true">
                    <span className="absolute top-0.5 left-1 flex flex-col gap-0.5">
                      <span className="rounded-[2px] bg-accent-light px-1 text-caption whitespace-nowrap text-ink" data-testid="timeline-guide-tag">{t('timeline.stage.short', { n: stageDrag.to + 1 })}</span>
                    </span>
                  </div>
                )
              })()}
              <span className="sr-only" role="status" aria-live="polite">
                {announcement}
              </span>
              {/* what the dragged block is aligned with: a line across the lanes and the names of the targets */}
              {guides.length > 0 && (
                <div className="pointer-events-none absolute inset-y-0 z-3 w-px bg-accent-light" style={{ left: xOf(guides[0].timeS) }} aria-hidden="true">
                  <span className="absolute top-0.5 left-1 flex flex-col gap-0.5">
                    {guides.slice(0, 4).map((g, i) => (
                      <span key={`${g.label}-${i}`} className="rounded-[2px] bg-accent-light px-1 text-caption whitespace-nowrap text-ink" data-testid="timeline-guide-tag">
                        {g.label}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              <Playhead frozen={frozenPlayback} clock={clock} pad={pad} pxPerS={pxPerS} centred={centred} />
              {contextMenu && (
                <Menu label={t('timeline.menu.label')} items={contextMenu.items} point={{ x: contextMenu.x, y: contextMenu.y }} onClose={() => setContextMenu(null)} placement="bottom start" sheet />
              )}
              {marquee && (
                <div
                  data-testid="timeline-marquee"
                  className="pointer-events-none absolute z-3 box-border border border-accent-light bg-accent-light/15"
                  style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
