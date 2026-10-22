import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaStore } from '../film/media'
import type { MediaAsset } from '../film/media'
import { buildTrack } from '../import/stats'
import { rememberFileTarget } from '../platform'
import type { DocumentOutcome, FileTarget, OpenFilesOptions, SaveDocumentOptions } from '../platform'
import { decodeProjectFile } from '../project/file'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { useLibraryStore } from './library'
import type { CloseAnswer } from './projectActions'
import { isProjectDirty } from './shell'
import { useToastStore } from './toast'

const platform = vi.hoisted(() => ({
  saveDocument: vi.fn<(produce: () => Promise<Blob>, options: SaveDocumentOptions) => Promise<DocumentOutcome>>(),
  openFiles: vi.fn<(options: OpenFilesOptions) => Promise<File[]>>(),
}))
vi.mock('../platform', async (original) => ({ ...(await original<object>()), getPlatform: () => platform }))

const { chooseProjectToOpen, closeProject, newProject, openProject, removeTrackOrCloseProject, reopenLastProject, saveProject, saveProjectAs } = await import('./projectActions')

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
  platform.saveDocument.mockImplementationOnce(async (produce, options) => {
    blob = await produce()
    return { saved: true, fileName: options.fileName }
  })
  await saveProject()
  return new File([blob!], 'Rando.opnflvr')
}

/** a platform that keeps where the file went, like Chrome's handles or the desktop paths */
const rememberingPlatform = () =>
  platform.saveDocument.mockImplementation(async (produce, options) => {
    await produce()
    return { saved: true, fileName: options.fileName, target: { fileName: options.fileName } }
  })

beforeEach(() => {
  resetAppStore()
  useToastStore.setState({ toasts: [] })
  useLibraryStore.setState({ currentId: null })
  platform.saveDocument.mockReset()
  platform.openFiles.mockReset()
})

