/**
 * Import orchestration, kept free of React so it can be unit-tested (`importFiles` drives the store and the messages
 * through an `ImportSink`).
 * Jobs run one after the other so that every parsed track gets the next free colour index,
 * and a failing file never prevents the others from being imported.
 */
import { errorMessage } from '../core/errors'
import type { Track } from '../core/types'
import { useAppStore } from '../state/store'
import { completeImportedElevations } from '../terrain/elevation'
import { getTerrainSource } from '../terrain/sources'

export interface ImportJob {
  /** Shown in the error banner when the job fails (file name, "l'exemple"…). */
  label: string
  /** Parse and return the tracks; `colorIndex` is the palette index of the first returned track. */
  run(colorIndex: number): Promise<Track[]>
}

export interface ImportOutcome {
  /** Every track parsed by the jobs that succeeded, in job order. */
  tracks: Track[]
  /** One entry per failed job: "<label> : <message>". */
  failures: string[]
}

/**
 * Run `jobs` sequentially. `trackCount` returns the number of tracks already in the app so
 * that colour indices continue after them (read lazily: the user may delete a track meanwhile).
 * Never rejects: failures are collected in the outcome.
 */
export async function runImportJobs(jobs: readonly ImportJob[], trackCount: () => number): Promise<ImportOutcome> {
  const tracks: Track[] = []
  const failures: string[] = []
  for (const job of jobs) {
    try {
      tracks.push(...(await job.run(trackCount() + tracks.length)))
    } catch (error) {
      failures.push(`${job.label} : ${errorMessage(error)}`)
    }
  }
  return { tracks, failures }
}

/** Banner text for the failures of a batch, or null when everything succeeded. */
export function formatImportError(failures: readonly string[]): string | null {
  if (failures.length === 0) return null
  if (failures.length === 1) return `Import impossible — ${failures[0]}`
  return `Imports impossibles :\n${failures.join('\n')}`
}

/** Message after a successful import: the track name for one track, the count otherwise; says when elevation was computed. */
export function importedMessage(tracks: readonly Pick<Track, 'name' | 'elevationEstimated'>[]): string {
  const text = tracks.length === 1 ? `Trace « ${tracks[0].name} » importée` : `${tracks.length} traces importées`
  return tracks.some((t) => t.elevationEstimated) ? `${text}, altitude calculée d’après le relief` : text
}

/** The elevation of the tracks that have none, from the terrain source of the settings (`completeImportedElevations`). */
function completeElevationFromSettings(tracks: Track[]): Promise<Track[]> {
  return completeImportedElevations(tracks, getTerrainSource(useAppStore.getState().settings.terrainSourceId))
}

/** What `importFiles` acts on (the app store and the messages in the app, fakes in the tests). */
export interface ImportSink {
  /** number of tracks already loaded (read for every job) */
  trackCount(): number
  setLoading(loading: boolean): void
  addTracks(tracks: Track[]): void
  notify(kind: 'success' | 'error', text: string): void
  /**
   * The parsed tracks, the elevation computed where it is missing and cheap enough, before they are added (never
   * rejects). Default: `completeImportedElevations` with the terrain source of the settings.
   */
  completeElevation?(tracks: Track[]): Promise<Track[]>
}

/**
 * Import a batch (one job per file, or the sample): loading flag during the batch, elevation computed for the tracks
 * without it, one `addTracks` for every parsed track, then a success message and one error message for the failures.
 * Never rejects.
 */
export async function importFiles(jobs: readonly ImportJob[], sink: ImportSink): Promise<ImportOutcome> {
  sink.setLoading(true)
  try {
    const outcome = await runImportJobs(jobs, () => sink.trackCount())
    if (outcome.tracks.length > 0) {
      outcome.tracks = await (sink.completeElevation
        ? sink.completeElevation(outcome.tracks)
        : completeElevationFromSettings(outcome.tracks))
      sink.addTracks(outcome.tracks)
      sink.notify('success', importedMessage(outcome.tracks))
    }
    const error = formatImportError(outcome.failures)
    if (error) sink.notify('error', error)
    return outcome
  } finally {
    sink.setLoading(false)
  }
}
