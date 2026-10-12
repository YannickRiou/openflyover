import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaStore } from '../film/media'
import type { MediaAsset } from '../film/media'
import { buildTrack } from '../import/stats'
import type { OpenFilesOptions, SaveFileOptions, SaveOutcome } from '../platform'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { useLibraryStore } from './library'
import type { CloseAnswer } from './projectActions'
import { isProjectDirty } from './shell'
import { useToastStore } from './toast'

const platform = vi.hoisted(() => ({
  saveFile: vi.fn<(data: Blob, options: SaveFileOptions) => Promise<SaveOutcome>>(),
  openFiles: vi.fn<(options: OpenFilesOptions) => Promise<File[]>>(),
}))
vi.mock('../platform', async (original) => ({ ...(await original<object>()), getPlatform: () => platform }))

const { chooseProjectToOpen, closeProject, newProject, openProject, saveProject } = await import('./projectActions')

const rando = () =>
  buildTrack({
    name: 'Rando',
    source: 'gpx',
    segments: [{ points: [{ lon: 6.86, lat: 45.92, ele: 1000 }, { lon: 6.87, lat: 45.93, ele: 1100 }, { lon: 6.88, lat: 45.93, ele: 1150 }] }],
  })
const toasts = () => useToastStore.getState().toasts.map(({ kind, text }) => ({ kind, text }))
const dirty = () => {
  const s = useAppStore.getState()
  return isProjectDirty({ settings: s.settings, tracks: s.tracks, name: s.projectName }, s.savedProject)
}

/** a project with one track and a changed setting, saved through the fake platform */
async function savedFile(): Promise<File> {
  useAppStore.getState().addTracks([rando()])
  useAppStore.getState().setSetting('exaggeration', 2)
  useAppStore.getState().setProjectName('Rando')
  let blob: Blob | null = null
  platform.saveFile.mockImplementationOnce(async (data, options) => {
    blob = data
    return { saved: true, fileName: options.fileName }
  })
  await saveProject()
  return new File([blob!], 'Rando.openflyover.json')
}

beforeEach(() => {
  resetAppStore()
  useToastStore.setState({ toasts: [] })
  useLibraryStore.setState({ currentId: null })
  platform.saveFile.mockReset()
  platform.openFiles.mockReset()
})

describe('saveProject', () => {
  it('saves <name>.openflyover.json as JSON, marks the project saved and says where', async () => {
    const file = await savedFile()
    const [, options] = platform.saveFile.mock.calls[0]
    expect(options.fileName).toBe('Rando.openflyover.json')
    expect(options.filters).toEqual([{ name: 'Projet OpenFlyover', extensions: ['json'] }])
    expect(JSON.parse(await file.text())).toMatchObject({ format: 'openflyover-project', name: 'Rando', settings: { exaggeration: 2 } })
    expect(dirty()).toBe(false)
    expect(toasts()).toEqual([{ kind: 'success', text: 'Projet enregistré : Rando.openflyover.json' }])
  })

  it('a cancelled dialog changes nothing; a failure says why and leaves the project unsaved', async () => {
    useAppStore.getState().setSetting('exaggeration', 2)
    platform.saveFile.mockResolvedValueOnce({ saved: false })
    await saveProject()
    expect(dirty()).toBe(true)
    expect(toasts()).toEqual([])

    platform.saveFile.mockRejectedValueOnce(new Error('disque plein'))
    await saveProject()
    expect(dirty()).toBe(true)
    expect(toasts()).toEqual([{ kind: 'error', text: "Impossible d'enregistrer le projet : disque plein" }])
  })
})

describe('openProject', () => {
  it('a saved project opens back: tracks, settings and name, saved, history cleared', async () => {
    const file = await savedFile()
    const tracks = useAppStore.getState().tracks.map((t) => ({ name: t.name, points: t.segments.flatMap((s) => s.points).length }))
    resetAppStore()
    useToastStore.setState({ toasts: [] })
    const history = getSettingsHistory()
    useAppStore.getState().setSetting('exaggeration', 3)
    expect(history.getState().canUndo).toBe(true)

    await openProject(file)
    const s = useAppStore.getState()
    expect(s.tracks.map((t) => ({ name: t.name, points: t.segments.flatMap((seg) => seg.points).length }))).toEqual(tracks)
    expect(s.settings.exaggeration).toBe(2)
    expect(s.projectName).toBe('Rando')
    expect(dirty()).toBe(false)
    expect(history.getState().canUndo).toBe(false)
    expect(useLibraryStore.getState().currentId).toBeNull()
    expect(toasts()).toEqual([{ kind: 'success', text: 'Projet « Rando » ouvert' }])
  })

  it('from « Mes projets »: the entry name wins and the entry becomes the open one', async () => {
    const file = await savedFile()
    await openProject(file, { id: 'p-1', name: 'Mon tour', summary: '', updatedAt: 0, sizeBytes: 0 })
    expect(useAppStore.getState().projectName).toBe('Mon tour')
    expect(useLibraryStore.getState().currentId).toBe('p-1')
  })

  it('lists the replaced settings in the message', async () => {
    const text = JSON.stringify({ format: 'openflyover-project', version: 2, name: 'Vieux', settings: { exaggeration: -1 }, tracks: [] })
    await openProject(new File([text], 'vieux.json'))
    expect(useAppStore.getState().settings.exaggeration).toBe(1)
    expect(toasts()).toEqual([
      { kind: 'info', text: 'Projet « Vieux » ouvert.\nRéglages invalides remplacés par leur valeur par défaut : exaggeration.' },
    ])
  })

  it('an unreadable file says why and leaves the open project as it was', async () => {
    useAppStore.getState().addTracks([rando()])
    const before = useAppStore.getState().tracks
    await openProject(new File(['pas du json'], 'notes.json'))
    expect(useAppStore.getState().tracks).toBe(before)
    expect(toasts()).toEqual([
      { kind: 'error', text: "Impossible d'ouvrir « notes.json » : Fichier de projet illisible : ce n'est pas du JSON valide." },
    ])
  })
})

