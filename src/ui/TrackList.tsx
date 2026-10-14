import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Track } from '../core/types'
import { isExportBusy, useExportStore } from '../export/store'
import { t, useT } from '../i18n'
import {
  RACE_CAMERA_LABELS,
  RACE_CAMERAS,
  RACE_SYNC_LABELS,
  RACE_SYNC_MODES,
  raceAt,
  rankRacers,
  syncNeedsTime,
} from '../flyover/race'
import type { Race, RaceCamera, RaceSettings, RaceSync, Racer } from '../flyover/race'
import { orderedTracks, playsInSequence } from '../flyover/sequence'
import { DEFAULT_JUNCTION, junctionDefaultOf, withDefaultCard, withDefaultJunction } from '../film/junctions'
import { dropIndexAt, idsByDate } from '../film/reorder'
import { edgeScrollSpeed } from '../film/timeline'
import { isTextEntry } from '../project/history'
import { editFilm, orderTracksByDate, reorderTracks } from '../scene/usePacing'
import {
  PACE_RANGE,
  PLAN_ACTIVITIES,
  PLAN_ACTIVITY_LABELS,
  localDayAndTime,
  localDepartureMs,
  localUtcOffsetMin,
  planActivityOf,
  withEstimatedTimes,
  withoutTimes,
} from '../plan/timing'
import type { PlanActivity } from '../plan/timing'
import { useRace } from '../scene/useRace'
import { useAppStore } from '../state/store'
import { computeTrackElevation, hasMissingElevation, withoutTerrainElevation } from '../terrain/elevation'
import { getTerrainSource } from '../terrain/sources'
import { formatClock, formatDistance, formatDistanceGap, formatNumber, formatTimeGap, formatTrackSummary } from './format'
import { Icon } from './icons'
import { JunctionTransitionFields } from './JunctionFields'
import { chainLoadedTracks, chooseTracksToImport } from './projectActions'
import { StravaDialog } from './StravaImport'
import './trackElevation.css'
import { Button, Menu, Radio, RadioGroup, Select, Switch, Tip } from './primitives'

/** Progress steps the leaderboard follows: a few renders per second of its own rows, not one per frame. */
const PROGRESS_STEPS = 1000

/** Hint under the sync select. */
const SYNC_HINTS: Record<RaceSync, string> = {
  get elapsed() { return t('track.syncHint.elapsed') },
  get clock() { return t('track.syncHint.clock') },
  get distance() { return t('track.syncHint.distance') },
}

function gapLabel(racer: Racer): string {
  if (racer.gapMs !== undefined) return formatTimeGap(racer.gapMs)
  if (racer.gapM !== undefined) return formatDistanceGap(racer.gapM)
  return t('track.gapRef')
}

