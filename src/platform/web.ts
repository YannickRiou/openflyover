/**
 * Web platform: file input, download through an object URL, localStorage (the behaviour of the static site); files
 * written while produced through `showSaveFilePicker` (File System Access, Chrome and Edge); offline tiles and
 * « Mes projets » in Cache Storage (HTTPS or localhost only).
 */
import { droppedFiles, isAppleMobile, keyValueStore, mimeTypeOf, pickerAccept, pickerTypes, rememberFileTarget, saveFilters } from './platform'
import type { Capabilities, DocumentOutcome, FileTarget, OpenFilesOptions, Platform, SaveDocumentOptions, SaveFileOptions, SaveOutcome, WritableFile } from './platform'
import { createProjectLibrary, createWebLibraryFiles } from './projectLibrary'
import { createWebTileCache } from './tileCache'
import { t } from '../i18n'

/** The part of File System Access used here (not in the DOM typings yet). */
type SaveFilePicker = (options: {
  suggestedName: string
  types: ReturnType<typeof pickerTypes>
  /** the dialog opens on the folder of this file */
  startIn?: FileSystemHandle
  /** the browser remembers the last folder chosen with this id (Chrome, Edge) */
  id?: string
}) => Promise<FileSystemFileHandle & { remove?: () => Promise<void> }>

type OpenFilePicker = (options: { multiple: boolean; types: ReturnType<typeof pickerTypes> }) => Promise<FileSystemFileHandle[]>

/** Target of a file the website can write again: its handle. */
export interface WebFileTarget extends FileTarget {
  readonly handle: FileSystemFileHandle
}

const webTarget = (handle: FileSystemFileHandle): WebFileTarget => ({ fileName: handle.name, handle })

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Permission to write the file of `handle`, asked when needed (it needs the user's click); false when refused. */
async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const permissions = handle as FileSystemFileHandle & {
    queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
    requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  }
  const descriptor = { mode: 'readwrite' } as const
  try {
    // a browser without the permission calls writes or throws below
    if (!permissions.queryPermission) return true
    if ((await permissions.queryPermission(descriptor)) === 'granted') return true
    return (await permissions.requestPermission?.(descriptor)) === 'granted'
  } catch {
    return false
  }
}

/** Replace the content of the file of `handle` (Chrome writes a temporary file and moves it in place on close). */
async function writeToHandle(handle: FileSystemFileHandle, data: Blob): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

/**
 * `saveDocument` with file handles: the remembered file when it can be written (permission asked if need be), else the
 * save picker, which is shown before `produce` runs so that it still has the user's click. A remembered file that is
 * gone (moved, deleted) sends to the picker as well; any other failure of the write throws.
 */
export async function saveWithHandles(picker: SaveFilePicker, produce: () => Promise<Blob>, options: SaveDocumentOptions): Promise<DocumentOutcome> {
  const previous = (options.target as WebFileTarget | null | undefined)?.handle
  const remembered = previous && !options.ask && (await canWrite(previous)) ? previous : null
  const choose = async () => {
    try {
      return await picker({
        suggestedName: options.fileName,
        types: pickerTypes(saveFilters(options)),
        ...(previous && { startIn: previous }),
      })
    } catch (error) {
      if (isAbort(error)) return null
      throw error
    }
  }
  let handle = remembered ?? (await choose())
  if (!handle) return { saved: false }
  const data = await produce()
  try {
    await writeToHandle(handle, data)
  } catch (error) {
    if (handle !== remembered || !(error instanceof DOMException && error.name === 'NotFoundError')) throw error
    handle = await choose()
    if (!handle) return { saved: false }
    await writeToHandle(handle, data)
  }
  return { saved: true, fileName: handle.name, target: webTarget(handle) }
}

/** Open picker that keeps the handles of the files (see `OpenFilesOptions.rewritable`); an empty list when it is closed. */
async function openWithHandles(picker: OpenFilePicker, { filters, multiple = false }: OpenFilesOptions): Promise<File[]> {
  let handles: FileSystemFileHandle[]
  try {
    handles = await picker({ multiple, types: pickerTypes(filters) })
  } catch (error) {
    if (isAbort(error)) return []
    throw error
  }
  return Promise.all(
    handles.map(async (handle) => {
      const file = await handle.getFile()
      rememberFileTarget(file, webTarget(handle))
      return file
    }),
  )
}

