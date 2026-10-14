import { useId, useMemo } from 'react'
import type { ReactNode } from 'react'
import { t, useT } from '../i18n'
import { formatDate } from '../i18n/format'
import { DUCK_DB, fitFilmToMusic, musicLengthS, snapFilmToMusic } from '../film/audio'
import { CARD_LABELS, TITLE_CARD_ID, cardShown, isCardItem } from '../film/cards'
import { DEFAULT_JUNCTION, applyToAllJunctions, hasOwnTransition, isJunctionItem, isStageCardItem, isStageItem, junctionCardOf, junctionOf, junctionTrackOf, resetJunction, stageCardAfterOf, stageCardId, stageCardWindow, stageFlightS, stageTrackOf, withJunction, withJunctionCard, withStageDuration } from '../film/junctions'
import { useMediaStore } from '../film/media'
import {
  AUDIO_DURATION_RANGE,
  DIP_DEFAULT_S,
  DIP_DURATION_RANGE,
  FADE_RANGE,
  ITEM_DURATION_RANGE,
  MEDIA_LAYOUTS,
  NIGHT_PARTS,
  NIGHT_PART_RANGE,
  SHOT_DURATION_RANGE,
  SHOT_STYLES,
  SHOT_TRANSITIONS,
  SHOT_TRANSITION_LABELS,
  SITUATION_BEARING_RANGE,
  SITUATION_DISTANCE_KM_RANGE,
  SITUATION_HEADINGS,
  SITUATION_HEADING_LABELS,
  SITUATION_HEADROOM_RANGE,
  SITUATION_HOLD_RANGE,
  SITUATION_TILT_DEFAULT_DEG,
  SITUATION_TILT_RANGE,
  STAGE_DURATION_RANGE,
  START_HEIGHTS,
  START_HEIGHT_LABELS,
  STOP_CAMERAS,
  STOP_CAMERA_LABELS,
  STOP_DURATION_RANGE,
  SYNC_OFFSET_RANGE,
  shotDipColor,
  situationTiming,
  shotSunOf,
} from '../film/model'
import type { Film, FilmShot, MediaLayout, MediaSync, ShotStyle, ShotSun, ShotTransition, StopCamera } from '../film/model'
import { FILM_PARAMS, PARAM_SPECS, paramAt, paramBase } from '../film/paramKeys'
import { getPlatform } from '../platform'
import { AVATAR_SIZE_PX, fileToAvatarDataUrl } from '../scene/markerBadge'
import { MARKER_FIGURE_CHOICES, MARKER_FIGURE_LABELS, MARKER_KIND_LABELS, MARKER_KINDS, MARKER_LABEL_MODE_LABELS, MARKER_SIZE_RANGE } from '../scene/markerSettings'
import type { FilmParam } from '../film/paramKeys'
import {
  addItemCamera,
  attachToStop,
  clipSyncOffsetS,
  formatFilmTime,
  formatSpeedFactor,
  removeFilmItem,
  setFilmPlace,
  updateCameraKey,
  updateMarkerKey,
  updateMedia,
  updateMusic,
  updateParamKey,
  updateShot,
  updateSpeed,
  updateStop,
  syncClip,
  syncClipPlacement,
  updateText,
} from '../film/timeline'
import { cameraKeyEaseM, keyedCamera } from '../flyover/cameraKeys'
import { CAMERA_RANGES } from '../flyover/cameraSettings'
import { buildTrackPath } from '../flyover/path'
import { SHOT_SUN_HOURS } from '../flyover/sun'

