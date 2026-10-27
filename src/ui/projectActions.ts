/**
 * File actions shared by the top bar, its keyboard shortcuts, the window drop and the panels: save (in place, or as) and open
 * the project file, close it or start a new one, import GPX / FIT tracks and the sample, chain tracks into one, save an export on
 * the desktop (src/platform).
 * Outcomes are shown as toasts.
 */
import { errorMessage } from '../core/errors'
import type { Track } from '../core/types'
import { useBatchStore } from '../export/batch'
import { isExportBusy, useExportStore } from '../export/store'
import { useMediaStore } from '../film/media'
import { importFile, importText, supportedExtension } from '../import'
import { chainTracks, followEachOther, replaceByChain } from '../import/chain'
import { fileTargetOf, getPlatform } from '../platform'
import type { OpenFilesOptions, ProjectEntry } from '../platform'
import { applyEmptyProject, applyProject } from '../project/apply'
import { parseProject, projectFileName, serializeProject } from '../project/document'
import { PROJECT_EXTENSION, decodeProjectFile, encodeProjectFile } from '../project/file'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { setAutoFilmOpen } from './autoFilmOpen'
import { importFiles } from './importFlow'
import type { ImportJob } from './importFlow'
import { confirmClose, flushAutosave, lastOpenProject, projectCloseLoss, setOpenEntry, unsavedChangesText, useLibraryStore } from './library'
import { askOpenChoice, askUnsavedChanges, dismissOpenQuestions } from './openChoice'
import { effectiveProjectName, openedTracksAction, routeOpenedFiles } from './shell'
import { dismissToast, showToast } from './toast'
import type { ToastInput } from './toast'
import { t } from '../i18n'

/**
 * Write the project file and mark the project saved. `ask`: always through the dialog (« Enregistrer sous… »), else
 * where it was last saved or opened from when the platform kept that place (`projectFile`), else through the dialog or,
 * on browsers that have none, as a download. The place is remembered for the next save; a failed write says why and
 * leaves the project « Modifié ».
 */
async function writeProject(ask: boolean): Promise<void> {
  const state = useAppStore.getState()
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const text = serializeProject(state, name, useMediaStore.getState().table)
  try {
    const outcome = await getPlatform().saveDocument(() => encodeProjectFile(text), {
      fileName: projectFileName(name),
      filters: [{ name: t('project.actions.filterProject'), extensions: [PROJECT_EXTENSION] }],
      target: state.projectFile,
      ask,
    })
    if (!outcome.saved) return
    state.setProjectFile(outcome.target ?? null)
    state.markProjectSaved()
    showToast({ kind: 'success', text: t('project.actions.saved', { fileName: outcome.fileName }) })
  } catch (err) {
    const reason = errorMessage(err)
    showToast({ kind: 'error', text: t('project.actions.saveFailed', { reason }) })
  }
}

/** « Enregistrer » (Ctrl+S): the file the project was saved to or opened from is written again without a dialog. */
export function saveProject(): Promise<void> {
  return writeProject(false)
}

/** « Enregistrer sous… » (Ctrl+Maj+S): always asks where; the project is then saved there from now on. */
export function saveProjectAs(): Promise<void> {
  return writeProject(true)
}

/** Desktop: an export result (object URL) through the save dialog; says where it went, or why it failed. */
export async function saveExportedFile(url: string, fileName: string): Promise<void> {
  try {
    const outcome = await getPlatform().saveUrl(url, { fileName })
    if (outcome.saved) showToast({ kind: 'success', text: t('project.actions.fileSaved', { fileName: outcome.fileName }) })
  } catch (err) {
    const reason = errorMessage(err)
    showToast({ kind: 'error', text: t('project.actions.fileSaveFailed', { fileName, reason }) })
  }
}

/**
 * Replace everything by the project in `file`; says so, with the warnings of the file, or why it failed. `entry`: the
 * « Mes projets » entry it comes from (its name wins, it is saved automatically from now on); `reopened` at start-up.
 */
