/**
 * KMZ: a zip archive holding a KML (`doc.kml` by convention) and its icons. The one KML is read through the central
 * directory of the archive and inflated with the browser's `DecompressionStream('deflate-raw')`; nothing else of the
 * archive is read. Zip64 and encrypted archives are refused with a message.
 */
import type { Track } from '../core/types'
import { parseKml } from './kml'
import { t } from '../i18n'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** longest KML read once inflated (bytes): a track of a day is a few MB, a bomb is not read */
const MAX_KML_BYTES = 64 * 1024 * 1024

function invalid(reason: string): Error {
  return new Error(t('imports.kmz.invalid', { reason }))
}

interface Entry {
  name: string
  method: number
  compressedSize: number
  size: number
  offset: number
}

/** The entries of the central directory. */
function readEntries(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // the end-of-central-directory record is within the last 64 KB (its comment is at most that long)
  let eocd = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at
      break
    }
  }
  if (eocd < 0) throw invalid(t('imports.kmz.notZip'))
  const count = view.getUint16(eocd + 10, true)
  const start = view.getUint32(eocd + 16, true)
  if (count === 0xffff || start === 0xffffffff) throw invalid(t('imports.kmz.zip64'))
  const entries: Entry[] = []
  let at = start
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw invalid(t('imports.kmz.notZip'))
    const flags = view.getUint16(at + 8, true)
    if (flags & 1) throw invalid(t('imports.kmz.encrypted'))
    const nameLength = view.getUint16(at + 28, true)
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}

/** The bytes of one entry, stored or deflated. */
async function readEntry(bytes: Uint8Array, entry: Entry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff) throw invalid(t('imports.kmz.zip64'))
  if (entry.size > MAX_KML_BYTES) throw invalid(t('imports.kmz.tooBig'))
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) throw invalid(t('imports.kmz.notZip'))
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return data
  if (entry.method !== 8) throw invalid(t('imports.kmz.method'))
  if (typeof DecompressionStream === 'undefined') throw invalid(t('imports.kmz.noInflate'))
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer())
  if (inflated.length > MAX_KML_BYTES) throw invalid(t('imports.kmz.tooBig'))
  return inflated
}

/** The tracks of a KMZ file (`doc.kml`, else the first `.kml` of the archive). */
export async function parseKmz(buffer: ArrayBuffer, fileName: string): Promise<Track[]> {
  const bytes = new Uint8Array(buffer)
  const kmls = readEntries(bytes).filter((e) => /\.kml$/i.test(e.name) && !e.name.endsWith('/'))
  const entry = kmls.find((e) => e.name.toLowerCase() === 'doc.kml') ?? kmls[0]
  if (!entry) throw invalid(t('imports.kmz.noKml'))
  return parseKml(new TextDecoder().decode(await readEntry(bytes, entry)), fileName)
}
