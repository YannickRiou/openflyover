// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileTargetOf, selectPlatform } from './index'
import { OPENED_FILES_EVENT, takeOpenedFiles, watchOpenedFiles } from './openedFiles'
import type { OpenedFilesBridge } from './openedFiles'

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))
const fs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/plugin-fs', () => fs)

const FILTERS = [{ name: 'Projet OpenFlyover', extensions: ['opnflvr'] }]
const TYPES = [{ description: 'Projet OpenFlyover', accept: { 'application/x-opnflvr': ['.opnflvr'] } }]
const blob = (text = 'projet') => new Blob([text])
const domError = (name: string) => new DOMException(name, name)
/** target of a fake handle (a variable, not a literal: the platform's own target types carry the handle) */
const webTarget = (handle: { name: string }) => ({ fileName: handle.name, handle })

describe('web platform: saveDocument and rewritable open', () => {
  const scope = globalThis as { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown }
  afterEach(() => {
    delete scope.showSaveFilePicker
    delete scope.showOpenFilePicker
    vi.restoreAllMocks()
  })

  /** A file handle whose writable stream records what it is given; `permission` answers queryPermission, `asked` requestPermission. */
  function fakeHandle(name = 'Tour.opnflvr', permission: PermissionState = 'granted', asked: PermissionState = 'granted') {
    const writable = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    return {
      name,
      writable,
      createWritable: vi.fn(async () => writable),
      queryPermission: vi.fn(async () => permission),
      requestPermission: vi.fn(async () => asked),
    }
  }
  const web = () => selectPlatform({})

  it('asks where first, then produces and writes the document, and answers a target', async () => {
    const handle = fakeHandle('Mon tour.opnflvr')
    const order: string[] = []
    const picker = vi.fn(async () => {
      order.push('picker')
      return handle
    })
    scope.showSaveFilePicker = picker
    const data = blob()
    const outcome = await web().saveDocument(
      async () => {
        order.push('produce')
        return data
      },
      { fileName: 'Tour.opnflvr', filters: FILTERS },
    )
    expect(order).toEqual(['picker', 'produce'])
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'Tour.opnflvr', types: TYPES })
    expect(handle.writable.write).toHaveBeenCalledWith(data)
    expect(handle.writable.close).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ saved: true, fileName: 'Mon tour.opnflvr', target: { fileName: 'Mon tour.opnflvr', handle } })
  })

  it('writes the remembered file again without the picker', async () => {
    const handle = fakeHandle()
    const picker = vi.fn()
    scope.showSaveFilePicker = picker
    const target = webTarget(handle)
    const outcome = await web().saveDocument(async () => blob('v2'), { fileName: 'Autre.opnflvr', filters: FILTERS, target })
    expect(picker).not.toHaveBeenCalled()
    expect(handle.requestPermission).not.toHaveBeenCalled()
    expect(handle.writable.close).toHaveBeenCalledTimes(1)
    // the name is the file's, not the suggested one
    expect(outcome).toEqual({ saved: true, fileName: 'Tour.opnflvr', target })
  })

  it('asks the permission to write when the browser forgot it, and uses the picker when it is refused', async () => {
    const picker = vi.fn(async () => fakeHandle('Nouveau.opnflvr'))
    scope.showSaveFilePicker = picker
    const granted = fakeHandle('Tour.opnflvr', 'prompt', 'granted')
    await web().saveDocument(async () => blob(), { fileName: 'Tour.opnflvr', target: webTarget(granted) })
    expect(granted.requestPermission).toHaveBeenCalledTimes(1)
    expect(granted.writable.close).toHaveBeenCalledTimes(1)
    expect(picker).not.toHaveBeenCalled()

    const refused = fakeHandle('Tour.opnflvr', 'prompt', 'denied')
    const outcome = await web().saveDocument(async () => blob(), { fileName: 'Tour.opnflvr', target: webTarget(refused) })
    expect(refused.createWritable).not.toHaveBeenCalled()
    expect(picker).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ saved: true, fileName: 'Nouveau.opnflvr' })
  })

  it('« Enregistrer sous… » always opens the picker, on the folder of the remembered file', async () => {
    const old = fakeHandle()
    const chosen = fakeHandle('Copie.opnflvr')
    const picker = vi.fn(async () => chosen)
    scope.showSaveFilePicker = picker
    const outcome = await web().saveDocument(async () => blob(), { fileName: 'Tour.opnflvr', filters: FILTERS, ask: true, target: webTarget(old) })
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'Tour.opnflvr', types: TYPES, startIn: old })
    expect(old.createWritable).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ saved: true, fileName: 'Copie.opnflvr', target: { handle: chosen } })
  })

  it('a remembered file that is gone sends to the picker; any other failure throws, aborts the write and keeps the project modified', async () => {
    const gone = fakeHandle()
    gone.createWritable.mockRejectedValueOnce(domError('NotFoundError'))
    const chosen = fakeHandle('Retrouvé.opnflvr')
    scope.showSaveFilePicker = vi.fn(async () => chosen)
    const produce = vi.fn(async () => blob())
    const outcome = await web().saveDocument(produce, { fileName: 'Tour.opnflvr', target: webTarget(gone) })
    expect(outcome).toMatchObject({ saved: true, fileName: 'Retrouvé.opnflvr' })
    expect(produce).toHaveBeenCalledTimes(1)

    const full = fakeHandle()
    full.writable.write.mockRejectedValueOnce(domError('QuotaExceededError'))
    const picker = vi.fn()
    scope.showSaveFilePicker = picker
    await expect(web().saveDocument(async () => blob(), { fileName: 'Tour.opnflvr', target: webTarget(full) })).rejects.toThrow('QuotaExceededError')
    expect(full.writable.abort).toHaveBeenCalledTimes(1)
    expect(full.writable.close).not.toHaveBeenCalled()
    expect(picker).not.toHaveBeenCalled()
  })

  it('a closed picker saves nothing and produces nothing', async () => {
    scope.showSaveFilePicker = vi.fn(async () => {
      throw domError('AbortError')
    })
    const produce = vi.fn(async () => blob())
    expect(await web().saveDocument(produce, { fileName: 'Tour.opnflvr' })).toEqual({ saved: false })
    expect(produce).not.toHaveBeenCalled()
  })

  it('without a picker (Firefox, Safari) downloads the file, gives no target and ignores any', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('Tour.opnflvr')
    })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const outcome = await web().saveDocument(async () => blob(), { fileName: 'Tour.opnflvr', target: { fileName: 'Ancien.opnflvr' } })
    expect(outcome).toEqual({ saved: true, fileName: 'Tour.opnflvr' })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('opening with `rewritable` keeps the handles of the picked files; closing the picker gives no file', async () => {
    const handle = { name: 'Tour.opnflvr', getFile: vi.fn(async () => new File(['x'], 'Tour.opnflvr')) }
    const picker = vi.fn(async () => [handle])
    scope.showOpenFilePicker = picker
    const files = await web().openFiles({ filters: [{ name: 'Traces et projets', extensions: ['gpx', 'opnflvr'] }], rewritable: true })
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: 'Traces et projets', accept: { 'application/gpx+xml': ['.gpx'], 'application/x-opnflvr': ['.opnflvr'] } }],
    })
    expect(files.map((f) => f.name)).toEqual(['Tour.opnflvr'])
    expect(fileTargetOf(files[0])).toEqual({ fileName: 'Tour.opnflvr', handle })

    picker.mockRejectedValueOnce(domError('AbortError'))
    expect(await web().openFiles({ filters: [], rewritable: true })).toEqual([])
  })
})