/** Live leaderboard: subscribes to the (quantised) playback progress on its own. */
function RaceBoard({ race, tracks }: { race: Race; tracks: readonly Track[] }) {
  const t = useT()
  const progress = useAppStore((s) => Math.round(s.playback.progress * PROGRESS_STEPS) / PROGRESS_STEPS)
  const racers = rankRacers(raceAt(race, progress))

  return (
    <ol className="race__board" aria-label={t('track.board')}>
      {racers.map((racer) => {
        const track = tracks[racer.index]
        if (!track) return null
        return (
          <li key={track.id} className="race__row">
            <span className="race__swatch" style={{ background: track.color }} aria-hidden="true" />
            <span className="race__name" title={track.name}>
              {track.name}
            </span>
            <span className="race__distance">{formatDistance(racer.distanceM)}</span>
            <span className="race__gap" title={racer.index === 0 ? t('track.boardRef') : undefined}>
              {gapLabel(racer)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** « Plusieurs traces »: how the film plays two tracks or more. */
const MULTI_MODES = ['une', 'suite', 'parallele'] as const
type MultiMode = (typeof MULTI_MODES)[number]
const MULTI_MODE_LABELS: Record<MultiMode, string> = {
  get une() { return t('track.mode.une') },
  get suite() { return t('track.mode.suite') },
  get parallele() { return t('track.mode.parallele') },
}
const MULTI_MODE_HINTS: Record<MultiMode, string> = {
  get une() { return t('track.mode.une') },
  get suite() { return t('track.mode.suite') },
  get parallele() { return t('track.mode.parallele') },
}

function multiModeOf(race: RaceSettings, count: number): MultiMode {
  if (race.enabled) return 'parallele'
  return playsInSequence(race, count) ? 'suite' : 'une'
}

/** The race settings for a mode: the ghost race and the sequence never both on. */
function withMultiMode(race: RaceSettings, mode: MultiMode): RaceSettings {
  const { sequence: _sequence, ...rest } = race
  if (mode === 'parallele') return { ...rest, enabled: true }
  if (mode === 'suite') return { ...rest, enabled: false, sequence: true }
  return { ...rest, enabled: false }
}

/**
 * « À la suite »: the transition between two stages and the card of each stage as the film makes them by default
 * (`film.junctionDefault`); each junction and each card is set on the timeline (« Étapes » lane), where it keeps its own.
 */
function StageDefaults() {
  const t = useT()
  const film = useAppStore((s) => s.settings.film)
  const { kind, holdS, card } = junctionDefaultOf(film)
  return (
    <>
      <JunctionTransitionFields
        kind={kind}
        holdS={holdS || DEFAULT_JUNCTION.holdS}
        onChange={(patch) => editFilm((f) => ({ film: withDefaultJunction(f, patch) }), { step: patch.kind !== undefined })}
      />
      <Switch checked={card} onChange={(on) => editFilm((f) => ({ film: withDefaultCard(f, on) }))}>
        {t('track.stageCard')}
      </Switch>
      <p className="field__hint">{t('track.stageHint')}</p>
    </>
  )
}

/**
 * « Plusieurs traces » (2+ tracks): the first one alone, « À la suite » (stages, their transition and cards) or
 * « En parallèle » (the ghost race: sync, what the camera follows, leaderboard).
 */
function RacePanel({ tracks }: { tracks: readonly Track[] }) {
  const t = useT()
  const id = useId()
  const settings = useAppStore((s) => s.settings.race)
  const leaderboard = useAppStore((s) => s.settings.overlay.leaderboard)
  const overlayOn = useAppStore((s) => s.settings.overlay.enabled)
  const setSetting = useAppStore((s) => s.setSetting)
  const flyTrack = useAppStore((s) => s.flyTrack)
  const busy = useExportStore((s) => isExportBusy(s.phase))
  const race = useRace()
  if (!race) return null
  const mode = multiModeOf(settings, tracks.length)
  const set = (patch: Partial<RaceSettings>) => setSetting('race', { ...settings, ...patch })
  /** a track of the list is followed by making it the first one; the other entries are camera modes */
  const followCamera = (value: string) => {
    if ((RACE_CAMERAS as readonly string[]).includes(value)) set({ camera: value as RaceCamera })
    else {
      set({ camera: 'premiere' })
      flyTrack(value)
    }
  }
  const camera = settings.camera ?? 'premiere'

  return (
    <div className="settings race" role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="field__label">
        {t('track.race.title')}
      </h3>
      <RadioGroup
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-mode-hint`}
        value={mode}
        disabled={busy}
        onChange={(m) => setSetting('race', withMultiMode(settings, m))}
      >
        {MULTI_MODES.map((m) => (
          <Radio key={m} value={m}>
            {MULTI_MODE_LABELS[m]}
          </Radio>
        ))}
      </RadioGroup>
      <p id={`${id}-mode-hint`} className="field__hint">
        {MULTI_MODE_HINTS[mode]}
      </p>

      {mode === 'suite' && <StageDefaults />}

      <div className="field" hidden={mode !== 'parallele'}>
        <label className="field__label" htmlFor={`${id}-sync`}>
          {t('track.race.sync')}
        </label>
        <Select
          id={`${id}-sync`}
          value={race.sync}
          aria-describedby={`${id}-sync-hint`}
          options={RACE_SYNC_MODES.map((mode) => ({ value: mode, label: RACE_SYNC_LABELS[mode], disabled: syncNeedsTime(mode) && !race.timed }))}
          onChange={(sync) => setSetting('race', { ...settings, sync })}
        />
        <p id={`${id}-sync-hint`} className="field__hint">
          {race.timed
            ? SYNC_HINTS[race.sync]
            : t('track.race.untimed')}
        </p>
      </div>

      {settings.enabled && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-camera`}>
              {t('track.race.cameraOn')}
            </label>
            <Select
              id={`${id}-camera`}
              value={camera}
              disabled={busy}
              options={[
                { value: 'premiere', label: tracks[0].name },
                ...tracks.slice(1).map((other) => ({ value: other.id, label: other.name })),
                ...RACE_CAMERAS.filter((c) => c !== 'premiere').map((c) => ({ value: c, label: RACE_CAMERA_LABELS[c] })),
              ]}
              onChange={followCamera}
            />
          </div>
          <Switch
            checked={leaderboard.enabled}
            onChange={(on) => {
              const { overlay } = useAppStore.getState().settings
              setSetting('overlay', { ...overlay, leaderboard: { ...overlay.leaderboard, enabled: on } })
            }}
          >
            {t('track.race.board')}
          </Switch>
          {leaderboard.enabled && !overlayOn && <p className="field__hint">{t('track.race.boardNeedsOverlay')}</p>}
          <RaceBoard race={race} tracks={tracks} />
          <p className="field__hint">{t('track.race.gap')}</p>
        </>
      )}
    </div>
  )
}

/** « + Ajouter »: a menu to pick more GPX / FIT files or import Strava activities. */
function AddTracksMenu() {
  const t = useT()
  const loading = useAppStore((s) => s.loading)
  const [strava, setStrava] = useState(false)

  return (
    <>
      <Menu
        label={t('track.add.menu')}
        items={[
          { id: 'files', label: t('track.add.files'), icon: <Icon name="upload" size={18} />, onSelect: () => void chooseTracksToImport() },
          { id: 'strava', label: t('track.add.strava'), icon: <Icon name="route" size={18} />, onSelect: () => setStrava(true) },
        ]}
        trigger={
          <Button size="sm" disabled={loading}>
            <Icon name="plus" size={16} />
            {t('track.add.button')}
          </Button>
        }
      />
      <StravaDialog open={strava} onClose={() => setStrava(false)} />
    </>
  )
}

/** « Enchaîner en un seul parcours » (2+ tracks): one continuous film instead of a ghost race. */
function ChainTracks({ tracks }: { tracks: readonly Track[] }) {
  const t = useT()
  const id = useId()
  const loading = useAppStore((s) => s.loading)
  return (
    <div className="field tracks__chain">
      <Button
        block
        onClick={() => chainLoadedTracks(tracks)}
        disabled={loading}
        aria-describedby={`${id}-hint`}
      >
        <Icon name="spline" size={16} />
        {t('track.chain.button')}
      </Button>
      <p id={`${id}-hint`} className="field__hint">
        {t('track.chain.hint')}
      </p>
    </div>
  )
}

/** Replace one track of the list by its new version (same id: estimated times or computed elevation written or cleared). */
function replaceTrack(next: Track): void {
  const { tracks, replaceTracks } = useAppStore.getState()
  replaceTracks(tracks.map((t) => (t.id === next.id ? next : t)))
}

/** Departure shown when the form opens: the estimated one, else tomorrow at 8 h. */
function initialDeparture(track: Track): { day: string; time: string } {
  if (track.stats.startTime !== undefined) return localDayAndTime(track.stats.startTime)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { day: localDayAndTime(tomorrow.getTime()).day, time: '08:00' }
}

/**
 * « Prévoir la sortie » (untimed or already estimated track): departure, activity and pace give estimated times on
 * every point, so the sun, the counters and the weather forecast follow the planned outing.
 */
function OutingPlanForm({ track }: { track: Track }) {
  const t = useT()
  const id = useId()
  const [departure, setDeparture] = useState(() => initialDeparture(track))
  const [activity, setActivity] = useState<PlanActivity>(() => planActivityOf(track.activityType))
  const [pace, setPace] = useState(1)
  const departureMs = localDepartureMs(departure.day, departure.time)
  const { startTime, endTime } = track.stats

  function apply(e: FormEvent) {
    e.preventDefault()
    if (departureMs === undefined) return
    replaceTrack(withEstimatedTimes(track, { activity, pace, departureMs, utcOffsetMin: localUtcOffsetMin(departureMs) }))
  }

  return (
    <details className="track__plan weather__details">
      <summary className="weather__details-summary">
        {t('track.plan.title')}
        <Icon name="chevron-down" size={16} />
      </summary>
      <form className="track__plan-form" onSubmit={apply}>
        <div className="track__plan-row">
          <div className="field">
            <label className="field__label" htmlFor={`${id}-day`}>
              {t('track.plan.date')}
            </label>
            <input
              id={`${id}-day`}
              className="input"
              type="date"
              required
              value={departure.day}
              onChange={(e) => setDeparture({ ...departure, day: e.currentTarget.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-time`}>
              {t('track.plan.departure')}
            </label>
            <input
              id={`${id}-time`}
              className="input"
              type="time"
              required
              value={departure.time}
              onChange={(e) => setDeparture({ ...departure, time: e.currentTarget.value })}
            />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-activity`}>
            {t('track.plan.activity')}
          </label>
          <Select
            id={`${id}-activity`}
            value={activity}
            options={PLAN_ACTIVITIES.map((a) => ({ value: a, label: PLAN_ACTIVITY_LABELS[a] }))}
            onChange={(a) => setActivity(a)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-pace`}>
            {t('track.plan.pace')}
          </label>
          <div className="range-row">
            <input
              id={`${id}-pace`}
              className="range"
              type="range"
              min={PACE_RANGE.min}
              max={PACE_RANGE.max}
              step={PACE_RANGE.step}
              value={pace}
              aria-describedby={`${id}-pace-hint`}
              onChange={(e) => setPace(Number(e.currentTarget.value))}
            />
            <output className="range-row__value" htmlFor={`${id}-pace`}>
              ×{formatNumber(pace, 2)}
            </output>
          </div>
          <p id={`${id}-pace-hint`} className="field__hint">
            {t('track.plan.paceHint')}
          </p>
        </div>
        <Button variant="primary" block type="submit" disabled={departureMs === undefined}>
          {t('track.plan.compute')}
        </Button>
        {track.timesEstimated && startTime !== undefined && endTime !== undefined && (
          <>
            <p className="field__hint">
              {t('track.plan.times', { start: formatClock(startTime), end: formatClock(endTime) })}
            </p>
            <Button block onClick={() => replaceTrack(withoutTimes(track))}>
              {t('track.plan.clear')}
            </Button>
          </>
        )}
      </form>
    </details>
  )
}

/**
 * Elevation read from the terrain (src/terrain/elevation.ts): « Calculer l'altitude » on a track with points without
 * one (the import computes it by itself when it costs few tiles), « Effacer l'altitude » on a track whose whole
 * elevation was computed.
 */
function TrackElevation({ track, busy }: { track: Track; busy: boolean }) {
  const t = useT()
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const missing = useMemo(() => hasMissingElevation(track), [track])
  const [computing, setComputing] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function compute() {
    setComputing(true)
    setNote(null)
    try {
      const next = await computeTrackElevation(track, getTerrainSource(terrainSourceId))
      if (next === track) setNote(t('track.elevation.none'))
      // the track may have been removed or replaced meanwhile, or an export started
      else if (useAppStore.getState().tracks.includes(track) && !isExportBusy(useExportStore.getState().phase)) replaceTrack(next)
    } catch {
      setNote(t('track.elevation.offline'))
    } finally {
      setComputing(false)
    }
  }

  if (track.elevationEstimated === 'all') {
    return (
      <div className="track__elevation">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => replaceTrack(withoutTerrainElevation(track))}
        >
          {t('track.elevation.clear')}
        </Button>
      </div>
    )
  }
  if (track.elevationEstimated || !missing) return null
  return (
    <div className="track__elevation">
      <Tip text={t('track.elevation.tip')}>
        <Button
          size="sm"
          disabled={busy || computing}
          onClick={() => void compute()}
        >
          {computing ? t('track.elevation.computing') : t('track.elevation.compute')}
        </Button>
      </Tip>
      {note && (
        <p className="field__hint" role="status">
          {note}
        </p>
      )}
    </div>
  )
}

/** Touch: the handle is held this long before the card lifts (a shorter touch scrolls the panel). */
const LONG_PRESS_MS = 350
/** Travel of the pointer (px) that starts a drag with a mouse, and that cancels a long press on touch. */
const MOUSE_SLOP_PX = 4
const TOUCH_SLOP_PX = 8
/** The panel scrolls by itself when the pointer is this close to its top or bottom (px). */
const EDGE_SCROLL_PX = 40

/** A drag of a card in progress: `to` is the place it would take (among the others) if released now. */
interface ListDrag {
  id: string
  touch: boolean
  startY: number
  scroll0: number
  y: number
  to: number
  active: boolean
  timer: number
  frame: number
  timeMs: number
}

/** The nearest ancestor that scrolls vertically. */
function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/**
 * One card per imported track, with a delete button; « À la suite »: the cards are the stages in order, moved by their
 * handle (mouse, or touch after a long press), by Alt + ↑ ↓, or sorted by date. Chaining and « Plusieurs traces » from
 * two tracks.
 */
export function TrackList() {
  const t = useT()
  const tracks = useAppStore((s) => s.tracks)
  const race = useAppStore((s) => s.settings.race)
  const removeTrack = useAppStore((s) => s.removeTrack)
  const setTrackColor = useAppStore((s) => s.setTrackColor)
  const flyTrack = useAppStore((s) => s.flyTrack)
  const inSequence = useAppStore((s) => playsInSequence(s.settings.race, s.tracks.length))
  const busy = useExportStore((s) => isExportBusy(s.phase))
  /** the list in the order of the stages « À la suite », the list order otherwise */
  const shown = useMemo(() => orderedTracks(tracks, race), [tracks, race])
  const listRef = useRef<HTMLUListElement>(null)
  const dragRef = useRef<ListDrag | null>(null)
  /** the card lifted, how far the pointer took it, and the place it would take */
  const [drag, setDrag] = useState<{ id: string; dy: number; to: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  /** the handle to focus again once the list is drawn in its new order (a moved node loses the focus) */
  const focusRef = useRef<string | null>(null)
  useEffect(() => {
    const id = focusRef.current
    focusRef.current = null
    if (id) [...(listRef.current?.querySelectorAll<HTMLElement>('.track__handle') ?? [])].find((h) => h.dataset.id === id)?.focus()
  })

  const endDrag = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d) {
      clearTimeout(d.timer)
      cancelAnimationFrame(d.frame)
    }
    setDrag(null)
    return d
  }
  useEffect(() => () => void endDrag(), [])
  const lifted = drag !== null
  useEffect(() => {
    if (!lifted) return
    // Escape puts the lifted card back
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') endDrag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lifted])

  const move = (track: Track, to: number) => {
    if (!reorderTracks(track.id, to)) return
    focusRef.current = track.id
    setAnnouncement(t('track.list.moved', { name: track.name, position: Math.min(shown.length, Math.max(1, to + 1)), total: shown.length }))
  }

  /** the pointer is at `clientY`: the place it leaves the lifted card, and how far it has taken it (the panel may have scrolled) */
  const follow = (clientY: number) => {
    const d = dragRef.current
    const list = listRef.current
    if (!d?.active || !list) return
    d.y = clientY
    const centres = [...list.children]
      .filter((li) => (li as HTMLElement).dataset.id !== d.id)
      .map((li) => {
        const r = li.getBoundingClientRect()
        return r.top + r.height / 2
      })
    d.to = dropIndexAt(centres, clientY)
    const dy = clientY - d.startY + ((scrollParentOf(list)?.scrollTop ?? 0) - d.scroll0)
    setDrag((was) => (was && was.dy === dy && was.to === d.to ? was : { id: d.id, dy, to: d.to }))
  }
  /** the card is lifted: the pointer moves it, and the panel scrolls by itself while the pointer is at its edge */
  const lift = () => {
    const d = dragRef.current
    if (!d || d.active) return
    d.active = true
    navigator.vibrate?.(15)
    const tick = (now: number) => {
      const current = dragRef.current
      if (!current?.active) return
      const scroller = scrollParentOf(listRef.current)
      const dt = current.timeMs > 0 ? Math.min(0.05, (now - current.timeMs) / 1000) : 0
      current.timeMs = now
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        const speed = edgeScrollSpeed(current.y, rect.top, rect.bottom, EDGE_SCROLL_PX, 600)
        const before = scroller.scrollTop
        if (speed !== 0) scroller.scrollTop += speed * dt
        if (scroller.scrollTop !== before) follow(current.y)
      }
      current.frame = requestAnimationFrame(tick)
    }
    d.frame = requestAnimationFrame(tick)
    follow(d.y)
  }
  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>, track: Track) => {
    if (e.button !== 0 || !e.isPrimary || busy || dragRef.current) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const touch = e.pointerType === 'touch'
    const scroll0 = scrollParentOf(listRef.current)?.scrollTop ?? 0
    const d: ListDrag = { id: track.id, touch, startY: e.clientY, scroll0, y: e.clientY, to: shown.indexOf(track), active: false, timer: 0, frame: 0, timeMs: 0 }
    dragRef.current = d
    // a finger has to hold: a slide is the scroll of the panel
    if (touch) d.timer = window.setTimeout(lift, LONG_PRESS_MS)
  }
  const onHandleMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d) return
    d.y = e.clientY
    if (d.active) return follow(e.clientY)
    if (Math.abs(e.clientY - d.startY) <= (d.touch ? TOUCH_SLOP_PX : MOUSE_SLOP_PX)) return
    if (d.touch) endDrag()
    else lift()
  }
  const onHandleUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = endDrag()
    if (!d?.active || e.type !== 'pointerup') return
    const track = shown.find((other) => other.id === d.id)
    if (track) move(track, d.to)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLLIElement>, track: Track, index: number) => {
    if (!inSequence || busy || !e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || isTextEntry(e.target)) return
    e.preventDefault()
    move(track, index + (e.key === 'ArrowUp' ? -1 : 1))
  }

  const others = drag ? shown.filter((other) => other.id !== drag.id) : []
  /** the card the insertion line is drawn against, and on which side */
  const dropMark =
    drag && others.length > 0 && drag.to !== shown.findIndex((other) => other.id === drag.id)
      ? drag.to < others.length
        ? { id: others[drag.to].id, side: 'before' }
        : { id: others[others.length - 1].id, side: 'after' }
      : null
  const sortedByDate = idsByDate(shown).every((id, k) => id === shown[k].id)

  return (
    <section aria-labelledby="tracks-title">
      <div className="section-head">
        <h2 id="tracks-title" className="section-title">
          {t('track.list.title')}
        </h2>
        <div className="section-head__actions">
          <AddTracksMenu />
        </div>
      </div>
      {tracks.length === 0 ? (
        <p className="tracks__empty">{t('track.list.empty')}</p>
      ) : (
        <ul className="tracks" ref={listRef}>
          {shown.map((track, index) => (
            <li
              key={track.id}
              data-id={track.id}
              data-testid="track-card"
              data-lifted={drag?.id === track.id ? '' : undefined}
              data-drop={dropMark?.id === track.id ? dropMark.side : undefined}
              className={`track${inSequence ? ' track--sortable' : ''}${drag?.id === track.id ? ' track--lifted' : ''}${dropMark?.id === track.id ? ` track--drop-${dropMark.side}` : ''}`}
              style={drag?.id === track.id ? { transform: `translateY(${drag.dy}px)` } : undefined}
              onKeyDown={(e) => onKeyDown(e, track, index)}
            >
              {inSequence && (
                <Tip text={t('track.list.moveTip')} side="right">
                  <button
                    type="button"
                    className="track__handle"
                    data-id={track.id}
                    aria-label={t('track.list.moveAria', { name: track.name })}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    disabled={busy}
                    onPointerDown={(e) => onHandleDown(e, track)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <Icon name="grip-vertical" size={16} />
                  </button>
                </Tip>
              )}
              <Tip text={t('track.list.colorTip')}>
                <label className="track__swatch" style={{ background: track.color }}>
                  <input
                    type="color"
                    className="track__color"
                    value={track.color}
                    aria-label={t('track.list.colorAria', { name: track.name })}
                    onChange={(e) => setTrackColor(track.id, e.currentTarget.value)}
                  />
                </label>
              </Tip>
              <span className="track__name" data-testid="track-name" title={track.name}>
                {track.name}
              </span>
              {index > 0 && inSequence && (
                <Tip text={t('track.list.upTip')} side="left">
                  <button
                    type="button"
                    className="track__fly"
                    aria-label={t('track.list.upAria', { name: track.name })}
                    disabled={busy}
                    onClick={() => move(track, index - 1)}
                  >
                    <Icon name="chevron-up" size={16} />
                  </button>
                </Tip>
              )}
              {index > 0 && !inSequence && (
                <Tip text={t('track.list.flyTip')} side="left">
                  <button
                    type="button"
                    className="track__fly"
                    aria-label={t('track.list.flyAria', { name: track.name })}
                    disabled={busy}
                    onClick={() => flyTrack(track.id)}
                  >
                    <Icon name="navigation" size={16} />
                  </button>
                </Tip>
              )}
              <Tip text={t('common.delete')} side="left">
                <button
                  type="button"
                  className="track__delete"
                  aria-label={t('track.list.deleteAria', { name: track.name })}
                  disabled={busy}
                  onClick={() => removeTrack(track.id)}
                >
                  <Icon name="x" size={16} />
                </button>
              </Tip>
              <span className="track__meta">
                {formatTrackSummary(track.stats)}
                {track.timesEstimated && <span className="track__badge" data-testid="track-badge">{t('track.list.timesEstimated')}</span>}
                {track.elevationEstimated && (
                  <span className="track__badge" data-testid="track-badge" title={t('track.list.elevationTip')}>
                    {track.elevationEstimated === 'all' ? t('track.list.elevationAll') : t('track.list.elevationSome')}
                  </span>
                )}
              </span>
              <TrackElevation track={track} busy={busy} />
              {(track.timesEstimated || track.stats.startTime === undefined) && <OutingPlanForm track={track} />}
            </li>
          ))}
        </ul>
      )}
      {inSequence && (
        <Tip text={t('track.list.sortTip')}>
          <Button
            size="sm"
            className="tracks__sort"
            disabled={busy || sortedByDate}
            onClick={() => {
              if (orderTracksByDate()) setAnnouncement(t('track.list.sorted'))
            }}
          >
            {t('track.list.sort')}
          </Button>
        </Tip>
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {tracks.length >= 2 && <ChainTracks tracks={tracks} />}
      {tracks.length >= 2 && <RacePanel tracks={tracks} />}
    </section>
  )
}
