import { useEffect, useId, useMemo, useState } from 'react'
import { filmStops, placeStop, withoutPlaceItems } from '../film/assemble'
import type { StopPlace } from '../film/assemble'
import { POI_ICONS, POI_ICON_LABELS, STOP_DURATION_RANGE, nextFilmId } from '../film/model'
import type { FilmPoi, FilmStop, PoiIcon } from '../film/model'
import { POI_NAME_MAX, addPoi, poiStopAtM, removePoi, renamePoi, setPoiIcon } from '../film/pois'
import { addStop, removeFilmItem, updateStop } from '../film/timeline'
import { samplePath, trackPathOf } from '../flyover/path'
import {
  KIND_BADGES,
  KIND_LABELS,
  LANDMARK_COUNT_RANGE,
  LANDMARK_DISTANCE_RANGE,
  PLACE_SIZES,
  PLACE_SIZE_LABELS,
  newLandmarkIds,
  movedInRank,
  withHidden,
  withPinnedOnly,
  withPlaceSize,
} from '../osm/landmarks'
import type { Landmark, LandmarkSettings } from '../osm/landmarks'
import { OSM_ATTRIBUTION, OSM_KINDS } from '../osm/overpass'
import { syncLandmarks, useLandmarkStore } from '../osm/store'
import { sequenceLandmarks } from '../flyover/sequence'
import { getSettingsHistory } from '../project/history'
import { editFilm, followLandmarks, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { PanelSection, SettingRow } from './PanelSection'
import { formatDistance, formatNumber } from './format'
import './LandmarkPanel.css'

/** Type chips shown, in a few words: « Tous », « 7 sur 11 », « Aucun » (places count as their three sizes). */
function kindsLabel({ kinds, places }: Pick<LandmarkSettings, 'kinds' | 'places'>): string {
  const total = OSM_KINDS.length - 1 + PLACE_SIZES.length
  const on =
    OSM_KINDS.filter((kind) => kind !== 'place' && kinds[kind]).length + (kinds.place ? PLACE_SIZES.filter((s) => places[s]).length : 0)
  return on === total ? 'Tous' : on === 0 ? 'Aucun' : `${on} sur ${total}`
}

/** A row of the list: an OSM landmark of the film track or a point of interest, where its stop goes (`atM`). */
type PlaceRow = StopPlace & { hidden: boolean } & ({ landmark: Landmark; poi?: undefined } | { poi: FilmPoi; landmark?: undefined })

/** OSM ids of the landmarks of every track, shown ones and hidden ones (the 3D labels of all tracks). */
function listedIds(hidden: boolean): string[] {
  const state = useLandmarkStore.getState()
  return Object.values(hidden ? state.hidden : state.landmarks).flatMap((list) => list.map((l) => l.id))
}

/**
 * Show or hide the labels of `rows` (and `extraIds`, landmarks of the other tracks) in one undo step: hidden, their
 * stops go with them (`withoutPlaceItems`); every landmark listed now counts as seen.
 */
function setRowsHidden(rows: readonly PlaceRow[], hide: boolean, extraIds: readonly string[] = []): void {
  const listed = [...listedIds(false), ...listedIds(true)]
  getSettingsHistory().transaction(() => {
    if (hide) editFilm((film) => ({ film: withoutPlaceItems(film, rows) }))
    const { settings, setSetting } = useAppStore.getState()
    setSetting('landmarks', withHidden(settings.landmarks, [...rows.map((r) => r.id), ...extraIds], hide, listed))
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
  return (
    <div className="place__stop">
      <label className="checkbox">
        <input
          type="checkbox"
          aria-label={`Arrêt dans le film à « ${name} »`}
          checked={stop !== undefined}
          disabled={disabled}
          onChange={(e) => onToggle(e.currentTarget.checked)}
        />
        Arrêt
      </label>
      {stop && (
        <label className="place__duration">
          <input
            className="input"
            type="number"
            aria-label={`Durée de l'arrêt « ${name} » (secondes)`}
            min={STOP_DURATION_RANGE.min}
            max={STOP_DURATION_RANGE.max}
            step={STOP_DURATION_RANGE.step}
            value={stop.durationS}
            onChange={(e) => {
              const durationS = e.currentTarget.valueAsNumber
              const id = stop.id
              if (Number.isFinite(durationS)) editFilm((f) => ({ film: updateStop(f, id, { durationS }) }), { stops: true, step: false })
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
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={hidden ? `Afficher « ${name} »` : `Masquer « ${name} »`}
      data-tip={hidden ? "Afficher l'étiquette" : "Masquer l'étiquette et son arrêt"}
      data-tip-side="left"
      onClick={onClick}
    >
      <Icon name={hidden ? 'eye-off' : 'eye'} size={16} />
    </button>
  )
}

/** The pin of a row: pinned landmarks are kept whatever the cap and by « Garder les épinglés ». */
function PinButton({ name, pinned, onClick }: { name: string; pinned: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      className={pinned ? 'icon-btn icon-btn--on' : 'icon-btn'}
      aria-label={pinned ? `Désépingler « ${name} »` : `Épingler « ${name} »`}
      aria-pressed={pinned}
      data-tip={pinned ? 'Désépingler' : 'Épingler : toujours gardé'}
      data-tip-side="left"
      onClick={onClick}
    >
      <Icon name="pin" size={16} />
    </button>
  )
}

/**
 * « Repères et points d'intérêt » (foldable section of the Carte tab): the OSM landmarks (kinds and corridor width,
 * status, ODbL attribution) and the points of interest placed by hand, in one list
 * ordered by importance: the points of interest first, then the landmarks from the most to the least important, which the
 * arrows change (`settings.landmarks.rank`; the label of the higher one wins when two overlap). Each row: click = seek the flyover there; the eye shows or hides its label
 * (`settings.landmarks.hiddenIds`; hiding also removes its stop); « Arrêt » makes or removes a stop there,
 * its duration beside it. The cross of a hidden landmark dismisses it (`dismissedIds`) until « Relancer la recherche » asks
 * OpenStreetMap again (a dismissed landmark frees no slot under « Nombre maximal »). The pin keeps a landmark whatever the
 * cap; « Garder les épinglés » dismisses all the others. « Tout afficher » / « Tout masquer » for every label; landmarks found later (wider distance,
 * another type) are shown, marked « nouveau » until the user shows or hides labels again.
 * Also drives the landmark store, and keeps what is attached to a stop in step when the landmarks of the first track are
 * published again (`followLandmarks`).
 */
export function LandmarkPanel() {
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
  /** the point just added from here, whose name field takes the focus */
  const [added, setAdded] = useState<string | null>(null)
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
  const pinnedIds = new Set(settings.pinnedIds)
  const list = settings.enabled ? (landmarks ?? []) : []
  const hiddenList = settings.enabled ? (hidden ?? []) : []
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
  const ranked = rows.filter((r) => r.landmark)
  const shownRows = rows.filter((r) => !r.hidden)

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
  const dismiss = (row: PlaceRow) =>
    setSetting('landmarks', {
      ...settings,
      hiddenIds: settings.hiddenIds.filter((hiddenId) => hiddenId !== row.id),
      rank: settings.rank.filter((rankedId) => rankedId !== row.id),
      pinnedIds: settings.pinnedIds.filter((pinnedId) => pinnedId !== row.id),
      dismissedIds: [...settings.dismissedIds, row.id],
    })
  const togglePin = (row: PlaceRow) =>
    setSetting('landmarks', {
      ...settings,
      pinnedIds: pinnedIds.has(row.id) ? settings.pinnedIds.filter((pinnedId) => pinnedId !== row.id) : [...settings.pinnedIds, row.id],
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
      if (current.hiddenIds.includes(poi.id)) setSetting('landmarks', withHidden(current, [poi.id], false, []))
    })

  return (
    <PanelSection title="Repères et points d'intérêt" keys={['landmarks']}>
      <label className="checkbox checkbox--switch" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSetting('landmarks', { ...settings, enabled: e.currentTarget.checked })}
        />
        Sommets, cols, refuges… autour de la trace
      </label>

      {settings.enabled && (
        <SettingRow label="Types" value={kindsLabel(settings)} paths={['landmarks.kinds', 'landmarks.places']}>
          <fieldset className="field fieldset">
            <legend className="field__label">Types</legend>
            <div className="chips">
              {OSM_KINDS.map((kind) =>
                kind === 'place' ? (
                  // places as three chips, by size
                  PLACE_SIZES.map((size) => (
                    <label key={size} className="chip">
                      <input
                        type="checkbox"
                        checked={settings.kinds.place && settings.places[size]}
                        onChange={(e) => setSetting('landmarks', withPlaceSize(settings, size, e.currentTarget.checked))}
                      />
                      {PLACE_SIZE_LABELS[size]}
                    </label>
                  ))
                ) : (
                  <label key={kind} className="chip">
                    <input
                      type="checkbox"
                      checked={settings.kinds[kind]}
                      onChange={(e) =>
                        setSetting('landmarks', { ...settings, kinds: { ...settings.kinds, [kind]: e.currentTarget.checked } })
                      }
                    />
                    {KIND_LABELS[kind]}
                  </label>
                ),
              )}
            </div>
          </fieldset>
        </SettingRow>
      )}

      {settings.enabled && (
        <SettingRow label="Distance à la trace" value={formatDistance(settings.maxDistanceM)} paths={['landmarks.maxDistanceM']}>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-distance`}>
              Distance à la trace
            </label>
            <div className="range-row">
              <input
                id={`${id}-distance`}
                className="range"
                type="range"
                min={LANDMARK_DISTANCE_RANGE.min}
                max={LANDMARK_DISTANCE_RANGE.max}
                step={LANDMARK_DISTANCE_RANGE.step}
                value={settings.maxDistanceM}
                onChange={(e) => setSetting('landmarks', { ...settings, maxDistanceM: Number(e.currentTarget.value) })}
              />
              <output className="range-row__value range-row__value--wide" htmlFor={`${id}-distance`}>
                {formatDistance(settings.maxDistanceM)}
              </output>
            </div>
          </div>
        </SettingRow>
      )}

      {settings.enabled && (
        <SettingRow label="Nombre maximal" value={String(settings.maxCount)} paths={['landmarks.maxCount']}>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-count`}>
              Nombre maximal
            </label>
            <div className="range-row">
              <input
                id={`${id}-count`}
                className="range"
                type="range"
                min={LANDMARK_COUNT_RANGE.min}
                max={LANDMARK_COUNT_RANGE.max}
                step={LANDMARK_COUNT_RANGE.step}
                value={settings.maxCount}
                onChange={(e) => setSetting('landmarks', { ...settings, maxCount: Number(e.currentTarget.value) })}
              />
              <output className="range-row__value" htmlFor={`${id}-count`}>
                {settings.maxCount}
              </output>
            </div>
            <p className="field__hint">Par trace. Les repères épinglés y comptent et sont toujours gardés.</p>
          </div>
        </SettingRow>
      )}

      <p className="field__hint" role="status" aria-live="polite">
        {!settings.enabled && 'Repères désactivés : aucune requête envoyée.'}
        {settings.enabled && status === 'loading' && 'Recherche des repères…'}
        {settings.enabled && status === 'error' && message}
        {settings.enabled &&
          status === 'ready' &&
          (list.length + hiddenList.length === 0
            ? 'Aucun repère de ces types près de la trace.'
            : `${list.length} ${list.length > 1 ? 'repères' : 'repère'} le long de la trace` +
              (hiddenList.length > 0 ? ` · ${hiddenList.length} ${hiddenList.length > 1 ? 'masqués' : 'masqué'}` : '') +
              (settings.dismissedIds.length > 0 ? ` · ${settings.dismissedIds.length} ${settings.dismissedIds.length > 1 ? 'écartés' : 'écarté'}` : '') +
              '.')}
      </p>

      {settings.enabled && status === 'error' && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => syncLandmarks(tracks, settings, { refresh: true })}>
          Réessayer
        </button>
      )}

      {settings.enabled && status !== 'error' && (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={status === 'loading'}
          data-tip="Interroge de nouveau OpenStreetMap et rend les repères écartés avec la croix"
          onClick={searchAgain}
        >
          <Icon name="rotate-cw" size={16} />
          Relancer la recherche
        </button>
      )}

      {rows.length > 0 && (
        <div className="places__tools">
          {fresh.size > 0 && (
            <button
              type="button"
              className="places__fresh"
              data-tip="Trouvés depuis votre dernier choix : les marquer comme vus"
              onClick={() => setSetting('landmarks', withHidden(settings, [], false, listedIds(false)))}
            >
              {fresh.size} {fresh.size > 1 ? 'nouveaux' : 'nouveau'}
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={settings.hiddenIds.length === 0}
            onClick={() => setRowsHidden(rows.filter((r) => r.hidden), false, settings.hiddenIds)}
          >
            <Icon name="eye" size={16} />
            Tout afficher
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={shownRows.length === 0}
            onClick={() => setRowsHidden(shownRows, true, listedIds(false))}
          >
            <Icon name="eye-off" size={16} />
            Tout masquer
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={settings.pinnedIds.length === 0}
            data-tip="Écarte tous les autres repères, sans en proposer de nouveaux"
            onClick={() => keepPinnedOnly(ranked)}
          >
            <Icon name="pin" size={16} />
            Garder les épinglés
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <p className="field__hint">
          Un clic sur un nom y mène. « Arrêt » : le film s'y arrête le temps indiqué. Masquer une étiquette retire aussi son arrêt.
          {film.autoStops && ' Arrêts automatiques (Options de la timeline) : en changer un les fige.'}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="places">
          {rows.map((row) => {
            const stop = row.hidden ? undefined : placeStop(stops, row)
            const className = row.hidden ? 'place place--hidden' : 'place'
            if (row.landmark) {
              const { landmark } = row
              return (
                <li key={row.id} className={className}>
                  <button type="button" className="place__go" title={row.hidden ? 'Repère masqué · y aller' : 'Aller à ce repère'} onClick={() => seek(row.atM)}>
                    <span className={landmark.kind === 'pass' ? 'landmark__kind landmark__kind--pass' : 'landmark__kind'}>{KIND_BADGES[landmark.kind]}</span>
                    <span className="landmark__name">{landmark.text}</span>
                  </button>
                  <div className="place__actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Monter « ${landmark.name} » dans le classement`}
                      data-tip="Plus important"
                      disabled={ranked[0] === row}
                      onClick={() => moveInRank(row, true)}
                    >
                      <Icon name="chevron-up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Descendre « ${landmark.name} » dans le classement`}
                      data-tip="Moins important"
                      disabled={ranked[ranked.length - 1] === row}
                      onClick={() => moveInRank(row, false)}
                    >
                      <Icon name="chevron-down" size={16} />
                    </button>
                    <PinButton name={landmark.name} pinned={pinnedIds.has(row.id)} onClick={() => togglePin(row)} />
                    <EyeButton name={landmark.name} hidden={row.hidden} onClick={() => setRowsHidden([row], !row.hidden)} />
                    {row.hidden && (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Écarter « ${landmark.name} »`}
                        data-tip="Ne plus le proposer"
                        onClick={() => dismiss(row)}
                      >
                        <Icon name="x" size={16} />
                      </button>
                    )}
                  </div>
                  <div className="place__line">
                    <span className="place__meta">
                      km {formatNumber(row.atM / 1000, 1)} · à {formatDistance(landmark.distanceM)}
                      {fresh.has(row.id) && <span className="place__new">nouveau</span>}
                    </span>
                    <StopToggle name={landmark.name} stop={stop} disabled={row.hidden} onToggle={(on) => toggleStop(row, landmark.name, on)} />
                  </div>
                </li>
              )
            }
            const { poi } = row
            const name = poi.name.trim()
            return (
              <li key={row.id} className={className}>
                <div className="place__go place__go--poi">
                  <button type="button" className="landmark__kind landmark__kind--poi" title="Aller à ce point d'intérêt" onClick={() => seek(row.atM)}>
                    Point
                  </button>
                  <input
                    className="input"
                    aria-label="Nom du point d'intérêt"
                    placeholder="Sans nom : pas d'étiquette"
                    value={poi.name}
                    maxLength={POI_NAME_MAX}
                    autoFocus={poi.id === added}
                    onFocus={(e) => {
                      if (poi.id === added) e.currentTarget.select()
                    }}
                    onBlur={() => setAdded(null)}
                    onChange={(e) => {
                      const value = e.currentTarget.value
                      editFilm((f) => ({ film: renamePoi(f, poi.id, value) }), { step: false })
                    }}
                  />
                </div>
                <EyeButton name={name || "ce point d'intérêt"} hidden={row.hidden} onClick={() => setRowsHidden([row], !row.hidden)} />
                <div className="place__line">
                  <select
                    className="select place__icon"
                    aria-label={`Pictogramme de ${name || "ce point d'intérêt"}`}
                    value={poi.icon ?? 'epingle'}
                    onChange={(e) => {
                      const icon = e.currentTarget.value as PoiIcon
                      editFilm((f) => ({ film: setPoiIcon(f, poi.id, icon) }))
                    }}
                  >
                    {POI_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {POI_ICON_LABELS[icon]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Supprimer le point d'intérêt ${name}`}
                    data-tip="Supprimer"
                    onClick={() => deletePoi(poi)}
                  >
                    <Icon name="x" size={16} />
                  </button>
                  <StopToggle name={name || "Point d'intérêt"} stop={stop} disabled={row.hidden} onToggle={(on) => toggleStop(row, name, on)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <button type="button" className="btn btn--secondary btn--block" onClick={addAtMarker}>
        <Icon name="plus" size={16} />
        Point d'intérêt au marqueur
      </button>
      <p className="field__hint">Vos lieux à vous, aussi par un clic droit sur le relief.</p>

      {settings.enabled && status !== 'idle' && (
        <p className="field__hint">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            {OSM_ATTRIBUTION}
          </a>
        </p>
      )}
    </PanelSection>
  )
}
