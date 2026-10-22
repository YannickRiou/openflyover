/**
 * File actions shared by the top bar, its keyboard shortcuts, the window drop and the panels: save (in place, or as) and open
 * the project file, close it or start a new one, import GPX / FIT tracks and the sample, chain tracks into one, save an export on
 * the desktop (src/platform).
 * Outcomes are shown as toasts.
 */
import { errorMessage } from '../core/errors'
import type { Track } from '../core/types'
import { useMediaStore } from '../film/media'
import { importFile, importText } from '../import'
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
import { confirmClose, flushAutosave, lastOpenProject, projectCloseLoss, setOpenEntry, unsavedChangesText } from './library'
import { askOpenChoice, askUnsavedChanges } from './openChoice'
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
export async function openProject(file: File, entry: ProjectEntry | null = null, reopened = false): Promise<void> {
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
  } catch (err) {
    const reason = errorMessage(err)
    showToast({ kind: 'error', text: t('project.actions.openFailed', { fileName: file.name, reason }) })
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
 */
async function closeOpenProject(ask: () => Promise<CloseAnswer>): Promise<boolean> {
  const closing = await confirmClose({ flush: flushAutosave, loss: projectCloseLoss, ask, save: saveProject })
  if (!closing) return false
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
 * « Nouveau projet » (Projet tab): the open project closed, the default settings, then GPX / FIT files to import (`files`
 * when they are already chosen, else a dialog).
 */
export async function newProject(ask: () => Promise<CloseAnswer>, files?: readonly File[]): Promise<void> {
  if (!(await closeOpenProject(ask))) return
  if (files) importTrackFiles(files)
  else await chooseTracksToImport()
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
  const { project, tracks, extraProjects } = routeOpenedFiles(files)
  if (project) await openProject(project)
  if (tracks.length > 0) {
    if (openedTracksAction({ project, tracks }, useAppStore.getState().tracks.length) === 'add') importTrackFiles(tracks)
    else {
      const choice = await askOpenChoice(tracks.map((file) => file.name))
      if (choice === 'add') importTrackFiles(tracks)
      else if (choice === 'new') await newProject(() => askUnsavedChanges(unsavedChangesText()), tracks)
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
