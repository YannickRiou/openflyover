import { useMemo } from 'react'
import type { Track } from '../core/types'
import { materializeStops } from '../film/assemble'
import { withoutCard } from '../film/cards'
import type { CardId } from '../film/cards'
import { filmClockFor } from '../film/clock'
import type { FilmClock, FilmClockFor } from '../film/clock'
import { junctionsM, markerKeyLook, sortedMarkerKeys } from '../film/markerKeys'
import type { Film } from '../film/model'
import { hasParamKeys, keysOfParam, paramAt, paramBase } from '../film/paramKeys'
import type { FilmParam } from '../film/paramKeys'
import { idsByDate, movedIds, reorderStages } from '../film/reorder'
import type { StageSpan } from '../film/reorder'
import { addCameraKey, addMarkerKey, addMarkerKeysAt, addParamKey, adjacentKey, followStops, keyAt, removeFilmItem } from '../film/timeline'
import { captureKey } from '../flyover/cameraKeys'
import { buildSequence, filmSequenceOf, filmTrackOf, filmTracksOf, orderedTracks, sequenceLandmarks } from '../flyover/sequence'
import type { Sequence } from '../flyover/sequence'
import type { Landmark } from '../osm/landmarks'
import { useLandmarkStore } from '../osm/store'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'

/** The sequence « À la suite » the film flies, null otherwise (flyover/sequence.ts). */
export function useFilmSequence(): Sequence | null {
  return useAppStore((s) => filmSequenceOf(s.tracks, s.settings.race))
}

/** The track the film flies: the first one, or the sequence of all of them « À la suite ». */
export function useFilmTrack(): Track | undefined {
  return useAppStore((s) => filmTrackOf(s.tracks, s.settings.race))
}

/** The tracks the film flies over, one by one (`filmTracksOf`): what the water and the forests are fetched for. */
export function useFilmTracks(): readonly Track[] {
  const tracks = useAppStore((s) => s.tracks)
  const race = useAppStore((s) => s.settings.race)
  return useMemo(() => filmTracksOf(tracks, race), [tracks, race])
}

/** Landmarks of the film track: the first track's, or those of every stage along the sequence. */
function filmLandmarks(track: Track | undefined, sequence: Sequence | null, byTrack: Readonly<Record<string, readonly Landmark[]>>) {
  if (sequence) return sequenceLandmarks(sequence, byTrack)
  return track ? byTrack[track.id] : undefined
}

/** What the film clock is computed from: film track, film, flyover duration, pacing, landmarks (from the stores). */
export function useFilmSource(): FilmClockFor {
  const sequence = useFilmSequence()
  const track = useFilmTrack()
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const pacing = useAppStore((s) => s.settings.pacing)
  const film = useAppStore((s) => s.settings.film)
  const landmarks = useLandmarkStore((s) => filmLandmarks(track, sequence, s.landmarks))
  return { track, film, durationS, pacing, landmarks, cutsM: sequence?.cutsM, stageIds: sequence?.stageIds, bilan: sequence?.bilan?.plan }
}

/** The film source read from the stores outside React (event handlers, shortcuts). */
export function getFilmSource(): FilmClockFor {
  const { tracks, settings } = useAppStore.getState()
  const sequence = filmSequenceOf(tracks, settings.race)
  const track = sequence?.track ?? tracks[0]
  const landmarks = filmLandmarks(track, sequence, useLandmarkStore.getState().landmarks)
  return { track, film: settings.film, durationS: settings.flyoverDurationS, pacing: settings.pacing, landmarks, cutsM: sequence?.cutsM, stageIds: sequence?.stageIds, bilan: sequence?.bilan?.plan }
}

/**
 * Edit the film of the stores: `stops` writes the generated stops out first (`materializeStops`, editing a stop);
 * the texts and media attached to a stop follow it (`followStops`); one undo step, or merged with the quick changes
 * before it when `step` is false (typing in the inspector). The edit's `id` is selected on the timeline (null: nothing selected, absent: unchanged).
 */
export function editFilm(edit: (film: Film) => { film: Film; id?: string | null }, { stops = false, step = true } = {}): void {
  const source = getFilmSource()
  const { track, film, pacing, landmarks } = source
  const base = stops && track ? materializeStops(film, { track, landmarks, pacing }) : film
  const result = edit(base)
  const next = followStops(base, result.film, (f) => filmClockFor({ ...source, film: f }))
  const set = () => useAppStore.getState().setSetting('film', next)
  if (next !== film) {
    if (step) getSettingsHistory().transaction(set)
    else set()
  }
  if (result.id !== undefined) useAppStore.getState().setFilmSelection(result.id)
}