/** Hint of each « Soleil » choice, [opening, closing]. */
const SHOT_SUN_HINTS: Record<ShotSun, readonly [string, string]> = {
  get jour() {
    return [t('inspector.shot.sunHint.day.opening'), t('inspector.shot.sunHint.day.closing')] as const
  },
  get survol() {
    return [t('inspector.shot.sunHint.flyover.opening'), t('inspector.shot.sunHint.flyover.closing')] as const
  },
  get accelere() {
    return [
      t('inspector.shot.sunHint.accelerated.opening', { hours: SHOT_SUN_HOURS }),
      t('inspector.shot.sunHint.accelerated.closing', { hours: SHOT_SUN_HOURS }),
    ] as const
  },
}
import { REGION_KIND_LABELS, candidateId, captureFraming, useRegionStore } from '../osm/region'
import { WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { disableCard, editFilm, useFilmClock, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { AnchorPicker } from './AnchorPicker'
import { CardFields } from './CardFields'
import { formatDegrees, formatDistance, formatNumber, formatPercent, formatSecondsShort, formatShort } from './format'
import { Icon } from './icons'
import { FilmTextStyleFields } from './OverlayPanel'
import { RegionHint } from './CameraPanel'
import { InfoTip, RangeField, SettingRow } from './PanelSection'
import { JunctionTransitionFields, StageCardFields } from './JunctionFields'
import { showToast } from './toast'
import { Button, Checkbox, ColorField, NumberField, Radio, RadioGroup, Select, Switch, TextField, Tip } from './primitives'

/** The inspector's own layout strings (labels are `type-label`, hints `type-hint`): a field, a group of fields, a label and its tip, two fields side by side, a secondary button. */
const FIELD = 'flex flex-col gap-1'
const FIELDSET = `${FIELD} min-w-0`
const LABEL_ROW = 'flex items-center gap-1'
const HINT = 'type-hint tabular-nums'
const ROW = 'grid grid-cols-2 gap-2'
const REMOVE = 'min-h-control justify-self-start'

const SHOT_STYLE_LABELS: Record<ShotStyle, string> = {
  get aucune() {
    return t('inspector.shot.style.aucune')
  },
  get descente() {
    return t('inspector.shot.style.descente')
  },
  get saut() {
    return t('inspector.shot.style.saut')
  },
  get situation() {
    return t('inspector.shot.style.situation')
  },
  get balayage() {
    return t('inspector.shot.style.balayage')
  },
}
const SHOT_HINTS: Record<ShotStyle, string> = {
  get aucune() {
    return t('inspector.shot.styleHint.aucune')
  },
  get descente() {
    return t('inspector.shot.styleHint.descente')
  },
  get saut() {
    return t('inspector.shot.styleHint.saut')
  },
  get situation() {
    return t('inspector.shot.styleHint.situation')
  },
  get balayage() {
    return t('inspector.shot.styleHint.balayage')
  },
}
const TRANSITION_HINTS: Record<ShotTransition, string> = {
  get enchaine() {
    return t('inspector.shot.transitionHint.enchaine')
  },
  get coupe() {
    return t('inspector.shot.transitionHint.coupe')
  },
  get 'fondu-noir'() {
    return t('inspector.shot.transitionHint.fondu-noir')
  },
  get 'fondu-blanc'() {
    return t('inspector.shot.transitionHint.fondu-blanc')
  },
}

/** Titled group of fields of a shot (« Lieu », « Durées », « Cadrage » of a 'situation' shot; « Soleil »). */
function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="flex flex-col gap-3 border-t border-edge pt-3" aria-labelledby={id}>
      <h3 id={id} className="type-hint font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * « Durées » of a 'situation' shot: « Maintien » on the region view, then the move (« Plongée » at the opening,
 * « Remontée » at the closing, held after it); the shot lasts their sum (`durationS`, read by the clock and the
 * timeline), at most SHOT_DURATION_RANGE.max: a longer move shortens the hold, never the other way.
 */
function SituationTimings({
  phase,
  durationS,
  holdS,
  onChange,
}: {
  phase: 'opening' | 'closing'
  durationS: number
  holdS: number | undefined
  onChange(patch: { durationS: number; holdS: number | undefined }): void
}) {
  const t = useT()
  const timing = situationTiming({ durationS, holdS })
  const max = SHOT_DURATION_RANGE.max
  const set = (hold: number, move: number) => {
    const moveS = Math.min(Math.max(move, SHOT_DURATION_RANGE.min), max)
    const kept = Math.min(hold, max - moveS)
    onChange({ durationS: kept + moveS, holdS: kept > 0 ? kept : undefined })
  }
  return (
    <InspectorGroup title={t('inspector.timings.title')}>
      <RangeField
        label={t('inspector.timings.hold')}
        {...SITUATION_HOLD_RANGE}
        value={timing.holdS}
        format={seconds}
        onChange={(hold) => set(hold, timing.moveS)}
        wide={false}
        tip={
          phase === 'opening'
            ? t('inspector.timings.holdTipOpening')
            : t('inspector.timings.holdTipClosing')
        }
      />
      <RangeField
        label={phase === 'opening' ? t('inspector.timings.moveOpening') : t('inspector.timings.moveClosing')}
        {...SHOT_DURATION_RANGE}
        value={timing.moveS}
        format={seconds}
        onChange={(move) => set(timing.holdS, move)}
        wide={false}
        tip={
          phase === 'opening'
            ? t('inspector.timings.moveTipOpening')
            : t('inspector.timings.moveTipClosing')
        }
      />
      <p className={HINT}>{t('inspector.timings.shotDuration', { duration: seconds(durationS) })}</p>
    </InspectorGroup>
  )
}

/**
 * « Cadrage » of the region view of a 'situation' shot: start (end) height, distance (« Auto » at the left of its
 * slider), tilt, heading free or north up with its bearing, « Capturer la vue actuelle »; the headroom in « Plus de
 * réglages ». Every field left at its default keeps the automatic framing.
 */
function SituationFramingFields({
  phase,
  shot,
  onChange,
}: {
  phase: 'opening' | 'closing'
  shot: FilmShot
  onChange(patch: Partial<FilmShot>): void
}) {
  const t = useT()
  const id = useId()
  const heading = shot.heading ?? 'libre'
  const capture = () => {
    const framing = captureFraming(shot.highlight === true)
    if (!framing) return void showToast({ kind: 'error', text: t('inspector.framing.unavailable') })
    onChange({ ...framing, heading: 'boussole' })
    showToast({ kind: 'success', text: t('inspector.framing.captured') })
  }
  return (
    <InspectorGroup title={t('inspector.framing.title')}>
      <div className={FIELD}>
        <label className="type-label" htmlFor={`${id}-height`}>
          {phase === 'opening' ? t('inspector.framing.startHeight') : t('inspector.framing.endHeight')}
        </label>
        <Select
          id={`${id}-height`}
          value={shot.startHeight ?? 'region'}
          disabled={shot.distanceKm !== undefined}
          options={START_HEIGHTS.map((height) => ({ value: height, label: START_HEIGHT_LABELS[height] }))}
          onChange={(startHeight) => onChange({ startHeight })}
        />
      </div>
      <RangeField
        label={t('inspector.framing.distance')}
        min={0}
        max={SITUATION_DISTANCE_KM_RANGE.max}
        step={SITUATION_DISTANCE_KM_RANGE.step}
        value={shot.distanceKm ?? 0}
        format={(km) => (km === 0 ? t('inspector.framing.auto') : `${formatNumber(km)} km`)}
        onChange={(km) => onChange({ distanceKm: km === 0 ? undefined : Math.max(km, SITUATION_DISTANCE_KM_RANGE.min) })}
        tip={t('inspector.framing.distanceTip')}
      />
      <RangeField
        label={t('inspector.framing.tilt')}
        {...SITUATION_TILT_RANGE}
        value={shot.tiltDeg ?? SITUATION_TILT_DEFAULT_DEG}
        format={formatDegrees}
        onChange={(tiltDeg) => onChange({ tiltDeg })}
        wide={false}
        tip={t('inspector.framing.tiltTip')}
      />
      <div className={FIELD}>
        <div className={LABEL_ROW}>
          <span id={`${id}-heading`} className="type-label">
            {t('inspector.framing.heading')}
          </span>
          <InfoTip text={t('inspector.framing.headingTip')} />
        </div>
        <RadioGroup aria-labelledby={`${id}-heading`} value={heading} onChange={(h) => onChange({ heading: h === 'libre' ? undefined : h })}>
          {SITUATION_HEADINGS.map((h) => (
            <Radio key={h} value={h}>
              {SITUATION_HEADING_LABELS[h]}
            </Radio>
          ))}
        </RadioGroup>
      </div>
      {heading === 'boussole' && (
        <RangeField
          label={t('inspector.framing.bearing')}
          {...SITUATION_BEARING_RANGE}
          value={shot.bearingDeg ?? 0}
          format={formatDegrees}
          onChange={(bearingDeg) => onChange({ bearingDeg: bearingDeg === 0 ? undefined : bearingDeg })}
          wide={false}
          tip={t('inspector.framing.bearingTip')}
        />
      )}
      <SettingRow label={t('inspector.framing.headroom')} value={t('inspector.framing.headroomValue', { value: formatNumber(shot.headroomPct ?? 0) })}>
        <RangeField
          label={t('inspector.framing.headroom')}
          {...SITUATION_HEADROOM_RANGE}
          value={shot.headroomPct ?? 0}
          format={(pct) => t('inspector.framing.headroomValue', { value: formatNumber(pct) })}
          onChange={(pct) => onChange({ headroomPct: pct === 0 ? undefined : pct })}
          wide={false}
          tip={t('inspector.framing.headroomTip')}
        />
      </SettingRow>
      <Tip text={t('inspector.framing.captureTip')}>
        <Button onClick={capture}>
          <Icon name="crosshair" size={16} />
          {t('inspector.framing.capture')}
        </Button>
      </Tip>
    </InspectorGroup>
  )
}

/**
 * « Lieu »: the place highlighted, among the areas that contain the track (smallest first, osm/region.ts), or the
 * automatic administrative region. A place saved but not offered (still loading, or no longer containing the track)
 * stays selected; the highlight then falls back to the automatic one.
 */
function PlaceSelect({ value, onChange }: { value: string | null; onChange(regionId: string | null): void }) {
  const t = useT()
  const id = useId()
  const candidates = useRegionStore((s) => s.candidates)
  const autoId = useRegionStore((s) => s.autoId)
  const loading = useRegionStore((s) => s.status === 'loading')
  const auto = candidates.find((c) => candidateId(c) === autoId)
  const known = value === null || candidates.some((c) => candidateId(c) === value)
  return (
    <div className={FIELD}>
      <div className={LABEL_ROW}>
        <label className="type-label" htmlFor={id}>
          {t('inspector.place.label')}
        </label>
        <InfoTip text={t('inspector.place.tip')} />
      </div>
      <Select
        id={id}
        value={value ?? ''}
        options={[
          { value: '', label: auto ? t('inspector.place.autoNamed', { name: auto.name }) : t('inspector.place.auto') },
          ...candidates.map((c) => ({ value: candidateId(c), label: `${c.name} · ${REGION_KIND_LABELS[c.kind]}` })),
          ...(known ? [] : [{ value: value ?? '', label: loading ? t('inspector.place.searching') : t('inspector.place.missing') }]),
        ]}
        onChange={(next) => onChange(next || null)}
      />
    </div>
  )
}
const STOP_CAMERA_HINTS: Record<StopCamera, string> = {
  get film() {
    return t('inspector.holdCamera.film')
  },
  get orbite() {
    return t('inspector.holdCamera.orbite')
  },
  get large() {
    return t('inspector.holdCamera.large')
  },
  get fixe() {
    return t('inspector.holdCamera.fixe')
  },
}
const LAYOUT_LABELS: Record<MediaLayout, string> = {
  get 'plein-ecran'() {
    return t('inspector.layout.plein-ecran')
  },
  get carte() {
    return t('inspector.layout.carte')
  },
}
const SIZE_RANGE = { min: WIDGET_SIZE_MIN, max: WIDGET_SIZE_MAX, step: 0.1 }
/** Quick choices of a speed portion, and its slider in powers of two (×0,25 to ×4). */
const SPEED_CHIPS = [0.25, 0.5, 1.5, 2, 3, 4]
const SPEED_SLIDER = { min: -2, max: 2, step: 0.05 }
const km = (m: number) => Math.round(m / 10) / 100

const seconds = (s: number) => `${formatNumber(s, Number.isInteger(s) ? 0 : 1)} s`
const VOLUME_RANGE = { min: 0, max: 1, step: 0.01 }
const percent = formatPercent
const FADE_SLIDER = { min: FADE_RANGE.min, max: 10, step: FADE_RANGE.step }


/**
 * Settings of the block selected on the timeline (`filmSelection`), in the right dock: opening / closing shot, stop, camera key,
 * speed portion, text, photo or video. Typing is merged into one undo step; editing a generated stop writes the stops out first.
 */
export function FilmInspector() {
  const t = useT()
  const id = useId()
  const pictures = useMediaStore((s) => s.table)
  const item = useAppStore((s) => s.filmSelection)
  const { track, film, pacing, stageIds } = useFilmSource()
  const sequence = useFilmSequence()
  const clock = useFilmClock()
  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const marker = useAppStore((s) => s.settings.marker)
  const overlay = useAppStore((s) => s.settings.overlay)
  const tracks = useAppStore((s) => s.tracks)
  if (!item || !track || !path) return null
  const lengthM = track.stats.distanceM
  const change = (fn: (f: Film) => Film, stops: boolean) => editFilm((f) => ({ film: fn(f) }), { stops, step: false })
  const close = () => useAppStore.getState().setFilmSelection(null)
  const range = (
    key: string,
    label: string,
    value: number,
    r: { min: number; max: number; step: number },
    format: (v: number) => string,
    set: (v: number) => void,
    disabled = false,
  ) => <RangeField key={key} label={label} {...r} value={value} format={format} onChange={set} disabled={disabled} wide={false} />
  const text = (key: string, label: string, value: string, set: (v: string) => void) => (
    <TextField id={`${id}-${key}`} label={label} value={value} onChange={set} />
  )
  const number = (key: string, label: string, value: number, min: number, max: number, set: (v: number) => void) => (
    <NumberField id={`${id}-${key}`} label={label} min={min} max={max} step={0.1} live value={value} onChange={set} />
  )

  const anchorSelect = (label: string, value: OverlayAnchor, set: (anchor: OverlayAnchor) => void) => (
    <AnchorPicker label={label} value={value} onChange={set} />
  )
  const timing = (startS: number, durationS: number, set: (patch: { startS?: number; durationS?: number }) => void) => (
    <div className={ROW}>
      {number('start', t('inspector.field.start'), startS, 0, clock.totalTime(), (v) => set({ startS: v }))}
      {number('length', t('inspector.field.length'), durationS, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max, (v) => set({ durationS: v }))}
    </div>
  )

  /** « Attaché à » a stop of the film (generated stops are written out first), or to none */
  const attachSelect = (stopId: string | undefined) => (
    <div className={FIELD}>
      <label className="type-label" htmlFor={`${id}-stop`}>
        {t('inspector.attach.label')}
      </label>
      <Select
        id={`${id}-stop`}
        value={stopId ?? ''}
        aria-describedby={`${id}-stop-hint`}
        options={[
          { value: '', label: t('inspector.attach.none') },
          ...clock.stops.map((s) => ({ value: s.id, label: `${s.label || t('film.snap.hold')} · ${formatDistance(s.atM)}` })),
        ]}
        onChange={(next) => {
          const stop = clock.stops.find((s) => s.id === next) ?? null
          editFilm((f) => ({ film: attachToStop(f, item, stop) }), { stops: stop !== null })
        }}
      />
      <p id={`${id}-stop-hint`} className={HINT}>
        {stopId ? t('inspector.attach.hintAttached') : t('inspector.attach.hintFree')}
      </p>
    </div>
  )

  /** « Cadrer la caméra ici »: a camera key of its own while the item shows (`addItemCamera`), selected to adjust */
  const itemCamera = (startS: number, durationS: number) => (
    <Tip text={t('inspector.itemCamera.tip')}>
      <Button
        onClick={() => {
          const { camera, flyoverDurationS } = useAppStore.getState().settings
          const easeM = cameraKeyEaseM(lengthM, flyoverDurationS)
          editFilm((f) =>
            addItemCamera(
              f,
              startS,
              startS + durationS,
              (timeS) => clock.progressAtTime(timeS) * lengthM,
              // keyedCamera reads the keys in order along the track; the film keeps them in any order
              (atM) => keyedCamera(camera, [...f.cameraKeys].sort((a, b) => a.atM - b.atM), atM, easeM),
            ),
          )
        }}
      >
        <Icon name="locate-fixed" size={16} />
        {t('inspector.itemCamera.label')}
      </Button>
    </Tip>
  )

  let title: string
  let body: ReactNode
  let removeLabel = t('inspector.remove')
  let removable = true
  let isStop = false
  if (item === 'opening' || item === 'closing') {
    const shot = film[item]
    title = item === 'opening' ? t('timeline.shot.opening') : t('timeline.shot.closing')
    removeLabel = t('inspector.noShot')
    removable = shot.style !== 'aucune'
    body = (
      <>
        <div className={FIELD}>
          <label className="type-label" htmlFor={`${id}-style`}>
            {t('inspector.shot.styleLabel')}
          </label>
          <Select
            id={`${id}-style`}
            value={shot.style}
            aria-describedby={`${id}-style-hint`}
            options={SHOT_STYLES.map((style) => ({ value: style, label: SHOT_STYLE_LABELS[style] }))}
            onChange={(style) => change((f) => updateShot(f, item, { style }), false)}
          />
          <p id={`${id}-style-hint`} className={HINT}>
            {SHOT_HINTS[shot.style]}
          </p>
        </div>
        {shot.style === 'situation' && (
          <>
            <InspectorGroup title={t('inspector.place.label')}>
              <Switch
                checked={shot.highlight === true}
                aria-describedby={`${id}-highlight-hint`}
                onChange={(on) => change((f) => updateShot(f, item, { highlight: on }), false)}
              >
                {t('inspector.place.highlight')}
              </Switch>
              <RegionHint id={`${id}-highlight-hint`} highlight={shot.highlight === true} />
              {shot.highlight === true && (
                <PlaceSelect value={shot.regionId ?? null} onChange={(regionId) => change((f) => setFilmPlace(f, regionId), false)} />
              )}
            </InspectorGroup>
            <SituationTimings
              phase={item}
              durationS={shot.durationS}
              holdS={shot.holdS}
              onChange={(patch) => change((f) => updateShot(f, item, patch), false)}
            />
            <SituationFramingFields phase={item} shot={shot} onChange={(patch) => change((f) => updateShot(f, item, patch), false)} />
          </>
        )}
        {shot.style !== 'situation' &&
          range(
            'duration',
            t('inspector.shot.duration'),
            shot.durationS,
            SHOT_DURATION_RANGE,
            seconds,
            (durationS) => change((f) => updateShot(f, item, { durationS }), false),
            shot.style === 'aucune',
          )}
        {shot.style !== 'aucune' && (
          <InspectorGroup title={t('inspector.shot.sun')}>
            <Select
              aria-label={t('inspector.shot.sunOfShot')}
              aria-describedby={`${id}-sun-hint`}
              value={shotSunOf(shot)}
              options={[
                { value: 'jour', label: t('inspector.shot.sun.day') },
                { value: 'survol', label: t('inspector.shot.sun.flyover') },
                { value: 'accelere', label: t('inspector.shot.sun.accelerated', { hours: SHOT_SUN_HOURS }) },
              ]}
              onChange={(sun) => change((f) => updateShot(f, item, { sun, moveSun: undefined }), false)}
            />
            <p id={`${id}-sun-hint`} className={HINT}>
              {SHOT_SUN_HINTS[shotSunOf(shot)][item === 'opening' ? 0 : 1]}
              {!atmosphere && t('inspector.shot.sunNeedsAtmosphere')}
            </p>
          </InspectorGroup>
        )}
        <div className={FIELD}>
          <label className="type-label" htmlFor={`${id}-transition`}>
            {t('inspector.shot.transition')}
          </label>
          <Select
            id={`${id}-transition`}
            value={shot.transition ?? 'enchaine'}
            disabled={shot.style === 'aucune'}
            aria-describedby={`${id}-transition-hint`}
            options={SHOT_TRANSITIONS.map((transition) => ({ value: transition, label: SHOT_TRANSITION_LABELS[transition] }))}
            onChange={(transition) => change((f) => updateShot(f, item, { transition }), false)}
          />
          <p id={`${id}-transition-hint`} className={HINT}>
            {TRANSITION_HINTS[shot.transition ?? 'enchaine']}
          </p>
        </div>
        {shotDipColor(shot) &&
          range('dip', t('inspector.shot.dipDuration'), shot.dipS ?? DIP_DEFAULT_S, DIP_DURATION_RANGE, seconds, (dipS) =>
            change((f) => updateShot(f, item, { dipS }), false),
          )}
      </>
    )
  } else {
    const stop = clock.stops.find((s) => s.id === item)
    const speed = clock.speeds.find((s) => s.id === item)
    const filmText = film.texts.find((x) => x.id === item)
    const media = film.media.find((m) => m.id === item)
    const music = film.audio.find((a) => a.id === item)
    const cameraKey = clock.cameraKeys.find((k) => k.id === item)
    const paramKey = clock.paramKeys.find((k) => k.id === item)
    const markerKey = clock.markerKeys.find((k) => k.id === item)
    const junction = clock.junctions.find((j) => j.id === item)
    if (junction) {
      // the transition between two stages « À la suite »: its own, or the default one until it is changed
      const k = clock.junctions.indexOf(junction)
      const stored = junctionOf(film, junction.afterTrackId)
      const own = hasOwnTransition(film, junction.afterTrackId)
      // a junction left to the default shows what passes there (a night when the tracks rest overnight)
      const kind = own ? stored.kind : junction.kind
      const afterIds = (stageIds ?? []).slice(0, -1)
      const card = junctionCardOf(film, junction.afterTrackId)
      title = t('inspector.junction.title', { n: k + 1 })
      removeLabel = t('inspector.junction.defaultTransition')
      removable = own
      body = (
        <>
          <p className={HINT}>
            {junction.kind !== 'coupe'
              ? t('inspector.junction.betweenTimed', {
                  from: sequence?.stages[k]?.track.name ?? '',
                  to: sequence?.stages[k + 1]?.track.name ?? '',
                  start: formatFilmTime(junction.startS, true),
                  end: formatFilmTime(junction.endS, true),
                })
              : t('inspector.junction.between', { from: sequence?.stages[k]?.track.name ?? '', to: sequence?.stages[k + 1]?.track.name ?? '' })}
          </p>
          <JunctionTransitionFields
            kind={kind}
            holdS={stored.holdS || DEFAULT_JUNCTION.holdS}
            onChange={(patch) => change((f) => withJunction(f, junction.afterTrackId, { kind, holdS: stored.holdS, ...patch }), false)}
          />
          {kind === 'nuit' && (
            <>
              {NIGHT_PARTS.map(({ key, label }) =>
                range(`night-${key}`, label, film.nights[key], NIGHT_PART_RANGE, formatSecondsShort, (v) => change((f) => ({ ...f, nights: { ...f.nights, [key]: v } }), false)),
              )}
              <p className={HINT}>{t('inspector.junction.nightsHint')}</p>
            </>
          )}
          <Button
            className={REMOVE}
            onClick={() => editFilm((f) => ({ film: applyToAllJunctions(f, afterIds, { kind, holdS: stored.holdS }) }))}
          >
            {t('inspector.junction.applyToAll')}
          </Button>
          <Checkbox
            checked={card.enabled}
            onChange={(on) => {
                const enabled = on
                editFilm((f) => ({ film: withJunctionCard(f, junction.afterTrackId, { enabled }) }))
              }}
          >
            {t('inspector.junction.stageCard', { n: k + 2 })}
          </Checkbox>
          <Button
            className={REMOVE}
            onClick={() => useAppStore.getState().setFilmSelection(stageCardId(junction.afterTrackId))}
          >
            {t('inspector.junction.adjustCard')}
          </Button>
          <p className={HINT}>{t('inspector.junction.blockHint')}</p>
        </>
      )
    } else if (stop) {
      isStop = true
      title = t('film.snap.hold')
      const set = (patch: Parameters<typeof updateStop>[2]) => change((f) => updateStop(f, item, patch), true)
      body = (
        <>
          {text('label', t('inspector.hold.label'), stop.label ?? '', (label) => set({ label }))}
          {range('duration', t('inspector.hold.duration'), stop.durationS, STOP_DURATION_RANGE, seconds, (durationS) => set({ durationS }))}
          <div className={FIELD}>
            <label className="type-label" htmlFor={`${id}-camera`}>
              {t('inspector.hold.camera')}
            </label>
            <Select
              id={`${id}-camera`}
              value={stop.camera}
              aria-describedby={`${id}-camera-hint`}
              options={STOP_CAMERAS.map((camera) => ({ value: camera, label: STOP_CAMERA_LABELS[camera] }))}
              onChange={(camera) => set({ camera })}
            />
            <p id={`${id}-camera-hint`} className={HINT}>
              {STOP_CAMERA_HINTS[stop.camera]}
            </p>
          </div>
          <p className={HINT}>
            {t('inspector.hold.info', { at: formatDistance(stop.atM), length: formatDistance(lengthM), start: formatFilmTime(stop.startS), end: formatFilmTime(stop.endS) })}
            {film.autoStops && t('inspector.hold.auto')}
          </p>
        </>
      )
    } else if (speed) {
      title = PARAM_SPECS.speed.label
      const set = (patch: Parameters<typeof updateSpeed>[2]) => change((f) => updateSpeed(f, item, patch, lengthM), false)
      const factor = formatSpeedFactor(speed.factor)
      const hintKey = speed.factor > 1 ? 'inspector.speed.hintFast' : speed.factor < 1 ? 'inspector.speed.hintSlow' : 'inspector.speed.hintNormal'
      body = (
        <>
          <div className={FIELD}>
            <span id={`${id}-factor-label`} className="type-label">
              {PARAM_SPECS.speed.label}
            </span>
            <RadioGroup
              look="chips"
              className="mt-2"
              aria-labelledby={`${id}-factor-label`}
              value={speed.factor}
              onChange={(f) => editFilm((g) => ({ film: updateSpeed(g, item, { factor: f }, lengthM) }))}
            >
              {SPEED_CHIPS.map((f) => (
                <Radio key={f} value={f}>
                  {formatSpeedFactor(f)}
                </Radio>
              ))}
            </RadioGroup>
          </div>
          {range('factor', t('inspector.speed.label'), Math.log2(speed.factor), SPEED_SLIDER, (v) => formatSpeedFactor(2 ** v), (v) => set({ factor: 2 ** v }))}
          <div className={ROW}>
            {number('from', t('inspector.field.kmFrom'), km(speed.fromM), 0, km(lengthM), (v) => set({ fromM: v * 1000 }))}
            {number('to', t('inspector.field.kmTo'), km(speed.toM), 0, km(lengthM), (v) => set({ toM: v * 1000 }))}
          </div>
          <p className={HINT}>
            {t(hintKey, {
              factor,
              from: formatDistance(speed.fromM),
              to: formatDistance(speed.toM),
              start: formatFilmTime(speed.startS),
              end: formatFilmTime(speed.endS),
            })}
            {pacing.keepDuration ? t('inspector.speed.keepDuration') : t('inspector.speed.filmChanges')}
          </p>
        </>
      )
    } else if (cameraKey) {
      title = t('film.snap.keyframe')
      const set = (patch: Parameters<typeof updateCameraKey>[2]) => change((f) => updateCameraKey(f, item, patch), false)
      // a view taken in 3D may lie beyond the slider ranges: they widen to show it
      const span = (r: { min: number; max: number; step: number }, v: number) => ({ ...r, min: Math.min(r.min, v), max: Math.max(r.max, v) })
      body = (
        <>
          {range('distance', t('inspector.camKey.distance'), cameraKey.distance, span(CAMERA_RANGES.distance, cameraKey.distance), (v) => `×${formatNumber(v, 1)}`, (distance) => set({ distance }))}
          {range('pitch', t('inspector.camKey.pitch'), cameraKey.pitchDeg, span(CAMERA_RANGES.pitchDeg, cameraKey.pitchDeg), formatDegrees, (pitchDeg) => set({ pitchDeg }))}
          {range('heading', t('inspector.camKey.heading'), cameraKey.headingOffsetDeg, CAMERA_RANGES.headingOffsetDeg, formatDegrees, (headingOffsetDeg) => set({ headingOffsetDeg }))}
          {number('at', t('inspector.field.kmAt'), km(cameraKey.atM), 0, km(lengthM), (v) => set({ atM: Math.min(v * 1000, lengthM) }))}
          <p className={HINT}>
            {t('inspector.camKey.hint', { distance: formatDistance(cameraKey.atM), time: formatFilmTime(cameraKey.timeS) })}
          </p>
        </>
      )
    } else if (paramKey) {
      title = t('film.snap.setting')
      const spec = PARAM_SPECS[paramKey.param]
      const set = (patch: Parameters<typeof updateParamKey>[2]) => change((f) => updateParamKey(f, item, patch), false)
      /** another parameter starts from what the film shows there without this key */
      const switchTo = (param: FilmParam) => {
        const others = { ...film, paramKeys: film.paramKeys.filter((k) => k.id !== item) }
        set({ param, value: paramAt(others, paramBase(useAppStore.getState().settings, param), param, paramKey.atM) })
      }
      body = (
        <>
          <div className={FIELD}>
            <label className="type-label" htmlFor={`${id}-param`}>
              {t('inspector.paramKey.label')}
            </label>
            <Select
              id={`${id}-param`}
              value={paramKey.param}
              options={FILM_PARAMS.map((param) => ({ value: param, label: PARAM_SPECS[param].label }))}
              onChange={switchTo}
            />
          </div>
          {range('value', t('inspector.paramKey.value'), paramKey.value, spec, spec.format, (value) => set({ value }))}
          {number('at', t('inspector.field.kmAt'), km(paramKey.atM), 0, km(lengthM), (v) => set({ atM: Math.min(v * 1000, lengthM) }))}
          <p className={HINT}>
            {t('inspector.paramKey.hint', {
              distance: formatDistance(paramKey.atM),
              time: formatFilmTime(paramKey.timeS),
              label: spec.label.toLowerCase(),
              value: spec.format(paramKey.value),
            })}
            {paramKey.param === 'speed' &&
              `${t('inspector.paramKey.speedExtra')}${pacing.keepDuration ? t('inspector.speed.keepDuration') : t('inspector.speed.filmChanges')}`}
            {paramKey.param === 'sunHour' && t('inspector.paramKey.sunExtra')}
            {!atmosphere && (paramKey.param === 'sunHour' || paramKey.param === 'exposure') && t('inspector.paramKey.noAtmosphere')}
          </p>
        </>
      )
    } else if (markerKey) {
      title = t('timeline.lane.marker')
      const set = (patch: Parameters<typeof updateMarkerKey>[2]) => change((f) => updateMarkerKey(f, item, patch), false)
      /** a picture of its own for this look: kept in the project's media table, by id */
      const choosePicture = async () => {
        try {
          const [file] = await getPlatform().openFiles({ filters: [{ name: t('inspector.markerKey.imageFilter'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
          if (!file) return
          const data = await fileToAvatarDataUrl(file)
          const [imageId] = useMediaStore.getState().add([{ data, thumb: data, width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX, name: file.name }])
          set({ kind: 'image', imageId })
        } catch {
          showToast({ kind: 'error', text: t('inspector.markerKey.imageError') })
        }
      }
      /** a colour of its own for this look, '' = the track's; the picker starts from the colour in effect */
      const colorField = (field: 'color' | 'figureColor', label: string) => (
        <div className={FIELD}>
          <label className="type-label" htmlFor={`${id}-marker-${field}`}>
            {label}
          </label>
          <ColorField
            id={`${id}-marker-${field}`}
            label={label}
            value={(markerKey[field] ?? marker[field]) || track.color}
            onChange={(color) => set({ [field]: color })}
          >
            <Button disabled={markerKey[field] === ''} onClick={() => set({ [field]: '' })}>
              {t('inspector.markerKey.trackColor')}
            </Button>
          </ColorField>
        </div>
      )
      const inherits = markerKey.color === undefined && markerKey.figureColor === undefined && markerKey.size === undefined
      body = (
        <>
          <div className={FIELD}>
            <label className="type-label" htmlFor={`${id}-marker-kind`}>
              {t('inspector.markerKey.shape')}
            </label>
            <Select
              id={`${id}-marker-kind`}
              value={markerKey.kind}
              options={MARKER_KINDS.map((kind) => ({ value: kind, label: MARKER_KIND_LABELS[kind] }))}
              onChange={(kind) => set({ kind })}
            />
          </div>
          {markerKey.kind === 'figurine' && (
            <div className={FIELD}>
              <label className="type-label" htmlFor={`${id}-marker-figure`}>
                {t('inspector.markerKey.figure')}
              </label>
              <Select
                id={`${id}-marker-figure`}
                value={markerKey.figure}
                options={MARKER_FIGURE_CHOICES.map((figure) => ({ value: figure, label: MARKER_FIGURE_LABELS[figure] }))}
                onChange={(figure) => set({ figure })}
              />
            </div>
          )}
          {markerKey.kind === 'image' && (
            <div className={FIELD}>
              <div className={LABEL_ROW}>
                <Button onClick={() => void choosePicture()}>
                  {markerKey.imageId ? t('inspector.markerKey.changeImage') : t('inspector.markerKey.chooseImage')}
                </Button>
                {markerKey.imageId && (
                  <Button onClick={() => set({ imageId: undefined })}>
                    {t('inspector.markerKey.removeImage')}
                  </Button>
                )}
              </div>
              <p className={HINT}>{t('inspector.markerKey.noOwnImage')}</p>
            </div>
          )}
          {markerKey.kind === 'figurine' && colorField('figureColor', t('inspector.markerKey.discColor'))}
          {colorField('color', markerKey.kind === 'boule' ? t('inspector.markerKey.color') : t('inspector.markerKey.edgeColor'))}
          {range('size', t('inspector.markerKey.size'), markerKey.size ?? marker.size, MARKER_SIZE_RANGE, (v) => `×${formatShort(v)}`, (size) => set({ size }))}
          <div className={FIELD}>
            <Button
              disabled={inherits}
              onClick={() => set({ color: undefined, figureColor: undefined, size: undefined })}
            >
              {t('inspector.markerKey.resetLook')}
            </Button>
          </div>
          {number('at', t('inspector.field.kmAt'), km(markerKey.atM), 0, km(lengthM), (v) => set({ atM: Math.min(v * 1000, lengthM) }))}
          <p className={HINT}>
            {t('inspector.markerKey.hint', {
              distance: formatDistance(markerKey.atM),
              time: formatFilmTime(markerKey.timeS),
              label: MARKER_LABEL_MODE_LABELS[marker.label].toLowerCase(),
              stick: (marker.stick ? t('common.yes') : t('common.no')).toLowerCase(),
              animation:
                markerKey.kind === 'figurine' ? t('inspector.markerKey.hintAnimation', { animated: (marker.animated ? t('common.yes') : t('common.no')).toLowerCase() }) : '',
            })}
          </p>
        </>
      )
    } else if (filmText) {
      title = t('film.snap.text')
      const set = (patch: Parameters<typeof updateText>[2]) => change((f) => updateText(f, item, patch), false)
      body = (
        <>
          {text('text', t('inspector.text.text'), filmText.text, (value) => set({ text: value }))}
          {text('subtitle', t('inspector.text.subtitle'), filmText.subtitle ?? '', (subtitle) => set({ subtitle: subtitle || undefined }))}
          {anchorSelect(t('inspector.text.position'), filmText.anchor, (anchor) => set({ anchor }))}
          {range('size', t('inspector.text.size'), filmText.size, SIZE_RANGE, (v) => `×${formatNumber(v, 1)}`, (size) => set({ size }))}
          <FilmTextStyleFields color={filmText.color} font={filmText.font} onChange={({ color, font }) => set({ color, font })} />
          {timing(filmText.startS, filmText.durationS, set)}
          {attachSelect(filmText.stopId)}
          {itemCamera(filmText.startS, filmText.durationS)}
          <p className={HINT}>{t('inspector.text.hint')}</p>
        </>
      )
    } else if (media) {
      const video = media.kind === 'video'
      title = video ? t('film.snap.video') : t('film.snap.photo')
      const set = (patch: Parameters<typeof updateMedia>[2]) => change((f) => updateMedia(f, item, patch), false)
      const picture = pictures[media.src]
      const card = media.layout === 'carte'
      const fileS = picture?.durationS ?? ITEM_DURATION_RANGE.max
      /** « Caler sur le parcours »: recording start, clock correction, following the flight */
      const clipSync = (recordedMs: number, approx: boolean, lengthS: number) => {
        const timed = track.stats.startTime !== undefined
        const current: MediaSync = { startMs: recordedMs, offsetS: 0, follow: false, ...media.sync }
        // synced and placed again in the same edit; outside the outing, only the sync is kept
        const apply = (patch: Partial<MediaSync>, step: boolean) => {
          const sync = { ...current, ...patch }
          editFilm((f) => ({ film: syncClip(f, item, sync, path, clock, lengthS) ?? updateMedia(f, item, { sync }) }), { step })
        }
        const placeable = syncClipPlacement({ ...media, sync: current }, path, clock, lengthS) !== undefined
        const syncNow = () => {
          const offsetS = media.sync?.offsetS ?? clipSyncOffsetS(path, recordedMs, lengthS)
          if (offsetS === undefined || !syncClipPlacement({ ...media, sync: { ...current, offsetS } }, path, clock, lengthS)) {
            showToast({ kind: 'error', text: t('inspector.media.sync.outside') })
            return
          }
          apply({ offsetS }, true)
          showToast({ kind: 'success', text: t('inspector.media.sync.done') })
        }
        const hours = current.offsetS !== 0 && current.offsetS % 3600 === 0 ? Math.abs(current.offsetS / 3600) : 0
        const filmedAt = formatDate(recordedMs + current.offsetS * 1000, { dateStyle: 'short', timeStyle: 'medium' })
        return (
          <fieldset className={FIELDSET}>
            <legend className="type-label">{t('inspector.media.sync.legend')}</legend>
            <p className={HINT}>
              {t('inspector.media.sync.filmedAt', { date: filmedAt })}
              {approx && t('inspector.media.sync.approx')}.
              {!timed && t('inspector.media.sync.noTimes')}
              {timed && media.sync && !placeable && t('inspector.media.sync.outsideTime')}
              {hours > 0 && t('inspector.media.sync.hoursOffset', { hours })}
            </p>
            {timed && (
              <>
                <Button onClick={syncNow}>
                  {media.sync ? t('inspector.media.sync.resync') : t('timeline.syncWithRoute')}
                </Button>
                {number('offset', t('inspector.media.sync.offset'), current.offsetS, SYNC_OFFSET_RANGE.min, SYNC_OFFSET_RANGE.max, (offsetS) =>
                  apply({ offsetS: Math.round(Math.min(SYNC_OFFSET_RANGE.max, Math.max(SYNC_OFFSET_RANGE.min, offsetS)) * 10) / 10 }, false),
                )}
                <Checkbox checked={current.follow} onChange={(on) => apply({ follow: on }, true)}>{t('inspector.media.sync.follow')}</Checkbox>
                <p className={HINT}>{t('inspector.media.sync.offsetHint')}</p>
              </>
            )}
          </fieldset>
        )
      }
      /** « Son de la vidéo »: heard or not, its volume; silent while following the flight */
      const clipSound = () => {
        const following = media.sync?.follow === true
        const heard = media.muted === false && !following
        return (
          <fieldset className={FIELDSET}>
            <legend className="type-label">{t('inspector.media.sound.legend')}</legend>
            <Checkbox checked={heard} disabled={following} onChange={(on) => set({ muted: !on })}>{t('inspector.media.sound.label')}</Checkbox>
            {range('clip-volume', t('inspector.media.sound.volume'), media.volume ?? 1, VOLUME_RANGE, percent, (volume) => set({ volume }), !heard)}
            <p className={HINT}>
              {following
                ? t('inspector.media.sound.mutedFollowing')
                : t('inspector.media.sound.heard')}
            </p>
          </fieldset>
        )
      }
      body = (
        <>
          {picture && <img className="max-h-24 max-w-full justify-self-start rounded-sm" src={picture.thumb} alt={picture.name ?? title} />}
          <fieldset className={FIELDSET}>
            <legend className="type-label">{t('inspector.media.display')}</legend>
            <RadioGroup aria-label={t('inspector.media.display')} value={media.layout} onChange={(layout) => set({ layout })}>
              {MEDIA_LAYOUTS.map((layout) => (
                <Radio key={layout} value={layout}>
                  {LAYOUT_LABELS[layout]}
                </Radio>
              ))}
            </RadioGroup>
          </fieldset>
          {!video && (
            <Checkbox checked={media.kenBurns} disabled={card} onChange={(on) => set({ kenBurns: on })}>{t('inspector.media.kenBurns')}</Checkbox>
          )}
          {text('caption', t('inspector.media.caption'), media.caption ?? '', (caption) => set({ caption: caption || undefined }))}
          {anchorSelect(card ? t('inspector.text.position') : t('inspector.media.captionPosition'), media.anchor, (anchor) => set({ anchor }))}
          {range('size', t('inspector.text.size'), media.size, SIZE_RANGE, (v) => `×${formatNumber(v, 1)}`, (size) => set({ size }))}
          {timing(media.startS, media.durationS, set)}
          {attachSelect(media.stopId)}
          {itemCamera(media.startS, media.durationS)}
          {video && number('in', t('inspector.media.startInVideo'), media.inS ?? 0, 0, fileS, (inS) => set({ inS: Math.min(inS, fileS) }))}
          {video && clipSound()}
          {video && picture?.recordedMs !== undefined && clipSync(picture.recordedMs, picture.recordedApprox === true, fileS)}
          <p className={HINT}>
            {card ? t('inspector.media.hintCard', { kind: title.toLowerCase() }) : t('inspector.media.hintFull', { kind: title.toLowerCase() })}
            {video && picture?.durationS !== undefined && t('inspector.media.videoLength', { length: formatFilmTime(fileS) })}
          </p>
        </>
      )
    } else if (music) {
      title = t('film.snap.music')
      const sound = pictures[music.src]
      const fileS = sound?.durationS
      const set = (patch: Parameters<typeof updateMusic>[2]) => change((f) => updateMusic(f, item, patch, fileS), false)
      const lengthS = musicLengthS(music, fileS)
      body = (
        <>
          {sound?.name && <p className={HINT}>{sound.name}</p>}
          {range('volume', t('inspector.music.volume'), music.volume, VOLUME_RANGE, percent, (volume) => set({ volume }))}
          {range('fade-in', t('inspector.music.fadeIn'), Math.min(music.fadeInS, FADE_SLIDER.max), FADE_SLIDER, seconds, (fadeInS) => set({ fadeInS }))}
          {range('fade-out', t('inspector.music.fadeOut'), Math.min(music.fadeOutS, FADE_SLIDER.max), FADE_SLIDER, seconds, (fadeOutS) => set({ fadeOutS }))}
          <div className={ROW}>
            {number('start', t('inspector.field.start'), music.startS, 0, clock.totalTime(), (startS) => set({ startS }))}
            {number('length', t('inspector.field.length'), music.durationS, AUDIO_DURATION_RANGE.min, fileS ?? AUDIO_DURATION_RANGE.max, (durationS) => set({ durationS }))}
          </div>
          {number('in', t('inspector.music.startInFile'), music.inS, 0, fileS ?? AUDIO_DURATION_RANGE.max, (inS) => set({ inS }))}
          <Checkbox
            checked={film.duckMusic}
            onChange={(on) => {
                const duckMusic = on
                editFilm((f) => ({ film: { ...f, duckMusic } }))
              }}
          >
            {t('inspector.music.duck')}
          </Checkbox>
          <Button className={REMOVE} onClick={() => showToast(fitFilmToMusic())}>
            {t('inspector.music.fit')}
          </Button>
          <Button className={REMOVE} onClick={() => void snapFilmToMusic().then(showToast)}>
            {t('inspector.music.snapBeat')}
          </Button>
          <p className={HINT}>
            {t('inspector.music.hint', {
              start: formatFilmTime(music.startS),
              end: formatFilmTime(music.startS + lengthS),
              file: fileS !== undefined ? t('inspector.music.file', { length: formatFilmTime(fileS) }) : '',
              db: -DUCK_DB,
              tempo: sound?.beats
                ? sound.beats.times.length > 0
                  ? t('inspector.music.tempo', { bpm: Math.round(sound.beats.bpm) })
                  : t('inspector.music.tempoUncertain')
                : '',
            })}
          </p>
        </>
      )
    } else if (isStageItem(item) && sequence) {
      const k = sequence.stages.findIndex((s) => s.track.id === stageTrackOf(item))
      const stage = sequence.stages[k]
      title = t('timeline.stage.short', { n: k + 1 })
      const startS = k <= 0 ? clock.openingS : (clock.junctions[k - 1]?.endS ?? clock.openingS)
      const own = film.stageDurations?.[stageTrackOf(item)]
      removeLabel = t('inspector.stage.autoDuration')
      removable = own !== undefined
      body = stage && (
        <>
          <p className={HINT}>
            {stage.track.name} · {formatDistance(stage.endM - stage.startM)}
            {stage.track.stats.ascentM > 0 && t('inspector.stage.gain', { gain: formatNumber(stage.track.stats.ascentM) })}
          </p>
          {range(
            'stage-duration',
            t('inspector.stage.flightDuration'),
            Math.round(stageFlightS(clock, k) * 10) / 10,
            { ...STAGE_DURATION_RANGE, step: 1 },
            (v) => formatFilmTime(v),
            (v) => change((f) => withStageDuration(f, stage.track.id, v), false),
          )}
          <p className={HINT}>
            {own === undefined
              ? t('inspector.stage.autoHint')
              : t('inspector.stage.fixedHint')}{' '}
            {t('inspector.stage.dragHint')}
          </p>
          <label className={FIELD}>
            <span className="type-label">{t('inspector.stage.trackColor')}</span>
            <ColorField
              label={t('inspector.stage.trackColor')}
              value={tracks.find((tr) => tr.id === stage.track.id)?.color ?? stage.track.color}
              onChange={(color) => useAppStore.getState().setTrackColor(stage.track.id, color)}
            />
          </label>
          <Button
            className={REMOVE}
            onClick={() => useAppStore.getState().setProgress(clock.progressAtTime(startS), startS < clock.totalTime() ? startS : null)}
          >
            {t('inspector.stage.goToStart')}
          </Button>
          <p className={HINT}>{t('inspector.stage.nameHint')}</p>
        </>
      )
    } else if (isStageCardItem(item) && stageIds && stageIds.length > 1) {
      const after = stageCardAfterOf(item)
      const k = after === null ? 0 : stageIds.indexOf(after) + 1
      const card = junctionCardOf(film, after)
      const window = stageCardWindow(clock, film, after)
      title = t('inspector.stageCard.title', { n: k + 1 })
      removeLabel = t('inspector.stageCard.remove')
      removable = card.enabled
      body = (
        <>
          <StageCardFields card={card} onChange={(patch) => change((f) => withJunctionCard(f, after, patch), false)} />
          <p className={HINT}>
            {window && t('inspector.stageCard.window', { start: formatFilmTime(window.startS, true), end: formatFilmTime(window.endS, true) })}
            {t('inspector.stageCard.hint')}
            {k === 0 && t('inspector.stageCard.first')}
          </p>
        </>
      )
    } else if (isCardItem(item) && cardShown(overlay, item)) {
      // the card's own settings (overlay.title / overlay.end), switched off by deleting its block
      title = CARD_LABELS[item]
      body = (
        <>
          <CardFields card={item} />
          <p className={HINT}>
            {item === TITLE_CARD_ID ? t('inspector.card.hintRight') : t('inspector.card.hintLeft')}
          </p>
        </>
      )
    } else {
      return null
    }
  }

  const remove = () =>
    isCardItem(item)
      ? disableCard(item)
      : isJunctionItem(item)
        ? editFilm((f) => ({ film: resetJunction(f, junctionTrackOf(item)) }))
        : editFilm((f) => ({ film: removeFilmItem(f, item), id: null }), { stops: isStop })

  return (
    <section
      className="settings"
      data-testid="film-inspector"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        // Escape in a field (the shell's shortcuts leave text entries alone)
        if (e.key === 'Escape') close()
      }}
    >
      <h2 id={`${id}-title`} className="section-title settings__title">
        {title}
      </h2>
      <Tip text={t('inspector.close.tip')} align="end">
        <Button variant="icon" className="settings__close" onClick={close} aria-label={t('inspector.close.aria')}>
          <Icon name="x" size={18} />
        </Button>
      </Tip>
      {body}
      <Button className={REMOVE} onClick={remove} disabled={!removable}>
        {removeLabel}
      </Button>
    </section>
  )
}
