/**
 * « Film automatique » on the stores: the gabarit's settings (`film/autoFilm.ts`) applied as one undo step, with a
 * message that offers « Annuler ». Same path as a preset: `applySettings` in a history transaction.
 */
import { AUTO_FILM_LABELS, autoFilmSettings } from '../film/autoFilm'
import type { AutoFilmId } from '../film/autoFilm'
import { trackDays } from '../film/days'
import { trackPathOf } from '../flyover/path'
import { filmSequenceOf, filmTrackOf } from '../flyover/sequence'
import { followFlightTiming } from '../scene/usePacing'
import { applySettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { t } from '../i18n'
import { showToast } from './toast'

/** Apply gabarit `id` to the film of the open project; false when there is no track to apply it to. */
export function applyAutoFilm(id: AutoFilmId): boolean {
  const { tracks, settings: before } = useAppStore.getState()
  const track = filmTrackOf(tracks, before.race)
  if (!track) return false
  const stages = filmSequenceOf(tracks, before.race) !== null
  const days = stages ? 0 : trackDays(trackPathOf(track), track.utcOffsetMin).length
  const history = getSettingsHistory()
  history.transaction(() => {
    applySettings(autoFilmSettings(before, id, { days, stages }))
    // the texts and media attached to a stop follow the new duration
    followFlightTiming(before)
  })
  const after = useAppStore.getState().settings
  if (after.video.aspect !== before.video.aspect) useAppStore.getState().setFreeFraming(false)
  showToast({
    kind: 'success',
    text: t('film.auto.applied', { name: AUTO_FILM_LABELS[id] }),
    // only while nothing else has changed since: it never undoes a later step
    action: { label: t('common.undo'), run: () => { if (useAppStore.getState().settings === after) history.undo() } },
  })
  return true
}