describe('saveProject', () => {
  it('saves <name>.opnflvr as a compressed project, marks the project saved and says where', async () => {
    const file = await savedFile()
    const [, options] = platform.saveDocument.mock.calls[0]
    expect(options.fileName).toBe('Rando.opnflvr')
    expect(options.filters).toEqual([{ name: 'Projet OpenFlyover', extensions: ['opnflvr'] }])
    expect(options).toMatchObject({ target: null, ask: false })
    expect(await file.slice(0, 7).text()).toBe('OPNFLVR')
    expect(JSON.parse(await decodeProjectFile(file))).toMatchObject({ format: 'openflyover-project', name: 'Rando', settings: { exaggeration: 2 } })
    expect(dirty()).toBe(false)
    expect(toasts()).toEqual([{ kind: 'success', text: 'Projet enregistré : Rando.opnflvr' }])
  })

  it('a cancelled dialog changes nothing; a failure says why and leaves the project unsaved', async () => {
    useAppStore.getState().setSetting('exaggeration', 2)
    platform.saveDocument.mockResolvedValueOnce({ saved: false })
    await saveProject()
    expect(dirty()).toBe(true)
    expect(toasts()).toEqual([])

    platform.saveDocument.mockRejectedValueOnce(new Error('disque plein'))
    await saveProject()
    expect(dirty()).toBe(true)
    expect(toasts()).toEqual([{ kind: 'error', text: "Impossible d'enregistrer le projet : disque plein" }])
  })

  describe('in place', () => {
    it('writes again where the file went, without asking, and « Enregistrer sous… » always asks', async () => {
      rememberingPlatform()
      useAppStore.getState().addTracks([rando()])
      useAppStore.getState().setProjectName('Rando')
      await saveProject()
      const first = useAppStore.getState().projectFile
      expect(first).toEqual({ fileName: 'Rando.opnflvr' })
      expect(platform.saveDocument.mock.calls[0][1]).toMatchObject({ target: null, ask: false })

      useAppStore.getState().setSetting('exaggeration', 2)
      expect(dirty()).toBe(true)
      await saveProject()
      expect(platform.saveDocument.mock.calls[1][1]).toMatchObject({ target: first, ask: false })
      expect(dirty()).toBe(false)

      await saveProjectAs()
      expect(platform.saveDocument.mock.calls[2][1]).toMatchObject({ target: first, ask: true })
      // the new place replaces the old one
      expect(useAppStore.getState().projectFile).not.toBe(first)
    })

    it('a closed « Enregistrer sous… » dialog keeps the place; a failed write keeps it and the project modified', async () => {
      rememberingPlatform()
      useAppStore.getState().addTracks([rando()])
      await saveProject()
      const place = useAppStore.getState().projectFile
      useAppStore.getState().setSetting('exaggeration', 2)

      platform.saveDocument.mockResolvedValueOnce({ saved: false })
      await saveProjectAs()
      expect(useAppStore.getState().projectFile).toBe(place)

      platform.saveDocument.mockRejectedValueOnce(new Error('accès refusé'))
      await saveProject()
      expect(useAppStore.getState().projectFile).toBe(place)
      expect(dirty()).toBe(true)
      expect(toasts().at(-1)).toEqual({ kind: 'error', text: "Impossible d'enregistrer le projet : accès refusé" })
    })

    it('a platform without handles (download) leaves no place: every save goes the same way and says « Projet enregistré »', async () => {
      await savedFile()
      expect(useAppStore.getState().projectFile).toBeNull()
      platform.saveDocument.mockImplementationOnce(async (_produce, options) => ({ saved: true, fileName: options.fileName }))
      await saveProject()
      expect(platform.saveDocument.mock.calls[1][1]).toMatchObject({ target: null })
      expect(toasts()).toEqual([{ kind: 'success', text: 'Projet enregistré : Rando.opnflvr' }])
    })

    it('a project opened from a file is written back to it; one from « Mes projets » is not', async () => {
      const file = await savedFile()
      const place: FileTarget = { fileName: 'Rando.opnflvr' }
      rememberFileTarget(file, place)
      resetAppStore()
      await openProject(file)
      expect(useAppStore.getState().projectFile).toBe(place)

      platform.saveDocument.mockResolvedValueOnce({ saved: true, fileName: 'Rando.opnflvr', target: place })
      await saveProject()
      expect(platform.saveDocument.mock.calls.at(-1)?.[1]).toMatchObject({ target: place })

      await openProject(file, { id: 'p-1', name: 'Mon tour', summary: '', updatedAt: 0, sizeBytes: 0 })
      expect(useAppStore.getState().projectFile).toBeNull()
      await openProject(new File([await file.arrayBuffer()], 'autre.opnflvr'))
      expect(useAppStore.getState().projectFile).toBeNull()
    })

    it('a file that cannot be opened keeps the place of the open project', async () => {
      const place: FileTarget = { fileName: 'A.opnflvr' }
      useAppStore.getState().setProjectFile(place)
      await openProject(new File(['pas un projet'], 'B.opnflvr'))
      expect(useAppStore.getState().projectFile).toBe(place)
    })
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

  it('opens a compressed project and an older plain JSON one', async () => {
    const compressed = await savedFile()
    const plain = JSON.parse(await decodeProjectFile(compressed))
    resetAppStore()
    await openProject(new File([JSON.stringify(plain)], 'Vieux.openflyover.json'))
    expect(useAppStore.getState().projectName).toBe('Rando')
    expect(useAppStore.getState().tracks).toHaveLength(1)
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
      { kind: 'error', text: "Impossible d'ouvrir « notes.json » : Ce n'est pas un projet OpenFlyover (ni un fichier .opnflvr, ni un ancien projet JSON)." },
    ])
    await openProject(new File([], 'vide.opnflvr'))
    expect(toasts().at(-1)).toEqual({ kind: 'error', text: "Impossible d'ouvrir « vide.opnflvr » : Le fichier est vide." })
    await openProject(new File(['{"a":'], 'casse.json'))
    expect(toasts().at(-1)?.text).toContain("ce n'est pas du JSON valide")
  })
})