export async function openProject(file: File, entry: ProjectEntry | null = null, reopened = false): Promise<boolean> {
  // a change of the project being replaced, still waiting for its autosave
  await flushAutosave()
  try {
    const project = parseProject(await decodeProjectFile(file))
    applyProject(project)
    getSettingsHistory().clear()
    const store = useAppStore.getState()
    const name = entry?.name ?? project.name
    store.setProjectName(name)
    store.markProjectSaved()
    // a file opened from disk is written again by « Enregistrer » where the platform kept its place
    store.setProjectFile(entry ? null : fileTargetOf(file))
    setOpenEntry(entry?.id ?? null)
    const opened = t(reopened ? 'project.actions.reopened' : 'project.actions.opened', { name: effectiveProjectName(name, store.tracks[0]?.name) })
    if (project.warnings.length > 0) showToast({ kind: 'info', text: t('project.actions.openedWarnings', { opened, warnings: project.warnings.join('\n') }) })
    else showToast({ kind: 'success', text: opened })
    return true
  } catch (err) {
    const reason = errorMessage(err)
    showToast({ kind: 'error', text: t('project.actions.openFailed', { fileName: file.name, reason }) })
    return false
  }
}

/** A file the system asked the app to open (double-click on a project) that could not be read. */
export function reportOpenFailure(fileName: string, reason: string): void {
  showToast({ kind: 'error', text: t('project.actions.openFailed', { fileName, reason }) })
}

/** The answer to « Fermer sans enregistrer ? »: save the file first, close anyway, or keep the project open. */
export type CloseAnswer = 'save' | 'close' | 'cancel'

/**
 * Replace the open project by an empty one with the default settings (the home screen shows): its waiting change is
 * written to « Mes projets » first, then `ask` only when changes would still be lost. False when it stays open.
 * `beforeEmptying`: called once it is decided, with the project still as it is; it may return false to keep it open.
 */
async function closeOpenProject(ask: () => Promise<CloseAnswer>, beforeEmptying?: () => boolean | void): Promise<boolean> {
  const closing = await confirmClose({ flush: flushAutosave, loss: projectCloseLoss, ask, save: saveProject })
  if (!closing) return false
  // the render may have started during the question: its project must not be emptied under it
  if (refuseWhileExporting()) return false
  if (beforeEmptying?.() === false) return false
  applyEmptyProject()
  getSettingsHistory().clear()
  const store = useAppStore.getState()
  store.setProjectName('')
  store.markProjectSaved()
  store.setProjectFile(null)
  setOpenEntry(null)
  return true
}

/** « Fermer le projet » (Projet tab): back to the home screen; a kept project stays in « Mes projets ». */
export async function closeProject(ask: () => Promise<CloseAnswer>): Promise<void> {
  const { projectName, tracks } = useAppStore.getState()
  const name = effectiveProjectName(projectName, tracks[0]?.name)
  if (await closeOpenProject(ask)) showToast({ kind: 'success', text: t('project.actions.closed', { name }) })
}

/**
 * « Nouveau projet » (Projet tab): the open project closed, the default settings, then GPX / FIT files to import (dialog).
 */
export async function newProject(ask: () => Promise<CloseAnswer>): Promise<void> {
  if (await closeOpenProject(ask)) await chooseTracksToImport()
}

/** `newProject` with the files already chosen; false (and says so) when the open project stays. */
async function newProjectWith(files: readonly File[], ask: () => Promise<CloseAnswer>): Promise<boolean> {
  const closed = await closeOpenProject(ask)
  if (closed) importTrackFiles(files)
  else if (!exportRunning()) showToast({ kind: 'info', text: t('project.openAsk.unchanged') })
  return closed
}

/** An export or a batch is running (it keeps the shell locked between its jobs too). */
function exportRunning(): boolean {
  return isExportBusy(useExportStore.getState().phase) || useBatchStore.getState().phase === 'running'
}

/** Says why nothing was opened when an export is running. */
function refuseWhileExporting(): boolean {
  if (!exportRunning()) return false
  showToast({ kind: 'info', text: t('shell.exportBusy') })
  return true
}

/** What the open project is made of, to put it back as it was (as the render queue does after a run). */
function keepProject(): () => void {
  const s = useAppStore.getState()
  const kept = {
    tracks: s.tracks,
    bounds: s.bounds,
    frameOrigin: s.frameOrigin,
    settings: s.settings,
    playback: s.playback,
    projectName: s.projectName,
    projectFile: s.projectFile,
    savedProject: s.savedProject,
    filmSelection: s.filmSelection,
    filmKeys: s.filmKeys,
    workArea: s.workArea,
  }
  const media = useMediaStore.getState().table
  const entry = useLibraryStore.getState().currentId
  return () => {
    // the settings coming back are not a step of the undo history
    const resume = getSettingsHistory().suspend()
    useMediaStore.getState().replace(media)
    useAppStore.setState(kept)
    // the entry may have been deleted from « Mes projets » meanwhile
    setOpenEntry(useLibraryStore.getState().entries.some((e) => e.id === entry) ? entry : null)
    useAppStore.getState().requestFit()
    resume()
  }
}

