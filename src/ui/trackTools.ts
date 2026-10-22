/**
 * « Outils de la trace »: what happens when a tool is applied or the track is exported. The tools themselves are pure
 * (`import/tools/*`); here the result replaces the track in the store (same path as « Calculer l'altitude »: the stats,
 * the weather and the layers follow the new points) and the message carries « Annuler », which puts the tracks back as
 * they were (tracks are not in the settings history; same as « Enchaîner »).
 */
import { errorMessage } from '../core/errors'
import type { Track } from '../core/types'
import { gpxFileName, trackToGpx } from '../import/tools/exportGpx'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { t } from '../i18n'
import { showUntilTracksChange } from './projectActions'
import { showToast } from './toast'

/** What `applyTrackTool` did: the tool's name, the points now in the track, and how to put the earlier tracks back. */
export interface AppliedTool {
  tool: string
  segments: Track['segments']
  undo(): void
}

/**
 * `next` takes the place of `track` in one step with « Annuler » (in the message, and returned for the tools window, which
 * hides the page's messages); nothing is recorded, and null returned, when `next` is `track` itself.
 */
export function applyTrackTool(track: Track, next: Track, toolName: string): AppliedTool | null {
  if (next === track) return null
  const store = useAppStore.getState()
  const before = store.tracks
  if (!before.includes(track)) return null
  const after = before.map((other) => (other === track ? next : other))
  store.replaceTracks(after)
  // only while the tracks are as this step left them: a later change is not undone by a stale « Annuler »
  const undo = () => {
    if (useAppStore.getState().tracks === after) useAppStore.getState().replaceTracks(before)
  }
  showUntilTracksChange({
    kind: 'success',
    text: t('track.tools.applied', { tool: toolName, name: next.name }),
    action: { label: t('common.undo'), run: undo },
  })
  return { tool: toolName, segments: next.segments, undo }
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
