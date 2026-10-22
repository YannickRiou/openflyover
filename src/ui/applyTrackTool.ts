/**
 * « Outils de la trace »: what happens when a tool is applied or the track is exported. The tools themselves are pure
 * (`import/tools/*`); here the result replaces the track in the store (same path as « Calculer l'altitude »: the stats,
 * the weather and the layers follow the new points), what the film anchors in metres follows the places it was set on
 * (`remapFilm`), and the message carries « Annuler », which puts the track and the film back (tracks are not in the
 * settings history; same as « Enchaîner »).
 */
import { errorMessage } from '../core/errors'
import type { Track } from '../core/types'
import { filmClockFor } from '../film/clock'
import type { Film } from '../film/model'
import { remapFilm } from '../film/remap'
import { followStops } from '../film/timeline'
import { withSegments } from '../import/tools/common'
import type { Segments, ToolId } from '../import/tools/common'
import { distanceMap } from '../import/tools/distanceMap'
import type { Anchors } from '../import/tools/distanceMap'
import { gpxFileName, trackToGpx } from '../import/tools/exportGpx'
import { getPlatform } from '../platform'
import { getSettingsHistory } from '../project/history'
import { filmSpans, getFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { t } from '../i18n'
import { showUntilTracksChange } from './projectActions'
import { showToast } from './toast'

/** What `applyTrackTool` did: the tool's name, the points now in the track, the film items lost, and how to undo it. */
export interface AppliedTool {
  tool: string
  segments: Track['segments']
  /** items of the film (stops, keys, speed portions) that stood on a removed stretch */
  dropped: number
  /** puts the track back (and the film, if it is still as the tool left it); nothing once the track has changed since */
  undo(): void
}

/** The message after a tool: what was done, and what the film lost (the toast and the window say the same). */
export function appliedText(applied: Pick<AppliedTool, 'tool' | 'dropped'>, name: string): string {
  const done = t('track.tools.applied', { tool: applied.tool, name })
  return applied.dropped > 0 ? `${done} ${t('track.tools.dropped', { count: applied.dropped })}` : done
}

/** Replace the film without a settings step of its own: the tool's « Annuler » puts it back (Ctrl+Z would leave the track as it is). */
function setFilmQuietly(film: Film): void {
  const resume = getSettingsHistory().suspend()
  try {
    useAppStore.getState().setSetting('film', film)
  } finally {
    resume()
  }
}

/**
 * `segments` (the result of `tool` on `track`) take the place of the points of `track` in one step with « Annuler » (in the
 * message, and returned for the tools window, which hides the page's messages). What the film anchors in metres moves
 * with the places it was set on, or goes with a removed stretch. Nothing is recorded, and null returned, when `segments`
 * are the points of `track` already.
 */
export function applyTrackTool(track: Track, segments: Segments, tool: ToolId, toolName: string, anchors?: Anchors): AppliedTool | null {
  if (segments === track.segments) return null
  const store = useAppStore.getState()
  if (!store.tracks.includes(track)) return null
  const distances = distanceMap(track.segments, segments, anchors)
  const next = withSegments(track, segments, tool, distances)
  if (next === track) return null

  const filmBefore = store.settings.film
  const sourceBefore = getFilmSource()
  const spansBefore = filmSpans(store.tracks, store.settings.race)
  store.replaceTracks(store.tracks.map((other) => (other === track ? next : other)))
  const now = useAppStore.getState()
  const remapped = remapFilm(filmBefore, spansBefore, filmSpans(now.tracks, now.settings.race), track.id, distances)
  let filmAfter = filmBefore
  if (remapped.film !== filmBefore) {
    const sourceAfter = getFilmSource()
    filmAfter = followStops(
      filmBefore,
      remapped.film,
      (f) => filmClockFor({ ...sourceAfter, film: f }),
      (f) => filmClockFor({ ...sourceBefore, film: f }),
    )
    setFilmQuietly(filmAfter)
  }

  const undo = () => {
    const state = useAppStore.getState()
    const current = state.tracks.find((other) => other.id === track.id)
    // another change of this track since (or the track gone) is not ours to undo; a colour or a name changed since is kept
    if (!current || current.segments !== next.segments) return
    state.replaceTracks(state.tracks.map((other) => (other === current ? { ...track, color: current.color, name: current.name } : other)))
    if (filmAfter !== filmBefore && useAppStore.getState().settings.film === filmAfter) setFilmQuietly(filmBefore)
  }
  const applied: AppliedTool = { tool: toolName, segments: next.segments, dropped: remapped.dropped, undo }
  showUntilTracksChange({ kind: 'success', text: appliedText(applied, next.name), action: { label: t('common.undo'), run: undo } })
  return applied
}

/** « Exporter la trace en GPX »: the track as it is now, through the platform's save dialog. */
export async function exportTrackGpx(track: Track): Promise<void> {
  const fileName = gpxFileName(track)
  try {
    const outcome = await getPlatform().saveDocument(async () => new Blob([trackToGpx(track)], { type: 'application/gpx+xml' }), { fileName })
    if (outcome.saved) showToast({ kind: 'success', text: t('project.actions.fileSaved', { fileName: outcome.fileName }) })
  } catch (err) {
    showToast({ kind: 'error', text: t('project.actions.fileSaveFailed', { fileName, reason: errorMessage(err) }) })
  }
}