/**
 * Delete the block of the opening title or of the closing card: the card is switched off (one undo step; its settings
 * are kept, switching it on again from the panel brings the block back) and nothing stays selected.
 */
export function disableCard(card: CardId): void {
  const store = useAppStore.getState()
  getSettingsHistory().transaction(() => store.setSetting('overlay', withoutCard(store.settings.overlay, card)))
  store.setFilmSelection(null)
}

/**
 * « Ajouter une image clé »: a keyframe at the marker with the pose of the 3D view as it is now (one undo step,
 * selected); false when there is no view to read.
 */
export function addKeyframe(): boolean {
  const captured = captureKey()
  if (!captured) return false
  editFilm((f) => addCameraKey(f, captured.atM, captured.framing))
  return true
}

/**
 * The playhead exactly on the key that `editFilm` just selected: a parameter or marker key is placed at a whole metre,
 * so the playhead is moved by under half a metre, and the ◀ ◇ ▶ then see it on the key.
 */
function parkOnSelectedKey(): void {
  const store = useAppStore.getState()
  const clock = filmClockFor(getFilmSource())
  const key = [...clock.paramKeys, ...clock.markerKeys].find((k) => k.id === store.filmSelection)
  if (key) store.setProgress(clock.progressAtTime(key.timeS), key.timeS < clock.totalTime() ? key.timeS : null)
}

/**
 * Value and setter of the slider of a parameter that keys can drive. Without a key for `param` it is the setting
 * (`base`, `setBase`). With keys the setting is ignored, so the slider shows the value the film has at the marker and
 * a change puts that value on the key there (made on the first change): move the playhead, move the slider, and the
 * parameter changes from there on.
 */
export function useKeyedValue(param: FilmParam, base: number, setBase: (value: number) => void): readonly [number, (value: number) => void] {
  const track = useFilmTrack()
  const film = useAppStore((s) => s.settings.film)
  const keyed = hasParamKeys(film, [param])
  const atM = useAppStore((s) => (keyed ? Math.round(s.playback.progress * (track?.stats.distanceM ?? 0)) : 0))
  if (!keyed) return [base, setBase]
  return [paramAt(film, base, param, atM), (value) => editFilm((f) => ({ film: addParamKey(f, atM, param, value).film }), { step: false })]
}

/**
 * The ◇ of a parameter (speed on its lane, the others under their slider): a key for `param` at the marker holding the
 * value the film shows there (the speed ×1 or the setting without key), so nothing changes until the inspector edits it;
 * a key already at that place keeps its value. One undo step, selected for the inspector.
 */
export function addParamKeyHere(param: FilmParam): void {
  const { track } = getFilmSource()
  const { playback, settings } = useAppStore.getState()
  const atM = Math.round(playback.progress * (track?.stats.distanceM ?? 0))
  editFilm((f) => addParamKey(f, atM, param, paramAt(f, paramBase(settings, param), param, atM)))
  parkOnSelectedKey()
}

/**
 * The ◉ of the « Marqueur » section: a marker key at the marker's place holding the look it has there, so nothing
 * changes until the inspector edits it (one undo step, selected).
 */
export function addMarkerKeyHere(): void {
  const { track } = getFilmSource()
  const { playback, settings } = useAppStore.getState()
  const atM = Math.round(playback.progress * (track?.stats.distanceM ?? 0))
  editFilm((f) => {
    const before = sortedMarkerKeys(f.markerKeys).filter((k) => k.atM <= atM).pop()
    return addMarkerKey(f, atM, markerKeyLook(before, settings.marker))
  })
  parkOnSelectedKey()
}

/**
 * « Un marqueur par étape ou par jour »: a marker key with the look (shape, colours, size) of the settings at each junction of the film
 * track (stages « À la suite », days of a chained track) that has none, to give each its own look in the inspector.
 * Returns the number of keys added (one undo step).
 */
export function addJunctionMarkerKeys(): number {
  const { track, cutsM, film } = getFilmSource()
  const look = markerKeyLook(undefined, useAppStore.getState().settings.marker)
  const places = junctionsM(track, cutsM).filter((m) => !film.markerKeys.some((k) => Math.round(k.atM) === Math.round(m)))
  if (places.length > 0) editFilm((f) => ({ film: addMarkerKeysAt(f, places, look), id: null }))
  return places.length
}