describe('chooseProjectToOpen', () => {
  it('asks the platform for one project file and opens it; nothing when the dialog is closed', async () => {
    const file = await savedFile()
    resetAppStore()
    platform.openFiles.mockResolvedValueOnce([])
    await chooseProjectToOpen()
    expect(useAppStore.getState().tracks).toEqual([])
    expect(platform.openFiles).toHaveBeenCalledWith({ filters: [{ name: 'Projet OpenFlyover', extensions: ['json'] }] })

    platform.openFiles.mockResolvedValueOnce([file])
    await chooseProjectToOpen()
    expect(useAppStore.getState().projectName).toBe('Rando')
    expect(useAppStore.getState().tracks).toHaveLength(1)
  })
})

describe('closeProject / newProject', () => {
  const answering = (answer: CloseAnswer) => vi.fn(async () => answer)
  /** back to an empty project: default settings and speed, no name, no entry, no picture, nothing to undo */
  const expectEmpty = () => {
    const s = useAppStore.getState()
    expect(s.tracks).toEqual([])
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(s.playback.speed).toBe(1)
    expect(s.projectName).toBe('')
    expect(s.filmSelection).toBeNull()
    expect(dirty()).toBe(false)
    expect(getSettingsHistory().getState().canUndo).toBe(false)
    expect(useLibraryStore.getState().currentId).toBeNull()
    expect(useMediaStore.getState().table).toEqual({})
  }

  it('a saved project closes without a question, back to an empty project with the default settings', async () => {
    await savedFile()
    useAppStore.getState().setSpeed(2)
    useAppStore.getState().setFilmSelection('opening')
    useMediaStore.setState({ table: { 'photo-1': {} as MediaAsset } })
    useLibraryStore.setState({ currentId: 'p-1' })
    useToastStore.setState({ toasts: [] })
    const ask = answering('cancel')

    await closeProject(ask)
    expect(ask).not.toHaveBeenCalled()
    expectEmpty()
    expect(toasts()).toEqual([{ kind: 'success', text: 'Projet « Rando » fermé' }])
  })

  it('asks when changes would be lost: « Annuler » keeps the project, « Fermer sans enregistrer » drops them', async () => {
    useAppStore.getState().addTracks([rando()])
    useAppStore.getState().setSetting('exaggeration', 2)
    const cancel = answering('cancel')
    await closeProject(cancel)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().tracks).toHaveLength(1)
    expect(dirty()).toBe(true)
    expect(toasts()).toEqual([])

    await closeProject(answering('close'))
    expectEmpty()
    expect(platform.saveFile).not.toHaveBeenCalled()
  })

  it('« Enregistrer » saves the file first; a closed dialog keeps the project open', async () => {
    useAppStore.getState().addTracks([rando()])
    useAppStore.getState().setSetting('exaggeration', 2)
    platform.saveFile.mockResolvedValueOnce({ saved: false })
    await closeProject(answering('save'))
    expect(useAppStore.getState().tracks).toHaveLength(1)

    platform.saveFile.mockImplementationOnce(async (_data, options) => ({ saved: true, fileName: options.fileName }))
    await closeProject(answering('save'))
    expect(platform.saveFile).toHaveBeenCalledTimes(2)
    expectEmpty()
  })

  it('a project emptied of its tracks closes without a question (its entry or file keeps them)', async () => {
    await savedFile()
    useAppStore.getState().clearTracks()
    expect(dirty()).toBe(true)
    const ask = answering('cancel')
    await closeProject(ask)
    expect(ask).not.toHaveBeenCalled()
    expectEmpty()
  })

  it('newProject closes the open project, then asks for GPX / FIT files to import; nothing when kept open', async () => {
    useAppStore.getState().addTracks([rando()])
    useAppStore.getState().setSetting('exaggeration', 2)
    await newProject(answering('cancel'))
    expect(platform.openFiles).not.toHaveBeenCalled()

    platform.openFiles.mockResolvedValueOnce([])
    await newProject(answering('close'))
    expectEmpty()
    expect(platform.openFiles).toHaveBeenCalledWith({ filters: [{ name: 'Traces GPX ou FIT', extensions: ['gpx', 'fit'] }], multiple: true })
    expect(toasts()).toEqual([])
  })
})