describe('chooseProjectToOpen', () => {
  it('asks the platform for one project file and opens it; nothing when the dialog is closed', async () => {
    const file = await savedFile()
    resetAppStore()
    platform.openFiles.mockResolvedValueOnce([])
    await chooseProjectToOpen()
    expect(useAppStore.getState().tracks).toEqual([])
    expect(platform.openFiles).toHaveBeenCalledWith({ filters: [{ name: 'Projet OpenFlyover', extensions: ['opnflvr', 'json'] }], rewritable: true })

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
    expect(s.projectFile).toBeNull()
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
    expect(platform.saveDocument).not.toHaveBeenCalled()
  })

  it('« Enregistrer » saves the file first; a closed dialog keeps the project open', async () => {
    useAppStore.getState().addTracks([rando()])
    useAppStore.getState().setSetting('exaggeration', 2)
    platform.saveDocument.mockResolvedValueOnce({ saved: false })
    await closeProject(answering('save'))
    expect(useAppStore.getState().tracks).toHaveLength(1)

    platform.saveDocument.mockImplementationOnce(async (_produce, options) => ({ saved: true, fileName: options.fileName }))
    await closeProject(answering('save'))
    expect(platform.saveDocument).toHaveBeenCalledTimes(2)
    expectEmpty()
  })

  it('closing the project or starting a new one forgets where it was saved', async () => {
    useAppStore.getState().setProjectFile({ fileName: 'Rando.opnflvr' })
    await closeProject(answering('cancel'))
    expect(useAppStore.getState().projectFile).toBeNull()
    useAppStore.getState().setProjectFile({ fileName: 'Rando.opnflvr' })
    platform.openFiles.mockResolvedValueOnce([])
    await newProject(answering('cancel'))
    expect(useAppStore.getState().projectFile).toBeNull()
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

describe('removeTrackOrCloseProject', () => {
  const answering = (answer: CloseAnswer) => vi.fn(async () => answer)
  const second = () => ({ ...rando(), id: 'second', name: 'Autre' })
  const closed = () => {
    const s = useAppStore.getState()
    expect(s.tracks).toEqual([])
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(s.projectName).toBe('')
    expect(s.projectFile).toBeNull()
    expect(dirty()).toBe(false)
    expect(useLibraryStore.getState().currentId).toBeNull()
    expect(useMediaStore.getState().table).toEqual({})
  }

  it('the last track of a saved project closes it without a question: nothing left to save when quitting', async () => {
    await savedFile()
    useAppStore.getState().setProjectFile({ fileName: 'Rando.opnflvr' })
    useLibraryStore.setState({ currentId: 'p-1' })
    useToastStore.setState({ toasts: [] })
    const ask = answering('cancel')
    await removeTrackOrCloseProject(useAppStore.getState().tracks[0].id, ask)
    expect(ask).not.toHaveBeenCalled()
    closed()
    expect(toasts()).toEqual([{ kind: 'success', text: 'Projet « Rando » fermé' }])
  })

  it('a modified project asks first: « Annuler » keeps everything, « Fermer sans enregistrer » closes it', async () => {
    useAppStore.getState().addTracks([rando()])
    useAppStore.getState().setSetting('exaggeration', 2)
    const id = useAppStore.getState().tracks[0].id
    const cancel = answering('cancel')
    await removeTrackOrCloseProject(id, cancel)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().tracks).toHaveLength(1)
    expect(useAppStore.getState().settings.exaggeration).toBe(2)
    expect(dirty()).toBe(true)
    expect(toasts()).toEqual([])

    await removeTrackOrCloseProject(id, answering('close'))
    closed()
    expect(platform.saveDocument).not.toHaveBeenCalled()
  })

  it('« Annuler » in the message puts the track and the project back as they were', async () => {
    await savedFile()
    useAppStore.getState().setProjectFile({ fileName: 'Rando.opnflvr' })
    useAppStore.getState().setSetting('exaggeration', 3)
    useMediaStore.setState({ table: { 'photo-1': {} as MediaAsset } })
    useLibraryStore.setState({ currentId: 'p-1' })
    const before = useAppStore.getState()
    const media = useMediaStore.getState().table
    useToastStore.setState({ toasts: [] })
    await removeTrackOrCloseProject(before.tracks[0].id, answering('close'))
    closed()

    const [toast] = useToastStore.getState().toasts
    expect(toast.action?.label).toBe('Annuler')
    toast.action!.run()
    const after = useAppStore.getState()
    expect(after.tracks).toBe(before.tracks)
    expect(after.settings).toBe(before.settings)
    expect(after.projectName).toBe('Rando')
    expect(after.projectFile).toEqual({ fileName: 'Rando.opnflvr' })
    expect(after.savedProject).toBe(before.savedProject)
    expect(dirty()).toBe(true)
    expect(useMediaStore.getState().table).toEqual(media)
    expect(useLibraryStore.getState().currentId).toBe('p-1')
    expect(getSettingsHistory().getState().canUndo).toBe(false)
  })

  it('a track that is not the last one just goes: the project stays open', async () => {
    useAppStore.getState().addTracks([rando(), second()])
    useAppStore.getState().setProjectName('Rando')
    const ask = answering('cancel')
    await removeTrackOrCloseProject('second', ask)
    expect(ask).not.toHaveBeenCalled()
    expect(useAppStore.getState().tracks).toHaveLength(1)
    expect(useAppStore.getState().projectName).toBe('Rando')
    expect(toasts()).toEqual([])
  })
})

describe('reopenLastProject', () => {
  it('opens the files the system started the app with', async () => {
    const file = await savedFile()
    resetAppStore()
    const opened = vi.fn(async () => [file])
    await reopenLastProject(Promise.resolve(false), opened)
    expect(useAppStore.getState().projectName).toBe('Rando')
    expect(opened).toHaveBeenCalledTimes(1)
  })
})