/** Save picker, then a writable stream: Chrome writes to a temporary file, moved in place on close. */
async function createWritableFile(options: SaveFileOptions): Promise<WritableFile | null> {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (!picker) throw new Error(t('platform.error.diskWrite'))
  let handle: Awaited<ReturnType<SaveFilePicker>>
  try {
    // called before any await: the picker needs the user's click
    handle = await picker({ suggestedName: options.fileName, types: pickerTypes(saveFilters(options)), id: 'openflyover-film' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  // the picker created the file: removed by `discard` (Chrome 110+)
  return writableOf(handle, async () => handle.remove?.())
}

/** A file handle open for writing; `remove` deletes the partial file when the export does not finish. */
export async function writableOf(handle: FileSystemFileHandle, remove: () => Promise<void>): Promise<WritableFile> {
  const writable = await handle.createWritable()
  let state: 'open' | 'closed' | 'discarded' = 'open'
  return {
    fileName: handle.name,
    write: (data, position) => writable.write({ type: 'write', data: data as Uint8Array<ArrayBuffer>, position }),
    async close() {
      await writable.close()
      state = 'closed'
    },
    async discard() {
      if (state !== 'open') return
      state = 'discarded'
      await writable.abort().catch(() => undefined)
      await remove().catch(() => undefined)
    },
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The share sheet (iOS: « Enregistrer la vidéo » in Photos, « Enregistrer dans Fichiers »), when it takes this file;
 * null when it does not, or refuses (no user gesture left): the caller downloads instead.
 */
async function shareFile(capabilities: Capabilities, file: File): Promise<SaveOutcome | null> {
  if (!capabilities.sharesFiles || !navigator.canShare?.({ files: [file] })) return null
  try {
    await navigator.share({ files: [file] })
    return { saved: true, fileName: file.name }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { saved: false }
    return null
  }
}

/** Click a download link (the browser saves the file in its download folder). */
function clickDownload(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

/** File input, synchronous up to the click (the picker needs the user's gesture): no handle, so no writing again in place. */
function pickWithInput({ filters, multiple = false }: OpenFilesOptions): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.accept = pickerAccept(filters, isAppleMobile(navigator))
    input.style.display = 'none'
    const done = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true })
    input.addEventListener('cancel', () => done([]), { once: true })
    document.body.append(input)
    input.click()
  })
}

export function createWebPlatform(capabilities: Capabilities): Platform {
  const platform: Platform = {
    capabilities,
    storage: keyValueStore(localStorageOrNull()),
    openFiles(options) {
      const picker = (globalThis as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker
      return options.rewritable && picker ? openWithHandles(picker, options) : pickWithInput(options)
    },
    async saveFile(data, { fileName }) {
      // called before any await: the share sheet needs the user's click
      const shared = await shareFile(capabilities, new File([data], fileName, { type: data.type || mimeTypeOf(fileName) }))
      if (shared) return shared
      const url = URL.createObjectURL(data)
      clickDownload(url, fileName)
      // released once the click has been handled
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { saved: true, fileName }
    },
    async saveUrl(url, { fileName }) {
      if (capabilities.sharesFiles) {
        const blob = await (await fetch(url)).blob()
        const shared = await shareFile(capabilities, new File([blob], fileName, { type: blob.type || mimeTypeOf(fileName) }))
        if (shared) return shared
      }
      clickDownload(url, fileName)
      return { saved: true, fileName }
    },
    async saveDocument(produce, options) {
      const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
      // called before any await: the picker needs the user's click
      if (picker) return saveWithHandles(picker, produce, options)
      return platform.saveFile(await produce(), options)
    },
    createWritableFile,
    droppedFiles,
    tileCache: globalThis.caches ? createWebTileCache(globalThis.caches, globalThis.navigator?.storage) : null,
    projectLibrary: globalThis.caches ? createProjectLibrary(createWebLibraryFiles(globalThis.caches, globalThis.navigator?.storage)) : null,
  }
  return platform
}