/** true while the last track is being removed (awaiting the last write or the answer) */
let closingLastTrack = false

/**
 * The ✕ of a track card. The last track of the project goes with the project, as « Fermer le projet » (the home screen
 * shows, nothing is left to save): the same question when changes would be lost, then « Annuler » in the message puts
 * the track and the project back. The other tracks just go.
 */
export async function removeTrackOrCloseProject(id: string, ask: () => Promise<CloseAnswer>): Promise<void> {
  const { tracks, projectName, removeTrack } = useAppStore.getState()
  if (tracks.length !== 1 || tracks[0].id !== id) return removeTrack(id)
  // a second click, while the last write or the answer is awaited, would close (and keep) the project twice
  if (closingLastTrack) return
  closingLastTrack = true
  const name = effectiveProjectName(projectName, tracks[0].name)
  let putBack = () => {}
  try {
    const closed = await closeOpenProject(ask, () => {
      // other tracks came in meanwhile (import, opened project): that project is not the one asked about
      if (useAppStore.getState().tracks !== tracks) return false
      putBack = keepProject()
    })
    if (!closed) return
  } finally {
    closingLastTrack = false
  }
  showUntilTracksChange({ kind: 'success', text: t('project.actions.closed', { name }), action: { label: t('common.undo'), run: () => putBack() } })
}

let reopening: Promise<void> | null = null

/**
 * At start-up, once: the files the system started the app with (`openedByOs`: double-click on a project, desktop), else
 * the « Mes projets » entry open when the app was last left (a phone may have discarded the page), unless the desktop
 * app was started for a batch render (`rendering`) or a track or project came first.
 */
export function reopenLastProject(rendering: Promise<boolean>, openedByOs: () => Promise<File[]> = async () => []): Promise<void> {
  reopening ??= rendering.then(async (busy) => {
    const given = busy ? [] : await openedByOs().catch(() => [])
    if (given.length > 0) {
      await openFiles(given)
      return
    }
    const last = busy ? null : await lastOpenProject()
    const { tracks, loading } = useAppStore.getState()
    if (last && tracks.length === 0 && !loading) await openProject(last.file, last.entry, true)
  })
  return reopening
}

/**
 * Files picked with « Ouvrir », dropped on the window or opened by the system: the first project is opened, the tracks
 * are imported; when the open project holds tracks, « Que faire de ce fichier ? » first (added to it, or a new project).
 */
export async function openFiles(files: readonly File[]): Promise<void> {
  // a question still open is about the files before these: it is cancelled
  dismissOpenQuestions()
  if (refuseWhileExporting()) return
  const { project, tracks, extraProjects } = routeOpenedFiles(files)
  // an unreadable project: said by its message, the tracks of the same batch do not go to the project it did not replace
  if (project && !(await openProject(project))) return
  if (tracks.length > 0) {
    if (openedTracksAction({ project, tracks }, useAppStore.getState().tracks.length) === 'add') importTrackFiles(tracks)
    else {
      // the question names the tracks; the other files go along and the importer says what it cannot read
      const choice = await askOpenChoice(tracks.filter((file) => supportedExtension(file.name)).map((file) => file.name))
      // an export may have started during the question
      if (choice !== 'cancel' && refuseWhileExporting()) return
      if (choice === 'add') importTrackFiles(tracks)
      else if (choice === 'new') await newProjectWith(tracks, () => askUnsavedChanges(unsavedChangesText()))
    }
  }
  if (extraProjects.length > 0) {
    showToast({ kind: 'info', text: t('project.actions.extraProjects', { names: extraProjects.map((f) => t('common.quoted', { text: f.name })).join(', ') }) })
  }
}

/** File dialog; a failure (unreadable file, refused access) is shown as a toast and gives no file. */
export async function pickFiles(options: OpenFilesOptions): Promise<File[]> {
  try {
    return await getPlatform().openFiles(options)
  } catch (err) {
    showToast({ kind: 'error', text: t('project.actions.readFailed', { error: errorMessage(err) }) })
    return []
  }
}