/** The key of `keys` the playhead is on, removed (one undo step, nothing selected); false when it is on none. */
function removeKeyHere(clock: FilmClock, keys: readonly { id: string; timeS: number }[]): boolean {
  const store = useAppStore.getState()
  const here = keyAt(keys, Math.min(store.playback.timeS ?? clock.timeAtProgress(store.playback.progress), clock.totalTime()))
  if (!here) return false
  editFilm((f) => ({ film: removeFilmItem(f, here.id), id: null }))
  return true
}

/** The ◇ of the « Plans » lane: removes the keyframe the playhead is on, else adds one there (one undo step). */
export function toggleKeyframe(clock: FilmClock): boolean {
  return removeKeyHere(clock, clock.cameraKeys) || addKeyframe()
}

/** The ◇ of a parameter: removes its key the playhead is on, else adds one there (`addParamKeyHere`). */
export function toggleParamKeyHere(clock: FilmClock, param: FilmParam): void {
  if (!removeKeyHere(clock, keysOfParam(clock.paramKeys, param))) addParamKeyHere(param)
}

/** The ◉ of the « Marqueur » section: removes the marker key the playhead is on, else adds one there (`addMarkerKeyHere`). */
export function toggleMarkerKeyHere(clock: FilmClock): void {
  if (!removeKeyHere(clock, clock.markerKeys)) addMarkerKeyHere()
}

/**
 * « Image clé précédente / suivante » (`direction` -1 / 1): the playhead exactly on that keyframe, which the inspector
 * then shows if it showed a key of the same kind; false when there is none. `keys` are the keys to walk through: the
 * camera keys, or the keys of one parameter or of the marker for the ◀ ▶ of their lane or panel.
 */
export function seekKeyframe(clock: FilmClock, direction: -1 | 1, keys: readonly { id: string; timeS: number }[] = clock.cameraKeys): boolean {
  const store = useAppStore.getState()
  const total = clock.totalTime()
  const key = adjacentKey(keys, Math.min(store.playback.timeS ?? clock.timeAtProgress(store.playback.progress), total), direction)
  if (!key) return false
  store.setProgress(clock.progressAtTime(key.timeS), key.timeS < total ? key.timeS : null)
  if (keys.some((k) => k.id === store.filmSelection)) store.setFilmSelection(key.id)
  return true
}

/**
 * « Arrêts automatiques » on the film of the stores (timeline options): on, a stop generated at every
 * highlight, the film's own stops dropped; off, the generated stops written out as its own. One undo step.
 */
export function setAutoStops(on: boolean): void {
  editFilm((film) => ({ film: on ? { ...film, autoStops: true, autoMode: 'temps-forts', stops: [] } : film }), { stops: !on })
}

/**
 * Set the flyover duration and / or the pacing of the stores; the texts and media attached to a stop follow it
 * (`followStops`) in the same change of the settings, so one undo step (coalesced like any slider).
 */
export function setFlightTiming(patch: Partial<Pick<FilmClockFor, 'durationS' | 'pacing'>>): void {
  const source = getFilmSource()
  const film = followStops(
    source.film,
    source.film,
    (f) => filmClockFor({ ...source, ...patch, film: f }),
    (f) => filmClockFor({ ...source, film: f }),
  )
  const { settings } = useAppStore.getState()
  const { durationS = settings.flyoverDurationS, pacing = settings.pacing } = patch
  useAppStore.setState({ settings: { ...settings, flyoverDurationS: durationS, pacing, film } })
}

/**
 * After the flyover duration or the pacing of the stores changed from `before` (« Par défaut » of « Durée et rythme »,
 * `resetSettings`), the texts and media attached to a stop follow it (`followStops`), in the same undo step.
 */
export function followFlightTiming(before: Pick<Settings, 'flyoverDurationS' | 'pacing'>): void {
  const source = getFilmSource()
  if (source.durationS === before.flyoverDurationS && source.pacing === before.pacing) return
  const film = followStops(
    source.film,
    source.film,
    (f) => filmClockFor({ ...source, film: f }),
    (f) => filmClockFor({ ...source, durationS: before.flyoverDurationS, pacing: before.pacing, film: f }),
  )
  if (film !== source.film) useAppStore.getState().setSetting('film', film)
}

const spansOf = (sequence: Sequence): StageSpan[] => sequence.stages.map((s) => ({ trackId: s.track.id, startM: s.startM, endM: s.endM }))

/** The stages of the film track: those of the sequence « À la suite », else the first track alone (`remapFilm`). */
export function filmSpans(tracks: readonly Track[], race: Settings['race']): StageSpan[] {
  const sequence = filmSequenceOf(tracks, race)
  if (sequence) return spansOf(sequence)
  return tracks[0] ? [{ trackId: tracks[0].id, startM: 0, endM: tracks[0].stats.distanceM }] : []
}

