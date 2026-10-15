import { useEffect, useId, useMemo, useState } from 'react'
import { filmStops, placeStop, withoutPlaceItems } from '../film/assemble'
import { t, useT } from '../i18n'
import type { StopPlace } from '../film/assemble'
import { POI_ICONS, POI_ICON_LABELS, STOP_DURATION_RANGE, nextFilmId } from '../film/model'
import type { FilmPoi, FilmStop } from '../film/model'
import { POI_NAME_MAX, addPoi, poiStopAtM, removePoi, renamePoi, setPoiIcon } from '../film/pois'
import { addStop, removeFilmItem, updateStop } from '../film/timeline'
import { samplePath, trackPathOf } from '../flyover/path'
import {
  DENSITY_LABELS,
  KIND_BADGES,
  KIND_LABELS,
  LANDMARK_DENSITIES,
  LANDMARK_DISTANCE_RANGE,
  MODE_LABELS,
  PLACE_SIZES,
  PLACE_SIZE_LABELS,
  landmarkMode,
  newLandmarkIds,
  movedInRank,
  nextMode,
  withMode,
  withPinnedOnly,
  withPlaceSize,
} from '../osm/landmarks'
import type { Landmark, LandmarkMode, LandmarkSettings } from '../osm/landmarks'
import { osmAttribution, OSM_KINDS } from '../osm/overpass'
import { syncLandmarks, useLandmarkStore } from '../osm/store'
import { sequenceLandmarks } from '../flyover/sequence'
import { getSettingsHistory } from '../project/history'
import { editFilm, followLandmarks, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { LandmarkMap } from './LandmarkMap'
import { PanelSection, SettingRow } from './PanelSection'
import { formatDistance, formatNumber } from './format'
import { Button, Checkbox, Chip, NumberField, Radio, RadioGroup, Select, Slider, Switch, TextField, Tip } from './primitives'

/** Type chips shown, in a few words: « Tous », « 7 sur 11 », « Aucun » (places count as their three sizes). */
function kindsLabel({ kinds, places }: Pick<LandmarkSettings, 'kinds' | 'places'>): string {
  const total = OSM_KINDS.length - 1 + PLACE_SIZES.length
  const on =
    OSM_KINDS.filter((kind) => kind !== 'place' && kinds[kind]).length + (kinds.place ? PLACE_SIZES.filter((s) => places[s]).length : 0)
  return on === total ? t('landmarks.kindsAll') : on === 0 ? t('landmarks.kindsNone') : t('landmarks.kindsSome', { on, total })
}

/** A row: an OSM landmark of the film track (in the window of the map) or a point of interest (listed in the panel), where its stop goes (`atM`). */
type PlaceRow = StopPlace & { hidden: boolean } & ({ landmark: Landmark; poi?: undefined } | { poi: FilmPoi; landmark?: undefined })

/*
 * A row of the list: a card of the control colour; a hidden one is a dashed outline whose name is struck out (`data-hidden`).
 * `group/place` lets its name and field read that state.
 */
const PLACE =
  'group/place grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 rounded-sm bg-surface-control py-0.5 pl-1 data-hidden:bg-transparent data-hidden:outline data-hidden:-outline-offset-1 data-hidden:outline-dashed data-hidden:outline-edge-strong'
/** The kind badge at the start of a row (a landmark's, or the point of interest's own button). */
const PLACE_BADGE = 'min-w-14 flex-none rounded-sm px-1 py-0.5 text-center text-caption font-semibold text-white'
/** The area of a row of a point of interest that seeks the flyover there: badge and name field. */
const PLACE_GO = 'flex min-h-control min-w-0 items-center gap-2 text-left text-text-1'
/** Second line of a row: place or pictogram, then the stop. */
const PLACE_LINE = 'col-span-full flex flex-wrap items-center gap-x-2 gap-y-1 pr-1'
/** A small button of the tools bar above the list. */
const TOOL = 'px-2'

/** OSM ids of the landmarks of every track, shown ones and hidden ones (the 3D labels of all tracks). */
function listedIds(hidden: boolean): string[] {
  const state = useLandmarkStore.getState()
  return Object.values(hidden ? state.hidden : state.landmarks).flatMap((list) => list.map((l) => l.id))
}

/**
 * Set the labels of `rows` (and `extraIds`, landmarks of the other tracks) to `mode` in one undo step: « Jamais », their
 * stops go with them (`withoutPlaceItems`); every landmark listed now counts as seen.
 */
function setRowsMode(rows: readonly PlaceRow[], mode: LandmarkMode, extraIds: readonly string[] = []): void {
  const listed = [...listedIds(false), ...listedIds(true)]
  getSettingsHistory().transaction(() => {
    if (mode === 'never') editFilm((film) => ({ film: withoutPlaceItems(film, rows.filter((r) => !r.hidden)) }))
    const { settings, setSetting } = useAppStore.getState()
    setSetting('landmarks', withMode(settings.landmarks, [...rows.map((r) => r.id), ...extraIds], mode, listed))
  })
}

/**
 * « Garder les épinglés »: every landmark of every track but the pinned ones is dismissed, in one undo step; the stops
 * of the dismissed `rows` go with them (`withoutPlaceItems`).
 */
function keepPinnedOnly(rows: readonly PlaceRow[]): void {
  const listed = [...listedIds(false), ...listedIds(true)]
  getSettingsHistory().transaction(() => {
    const { settings, setSetting } = useAppStore.getState()
    const pinned = new Set(settings.landmarks.pinnedIds)
    const dismissed = rows.filter((r) => !r.hidden && !pinned.has(r.id))
    if (dismissed.length > 0) editFilm((film) => ({ film: withoutPlaceItems(film, dismissed) }))
    setSetting('landmarks', withPinnedOnly(useAppStore.getState().settings.landmarks, listed))
  })
}

/** « Arrêt » of a row: the film stops there (checked) and for how long. */
function StopToggle({ name, stop, disabled, onToggle }: { name: string; stop?: FilmStop; disabled: boolean; onToggle(on: boolean): void }) {
  const t = useT()
  return (
    <div className="ml-auto flex items-center gap-1 text-body">
      <Checkbox
        checked={stop !== undefined}
        disabled={disabled}
        aria-label={t('landmarks.stopAria', { name })}
        onChange={(on) => onToggle(on)}
      >
        {t('landmarks.stop')}
      </Checkbox>
      {stop && (
        <label className="flex items-center gap-0.5">
          <NumberField
            className="w-[3.75rem]"
            aria-label={t('landmarks.stopDurationAria', { name })}
            min={STOP_DURATION_RANGE.min}
            max={STOP_DURATION_RANGE.max}
            step={STOP_DURATION_RANGE.step}
            value={stop.durationS}
            live
            onChange={(durationS) => {
              const id = stop.id
              editFilm((f) => ({ film: updateStop(f, id, { durationS }) }), { stops: true, step: false })
            }}
          />
          s
        </label>
      )}
    </div>
  )
}

/** The eye of a row: shows or hides its label. */
function EyeButton({ name, hidden, onClick }: { name: string; hidden: boolean; onClick(): void }) {
  const t = useT()
  return (
    <Tip text={hidden ? t('landmarks.showTip') : t('landmarks.hideTip')} side="left">
      <Button
        variant="icon"
        aria-label={hidden ? t('landmarks.show', { name }) : t('landmarks.hide', { name })}
        onClick={onClick}
      >
        <Icon name={hidden ? 'eye-off' : 'eye'} size={16} />
      </Button>
    </Tip>
  )
}

/**
 * The button of a landmark row, one for three states: « Auto » (the density decides), « Toujours » (kept whatever the cap,
 * wins when labels overlap), « Jamais » (no label); each press moves to the next.
 */
function ModeButton({ name, mode, onClick }: { name: string; mode: LandmarkMode; onClick(): void }) {
  const t = useT()
  return (
    <Tip text={t('landmarks.modeTip')} side="left">
      <Button
        size="sm"
        className={`min-w-18 ${mode === 'always' ? 'text-brand' : ''}`}
        aria-label={t('landmarks.modeAria', { name, mode: MODE_LABELS[mode] })}
        data-mode={mode}
        onClick={onClick}
      >
        {MODE_LABELS[mode]}
      </Button>
    </Tip>
  )
}

/** A row of a landmark (not a point of interest). */
type LandmarkRow = PlaceRow & { landmark: Landmark }

/**
 * The landmark selected on the profile or the map, in full (its name is never cut: the window is wide): where it is and how
 * far from the track, its mode (the eye hides or shows it in one click, the button also offers « Toujours »), the arrows that
 * rank it, its stop (« Arrêt ») and « Aller à ce repère »; the arrows of the track go to the previous and next landmark.
 */
function SelectedLandmark({
  row,
  mode,
  isNew,
  stop,
  canMoveUp,
  canMoveDown,
  neighbours,
  onSelect,
  onSeek,
  onMode,
  onMove,
  onStop,
}: {
  row: LandmarkRow
  mode: LandmarkMode
  isNew: boolean
  stop?: FilmStop
  canMoveUp: boolean
  canMoveDown: boolean
  /** the landmarks before and after this one along the track */
  neighbours: readonly [LandmarkRow | undefined, LandmarkRow | undefined]
  onSelect(id: string): void
  onSeek(): void
  onMode(mode: LandmarkMode): void
  onMove(up: boolean): void
  onStop(on: boolean): void
}) {
  const t = useT()
  const { landmark } = row
  const [before, after] = neighbours
  return (
    <div className="flex flex-col gap-2 rounded-sm bg-surface-control p-3" data-testid="selected-landmark" data-hidden={row.hidden || undefined}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`${PLACE_BADGE} ${landmark.kind === 'pass' ? 'bg-accent-fill' : 'bg-chrome'}`}>{KIND_BADGES[landmark.kind]}</span>
        <span className={`text-body font-medium break-words ${row.hidden ? 'line-through opacity-60' : ''}`} data-testid="landmark-name">
          {landmark.text}
        </span>
        {isNew && <span className="rounded-sm bg-accent-tint px-1 text-hint font-semibold text-brand" data-testid="place-new">{t('landmarks.isNew')}</span>}
      </div>
      <p className="type-hint tabular-nums">{t('landmarks.meta', { km: formatNumber(row.atM / 1000, 1), distance: formatDistance(landmark.distanceM) })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <EyeButton name={landmark.name} hidden={row.hidden} onClick={() => onMode(row.hidden ? 'auto' : 'never')} />
        <ModeButton name={landmark.name} mode={mode} onClick={() => onMode(nextMode(mode))} />
        <div className="flex items-center">
          <Tip text={t('landmarks.moreImportant')}>
            <Button variant="icon" aria-label={t('landmarks.moveUp', { name: landmark.name })} disabled={!canMoveUp} onClick={() => onMove(true)}>
              <Icon name="chevron-up" size={16} />
            </Button>
          </Tip>
          <Tip text={t('landmarks.lessImportant')}>
            <Button variant="icon" aria-label={t('landmarks.moveDown', { name: landmark.name })} disabled={!canMoveDown} onClick={() => onMove(false)}>
              <Icon name="chevron-down" size={16} />
            </Button>
          </Tip>
        </div>
        <StopToggle name={landmark.name} stop={stop} disabled={row.hidden} onToggle={onStop} />
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" disabled={!before} aria-label={t('landmarks.map.previous')} onClick={() => before && onSelect(before.id)}>
            <Icon name="chevron-left" size={16} />
          </Button>
          <Button size="sm" onClick={onSeek}>
            {t('landmarks.go')}
          </Button>
          <Button size="sm" disabled={!after} aria-label={t('landmarks.map.next')} onClick={() => after && onSelect(after.id)}>
            <Icon name="chevron-right" size={16} />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * « Repères et points d'intérêt » (foldable section of the Carte tab): the OSM landmarks (kinds and corridor width,
 * density, status, ODbL attribution) and the points of interest placed by hand. The landmarks are chosen in a window
 * (« Choisir sur la carte et le profil », `LandmarkMap`): the altitude profile and a map of the track with every landmark
 * fetched, a click on one selects it and gives its controls (`SelectedLandmark`): « Auto » / « Toujours » / « Jamais »
 * (`settings.landmarks.hiddenIds` / `pinnedIds`; « Jamais » also removes its stop), the arrows that rank it
 * (`settings.landmarks.rank`; the label of the higher one wins when two overlap) and « Arrêt » (a stop there, its
 * duration beside it). The points of interest are listed here, from the first to the last along the track: name, pictogram,
 * eye, stop. « Garder les « Toujours » » dismisses all the other landmarks (`dismissedIds`) until « Relancer la recherche »
 * asks OpenStreetMap again; « Tout remettre en auto » / « Tout masquer » for every label; landmarks found later (wider
 * distance, another type) are shown, marked « nouveau » until the user sets a mode again.
 * Also drives the landmark store, and keeps what is attached to a stop in step when the landmarks of the first track are
 * published again (`followLandmarks`).
 */
export function LandmarkPanel() {
  const t = useT()
  const id = useId()
  const tracks = useAppStore((s) => s.tracks)
  const settings = useAppStore((s) => s.settings.landmarks)
  const setSetting = useAppStore((s) => s.setSetting)
  const setProgress = useAppStore((s) => s.setProgress)
  const status = useLandmarkStore((s) => s.status)
  const message = useLandmarkStore((s) => s.message)
  // the landmarks along the film: the first track's, or « À la suite » those of every stage
  const { track: first, landmarks, film, pacing } = useFilmSource()
  const sequence = useFilmSequence()
  const hiddenByTrack = useLandmarkStore((s) => s.hidden)
  const hidden = sequence ? sequenceLandmarks(sequence, hiddenByTrack) : first ? hiddenByTrack[first.id] : undefined
  const progress = useAppStore((s) => s.playback.progress)
  /** the point just added from here, whose name field takes the focus */
  const [added, setAdded] = useState<string | null>(null)
  /** the window of the profile and the map, and the landmark selected in it */
  const [mapOpen, setMapOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const stops = useMemo(() => (first ? filmStops(film, { track: first, landmarks, pacing }) : []), [first, film, landmarks, pacing])

  useEffect(() => {
    syncLandmarks(tracks, settings)
  }, [tracks, settings])

  useEffect(() => {
    followLandmarks()
  }, [landmarks])

  if (!first) return null
  const path = trackPathOf(first)
  const lengthM = first.stats.distanceM
  const hiddenIds = new Set(settings.hiddenIds)
  const list = settings.enabled ? (landmarks ?? []) : []
  const hiddenList = settings.enabled ? (hidden ?? []) : []
  const always = list.filter((l) => settings.pinnedIds.includes(l.id)).length
  const fresh = newLandmarkIds(settings, list.map((l) => l.id))
  const rows: PlaceRow[] = [
    ...list.map((landmark) => ({ id: landmark.id, atM: landmark.alongM, landmark, hidden: false })),
    ...hiddenList.map((landmark) => ({ id: landmark.id, atM: landmark.alongM, landmark, hidden: true })),
    ...film.pois.map((poi) => ({ id: poi.id, atM: poiStopAtM(path, poi) ?? 0, poi, hidden: hiddenIds.has(poi.id) })),
  ]
  // the points of interest first (their labels come above every other), then the landmarks from the most important to the least
  rows.sort((a, b) =>
    a.poi && b.poi ? a.atM - b.atM : a.poi ? -1 : b.poi ? 1 : b.landmark.priority - a.landmark.priority || a.atM - b.atM,
  )
  const ranked = rows.filter((r): r is LandmarkRow => r.landmark !== undefined)
  const poiRows = rows.filter((r): r is PlaceRow & { poi: FilmPoi } => r.poi !== undefined)
  const shownRows = rows.filter((r) => !r.hidden)
  // along the track, for the map, the profile and the arrows of the window
  const ordered = [...ranked].sort((a, b) => a.atM - b.atM)
  const mapItems = ordered.map((r) => ({ landmark: r.landmark, mode: landmarkMode(settings, r.id), fresh: fresh.has(r.id) }))
  const selected = ranked.find((r) => r.id === selectedId)

  const seek = (atM: number) => setProgress(lengthM > 0 ? atM / lengthM : 0)
  const toggleStop = (row: PlaceRow, name: string, on: boolean) =>
    editFilm(
      (f) => {
        if (on) return { film: addStop(f, row.atM, row.landmark ? { label: name, source: { kind: 'landmark', ref: row.id } } : { label: name || undefined }).film }
        const stop = placeStop(f.stops, row)
        return { film: stop ? removeFilmItem(f, stop.id) : f }
      },
      { stops: true },
    )
  const moveInRank = (row: PlaceRow, up: boolean) =>
    setSetting('landmarks', {
      ...settings,
      rank: movedInRank(
        ranked.map((r) => r.id),
        row.id,
        up,
      ),
    })
  const searchAgain = () => {
    const next = { ...settings, dismissedIds: [] }
    setSetting('landmarks', next)
    syncLandmarks(tracks, next, { refresh: true })
  }
  const addAtMarker = () => {
    const at = samplePath(path, useAppStore.getState().playback.progress * path.lengthM)
    setAdded(nextFilmId(useAppStore.getState().settings.film, 'poi'))
    editFilm((f) => ({ film: addPoi(f, at) }))
  }
  const deletePoi = (poi: FilmPoi) =>
    getSettingsHistory().transaction(() => {
      editFilm((f) => ({ film: removePoi(f, poi.id) }))
      // its id may be given to the next point
      const current = useAppStore.getState().settings.landmarks
      if (current.hiddenIds.includes(poi.id)) setSetting('landmarks', withMode(current, [poi.id], 'auto', []))
    })

  return (
    <PanelSection title={t('landmarks.title')} keys={['landmarks']}>
      <Switch
        id={`${id}-enabled`}
        checked={settings.enabled}
        onChange={(on) => setSetting('landmarks', { ...settings, enabled: on })}
      >
        {t('landmarks.enable')}
      </Switch>

      {settings.enabled && (
        <SettingRow label={t('landmarks.types')} value={kindsLabel(settings)} paths={['landmarks.kinds', 'landmarks.places']}>
          <fieldset className="field min-w-0">
            <legend className="type-label mb-1">{t('landmarks.types')}</legend>
            <div className="chips">
              {OSM_KINDS.map((kind) =>
                kind === 'place' ? (
                  // places as three chips, by size
                  PLACE_SIZES.map((size) => (
                    <Chip
                      key={size}
                      checked={settings.kinds.place && settings.places[size]}
                      onChange={(on) => setSetting('landmarks', withPlaceSize(settings, size, on))}
                    >
                      {PLACE_SIZE_LABELS[size]}
                    </Chip>
                  ))
                ) : (
                  <Chip
                    key={kind}
                    checked={settings.kinds[kind]}
                    onChange={(on) => setSetting('landmarks', { ...settings, kinds: { ...settings.kinds, [kind]: on } })
                      }
                  >
                    {KIND_LABELS[kind]}
                  </Chip>
                ),
              )}
            </div>
          </fieldset>
        </SettingRow>
      )}

      {settings.enabled && (
        <SettingRow label={t('landmarks.distance')} value={formatDistance(settings.maxDistanceM)} paths={['landmarks.maxDistanceM']}>
          <div className="field">
            <span className="type-label">
              {t('landmarks.distance')}
            </span>
            <Slider
              aria-label={t('landmarks.distance')}
              min={LANDMARK_DISTANCE_RANGE.min}
              max={LANDMARK_DISTANCE_RANGE.max}
              step={LANDMARK_DISTANCE_RANGE.step}
              value={settings.maxDistanceM}
              onChange={(v) => setSetting('landmarks', { ...settings, maxDistanceM: v })}
              format={formatDistance}
            />
          </div>
        </SettingRow>
      )}

      {settings.enabled && (
        <SettingRow label={t('landmarks.density')} value={DENSITY_LABELS[settings.density]} paths={['landmarks.density']}>
          <div className="field">
            <span id={`${id}-density`} className="type-label">
              {t('landmarks.density')}
            </span>
            <RadioGroup aria-labelledby={`${id}-density`} value={settings.density} onChange={(density) => setSetting('landmarks', { ...settings, density })}>
              {LANDMARK_DENSITIES.map((density) => (
                <Radio key={density} value={density}>
                  {DENSITY_LABELS[density]}
                </Radio>
              ))}
            </RadioGroup>
            <p className="type-hint">{t('landmarks.densityHint')}</p>
          </div>
        </SettingRow>
      )}

      <p className="type-hint" role="status" aria-live="polite">
        {!settings.enabled && t('landmarks.status.off')}
        {settings.enabled && status === 'loading' && t('landmarks.status.loading')}
        {settings.enabled && status === 'error' && message}
        {settings.enabled &&
          status === 'ready' &&
          (list.length + hiddenList.length === 0
            ? t('landmarks.status.none')
            : t('landmarks.status.sentence', {
                parts: [
                  t('landmarks.status.along', { count: list.length }),
                  always > 0 && t('landmarks.status.always', { count: always }),
                  hiddenList.length > 0 && t('landmarks.status.hidden', { count: hiddenList.length }),
                  settings.dismissedIds.length > 0 && t('landmarks.status.dismissed', { count: settings.dismissedIds.length }),
                ]
                  .filter(Boolean)
                  .join(' · '),
              }))}
      </p>

      {settings.enabled && status === 'error' && (
        <Button block onClick={() => syncLandmarks(tracks, settings, { refresh: true })}>
          {t('common.retry')}
        </Button>
      )}

      {settings.enabled && status !== 'error' && (
        <Tip text={t('landmarks.searchAgainTip')}>
          <Button
            block
            disabled={status === 'loading'}
            onClick={searchAgain}
          >
            <Icon name="rotate-cw" size={16} />
            {t('landmarks.searchAgain')}
          </Button>
        </Tip>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {fresh.size > 0 && (
            <Tip text={t('landmarks.freshTip')}>
              <button
                type="button"
                className="mr-auto cursor-pointer rounded-full bg-accent-tint px-2 py-0.5 text-hint font-semibold text-brand"
                onClick={() => setSetting('landmarks', withMode(settings, [], 'auto', listedIds(false)))}
              >
                {t('landmarks.fresh', { count: fresh.size })}
              </button>
            </Tip>
          )}
          <Button
            size="sm"
            className={TOOL}
            disabled={settings.hiddenIds.length + settings.pinnedIds.length === 0}
            onClick={() => setRowsMode([], 'auto', [...settings.hiddenIds, ...settings.pinnedIds])}
          >
            <Icon name="rotate-cw" size={16} />
            {t('landmarks.allAuto')}
          </Button>
          <Button
            size="sm"
            className={TOOL}
            disabled={shownRows.length === 0}
            onClick={() => setRowsMode(shownRows, 'never', listedIds(false))}
          >
            <Icon name="eye-off" size={16} />
            {t('landmarks.hideAll')}
          </Button>
          <Tip text={t('landmarks.keepPinnedTip')}>
            <Button
              size="sm"
              className={TOOL}
              disabled={settings.pinnedIds.length === 0}
              onClick={() => keepPinnedOnly(ranked)}
            >
              <Icon name="pin" size={16} />
              {t('landmarks.keepPinned')}
            </Button>
          </Tip>
        </div>
      )}

      {rows.length > 0 && (
        <p className="type-hint">{[t('landmarks.hint'), film.autoStops && t('landmarks.hintAuto')].filter(Boolean).join(' ')}</p>
      )}

      {ranked.length > 0 && (
        <Button block onClick={() => setMapOpen(true)}>
          <Icon name="map" size={16} />
          {t('landmarks.map.open')}
        </Button>
      )}

      {ranked.length > 0 && first && (
        <LandmarkMap
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          track={first}
          items={mapItems}
          maxDistanceM={settings.maxDistanceM}
          progress={progress}
          onSeek={setProgress}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        >
          {selected ? (
            <SelectedLandmark
              row={selected}
              mode={landmarkMode(settings, selected.id)}
              isNew={fresh.has(selected.id)}
              stop={selected.hidden ? undefined : placeStop(stops, selected)}
              canMoveUp={ranked[0] !== selected}
              canMoveDown={ranked[ranked.length - 1] !== selected}
              neighbours={[ordered[ordered.indexOf(selected) - 1], ordered[ordered.indexOf(selected) + 1]]}
              onSelect={setSelectedId}
              onSeek={() => seek(selected.atM)}
              onMode={(mode) => setRowsMode([selected], mode)}
              onMove={(up) => moveInRank(selected, up)}
              onStop={(on) => toggleStop(selected, selected.landmark.name, on)}
            />
          ) : (
            <p className="type-hint">{t('landmarks.map.pick')}</p>
          )}
        </LandmarkMap>
      )}

      {poiRows.length > 0 && (
        <ul className="flex max-h-90 flex-col gap-1 overflow-y-auto">
          {poiRows.map((row) => {
            const stop = row.hidden ? undefined : placeStop(stops, row)
            const { poi } = row
            const name = poi.name.trim()
            return (
              <li key={row.id} className={PLACE} data-testid="place" data-hidden={row.hidden || undefined}>
                <div className={`${PLACE_GO} [&>.field]:min-w-0 [&>.field]:flex-1`}>
                  <button type="button" className={`cursor-pointer bg-chrome ${PLACE_BADGE}`} title={t('landmarks.poiGo')} onClick={() => seek(row.atM)}>
                    {t('landmarks.poiBadge')}
                  </button>
                  <TextField
                    aria-label={t('landmarks.poiNameAria')}
                    placeholder={t('landmarks.poiNamePlaceholder')}
                    value={poi.name}
                    maxLength={POI_NAME_MAX}
                    autoFocus={poi.id === added}
                    onFocus={(e) => {
                      if (poi.id === added) e.currentTarget.select()
                    }}
                    onBlur={() => setAdded(null)}
                    onChange={(value) => editFilm((f) => ({ film: renamePoi(f, poi.id, value) }), { step: false })}
                  />
                </div>
                <EyeButton name={name || t('landmarks.poiThis')} hidden={row.hidden} onClick={() => setRowsMode([row], row.hidden ? 'auto' : 'never')} />
                <div className={PLACE_LINE}>
                  <Select
                    className="min-w-0 flex-[0_1_6.5rem]"
                    aria-label={t('landmarks.poiIconAria', { name: name || t('landmarks.poiThis') })}
                    value={poi.icon ?? 'epingle'}
                    options={POI_ICONS.map((icon) => ({ value: icon, label: POI_ICON_LABELS[icon] }))}
                    onChange={(icon) => editFilm((f) => ({ film: setPoiIcon(f, poi.id, icon) }))}
                  />
                  <Tip text={t('common.delete')}>
                    <Button
                      variant="icon"
                      aria-label={t('landmarks.poiDeleteAria', { name })}
                      onClick={() => deletePoi(poi)}
                    >
                      <Icon name="x" size={16} />
                    </Button>
                  </Tip>
                  <StopToggle name={name || t('landmarks.poiDefaultName')} stop={stop} disabled={row.hidden} onToggle={(on) => toggleStop(row, name, on)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Button block onClick={addAtMarker}>
        <Icon name="plus" size={16} />
        {t('landmarks.poiAdd')}
      </Button>
      <p className="type-hint">{t('landmarks.poiHint')}</p>

      {settings.enabled && status !== 'idle' && (
        <p className="type-hint">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            {osmAttribution()}
          </a>
        </p>
      )}
    </PanelSection>
  )
}