/** « Choisir un fichier », « Ajouter » : GPX / FIT files to import (dialog on the desktop). */
export async function chooseTracksToImport(): Promise<void> {
  importTrackFiles(await pickFiles({ filters: [{ name: t('project.actions.filterTracks'), extensions: ['gpx', 'fit'] }], multiple: true }))
}

/** « Ouvrir un projet… » : one project file (dialog on the desktop). */
export async function chooseProjectToOpen(): Promise<void> {
  const files = await pickFiles({ filters: [{ name: t('project.actions.filterProject'), extensions: [PROJECT_EXTENSION, 'json'] }], rewritable: true })
  if (files.length > 0) await openFiles(files)
}

/** « Ouvrir » : file picker (dialog on the desktop) for tracks and a project. */
export async function chooseFilesToOpen(): Promise<void> {
  const files = await pickFiles({
    filters: [{ name: t('project.actions.filterBoth'), extensions: ['gpx', 'fit', PROJECT_EXTENSION, 'json'] }],
    multiple: true,
    rewritable: true,
  })
  if (files.length > 0) await openFiles(files)
}

/** « Essayer avec l'exemple »: a real hike (Étang d'Ayguelongue and Pic de l'Homme, Ariège), every 10th point of the recording. */
const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/etang-ayguelongue-pic-de-l-homme.gpx`
const SAMPLE_NAME = 'etang-ayguelongue-pic-de-l-homme.gpx'

/** `importFiles` bound to the app store and the toasts (files, the sample, Strava activities). */
export async function runImport(jobs: ImportJob[]): Promise<void> {
  const { setLoading, addTracks } = useAppStore.getState()
  // the first track of a new project: the message offers « Film automatique » (not when a track is added to a film)
  let first = false
  const outcome = await importFiles(jobs, {
    trackCount: () => useAppStore.getState().tracks.length,
    setLoading,
    addTracks: (tracks) => {
      first = useAppStore.getState().tracks.length === 0
      addTracks(tracks)
    },
    notify: (kind, text) => {
      if (kind !== 'success' || !first) return void showToast({ kind, text })
      // the action is meant for these tracks: the message goes away when they change, and nothing opens without a track
      const run = () => {
        if (useAppStore.getState().tracks.length > 0) setAutoFilmOpen(true)
      }
      showUntilTracksChange({ kind, text, action: { label: t('film.auto.afterImport'), run } })
    },
  })
  const imported = outcome.tracks
  if (followEachOther(imported)) {
    showUntilTracksChange({
      kind: 'info',
      text: t('project.actions.chainQuestion', { count: imported.length }),
      action: { label: t('project.actions.chain'), run: () => chainLoadedTracks(imported) },
    })
  }
}

/** Show `toast` until the tracks change: its action is meant for the tracks it was shown with. */
export function showUntilTracksChange(toast: ToastInput): void {
  const tracks = useAppStore.getState().tracks
  const id = showToast(toast)
  const stop = useAppStore.subscribe((state) => {
    if (state.tracks === tracks) return
    stop()
    dismissToast(id)
  })
}

/** « Enchaîner en un seul parcours » : `chained` (loaded tracks) become one track, with « Annuler » in the message. */
export function chainLoadedTracks(chained: readonly Track[]): void {
  const store = useAppStore.getState()
  const separate = store.tracks
  let merged: Track
  try {
    merged = chainTracks(chained)
  } catch (error) {
    showToast({ kind: 'error', text: errorMessage(error) })
    return
  }
  store.replaceTracks(replaceByChain(separate, chained, merged))
  showUntilTracksChange({
    kind: 'success',
    text: t('project.actions.chained', { name: merged.name }),
    action: { label: t('common.undo'), run: () => useAppStore.getState().replaceTracks(separate) },
  })
}

/** Import GPX / FIT files (the importer rejects other formats with an explicit message). */
export function importTrackFiles(files: readonly File[]): void {
  if (files.length === 0) return
  void runImport(files.map((file) => ({ label: file.name, run: (i) => importFile(file, i) })))
}

export function loadSample(): void {
  void runImport([
    {
      get label() { return t('project.actions.sample') },
      async run(colorIndex) {
        const response = await fetch(SAMPLE_URL)
        if (!response.ok) throw new Error(t('project.actions.sampleUnavailable', { status: response.status }))
        return importText(await response.text(), SAMPLE_NAME, colorIndex)
      },
    },
  ])
}