/**
 * « À la suite »: the stages in the order of `ids` (every track id once). The order (`race.order`) and the film remapped
 * with it (`reorderStages`: what is anchored in metres follows its stage; the texts and media attached to a stop follow
 * it) are one undo step. The playhead stays where it is. False when there is no sequence (or a « Bilan »: dates order it), `ids` are not its stages or
 * the order does not change.
 */
export function setStageOrder(ids: readonly string[]): boolean {
  const { tracks, settings, playback } = useAppStore.getState()
  const sequence = filmSequenceOf(tracks, settings.race)
  const same = (list: readonly string[]) => list.length === ids.length && list.every((id, k) => id === ids[k])
  if (!sequence || sequence.bilan || ids.length !== sequence.stageIds.length || new Set(ids).size !== ids.length || same(sequence.stageIds) || !ids.every((id) => sequence.stageIds.includes(id))) return false
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const next = buildSequence(ids.map((id) => byId.get(id)!))
  const source = getFilmSource()
  const nextSource = { ...source, track: next.track, cutsM: next.cutsM, stageIds: next.stageIds, landmarks: sequenceLandmarks(next, useLandmarkStore.getState().landmarks) }
  const remapped = reorderStages(settings.film, spansOf(sequence), spansOf(next))
  const film = followStops(
    settings.film,
    remapped,
    (f) => filmClockFor({ ...nextSource, film: f }),
    (f) => filmClockFor({ ...source, film: f }),
  )
  const { order: _order, ...race } = settings.race
  getSettingsHistory().transaction(() =>
    useAppStore.setState({ settings: { ...settings, race: same(tracks.map((t) => t.id)) ? race : { ...race, order: [...ids] }, film } }),
  )
  useAppStore.getState().setProgress(playback.progress)
  return true
}

/** « À la suite »: the stage of track `trackId` moved to place `toIndex` (clamped), one undo step (`setStageOrder`). */
export function reorderTracks(trackId: string, toIndex: number): boolean {
  const { tracks, settings } = useAppStore.getState()
  const ids = orderedTracks(tracks, settings.race).map((t) => t.id)
  return setStageOrder(movedIds(ids, trackId, toIndex))
}

/** « Ordonner par date »: the stages by departure time, those without a time last (`idsByDate`), one undo step. */
export function orderTracksByDate(): boolean {
  const { tracks, settings } = useAppStore.getState()
  return setStageOrder(idsByDate(orderedTracks(tracks, settings.race)))
}

/** Landmarks of the first track the film was last in line with (null: none published for that track yet). */
let followedLandmarks: { trackId: string | undefined; landmarks: readonly Landmark[] | null } = { trackId: undefined, landmarks: null }

/**
 * The landmarks of the first track published again (`LandmarkPanel`): the slow-downs of the pacing at landmarks move
 * the stops in film time, and the texts and media attached to a stop follow them (`followStops`) from the landmarks
 * published before. Not an undo step: loading landmarks is not an edit. Not on the first landmarks of a track (project
 * opened, track imported): landmarks are not saved but fetched again, and a film was saved with the times of its own.
 */
export function followLandmarks(): void {
  const source = getFilmSource()
  const trackId = source.track?.id
  const previous = followedLandmarks.trackId === trackId ? followedLandmarks.landmarks : null
  // once a track had landmarks, none (turned off) is a change too
  followedLandmarks = { trackId, landmarks: source.landmarks ?? (previous && []) }
  if (!previous || previous === source.landmarks) return
  const film = followStops(
    source.film,
    source.film,
    (f) => filmClockFor({ ...source, film: f }),
    (f) => filmClockFor({ ...source, landmarks: previous, film: f }),
  )
  if (film === source.film) return
  const resume = getSettingsHistory().suspend()
  try {
    useAppStore.getState().setSetting('film', film)
  } finally {
    resume()
  }
}

/**
 * Film clock of the film track (the first track, or the sequence « À la suite ») for the current settings and
 * OpenStreetMap landmarks (memoised), shared by the playback (FlyoverRig), the export (ExportController), the timeline
 * and the panels (film duration, highlights).
 */
export function useFilmClock(): FilmClock {
  const { track, film, durationS, pacing, landmarks, cutsM, stageIds, bilan } = useFilmSource()
  return useMemo(
    () => filmClockFor({ track, film, durationS, pacing, landmarks, cutsM, stageIds, bilan }),
    [track, film, durationS, pacing, landmarks, cutsM, stageIds, bilan],
  )
}