describe('desktop platform: saveDocument and opened files', () => {
  const desktop = () => selectPlatform({ isTauri: true })
  beforeEach(() => {
    dialog.save.mockReset()
    fs.writeFile.mockReset()
    fs.readFile.mockReset()
    fs.exists.mockReset()
  })
  const written = (call = 0) => new TextDecoder().decode(fs.writeFile.mock.calls[call][1] as Uint8Array)

  it('asks for the path, then writes the document there and answers it as target', async () => {
    dialog.save.mockResolvedValueOnce('C:\\Projets\\Tour.opnflvr')
    const outcome = await desktop().saveDocument(async () => blob('contenu'), { fileName: 'Tour.opnflvr', filters: FILTERS })
    expect(dialog.save).toHaveBeenCalledWith({ defaultPath: 'Tour.opnflvr', filters: FILTERS })
    expect(fs.writeFile.mock.calls[0][0]).toBe('C:\\Projets\\Tour.opnflvr')
    expect(written()).toBe('contenu')
    expect(outcome).toEqual({ saved: true, fileName: 'Tour.opnflvr', target: { fileName: 'Tour.opnflvr', path: 'C:\\Projets\\Tour.opnflvr' } })
  })

  it('writes the remembered path again without a dialog; « Enregistrer sous… » asks, starting from that path', async () => {
    const target = { fileName: 'Tour.opnflvr', path: '/home/a/Tour.opnflvr' }
    await desktop().saveDocument(async () => blob('v2'), { fileName: 'Autre.opnflvr', filters: FILTERS, target })
    expect(dialog.save).not.toHaveBeenCalled()
    expect(fs.writeFile.mock.calls[0][0]).toBe('/home/a/Tour.opnflvr')

    dialog.save.mockResolvedValueOnce('/home/a/Copie.opnflvr')
    const outcome = await desktop().saveDocument(async () => blob(), { fileName: 'Autre.opnflvr', filters: FILTERS, target, ask: true })
    expect(dialog.save).toHaveBeenCalledWith({ defaultPath: '/home/a/Tour.opnflvr', filters: FILTERS })
    expect(outcome).toMatchObject({ saved: true, fileName: 'Copie.opnflvr', target: { path: '/home/a/Copie.opnflvr' } })
  })

  it('a closed dialog writes nothing and produces nothing', async () => {
    dialog.save.mockResolvedValueOnce(null)
    const produce = vi.fn(async () => blob())
    expect(await desktop().saveDocument(produce, { fileName: 'Tour.opnflvr' })).toEqual({ saved: false })
    expect(produce).not.toHaveBeenCalled()
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('a failed write throws while the file is there, and opens the dialog when it is gone', async () => {
    const target = { fileName: 'Tour.opnflvr', path: '/mnt/usb/Tour.opnflvr' }
    fs.writeFile.mockRejectedValueOnce(new Error('No space left on device'))
    fs.exists.mockResolvedValueOnce(true)
    await expect(desktop().saveDocument(async () => blob(), { fileName: 'Tour.opnflvr', target })).rejects.toThrow('No space left')
    expect(dialog.save).not.toHaveBeenCalled()

    fs.writeFile.mockRejectedValueOnce(new Error('No such file or directory'))
    fs.exists.mockResolvedValueOnce(false)
    dialog.save.mockResolvedValueOnce('/home/a/Tour.opnflvr')
    const outcome = await desktop().saveDocument(async () => blob('v3'), { fileName: 'Tour.opnflvr', target })
    expect(outcome).toMatchObject({ saved: true, target: { path: '/home/a/Tour.opnflvr' } })
    expect(written(2)).toBe('v3')
  })

  it('files read from the open dialog remember their path', async () => {
    dialog.open.mockResolvedValueOnce('/home/a/Tour.opnflvr')
    fs.readFile.mockResolvedValue(new TextEncoder().encode('x'))
    const [file] = await desktop().openFiles({ filters: [], rewritable: true })
    expect(file.type).toBe('application/x-opnflvr')
    expect(fileTargetOf(file)).toEqual({ fileName: 'Tour.opnflvr', path: '/home/a/Tour.opnflvr' })
  })
})

describe('files opened by the system', () => {
  const desktopScope = { isTauri: true }

  /** bridge with a queue of paths, like the Rust side's */
  function fakeBridge(queue: string[], broken: string[] = []) {
    let listener: (() => void) | null = null
    const stop = vi.fn()
    const bridge: OpenedFilesBridge = {
      take: vi.fn(async () => queue.splice(0)),
      listen: vi.fn(async (l) => {
        listener = l
        return stop
      }),
      read: vi.fn(async (path) => {
        if (broken.includes(path)) throw new Error('Accès refusé')
        return new File(['x'], path.split('/').pop()!)
      }),
    }
    return { bridge, stop, emit: () => listener?.(), queue }
  }

  it('reads the queued files once; the failing ones are reported, not opened', async () => {
    const { bridge } = fakeBridge(['/a/Tour.opnflvr', '/a/cassé.opnflvr'], ['/a/cassé.opnflvr'])
    const fail = vi.fn()
    const files = await takeOpenedFiles(fail, bridge, desktopScope)
    expect(files.map((f) => f.name)).toEqual(['Tour.opnflvr'])
    expect(fail).toHaveBeenCalledWith('cassé.opnflvr', 'Accès refusé')
    expect(await takeOpenedFiles(fail, bridge, desktopScope)).toEqual([])
  })

  it('gives nothing on the website, nor when the command is missing', async () => {
    const { bridge } = fakeBridge(['/a/Tour.opnflvr'])
    expect(await takeOpenedFiles(vi.fn(), bridge, {})).toEqual([])
    expect(bridge.take).not.toHaveBeenCalled()
    bridge.take = vi.fn(async () => {
      throw new Error('unknown command')
    })
    expect(await takeOpenedFiles(vi.fn(), bridge, desktopScope)).toEqual([])
  })

  it('opens what the system hands over later, on each event, until stopped', async () => {
    const { bridge, stop, emit, queue } = fakeBridge([])
    const onFiles = vi.fn()
    const unwatch = watchOpenedFiles(onFiles, vi.fn(), bridge, desktopScope)
    await vi.waitFor(() => expect(bridge.listen).toHaveBeenCalled())
    emit()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onFiles).not.toHaveBeenCalled()
    queue.push('/a/Tour.opnflvr')
    emit()
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1))
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['Tour.opnflvr'])
    unwatch()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(OPENED_FILES_EVENT).toBe('openflyover://opened-files')
  })

  it('does not listen on the website', () => {
    const { bridge } = fakeBridge([])
    watchOpenedFiles(vi.fn(), vi.fn(), bridge, {})()
    expect(bridge.listen).not.toHaveBeenCalled()
  })
})
