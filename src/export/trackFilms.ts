/**
 * One film per track of a folder (« Un film par trace »), app side: each file shown alone with its automatic film, and
 * the app put back as it was at the end of the run (`runTrackFilms` in batch.ts runs the tracks).
 *
 * Every setting stays; the film keeps its shots, options and music, not the items placed by hand for the tracks loaded
 * before (stops are generated again). The undo history records nothing during the run, and the tracks and settings are
 * put back as the same objects: « Enregistré » stays, and undoing after the run goes back to the steps of before.
 */
import { filmClockFor } from '../film/clock'
import type { Film } from '../film/model'
import { importFile } from '../import'
import { syncLandmarks, useLandmarkStore } from '../osm/store'
import { getSettingsHistory } from '../project/history'
import { getFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { syncWeather, useWeatherStore } from '../weather/store'
import type { BatchContext } from './batch'
import { wait } from './capture'
import { EXPORT_HOLD_END_S, EXPORT_HOLD_START_S, videoEncoding } from './schedule'
import { t } from '../i18n'

/** Longest wait for the landmarks and the weather of a track (ms): past it, its film is rendered without them. */
export const TRACK_DATA_WAIT_MS = 30_000
const POLL_MS = 200

/** The film of a track loaded alone: shots, options and music of `film`, stops generated, nothing placed by hand. */
export function trackFilm(film: Film): Film {
  return { ...film, autoStops: true, stops: [], speeds: [], cameraKeys: [], paramKeys: [], markerKeys: [], texts: [], media: [], pois: [] }
}

/** Request fields of the film shown (its clock: the track shown, its landmarks), frame rate, quality and encoding of « Vidéo ». */
export function shownFilm(): BatchContext['film'] {
  const clock = filmClockFor(getFilmSource())
  const { video } = useAppStore.getState().settings
  return {
    fps: video.fps,
    quality: video.quality,
    encoding: videoEncoding(video),
    durationS: clock.totalTime(),
    progressAt: clock.progressAtTime,
    holdStartS: EXPORT_HOLD_START_S,
    holdEndS: EXPORT_HOLD_END_S,
  }
}

/**
 * Fetch the landmarks and the weather of the track shown (as their panels do on a change of track), wait for them
 * (at most `TRACK_DATA_WAIT_MS`, or until canceled).
 */
export async function loadTrackData(canceled: () => boolean): Promise<void> {
  const { tracks, settings } = useAppStore.getState()
  syncLandmarks(tracks, settings.landmarks)
  syncWeather(tracks[0], settings.weather.enabled)
  const loading = () => useLandmarkStore.getState().status === 'loading' || useWeatherStore.getState().status === 'loading'
  const end = Date.now() + TRACK_DATA_WAIT_MS
  while (loading() && !canceled() && Date.now() < end) await wait(POLL_MS)
}

export interface TrackFilmsSession {
  /** import `file` alone and show it with its automatic film, its landmarks and weather loaded; throws when unreadable */
  show(file: File): Promise<void>
  /** the tracks, settings and playback of before the run, the undo history recording again */
  restore(): void
}

/** Start a run: what the app shows is kept to be put back by `restore`, the undo history stops recording. */
export function beginTrackFilms(canceled: () => boolean): TrackFilmsSession {
  const { tracks, bounds, frameOrigin, settings, playback } = useAppStore.getState()
  const film = trackFilm(settings.film)
  const resume = getSettingsHistory().suspend()
  return {
    async show(file) {
      const imported = await importFile(file, 0)
      if (imported.length === 0) throw new Error(t('errors.noTrackInFile'))
      const store = useAppStore.getState()
      // all synchronous, as when a project is opened: the scene never sees the empty list
      store.clearTracks()
      store.setSetting('film', film)
      store.addTracks(imported)
      await loadTrackData(canceled)
    },
    restore() {
      useAppStore.setState({ tracks, bounds, frameOrigin, settings, playback })
      useAppStore.getState().requestFit()
      resume()
    },
  }
}
