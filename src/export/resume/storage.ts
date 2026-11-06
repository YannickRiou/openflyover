/**
 * Where a resumable export is kept: a small interface, and its implementation on the origin private file system (OPFS,
 * `navigator.storage.getDirectory()`). Where the browser has none (or no `createWritable`), `openStorage` gives null
 * and the export simply runs without persistence. Tests use an in-memory implementation of `ResumeStorage`.
 */
import { decodeChunk, parseManifest, type ResumeManifest, type StoredPacket } from './resume'

export interface ResumeStorage {
  readManifest(): Promise<ResumeManifest | null>
  writeManifest(manifest: ResumeManifest): Promise<void>
  writeChunk(index: number, bytes: Uint8Array): Promise<void>
  readChunk(index: number): Promise<Uint8Array | null>
  /** delete everything stored */
  clear(): Promise<void>
}

const DIRECTORY = 'openflyover-export-resume'
const MANIFEST = 'manifest.json'
const chunkName = (index: number) => `chunk-${index}.bin`

/** The subset of the File System API used here. */
interface FileHandleLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>
  createWritable?(): Promise<{ write(data: BufferSource | string): Promise<void>; close(): Promise<void> }>
}
interface DirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
}
export interface StorageHost {
  navigator?: { storage?: { getDirectory?: () => Promise<DirectoryLike> } }
}

/** The OPFS storage, or null where it is missing, refused (private window) or cannot write (older Safari). */
export async function openStorage(host: StorageHost = globalThis as StorageHost): Promise<ResumeStorage | null> {
  try {
    const getDirectory = host.navigator?.storage?.getDirectory
    if (typeof getDirectory !== 'function') return null
    const root = await getDirectory.call(host.navigator!.storage)
    const dir = await root.getDirectoryHandle(DIRECTORY, { create: true })
    // Safari before 26 only writes through a synchronous handle in a worker: no persistence there
    const probe = await dir.getFileHandle('probe', { create: true })
    if (typeof probe.createWritable !== 'function') return null
    await dir.removeEntry('probe').catch(() => undefined)
    return storageOn(root)
  } catch {
    return null
  }
}

function storageOn(root: DirectoryLike): ResumeStorage {
  // asked each time: `clear` removes the directory, the next write makes it again
  const directory = () => root.getDirectoryHandle(DIRECTORY, { create: true })
  const write = async (name: string, data: BufferSource | string) => {
    const dir = await directory()
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable!()
    try {
      await writable.write(data)
    } finally {
      await writable.close()
    }
  }
  return {
    async readManifest() {
      try {
        const file = await (await (await directory()).getFileHandle(MANIFEST)).getFile()
        return parseManifest(JSON.parse(await file.text()))
      } catch {
        return null
      }
    },
    writeManifest: (manifest) => write(MANIFEST, JSON.stringify(manifest)),
    writeChunk: (index, bytes) => write(chunkName(index), bytes as BufferSource),
    async readChunk(index) {
      try {
        const file = await (await (await directory()).getFileHandle(chunkName(index))).getFile()
        return new Uint8Array(await file.arrayBuffer())
      } catch {
        return null
      }
    },
    async clear() {
      // the directory itself goes: every chunk with it
      await root.removeEntry(DIRECTORY, { recursive: true }).catch(() => undefined)
    },
  }
}

/** The stored packets before frame `manifest.frames`, chunk by chunk; throws when a chunk is missing or damaged. */
export async function* storedPackets(storage: ResumeStorage, manifest: ResumeManifest): AsyncGenerator<StoredPacket> {
  for (let i = 0; i < manifest.chunks; i++) {
    const bytes = await storage.readChunk(i)
    const packets = bytes && decodeChunk(bytes)
    if (!packets || packets.length === 0) throw new Error(`resume: chunk ${i} unreadable`)
    yield* packets
  }
}
